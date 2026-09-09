/* ============================================================
   «Бэкенд · API» — живая витрина бэкенда nexd прямо во фронтенде.

   Все запросы отсюда идут по-настоящему: тот же origin (Vite-прокси)
   или VITE_API_URL, credentials:'include', реальные problem+json
   при ошибках. Цель — показать возможности бэкенда (сессии, шину
   команд, аудит, RBAC, finance/campus/tasks/terminal) без Bruno и
   без curl: нажал «Выполнить» — увидел статус, время и тело ответа.
   ============================================================ */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Activity, Bell, CheckCircle2, CheckSquare, FileJson, FolderOpen, GraduationCap,
  LogIn, LogOut, RefreshCw, ScrollText, Search as SearchIcon, Server, ShieldCheck,
  Terminal, Users, Wallet, XCircle, Zap, type LucideIcon,
} from 'lucide-react';
import { PageHead } from '../ui';
import { API_BASE, auth as authApi, ApiError } from '../api';

/* ---------- результаты выполнения ---------- */

interface ExecResult {
  ok: boolean;
  status: number;        // 0 — сеть недоступна
  ms: number;
  contentType: string;
  text: string;
  at: string;
}

async function call(method: string, path: string, body?: string): Promise<ExecResult> {
  const t0 = performance.now();
  const at = new Date().toLocaleTimeString();
  try {
    const res = await fetch(API_BASE + path, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json, application/problem+json, application/yaml, text/csv, text/plain',
        ...(body != null && body.trim() !== '' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body != null && body.trim() !== '' ? body : undefined,
    });
    const text = await res.text();
    return {
      ok: res.ok, status: res.status, ms: Math.round(performance.now() - t0),
      contentType: res.headers.get('content-type') ?? '', text: text.slice(0, 14000), at,
    };
  } catch (e) {
    return {
      ok: false, status: 0, ms: Math.round(performance.now() - t0),
      contentType: '', text: `Сеть недоступна: ${e instanceof Error ? e.message : String(e)}`, at,
    };
  }
}

function pretty(r: ExecResult): string {
  if (r.contentType.includes('json')) {
    try { return JSON.stringify(JSON.parse(r.text), null, 2); } catch { /* отдаём как есть */ }
  }
  return r.text;
}

function statusTone(r: ExecResult): string {
  if (r.ok) return 'chip-success';
  if (r.status === 0 || r.status >= 500) return 'chip-danger';
  return 'chip-warn';
}

function statusLabel(r: ExecResult): string {
  if (r.status === 0) return 'нет связи';
  return String(r.status);
}

/* ---------- каталог реальных эндпоинтов (api/openapi.yaml v0.2.0) ---------- */

interface Endpoint { key: string; method: 'GET' | 'POST'; path: string; desc: string; body?: string; }
interface Group { id: string; label: string; icon: LucideIcon; note: string; items: Endpoint[]; }

