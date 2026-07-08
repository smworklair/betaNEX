// Command nexd is the NEX backend service.
//
// NEX runs as a single self-contained process — a modular monolith — that
// hosts the kernel and, over time, the platform's modules. This file is the
// composition root: the one place that reads configuration, constructs the
// concrete components, wires them together, and runs them until the process is
// signalled to stop. Keeping all wiring here means dependencies flow in one
// direction and nothing deeper in the tree reaches for globals.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/smworklair/betakis/internal/config"
	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/module/finance"
	"github.com/smworklair/betakis/internal/platform/httpapi"
	"github.com/smworklair/betakis/internal/platform/logging"
)

func main() {
	if err := run(); err != nil {
		// main is the only place that prints a fatal error and sets the exit
		// code; everything below returns errors instead of calling os.Exit.
		fmt.Fprintf(os.Stderr, "nexd: fatal: %v\n", err)
		os.Exit(1)
	}
}

// run wires up and runs the service, returning an error instead of exiting so
// that startup failures are handled in exactly one place (main).
func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	log := logging.New(os.Stdout, cfg.Log.Level, cfg.Log.Format)
	log.Info("starting nexd", slog.String("env", string(cfg.Env)))

	// ctx is cancelled on the first SIGINT or SIGTERM, which triggers graceful
	// shutdown. A second signal restores default behaviour and terminates the
	// process immediately, so a stuck shutdown can still be interrupted.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// RBAC-политика приложения: модули объявляют права, корень раздаёт их
	// ролям. С вехой M4 раздача переедет в настраиваемую политику tenant'а.
	policy := authz.NewPolicy()
	for _, perm := range []string{finance.PermAccountsWrite, finance.PermEntriesPost} {
		policy.Grant("admin", perm)
		policy.Grant("accountant", perm)
	}

	// Шина команд: единственный путь изменения данных. Пока рекордер аудита
	// пишет в лог; с вехой M2 он начнёт писать в Postgres в той же транзакции.
	bus := command.NewMemoryBus(authz.NewPolicyAuthorizer(policy), audit.NewSlogRecorder(log))

	// Модуль «Финансы» на in-memory хранилище (Postgres — веха M1/M2).
	financeRepo := finance.NewMemoryRepository()
	if err := finance.RegisterCommands(bus, financeRepo); err != nil {
		return fmt.Errorf("register finance commands: %w", err)
	}

	router := httpapi.NewRouter(log, httpapi.RouterConfig{
		DevAuth: cfg.Env == config.EnvDevelopment,
		Mount:   []func(*http.ServeMux){finance.Routes(bus, financeRepo)},
	})
	server := httpapi.New(router, httpapi.Options{
		Addr:            cfg.HTTP.Addr,
		ReadTimeout:     cfg.HTTP.ReadTimeout,
		WriteTimeout:    cfg.HTTP.WriteTimeout,
		IdleTimeout:     cfg.HTTP.IdleTimeout,
		ShutdownTimeout: cfg.HTTP.ShutdownTimeout,
		Logger:          log,
	})

	if err := server.Run(ctx); err != nil {
		return err
	}

	log.Info("nexd stopped")
	return nil
}
