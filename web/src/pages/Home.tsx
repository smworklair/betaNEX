import { useState, useEffect, useRef, Fragment, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  ArrowUp, ArrowRight, Wallet, Users, Sun, Sunrise, Moon,
  Sparkles, CornerDownLeft, ChevronRight, ChevronLeft, ChevronUp, ChevronDown,
  ListChecks, Settings2, Check, RotateCcw, EyeOff, Plus, X, Eraser, ExternalLink,
} from 'lucide-react';
import { useApp } from '../ui';
import { finance, aiInsights, failedLogins, students } from '../data';
import { attendanceRate, nexReply, PAGE_TITLES, type NavLink, type NexData } from '../nexbrain';
import { llmReady, llmAsk } from '../llm';
import { Md } from '../md';
import { DataBlock } from '../nexdata';
import {
  HOME_BLOCK_CATALOG, HOME_BLOCK_BY_ID, DEFAULT_HOME_BLOCKS,
  HOME_SHORTCUT_CATALOG, HOME_SHORTCUT_BY_ID, DEFAULT_HOME_SHORTCUTS, moveInArray,
} from '../home';

/* ============================================================
   Главное для администратора — стол, за который приятно сесть.
   Тихое рабочее место: приветствие, спокойные часы, встроенный
   терминал NEX (запрос и ответ живут прямо здесь, без ухода в
   отдельный чат) и мягкий список того, с чего можно начать.
   Для остальных ролей — сводка дня (CalmHome ниже).
   ============================================================ */

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return { hi: 'Доброй ночи', icon: Moon };
  if (h < 12) return { hi: 'Доброе утро', icon: Sunrise };
  if (h < 18) return { hi: 'Добрый день', icon: Sun };
  return { hi: 'Добрый вечер', icon: Moon };
}

/* Тихие часы: минуты без секунд и мигания — время как фон, а не таймер. */
function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(id); }, []);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return <span className="deck-clock">{hh}:{mm}</span>;
}

/* ============================================================
   Терминал NEX — командная строка сисадмина прямо на «Главном».
   Запрос и ответ живут в блоке: журнал сессии (переживает
   переходы по разделам через sessionStorage), история команд
   по ↑/↓, встроенные команды help / clear / open <раздел> и
   набор именованных запросов состояния (status/risk/finance/
   security) — они отвечают мгновенно и без ИИ, готовым срезом
   данных (таблица/график/KPI), как настоящая консоль диагностики,
   а не диалог. Всё остальное, что не распознано как команда, —
   вопрос к NEX тем же движком, что и полный чат (LLM при
   подключённом ключе, иначе локальный nexbrain); и то, и другое
   тоже может вернуть структурированный блок, если он есть.
   ============================================================ */

interface TermMsg { who: 'u' | 'n'; text: string; nav?: NavLink[]; action?: string; data?: NexData; pending?: boolean; }

const TERM_KEY = 'nex-terminal-log';
const TERM_LIMIT = 60; // строк журнала храним не больше этого

/* Именованные команды состояния: отвечают напрямую данными системы
   (через nexReply, без похода к LLM) — таблица риска, финансовая
   сводка, панель KPI, статус безопасности. Ключ — как набирает
   пользователь, значение — каноническая фраза для nexReply. */
const STATUS_COMMANDS: Record<string, string> = {
  status: 'статус', 'статус': 'статус', 'сводка': 'статус',
  risk: 'риск', 'риск': 'риск', 'риски': 'риск',
  finance: 'финансы', 'финансы': 'финансы', 'деньги': 'финансы',
  security: 'безопасность', 'безопасность': 'безопасность',
};

/* Список для подсказки под строкой ввода — те же ключи, без дублей. */
const STATUS_COMMAND_LIST = ['status', 'risk', 'finance', 'security'];
const KNOWN_TOKENS = new Set(['help', '?', 'помощь', 'clear', 'очистить', 'open', 'открой', 'открыть', ...Object.keys(STATUS_COMMANDS)]);

