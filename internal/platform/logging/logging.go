// Package logging constructs the structured logger used across NEX.
//
// NEX logs through log/slog from the standard library: it is structured,
// dependency-free, and stable. A single constructor here keeps logger setup in
// one place so every part of the system emits logs in the same shape.
package logging

import (
	"io"
	"log/slog"
	"strings"
)

// New builds a slog.Logger that writes to w using the given level and format.
//
//   - level is one of: debug, info, warn, error.
//   - format is one of: json, text.
//
// Values are normally validated by config.Load before reaching here; if an
// unrecognised value slips through, New falls back to a safe default (info
// level, JSON format) rather than failing, because a running service must
// always be able to log.
func New(w io.Writer, level, format string) *slog.Logger {
	opts := &slog.HandlerOptions{Level: parseLevel(level)}

	var handler slog.Handler
	switch strings.ToLower(format) {
	case "text":
		handler = slog.NewTextHandler(w, opts)
	default:
		handler = slog.NewJSONHandler(w, opts)
	}

	return slog.New(handler)
}

// parseLevel maps a level name to its slog.Level, defaulting to info.
func parseLevel(level string) slog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
