import { useState, useEffect, useRef, Fragment, type FormEvent, type CSSProperties } from 'react';
import {
  ArrowUp, ArrowRight, ShieldAlert, ShieldCheck, Wallet, Users, FileSignature, Sun, Sunrise, Moon,
  Activity, Radio, Gauge, Sparkles, CornerDownLeft, ChevronRight, ListChecks, TrendingUp, TrendingDown,
} from 'lucide-react';
import { useApp, Sparkline } from '../ui';
import {
  finance, aiInsights, sessions, failedLogins, failedLoginTrend, services, nexLog, students,
} from '../data';
import { attendanceRate } from '../nexbrain';

/* ============================================================
   Главное для администратора — «оперативный центр».
   Вход в систему ощущается как запуск командного пункта:
   приборы оживают, NEX докладывает обстановку, всё под рукой.
   Для остальных ролей — спокойная сводка дня (CalmHome ниже).
   ============================================================ */

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return { hi: 'Доброй ночи', icon: Moon };
  if (h < 12) return { hi: 'Доброе утро', icon: Sunrise };
  if (h < 18) return { hi: 'Добрый день', icon: Sun };
  return { hi: 'Добрый вечер', icon: Moon };
}

/* число «оживает» при запуске — приборы выходят на режим */
function useCountUp(target: number, run: boolean, ms = 700) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) { setV(target); return; }
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min((t - t0) / ms, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return v;
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return <span className="deck-clock">{hh}<i>:</i>{mm}<i>:</i><small>{ss}</small></span>;
}

type Vital = { id: string; label: string; value: number; fmt?: (n: number) => string; delta?: string; up?: boolean; tone?: string; spark?: number[]; ring?: number };

