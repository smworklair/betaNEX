// Package textsim — сходство текстов для проверки работ на заимствования:
// шинглы (n-граммы слов) + MinHash + коэффициент Жаккара. Это обычный
// алгоритм на CPU, не AI: не требует ни embeddings, ни внешних API —
// сверка идёт по локальному корпусу прошлых работ (семантическая
// проверка через RAG — отдельный, платный контур; см. go-guide §18).
//
// Использование: для каждой работы один раз считается сигнатура
// (Signature) и сохраняется; проверка новой работы — сравнение её
// сигнатуры со всеми сохранёнными (Estimate — O(k) на пару). Точная
// доля общих шинглов для пары кандидатов — Jaccard.
package textsim

import (
	"hash/fnv"
	"strings"
	"unicode"
)

// DefaultShingle — длина шингла в словах. Три слова — устойчивый
// компромисс: короче — много ложных совпадений на общих оборотах,
// длиннее — пропускаются перефразировки.
const DefaultShingle = 3

// DefaultSignature — размер MinHash-сигнатуры. 128 хэшей дают
// погрешность оценки Жаккара ~±9% — достаточно для отбора кандидатов
// на ручную проверку.
const DefaultSignature = 128

// normalize приводит текст к сравнимому виду: нижний регистр, только
// буквы и цифры, одиночные пробелы. «Ё» схлопывается в «е».
func normalize(text string) []string {
	var b strings.Builder
	for _, r := range strings.ToLower(text) {
		switch {
		case r == 'ё':
			b.WriteRune('е')
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
		default:
			b.WriteRune(' ')
		}
	}
	return strings.Fields(b.String())
}

// Shingles возвращает множество хэшей n-грамм слов текста.
func Shingles(text string, n int) map[uint64]struct{} {
	if n <= 0 {
		n = DefaultShingle
	}
	words := normalize(text)
	out := make(map[uint64]struct{})
	if len(words) < n {
		if len(words) == 0 {
			return out
		}
		out[hashShingle(words)] = struct{}{}
		return out
	}
	for i := 0; i+n <= len(words); i++ {
		out[hashShingle(words[i:i+n])] = struct{}{}
	}
	return out
}

func hashShingle(words []string) uint64 {
	h := fnv.New64a()
	for _, w := range words {
		_, _ = h.Write([]byte(w))
		_, _ = h.Write([]byte{0})
	}
	return h.Sum64()
}

// Jaccard — точный коэффициент Жаккара по множествам шинглов двух
// текстов: |A∩B| / |A∪B|. O(|A|+|B|), для пары кандидатов — дёшево.
func Jaccard(a, b string) float64 {
	sa, sb := Shingles(a, DefaultShingle), Shingles(b, DefaultShingle)
	if len(sa) == 0 && len(sb) == 0 {
		return 1
	}
	inter := 0
	for s := range sa {
		if _, ok := sb[s]; ok {
			inter++
		}
	}
	union := len(sa) + len(sb) - inter
	if union == 0 {
		return 0
	}
	return float64(inter) / float64(union)
}

// Signature — MinHash-сигнатура текста: k минимумов независимых
// хэш-функций по множеству шинглов. Сигнатуры компактны (k×8 байт)
// и сравниваются за O(k) без самих текстов.
func Signature(text string, k int) []uint64 {
	if k <= 0 {
		k = DefaultSignature
	}
	shingles := Shingles(text, DefaultShingle)
	sig := make([]uint64, k)
	for i := range sig {
		sig[i] = ^uint64(0)
	}
	if len(shingles) == 0 {
		return sig
	}
	for s := range shingles {
		for i := range sig {
			// Семейство хэшей: splitmix64 от (шингл XOR соль_i).
			// Детерминировано между запусками и версиями Go.
			h := splitmix64(s ^ salt(i))
			if h < sig[i] {
				sig[i] = h
			}
		}
	}
	return sig
}

// Estimate — оценка коэффициента Жаккара по двум сигнатурам: доля
// совпавших позиций. Сигнатуры должны быть одной длины.
func Estimate(a, b []uint64) float64 {
	if len(a) == 0 || len(a) != len(b) {
		return 0
	}
	eq := 0
	for i := range a {
		if a[i] == b[i] {
			eq++
		}
	}
	return float64(eq) / float64(len(a))
}

// salt порождает детерминированную соль для i-й хэш-функции.
func salt(i int) uint64 {
	return splitmix64(0x9E3779B97F4A7C15 * (uint64(i) + 1)) // #nosec G115 -- i >= 0 (индекс сигнатуры)
}

// splitmix64 — быстрый качественный миксер (Steele et al.).
func splitmix64(x uint64) uint64 {
	x += 0x9E3779B97F4A7C15
	x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9
	x = (x ^ (x >> 27)) * 0x94D049BB133111EB
	return x ^ (x >> 31)
}
