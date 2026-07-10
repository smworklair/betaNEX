import { useState, useEffect, useRef, type FormEvent, type CSSProperties } from 'react';
import {
  ArrowUp, ArrowRight, Wallet, Users, Sun, Sunrise, Moon,
  Sparkles, CornerDownLeft, ChevronRight, ListChecks, BookOpen, MessageSquare, CalendarDays,
} from 'lucide-react';
import { useApp } from '../ui';
import { finance, aiInsights, failedLogins, nexLog, students } from '../data';
import { attendanceRate } from '../nexbrain';

/* ============================================================
   Главное для администратора — спокойный вход в работу.
   Не пульт с тревогами, а тихое рабочее место: приветствие,
   часы, командная строка NEX и мягкий список того, чем стоит
   заняться. Ничего не мигает и не кричит.
   Для остальных ролей — сводка дня (CalmHome ниже).
   ============================================================ */

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return { hi: 'Доброй ночи', icon: Moon };
  if (h < 12) return { hi: 'Доброе утро', icon: Sunrise };
  if (h < 18) return { hi: 'Добрый день', icon: Sun };
  return { hi: 'Добрый вечер', icon: Moon };
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return <span className="deck-clock">{hh}<i>:</i>{mm}<i>:</i><small>{ss}</small></span>;
}

function CommandDeck() {
  const { user, setPage, openChat } = useApp();
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const name = user?.name?.split(' ')[0] || 'коллега';
  const g = greeting();
  const GIcon = g.icon;
  const today = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  const threats = failedLogins.filter((f) => f.flagged).length;
  const unpaid = finance.payments.filter((p) => p.status !== 'Оплачено').length;
  const risk = students.filter((s) => attendanceRate(s.id) < 78).length;

  /* Тёплые точки входа — куда человек обычно идёт работать */
  const shortcuts = [
    { label: 'Финансы', icon: Wallet, go: 'fin-overview' },
    { label: 'Студенты', icon: Users, go: 'students' },
    { label: 'Журнал', icon: BookOpen, go: 'journal' },
    { label: 'Задачи', icon: ListChecks, go: 'tasks' },
    { label: 'Сообщения', icon: MessageSquare, go: 'mail' },
    { label: 'Календарь', icon: CalendarDays, go: 'calendar' },
  ];

  /* Мягкий список на сегодня — без цветных полос и капслока */
  const today_items = [
    threats ? { id: 'security', dot: 'var(--danger)', title: `${threats} подозрительных входа за ночь`, meta: 'Стоит проверить и при необходимости закрыть доступ', go: 'security' } : null,
    { id: 'finance', dot: 'var(--warn)', title: `${unpaid} студента ещё не оплатили обучение`, meta: 'Срок по договору — до 30 июня', go: 'fin-overview' },
    { id: 'risk', dot: 'var(--accent)', title: `${risk} студента реже ходят на занятия`, meta: 'Посещаемость понемногу снижается', go: 'students' },
    { id: 'docs', dot: 'var(--text-3)', title: '2 приказа ждут подписи', meta: 'NEX собрал документы и проверил данные', go: 'tasks' },
  ].filter(Boolean) as { id: string; dot: string; title: string; meta: string; go: string }[];

  const commands = [
    { label: 'Сводка дня', q: 'Дай короткую и спокойную сводку по колледжу: что важно сегодня.' },
    { label: 'Зона риска', q: 'Покажи студентов в зоне риска и объясни причины.' },
    { label: 'Финансы', q: 'Что с деньгами и задолженностью? Дай прогноз.' },
    { label: 'Безопасность', q: 'Оцени состояние безопасности: входы, аномалии, что закрыть.' },
  ];

  const submit = (e: FormEvent) => { e.preventDefault(); openChat(q.trim() || undefined); };

  return (
    <div className="deck calm">
      {/* --- Приветствие и часы --- */}
      <header className="deck-top" style={{ '--d': '0ms' } as CSSProperties}>
        <div className="deck-hello">
          <span className="deck-hello-ic"><GIcon size={18} /></span>
          <div>
            <h1>{g.hi}, {name}</h1>
            <div className="deck-sub">{today}</div>
          </div>
        </div>
        <div className="deck-top-right">
          <LiveClock />
          <div className="deck-quiet">Хорошего дня — всё под присмотром NEX</div>
        </div>
      </header>

      {/* --- Спокойная строка о том, что было без вас --- */}
      <p className="deck-brief" style={{ '--d': '80ms' } as CSSProperties}>
        Пока вас не было, NEX присмотрел за колледжем. Сегодня стоит обратить внимание на <b>{unpaid} неоплаченных договора</b> и <b>{risk} студентов</b> с падающей посещаемостью. Ничего срочного — можно спокойно разобрать по порядку.
      </p>

      {/* --- Командная строка NEX (оставлена как есть) --- */}
      <form className="console" onSubmit={submit} style={{ '--d': '140ms' } as CSSProperties} onClick={() => inputRef.current?.focus()}>
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

      {/* --- Тёплые точки входа --- */}
      <div className="deck-shortcuts" style={{ '--d': '200ms' } as CSSProperties}>
        {shortcuts.map((s) => {
          const Icon = s.icon;
          return (
            <button key={s.label} className="deck-shortcut" onClick={() => setPage(s.go)}>
              <span className="deck-shortcut-ic"><Icon size={18} /></span>
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>

      {/* --- Рабочая зона: слева на сегодня, справа недавнее --- */}
      <div className="deck-grid">
        <section className="panel soft" style={{ '--d': '260ms' } as CSSProperties}>
          <div className="panel-h soft-h">На сегодня<span className="panel-h-count">{today_items.length}</span></div>
          <div className="ops-list">
            {today_items.map((b) => (
              <button key={b.id} className="op-row soft" onClick={() => setPage(b.go)}>
                <span className="op-dot" style={{ background: b.dot }} />
                <span className="op-main">
                  <span className="op-title">{b.title}</span>
                  <span className="op-meta">{b.meta}</span>
                </span>
                <ChevronRight size={16} className="op-arrow" />
              </button>
            ))}
          </div>
        </section>

        <aside className="panel soft" style={{ '--d': '320ms' } as CSSProperties}>
          <div className="panel-h soft-h"><Sparkles size={14} style={{ color: 'var(--ai)' }} /> Недавнее у NEX</div>
          <div className="deck-log soft-log">
            {nexLog.slice(0, 4).map((l) => (
              <div className="deck-log-row" key={l.id}>
                <span className="deck-log-dot" />
                <div><div className="deck-log-t">{l.text}</div><div className="deck-log-time">{l.time}</div></div>
              </div>
            ))}
          </div>
          <button className="deck-log-more" onClick={() => setPage('nexlog')}>Вся история NEX <ArrowRight size={13} /></button>
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
