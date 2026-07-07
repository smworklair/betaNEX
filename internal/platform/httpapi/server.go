// Package httpapi provides the inbound HTTP transport for NEX.
//
// In NEX's architecture this package is an adapter: it accepts HTTP requests
// and translates them into calls on the application. It owns no domain logic
// and no kernel logic of its own. The kernel and the modules know nothing
// about HTTP; this is the only place that does.
package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// Server owns the lifecycle of the NEX HTTP listener: starting it, and shutting
// it down gracefully when asked.
type Server struct {
	httpServer      *http.Server
	shutdownTimeout time.Duration
	log             *slog.Logger
}

// Options configures a Server. All durations come from config and are passed
// in explicitly rather than read from a global.
type Options struct {
	Addr            string
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout     time.Duration
	ShutdownTimeout time.Duration
	Logger          *slog.Logger
}

// New constructs a Server that serves handler with the given options.
func New(handler http.Handler, opts Options) *Server {
	return &Server{
		httpServer: &http.Server{
			Addr:         opts.Addr,
			Handler:      handler,
			ReadTimeout:  opts.ReadTimeout,
			WriteTimeout: opts.WriteTimeout,
			IdleTimeout:  opts.IdleTimeout,
		},
		shutdownTimeout: opts.ShutdownTimeout,
		log:             opts.Logger,
	}
}

// Run starts the HTTP server and blocks until either the server fails or ctx is
// cancelled. On cancellation it attempts a graceful shutdown bounded by the
// configured shutdown timeout, allowing in-flight requests to finish.
//
// It returns nil on a clean shutdown, or an error if the listener fails to
// start or graceful shutdown does not complete in time.
func (s *Server) Run(ctx context.Context) error {
	// serveErr carries the result of ListenAndServe so the select below can
	// distinguish "the server stopped on its own" (e.g. the port is taken)
	// from "we were asked to shut down".
	serveErr := make(chan error, 1)
	go func() {
		s.log.Info("http server listening", slog.String("addr", s.httpServer.Addr))
		err := s.httpServer.ListenAndServe()
		if errors.Is(err, http.ErrServerClosed) {
			// Expected during graceful shutdown; not an error.
			err = nil
		}
		serveErr <- err
	}()

	select {
	case err := <-serveErr:
		if err != nil {
			return fmt.Errorf("http server: %w", err)
		}
		return nil
	case <-ctx.Done():
		s.log.Info("http server shutting down", slog.Duration("timeout", s.shutdownTimeout))
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), s.shutdownTimeout)
	defer cancel()
	if err := s.httpServer.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("http server graceful shutdown: %w", err)
	}

	s.log.Info("http server stopped")
	return nil
}
