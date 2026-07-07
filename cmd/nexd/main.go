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
	"os"
	"os/signal"
	"syscall"

	"github.com/smworklair/betakis/internal/config"
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

	router := httpapi.NewRouter(log)
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
