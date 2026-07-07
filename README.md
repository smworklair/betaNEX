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

- Go 1.24 or newer.

## Running

```sh
make run      # run nexd from source
make build    # compile to ./bin/nexd
make test     # run all tests with the race detector
make help     # list all targets
```

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

## Project layout

```
cmd/nexd/            Service entry point (composition root).
internal/config/     Environment configuration: load + validate.
internal/kernel/     Domain-free core (skeleton): identity, tenancy, authz,
                     command/event/audit spine. Implemented in M2-M4.
internal/module/     Domain modules (empty until M6).
internal/platform/   Cross-cutting infrastructure adapters.
  httpapi/           Inbound