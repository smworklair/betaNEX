# Сборка веб-фронтенда NEX: multi-stage — Vite build в Node, раздача
# статики в Nginx. Контекст сборки — КОРЕНЬ репозитория (не web/), т.к.
# зависимости разрешаются через pnpm-workspace (pnpm-workspace.yaml,
# pnpm-lock.yaml лежат в корне — см. compose.yaml, сервис web):
#   docker build -f web/Dockerfile -t nex-web .
# Запуск:
#   docker run --rm -p 8080:80 nex-web
#
# Это самостоятельная альтернатива ручному раннбуку (deploy/README.md,
# шаг 2: "собрать web/dist и отдать его Caddy как volume") — тот же
# build, упакованный в образ. Существующий раннбук им не заменяется.

# --- Этап 1: сборка --------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

# corepack — тот же pnpm, что зафиксирован в package.json:packageManager,
# без отдельной установки.
RUN corepack enable

# Манифесты — отдельным слоем: пока они не меняются, docker не
# переустанавливает зависимости при каждой правке кода.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/package.json
RUN pnpm install --frozen-lockfile

COPY web ./web

# VITE_* встраиваются в бандл НА ЭТАПЕ СБОРКИ (Vite), не в рантайме —
# см. deploy/README.md, шаг 2. Дефолты ниже соответствуют деплою за
# общим origin (edge-прокси проксирует /api на nexd, сам этот контейнер
# отдаёт только статику); для другой топологии (например, API на другом
# origin) пересоберите с другими --build-arg.
ARG VITE_API_URL=/
ARG VITE_AI_ENABLED=1
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_AI_ENABLED=${VITE_AI_ENABLED}
RUN pnpm -C web build

# --- Этап 2: рантайм --------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost/healthz >/dev/null || exit 1
