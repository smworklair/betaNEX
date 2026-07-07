# NEX — Технологический стек

Дата: 2026-07-08. Статус: принято. Обоснования каждого решения — в [decision-log.md](decision-log.md).

Принцип: **backend — ядро продукта** (модульный монолит на Go), frontend — тонкий клиент поверх API. Минимум зависимостей, скучные проверенные технологии, всё заменяемое.

## Backend

| Область | Выбор |
|---|---|
| Язык | Go 1.24+ (уже принято) |
| Framework | Стандартная библиотека: `net/http` + `ServeMux` (Go 1.22+ method routing) — без фреймворка |
| API-архитектура | REST + JSON, контракт OpenAPI 3.1, кодогенерация `oapi-codegen`, ошибки в формате RFC 9457 (`application/problem+json`) |
| Аутентификация | Собственная identity в kernel: argon2id, opaque session-токены (server-side), refresh-ротация; позже — федерация OIDC |
| Авторизация | Собственный RBAC в kernel (роли → права, скоупы per-tenant), enforcement в command-слое |
| ORM | Без ORM: `sqlc` (типобезопасная кодогенерация из SQL) + драйвер `pgx/v5` |
| Миграции | `goose` (SQL-файлы, embed в бинарник) |
| База данных | PostgreSQL 17; multi-tenancy: `tenant_id` + Row-Level Security |
| Кэширование | Этап 1: in-process (`ristretto`/`otter`); этап 2: Valkey — только когда появится второй инстанс |
| Фоновые задачи | River (очередь поверх Postgres, транзакционный enqueue) |
| Логирование | `log/slog` (уже есть): text в dev, JSON в prod; trace-id в каждой записи |
| Валидация | На границе API — из OpenAPI-схемы; инварианты домена — в конструкторах команд (вручную) |
| Конфигурация | Env-переменные, 12-factor (уже есть) |
| Наблюдаемость | OpenTelemetry (трейсы) + Prometheus-метрики (`/metrics`) |

## Frontend

| Область | Выбор |
|---|---|
| Framework | React 19 + TypeScript + Vite (уже есть); SPA, без SSR |
| State management | TanStack Query (серверное состояние) + Zustand (клиентское UI-состояние) |
| Routing | TanStack Router (полная типизация путей, params, loaders) |
| Styling | Tailwind CSS v4 (уже есть) |
| UI-библиотека | shadcn/ui (Radix-примитивы, код копируется в проект) |
| Иконки | lucide-react (уже есть) |
| Анимации | Motion (бывш. Framer Motion, уже есть) — экономно |
| Формы | React Hook Form + `@hookform/resolvers` |
| Валидация данных | Zod (схемы шарятся между формами и API-клиентом) |
| API-клиент | Генерация из OpenAPI: `openapi-typescript` + `openapi-fetch` — единый контракт с бэкендом |
| Таблицы/графики | TanStack Table; Chart.js (уже есть) |
| Даты | `date-fns` |
| i18n | `react-i18next` (интерфейс RU, закладываемся на EN) |

## DevOps

| Область | Выбор |
|---|---|
| Пакетный менеджер | Go modules; frontend — pnpm (вместо npm) |
| Сборка | Backend: `make` (уже есть), один статический бинарник; frontend: Vite |
| Docker | Multi-stage: `golang:1.24 → gcr.io/distroless/static`; фронт раздаётся Caddy; `compose.yaml` для dev (postgres, valkey) |
| CI/CD | GitHub Actions: lint → test (race) → build → образ в GHCR → deploy по тегу |
| Deployment | Этап 1: один VPS, Docker Compose + Caddy (авто-TLS); Kubernetes — только при реальной необходимости |
| Мониторинг | Prometheus + Grafana + Loki (логи); ошибки — GlitchTip (self-hosted Sentry API); аптайм — Uptime Kuma |
| Линтеры | Go: `golangci-lint` + `gofumpt`; TS: Biome (lint + format одним инструментом) |
| Тестирование | Пирамида: unit (`go test -race`, Vitest) → integration (testcontainers-go, реальный Postgres) → e2e (Playwright) → нагрузочное (k6, перед релизом) |
| Секреты | Dev: `.env` (в gitignore); prod: env через systemd/compose, позже SOPS |
| Бэкапы | `pg_dump` ежедневно + WAL-архив (pgBackRest), офсайт-копия |

## Структура репозитория (целевая)

```
/cmd/nexd/          — entrypoint (есть)
/internal/kernel/   — identity, tenancy, authz, commands/events/audit
/internal/module/   — доменные модули (college, ...)
/internal/platform/ — httpapi, logging, postgres, jobs (есть частично)
/migrations/        — SQL-миграции goose
/api/               — openapi.yaml (источник истины контракта)
/web/               — frontend (перенести из src/ + index.html)
/docs/              — эта документация
/learning/          — учебные материалы
```
