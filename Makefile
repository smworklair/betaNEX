# Developer tasks for the NEX backend (nexd).
# Run `make help` to list available targets.

BINARY := nexd
PKG := ./...
DATABASE_URL ?= postgres://nex:nex@localhost:5432/nex?sslmode=disable
SQLC_VERSION := v1.29.0

.DEFAULT_GOAL := help
.PHONY: help build run test test-db vet fmt tidy lint clean dev dev-down watch migrate sqlc

# Show the available targets.
help:
	@echo "NEX backend — make targets:"
	@echo "  build         Compile the nexd binary into ./bin"
	@echo "  run           Run nexd from source"
	@echo "  watch         Run nexd with hot-reload (air)"
	@echo "  dev           Start dev environment (docker compose: postgres)"
	@echo "  dev-down      Stop dev environment"
	@echo "  test          Run all tests with the race detector"
	@echo "  test-db       Run tests including Postgres integration (needs DATABASE_URL)"
	@echo "  migrate       Apply pending SQL migrations (nexd migrate)"
	@echo "  sqlc          Generate type-safe query code from SQL"
	@echo "  vet           Run go vet"
	@echo "  fmt           Format all Go source with gofmt"
	@echo "  tidy          Reconcile go.mod / go.sum"
	@echo "  lint          Static checks (golangci-lint, fallback: go vet)"
	@echo "  clean         Remove build artifacts"

# Compile the nexd binary into ./bin.
build:
	go build -o bin/$(BINARY) ./cmd/nexd

# Run nexd from source.
run:
	go run ./cmd/nexd

# Run nexd with hot-reload (requires air: go install github.com/air-verse/air@latest).
watch:
	air

# Start the local dev environment (Postgres).
dev:
	docker compose up -d --wait

# Stop the local dev environment.
dev-down:
	docker compose down

# Run all tests with the race detector.
test:
	go test -race $(PKG)

# Run all tests including Postgres integration tests.
test-db:
	NEX_TEST_DATABASE_URL="$(DATABASE_URL)" go test -race $(PKG)

# Apply pending SQL migrations to DATABASE_URL.
migrate:
	NEX_DATABASE_URL="$(DATABASE_URL)" go run ./cmd/nexd migrate

# Generate type-safe query code from SQL (sqlc).
sqlc:
	go run github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION) generate

# Run go vet across the module.
vet:
	go vet $(PKG)

# Format all Go source in place.
fmt:
	gofmt -w .

# Reconcile go.mod and go.sum with the source.
tidy:
	go mod tidy

# Static checks: golangci-lint if installed, otherwise go vet.
lint:
	@command -v golangci-lint >/dev/null 2>&1 && golangci-lint run || go vet $(PKG)

# Remove build artifacts.
clean:
	rm -rf bin
