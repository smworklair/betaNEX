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
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Environment identifies the deployment environment NEX is running in. It is
// used for environment-specific defaults (for example, log format) and must
// never be used to branch on domain behaviour.
type Environment string

// Supported deployment environments.
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

	// DB configures the PostgreSQL connection.
	DB DBConfig

	// Auth configures kernel authentication.
	Auth AuthConfig

	// Files configures on-disk file storage.
	Files FilesConfig

	// Log configures structured logging.
	Log LogConfig

	// AIGateway configures the reverse proxy to the ai-gateway service.
	AIGateway AIGatewayConfig

	// Cache configures the cache backend (internal/platform/cache).
	Cache CacheConfig
}

// CacheConfig selects the backend behind internal/platform/cache.Cache
// (ADR-008). "memory" (default) keeps NEX at zero extra infrastructure,
// as it has been since the interface was introduced; "redis" switches
// to a network cache shared across instances, needed once nexd runs
// more than one replica or a module wants a cache that survives a
// single instance's restart. Switching backends is a config change, not
// a code change — nothing that already runs in-memory is affected by
// leaving Backend at its default.
type CacheConfig struct {
	// Backend is "memory" or "redis".
	Backend string

	// RedisURL is the connection string (e.g.
	// redis://user:pass@host:6379/0), required when Backend is "redis".
	// Accepted by any server speaking the Redis wire protocol (RESP),
	// including Valkey — see compose.yaml and docs/decision-log.md,
	// ADR-008.
	RedisURL string
}

// AIGatewayConfig configures nexd's reverse proxy to ai-gateway
// (internal/platform/httpapi/aiproxy.go). The browser never talks to
// ai-gateway directly: it would have to send an unauthenticated
// X-Tenant-Id header that any client could forge to ride another
// tenant's budget. nexd proxies /api/v1/ai/* instead, deriving the
// tenant from the caller's authenticated session and signing the
// upstream request with a secret shared with ai-gateway.
type AIGatewayConfig struct {
	// URL is ai-gateway's internal address (e.g. http://ai-gateway:8090
	// on the docker network). Empty disables the proxy entirely — no
	// /api/v1/ai/* routes are mounted, so environments that don't run
	// ai-gateway are unaffected.
	URL string

	// Secret is shared with ai-gateway (its NEX_AI_GATEWAY_SECRET /
	// Settings.gateway_shared_secret) and sent as X-Gateway-Secret on
	// every proxied request. Empty means the header is omitted —
	// matches an ai-gateway that also has no secret configured (local
	// development).
	Secret string
}

// DBConfig configures the connection to PostgreSQL.
type DBConfig struct {
	// URL is the connection string (DSN). An empty URL puts nexd in
	// in-memory mode: no persistence, intended only for quick local runs
	// without a database.
	URL string
}

// AuthConfig configures kernel authentication.
type AuthConfig struct {
	// SessionTTL is how long an issued session (and its cookie) lives.
	// Sessions slide: any authenticated request made after half the TTL
	// has passed extends the session by a full TTL, so active users are
	// never logged out mid-work.
	SessionTTL time.Duration

	// CookieSameSite is the SameSite attribute of the session cookie:
	// "lax", "strict" or "none". "none" is required when the frontend is
	// served from a different origin than the API (browsers do not send
	// Lax cookies on cross-site fetch), and forces the Secure flag.
	// Empty means auto: "none" when CORS origins are configured,
	// "lax" otherwise.
	CookieSameSite string
}

// FilesConfig configures on-disk file storage.
type FilesConfig struct {
	// Dir is the root directory for stored file content.
	Dir string

	// MaxUploadBytes bounds a single upload body.
	MaxUploadBytes int64
}

