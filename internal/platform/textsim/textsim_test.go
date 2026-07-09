package textsim

import (
	"fmt"
	"math"
	"strings"
	"testing"
)

const work1 = `Целью настоящей выпускной квалификационной работы является
исследование методов автоматизации учёта успеваемости студентов колледжа
на основе современных информационных технологий и веб-платформ.`

// work2 — та же работа с косметическими правками (регистр, пунктуация).
const work2 = `целью настоящей выпускной квалификационной работы является:
исследование методов автоматизации учёта успеваемости студентов колледжа —
на основе современных информационных технологий и веб-платформ!`

const other = `Бухгалтерский учёт материальных запасов на складе предприятия
общественного питания ведётся по фактической себестоимости приобретения
с применением оборотных ведомостей.`

func TestJaccardExact(t *testing.T) {
	if j := Jaccard(work1, work1); j != 1 {
		t.Errorf("Jaccard(сам с собой) = %v, want 1", j)
	}
	if j := Jaccard(work1, work2); j < 0.95 {
		t.Errorf("Jaccard(косметические правки) = %v, want >= 0.95", j)
	}
	if j := Jaccard(work1, other); j > 0.05 {
		t.Errorf("Jaccard(разные темы) = %v, want ~0", j)
	}
}

func TestNormalization(t *testing.T) {
	if j := Jaccard("Учёт УСПЕВАЕМОСТИ студентов", "учет успеваемости студентов"); j != 1 {
		t.Errorf("ё/регистр: Jaccard = %v, want 1", j)
	}
}

func TestMinHashEstimateClosesToExact(t *testing.T) {
	// Составной текст: половина из work1, половина другого содержания.
	mixed := work1 + " " + other

	exact := Jaccard(work1, mixed)
	est := Estimate(Signature(work1, 256), Signature(mixed, 256))
	if math.Abs(exact-est) > 0.12 {
		t.Errorf("MinHash-оценка %v далека от точной %v", est, exact)
	}

	if e := Estimate(Signature(work1, 128), Signature(work1, 128)); e != 1 {
		t.Errorf("оценка(сам с собой) = %v, want 1", e)
	}
}

func TestSignatureDeterministic(t *testing.T) {
	a := Signature(work1, 64)
	b := Signature(work1, 64)
	for i := range a {
		if a[i] != b[i] {
			t.Fatal("сигнатура недетерминирована")
		}
	}
}

func TestEmptyAndShort(t *testing.T) {
	if j := Jaccard("", ""); j != 1 {
		t.Errorf("два пустых текста: %v, want 1", j)
	}
	if j := Jaccard("", work1); j != 0 {
		t.Errorf("пустой против текста: %v, want 0", j)
	}
	if got := len(Shingles("два слова", 3)); got != 1 {
		t.Errorf("короткий текст должен дать один шингл, got %d", got)
	}
}

func BenchmarkSignature(b *testing.B) {
	// ~40 КБ текста — типичная глава ВКР.
	text := strings.Repeat(work1+" "+other+" ", 100)
	b.ReportAllocs()
	for i := 0; b.Loop(); i++ {
		_ = Signature(fmt.Sprintf("%d %s", i, text), DefaultSignature)
	}
}
