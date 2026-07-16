# Сборка ai-gateway: multi-stage, непривилегированный пользователь.
# Сборка:  docker build -t ai-gateway ./ai-gateway
# Запуск:  docker run --rm -p 8090:8090 --env-file ai-gateway/.env ai-gateway
#
# Тот же принцип многоэтапности, что и в корневом Dockerfile (nexd,
# ADR-018): первый слой ставит зависимости и кэшируется, пока не
# меняется requirements.txt; финальный образ не содержит компиляторов
# и прочего, что нужно только на этапе сборки.

# --- Этап 1: сборка зависимостей в venv -----------------------------------
FROM python:3.12-slim AS build

WORKDIR /app

# Зависимости кэшируются отдельным слоем: пока requirements.txt не
# меняется, docker не переустанавливает пакеты при каждой правке кода.
COPY requirements.txt ./
RUN python -m venv /venv \
    && /venv/bin/pip install --no-cache-dir --upgrade pip \
    && /venv/bin/pip install --no-cache-dir -r requirements.txt

# --- Этап 2: рантайм --------------------------------------------------------
FROM python:3.12-slim AS runtime

# curl нужен только для HEALTHCHECK ниже — не тянем ничего лишнего.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Непривилегированный пользователь — процесс не работает от root
# (тот же принцип, что и nonroot в корневом Dockerfile nexd).
RUN groupadd --system app && useradd --system --gid app --home /app app

WORKDIR /app
COPY --from=build /venv /venv
COPY app ./app

# tenants.example.json — не секрет, можно копировать как есть; реальный
# tenants.json (если нужен) монтируется томом при запуске.
COPY tenants.example.json ./

ENV PATH="/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

USER app
EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fsS http://localhost:8090/healthz || exit 1

ENTRYPOINT ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
