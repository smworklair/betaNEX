# Сборка nexd: статический бинарник в distroless-образе (ADR-018).
# Сборка:  docker build -t nexd .
# Запуск:  docker run --rm -p 8080:8080 nexd

# --- Этап 1: сборка -----------------------------------------------------
FROM golang:1.24-alpine AS build

WORKDIR /src

# Зависимости кэшируются отдельным слоем: пока go.mod не меняется,
# docker не перекачивает модули при каждой правке кода.
COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/nexd ./cmd/nexd

# --- Этап 2: рантайм ------------------------------------------------------
# distroless/static: нет shell, пакетного менеджера и лишней поверхности
# атаки; nonroot — процесс не работает от root.
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/nexd /nexd

ENV NEX_ENV=production
EXPOSE 8080
USER nonroot

ENTRYPOINT ["/nexd"]
