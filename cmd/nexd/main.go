// Command nexd is the NEX backend service.
//
// NEX runs as a single self-contained process — a modular monolith — that
// hosts the kernel and, over time, the platform's modules. This file is the
// composition root: the one place that reads configuration, constructs the
// concrete components, wires them together, and runs them until the process is
// signalled to stop. Keeping all wiring here means dependencies flow in one
// direction and nothing deeper in the tree reaches for globals.
//
// Подкоманды:
//
//	nexd [serve]                     запустить сервис (по умолчанию)
//	nexd migrate                     применить миграции и выйти
//	nexd tenant create <slug> <имя>  зарегистрировать организацию
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/smworklair/betakis/internal/config"
	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/kernel/auth"
	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/module/campus"
	"github.com/smworklair/betakis/internal/module/files"
	"github.com/smworklair/betakis/internal/module/finance"
	"github.com/smworklair/betakis/internal/module/tasks"
	"github.com/smworklair/betakis/internal/platform/blob"
	"github.com/smworklair/betakis/internal/platform/cron"
	"github.com/smworklair/betakis/internal/platform/httpapi"
	"github.com/smworklair/betakis/internal/platform/logging"
	"github.com/smworklair/betakis/internal/platform/metrics"
	"github.com/smworklair/betakis/internal/platform/postgres"
)

func main() {
	if err := run(); err != nil {
		// main is the only place that prints a fatal error and sets the exit
		// code; everything below returns errors instead of calling os.Exit.
		fmt.Fprintf(os.Stderr, "nexd: fatal: %v\n", err)
		os.Exit(1)
	}
}

// run wires up and runs the service, returning an error instead of exiting so
// that startup failures are handled in exactly one place (main).
func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	log := logging.New(os.Stdout, cfg.Log.Level, cfg.Log.Format)

	// ctx is cancelled on the first SIGINT or SIGTERM, which triggers graceful
	// shutdown. A second signal restores default behaviour and terminates the
	// process immediately, so a stuck shutdown can still be interrupted.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	switch cmd := subcommand(); cmd {
	case "serve":
		return serve(ctx, cfg, log)
	case "migrate":
		if cfg.DB.URL == "" {
			return fmt.Errorf("migrate: NEX_DATABASE_URL is not set")
		}
		if err := postgres.Migrate(ctx, cfg.DB.URL); err != nil {
			return err
		}
		log.Info("migrations applied")
		return nil
	case "tenant":
		return tenantCmd(ctx, cfg, os.Args[2:])
	case "user":
		return userCmd(ctx, cfg, os.Args[2:])
	default:
		return fmt.Errorf("unknown subcommand %q (want serve, migrate or tenant)", cmd)
	}
}

// subcommand возвращает первую подкоманду из аргументов ("serve", если
// аргументов нет).
func subcommand() string {
	if len(os.Args) < 2 {
		return "serve"
	}
	return os.Args[1]
}

