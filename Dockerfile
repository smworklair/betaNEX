# Сборка nexd: статический бинарник в distroless-образе (ADR-018).
# Сборка:  docker build -t nexd .
# Запуск:  docker run --rm -p 8080:8080 nexd

# --- Этап 1: сборка -----------------------------------------------------
FROM golang:1.25-alpine AS build

WORKDIR /src

# Зависимости кэшируются отдельным слоем: пока go.mod не меняется,
# docker не перекачивает модули при каждой правке кода.
COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/nexd ./cmd/nexd

# Каталог для NEX_DATA_DIR (файловое хранилище сканов): создаём и
# отдаём владельцу nonroot (65532:65532) ЗДЕСЬ, в build-стадии, где ещё
# есть shell — у distroless/static его нет, там нечем сделать mkdir/chown.
# Если поверх /data примонтировать именованный docker-том, Docker при
# первой инициализации скопирует в него содержимое (и права) из образа —
# поэтому именно так, а не отдельным mkdir в рантайме, /data остаётся
# доступным на запись процессу nonroot и с volume, и без него.
RUN mkdir -p /out/data && chown 65532:65532 /out/data

# --- Этап 2: рантайм ------------------------------------------------------
# distroless/static: нет shell, пакетного менеджера и лишней поверхности
# атаки; nonroot — процесс не работает от root.
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/nexd /nexd
COPY --from=build --chown=65532:65532 /out/data /data

ENV NEX_ENV=production
EXPOSE 8080
USER nonroot

ENTRYPOINT ["/nexd"]
