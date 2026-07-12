package audit_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/smworklair/betakis/internal/kernel/audit"
)

func TestMemoryRecorder(t *testing.T) {
	rec := &audit.MemoryRecorder{}
	e := audit.Entry{
		Command: "tasks.create", Outcome: audit.OutcomeOK,
		ActorID: "user-1", TenantID: "tenant-1",
		OccurredAt: time.Now().UTC(),
	}
	if err := rec.Record(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	got := rec.Entries()
	if len(got) != 1 || !reflect.DeepEqual(got[0], e) {
		t.Fatalf("Entries() = %+v, ожидалась одна запись %+v", got, e)
	}

	// Entries отдаёт копию: мутация результата не трогает журнал.
	got[0].Command = "испорчено"
	if fresh := rec.Entries(); fresh[0].Command != "tasks.create" {
		t.Errorf("журнал изменился через возвращённый срез: %+v", fresh[0])
	}
}

// Recorder используется из конкурентных запросов — гонок быть не должно
// (проверяется race-детектором: make test).
func TestMemoryRecorderConcurrent(t *testing.T) {
	rec := &audit.MemoryRecorder{}
	const n = 50
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = rec.Record(context.Background(), audit.Entry{
				Command: fmt.Sprintf("cmd-%d", i),
				Outcome: audit.OutcomeOK,
			})
			_ = rec.Entries()
		}()
	}
	wg.Wait()
	if got := len(rec.Entries()); got != n {
		t.Errorf("записей %d, ожидалось %d", got, n)
	}
}

func TestSlogRecorder(t *testing.T) {
	var buf bytes.Buffer
	rec := audit.NewSlogRecorder(slog.New(slog.NewJSONHandler(&buf, nil)))
	err := rec.Record(context.Background(), audit.Entry{
		Command: "finance.post", Outcome: audit.OutcomeDenied,
		ActorID: "user-2", TenantID: "tenant-1", Detail: "нет права",
		OccurredAt: time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatal(err)
	}
	var line map[string]any
	if err := json.Unmarshal(buf.Bytes(), &line); err != nil {
		t.Fatalf("лог не является JSON-строкой: %v; %s", err, buf.Bytes())
	}
	for key, want := range map[string]string{
		"command": "finance.post", "outcome": "denied",
		"actor_id": "user-2", "tenant_id": "tenant-1", "detail": "нет права",
	} {
		if line[key] != want {
			t.Errorf("%s = %v, ожидалось %q", key, line[key], want)
		}
	}
}
