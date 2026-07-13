import { useState, useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles, X, ArrowUp, ArrowRight, Quote, ExternalLink,
  MessageSquare, Mail, CheckSquare, StickyNote, CalendarPlus, Wand2, Copy, Languages, ScrollText,
} from 'lucide-react';
import { useApp, Chip, NexAsk } from './ui';
import { students, finance } from './data';
import { nexReply, attendanceRate, avgGrade, pageInsight, PAGE_TITLES } from './nexbrain';
import { llmReady, llmAsk } from './llm';
import { Md } from './md';
import { useCollection, uid, nowIso, type Entity } from './beta/store';

/* ---------- Proactive strip: NEX speaks first on every screen ---------- */
export function ProactiveStrip() {
  const { page, prefs } = useApp();
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const ins = pageInsight(page);
  if (!prefs.strip || !ins || dismissed[page]) return null;
  return (
    <div className="nex-strip">
      <div className="nex-strip-ic"><Sparkles size={15} /></div>
      <div className="nex-strip-main">
        <div className="nex-strip-text">{ins.text}</div>
        <div className="nex-strip-chips">
          {ins.chips.map((c) => <span key={c.q}><NexAsk q={c.q} label={c.label} subtle={false} /></span>)}
        </div>
      </div>
      <button className="icon-btn" title="Скрыть" onClick={() => setDismissed((d) => ({ ...d, [page]: true }))}><X size={16} /></button>
    </div>
  );
}

/* ============================================================
   Two AI surfaces:
   1) InlinePanel — opens IN the page flow, under the clicked block,
      pushing the rest of the content down. Works with the page context.
   2) SelExplain — a small floating, context-LESS explainer that
      only appears when you select text.
   ============================================================ */

interface Ctx { title: string; facts: string[]; quick: string[]; sid?: number; }

function buildContext(objStudent: number | null, page: string): Ctx {
  if (objStudent != null) {
    const s = students.find((x) => x.id === objStudent);
    if (s) {
      const rate = attendanceRate(s.id);
      const avg = avgGrade(s.id, s.group);
      const debt = finance.payments.some((p) => p.student.startsWith(s.lastname) && p.status !== 'Оплачено');
      return {
        sid: s.id,
        title: `${s.lastname} ${s.firstname} · ${s.group}`,
        facts: [`Ср. балл ${avg.toFixed(1)}`, `Посещ. ${rate}%`, debt ? 'Есть долг' : 'Оплата ок'],
        quick: ['Почему в зоне риска?', 'Сравни с группой', 'Что предпринять?', 'Сформируй справку'],
      };
    }
  }
  if (page === 'settings') return { title: 'Настройки', facts: [], quick: ['Как включить 2FA?', 'Зачем тёмная тема?'] };
  if (page === 'dashboard') return { title: 'Командный центр', facts: [], quick: ['Что сегодня важно?', 'Покажи риски', 'Состояние безопасности'] };
  return { title: PAGE_TITLES[page] || page, facts: [], quick: ['Сделай сводку экрана', 'Найди аномалии', 'Какие действия предложишь?'] };
}

/* ---------- 1) In-page inline panel (portaled under the clicked block) ---------- */
interface Msg { who: 'u' | 'n'; text: string; nav?: { label: string; page: string }[]; action?: string }

