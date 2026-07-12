// Package api встраивает контракт API (OpenAPI) в бинарник nexd:
// спека раздаётся сервером по GET /api/v1/openapi.yaml и остаётся
// единственным источником истины для клиентов и генераторов.
package api

import _ "embed"

// OpenAPI — содержимое openapi.yaml.
//
//go:embed openapi.yaml
var OpenAPI []byte