const TERM_HELP = [
  '**Команды терминала:**',
  '- `help` — эта справка;',
  '- `clear` — очистить экран;',
  '- `open <раздел>` — открыть раздел, например `open финансы`;',
  '- `status` / `risk` / `finance` / `security` — срез данных без ИИ: KPI, риск, финансы, безопасность;',
  '- стрелки ↑/↓ — история команд.',
  '',
  'Всё остальное — вопрос к NEX своими словами: «кто в зоне риска», «что с деньгами», «сводка дня».',
].join('\n');

/* Сессия терминала (журнал + история команд) живёт в sessionStorage
   и переживает переходы по разделам в рамках вкладки. */
function loadTermSession(): { log: TermMsg[]; hist: string[] } {
  try {
    const raw = JSON.parse(sessionStorage.getItem(TERM_KEY) || '{}');
    // «pending» переживший вкладку (закрыта посреди запроса к LLM) не
    // должен грузиться зависшим мигающим курсором — только сам факт,
    // что запрос был прерван.
    const log: TermMsg[] = (raw.log || []).filter((m: TermMsg) => !m.pending);
    return { log, hist: raw.hist || [] };
  } catch { return { log: [], hist: [] }; }
}

/* Подсвечивает распознанную команду в эхе введённой строки (первое
   слово из KNOWN_TOKENS) — так видно, что именно превратилось в
   вызов, а не в свободный вопрос. */
function TermEcho({ text }: { text: string }) {
  const m = text.match(/^(\S+)([\s\S]*)$/);
  if (!m) return <>{text}</>;
  const [, head, rest] = m;
  if (!KNOWN_TOKENS.has(head.toLowerCase())) return <>{text}</>;
  return <><b className="term-cmd">{head}</b>{rest}</>;
}

