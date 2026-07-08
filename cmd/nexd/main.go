// Command nexd is the NEX backend service.
//
// NEX runs as a single self-contained process — a modular monolith — that
// hosts the kernel and, over time, the platform's modules. This file is the
// composition root: the one place that reads configuration, constructs the
// concrete components, wires them together, and runs them until the process is
// signalled to stop. Keeping all wiring here means dependencies flow in one
// direction and nothing deeper in the tree reaches for globals.
//
// Подкоманды:
//
//	nexd [serve]                     запустить сервис (по умолчанию)
//	nexd migrate                     применить миграции и выйти
//	nexd tenant create <slug> <имя>  зарегистрировать организацию
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/smworklair/betakis/internal/config"
	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/module/finance"
	"github.com/smworklair/betakis/internal/platform/httpapi"
	"github.com/smworklair/betakis/internal/platform/logging"
	"github.com/smworklair/betakis/internal/platform/postgres"
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

	// ctx is cancelled on the first SIGINT or SIGTERM, which triggers graceful
	// shutdown. A second signal restores default behaviour and terminates the
	// process immediately, so a stuck shutdown can still be interrupted.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	switch cmd := subcommand(); cmd {
	case "serve":
		return serve(ctx, cfg, log)
	case "migrate":
		if cfg.DB.URL == "" {
			return fmt.Errorf("migrate: NEX_DATABASE_URL is not set")
		}
		if err := postgres.Migrate(ctx, cfg.DB.URL); err != nil {
			return err
		}
		log.Info("migrations applied")
		return nil
	case "tenant":
		return tenantCmd(ctx, cfg, os.Args[2:])
	default:
		return fmt.Errorf("unknown subcommand %q (want serve, migrate or tenant)", cmd)
	}
}

// subcommand возвращает первую подкоманду из аргументов ("serve", если
// аргументов нет).
func subcommand() string {
	if len(os.Args) < 2 {
		return "serve"
	}
	return os.Args[1]
}

// serve собирает все компоненты сервиса и обслуживает HTTP до сигнала
// остановки.
func serve(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	log.Info("starting nexd", slog.String("env", string(cfg.Env)))

	// RBAC-политика приложения: модули объявляют права, корень раздаёт их
	// ролям. С вехой M4 раздача переедет в настраиваемую политику tenant'а.
	policy := authz.NewPolicy()
	for _, perm := range []string{finance.PermAccountsWrite, finance.PermEntriesPost} {
		policy.Grant("admin", perm)
		policy.Grant("accountant", perm)
	}

	// Хранилище: PostgreSQL, если задан NEX_DATABASE_URL, иначе память
	// процесса (только для быстрых локальных запусков без БД).
	var (
		financeRepo   finance.Repository
		readiness     []httpapi.ReadinessCheck
		resolveTenant func(ctx context.Context, v string) (string, error)
		recorder      audit.Recorder
		busOpts       []command.Option
	)
	if cfg.DB.URL != "" {
		pg, err := postgres.Connect(ctx, cfg.DB.URL)
		if err != nil {
			return err
		}
		defer pg.Close()
		if err := postgres.Migrate(ctx, cfg.DB.URL); err != nil {
			return err
		}
		log.Info("postgres connected, migrations applied")

		financeRepo = finance.NewPostgresRepository(pg)
		readiness = append(readiness, httpapi.ReadinessCheck{Name: "postgres", Check: pg.Ready})
		if cfg.Env == config.EnvDevelopment {
			// В разработке неизвестный slug создаёт tenant на лету:
			// локальная работа не начинается с ручной регистрации.
			resolveTenant = pg.EnsureTenant
		} else {
			resolveTenant = pg.ResolveTenant
		}

		// Аудит — в append-only таблицу, в одной транзакции с изменением
		// данных (шина оборачивает хендлер и запись журнала в RunTx).
		recorder = postgres.NewAuditRecorder(pg, httpapi.RequestIDFrom)
		busOpts = append(busOpts, command.WithTxRunner(pg))
	} else {
		log.Warn("NEX_DATABASE_URL is empty: running with in-memory storage, data is lost on restart")
		financeRepo = finance.NewMemoryRepository()
		recorder = audit.NewSlogRecorder(log)
	}

	// Шина команд: единственный путь изменения данных.
	bus := command.NewMemoryBus(authz.NewPolicyAuthorizer(policy), recorder, busOpts...)
	if err := finance.RegisterCommands(bus, financeRepo); err != nil {
		return fmt.Errorf("register finance commands: %w", err)
	}

	router := httpapi.NewRouter(log, httpapi.RouterConfig{
		Readiness:     readiness,
		DevAuth:       cfg.Env == config.EnvDevelopment,
		ResolveTenant: resolveTenant,
		Mount:         []func(*http.ServeMux){finance.Routes(bus, financeRepo)},
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

// tenantCmd — администрирование реестра tenant'ов:
//
//	nexd tenant create <slug> <отображаемое имя>
func tenantCmd(ctx context.Context, cfg config.Config, args []string) error {
	if len(args) < 1 || args[0] != "create" {
		return fmt.Errorf("tenant: usage: nexd tenant create <slug> <name>")
	}
	if len(args) < 3 {
		return fmt.Errorf("tenant create: usage: nexd tenant create <slug> <name>")
	}
	if cfg.DB.URL == "" {
		return fmt.Errorf("tenant create: NEX_DATABASE_URL is not set")
	}
	slug, name := args[1], strings.Join(args[2:], " ")

	pg, err := postgres.Connect(ctx, cfg.DB.URL)
	if err != nil {
		return err
	}
	defer pg.Close()
	if err := postgres.Migrate(ctx, cfg.DB.URL); err != nil {
		return err
	}

	id, err := pg.CreateTenant(ctx, slug, name)
	if err != nil {
		return err
	}
	fmt.Printf("tenant created: %s (%s)\n", id, slug)
	return nil
}
