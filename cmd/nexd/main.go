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
//	nexd migrate down                откатить последнюю миграцию и выйти
//	nexd tenant create <slug> <имя>  зарегистрировать организацию
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
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

	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/errgroup"

	"github.com/smworklair/betakis/api"
	"github.com/smworklair/betakis/internal/config"
	"github.com/smworklair/betakis/internal/kernel/audit"
	"github.com/smworklair/betakis/internal/kernel/auth"
	"github.com/smworklair/betakis/internal/kernel/authz"
	"github.com/smworklair/betakis/internal/kernel/command"
	"github.com/smworklair/betakis/internal/kernel/tenancy"
	"github.com/smworklair/betakis/internal/module/campus"
	"github.com/smworklair/betakis/internal/module/files"
	"github.com/smworklair/betakis/internal/module/finance"
	"github.com/smworklair/betakis/internal/module/notifications"
	"github.com/smworklair/betakis/internal/module/tasks"
	"github.com/smworklair/betakis/internal/module/terminal"
	"github.com/smworklair/betakis/internal/platform/blob"
	"github.com/smworklair/betakis/internal/platform/cache"
	"github.com/smworklair/betakis/internal/platform/cron"
	"github.com/smworklair/betakis/internal/platform/httpapi"
	"github.com/smworklair/betakis/internal/platform/logging"
	"github.com/smworklair/betakis/internal/platform/metrics"
	"github.com/smworklair/betakis/internal/platform/outbox"
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
	// httpapi.WriteProblem логирует полную причину 5xx через slog.Default()
	// (detail в ответ клиенту не попадает — см. problem.go), поэтому
	// process-wide default должен быть тем же настроенным логгером, а не
	// стандартным fallback-логгером slog.
	slog.SetDefault(log)

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
		if len(os.Args) > 2 && os.Args[2] == "down" {
			if err := postgres.MigrateDown(ctx, cfg.DB.URL); err != nil {
				return err
			}
			log.Info("last migration rolled back")
			return nil
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
// остановки. Сама функция — только последовательность шагов сборки;
// содержимое каждого шага вынесено в helper'ы ниже (setupMetrics,
// setupCache, buildPolicy, setupInfra, buildMounts, runServers), чтобы
// serve() читалась как оглавление, а не как код.
func serve(ctx context.Context, cfg config.Config, log *slog.Logger) error {
	log.Info("starting nexd", slog.String("env", string(cfg.Env)))

	reg, observe := setupMetrics()

	// Планировщик фоновых задач внутри процесса (ночные пересчёты, чистки).
	sched := cron.New(log)

	cacheReadiness, closeCache, err := setupCache(cfg, log)
	if err != nil {
		return err
	}
	if closeCache != nil {
		defer closeCache()
	}

	policy := buildPolicy()
	guard := authz.NewGuard(policy)

	in, infraReadiness, closeInfra, err := setupInfra(ctx, cfg, log, reg, sched, guard)
	if err != nil {
		return err
	}
	if closeInfra != nil {
		defer closeInfra()
	}
	readiness := append(cacheReadiness, infraReadiness...)

	// Шина команд: единственный путь изменения данных.
	bus := command.NewMemoryBus(authz.NewPolicyAuthorizer(policy), in.recorder, in.busOpts...)
	if err := finance.RegisterCommands(bus, in.financeRepo); err != nil {
		return fmt.Errorf("register finance commands: %w", err)
	}

	mounts, err := buildMounts(bus, guard, sched, reg, log, cfg, in)
	if err != nil {
		return err
	}
	// Пусто в NEX_AI_GATEWAY_URL — MountAIGateway ничего не монтирует, и
	// окружения без ai-gateway (демо, дев без Python-стека) не меняются.
	mounts = append(mounts, httpapi.MountAIGateway(httpapi.AIGatewayConfig{
		URL:    cfg.AIGateway.URL,
		Secret: cfg.AIGateway.Secret,
	}, log))
	mounts = append(mounts, in.extraMounts...)

	router := httpapi.NewRouter(log, httpapi.RouterConfig{
		Readiness:     readiness,
		DevAuth:       cfg.Env == config.EnvDevelopment,
		Pprof:         cfg.Env == config.EnvDevelopment,
		ResolveTenant: in.resolveTenant,
		Auth:          in.authCfg,
		CORS:          httpapi.CORSConfig{AllowedOrigins: cfg.HTTP.CORSOrigins},
		OpenAPI:       api.OpenAPI,
		Observe:       observe,
		Idempotency:   in.idemStore,
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

	if err := runServers(ctx, server, sched, in.outboxWorker); err != nil {
		return err
	}

	log.Info("nexd stopped")
	return nil
}

// setupMetrics регистрирует реестр Prometheus-метрик /metrics и возвращает
// функцию наблюдения за HTTP-запросами, которую передают в httpapi.NewRouter.
func setupMetrics() (*metrics.Registry, func(route string, status int, dur time.Duration)) {
	reg := metrics.New()
	reg.RegisterRuntime()
	reg.Counter("nex_http_requests_total", "Число HTTP-запросов.", "route", "status")
	reg.Histogram("nex_http_request_duration_seconds", "Латентность HTTP-запросов.", nil, "route", "status")
	observe := func(route string, status int, dur time.Duration) {
		s := strconv.Itoa(status)
		reg.Inc("nex_http_requests_total", route, s)
		reg.ObserveDuration("nex_http_request_duration_seconds", dur, route, s)
	}
	return reg, observe
}

// setupCache готовит backend кэша: in-process по умолчанию (ADR-008),
// Redis — конфигом NEX_CACHE_BACKEND=redis (internal/platform/cache/redis.go),
// когда nexd работает больше чем одним инстансом. Ни один модуль пока не
// использует Cache как хранилище данных (сам интерфейс — задел на будущее,
// см. докстринг пакета) — но при backend=redis соединение реально
// проверяется здесь и отражается в /readyz, а не остаётся декларацией
// конфига без последствий. Возвращённый cleanup закрывает клиент Redis (nil,
// если backend не redis).
func setupCache(cfg config.Config, log *slog.Logger) ([]httpapi.ReadinessCheck, func(), error) {
	if cfg.Cache.Backend != "redis" {
		log.Info("cache backend: memory")
		return nil, nil, nil
	}
	opts, err := redis.ParseURL(cfg.Cache.RedisURL)
	if err != nil {
		// config.validate уже проверил NEX_REDIS_URL — ошибка здесь означает
		// расхождение между Load() и этим разбором, то есть баг сборки, а не
		// рантайм-состояние.
		return nil, nil, fmt.Errorf("cache: parse NEX_REDIS_URL: %w", err)
	}
	redisClient := redis.NewClient(opts)
	log.Info("cache backend: redis", slog.String("addr", opts.Addr))
	readiness := []httpapi.ReadinessCheck{{Name: "redis", Check: cache.NewRedis(redisClient).Ping}}
	return readiness, func() { _ = redisClient.Close() }, nil
}

// buildPolicy собирает RBAC-политику приложения: модули объявляют права,
// корень раздаёт их ролям. С вехой M4 раздача переедет в настраиваемую
// политику tenant'а. Права чтения выдаются явно (authz на чтение, P0): без
// права роль не видит данные раздела, без сессии запрос получает 401.
func buildPolicy() *authz.Policy {
	policy := authz.NewPolicy()
	for _, perm := range []string{finance.PermAccountsWrite, finance.PermEntriesPost, finance.PermRead} {
		policy.Grant("admin", perm)
		policy.Grant("accountant", perm)
	}
	policy.Grant("admin", files.PermWrite)
	policy.Grant("admin", terminal.PermExec) // консоль администратора — только admin
	policy.Grant("admin", finance.PermStatsRefresh)
	policy.Grant("accountant", finance.PermStatsRefresh)
	for _, perm := range []string{campus.PermGroupsWrite, campus.PermStudentsWrite, campus.PermGradesWrite} {
		policy.Grant("admin", perm)
	}
	policy.Grant("teacher", campus.PermGradesWrite) // преподаватель ведёт журнал
	for _, role := range []string{"admin", "teacher"} {
		policy.Grant(role, campus.PermRead)
	}
	for _, role := range []string{"admin", "teacher", "accountant"} {
		policy.Grant(role, tasks.PermWrite)
		policy.Grant(role, files.PermRead)
		policy.Grant(role, httpapi.PermSearch)
		policy.Grant(role, httpapi.PermUsersRead)
	}
	// Задачи и уведомления видят все роли, включая студентов.
	for _, role := range []string{"admin", "teacher", "accountant", "student"} {
		policy.Grant(role, tasks.PermRead)
		policy.Grant(role, notifications.PermRead)
		policy.Grant(role, notifications.PermWrite)
	}
	return policy
}

// infra — конкретные реализации инфраструктуры, выбранные setupInfra: либо
// полная связка на PostgreSQL, либо облегчённый fallback в памяти процесса.
// Поля читаются дальше в buildMounts и в serve() при сборке роутера.
type infra struct {
	financeRepo   finance.Repository
	resolveTenant func(ctx context.Context, v string) (string, error)
	recorder      audit.Recorder
	busOpts       []command.Option
	authCfg       *httpapi.AuthConfig
	extraMounts   []func(*http.ServeMux)
	filesRepo     *files.Repository
	filesStore    blob.Storage
	pgDB          *postgres.DB
	idemStore     httpapi.IdempotencyStore
	outboxWorker  *outbox.Worker
}

// setupInfra выбирает хранилище: PostgreSQL, если задан NEX_DATABASE_URL,
// иначе память процесса (только для быстрых локальных запусков без БД).
// В ветке PostgreSQL также регистрирует связанные ночные cron-задачи и
// маршруты (аудит, справочник пользователей). Возвращённый cleanup
// закрывает пул соединений (nil в ветке без БД).
func setupInfra(
	ctx context.Context, cfg config.Config, log *slog.Logger,
	reg *metrics.Registry, sched *cron.Scheduler, guard *authz.Guard,
) (infra, []httpapi.ReadinessCheck, func(), error) {
	if cfg.DB.URL == "" {
		log.Warn("NEX_DATABASE_URL is empty: running with in-memory storage, data is lost on restart")
		return infra{
			financeRepo: finance.NewMemoryRepository(),
			recorder:    audit.NewSlogRecorder(log),
		}, nil, nil, nil
	}

	pg, err := postgres.Connect(ctx, cfg.DB.URL)
	if err != nil {
		return infra{}, nil, nil, err
	}
	cleanup := func() { pg.Close() }
	if err := postgres.Migrate(ctx, cfg.DB.URL); err != nil {
		cleanup()
		return infra{}, nil, nil, err
	}
	log.Info("postgres connected, migrations applied")

	var in infra
	in.pgDB = pg
	in.financeRepo = finance.NewPostgresRepository(pg)
	readiness := []httpapi.ReadinessCheck{{Name: "postgres", Check: pg.Ready}}

	// Показатели пула соединений — в /metrics.
	reg.GaugeFunc("nex_db_pool_total_conns", func() float64 { return float64(pg.Pool().Stat().TotalConns()) })
	reg.GaugeFunc("nex_db_pool_idle_conns", func() float64 { return float64(pg.Pool().Stat().IdleConns()) })

	// Ночные регламентные задачи.
	if err := sched.Add(cron.Job{Name: "sessions.cleanup", At: "03:15", Run: pg.CleanupSessions}); err != nil {
		cleanup()
		return infra{}, nil, nil, err
	}

	// Вьюер журнала аудита (только admin): кто что менял.
	in.extraMounts = append(in.extraMounts, httpapi.AuditRoutes(postgres.NewAuditReader(pg)))

	// Идемпотентность записи по Idempotency-Key + ночная чистка ключей.
	in.idemStore = postgres.NewIdempotencyStore(pg)
	if err := sched.Add(cron.Job{Name: "idempotency.cleanup", At: "03:45", Run: func(ctx context.Context) error {
		return pg.ForEachTenant(ctx, pg.CleanupIdempotencyKeys)
	}}); err != nil {
		cleanup()
		return infra{}, nil, nil, err
	}

	// Файловое хранилище: метаданные в БД, содержимое на диске.
	in.filesStore, err = blob.NewStore(cfg.Files.Dir)
	if err != nil {
		cleanup()
		return infra{}, nil, nil, err
	}
	in.filesRepo = files.NewRepository(pg)
	if cfg.Env == config.EnvDevelopment {
		// В разработке неизвестный slug создаёт tenant на лету: локальная
		// работа не начинается с ручной регистрации.
		in.resolveTenant = pg.EnsureTenant
	} else {
		in.resolveTenant = pg.ResolveTenant
	}

	// Аудит — в append-only таблицу, в одной транзакции с изменением
	// данных (шина оборачивает хендлер и запись журнала в RunTx).
	in.recorder = postgres.NewAuditRecorder(pg, httpapi.RequestIDFrom)
	in.busOpts = append(in.busOpts, command.WithTxRunner(pg))

	// Аутентификация: argon2id + server-side сессии (ADR-004) со скользящим
	// продлением. SameSite задаётся конфигом: None — для кросс-доменного
	// фронтенда (Vercel), Lax — за одним доменом.
	authStore := postgres.NewAuthStore(pg)
	in.authCfg = &httpapi.AuthConfig{
		Service:       auth.NewService(authStore, cfg.Auth.SessionTTL),
		TTL:           cfg.Auth.SessionTTL,
		ResolveTenant: in.resolveTenant,
		SecureCookie:  cfg.Env == config.EnvProduction,
		SameSite:      sameSiteMode(cfg.Auth.CookieSameSite),
		Audit:         in.recorder,
	}

	// Справочник пользователей: выбор исполнителей и получателей.
	in.extraMounts = append(in.extraMounts, httpapi.UsersRoutes(authStore, guard))

	// Outbox: очередь надёжных побочных эффектов + воркер доставки.
	in.outboxWorker = outbox.NewWorker(pg, log)
	if err := sched.Add(cron.Job{Name: "outbox.cleanup", At: "04:15", Run: in.outboxWorker.Cleanup}); err != nil {
		cleanup()
		return infra{}, nil, nil, err
	}

	return in, readiness, cleanup, nil
}

// buildMounts регистрирует команды и HTTP-маршруты всех доменных модулей на
// шине bus и возвращает список mount-функций для httpapi.NewRouter. Финансы
// и файлы подключаются всегда; кампус, уведомления, задачи и AI-терминал —
// только когда доступна PostgreSQL (in.pgDB != nil), так как читают друг
// друга через конкретные репозитории, а не только через шину.
func buildMounts(
	bus *command.MemoryBus, guard *authz.Guard, sched *cron.Scheduler,
	reg *metrics.Registry, log *slog.Logger, cfg config.Config, in infra,
) ([]func(*http.ServeMux), error) {
	mounts := []func(*http.ServeMux){
		finance.Routes(bus, in.financeRepo, guard),
		func(mux *http.ServeMux) { mux.Handle("GET /metrics", reg.Handler()) },
	}
	var searchSources []httpapi.SearchSource
	if pgRepo, ok := in.financeRepo.(*finance.PostgresRepository); ok {
		searchSources = append(searchSources, pgRepo)

		// Отчётная витрина: команда пересчёта + ночной пересчёт по всем
		// tenant'ам + отчётные маршруты (JSON, CSV, XLSX).
		if err := finance.RegisterStatsCommands(bus, pgRepo); err != nil {
			return nil, fmt.Errorf("register finance stats: %w", err)
		}
		mounts = append(mounts, finance.ReportRoutes(bus, pgRepo, guard))
		if err := sched.Add(cron.Job{Name: "finance.stats.refresh", At: "02:30", Run: func(ctx context.Context) error {
			return in.pgDB.ForEachTenant(ctx, pgRepo.RefreshStats)
		}}); err != nil {
			return nil, err
		}
	}
	if in.filesRepo != nil {
		if err := files.RegisterCommands(bus, in.filesRepo); err != nil {
			return nil, fmt.Errorf("register files commands: %w", err)
		}
		mounts = append(mounts, files.Routes(bus, in.filesRepo, in.filesStore, cfg.Files.MaxUploadBytes, guard))
		searchSources = append(searchSources, in.filesRepo)
	}
	if in.pgDB != nil {
		termMounts, err := buildPostgresModules(bus, guard, log, in)
		if err != nil {
			return nil, err
		}
		mounts = append(mounts, termMounts.mounts...)
		searchSources = append(searchSources, termMounts.searchSources...)
	}
	if len(searchSources) > 0 {
		mounts = append(mounts, httpapi.SearchRoutes(guard, searchSources...))
	}
	return mounts, nil
}

// postgresModules — маршруты и поисковые источники модулей, доступных
// только при PostgreSQL (кампус, уведомления, задачи, AI-терминал).
type postgresModules struct {
	mounts        []func(*http.ServeMux)
	searchSources []httpapi.SearchSource
}

// buildPostgresModules подключает кампус, уведомления, задачи и AI-терминал
// «Администратор · альфа». Терминал не имеет собственного знания о других
// модулях — все адаптеры (Deps) для доступа к задачам, пользователям,
// аудиту, группам/студентам, финансам собираются именно здесь через
// замыкания поверх конкретных репозиториев; мутации всё равно идут через
// bus.Dispatch, то есть проходят авторизацию и попадают в аудит наравне с
// обычными HTTP-запросами.
func buildPostgresModules(bus *command.MemoryBus, guard *authz.Guard, log *slog.Logger, in infra) (postgresModules, error) {
	pgDB := in.pgDB
	var out postgresModules

	// Кампус: группы, студенты, учебный журнал.
	campusRepo := campus.NewRepository(pgDB)
	if err := campus.RegisterCommands(bus, campusRepo); err != nil {
		return postgresModules{}, fmt.Errorf("register campus commands: %w", err)
	}
	out.mounts = append(out.mounts, campus.Routes(bus, campusRepo, guard))
	out.searchSources = append(out.searchSources, campusRepo)

	// Уведомления: лента пользователя + сервис для других модулей. Внешняя
	// доставка уходит в outbox; пока обработчик темы только логирует —
	// SMTP появится вместе с notification-каналами (M7+).
	notifRepo := notifications.NewRepository(pgDB)
	if err := notifications.RegisterCommands(bus, notifRepo); err != nil {
		return postgresModules{}, fmt.Errorf("register notifications commands: %w", err)
	}
	out.mounts = append(out.mounts, notifications.Routes(bus, notifRepo, guard))
	notifier := notifications.NewService(notifRepo, outbox.NewQueue(pgDB))
	in.outboxWorker.Handle(notifications.TopicCreated, func(_ context.Context, m outbox.Message) error {
		log.Info("notification delivery queued (no external channel yet)",
			slog.String("payload", string(m.Payload)))
		return nil
	})

	// Задачи. Рассылка задач уведомляет получателей через notifier.
	tasksRepo := tasks.NewRepository(pgDB)
	if err := tasks.RegisterCommands(bus, tasksRepo, taskNotifier{svc: notifier}); err != nil {
		return postgresModules{}, fmt.Errorf("register tasks commands: %w", err)
	}
	out.mounts = append(out.mounts, tasks.Routes(bus, tasksRepo, guard))
	out.searchSources = append(out.searchSources, tasksRepo)

	if err := terminal.RegisterCommands(bus, notifier); err != nil {
		return postgresModules{}, fmt.Errorf("register terminal commands: %w", err)
	}
	authStore := postgres.NewAuthStore(pgDB)
	auditReader := postgres.NewAuditReader(pgDB)
	termDeps := terminal.Deps{
		Tasks: func(ctx context.Context, status string, limit int) ([]terminal.TaskRow, error) {
			items, err := tasksRepo.List(ctx, tasks.Filter{Status: status, Limit: limit})
			if err != nil {
				return nil, err
			}
			rows := make([]terminal.TaskRow, 0, len(items))
			for _, t := range items {
				row := terminal.TaskRow{ID: t.ID, Title: t.Title, Status: t.Status}
				if !t.DueOn.IsZero() {
					row.DueOn = t.DueOn.Format("2006-01-02")
				}
				rows = append(rows, row)
			}
			return rows, nil
		},
		AddTask: func(ctx context.Context, title string) error {
			return bus.Dispatch(ctx, tasks.Create{Title: title})
		},
		DoneTask: func(ctx context.Context, id string) error {
			return bus.Dispatch(ctx, tasks.Complete{ID: id})
		},
		Users: func(ctx context.Context, limit int) ([]terminal.UserRow, error) {
			users, err := authStore.ListUsers(ctx, limit)
			if err != nil {
				return nil, err
			}
			rows := make([]terminal.UserRow, 0, len(users))
			for _, u := range users {
				rows = append(rows, terminal.UserRow{ID: u.ID, Email: u.Email, Name: u.DisplayName, Roles: u.Roles})
			}
			return rows, nil
		},
		Notify: func(ctx context.Context, userIDs []string, title string) error {
			return bus.Dispatch(ctx, terminal.Notify{UserIDs: userIDs, Title: title})
		},
		Audit: func(ctx context.Context, limit int) ([]terminal.AuditRow, error) {
			entries, err := auditReader.Entries(ctx, audit.Filter{Limit: limit})
			if err != nil {
				return nil, err
			}
			rows := make([]terminal.AuditRow, 0, len(entries))
			for _, e := range entries {
				rows = append(rows, terminal.AuditRow{
					Command: e.Command, Outcome: string(e.Outcome),
					ActorID: e.ActorID, OccurredAt: e.OccurredAt,
				})
			}
			return rows, nil
		},
		Unread: notifRepo.CountUnread,

		// Аналитика — модуль campus.
		Groups: func(ctx context.Context) ([]terminal.GroupRow, error) {
			groups, err := campusRepo.Groups(ctx)
			if err != nil {
				return nil, err
			}
			rows := make([]terminal.GroupRow, 0, len(groups))
			for _, g := range groups {
				rows = append(rows, terminal.GroupRow{Code: g.Code, Name: g.Name, Students: g.ActiveStudents})
			}
			return rows, nil
		},
		Students: func(ctx context.Context, query string, limit int) ([]terminal.StudentRow, error) {
			studs, err := campusRepo.Students(ctx, campus.StudentFilter{Query: query, Limit: limit})
			if err != nil {
				return nil, err
			}
			rows := make([]terminal.StudentRow, 0, len(studs))
			for _, s := range studs {
				rows = append(rows, terminal.StudentRow{Name: s.FullName, Group: s.GroupCode, Status: string(s.Status), Email: s.Email})
			}
			return rows, nil
		},
		Grades: func(ctx context.Context, limit int) ([]terminal.GradeRow, error) {
			grades, err := campusRepo.Journal(ctx, campus.JournalFilter{Limit: limit})
			if err != nil {
				return nil, err
			}
			rows := make([]terminal.GradeRow, 0, len(grades))
			for _, g := range grades {
				rows = append(rows, terminal.GradeRow{
					Student: g.FullName, Group: g.GroupCode, Subject: g.Subject,
					Grade: g.Grade, On: g.GradedOn,
				})
			}
			return rows, nil
		},

		// Финансы — леджер.
		Balances: func(ctx context.Context) ([]terminal.BalanceRow, error) {
			balances, err := in.financeRepo.Accounts(ctx)
			if err != nil {
				return nil, err
			}
			rows := make([]terminal.BalanceRow, 0, len(balances))
			for _, b := range balances {
				rows = append(rows, terminal.BalanceRow{
					Code: b.Account.Code, Name: b.Account.Name,
					Type: string(b.Account.Type), Amount: b.Amount,
				})
			}
			return rows, nil
		},
		Entries: func(ctx context.Context, limit int) ([]terminal.EntryRow, error) {
			entries, err := in.financeRepo.Entries(ctx)
			if err != nil {
				return nil, err
			}
			if len(entries) > limit {
				entries = entries[len(entries)-limit:] // свежие в конце — берём хвост
			}
			rows := make([]terminal.EntryRow, 0, len(entries))
			for _, e := range entries {
				var debit int64
				for _, l := range e.Lines {
					if l.Side == finance.Debit {
						debit += l.Amount
					}
				}
				rows = append(rows, terminal.EntryRow{
					Memo: e.Memo, PostedBy: e.PostedBy, PostedAt: e.PostedAt, Amount: debit,
				})
			}
			return rows, nil
		},
	}
	out.mounts = append(out.mounts, terminal.Routes(termDeps, guard))
	return out, nil
}

// runServers запускает HTTP-сервер, планировщик и outbox-воркер параллельно
// через errgroup и ждёт либо первой ошибки, либо отмены ctx (грациозное
// завершение по сигналу).
func runServers(ctx context.Context, server *httpapi.Server, sched *cron.Scheduler, outboxWorker *outbox.Worker) error {
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error { return server.Run(gctx) })
	g.Go(func() error { sched.Run(gctx); return nil })
	if outboxWorker != nil {
		g.Go(func() error { return outboxWorker.Run(gctx) })
	}
	return g.Wait()
}

// sameSiteMode переводит строку конфига в http.SameSite.
func sameSiteMode(v string) http.SameSite {
	switch v {
	case "none":
		return http.SameSiteNoneMode
	case "strict":
		return http.SameSiteStrictMode
	default:
		return http.SameSiteLaxMode
	}
}

// taskNotifier связывает задачи с сервисом уведомлений и переводит его
// ошибки в доменные ошибки задач — перевод живёт здесь, чтобы модули
// не знали друг о друге.
type taskNotifier struct {
	svc *notifications.Service
}

func (a taskNotifier) Notify(ctx context.Context, userIDs []string, kind, title, body, refType, refID string) error {
	err := a.svc.Notify(ctx, userIDs, kind, title, body, refType, refID)
	if errors.Is(err, notifications.ErrUserNotFound) {
		return fmt.Errorf("%w: %v", tasks.ErrRecipientNotFound, err)
	}
	return err
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
