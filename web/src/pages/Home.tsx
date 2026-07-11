import { useState, useEffect, useRef, Fragment, type FormEvent, type ReactNode } from 'react';
import {
  ArrowUp, ArrowRight, Wallet, Users, Sun, Sunrise, Moon,
  Sparkles, CornerDownLeft, ChevronRight, ChevronLeft, ChevronUp, ChevronDown,
  ListChecks, Settings2, Check, RotateCcw, EyeOff, Plus, X,
} from 'lucide-react';
import { useApp } from '../ui';
import { finance, aiInsights, failedLogins, nexLog, students } from '../data';
import { attendanceRate } from '../nexbrain';
import {
  HOME_BLOCK_CATALOG, HOME_BLOCK_BY_ID, DEFAULT_HOME_BLOCKS,
  HOME_SHORTCUT_CATALOG, HOME_SHORTCUT_BY_ID, DEFAULT_HOME_SHORTCUTS, moveInArray,
} from '../home';

/* ============================================================
   Главное для администратора — стол, за который приятно сесть.
   Не пульт с тревогами, а тихое рабочее место: приветствие,
   спокойные часы, поле «Спросить NEX» и мягкий список того,
   с чего можно начать. Ничего не мигает, не тикает и не кричит.
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

function CommandDeck() {
  const { user, setPage, openChat, prefs, setPref, homeEditing, setHomeEditing, toast } = useApp();
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  /* уходя с главного, выходим из режима конструктора */
  useEffect(() => () => setHomeEditing(false), [setHomeEditing]);

  const name = user?.name?.split(' ')[0] || 'коллега';
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
  const resetHome = () => { setBlocks(DEFAULT_HOME_BLOCKS); setSc(DEFAULT_HOME_SHORTCUTS); toast('Главный экран сброшен к стандартному виду'); };

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

  const submit = (e: FormEvent) => { e.preventDefault(); if (!homeEditing) openChat(q.trim() || undefined); };
  const nav = (p: string) => { if (!homeEditing) setPage(p); };

  /* --- Рендер отдельного блока (без обвязки редактирования) --- */
  const renderBlock = (id: string): ReactNode => {
    if (id === 'brief') return (
      <p className="deck-brief">
        Пока вас не было, NEX присмотрел за колледжем. Сегодня стоит обратить внимание на <b>{unpaid} неоплаченных договора</b> и <b>{risk} студентов</b> с падающей посещаемостью. Ничего срочного — можно спокойно разобрать по порядку.
      </p>
    );
    if (id === 'console') return (
      <form className="console" onSubmit={submit} onClick={() => !homeEditing && inputRef.current?.focus()}>
        <div className="console-head">
          <Sparkles size={15} className="console-spark" />
          <span className="console-tag">Спросить NEX</span>
          <span className="console-kbd"><kbd>⌘</kbd><kbd>K</kbd> из любого места</span>
        </div>
        <div className="console-line">
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} disabled={homeEditing}
            placeholder="С чего начнём? Спросите своими словами — например, «сколько соберём, если должники заплатят»" />
          <button className="console-send" type="submit" aria-label="Спросить"><CornerDownLeft size={15} /></button>
        </div>
        <div className="console-chips">
          {commands.map((c) => (
            <button type="button" key={c.label} className="console-chip" onClick={(e) => { e.stopPropagation(); if (!homeEditing) openChat(c.q); }}>
              {c.label}
            </button>
          ))}
        </div>
      </form>
    );
    if (id === 'shortcuts') return (
      <>
        <div className="deck-shortcuts">
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
    if (id === 'recent') return (
      <aside className="panel soft">
        <div className="panel-h soft-h"><Sparkles size={14} style={{ color: 'var(--ai)' }} /> Недавнее у NEX</div>
        <div className="deck-log soft-log">
          {nexLog.slice(0, 4).map((l) => (
            <div className="deck-log-row" key={l.id}>
              <span className="deck-log-dot" />
              <div><div className="deck-log-t">{l.text}</div><div className="deck-log-time">{l.time}</div></div>
            </div>
          ))}
        </div>
        <button className="deck-log-more" onClick={() => nav('nexlog')}>Вся история NEX <ArrowRight size={13} /></button>
      </aside>
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

  /* группируем соседние колоночные блоки (today/recent) в двухколоночную сетку */
  const groups: { col: boolean; ids: string[] }[] = [];
  blocks.forEach((id) => {
    const col = !!HOME_BLOCK_BY_ID[id]?.col;
    const last = groups[groups.length - 1];
    if (col && last && last.col) last.ids.push(id);
    else groups.push({ col, ids: [id] });
  });

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
          <LiveClock />
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

      {/* --- Блоки в выбранном порядке --- */}
      {groups.map((grp, gi) => grp.col ? (
        <div className="deck-grid" key={gi}>
          {grp.ids.map((id) => renderShell(id))}
        </div>
      ) : (
        <Fragment key={gi}>{grp.ids.map((id) => renderShell(id))}</Fragment>
      ))}

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
