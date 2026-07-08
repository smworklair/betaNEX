package finance

import (
	"time"

	"github.com/smworklair/betakis/internal/kernel/event"
)

// EntryPosted — факт: проводка проведена. Когда на вехе M2 появится
// доставка событий (outbox + River), на него подпишутся уведомления
// и пересчёт отчётных витрин.
type EntryPosted struct {
	EntryID string
	At      time.Time
}

// Проверка соответствия контракту событий на этапе компиляции.
var _ event.Event = EntryPosted{}

func (EntryPosted) Name() string            { return "finance.entry.posted" }
func (e EntryPosted) OccurredAt() time.Time { return e.At }