// serve собирает все компоненты сервиса и обслуживает HTTP до сигнала
// остановки.
func serve(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	log.Info("starting nexd", slog.String("env", string(cfg.Env)))

	// Метрики: /metrics в формате Prometheus, без внешних зависимостей.
	reg := metrics.New()
	reg.RegisterRuntime()
	reg.Counter("nex_http_requests_total", "Число HTTP-запросов.", "route", "status")
	reg.Histogram("nex_http_request_duration_seconds", "Латентность HTTP-запросов.", nil, "route", "status")
	observe := func(route string, status int, dur time.Duration) {
		s := strconv.Itoa(status)
		reg.Inc("nex_http_requests_total", route, s)
		reg.ObserveDuration("nex_http_request_duration_seconds", dur, route, s)
	}

	// Планировщик фоновых задач внутри процесса (ночные пересчёты, чистки).
	sched := cron.New(log)

	// RBAC-политика приложения: модули объявляют права, корень раздаёт их
	// ролям. С вехой M4 раздача переедет в настраиваемую политику tenant'а.
	policy := authz.NewPolicy()
	for _, perm := range []string{finance.PermAccountsWrite, finance.PermEntriesPost} {
		policy.Grant("admin", perm)
		policy.Grant("accountant", perm)
	}
	policy.Grant("admin", files.PermWrite)
	policy.Grant("admin", finance.PermStatsRefresh)
	policy.Grant("accountant", finance.PermStatsRefresh)
	for _, perm := range []string{campus.PermGroupsWrite, campus.PermStudentsWrite, campus.PermGradesWrite} {
		policy.Grant("admin", perm)
	}
	policy.Grant("teacher", campus.PermGradesWrite) // преподаватель ведёт журнал
	policy.Grant("admin", tasks.PermWrite)
	policy.Grant("teacher", tasks.PermWrite)
	policy.Grant("accountant", tasks.PermWrite)

	// Хранилище: PostgreSQL, если задан NEX_DATABASE_URL, иначе память
	// процесса (только для быстрых локальных запусков без БД).
	var (
		financeRepo   finance.Repository
		readiness     []httpapi.ReadinessCheck
		resolveTenant func(ctx context.Context, v string) (string, error)
		recorder      audit.Recorder
		busOpts       []command.Option
		authCfg       *httpapi.AuthConfig
		extraMounts   []func(*http.ServeMux)
		filesRepo     *files.Repository
		filesStore    *blob.Store
		pgDB          *postgres.DB
		idemStore     httpapi.IdempotencyStore
	)
	if cfg.DB.URL != "" {
		pg, err := postgres.Connect(ctx, cfg.DB.URL)
		if err != nil {
			return err
		}
		defer pg.Close()
		if err := postgres.Migrate(ctx, cfg.DB.URL); err != nil {
			return err
		}
		log.Info("postgres connected, migrations applied")
		pgDB = pg

		financeRepo = finance.NewPostgresRepository(pg)
		readiness = append(readiness, httpapi.ReadinessCheck{Name: "postgres", Check: pg.Ready})

		// Показатели пула соединений — в /metrics.
		reg.GaugeFunc("nex_db_pool_total_conns", func() float64 { return float64(pg.Pool().Stat().TotalConns()) })
		reg.GaugeFunc("nex_db_pool_idle_conns", func() float64 { return float64(pg.Pool().Stat().IdleConns()) })

		// Ночные регламентные задачи.
		if err := sched.Add(cron.Job{Name: "sessions.cleanup", At: "03:15", Run: pg.CleanupSessions}); err != nil {
			return err
		}

		// Вьюер журнала аудита (только admin): кто что менял.
		extraMounts = append(extraMounts, httpapi.AuditRoutes(postgres.NewAuditReader(pg)))

		// Идемпотентность записи по Idempotency-Key + ночная чистка ключей.
		idemStore = postgres.NewIdempotencyStore(pg)
		if err := sched.Add(cron.Job{Name: "idempotency.cleanup", At: "03:45", Run: func(ctx context.Context) error {
			return pg.ForEachTenant(ctx, pg.CleanupIdempotencyKeys)
		}}); err != nil {
			return err
		}

		// Файловое хранилище: метаданные в БД, содержимое на диске.
		filesStore, err = blob.NewStore(cfg.Files.Dir)
		if err != nil {
			return err
		}
		filesRepo = files.NewRepository(pg)
		if cfg.Env == config.EnvDevelopment {
			// В разработке неизвестный slug создаёт tenant на лету:
			// локальная работа не начинается с ручной регистрации.
			resolveTenant = pg.EnsureTenant
		} else {
			resolveTenant = pg.ResolveTenant
		}

		// Аудит — в append-only таблицу, в одной транзакции с изменением
		// данных (шина оборачивает хендлер и запись журнала в RunTx).
		recorder = postgres.NewAuditRecorder(pg, httpapi.RequestIDFrom)
		busOpts = append(busOpts, command.WithTxRunner(pg))

		// Аутентификация: argon2id + server-side сессии (ADR-004).
		authCfg = &httpapi.AuthConfig{
			Service:       auth.NewService(postgres.NewAuthStore(pg), cfg.Auth.SessionTTL),
			TTL:           cfg.Auth.SessionTTL,
			ResolveTenant: resolveTenant,
			SecureCookie:  cfg.Env == config.EnvProduction,
			Audit:         recorder,
		}
	} else {
		log.Warn("NEX_DATABASE_URL is empty: running with in-memory storage, data is lost on restart")
		financeRepo = finance.NewMemoryRepository()
		recorder = audit.NewSlogRecorder(log)
	}

	// Шина команд: единственный путь изменения данных.
	bus := command.NewMemoryBus(authz.NewPolicyAuthorizer(policy), recorder, busOpts...)
	if err := finance.RegisterCommands(bus, financeRepo); err != nil {
		return fmt.Errorf("register finance commands: %w", err)
	}

	mounts := []func(*http.ServeMux){
		finance.Routes(bus, financeRepo),
		func(mux *http.ServeMux) { mux.Handle("GET /metrics", reg.Handler()) },
	}
	var searchSources []httpapi.SearchSource
	if pgRepo, ok := financeRepo.(*finance.PostgresRepository); ok {
		searchSources = append(searchSources, pgRepo)

		// Отчётная витрина: команда пересчёта + ночной пересчёт по всем
		// tenant'ам + отчётные маршруты (JSON, CSV, XLSX).
		if err := finance.RegisterStatsCommands(bus, pgRepo); err != nil {
			return fmt.Errorf("register finance stats: %w", err)
		}
		mounts = append(mounts, finance.ReportRoutes(bus, pgRepo))
		if err := sched.Add(cron.Job{Name: "finance.stats.refresh", At: "02:30", Run: func(ctx context.Context) error {
			return pgDB.ForEachTenant(ctx, pgRepo.RefreshStats)
		}}); err != nil {
			return err
		}
	}
	if filesRepo != nil {
		if err := files.RegisterCommands(bus, filesRepo); err != nil {
			return fmt.Errorf("register files commands: %w", err)
		}
		mounts = append(mounts, files.Routes(bus, filesRepo, filesStore, cfg.Files.MaxUploadBytes))
		searchSources = append(searchSources, filesRepo)
	}
	if pgDB != nil {
		// Кампус: группы, студенты, учебный журнал.
		campusRepo := campus.NewRepository(pgDB)
		if err := campus.RegisterCommands(bus, campusRepo); err != nil {
			return fmt.Errorf("register campus commands: %w", err)
		}
		mounts = append(mounts, campus.Routes(bus, campusRepo))
		searchSources = append(searchSources, campusRepo)

		// Задачи.
		tasksRepo := tasks.NewRepository(pgDB)
		if err := tasks.RegisterCommands(bus, tasksRepo); err != nil {
			return fmt.Errorf("register tasks commands: %w", err)
		}
		mounts = append(mounts, tasks.Routes(bus, tasksRepo))
		searchSources = append(searchSources, tasksRepo)
	}
	if len(searchSources) > 0 {
		mounts = append(mounts, httpapi.SearchRoutes(searchSources...))
	}
	mounts = append(mounts, extraMounts...)

	router := httpapi.NewRouter(log, httpapi.RouterConfig{
		Readiness:     readiness,
		DevAuth:       cfg.Env == config.EnvDevelopment,
		Pprof:         cfg.Env == config.EnvDevelopment,
		ResolveTenant: resolveTenant,
		Auth:          authCfg,
		Observe:       observe,
		Idempotency:   idemStore,
		Mount:         mounts,
	})
	server := httpapi.New(router, httpapi.Options{
		Addr:            cfg.HTTP.Addr,
		ReadTimeout:     cfg.HTTP.ReadTimeout,
		WriteTimeout:    cfg.HTTP.WriteTimeout,
		IdleTimeout:     cfg.HTTP.IdleTimeout,
		ShutdownTimeout: cfg.HTTP.ShutdownTimeout,
		Logger:          log,
	})

	// HTTP-сервер и планировщик живут до общей отмены контекста.
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error { return server.Run(gctx) })
	g.Go(func() error { sched.Run(gctx); return nil })
	if err := g.Wait(); err != nil {
		return err
	}

	log.Info("nexd stopped")
	return nil
}