const GROUPS: Group[] = [
  {
    id: 'system', label: 'Система', icon: Activity,
    note: 'Публичные проверки — сессия не нужна',
    items: [
      { key: 'healthz', method: 'GET', path: '/healthz', desc: 'Liveness: процесс жив' },
      { key: 'readyz', method: 'GET', path: '/readyz', desc: 'Readiness: Postgres доступен' },
      { key: 'spec', method: 'GET', path: '/api/v1/openapi.yaml', desc: 'OpenAPI 3.1 — контракт, раздаваемый самим сервером' },
    ],
  },
  {
    id: 'auth', label: 'Аутентификация', icon: ShieldCheck,
    note: 'Серверные сессии в httpOnly-cookie nex_session · argon2id · rate-limit (ADR-004)',
    items: [
      { key: 'me', method: 'GET', path: '/api/v1/auth/me', desc: 'Текущая сессия' },
      { key: 'logout', method: 'POST', path: '/api/v1/auth/logout', desc: 'Выход — отзыв сессии (идемпотентен)' },
    ],
  },
  {
    id: 'users', label: 'Пользователи', icon: Users,
    note: 'Справочник организации · право users:read',
    items: [
      { key: 'users', method: 'GET', path: '/api/v1/users?limit=20', desc: 'Пользователи тенанта (без хэшей паролей)' },
    ],
  },
  {
    id: 'tasks', label: 'Задачи', icon: CheckSquare,
    note: 'Мутации идут через шину команд и попадают в аудит',
    items: [
      { key: 'tasks-list', method: 'GET', path: '/api/v1/tasks?limit=20', desc: 'Список задач (tasks:read)' },
      {
        key: 'tasks-create', method: 'POST', path: '/api/v1/tasks', desc: 'Создать задачу (tasks:write) — затем обновите аудит',
        body: JSON.stringify({ title: 'Проверка шины команд', note: 'Создано с витрины «Бэкенд · API»' }, null, 2),
      },
    ],
  },
  {
    id: 'notifications', label: 'Уведомления', icon: Bell,
    note: 'Лента пользователя · внешняя доставка через transactional outbox',
    items: [
      { key: 'notif-list', method: 'GET', path: '/api/v1/notifications?limit=10', desc: 'Своя лента, свежие первыми' },
      { key: 'notif-unread', method: 'GET', path: '/api/v1/notifications/unread-count', desc: 'Число непрочитанных' },
    ],
  },
  {
    id: 'finance', label: 'Финансы', icon: Wallet,
    note: 'Двойная запись: счета, проводки, обороты · суммы в копейках',
    items: [
      { key: 'fin-accounts', method: 'GET', path: '/api/v1/finance/accounts', desc: 'План счетов с сальдо (finance:read)' },
      { key: 'fin-entries', method: 'GET', path: '/api/v1/finance/entries', desc: 'Реестр проводок' },
      { key: 'fin-monthly', method: 'GET', path: '/api/v1/finance/stats/monthly', desc: 'Витрина месячных оборотов (ночной пересчёт)' },
    ],
  },
  {
    id: 'campus', label: 'Кампус', icon: GraduationCap,
    note: 'Группы, студенты, учебный журнал · RLS-изоляция по тенанту',
    items: [
      { key: 'campus-groups', method: 'GET', path: '/api/v1/campus/groups', desc: 'Группы с числом студентов' },
      { key: 'campus-students', method: 'GET', path: '/api/v1/campus/students?limit=20', desc: 'Студенты' },
      { key: 'campus-journal', method: 'GET', path: '/api/v1/campus/journal?limit=20', desc: 'Оценки журнала' },
    ],
  },
  {
    id: 'files', label: 'Файлы', icon: FolderOpen,
    note: 'Метаданные в Postgres, содержимое на диске · sha256',
    items: [
      { key: 'files-list', method: 'GET', path: '/api/v1/files?limit=10', desc: 'Список файлов тенанта' },
    ],
  },
  {
    id: 'audit', label: 'Аудит', icon: ScrollText,
    note: 'Append-only журнал хребта Commands → Events → Audit · только admin',
    items: [
      { key: 'audit', method: 'GET', path: '/api/v1/audit?limit=20', desc: 'Каждая мутация системы — команда с исходом ok/denied/error' },
    ],
  },
];

const ALL_ENDPOINTS: Endpoint[] = GROUPS.flatMap((g) => g.items);

/* ---------- страница ---------- */

