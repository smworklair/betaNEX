# NEX — Учебные ресурсы

Приоритет — официальная документация. Ресурсы сгруппированы по стеку проекта (см. `docs/tech-stack.md`). Пометка 🇷🇺 — материал на русском.

## Go

**Официальное:**
- [A Tour of Go](https://go.dev/tour/) — интерактивное введение; начать отсюда.
- [Effective Go](https://go.dev/doc/effective_go) — идиомы языка от авторов.
- [Go Documentation](https://go.dev/doc/) и [стандартная библиотека](https://pkg.go.dev/std) — pkg.go.dev как основной справочник.
- [The Go Blog](https://go.dev/blog/) — статьи ядра команды: контексты, ошибки, дженерики, роутинг в 1.22.
- [Go Wiki: Code Review Comments](https://go.dev/wiki/CodeReviewComments) — что скажут на ревью.

**Стайлгайды:**
- [Google Go Style Guide](https://google.github.io/styleguide/go/) — самый полный.
- [Uber Go Style Guide](https://github.com/uber-go/guide) — практичный, с примерами «плохо/хорошо». Есть 🇷🇺 [перевод](https://github.com/sau00/uber-go-guide-ru).

**Книги:**
- Alex Edwards — [Let's Go](https://lets-go.alexedwards.net/) и [Let's Go Further](https://lets-go-further.alexedwards.net/) — веб-сервисы на stdlib net/http, ровно наш подход (сессии, middleware, Postgres). Лучшее вложение времени для этого проекта.
- Teiva Harsanyi — [100 Go Mistakes and How to Avoid Them](https://100go.co/) — сайт бесплатный; типовые ошибки.
- Donovan, Kernighan — «The Go Programming Language» — фундамент языка.

**Видео/блоги:**
- [Ardan Labs blog](https://www.ardanlabs.com/blog/) и их YouTube — внутренности Go, дизайн сервисов.
- [Dave Cheney](https://dave.cheney.net/) — классика: ошибки, производительность, SOLID в Go.
- [threedots.tech](https://threedots.tech/) — DDD, чистая архитектура и модульные монолиты на Go; прямо по теме kernel/modules.
- [brandur.org](https://brandur.org/) — Postgres+Go в проде, автор River.
- 🇷🇺 YouTube «Николай Тузов — Golang» — качественные разборы языка на русском.

## PostgreSQL

- [Официальная документация](https://www.postgresql.org/docs/current/) — эталон технической документации.
- 🇷🇺 [postgrespro.ru/docs](https://postgrespro.ru/docs/postgresql) — официальный перевод документации Postgres на русский от Postgres Professional.
- 🇷🇺 Егор Рогов — «PostgreSQL изнутри» ([бесплатный PDF](https://postgrespro.ru/education/books/internals)) — устройство СУБД.
- [Row-Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) — основа нашей multi-tenancy.
- [The Art of PostgreSQL](https://theartofpostgresql.com/) (Dimitri Fontaine) — SQL-first мышление, идеология sqlc.
- [Use The Index, Luke](https://use-the-index-luke.com/) — индексы и производительность запросов; есть русская версия страниц.

## Инструменты backend-стека

- [sqlc docs](https://docs.sqlc.dev/) — генерация типобезопасного кода из SQL.
- [pgx](https://github.com/jackc/pgx) — драйвер; README + wiki.
- [goose](https://github.com/pressly/goose) — миграции.
- [River docs](https://riverqueue.com/docs) — фоновые задачи; статья автора [«Transactionally staged job drains»](https://brandur.org/job-drain) объясняет, почему очередь в Postgres.
- [oapi-codegen](https://github.com/oapi-codegen/oapi-codegen) — сервер из OpenAPI.
- [OpenAPI Specification 3.1](https://spec.openapis.org/oas/v3.1.0) и [учебник от Swagger](https://swagger.io/docs/specification/about/).
- [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457) — формат ошибок API.
- [log/slog guide](https://go.dev/blog/slog) — официальный разбор структурного логирования.

## Архитектура

- [The Twelve-Factor App](https://12factor.net/ru/) — 🇷🇺 есть русская версия; уже применяется в конфиге NEX.
- Kamil Grzybek — [Modular Monolith series](https://www.kamilgrzybek.com/blog/posts/modular-monolith-primer) — теоретическая база нашей архитектуры.
- Vlad Khononov — «Learning Domain-Driven Design» (O'Reilly) — компактное введение в DDD; есть русское издание («Изучаем DDD»).
- [Go Wiki: Server program structure](https://go.dev/doc/modules/layout) — официальные рекомендации по layout.
- Ben Johnson — [Standard Package Layout](https://www.gobeyond.dev/standard-package-layout/) — зависимости внутрь, как в NEX.

## Безопасность

- [OWASP Application Security Verification Standard (ASVS)](https://owasp.org/www-project-application-security-verification-standard/) — чеклист перед продом.
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) — особенно Password Storage (argon2id), Session Management, Authorization.
- [OWASP Top 10](https://owasp.org/www-project-top-ten/) — минимальный ликбез для всей команды.

## Frontend

**Официальное:**
- [react.dev](https://react.dev/learn) — новая документация React; учить по ней, не по устаревшим курсам. Частичный 🇷🇺 перевод: [ru.react.dev](https://ru.react.dev/).
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) + [Total TypeScript](https://www.totaltypescript.com/) (бесплатные основы) — типы всерьёз.
- [TanStack Query docs](https://tanstack.com/query/latest) и [TanStack Router docs](https://tanstack.com/router/latest) — читать разделы про кэширование и search params целиком.
- [Zustand docs](https://zustand.docs.pmnd.rs/).
- [Tailwind CSS v4 docs](https://tailwindcss.com/docs).
- [shadcn/ui docs](https://ui.shadcn.com/docs) и [Radix Primitives](https://www.radix-ui.com/primitives) — доступность компонентов.
- [React Hook Form](https://react-hook-form.com/) и [Zod](https://zod.dev/).
- [Vite docs](https://vite.dev/guide/).

**Дополнительно:**
- [TkDodo's blog](https://tkdodo.eu/blog/) — мейнтейнер TanStack Query; серия «Practical React Query» обязательна.
- [Josh Comeau](https://www.joshwcomeau.com/) — CSS и React с интерактивными объяснениями.
- [web.dev](https://web.dev/learn) — производительность и основы платформы от Google.

## DevOps и тестирование

- [Docker docs](https://docs.docker.com/) — multi-stage builds, Compose.
- [GitHub Actions docs](https://docs.github.com/actions).
- [Caddy docs](https://caddyserver.com/docs/) — reverse proxy + авто-TLS.
- [Prometheus](https://prometheus.io/docs/), [Grafana](https://grafana.com/docs/), [Loki](https://grafana.com/docs/loki/latest/).
- [testcontainers-go](https://golang.testcontainers.org/) — интеграционные тесты с реальным Postgres.
- [Playwright docs](https://playwright.dev/docs/intro) — e2e.
- [Vitest docs](https://vitest.dev/guide/).
- [k6 docs](https://grafana.com/docs/k6/latest/) — нагрузочное тестирование.
- Официальный Go: [обзор тестирования и fuzzing](https://go.dev/doc/security/fuzz/), таблица-driven tests в [Go Wiki](https://go.dev/wiki/TableDrivenTests).

## Как читать этот список

1. Сейчас (пока пишем kernel): Let's Go + Let's Go Further, документация sqlc/pgx/goose, глава про RLS.
2. Перед вехой API: OpenAPI-учебник, RFC 9457, oapi-codegen README.
3. Перед фронтенд-вехой: react.dev целиком, Practical React Query, доки TanStack Router.
4. Перед продом: OWASP ASVS, доки Caddy/Prometheus, testcontainers.