// tenantCmd — администрирование реестра tenant'ов:
//
//	nexd tenant create <slug> <отображаемое имя>
func tenantCmd(ctx context.Context, cfg config.Config, args []string) error {
	if len(args) < 1 || args[0] != "create" {
		return fmt.Errorf("tenant: usage: nexd tenant create <slug> <name>")
	}
	if len(args) < 3 {
		return fmt.Errorf("tenant create: usage: nexd tenant create <slug> <name>")
	}
	if cfg.DB.URL == "" {
		return fmt.Errorf("tenant create: NEX_DATABASE_URL is not set")
	}
	slug, name := args[1], strings.Join(args[2:], " ")

	pg, err := postgres.Connect(ctx, cfg.DB.URL)
	if err != nil {
		return err
	}
	defer pg.Close()
	if err := postgres.Migrate(ctx, cfg.DB.URL); err != nil {
		return err
	}

	id, err := pg.CreateTenant(ctx, slug, name)
	if err != nil {
		return err
	}
	fmt.Printf("tenant created: %s (%s)\n", id, slug)
	return nil
}

// userCmd — регистрация пользователей:
//
//	nexd user create --tenant <slug> --email <email> [--name <имя>] [--role admin]
//
// Пароль берётся из NEX_USER_PASSWORD; если переменная пуста, генерируется
// случайный и печатается один раз.
func userCmd(ctx context.Context, cfg config.Config, args []string) error {
	if len(args) < 1 || args[0] != "create" {
		return fmt.Errorf("user: usage: nexd user create --tenant <slug> --email <email> [--name <имя>] [--role admin]")
	}
	fs := flag.NewFlagSet("user create", flag.ContinueOnError)
	tenant := fs.String("tenant", "", "slug или UUID организации")
	email := fs.String("email", "", "email пользователя")
	name := fs.String("name", "", "отображаемое имя")
	role := fs.String("role", "admin", "роль пользователя")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if *tenant == "" || *email == "" {
		return fmt.Errorf("user create: --tenant и --email обязательны")
	}
	if cfg.DB.URL == "" {
		return fmt.Errorf("user create: NEX_DATABASE_URL is not set")
	}

	password := os.Getenv("NEX_USER_PASSWORD")
	generated := password == ""
	if generated {
		var buf [18]byte
		if _, err := rand.Read(buf[:]); err != nil {
			return fmt.Errorf("user create: generate password: %w", err)
		}
		password = base64.RawURLEncoding.EncodeToString(buf[:])
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}

	pg, err := postgres.Connect(ctx, cfg.DB.URL)
	if err != nil {
		return err
	}
	defer pg.Close()
	if err := postgres.Migrate(ctx, cfg.DB.URL); err != nil {
		return err
	}
	tenantID, err := pg.ResolveTenant(ctx, *tenant)
	if err != nil {
		return err
	}

	u, err := postgres.NewAuthStore(pg).CreateUser(tenancy.WithTenant(ctx, tenantID), auth.User{
		TenantID:     tenantID,
		Email:        *email,
		DisplayName:  *name,
		Roles:        []string{*role},
		PasswordHash: hash,
	})
	if err != nil {
		return err
	}
	fmt.Printf("user created: %s (%s, роль %s)\n", u.ID, u.Email, *role)
	if generated {
		fmt.Printf("password: %s\n", password)
	}
	return nil
}
