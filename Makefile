# Developer tasks for the NEX backend (nexd).
# Run `make help` to list available targets.

BINARY := nexd
PKG := ./...

.DEFAULT_GOAL := help
.PHONY: help build run test vet fmt tidy lint clean dev dev-down watch migrate migrate-down sqlc

# Show the available targets.
help:
	@echo "NEX backend — make targets:"
	@echo "  build         Compile the nexd binary into ./bin"
	@echo "  run           Run nexd from source"
	@echo "  watch         Run nexd with hot-reload (air)"
	@echo "  dev           Start dev environment (docker compose: postgres)"
	@echo "  dev-down      Stop dev environment"
	@echo "  test          Run all tests with the race detector"
	@echo "  migrate       Apply pending SQL migrations (goose)"
	@echo "  migrate-down  Roll back the latest migration"
	@echo "  sqlc          Generate type-safe query code from SQL"
	@echo "  vet           Run go vet"
	@echo "  fmt           Format all Go source with gofmt"
	@echo "  tidy          Reconcile go.mod / go.sum"
	@echo "  lint          Static checks (golangci-lint, fallback: go vet)"
	@echo "  clean         Remove build artifacts"

# Compile the nexd binary into ./bin.
build:
	go bu