package audit

import "context"

// Дифф течёт от хендлера команды к записи журнала через контекст: шина
// кладёт коллектор перед исполнением (WithCollector), хендлер сообщает
// изменения (SetDiff), шина забирает их в Entry (CollectedDiff). Хендлер
// не знает о шине, шина — о структуре доменных данных.

// collector — изменяемая ячейка диффа в контексте запроса.
type collector struct{ diff Diff }

type collectorKey struct{}

// WithCollector возвращает контекст, готовый принять дифф команды.
// Вызывается шиной перед исполнением хендлера.
func WithCollector(ctx context.Context) context.Context {
	return context.WithValue(ctx, collectorKey{}, &collector{})
}

// SetDiff сообщает изменения исполняемой команды. Без коллектора в
// контексте (прямой вызов вне шины) — no-op. Повторный вызов замещает
// дифф целиком: последний снимок и есть итог команды.
func SetDiff(ctx context.Context, d Diff) {
	if c, ok := ctx.Value(collectorKey{}).(*collector); ok {
		c.diff = d
	}
}

// CollectedDiff возвращает дифф, собранный за время исполнения команды.
func CollectedDiff(ctx context.Context) Diff {
	if c, ok := ctx.Value(collectorKey{}).(*collector); ok {
		return c.diff
	}
	return nil
}
