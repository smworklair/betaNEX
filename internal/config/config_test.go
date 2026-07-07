package config

import (
	"testing"
	"time"
)

// clearNexEnv sets every NEX_ variable to empty for the duration of the test,
// so Load observes the built-in defaults regardless of the ambient
// environment. t.Setenv restores the previous values when the test ends.
func clearNexEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"NEX_ENV", "NEX_HTTP_ADDR",
		"NEX_HTTP_READ_TIMEOUT", "NEX_HTTP_WRITE_TIMEOUT",
		"NEX_HTTP_IDLE_TIMEOUT", "NEX_HTTP_SHUTDOWN_TIMEOUT",
		"NEX_LOG_LEVEL", "NEX_LOG_FORMAT",
	} {
		t.Setenv(k, "")
	}
}

func TestLoadDefaults(t *testing.T) {
	clearNexEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Env != EnvDevelopment {
		t.Errorf("Env = %q, want %q", cfg.Env, EnvDevelopment)
	}
	if cfg.HTTP.Addr != ":8080" {
		t.Errorf("HTTP.Addr = %q, want %q", cfg.HTTP.Addr, ":8080")
	}
	if cfg.HTTP.ReadTimeout != 10*time.Second {
		t.Errorf("HTTP.ReadTimeout = %v, want %v", cfg.HTTP.ReadTimeout, 10*time.Second)
	}
	if cfg.HTTP.ShutdownTimeout != 15*time.Second {
		t.Errorf("HTTP.ShutdownTimeout = %v, want %v", cfg.HTTP.ShutdownTimeout, 15*time.Second)
	}
	if cfg.Log.Level != "info" {
		t.Errorf("Log.Level = %q, want info", cfg.Log.Level)
	}
	if cfg.Log.Format != "text" {
		t.Errorf("Log.Format = %q, want text (development default)", cfg.Log.Format)
	}
}

func TestLoadOverrides(t *testing.T) {
	clearNexEnv(t)
	t.Setenv("NEX_ENV", "production")
	t.Setenv("NEX_HTTP_ADDR", ":9000")
	t.Setenv("NEX_HTTP_READ_TIMEOUT", "5s")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Env != EnvProduction {
		t.Errorf("Env = %q, want %q", cfg.Env, EnvProduction)
	}
	if cfg.HTTP.Addr != ":9000" {
		t.Errorf("HTTP.Addr = %q, want :9000", cfg.HTTP.Addr)
	}
	if cfg.HTTP.ReadTimeout != 5*time.Second {
		t.Errorf("HTTP.ReadTimeout = %v, want %v", cfg.HTTP.ReadTimeout, 5*time.Second)
	}
	if cfg.Log.Format != "json" {
		t.Errorf("Log.Format = %q, want json (production default)", cfg.Log.Format)
	}
}

func TestLoadInvalidDuration(t *testing.T) {
	clearNexEnv(t)
	t.Setenv("NEX_HTTP_READ_TIMEOUT", "not-a-duration")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want an error for a malformed duration")
	}
}

func TestLoadInvalidEnv(t *testing.T) {
	clearNexEnv(t)
	t.Setenv("NEX_ENV", "staging")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want an error for an unknown environment")
	}
}

func TestLoadInvalidLogLevel(t *testing.T) {
	clearNexEnv(t)
	t.Setenv("NEX_LOG_LEVEL", "verbose")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want an error for an unknown log level")
	}
}
