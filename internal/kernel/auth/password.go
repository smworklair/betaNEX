package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Параметры argon2id — актуальная рекомендация OWASP Password Storage
// Cheat Sheet: 19 МиБ памяти, 2 итерации, 1 поток.
const (
	argonMemoryKiB = 19 * 1024
	argonTime      = 2
	argonThreads   = 1
	argonSaltLen   = 16
	argonKeyLen    = 32
)

// ErrHashFormat — хэш в БД не является корректной PHC-строкой argon2id.
var ErrHashFormat = errors.New("auth: malformed password hash")

// HashPassword хэширует пароль argon2id и возвращает PHC-строку вида
// $argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>. Параметры внутри
// строки позволяют менять стоимость хэширования без миграции данных.
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("auth: salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemoryKiB, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemoryKiB, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// VerifyPassword сравнивает пароль с PHC-хэшем за постоянное время.
// Возвращает true при совпадении; ошибку — только при кривом хэше.
func VerifyPassword(password, phc string) (bool, error) {
	parts := strings.Split(phc, "$")
	// ["", "argon2id", "v=19", "m=...,t=...,p=...", salt, hash]
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, ErrHashFormat
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, ErrHashFormat
	}
	var memory, time uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads); err != nil {
		return false, ErrHashFormat
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, ErrHashFormat
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) == 0 || len(want) > 512 {
		return false, ErrHashFormat
	}
	got := argon2.IDKey([]byte(password), salt, time, memory, threads, uint32(len(want))) // #nosec G115 -- длина ограничена проверкой выше (0 < len <= 512)
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}