function InlinePanel() {
  const { inlineSeed, inlineTitle, objStudent, page, closeInline, openChat, setPage, toast } = useApp();
  const ctx = buildContext(objStudent, page);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (inlineSeed) {
      if (llmReady()) {
        setMsgs([{ who: 'u', text: inlineSeed }, { who: 'n', text: '…' }]);
        llmAsk(`Контекст: пользователь на экране «${ctx.title}». Вопрос: ${inlineSeed}`)
          .then((text) => { if (!cancelled) setMsgs([{ who: 'u', text: inlineSeed }, { who: 'n', text }]); })
          .catch(() => {
            if (cancelled) return;
            const a = nexReply(inlineSeed, { student: ctx.sid ?? null, page });
            setMsgs([{ who: 'u', text: inlineSeed }, { who: 'n', text: a.text, nav: a.nav, action: a.action }]);
          });
      } else {
        const a = nexReply(inlineSeed, { student: ctx.sid ?? null, page });
        setMsgs([{ who: 'u', text: inlineSeed }, { who: 'n', text: a.text, nav: a.nav, action: a.action }]);
      }
    } else {
      setMsgs([{ who: 'n', text: `Я раскрылся прямо в этом блоке и вижу контекст страницы «${ctx.title}». Спрашивайте.` }]);
    }
    setInput('');
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineSeed, inlineTitle]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [msgs]);

  /* Gemini, если ключ подключён; иначе локальный мок (nexbrain) */
  const ask = async (q: string) => {
    if (!q.trim()) return;
    setInput('');
    setMsgs((m) => [...m, { who: 'u', text: q }]);
    if (llmReady()) {
      setMsgs((m) => [...m, { who: 'n', text: '…' }]);
      try {
        const text = await llmAsk(`Контекст: пользователь на экране «${ctx.title}». Вопрос: ${q}`);
        setMsgs((m) => [...m.slice(0, -1), { who: 'n', text }]);
        return;
      } catch {
        setMsgs((m) => m.slice(0, -1)); // откат к моку ниже
      }
    }
    const a = nexReply(q, { student: ctx.sid ?? null, page });
    setMsgs((m) => [...m, { who: 'n', text: a.text, nav: a.nav, action: a.action }]);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); ask(input); };

  return (
    <div className="nex-inline" ref={rootRef}>
      <div className="nex-inline-head">
        <span className="ai-orb"><Sparkles size={13} /></span>
        <b>{inlineTitle || 'NEX'}</b>
        <span className="inline-badge">в странице</span>
        <button className="icon-btn" title="Открыть в полном чате" onClick={() => openChat(inlineSeed || undefined)}><ExternalLink size={15} /></button>
        <button className="icon-btn" title="Закрыть" onClick={closeInline}><X size={16} /></button>
      </div>

      <div className="nex-inline-body">
        {msgs.map((m, i) => m.who === 'u'
          ? <div className="inline-msg u" key={i}>{m.text}</div>
          : (
            <div className="inline-msg n" key={i}>
              <div className="ic"><Sparkles size={12} /></div>
              <div className="nb">
                <Md text={m.text} />
                {m.nav && m.nav.length > 0 && (
                  <div className="inline-nav">{m.nav.map((n) => <button key={n.page + n.label} className="chip-btn" onClick={() => setPage(n.page)}>{n.label} <ArrowRight size={12} className="ic" /></button>)}</div>
                )}
                {m.action && <div className="inline-act"><button className="btn btn-sm btn-primary" onClick={() => toast(m.action + ' — выполнено')}>{m.action}</button></div>}
              </div>
            </div>
          ))}
        <div ref={endRef} />
      </div>

      <div className="nex-inline-quick">
        {ctx.quick.map((qk) => <button key={qk} className="chip-btn sm" onClick={() => ask(qk)}><Sparkles size={11} className="ic" />{qk}</button>)}
      </div>

      <form className="inline-foot" onSubmit={submit}>
        <input autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="Спросите NEX прямо здесь…" />
        <button className="ask-send sm" type="submit" aria-label="Отправить"><ArrowUp size={16} /></button>
      </form>
    </div>
  );
}

/** Portals the inline panel into whatever block the user clicked in. */
export function InlinePanelHost() {
  const { inlineHost } = useApp();
  if (!inlineHost) return null;
  return createPortal(<InlinePanel />, inlineHost);
}

/* ---------- 2) Selection context menu — действия по выделенному тексту ---------- */
type QTask = Entity & Record<string, unknown>;
type QNote = Entity & { text: string };
type QEvent = Entity & Record<string, unknown>;

function SelectionPopover() {
  const { openExplain, openChat, setPage, toast, inlineHost, explain } = useApp();
  const [pos, setPos] = useState<{ x: number; y: number; text: string } | null>(null);
  const tasks = useCollection<QTask>('tasks', []);
  const notes = useCollection<QNote>('notes', []);
  const events = useCollection<QEvent>('calendar', []);

  useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() || '';
      if (!sel || text.length < 3 || explain) { setPos(null); return; }
      const node = sel.anchorNode as HTMLElement | null;
      const host = node?.parentElement?.closest('.nex-inline, .sel-pop, .sel-explain, .bk-overlay, input, textarea, .chat-page');
      if (host) { setPos(null); return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width) { setPos(null); return; }
      setPos({ x: rect.left + rect.width / 2, y: rect.top, text });
    };
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.sel-pop')) setPos(null); };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('mouseup', onUp); document.removeEventListener('mousedown', onDown); };
  }, [inlineHost, explain]);

  if (!pos) return null;
  const text = pos.text;
  const short = text.length > 60 ? text.slice(0, 57) + '…' : text;
  const close = () => setPos(null);

  const createTask = () => {
    tasks.add({
      title: short, note: text, status: 'open', priority: 'normal', category: 'Общее', tags: [], due: '',
      assignees: [], watchers: [], recurrence: 'none', subtasks: [], checklist: [], comments: [],
      history: [{ id: uid('h'), text: 'Создана из выделенного текста', at: nowIso() }], attachments: [],
    });
    toast('Задача создана из выделения');
  };
  const createNote = () => { notes.add({ text }); toast('Заметка сохранена'); };
  const createEvent = () => {
    events.add({
      day: new Date().getDate(), title: short, kind: 'personal', time: '12:00', location: '',
      participants: [], groups: [], recurrence: 'none', reminder: '1h', linkTask: false, attachments: [], note: text,
    });
    toast('Событие добавлено в календарь');
  };
  const copy = () => { navigator.clipboard?.writeText(text).then(() => toast('Скопировано'), () => toast('Не удалось скопировать')); };

  const A = ({ icon, label, on }: { icon: ReactNode; label: string; on: () => void }) => (
    <button onMouseDown={(e) => { e.preventDefault(); on(); close(); }} title={label}>{icon}<span>{label}</span></button>
  );

  return (
    <div className="sel-pop rich" style={{ left: pos.x, top: pos.y }}>
      <A icon={<Sparkles size={13} />} label="Спросить NEX" on={() => openChat(`${text}`)} />
      <A icon={<Wand2 size={13} />} label="Передать ИИ" on={() => openChat(`Разбери и предложи, что делать с этим: «${text}»`)} />
      <A icon={<ScrollText size={13} />} label="Резюме" on={() => openChat(`Сделай краткое резюме: «${text}»`)} />
      <A icon={<Languages size={13} />} label="Перевести" on={() => openChat(`Переведи на английский: «${text}»`)} />
      <A icon={<Quote size={13} />} label="Объяснить" on={() => openExplain({ x: pos.x, y: pos.y + 24, text })} />
      <div className="sel-pop-sep" />
      <A icon={<CheckSquare size={13} />} label="В задачу" on={createTask} />
      <A icon={<StickyNote size={13} />} label="В заметку" on={createNote} />
      <A icon={<CalendarPlus size={13} />} label="В календарь" on={createEvent} />
      <A icon={<MessageSquare size={13} />} label="Сообщение" on={() => { setPage('mail'); toast('Открыты сообщения — вставьте текст'); }} />
      <A icon={<Mail size={13} />} label="Письмо" on={() => { setPage('mail'); toast('Откройте письмо и вставьте текст'); }} />
      <div className="sel-pop-sep" />
      <A icon={<Copy size={13} />} label="Копировать" on={copy} />
    </div>
  );
}

