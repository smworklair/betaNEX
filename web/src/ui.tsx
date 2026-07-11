import { createContext, useContext, useState, useEffect, type ReactNode, type FormEvent } from 'react';
import { Sparkles, ArrowUp, AlertTriangle, Wallet, ShieldCheck } from 'lucide-react';
import type { Role, Severity } from './data';
import type { NexReply } from './nexbrain';
import { apiMe, primaryRole } from './api/auth';
import { DEFAULT_HOME_BLOCKS, DEFAULT_HOME_SHORTCUTS } from './home';

export type Theme = 'light' | 'dark';
export interface User {
  name: string;
  role: Role;
  /** Поля реальной сессии бэкенда (в демо-режиме отсутствуют). */
  id?: string;
  email?: string;
  tenant?: string;
  roles?: string[];
}

/* ---- персонализация интерфейса (хранится в localStorage) ---- */
export interface Prefs {
  accent: 'blue' | 'violet' | 'green' | 'orange' | 'rose' | 'graphite';
  density: 'normal' | 'compact';
  font: 'normal' | 'large';
  corners: 'soft' | 'sharp';
  /** проактивная полоса NEX на страницах */
  strip: boolean;
  /** авто-скрытие левой панели: сворачивается в иконки, раскрывается при наведении */
  sidebarAuto: boolean;
  /** плотность стекла: true — непрозрачные поверхности (меньше прозрачности) */
  solid: boolean;
  /** боковая панель раздела: развёрнута (с подписями) или свёрнута в иконки */
  sidebar: 'expanded' | 'collapsed';
  /** набор кнопок нижнего докбара на мобайле (id из DOCK_CATALOG, по порядку) */
  dock: string[];
  /** набор разделов верхней панели на десктопе (id из TOPBAR_CATALOG). Скрытые доступны в поиске. */
  topbar: string[];
  /** конструктор главного экрана: видимые блоки по порядку (id из HOME_BLOCK_CATALOG) */
  homeBlocks: string[];
  /** конструктор главного экрана: ярлыки разделов по порядку (id из HOME_SHORTCUT_CATALOG) */
  homeShortcuts: string[];
  /** главный экран: ярлыки колонками одной панели или отдельными плитками */
  homeShortcutStyle: 'columns' | 'tiles';
  /** главный экран: показывать часы в шапке */
  homeClock: boolean;
  /** главный экран: показывать подсказки-вопросы под полем «Спросить NEX» */
  homeChips: boolean;
  /** главный экран: как обращаться в приветствии (пусто — имя из профиля) */
  homeName: string;
}
export const DEFAULT_PREFS: Prefs = { accent: 'blue', density: 'normal', font: 'normal', corners: 'soft', strip: true, sidebarAuto: false, solid: false, sidebar: 'expanded', dock: ['feed', 'mail', 'study', 'finance', 'people'], topbar: ['feed', 'finance', 'study', 'people', 'analytics', 'security', 'beta'], homeBlocks: DEFAULT_HOME_BLOCKS, homeShortcuts: DEFAULT_HOME_SHORTCUTS, homeShortcutStyle: 'columns', homeClock: true, homeChips: true, homeName: '' };
export interface ChatMsg extends Partial<NexReply> { who: 'u' | 'n'; text: string; run?: string; pending?: boolean; }
/** Floating context-less explainer, anchored to a text selection. */
export interface ExplainReq { x: number; y: number; text: string; }

interface AppCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  user: User | null;
  setUser: (u: User | null) => void;
  /** Conventional, predictable navigation: the current module/page id. */
  page: string;
  setPage: (p: string) => void;
  /** Focused object (student) for the context drawer. */
  objStudent: number | null;
  openStudent: (id: number) => void;
  closeObject: () => void;
  cmdOpen: boolean;
  setCmdOpen: (v: boolean) => void;
  /** In-page inline panel: opens in the page flow, under the clicked block. */
  inlineHost: HTMLElement | null;
  inlineSeed: string | null;
  inlineTitle: string | null;
  openInlineAt: (host: HTMLElement | null, seed?: string, title?: string) => void;
  closeInline: () => void;
  /** Navigation sidebar can be disabled (AI-first mode) — persisted setting. */
  sidebarEnabled: boolean;
  setSidebarEnabled: (v: boolean) => void;
  /** Live agent ticker in the topbar — opt-in from Settings. */
  pulseEnabled: boolean;
  setPulseEnabled: (v: boolean) => void;
  /** Персонализация: цвет, плотность, шрифт, углы, полоса NEX. */
  prefs: Prefs;
  setPref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
  /** Режим конструктора главного экрана — включается из настроек. */
  homeEditing: boolean;
  setHomeEditing: (v: boolean) => void;
  /** Transient: slide-over nav open (mobile, or when sidebar disabled). */
  navOpen: boolean;
  setNavOpen: (v: boolean) => void;
  /** Floating context-less explainer — appears only on text selection. */
  explain: ExplainReq | null;
  openExplain: (r: ExplainReq) => void;
  closeExplain: () => void;
  /** Full conversational NEX — an alternative way to drive the whole platform. */
  chatLog: ChatMsg[];
  setChatLog: (fn: (prev: ChatMsg[]) => ChatMsg[]) => void;
  /** Open the full chat page, optionally seeding a first question. */
  openChat: (q?: string) => void;
  pendingAsk: string | null;
  clearPendingAsk: () => void;
  toast: (msg: string) => void;
}

