// Package config loads and validates the runtime configuration for a NEX
// process from the environment.
//
// Configuration is read exactly once, at startup, through Load. The resulting
// Config value is immutable and is passed explicitly to the components that
// need it; nothing in NEX reads os.Getenv on its own. Keeping all knobs behind
// a single function means the complete set of configuration options is
// discoverable in one place, and follows the 12-factor principle of storing
// config in the environment.
//
// Every variable is prefixed with NEX_ to avoid collisions with unrelated
// process environment.
package config

import (
	"errors"
	"fmt"
	"os"
	"time"
)

// Environment identifies the deployment environment NEX is running in. It is
// used for environment-specific defaults (for example, log format) and must
// never be used to branch on domain behaviour.
type Environment string

const (
	EnvDevelopment Environment = "development"
	EnvProduction  Environment = "production"
)

// Config is the fully validated runtime configuration for a NEX process. It is
// constructed once by Load and is not mutated afterwards.
type Config struct {
	// Env controls environment-specific behaviour such as default log format.
	Env Environment

	// HTTP configures the inbound HTTP transport.
	HTTP HTTPConfig

	// Log configures structured logging.
	Log LogConfig
}

// HTTPConfig configures the HTTP server that exposes NEX over the network.
type HTTPConfig struct {
	// Addr is the TCP address the server listens on, e.g. ":8080".
	Addr string

	// ReadTimeout bounds the time spent reading an entire request, including
	// its body. It protects the server from slow-client attacks.
	ReadTimeout time.Duration

	// WriteTimeout bounds the time from the end of request header reading to
	// the end of the response write.
	WriteTimeout time.Duration

	// IdleTimeout bounds how long an idle keep-alive connection is kept open.
	IdleTimeout time.Duration

	// ShutdownTimeout bounds graceful shutdown: in-flight requests have this
	// long to finish before connections are forcibly closed.
	ShutdownTimeout time.Duration
}

// LogConfig configures structured logging.
type LogConfig struct {
	// Level is the minimum level emitted: debug, info, warn or error.
	Level string

	// Format is the output encoding: json or text.
	Format string
}

// Load reads configuration from the environment, applies defaults, validates
// the result, and returns an immutable Config. If any value is malformed or
// invalid, Load reports every problem at once rather than failing on the first,
// so a misconfigured deployment can be fixed in a single pass.
func Load() (Config, error) {
	var r envReader

	cfg := Config{
		Env: Environment(r.str("NEX_ENV", string(EnvDevelopment))),
		HTTP: HTTPConfig{
			Addr:            r.str("NEX_HTTP_ADDR", ":8080"),
			ReadTimeout:     r.duration("NEX_HTTP_READ_TIMEOUT", 10*time.Second),
			WriteTimeout:    r.duration("NEX_HTTP_WRITE_TIMEOUT", 15*time.Second),
			IdleTimeout:     r.duration("NEX_HTTP_IDLE_TIMEOUT", 60*time.Second),
			ShutdownTimeout: r.duration("NEX_HTTP_SHUTDOWN_TIMEOUT", 15*time.Second),
		},
		Log: LogConfig{
			Level:  r.str("NEX_LOG_LEVEL", "info"),
			Format: r.str("NEX_LOG_FORMAT", ""),
		},
	}

	// The default log format depends on the environment: human-readable text in
	// development, machine-parseable JSON in production.
	if cfg.Log.Format == "" {
		if cfg.Env == EnvProduction {
			cfg.Log.Format = "json"
		} else {
			cfg.Log.Format = "text"
		}
	}

	if err := r.err(); err != nil {
		return Config{}, fmt.Errorf("load config: %w", err)
	}
	if err := cfg.validate(); err != nil {
		return Config{}, fmt.Errorf("load config: %w", err)
	}
	return cfg, nil
}

// validate checks that a populated Config holds only acceptable values. It is
// separate from parsing so the rules are stated once and are easy to read.
func (c Config) validate() error {
	var errs []error

	switch c.Env {
	case EnvDevelopment, EnvProduction:
	default:
		errs = append(errs, fmt.Errorf("NEX_ENV: unknown environment %q (want %q or %q)",
			c.Env, EnvDevelopment, EnvProduction))
	}

	if c.HTTP.Addr == "" {
		errs = append(errs, errors.New("NEX_HTTP_ADDR: must not be empty"))
	}

	switch c.Log.Level {
	case "debug", "info", "warn", "error":
	default:
		errs = append(errs, fmt.Errorf("NEX_LOG_LEVEL: unknown level %q (want debug, info, warn or error)", c.Log.Level))
	}

	switch c.Log.Format {
	case "json", "text":
	default:
		errs = append(errs, fmt.Errorf("NEX_LOG_FORMAT: unknown format %q (want json or text)", c.Log.Format))
	}

	return errors.Join(errs...)
}

// envReader reads typed values from the environment, accumulating any parse
// errors so that Load can report them all together.
type envReader struct {
	errs []error
}

// str returns the value of key, or def if key is unset or empty.
func (r *envReader) str(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

// duration parses the value of key as a Go duration (e.g. "15s", "2m"), or
// returns def if key is unset or empty. A malformed value is recorded as an
// error and def is returned so parsing of the remaining keys can continue.
func (r *envReader) duration(key string, def time.Duration) time.Duration {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		r.errs = append(r.errs, fmt.Errorf("%s: invalid duration %q: %w", key, v, err))
		return def
	}
	return d
}

// err returns the combined parse errors, or nil if there were none.
func (r *envReader) err() error {
	return errors.Join(r.errs...)
}