function VitalTile({ v, booting, i }: { v: Vital; booting: boolean; i: number }) {
  const n = useCountUp(v.value, booting);
  const shown = v.fmt ? v.fmt(n) : Math.round(n).toLocaleString('ru');
  return (
    <div className="vital" style={{ '--d': `${i * 70}ms`, '--tone': v.tone || 'var(--accent)' } as CSSProperties}>
      <div className="vital-top">
        <span className="vital-label">{v.label}</span>
        {v.spark && <Sparkline data={v.spark} color={v.tone || 'var(--accent)'} width={64} height={20} />}
      </div>
      <div className="vital-value" style={{ color: v.tone }}>{shown}</div>
      {v.delta && (
        <div className="vital-foot" style={{ color: v.up ? 'var(--success)' : 'var(--danger)' }}>
          {v.up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{v.delta}
        </div>
      )}
    </div>
  );
}

function CommandDeck() {
  const { user, setPage, openChat } = useApp();
  const [q, setQ] = useState('');
  const [booting, setBooting] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => setBooting(false), 900); return () => clearTimeout(t); }, []);

  const name = user?.name?.split(' ')[0] || 'командир';
  const g = greeting();
  const GIcon = g.icon;
  const today = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  const threats = failedLogins.filter((f) => f.flagged).length;
  const received = finance.payments.filter((p) => p.status === 'Оплачено').reduce((a, p) => a + p.sum, 0);
  const attendance = Math.round(students.reduce((a, s) => a + attendanceRate(s.id), 0) / students.length);
  const risk = students.filter((s) => attendanceRate(s.id) < 78).length;
  const degraded = services.filter((s) => s.status !== 'ok').length;

  const vitals: Vital[] = [
    { id: 'sess', label: 'Активные сессии', value: sessions.length, delta: 'штатно', up: true, spark: [3, 4, 3, 5, 4, 4, sessions.length], tone: 'var(--accent)' },
    { id: 'threat', label: 'Угрозы входа', value: threats, delta: 'за ночь', up: false, spark: failedLoginTrend, tone: threats ? 'var(--danger)' : 'var(--success)' },
    { id: 'fin', label: 'Поступления, ₽', value: received, fmt: (n) => Math.round(n).toLocaleString('ru'), delta: '+5% к плану', up: true, spark: [40, 52, 48, 61, 55, 70, 62], tone: 'var(--success)' },
    { id: 'att', label: 'Посещаемость', value: attendance, fmt: (n) => Math.round(n) + '%', delta: '−2%', up: false, spark: [88, 86, 90, 84, 87, 85, attendance], tone: 'var(--ai)' },
  ];

  const board = [
    { id: 'security', sev: 'critical', ic: ShieldAlert, title: 'Подбор пароля ночью', meta: `12 неудачных входов · 1 адрес помечен`, go: 'security' },
    { id: 'finance', sev: 'high', ic: Wallet, title: `${finance.payments.filter((p) => p.status !== 'Оплачено').length} студента не оплатили обучение`, meta: 'Срок по договору — до 30 июня', go: 'fin-overview' },
    { id: 'risk', sev: 'medium', ic: Users, title: `${risk} студента в зоне риска`, meta: 'Посещаемость ниже нормы, оценки падают', go: 'students' },
    { id: 'docs', sev: 'low', ic: FileSignature, title: '2 приказа ждут подписи', meta: 'NEX собрал документы и проверил данные', go: 'tasks' },
  ] as const;

  const SEV: Record<string, { label: string; color: string }> = {
    critical: { label: 'критично', color: 'var(--danger)' },
    high: { label: 'важно', color: 'var(--warn)' },
    medium: { label: 'внимание', color: 'var(--accent)' },
    low: { label: 'плановое', color: 'var(--text-3)' },
  };

  const commands = [
    { label: 'Сводка обстановки', q: 'Дай полную сводку по колледжу: что важно прямо сейчас.' },
    { label: 'Зона риска', q: 'Покажи студентов в зоне риска и объясни причины.' },
    { label: 'Финансы', q: 'Что с деньгами и задолженностью? Дай прогноз.' },
    { label: 'Безопасность', q: 'Оцени состояние безопасности: входы, аномалии, что закрыть.' },
  ];

  const submit = (e: FormEvent) => { e.preventDefault(); openChat(q.trim() || undefined); };
  const statusOk = threats === 0 && degraded === 0;

  return (
    <div className={`deck ${booting ? 'booting' : ''}`}>
      {/* --- Верх: приветствие, часы, статус системы --- */}
      <header className="deck-top" style={{ '--d': '0ms' } as CSSProperties}>
        <div className="deck-hello">
          <span className="deck-hello-ic"><GIcon size={18} /></span>
          <div>
            <h1>{g.hi}, {name}</h1>
            <div className="deck-sub">{today} · система готова к работе</div>
          </div>
        </div>
        <div className="deck-top-right">
          <LiveClock />
          <div className={`deck-online ${statusOk ? 'ok' : 'warn'}`}>
            <span className="deck-dot" />
            {statusOk ? 'Все системы в норме' : `${threats + degraded} требует внимания`}
          </div>
        </div>
      </header>

      {/* --- Приборы --- */}
      <div className="deck-vitals">
        {vitals.map((v, i) => <Fragment key={v.id}><VitalTile v={v} booting={booting} i={i} /></Fragment>)}
      </div>

      {/* --- Командная строка NEX (на всю ширину) --- */}
      <form className="console" onSubmit={submit} style={{ '--d': '120ms' } as CSSProperties} onClick={() => inputRef.current?.focus()}>
        <div className="console-head">
          <Sparkles size={15} className="console-spark" />
          <span className="console-tag">NEX · командная строка</span>
          <span className="console-kbd"><kbd>⌘</kbd><kbd>K</kbd> в любой момент</span>
        </div>
        <div className="console-line">
          <span className="console-prompt">⟩</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Отдайте команду или спросите — например, «сколько соберём, если все должники заплатят»" />
          <button className="console-send" type="submit" aria-label="Выполнить"><CornerDownLeft size={15} /></button>
        </div>
        <div className="console-chips">
          {commands.map((c) => (
            <button type="button" key={c.label} className="console-chip" onClick={(e) => { e.stopPropagation(); openChat(c.q); }}>
              <Sparkles size={11} />{c.label}
            </button>
          ))}
        </div>
      </form>

      {/* --- Рабочая зона: слева приоритеты, справа состояние системы --- */}
      <div className="deck-grid">
        <section className="panel ops" style={{ '--d': '180ms' } as CSSProperties}>
          <div className="panel-h"><Gauge size={15} /> Требует решения<span className="panel-h-count">{board.length}</span></div>
          <div className="ops-list">
            {board.map((b) => {
              const Icon = b.ic; const s = SEV[b.sev];
              return (
                <button key={b.id} className="op-row" onClick={() => setPage(b.go)}>
                  <span className="op-sev" style={{ background: s.color }} />
                  <span className="op-ic" style={{ color: s.color, background: `color-mix(in srgb, ${s.color} 14%, transparent)` }}><Icon size={17} /></span>
                  <span className="op-main">
                    <span className="op-title">{b.title}</span>
                    <span className="op-meta">{b.meta}</span>
                  </span>
                  <span className="op-sev-label" style={{ color: s.color }}>{s.label}</span>
                  <ChevronRight size={16} className="op-arrow" />
                </button>
              );
            })}
          </div>
        </section>

        <aside className="panel deck-status" style={{ '--d': '240ms' } as CSSProperties}>
          <div className="panel-h"><ShieldCheck size={15} /> Состояние системы</div>

          <div className="deck-status-sec">
            <div className="deck-sub-h">Целостность подсистем</div>
            <div className="deck-svc">
              {services.map((s) => (
                <div className="deck-svc-row" key={s.name}>
                  <span className={`svc-dot ${s.status}`} />
                  <span className="deck-svc-name">{s.name}</span>
                  <span className="deck-svc-val">{s.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="deck-status-sec">
            <div className="deck-sub-h"><Radio size={12} /> Журнал NEX <span className="deck-live"><span className="deck-dot" />live</span></div>
            <div className="deck-log">
              {nexLog.slice(0, 3).map((l) => (
                <div className="deck-log-row" key={l.id}>
                  <span className="deck-log-dot" />
                  <div><div className="deck-log-t">{l.text}</div><div className="deck-log-time">{l.time}</div></div>
                </div>
              ))}
            </div>
            <button className="deck-log-more" onClick={() => setPage('nexlog')}>Вся история NEX <ArrowRight size={13} /></button>
          </div>

          <div className="deck-status-sec">
            <div className="deck-sub-h"><Activity size={12} /> Наблюдения ИИ <span className="panel-h-count">{aiInsights.length}</span></div>
            <div className="deck-insights">
              {aiInsights.slice(0, 2).map((it) => (
                <button key={it.id} className="deck-insight" onClick={() => setPage(it.page)}>
                  <span className="deck-insight-pct">{Math.round(it.confidence * 100)}%</span>
                  <span className="deck-insight-tx">{it.title}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ============================================================
   Спокойная сводка дня — для преподавателя/бухгалтера/студента.
   ============================================================ */
function CalmHome() {
  const { user, setPage, openChat } = useApp();
  const [q, setQ] = useState('');
  const unpaid = finance.payments.filter((p) => p.status !== 'Оплачено').length;
  const risk = aiInsights.find((i) => i.page === 'students');
  const TONE_ICON = { danger: 'var(--danger)', warn: 'var(--warn)', info: 'var(--accent)' } as const;

  const cards = [
    { id: 'finance', icon: Wallet, tone: 'warn' as const, title: `${unpaid} студента ещё не заплатили за обучение`, detail: 'Срок по договору — до 30 июня. Можно отправить всем вежливое напоминание.', action: 'Открыть оплату', go: 'fin-overview' },
    { id: 'risk', icon: Users, tone: 'info' as const, title: risk?.title ?? 'Несколько студентов реже ходят на занятия', detail: risk?.desc ?? 'Посещаемость и оценки поползли вниз.', action: 'Показать студентов', go: 'students' },
    { id: 'docs', icon: ListChecks, tone: 'info' as const, title: 'Задачи на сегодня собраны', detail: 'NEX сложил всё важное в один список — по порядку важности.', action: 'Открыть задачи', go: 'tasks' },
  ];

  const g = greeting();
  const GIcon = g.icon;
  const name = user?.name?.split(' ')[0] || 'коллега';
  const today = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const submit = (e: FormEvent) => { e.preventDefault(); openChat(q.trim() || undefined); };

  return (
    <div className="fade home">
      <div className="home-hi">
        <span className="home-hi-ic"><GIcon size={22} /></span>
        <div><h1>{g.hi}, {name}</h1><div className="home-date">{today}</div></div>
      </div>
      <p className="home-brief">Пока вас не было, NEX присмотрел за колледжем. <b>{unpaid} студента</b> не оплатили обучение, у нескольких падает посещаемость. Ниже — что стоит сделать сегодня.</p>
      <div className="home-tasks">
        {cards.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.id} className="home-task" onClick={() => setPage(t.go)}>
              <span className="home-task-ic" style={{ color: TONE_ICON[t.tone], background: `color-mix(in srgb, ${TONE_ICON[t.tone]} 14%, transparent)` }}><Icon size={20} /></span>
              <div className="home-task-main"><div className="home-task-title">{t.title}</div><div className="home-task-detail">{t.detail}</div></div>
              <button className="btn btn-primary home-task-btn" onClick={(e) => { e.stopPropagation(); setPage(t.go); }}>{t.action} <ArrowRight size={15} /></button>
            </div>
          );
        })}
      </div>
      <form className="home-ask" onSubmit={submit}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Спросите NEX своими словами — например, «сколько соберём, если все должники заплатят»" />
        <button className="home-ask-send" type="submit" aria-label="Спросить NEX"><ArrowUp size={18} /></button>
      </form>
      <div className="home-ask-hint">NEX ответит понятно и, если нужно, сам откроет нужный раздел.</div>
    </div>
  );
}

export default function Home() {
  const { user } = useApp();
  return user?.role === 'admin' ? <CommandDeck /> : <CalmHome />;
}