// HTTPConfig configures the HTTP server that exposes NEX over the network.
type HTTPConfig struct {
	// Addr is the TCP address the server listens on, e.g. ":8080".
	Addr string

	// CORSOrigins lists browser origins (scheme://host[:port]) allowed to
	// call the API with credentials from another origin — e.g. the Vercel
	// frontend talking to a VPS backend. Empty means same-origin only:
	// no CORS headers are emitted and cross-site requests are rejected
	// by the CSRF check.
	CORSOrigins []string

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
			CORSOrigins:     r.list("NEX_CORS_ORIGINS"),
			ReadTimeout:     r.duration("NEX_HTTP_READ_TIMEOUT", 10*time.Second),
			WriteTimeout:    r.duration("NEX_HTTP_WRITE_TIMEOUT", 15*time.Second),
			IdleTimeout:     r.duration("NEX_HTTP_IDLE_TIMEOUT", 60*time.Second),
			ShutdownTimeout: r.duration("NEX_HTTP_SHUTDOWN_TIMEOUT", 15*time.Second),
		},
		DB: DBConfig{
			URL: r.str("NEX_DATABASE_URL", ""),
		},
		Auth: AuthConfig{
			SessionTTL:     r.duration("NEX_SESSION_TTL", 7*24*time.Hour),
			CookieSameSite: r.str("NEX_COOKIE_SAMESITE", ""),
		},
		Files: FilesConfig{
			Dir:            r.str("NEX_DATA_DIR", "./data"),
			MaxUploadBytes: r.int64("NEX_MAX_UPLOAD_BYTES", 20<<20),
		},
		Log: LogConfig{
			Level:  r.str("NEX_LOG_LEVEL", "info"),
			Format: r.str("NEX_LOG_FORMAT", ""),
		},
		AIGateway: AIGatewayConfig{
			URL:    r.str("NEX_AI_GATEWAY_URL", ""),
			Secret: r.str("NEX_AI_GATEWAY_SECRET", ""),
		},
		Cache: CacheConfig{
			Backend:  r.str("NEX_CACHE_BACKEND", "memory"),
			RedisURL: r.str("NEX_REDIS_URL", ""),
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

	// Browsers do not attach SameSite=Lax cookies to cross-site fetch calls,
	// so a cross-origin frontend silently loses its session unless the cookie
	// is SameSite=None. Configured CORS origins make the cross-origin intent
	// explicit — derive the cookie default from it.
	if cfg.Auth.CookieSameSite == "" {
		if len(cfg.HTTP.CORSOrigins) > 0 {
			cfg.Auth.CookieSameSite = "none"
		} else {
			cfg.Auth.CookieSameSite = "lax"
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

	if c.Auth.SessionTTL <= 0 {
		errs = append(errs, errors.New("NEX_SESSION_TTL: must be positive"))
	}

	switch c.Auth.CookieSameSite {
	case "lax", "strict", "none":
	default:
		errs = append(errs, fmt.Errorf("NEX_COOKIE_SAMESITE: unknown value %q (want lax, strict or none)", c.Auth.CookieSameSite))
	}

	for _, origin := range c.HTTP.CORSOrigins {
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
			u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			errs = append(errs, fmt.Errorf("NEX_CORS_ORIGINS: %q is not an origin (want scheme://host[:port])", origin))
		}
	}

	if c.AIGateway.URL != "" {
		if u, err := url.Parse(c.AIGateway.URL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			errs = append(errs, fmt.Errorf("NEX_AI_GATEWAY_URL: %q is not a valid http(s) URL", c.AIGateway.URL))
		}
		// В production забытый секрет означает, что X-Tenant-Id для
		// ai-gateway снова станет самопредставлением клиента (см.
		// AIGatewayConfig, doc-комментарий) — отказываем сразу при
		// старте, а не тихо запускаемся в небезопасном режиме.
		if c.Env == EnvProduction && c.AIGateway.Secret == "" {
			errs = append(errs, errors.New("NEX_AI_GATEWAY_SECRET: must be set in production when NEX_AI_GATEWAY_URL is configured"))
		}
	}

	switch c.Cache.Backend {
	case "memory":
	case "redis":
		if c.Cache.RedisURL == "" {
			errs = append(errs, errors.New("NEX_REDIS_URL: must be set when NEX_CACHE_BACKEND=redis"))
			break
		}
		if u, err := url.Parse(c.Cache.RedisURL); err != nil || (u.Scheme != "redis" && u.Scheme != "rediss") || u.Host == "" {
			errs = append(errs, fmt.Errorf("NEX_REDIS_URL: %q is not a valid redis(s):// URL", c.Cache.RedisURL))
		}
	default:
		errs = append(errs, fmt.Errorf("NEX_CACHE_BACKEND: unknown backend %q (want memory or redis)", c.Cache.Backend))
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

// list parses the value of key as a comma-separated list, trimming
// whitespace and dropping empty items. An unset key yields nil.
func (r *envReader) list(key string) []string {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return nil
	}
	var out []string
	for _, item := range strings.Split(v, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, strings.TrimSuffix(item, "/"))
		}
	}
	return out
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

// int64 parses the value of key as a decimal integer, or returns def if
// key is unset or empty.
func (r *envReader) int64(key string, def int64) int64 {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		r.errs = append(r.errs, fmt.Errorf("%s: invalid integer %q: %w", key, v, err))
		return def
	}
	return n
}

// err returns the combined parse errors, or nil if there were none.
func (r *envReader) err() error {
	return errors.Join(r.errs...)
}
