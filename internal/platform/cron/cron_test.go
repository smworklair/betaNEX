package cron

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"
)

func testLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestSchedulerRunsAndStops(t *testing.T) {
	s := New(testLog())
	var runs atomic.Int32
	err := s.Add(Job{Name: "tick", Every: 10 * time.Millisecond, Run: func(context.Context) error {
		runs.Add(1)
		return nil
	}})
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Millisecond)
	defer cancel()
	s.Run(ctx) // блокируется до отмены

	if n := runs.Load(); n < 3 {
		t.Errorf("запусков = %d, want >= 3", n)
	}
}

func TestSchedulerSurvivesPanicAndError(t *testing.T) {
	s := New(testLog())
	var after atomic.Int32
	_ = s.Add(Job{Name: "boom", Every: 10 * time.Millisecond, Run: func(context.Context) error {
		if after.Add(1) == 1 {
			panic("boom")
		}
		return errors.New("fail")
	}})

	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	s.Run(ctx)

	if after.Load() < 2 {
		t.Error("паника первой итерации не должна останавливать задачу")
	}
}

func TestAddValidation(t *testing.T) {
	s := New(testLog())
	if err := s.Add(Job{Name: "x", Run: func(context.Context) error { return nil }}); err == nil {
		t.Error("задача без расписания должна отклоняться")
	}
	if err := s.Add(Job{Name: "x", Every: time.Second, At: "03:00", Run: func(context.Context) error { return nil }}); err == nil {
		t.Error("Every и At одновременно должны отклоняться")
	}
	if err := s.Add(Job{Name: "x", At: "25:99", Run: func(context.Context) error { return nil }}); err == nil {
		t.Error("кривое время At должно отклоняться")
	}
}

func TestUntilDaily(t *testing.T) {
	now := time.Date(2026, 7, 9, 10, 0, 0, 0, time.UTC)
	if d := untilDaily(now, "10:30"); d != 30*time.Minute {
		t.Errorf("до 10:30 = %v, want 30m", d)
	}
	if d := untilDaily(now, "09:00"); d != 23*time.Hour {
		t.Errorf("до 09:00 завтра = %v, want 23h", d)
	}
}
