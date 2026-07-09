// Package cron — планировщик фоновых задач внутри процесса nexd:
// ночные пересчёты витрин, чистка истёкших сессий и идемпотентных
// ключей, напоминания. Тикер в горутине вместо внешнего планировщика —
// сознательное решение для монолита в один инстанс (ноль новых
// сервисов); при втором инстансе задачи переедут в River, контракт
// Job при этом не изменится.
package cron

import (
	"context"
	"fmt"
	"log/slog"
	"runtime/debug"
	"sync"
	"sync/atomic"
	"time"
)

// Job — периодическая задача. Задаётся либо интервалом (Every), либо
// временем суток (At, "03:30" по локальному времени сервера) — ровно
// одним из двух.
type Job struct {
	// Name — стабильное имя для логов ("finance.stats.refresh").
	Name string
	// Every — интервал между запусками.
	Every time.Duration
	// At — время суток для ежедневного запуска, "HH:MM".
	At string
	// Run — тело задачи. Обязано уважать ctx.
	Run func(ctx context.Context) error
}

// job — зарегистрированная задача с состоянием исполнения.
type job struct {
	Job
	running atomic.Bool // защита от наложения запусков
}

// Scheduler исполняет зарегистрированные задачи до отмены контекста.
type Scheduler struct {
	log  *slog.Logger
	jobs []*job
}

// New создаёт пустой планировщик.
func New(log *slog.Logger) *Scheduler {
	return &Scheduler{log: log}
}

// Add регистрирует задачу. Вызывается до Run, из композиционного корня.
func (s *Scheduler) Add(j Job) error {
	if j.Name == "" || j.Run == nil {
		return fmt.Errorf("cron: job %q: empty name or nil Run", j.Name)
	}
	if (j.Every > 0) == (j.At != "") {
		return fmt.Errorf("cron: job %s: set exactly one of Every or At", j.Name)
	}
	if j.At != "" {
		if _, err := time.Parse("15:04", j.At); err != nil {
			return fmt.Errorf("cron: job %s: bad At %q: %w", j.Name, j.At, err)
		}
	}
	s.jobs = append(s.jobs, &job{Job: j})
	return nil
}

// Run блокируется до отмены ctx, исполняя задачи по их расписаниям.
// Каждая задача живёт в своей горутине; паника задачи логируется и не
// роняет процесс; наложение запусков одной задачи пропускается.
func (s *Scheduler) Run(ctx context.Context) {
	var wg sync.WaitGroup
	for _, j := range s.jobs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.loop(ctx, j)
		}()
	}
	wg.Wait()
}

func (s *Scheduler) loop(ctx context.Context, j *job) {
	for {
		var wait time.Duration
		if j.Every > 0 {
			wait = j.Every
		} else {
			wait = untilDaily(time.Now(), j.At)
		}
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
			s.execute(ctx, j)
		}
	}
}

// execute запускает задачу с защитой от паники и наложения.
func (s *Scheduler) execute(ctx context.Context, j *job) {
	if !j.running.CompareAndSwap(false, true) {
		s.log.Warn("cron job skipped: previous run still in progress", slog.String("job", j.Name))
		return
	}
	defer j.running.Store(false)
	defer func() {
		if rec := recover(); rec != nil {
			s.log.Error("cron job panicked",
				slog.String("job", j.Name),
				slog.Any("panic", rec),
				slog.String("stack", string(debug.Stack())))
		}
	}()

	start := time.Now()
	if err := j.Run(ctx); err != nil {
		s.log.Error("cron job failed", slog.String("job", j.Name), slog.Any("error", err))
		return
	}
	s.log.Info("cron job done", slog.String("job", j.Name), slog.Duration("duration", time.Since(start)))
}

// untilDaily возвращает время до ближайшего наступления hh:mm.
func untilDaily(now time.Time, at string) time.Duration {
	t, _ := time.Parse("15:04", at) // валидировано в Add
	next := time.Date(now.Year(), now.Month(), now.Day(), t.Hour(), t.Minute(), 0, 0, now.Location())
	if !next.After(now) {
		next = next.Add(24 * time.Hour)
	}
	return next.Sub(now)
}