/** A plain, context-less explanation of the selected text. */
function explainSelection(text: string): string {
  const t = text.trim();
  if (/^\d+([.,]\d+)?\s*%$/.test(t)) return `«${t}» — это процентный показатель. Доля от целого: чем выше значение, тем большая часть учтена (например, доля посещённых занятий или оплат).`;
  if (/^[₽$€]?\s?\d[\d\s.,]*\s?[₽$€]?$/.test(t)) return `«${t}» — это денежная сумма. Обычно это поступление, задолженность или начисление в финансовом разделе.`;
  if (/^[А-ЯЁ][а-яё]+(\s[А-ЯЁ]\.?){0,2}$/.test(t)) return `«${t}» — похоже на имя или ФИО человека (студента или сотрудника). В системе с ним связаны успеваемость, посещаемость и оплаты.`;
  if (/[A-ZА-Я]{2,}-?\d/.test(t)) return `«${t}» — код учебной группы: буквы обозначают специальность, цифры — год набора и номер подгруппы.`;
  if (t.split(/\s+/).length > 6) return `Это фрагмент текста интерфейса. Если коротко: здесь описывается состояние или рекомендация по разделу. Выделите конкретный термин, чтобы я объяснил точнее.`;
  return `«${t}» — термин из интерфейса NEX. Это понятие, относящееся к учебному процессу, финансам или безопасности. Спросите подробнее в полном чате, чтобы привязать к данным.`;
}

function SelExplain() {
  const { explain, closeExplain, openChat } = useApp();
  const [llmText, setLlmText] = useState<string | null>(null);

  /* Gemini объясняет выделенное; мок — мгновенный фолбэк */
  useEffect(() => {
    setLlmText(null);
    if (!explain || !llmReady()) return;
    let cancelled = false;
    llmAsk(`Объясни коротко (1-3 предложения), что означает выделенный фрагмент интерфейса: «${explain.text}»`,
      { system: 'Ты — NEX, помощник информационной системы колледжа. Объясняй термины простым русским языком, очень коротко.' })
      .then((t) => { if (!cancelled) setLlmText(t); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [explain]);

  if (!explain) return null;
  const W = 320;
  const left = Math.max(12, Math.min(explain.x - W / 2, window.innerWidth - W - 12));
  const top = Math.max(12, Math.min(explain.y, window.innerHeight - 180));
  const body = llmText ?? (llmReady() ? 'NEX думает…' : explainSelection(explain.text));
  return (
    <>
      <div className="inline-veil" onClick={closeExplain} />
      <div className="sel-explain" style={{ left, top, width: W }} role="dialog" aria-label="NEX объясняет">
        <div className="sel-explain-head">
          <span className="ai-orb"><Sparkles size={11} /></span><b>NEX объясняет</b>
          <span className="inline-badge">{llmReady() ? 'ИИ' : 'без контекста'}</span>
          <button className="icon-btn" title="Закрыть" onClick={closeExplain}><X size={15} /></button>
        </div>
        <div className="sel-explain-body"><Md text={body} /></div>
        <button className="sel-explain-more" onClick={() => { openChat(`${explain.text} — объясни подробнее`); closeExplain(); }}>
          Подробнее в чате с данными <ArrowRight size={13} />
        </button>
      </div>
    </>
  );
}

export function AiLayer() {
  return (
    <>
      <SelectionPopover />
      <SelExplain />
      <InlinePanelHost />
    </>
  );
}