export function Backend() {
  const [results, setResults] = useState<Record<string, ExecResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const ep of ALL_ENDPOINTS) if (ep.body != null) init[ep.key] = ep.body;
    return init;
  });

  const [me, setMe] = useState<authApi.SessionUser | null>(null);
  const [tenant, setTenant] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const [termLine, setTermLine] = useState('status');
  const [searchQ, setSearchQ] = useState('студент');

  const put = useCallback((key: string, r: ExecResult) => {
    setResults((prev) => ({ ...prev, [key]: r }));
  }, []);

  const run = useCallback(async (key: string, method: string, path: string, body?: string) => {
    setBusy(key);
    try { put(key, await call(method, path, body)); } finally { setBusy(null); }
  }, [put]);

  const probeAll = useCallback(async () => {
    setBusy('probe');
    try {
      const [h, r, s, m] = await Promise.all([
        call('GET', '/healthz'), call('GET', '/readyz'), call('GET', '/api/v1/openapi.yaml'), call('GET', '/api/v1/auth/me'),
      ]);
      setResults((prev) => ({ ...prev, healthz: h, readyz: r, spec: s, me: m }));
      if (m.ok) {
        try { setMe(JSON.parse(m.text) as authApi.SessionUser); } catch { setMe(null); }
      } else {
        setMe(null);
      }
    } finally { setBusy(null); }
  }, []);

  useEffect(() => { void probeAll(); }, [probeAll]);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setLoginErr('');
    if (!tenant.trim() || !email.trim() || !pass) { setLoginErr('Заполните организацию, email и пароль'); return; }
    setLoginBusy(true);
    try {
      const u = await authApi.apiLogin(tenant.trim(), email.trim(), pass);
      setMe(u);
      put('me', { ok: true, status: 200, ms: 0, contentType: 'application/json', text: JSON.stringify(u, null, 2), at: new Date().toLocaleTimeString() });
    } catch (e2) {
      setLoginErr(e2 instanceof ApiError ? (e2.detail || e2.title) : 'Не удалось связаться с сервером');
    } finally { setLoginBusy(false); }
  };

  const logout = async () => {
    await authApi.apiLogout();
    setMe(null);
    void run('me', 'GET', '/api/v1/auth/me');
  };

  const offline = results.healthz != null && results.healthz.status === 0;

  return (
    <div className="fade">
      <PageHead
        title={<><Server size={20} style={{ verticalAlign: -3, marginRight: 8 }} />Бэкенд · API</>}
        sub={<>Живая витрина бэкенда nexd: реальные запросы, реальные ответы, ошибки в формате RFC 9457. Контракт — <a href={`${API_BASE}/api/v1/openapi.yaml`} target="_blank" rel="noreferrer">api/v1/openapi.yaml</a> (OpenAPI 3.1)</>}
        actions={
          <button className="btn btn-outline btn-sm" onClick={() => void probeAll()} disabled={busy === 'probe'}>
            <RefreshCw size={14} style={busy === 'probe' ? { animation: 'spin .7s linear infinite' } : undefined} /> Перепроверить
          </button>
        }
      />

      {/* индикаторы состояния */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 16 }}>
        <Probe kpi="API" icon={Server} r={results.healthz} label={API_BASE || '(тот же origin)'} />
        <Probe kpi="Liveness" icon={Zap} r={results.healthz} label="GET /healthz" />
        <Probe kpi="Readiness" icon={Activity} r={results.readyz} label="GET /readyz · Postgres" />
        <Probe kpi="Сессия" icon={ShieldCheck} r={results.me} label={me ? me.email : 'не выполнен вход'} />
      </div>

      {offline && (
        <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 16 }}>
          <div className="card-pad" style={{ fontSize: 13.5 }}>
            <b>Бэкенд недоступен.</b> Витрина шлёт запросы на <span className="mono">{API_BASE || '(тот же origin)'}</span> и получает ошибку сети.
            Чтобы всё ожило: запустите <span className="mono">make stack</span> (весь стек в Docker, порт 8080) или <span className="mono">make dev && make run</span> —
            Vite-прокси уже настроен на <span className="mono">localhost:8080</span>. Для отдельного фронтенда задайте <span className="mono">VITE_API_URL</span> (см. .env.example).
          </div>
        </div>
      )}

      {/* сессия */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title"><ShieldCheck size={15} /> Сессия</span>
          {me ? (
            <span className="chips">
              {me.roles.map((r) => <span key={r} className="chip chip-info">{r}</span>)}
              <button className="btn btn-ghost btn-sm" onClick={() => void logout()}><LogOut size={13} /> Выйти</button>
            </span>
          ) : <span className="chip chip-neutral">гость · доменные эндпоинты ответят 401</span>}
        </div>
        {me ? (
          <div className="card-body" style={{ fontSize: 13.5 }}>
            Вы вошли как <b>{me.display_name || me.email}</b> · тенант <span className="mono">{me.tenant.slice(0, 8)}…</span>.
            Теперь чтения и мутации ниже отвечают данными, а каждая мутация появляется в <b>аудите</b> — это и есть хребет Commands → Events → Audit.
          </div>
        ) : (
          <form className="card-body" onSubmit={login}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <input className="input" placeholder="slug организации (tenant)" value={tenant} onChange={(e) => setTenant(e.target.value)} autoComplete="organization" />
              <input className="input" type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
              <input className="input" type="password" placeholder="пароль" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
              <button className="btn btn-primary" type="submit" disabled={loginBusy}><LogIn size={15} /> {loginBusy ? 'Вхожу…' : 'Войти'}</button>
            </div>
            {loginErr && <div className="chip chip-danger" style={{ marginTop: 10 }}>{loginErr}</div>}
            <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              Пользователь ещё не создан? <span className="mono">nexd tenant create &lt;slug&gt; &lt;name&gt;</span> → <span className="mono">nexd user create --tenant &lt;slug&gt; --email …</span> или <span className="mono">make seed</span>
            </div>
          </form>
        )}
      </div>

      {/* терминал — AI-native вход */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title"><Terminal size={15} /> Терминал «Администратор · альфа»</span>
          <span className="chip chip-ai">POST /api/v1/terminal/exec</span>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 10 }}>
            <input className="input mono" value={termLine} onChange={(e) => setTermLine(e.target.value)}
              placeholder="status · tasks · task add · users · notify · audit · whoami"
              onKeyDown={(e) => { if (e.key === 'Enter' && termLine.trim()) void run('terminal', 'POST', '/api/v1/terminal/exec', JSON.stringify({ line: termLine })); }} />
            <button className="btn btn-primary" disabled={busy === 'terminal' || !termLine.trim()} onClick={() => void run('terminal', 'POST', '/api/v1/terminal/exec', JSON.stringify({ line: termLine }))}>Выполнить</button>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            Чтения — через модульные репозитории, мутации — через шину команд с RBAC и аудитом. AI работает теми же авторизованными путями, что и человек.
          </div>
          <Resp r={results.terminal} />
        </div>
      </div>

      {/* поиск */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <span className="card-title"><SearchIcon size={15} /> Сквозной поиск</span>
          <span className="chip chip-info">GET /api/v1/search</span>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 10 }}>
            <input className="input" value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
              placeholder="запрос по задачам, студентам, файлам…"
              onKeyDown={(e) => { if (e.key === 'Enter' && searchQ.trim()) void run('search', 'GET', `/api/v1/search?q=${encodeURIComponent(searchQ.trim())}&limit=20`); }} />
            <button className="btn btn-primary" disabled={busy === 'search' || !searchQ.trim()} onClick={() => void run('search', 'GET', `/api/v1/search?q=${encodeURIComponent(searchQ.trim())}&limit=20`)}>Найти</button>
          </div>
          <Resp r={results.search} />
        </div>
      </div>

      {/* каталог эндпоинтов */}
      {GROUPS.map((g) => {
        const Icon = g.icon;
        return (
          <div className="card" key={g.id} style={{ marginBottom: 16 }}>
            <div className="card-head">
              <span className="card-title"><Icon size={15} /> {g.label}</span>
              <span className="muted" style={{ fontSize: 12.5 }}>{g.note}</span>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {g.items.map((ep) => (
                <EndpointRow key={ep.key} ep={ep} body={bodies[ep.key]} onBody={(v) => setBodies((p) => ({ ...p, [ep.key]: v }))}
                  result={results[ep.key]} busy={busy === ep.key}
                  onRun={() => void run(ep.key, ep.method, ep.path, ep.method === 'POST' ? bodies[ep.key] : undefined)} />
              ))}
            </div>
          </div>
        );
      })}

      <div className="muted" style={{ fontSize: 12.5, marginBottom: 24 }}>
        Метрики Prometheus: <a href={`${API_BASE}/metrics`} target="_blank" rel="noreferrer">/metrics</a> (nexd) · ai-gateway — свой /metrics · Bruno-коллекция — <span className="mono">api/bruno/</span> · смоук — <span className="mono">make smoke-api</span>
      </div>
    </div>
  );
}

