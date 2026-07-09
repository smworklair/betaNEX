// Package migrations встраивает SQL-миграции в бинарник nexd, чтобы
// развёртывание было одним файлом: goose применяет их прямо из embed.FS
// (см. internal/platform/postgres.Migrate).
package migrations

import "embed"

// FS содержит все SQL-миграции репозитория.
//
//go:embed *.sql
var FS embed.FS
