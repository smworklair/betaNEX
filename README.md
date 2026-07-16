# NEX

NEX is a web-first platform for building specialized information systems on a
single reusable backend. The first system built on it targets colleges and
universities, but the core is deliberately domain-free so the same foundation
can serve other organizations.

This repository contains the NEX backend (Go). The existing front-end under
`src/` and `index.html` ("КИС Колледж") is an earlier **visual prototype** kept
for reference; it is not the architecture and the backend does not depend on it.

## Architecture in one paragraph

NEX is a **modular monolith**: a thin, domain-free **kernel** (identity,
authorization, tenancy, and a Commands → Events → Audit spine) hosts independent
**modules** that contain the actual domain logic. Concrete systems are
**applications** that compose modules. Dependencies only ever point inward:
applications depend on modules, modules depend on the kernel, the kernel depends
on nothing above it. AI is treated as a future *actor* that uses the same
authorized, audited paths as any other actor — it is not part of the kernel.

## Requirements

- Go 1.25 or newer (older toolchains auto-upgrade via the `go` directive).
- PostgreSQL 16+ for persistent mode (`docker compose up -d` provides one).

## Running

```sh
make dev      # start Postgres (docker compose)
make run      # run nexd from source
make build    # compile to ./bin/nexd
make test     # run all tests with the race detector
make test-db  # same, plus Postgres integration tests
make help     # list all targets
```

Prefer everything containerized instead (no local Go/Node/Python
toolchains needed)? `make stack` starts the full dev stack from
`compose.yaml`: Postgres, `nexd`, the web frontend (Vite dev server),
and `ai-gateway` (see `ai-gateway/README.md`). `make stack-down` stops
it. Don't run `dev`+`run` and `stack` at the same time — both try to
bind port 8080.

Without `NEX_DATABASE_URL` the service runs in **in-memory mode** (no
persistence) — handy for a quick look, not for real use. With a database
URL set, `nexd` applies embedded SQL migrations automatically on startup.

Administrative subcommands:

```sh
nexd migrate                      # apply migrations and exit
nexd tenant create <slug> <name>  # register an organization
nexd user create --tenant <slug> --email <email> [--name <n>] [--role admin]
                                  # password: NEX_USER_PASSWORD or generated
```

## Authentication

Server-side sessions (ADR-004): `POST /api/v1/auth/login` with
`{"tenant": "<slug>", "email": "...", "password": "..."}` sets an
httpOnly `nex_session` cookie; `GET /api/v1/auth/me` returns the current
user; `POST /api/v1/auth/logout` revokes the session instantly. Passwords
are stored as argon2id hashes, session tokens as sha256 hashes. Login
attempts are rate-limited and audited. In development, `X-Dev-*` headers
remain available as a shortcut alongside real sessions.

Once running, the liveness endpoint is available:

```sh
curl http://localhost:8080/healthz
# {"status":"ok"}
```

## Configuration

All configuration is read from the environment at startup (12-factor). Every
variable is optional and falls back to a sensible default.

| Variable                    | Default        | Description                                        |
| --------------------------- | -------------- | -------------------------------------------------- |
| `NEX_ENV`                   | `development`  | `development` or `production`.                     |
| `NEX_HTTP_ADDR`             | `:8080`        | TCP address the HTTP server listens on.            |
| `NEX_HTTP_READ_TIMEOUT`     | `10s`          | Max time to read a request.                        |
| `NEX_HTTP_WRITE_TIMEOUT`    | `15s`          | Max time to write a response.                      |
| `NEX_HTTP_IDLE_TIMEOUT`     | `60s`          | Max idle time for keep-alive connections.          |
| `NEX_HTTP_SHUTDOWN_TIMEOUT` | `15s`          | Grace period for in-flight requests on shutdown.   |
| `NEX_LOG_LEVEL`             | `info`         | `debug`, `info`, `warn` or `error`.                |
| `NEX_LOG_FORMAT`            | env-dependent  | `json` or `text` (defaults: text in dev, json in prod). |
| `NEX_DATABASE_URL`          | *(empty)*      | PostgreSQL DSN. Empty = in-memory mode (no persistence). |
| `NEX_SESSION_TTL`           | `168h`         | Session (and cookie) lifetime. Sessions are sliding: any authenticated request in the second half of the TTL extends it by a full TTL. |
| `NEX_CORS_ORIGINS`          | *(empty)*      | Comma-separated browser origins allowed to call the API with credentials (e.g. the Vercel frontend). Empty = same-origin only. The same list is the allowlist for the CSRF origin check on mutations. |
| `NEX_COOKIE_SAMESITE`       | auto           | `lax`, `strict` or `none` for the session cookie. Auto: `none` when `NEX_CORS_ORIGINS` is set (cross-origin frontend), `lax` otherwise. `none` forces the `Secure` flag. |

### Cross-origin frontend (Vercel + separate API host)

Browsers do not attach `SameSite=Lax` cookies to cross-site `fetch` calls, so
a frontend served from another origin loses its session on every page load
unless the backend is configured for it. Set on the backend:

```sh
NEX_CORS_ORIGINS=https://your-app.vercel.app   # exact frontend origin(s)
# NEX_COOKIE_SAMESITE=none  — derived automatically from NEX_CORS_ORIGINS
```

and point the frontend at the API with `VITE_API_URL=https://api.example.com`.
With the same-origin deploy (Caddy in front of both, `VITE_API_URL=/`) no CORS
configuration is needed and the cookie stays `Lax`.

## Project layout

```
cmd/nexd/            Service entry point (composition root, subcommands).
migrations/          SQL migrations (goose), embedded into the binary.
internal/config/     Environment configuration: load + validate.
internal/kernel/     Domain-free core: identity, tenancy, authz,
                     command/event/audit spine.
internal/module/     Domain modules (finance: double-entry ledger).
internal/platform/   Cross-cutting infrastructure adapters.
  httpapi/           Inbound HTTP transport: router, middleware, problem+json.
  logging/           slog construction.
  postgres/          pgx pool, tenant-scoped transactions (RLS), goose
                     migrations, sqlc-generated queries (db/).
api/                 OpenAPI contract and Bruno request collection.
web/                 Frontend prototype (design reference only).
```