/* ---------- вспомогательные блоки ---------- */

function Probe({ kpi, icon: Icon, r, label }: { kpi: string; icon: LucideIcon; r?: ExecResult; label: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label"><Icon size={13} /> {kpi}</div>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        {r == null ? <span className="chip chip-neutral">проверяю…</span> : (
          <span className={`chip ${statusTone(r)}`}>
            {r.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            {statusLabel(r)}{r.ok && r.ms ? ` · ${r.ms} мс` : ''}
          </span>
        )}
      </div>
      <div className="kpi-foot muted mono" style={{ fontSize: 11 }}>{label}</div>
    </div>
  );
}

function Resp({ r }: { r?: ExecResult }) {
  if (r == null) return null;
  const body = pretty(r);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span className={`chip ${statusTone(r)}`}>{statusLabel(r)}</span>
        <span className="muted" style={{ fontSize: 12 }}>{r.ms} мс · {r.contentType || '—'} · {r.at}</span>
      </div>
      <pre className="mono" style={{
        margin: 0, padding: 12, fontSize: 12, lineHeight: 1.5, overflow: 'auto', maxHeight: 320,
        background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>{body || '(пустой ответ)'}</pre>
    </div>
  );
}

function EndpointRow({ ep, body, onBody, result, busy, onRun }: {
  ep: Endpoint; body?: string; onBody: (v: string) => void; result?: ExecResult; busy: boolean; onRun: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className={`chip ${ep.method === 'GET' ? 'chip-info' : 'chip-warn'}`}>{ep.method}</span>
        <span className="mono" style={{ fontSize: 12.5 }}>{ep.path}</span>
        <span className="muted" style={{ fontSize: 12.5, flex: 1, minWidth: 200 }}>{ep.desc}</span>
        <span style={{ display: 'flex', gap: 6 }}>
          {result != null && (
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)}>
              {open ? 'Скрыть' : <><FileJson size={13} /> Ответ</>}
            </button>
          )}
          <button className="btn btn-outline btn-sm" onClick={onRun} disabled={busy}>
            {busy ? '…' : 'Выполнить'}
          </button>
        </span>
      </div>

      {ep.method === 'POST' && body != null && (
        <textarea className="input mono" value={body} onChange={(e) => onBody(e.target.value)} rows={4}
          style={{ marginTop: 10, height: 'auto', padding: 10, fontSize: 12, resize: 'vertical' }} />
      )}

      {result != null && open && <Resp r={result} />}
    </div>
  );
}

export default Backend;