const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp must be used within AppProvider');
  return c;
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('nex-theme') as Theme) || 'light');
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState('home');
  const [objStudent, setObjStudent] = useState<number | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [inlineHost, setInlineHost] = useState<HTMLElement | null>(null);
  const [inlineSeed, setInlineSeed] = useState<string | null>(null);
  const [inlineTitle, setInlineTitle] = useState<string | null>(null);
  const [sidebarEnabled, setSidebarEnabledState] = useState<boolean>(() => localStorage.getItem('nex-sidebar') !== 'off');
  const [pulseEnabled, setPulseEnabledState] = useState<boolean>(() => localStorage.getItem('nex-pulse') === 'on');
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('nex-prefs') || '{}') }; }
    catch { return DEFAULT_PREFS; }
  });
  const [navOpen, setNavOpen] = useState(false);
  const [homeEditing, setHomeEditing] = useState(false);
  const [explain, setExplain] = useState<ExplainReq | null>(null);
  const [chatLog, setChatLog] = useState<ChatMsg[]>([]);
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('nex-theme', theme);
  }, [theme]);

  /* применяем персонализацию как data-атрибуты на <html> — вся логика в CSS */
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-accent', prefs.accent);
    el.setAttribute('data-density', prefs.density);
    el.setAttribute('data-font', prefs.font);
    el.setAttribute('data-corners', prefs.corners);
    el.setAttribute('data-solid', prefs.solid ? 'on' : 'off');
    el.setAttribute('data-sidebar', prefs.sidebar === 'collapsed' ? 'collapsed' : 'expanded');
    localStorage.setItem('nex-prefs', JSON.stringify(prefs));
  }, [prefs]);

  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));

  /* Восстановление сессии при старте: если бэкенд сконфигурирован и
     есть живая cookie nex_session — входим без формы. В демо-режиме
     apiMe() возвращает null и ничего не делает. */
  useEffect(() => {
    let live = true;
    apiMe().then((u) => {
      if (!live || !u) return;
      setUser({
        name: u.display_name || u.email,
        role: primaryRole(u.roles),
        id: u.id,
        email: u.email,
        tenant: u.tenant,
        roles: u.roles,
      });
    });
    return () => {
      live = false;
    };
  }, []);

  const openStudent = (id: number) => setObjStudent(id);
  const closeObject = () => setObjStudent(null);
  const openInlineAt = (host: HTMLElement | null, seed?: string, title?: string) => { setExplain(null); setInlineSeed(seed ?? null); setInlineTitle(title ?? null); setInlineHost(host); };
  const closeInline = () => setInlineHost(null);
  const openChat = (q?: string) => { if (q) setPendingAsk(q); setInlineHost(null); setNavOpen(false); setPage('chat'); };
  const clearPendingAsk = () => setPendingAsk(null);
  const setSidebarEnabled = (v: boolean) => { setSidebarEnabledState(v); localStorage.setItem('nex-sidebar', v ? 'on' : 'off'); };
  const setPulseEnabled = (v: boolean) => { setPulseEnabledState(v); localStorage.setItem('nex-pulse', v ? 'on' : 'off'); };
  const openExplain = (r: ExplainReq) => setExplain(r);
  const closeExplain = () => setExplain(null);

  const toast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 2600);
  };

  return (
    <Ctx.Provider value={{ theme, setTheme, user, setUser, page, setPage, objStudent, openStudent, closeObject, cmdOpen, setCmdOpen, inlineHost, inlineSeed, inlineTitle, openInlineAt, closeInline, sidebarEnabled, setSidebarEnabled, pulseEnabled, setPulseEnabled, prefs, setPref, homeEditing, setHomeEditing, navOpen, setNavOpen, explain, openExplain, closeExplain, chatLog, setChatLog, openChat, pendingAsk, clearPendingAsk, toast }}>
      {children}
      {toastMsg && <div className="toast fade"><Sparkles size={15} style={{ color: 'var(--ai)' }} />{toastMsg}</div>}
    </Ctx.Provider>
  );
}

