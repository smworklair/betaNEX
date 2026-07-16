# Раннбук: деплой NEX на свой сервер

Прод-стек: **Caddy** (reverse-proxy + автоматический TLS) → **nexd** (Go,
образ из GHCR) и **ai-gateway** (Python, собирается из исходников на
сервере) → **Postgres**. Фронтенд собирается заранее (`vite build`) и
раздаётся Caddy как статика.

Это ручной раннбук для одного VPS — автодеплоя по git-тегу из CI,
бэкапов и наблюдаемости здесь нет (см. `docs/roadmap.md`, вехи M9-М11).

## 0. Требования к серверу

- Docker + Docker Compose plugin.
- DNS-запись домена указывает на этот сервер (A/AAAA-запись).
- Открыты порты 80 и 443 (для HTTP-01 challenge и самого трафика).

## 1. Склонировать репозиторий и настроить секреты

```sh
git clone <repo-url> nex && cd nex
cp deploy/.env.example deploy/.env
# отредактируйте deploy/.env: NEX_DOMAIN, POSTGRES_PASSWORD,
# NEX_DATABASE_URL (тот же пароль), хотя бы один ключ ai-gateway
# (см. ai-gateway/.env.example за полным списком провайдеров)
```

`deploy/.env` — секреты, в git не попадает (см. `.gitignore`). Без
хотя бы одного заполненного ключа провайдера `ai-gateway` не запустится
(см. `ai-gateway/README.md`) — либо на время первого деплоя поставьте
`GIGACHAT_MOCK=true`, чтобы поднять стек без реальных ключей.

## 2. Собрать фронтенд

Vite встраивает переменные `VITE_*` в бандл НА ЭТАПЕ СБОРКИ — в проде
фронтенд и оба бэкенда должны быть одним origin (Caddy проксирует
`/api/*` в `nexd` и `/ai/*` в `ai-gateway`, см. `Caddyfile`), поэтому:

```sh
cd web
VITE_API_URL=/ VITE_AI_GATEWAY_URL=/ai pnpm install --frozen-lockfile && pnpm build
cd ..
rm -rf deploy/web-dist && cp -r web/dist deploy/web-dist
```

(`deploy/web-dist/` — в `.gitignore`, пересобирается на каждый деплой;
на CI-конвейере этот шаг будет отдельной джобой — сейчас делается руками.)

## 3. Поднять стек

```sh
cd deploy
docker compose -f compose.prod.yaml up -d --build
docker compose -f compose.prod.yaml ps
```

`ai-gateway` собирается на сервере (`build: ../ai-gateway`); `nexd` —
готовый образ `ghcr.io/smworklair/nex:latest` (публикуется CI по
git-тегу — если тега/образа ещё нет, замените на `build: context: ..`
временно). `--build` можно опускать на повторных деплоях, если менялся
только код `nexd`/фронтенда — тогда достаточно `docker compose pull &&
docker compose up -d` плюс шаг 2 заново для фронта.

## 4. Проверить

```sh
curl -sI https://<ваш-домен>/healthz          # nexd, через Caddy
curl -s  https://<ваш-домен>/ai/healthz        # ai-gateway, через Caddy
docker compose -f compose.prod.yaml logs -f caddy   # выдача сертификата видна в логах при первом запуске
```

Caddy получает сертификат Let's Encrypt автоматически при первом
запросе к домену — первые секунды может быть недоступен, пока идёт
ACME-challenge; смотрите логи `caddy`, если TLS не поднимается (чаще
всего причина — домен ещё не резолвится на этот сервер).

## 5. Обновление (передеплой)

```sh
git pull
# при изменениях в nexd: дождаться нового образа в GHCR (CI по тегу)
# при изменениях во фронтенде: повторить шаг 2
docker compose -f deploy/compose.prod.yaml up -d --build
```

## Откат

```sh
docker compose -f deploy/compose.prod.yaml down
# вернуть предыдущий web-dist/ (например, из бэкапа шага 2) и/или
# указать в compose.prod.yaml предыдущий тег образа nexd, затем снова up -d
```

## Что важно понимать про этот раннбук

- **Секреты — только `deploy/.env`.** Ничего не хардкожено в
  `compose.prod.yaml`/`Caddyfile` — оба читают переменные окружения.
- **TLS — целиком забота Caddy**, не нужно вручную получать/копировать
  сертификаты; том `caddy_data` хранит их между перезапусками.
- **`ai-gateway` — часть прод-стека**, без него ИИ-функции NEX не
  работают вообще (см. `docs/ai/README.md`).
- **Бэкапов БД здесь нет.** Пока это не сделано (веха M9,
  `docs/roadmap.md`), `pgdata` — единственная копия данных на этом
  сервере. Не используйте для реальных данных до настройки бэкапов.