function NexTerminal({ disabled, chips }: { disabled: boolean; chips: { label: string; q: string }[] }) {
  const { setPage, openChat, toast } = useApp();
  const [session] = useState(loadTermSession);
  const [log, setLog] = useState<TermMsg[]>(session.log);
  const [q, setQ] = useState('');
  const [hist, setHist] = useState<string[]>(session.hist);
  const [hIdx, setHIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { sessionStorage.setItem(TERM_KEY, JSON.stringify({ log, hist: hist.slice(-30) })); } catch { /* квота — не критично */ }
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, hist]);

  const push = (...ms: TermMsg[]) => setLog((l) => [...l, ...ms].slice(-TERM_LIMIT));

  /* open <раздел>: ищем по ярлыкам главного и известным страницам */
  const openSection = (name: string): TermMsg => {
    const n = name.trim().toLowerCase();
    const targets = [
      ...HOME_SHORTCUT_CATALOG.map((s) => ({ label: s.label, page: s.page })),
      ...Object.entries(PAGE_TITLES).map(([page, label]) => ({ label, page })),
    ];
    const hit = targets.find((t) => t.label.toLowerCase() === n) || targets.find((t) => t.label.toLowerCase().includes(n));
    // Переход с задержкой: даём журналу зафиксироваться в sessionStorage
    // до того, как «Главное» размонтируется.
    if (hit) { window.setTimeout(() => setPage(hit.page), 200); return { who: 'n', text: `Открываю «${hit.label}».` }; }
    return { who: 'n', text: `Раздел «${name}» не нашёл. Например: ${targets.slice(0, 6).map((t) => t.label.toLowerCase()).join(', ')}…` };
  };

  const run = async (raw: string) => {
    const cmd = raw.trim();
    if (!cmd || busy || disabled) return;
    setQ(''); setHIdx(null);
    setHist((h) => (h[h.length - 1] === cmd ? h : [...h, cmd]));

    const low = cmd.toLowerCase();
    if (low === 'clear' || low === 'очистить') { setLog([]); return; }
    push({ who: 'u', text: cmd });
    if (low === 'help' || low === '?' || low === 'помощь') { push({ who: 'n', text: TERM_HELP }); return; }
    const open = low.match(/^(?:open|открой|открыть)\s+(.+)$/);
    if (open) { push(openSection(open[1])); return; }

    // Именованные команды состояния — считаются без ИИ, отвечают
    // мгновенно готовым срезом данных. Проверяются до похода к LLM:
    // это инженерные примитивы консоли, а не тема для диалога.
    const status = STATUS_COMMANDS[low];
    if (status) {
      const a = nexReply(status, { page: 'home' });
      push({ who: 'n', text: a.text, nav: a.nav, action: a.action, data: a.data });
      return;
    }

    if (llmReady()) {
      setBusy(true);
      push({ who: 'n', text: '', pending: true });
      try {
        const text = await llmAsk(cmd, { system: 'Ты — NEX, терминал информационной системы колледжа. Отвечаешь администратору системы: коротко, по делу, по-русски.' });
        setLog((l) => [...l.slice(0, -1), { who: 'n', text }]);
        return;
      } catch {
        setLog((l) => l.slice(0, -1)); // LLM недоступен — локальный мозг ниже
      } finally { setBusy(false); }
    }
    const a = nexReply(cmd, { page: 'home' });
    push({ who: 'n', text: a.text, nav: a.nav, action: a.action, data: a.data });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      if (!hist.length) return;
      e.preventDefault();
      const i = hIdx === null ? hist.length - 1 : Math.max(0, hIdx - 1);
      setHIdx(i); setQ(hist[i]);
    } else if (e.key === 'ArrowDown') {
      if (hIdx === null) return;
      e.preventDefault();
      const i = hIdx + 1;
      if (i >= hist.length) { setHIdx(null); setQ(''); } else { setHIdx(i); setQ(hist[i]); }
    }
  };

  return (
    <form className="console term" onSubmit={(e) => { e.preventDefault(); run(q); }} onClick={() => !disabled && inputRef.current?.focus()}>
      <div className="console-head">
        <Sparkles size={15} className="console-spark" />
        <span className="console-tag">Терминал NEX</span>
        <span className="console-kbd"><kbd>⌘</kbd><kbd>K</kbd> из любого места</span>
        <div className="term-tools">
          {log.length > 0 && (
            <button type="button" className="icon-btn" title="Очистить экран (clear)" onClick={(e) => { e.stopPropagation(); setLog([]); }}><Eraser size={15} /></button>
          )}
          <button type="button" className="icon-btn" title="Открыть полный чат" onClick={(e) => { e.stopPropagation(); if (!disabled) openChat(); }}><ExternalLink size={15} /></button>
        </div>
      </div>

      {/* Реальные команды консоли — не нужно набирать help, чтобы их увидеть. */}
      <div className="term-legend">
        {STATUS_COMMAND_LIST.map((c) => <code key={c}>{c}</code>)}
        <code>open &lt;раздел&gt;</code>
        <code>help</code>
      </div>

      {log.length > 0 && (
        <div className="term-body" ref={bodyRef}>
          {log.map((m, i) => m.who === 'u' ? (
            <div className="term-u" key={i}><span className="term-prompt">›</span><TermEcho text={m.text} /></div>
          ) : (
            <div className="term-n" key={i}>
              {m.pending ? (
                <span className="term-busy"><span className="term-cursor" />обращаюсь к модели…</span>
              ) : (
                <>
                  <Md text={m.text} />
                  {m.data && <DataBlock kind={m.data} />}
                </>
              )}
              {(m.nav?.length || m.action) ? (
                <div className="term-nav">
                  {m.nav?.map((n) => (
                    <button type="button" key={n.page + n.label} className="chip-btn" onClick={() => setPage(n.page)}>{n.label} <ArrowRight size={12} /></button>
                  ))}
                  {m.action && <button type="button" className="btn btn-sm btn-primary" onClick={() => toast(m.action + ' — выполнено')}>{m.action}</button>}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <div className="console-line">
        <span className="term-prompt">›</span>
        <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setHIdx(null); }} onKeyDown={onKeyDown} disabled={disabled || busy}
          placeholder={log.length ? 'Следующая команда — или help' : 'Спросите или скомандуйте: «кто в зоне риска», «что с деньгами», open финансы, help'} />
        <button className="console-send" type="submit" aria-label="Выполнить"><CornerDownLeft size={15} /></button>
      </div>

      {chips.length > 0 && (
        <div className="console-chips">
          {chips.map((c) => (
            <button type="button" key={c.label} className="console-chip" onClick={(e) => { e.stopPropagation(); run(c.q); }}>{c.label}</button>
          ))}
        </div>
      )}
    </form>
  );
}

function CommandDeck() {
  const { user, setPage, prefs, setPref, homeEditing, setHomeEditing, toast } = useApp();
  /* уходя с главного, выходим из режима конструктора */
  useEffect(() => () => setHomeEditing(false), [setHomeEditing]);

  const name = prefs.homeName.trim() || user?.name?.split(' ')[0] || 'коллега';
  const g = greeting();
  const GIcon = g.icon;
  const today = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  const threats = failedLogins.filter((f) => f.flagged).length;
  const unpaid = finance.payments.filter((p) => p.status !== 'Оплачено').length;
  const risk = students.filter((s) => attendanceRate(s.id) < 78).length;

  /* --- Конструктор: видимые блоки и ярлыки из настроек --- */
  const blocks = (prefs.homeBlocks?.length ? prefs.homeBlocks : DEFAULT_HOME_BLOCKS).filter((id) => HOME_BLOCK_BY_ID[id]);
  const hiddenBlocks = HOME_BLOCK_CATALOG.filter((b) => !blocks.includes(b.id));
  const shortcutIds = (prefs.homeShortcuts?.length ? prefs.homeShortcuts : DEFAULT_HOME_SHORTCUTS).filter((id) => HOME_SHORTCUT_BY_ID[id]);
  const hiddenShortcuts = HOME_SHORTCUT_CATALOG.filter((s) => !shortcutIds.includes(s.id));
  const setBlocks = (v: string[]) => setPref('homeBlocks', v);
  const setSc = (v: string[]) => setPref('homeShortcuts', v);
  const resetHome = () => {
    setBlocks(DEFAULT_HOME_BLOCKS); setSc(DEFAULT_HOME_SHORTCUTS);
    setPref('homeShortcutStyle', 'columns'); setPref('homeClock', true);
    setPref('homeChips', true); setPref('homeName', '');
    toast('Главный экран сброшен к стандартному виду');
  };

  const today_items = [
    threats ? { id: 'security', dot: 'var(--danger)', title: `${threats} подозрительных входа за ночь`, meta: 'Стоит проверить и при необходимости закрыть доступ', go: 'security' } : null,
    { id: 'finance', dot: 'var(--warn)', title: `${unpaid} студента ещё не оплатили обучение`, meta: 'Срок по договору — до 30 июня', go: 'fin-overview' },
    { id: 'risk', dot: 'var(--accent)', title: `${risk} студента реже ходят на занятия`, meta: 'Посещаемость понемногу снижается', go: 'students' },
    { id: 'docs', dot: 'var(--text-3)', title: '2 приказа ждут подписи', meta: 'NEX собрал документы и проверил данные', go: 'tasks' },
  ].filter(Boolean) as { id: string; dot: string; title: string; meta: string; go: string }[];

  /* Подсказки — вопросы, а не приказы: приглашают начать разговор. */
  const commands = [
    { label: 'Что важно сегодня?', q: 'Дай короткую и спокойную сводку по колледжу: что важно сегодня.' },
    { label: 'Как дела с деньгами?', q: 'Что с деньгами и задолженностью? Дай прогноз.' },
    { label: 'Кому нужно внимание?', q: 'Покажи студентов в зоне риска и объясни причины.' },
    { label: 'Всё ли спокойно?', q: 'Оцени состояние безопасности: входы, аномалии, что закрыть.' },
  ];

  const nav = (p: string) => { if (!homeEditing) setPage(p); };

  /* --- Рендер отдельного блока (без обвязки редактирования) --- */
  const renderBlock = (id: string): ReactNode => {
    if (id === 'brief') return (
      <p className="deck-brief">
        Пока вас не было, NEX присмотрел за колледжем. Сегодня стоит обратить внимание на <b>{unpaid} неоплаченных договора</b> и <b>{risk} студентов</b> с падающей посещаемостью. Ничего срочного — можно спокойно разобрать по порядку.
      </p>
    );
    if (id === 'console') return <NexTerminal disabled={homeEditing} chips={prefs.homeChips ? commands : []} />;
    if (id === 'shortcuts') return (
      <>
        <div className={`deck-shortcuts ${prefs.homeShortcutStyle === 'tiles' ? 'tiles' : 'columns'}`}>
          {shortcutIds.map((sid) => {
            const s = HOME_SHORTCUT_BY_ID[sid]; if (!s) return null; const Icon = s.icon;
            return (
              <div className={`deck-shortcut-wrap ${homeEditing ? 'editing' : ''}`} key={sid}>
                <button className="deck-shortcut" onClick={() => nav(s.page)}>
                  <span className="deck-shortcut-ic"><Icon size={18} /></span>
                  <span>{s.label}</span>
                </button>
                {homeEditing && (
                  <div className="deck-sc-tools">
                    <button title="Левее" onClick={() => setSc(moveInArray(shortcutIds, sid, -1))}><ChevronLeft size={13} /></button>
                    <button title="Правее" onClick={() => setSc(moveInArray(shortcutIds, sid, 1))}><ChevronRight size={13} /></button>
                    <button title="Убрать" onClick={() => setSc(shortcutIds.filter((x) => x !== sid))}><X size={13} /></button>
                  </div>
                )}
              </div>
            );
          })}
          {shortcutIds.length === 0 && <div className="muted" style={{ fontSize: 13, padding: '10px 2px' }}>Ярлыки скрыты — добавьте нужные ниже.</div>}
        </div>
        {homeEditing && hiddenShortcuts.length > 0 && (
          <div className="deck-add-row">
            <span className="deck-add-label">Добавить ярлык:</span>
            {hiddenShortcuts.map((s) => { const Icon = s.icon; return (
              <button key={s.id} className="dock-chip" onClick={() => setSc([...shortcutIds, s.id])}>
                <Icon size={15} /><span>{s.label}</span><Plus size={13} className="dock-chip-mark" />
              </button>
            ); })}
          </div>
        )}
      </>
    );
    if (id === 'today') return (
      <section className="panel soft">
        <div className="panel-h soft-h">Можно начать с этого</div>
        <div className="ops-list">
          {today_items.map((b) => (
            <button key={b.id} className="op-row soft" onClick={() => nav(b.go)}>
              <span className="op-dot" style={{ background: b.dot }} />
              <span className="op-main">
                <span className="op-title">{b.title}</span>
                <span className="op-meta">{b.meta}</span>
              </span>
              <ChevronRight size={16} className="op-arrow" />
            </button>
          ))}
        </div>
        <div className="soft-foot">Ничего не горит — разберёте в своём темпе.</div>
      </section>
    );
    return null;
  };

  /* обвязка блока в режиме конструктора: имя + переместить/скрыть */
  const renderShell = (id: string): ReactNode => {
    const content = renderBlock(id);
    if (!homeEditing) return <Fragment key={id}>{content}</Fragment>;
    const meta = HOME_BLOCK_BY_ID[id]; const i = blocks.indexOf(id);
    return (
      <div className="deck-eb" key={id}>
        <div className="deck-eb-bar">
          <span className="deck-eb-name">{meta?.label}</span>
          <div className="deck-eb-tools">
            <button title="Выше" disabled={i <= 0} onClick={() => setBlocks(moveInArray(blocks, id, -1))}><ChevronUp size={15} /></button>
            <button title="Ниже" disabled={i >= blocks.length - 1} onClick={() => setBlocks(moveInArray(blocks, id, 1))}><ChevronDown size={15} /></button>
            <button title="Скрыть блок" onClick={() => setBlocks(blocks.filter((x) => x !== id))}><EyeOff size={15} /></button>
          </div>
        </div>
        <div className="deck-eb-body">{content}</div>
      </div>
    );
  };

  return (
    <div className={`deck calm ${homeEditing ? 'editing' : ''}`}>
      {/* --- Приветствие и часы --- */}
      <header className="deck-top">
        <div className="deck-hello">
          <span className="deck-hello-ic"><GIcon size={18} /></span>
          <div>
            <h1>{g.hi}, {name}</h1>
            <div className="deck-sub">{today}</div>
          </div>
        </div>
        <div className="deck-top-right">
          {prefs.homeClock && <LiveClock />}
          {homeEditing
            ? <div className="deck-quiet">Режим настройки экрана</div>
            : <button className="deck-config-btn" onClick={() => setHomeEditing(true)}><Settings2 size={13} />Настроить экран</button>}
        </div>
      </header>

      {/* --- Панель режима конструктора --- */}
      {homeEditing && (
        <div className="deck-edit-toolbar">
          <div className="deck-edit-title">
            <span className="deck-edit-ic"><Settings2 size={15} /></span>
            <div>
              <b>Настройка главного экрана</b>
              <span>Стрелки — порядок, «глаз» — скрыть блок. Ярлыки добавляются и переставляются на своей плитке.</span>
            </div>
          </div>
          <div className="deck-edit-actions">
            <button className="btn btn-ghost btn-sm" onClick={resetHome}><RotateCcw size={14} />Сбросить</button>
            <button className="btn btn-primary btn-sm" onClick={() => setHomeEditing(false)}><Check size={14} />Готово</button>
          </div>
        </div>
      )}

      {/* --- Быстрые настройки вида (только в конструкторе) --- */}
      {homeEditing && (
        <div className="deck-edit-prefs">
          <div className="deck-edit-pref">
            <span>Ярлыки</span>
            <div className="seg seg-sm">
              <button className={prefs.homeShortcutStyle !== 'tiles' ? 'on' : ''} onClick={() => setPref('homeShortcutStyle', 'columns')}>Колонки</button>
              <button className={prefs.homeShortcutStyle === 'tiles' ? 'on' : ''} onClick={() => setPref('homeShortcutStyle', 'tiles')}>Плитки</button>
            </div>
          </div>
          <div className="deck-edit-pref">
            <span>Часы</span>
            <div className="seg seg-sm">
              <button className={prefs.homeClock ? 'on' : ''} onClick={() => setPref('homeClock', true)}>Показать</button>
              <button className={!prefs.homeClock ? 'on' : ''} onClick={() => setPref('homeClock', false)}>Скрыть</button>
            </div>
          </div>
          <div className="deck-edit-pref">
            <span>Подсказки NEX</span>
            <div className="seg seg-sm">
              <button className={prefs.homeChips ? 'on' : ''} onClick={() => setPref('homeChips', true)}>Показать</button>
              <button className={!prefs.homeChips ? 'on' : ''} onClick={() => setPref('homeChips', false)}>Скрыть</button>
            </div>
          </div>
          <label className="deck-edit-pref">
            <span>Обращение</span>
            <input className="input deck-edit-name" value={prefs.homeName} maxLength={40}
              placeholder={user?.name?.split(' ')[0] || 'Как к вам обращаться'}
              onChange={(e) => setPref('homeName', e.target.value)} />
          </label>
        </div>
      )}

      {/* --- Блоки в выбранном порядке --- */}
      {blocks.map((id) => renderShell(id))}

      {/* --- Скрытые блоки: вернуть на экран --- */}
      {homeEditing && hiddenBlocks.length > 0 && (
        <div className="deck-add-blocks">
          <span className="deck-add-label">Скрытые блоки:</span>
          {hiddenBlocks.map((b) => (
            <button key={b.id} className="dock-chip" title={b.desc} onClick={() => setBlocks([...blocks, b.id])}>
              <Plus size={14} /><span>{b.label}</span>
            </button>
          ))}
        </div>
      )}
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