/** True on phone-sized viewports — drives a distinct mobile shell. */
export function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)');
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

/* ---------- small presentational helpers ---------- */

export const severityTone: Record<Severity, string> = {
  low: 'chip-neutral', medium: 'chip-info', high: 'chip-warn', critical: 'chip-danger',
};
export const severityLabel: Record<Severity, string> = {
  low: 'Инфо', medium: 'Средне', high: 'Важно', critical: 'Критично',
};

export function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`chip ${tone}`}><i className="ico" style={{ background: 'currentColor' }} />{children}</span>;
}

/** Unobtrusive "ask NEX about this" affordance — woven into cards, tables,
    charts, reports. Hands the context off to the full conversational NEX.
    AI is present everywhere as an option, never in the way. */
export function NexAsk({ q, label = 'Спросить NEX', subtle = true }: { q: string; label?: string; subtle?: boolean }) {
  const { openInlineAt } = useApp();
  return (
    <button className={`nex-ask-chip ${subtle ? 'subtle' : ''}`} title="NEX раскроется прямо здесь"
      onClick={(e) => {
        e.stopPropagation();
        const el = e.currentTarget as HTMLElement;
        const host = (el.closest('.nex-strip, .ai-card, .card, .fade') as HTMLElement) || el.parentElement;
        openInlineAt(host, q, label);
      }}>
      <Sparkles size={12} /> {label}
    </button>
  );
}

/** GitHub-home-style AI entry: a prominent ask box + quick-intent chips.
    The command center is rebuilt around this — NEX is the way in, not a widget. */
export function AskHero() {
  const { openChat, user } = useApp();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); openChat(q.trim() || undefined); };
  const chips = [
    { icon: Sparkles, label: 'Сводка дня', q: 'Что сегодня важно?' },
    { icon: AlertTriangle, label: 'Кто в зоне риска', q: 'Покажи студентов в зоне риска и почему' },
    { icon: Wallet, label: 'Финансы', q: 'Что с финансами и задолженностью?' },
    { icon: ShieldCheck, label: 'Безопасность', q: 'Состояние безопасности' },
  ];
  return (
    <div className="ask-hero">
      <div className="ask-hero-greet">Здравствуйте, {user?.name?.split(' ')[0] || 'коллега'}. Чем NEX может помочь?</div>
      <form className="ask-hero-box" onSubmit={submit}>
        <Sparkles size={18} className="lead" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Спросите NEX или опишите задачу — он ответит и при необходимости откроет нужный экран…" />
        <button className="ask-send" type="submit" aria-label="Спросить"><ArrowUp size={18} /></button>
      </form>
      <div className="ask-hero-chips">
        {chips.map((c) => { const Icon = c.icon; return (
          <button key={c.label} className="hero-chip" onClick={() => openChat(c.q)}><Icon size={14} />{c.label}</button>
        ); })}
      </div>
    </div>
  );
}

/** Marks a feature that isn't wired up yet. */
export function Soon() {
  return <span className="soon-badge" title="Эта функция пока в разработке">в разработке</span>;
}

/** Marks a whole section that exists but is an early beta. */
export function Beta() {
  return <span className="beta-badge" title="Бета-версия — данные демонстрационные">beta</span>;
}

export function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return <span className="avatar">{initials || '—'}</span>;
}

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
    </div>
  );
}

export function Sparkline({ data, color = 'var(--accent)', width = 96, height = 28 }: { data: number[]; color?: string; width?: number; height?: number }) {
  const max = Math.max(...data, 1);
  const step = width / Math.max(data.length - 1, 1);
  const pts = data.map((v, i) => `${i * step},${height - (v / max) * (height - 4) - 2}`).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AiInsightCard({ title, desc, confidence, onAct }: { title: string; desc: string; confidence: number; onAct?: () => void }) {
  return (
    <div className="ai-card">
      <div className="ai-head"><Sparkles size={14} /> Подсказка NEX · уверенность {Math.round(confidence * 100)}%</div>
      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</div>
      <div className="ai-body muted" style={{ marginTop: 2 }}>{desc}</div>
      <div className="ai-actions">
        <button className="btn btn-sm btn-primary" onClick={onAct}>Открыть</button>
        <button className="btn btn-sm btn-ghost">Почему?</button>
        <button className="btn btn-sm btn-ghost">Скрыть</button>
      </div>
    </div>
  );
}
