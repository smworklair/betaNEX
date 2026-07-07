import { useState, useEffect, useMemo, useRef, type ReactNode, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Users, School, ClipboardList, Calendar, BookOpen, CheckSquare,
  Wallet, Award, Briefcase, BarChart3, GraduationCap, ShieldCheck, Settings as SettingsIcon,
  Bell, Sparkles, Lock, User as UserIcon, ArrowRight, Menu, X, LogOut,
  Newspaper, Home as HomeIcon, CalendarDays, TrendingUp, Receipt, HandCoins,
  FileBarChart, Calculator, Banknote, PiggyBank, Landmark, UserCheck, ClipboardCheck, Snowflake,
  MessageSquare, FileText, Cloud as CloudIcon, Compass, Bot, Rss, FlaskConical, Megaphone,
  Wand2, PenLine, Languages, ListChecks, UserSearch, CornerDownLeft, Search as SearchIcon,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import { useApp, Beta, useIsMobile, type User } from './ui';
import { DOCK_BY_ID, DEFAULT_DOCK, DEFAULT_TOPBAR } from './dock';
import { roleLabel, students, type Role } from './data';
import { ContextDrawer } from './blocks';
import { AiLayer } from './ai';

import Chat from './pages/Chat';
import Home from './pages/Home';
import { NotificationsPage, Documents, Feed, Cloud } from './pages/beta';
import Campus from './pages/campus';
import Agents from './pages/agents';
import { SecurityConsole } from './pages/Dashboard';
import { Students, Groups, Staff } from './pages/people';
import { Schedule, Journal, Attendance } from './pages/academic';
import { Admissions } from './pages/operations';
import { Analytics, Graduation } from './pages/insights';
import Settings from './pages/Settings';
import { Tasks, NexHistory, Exams, MonthCalendar } from './pages/extra';
import { Community, Mail, Broadcast, MiniMessenger } from './pages/social';
import {
  FinOverview, FinPayments, FinDebts, FinCharges, FinCalc, FinPayroll, FinScholarship, FinBudget, FinReports,
} from './pages/accounting';

/* ---- Двухуровневая навигация: разделы сверху → подстраницы слева ---- */
interface SubItem { id: string; label: string; icon: LucideIcon; node: ReactNode; beta?: boolean; }
interface Section { id: string; label: string; icon: LucideIcon; items: SubItem[]; }

const SECTIONS: Section[] = [
  { id: 'feed', label: 'Лента', icon: Newspaper, items: [
    { id: 'home', label: 'Главное', icon: HomeIcon, node: <Home /> },
    { id: 'community', label: 'Сообщество', icon: Rss, node: <Community /> },
    { id: 'mail', label: 'Сообщения', icon: MessageSquare, node: <Mail /> },
    { id: 'broadcast', label: 'Рассылка', icon: Megaphone, node: <Broadcast /> },
    { id: 'tasks', label: 'Задачи', icon: CheckSquare, node: <Tasks /> },
    { id: 'notifications', label: 'Уведомления', icon: Bell, node: <NotificationsPage /> },
    { id: 'calendar', label: 'Календарь', icon: CalendarDays, node: <MonthCalendar /> },
    { id: 'nexlog', label: 'История NEX', icon: Sparkles, node: <NexHistory /> },
  ] },
  { id: 'finance', label: 'Финансы', icon: Wallet, items: [
    { id: 'fin-overview', label: 'Обзор', icon: TrendingUp, node: <FinOverview /> },
    { id: 'fin-payments', label: 'Платежи', icon: Receipt, node: <FinPayments /> },
    { id: 'fin-debts', label: 'Задолженности', icon: HandCoins, node: <FinDebts /> },
    { id: 'fin-charges', label: 'Начисления', icon: FileBarChart, node: <FinCharges /> },
    { id: 'fin-calc', label: 'Расчёты', icon: Calculator, node: <FinCalc /> },
    { id: 'fin-payroll', label: 'Зарплата', icon: Banknote, node: <FinPayroll /> },
    { id: 'fin-scholarship', label: 'Стипендии', icon: Award, node: <FinScholarship /> },
    { id: 'fin-budget', label: 'Бюджет', icon: PiggyBank, node: <FinBudget /> },
    { id: 'fin-reports', label: 'Отчёты', icon: Landmark, node: <FinReports /> },
  ] },
  { id: 'study', label: 'Учёба', icon: GraduationCap, items: [
    { id: 'journal', label: 'Журнал оценок', icon: BookOpen, node: <Journal /> },
    { id: 'schedule', label: 'Расписание', icon: Calendar, node: <Schedule /> },
    { id: 'attendance', label: 'Посещаемость', icon: UserCheck, node: <Attendance /> },
    { id: 'exams', label: 'Сессия', icon: ClipboardCheck, node: <Exams /> },
  ] },
  { id: 'people', label: 'Люди', icon: Users, items: [
    { id: 'students', label: 'Студенты', icon: Users, node: <Students /> },
    { id: 'groups', label: 'Группы', icon: School, node: <Groups /> },
    { id: 'staff', label: 'Сотрудники', icon: Briefcase, node: <Staff /> },
    { id: 'admissions', label: 'Приём', icon: ClipboardList, node: <Admissions /> },
  ] },
  { id: 'analytics', label: 'Аналитика', icon: BarChart3, items: [
    { id: 'analytics', label: 'Обзор', icon: BarChart3, node: <Analytics /> },
    { id: 'graduation', label: 'Выпуск', icon: GraduationCap, node: <Graduation /> },
  ] },
  { id: 'security', label: 'Безопасность', icon: ShieldCheck, items: [
    { id: 'security', label: 'Обзор', icon: ShieldCheck, node: <SecurityConsole /> },
  ] },
  { id: 'beta', label: 'Бета', icon: FlaskConical, items: [
    { id: 'documents', label: 'Документы', icon: FileText, node: <Documents />, beta: true },
    { id: 'feed', label: 'Витрина', icon: Newspaper, node: <Feed />, beta: true },
    { id: 'cloud', label: 'Облако', icon: CloudIcon, node: <Cloud />, beta: true },
    { id: 'campus', label: 'Кампус', icon: Compass, node: <Campus />, beta: true },
    { id: 'agents', label: 'Агенты', icon: Bot, node: <Agents />, beta: true },
  ] },
];

const ALL_ITEMS: Record<string, SubItem> = {};
const SECTION_OF: Record<string, string> = {};
SECTIONS.forEach((s) => s.items.forEach((it) => { ALL_ITEMS[it.id] = it; SECTION_OF[it.id] = s.id; }));

function renderSub(id: string): ReactNode {
  if (id === 'chat') return <Chat />;
  if (id === 'settings') return <Settings />;
  return ALL_ITEMS[id]?.node ?? <Home />;
}

/* ===================== Login ===================== */
const ROLE_OPTS: { role: Role; icon: LucideIcon; hint: string }[] = [
  { role: 'admin', icon: ShieldCheck, hint: 'Полный доступ и безопасность' },
  { role: 'teacher', icon: BookOpen, hint: 'Журнал, расписание, группы' },
  { role: 'accountant', icon: Wallet, hint: 'Финансы и стипендии' },
  { role: 'student', icon: GraduationCap, hint: 'Учёба и платежи' },
];

function Login() {
  const { setUser, setPage } = useApp();
  const [role, setRole] = useState<Role>('admin');
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr('Введите имя'); return; }
    if (pass !== '0000') { setErr('Неверный пароль (для демо: 0000)'); return; }
    setPage('home');
    setUser({ name: name.trim(), role } as User);
  };

  return (
    <div className="login">
      <aside className="login-aside">
        <div className="brand-mark" style={{ width: 36, height: 36, fontSize: 18 }}>N</div>
        <div>
          <div className="lead">Колледж, которым&nbsp;спокойно управлять.</div>
          <div className="sub">NEX каждое утро объясняет простыми словами, что важно, и рядом с каждым делом даёт одну кнопку. Понятно с первого взгляда — и в 20 лет, и в 60.</div>
          <div style={{ marginTop: 26 }}>
            <div className="login-feat"><span className="ico"><Sparkles size={15} /></span>Сводка дня человеческим языком, без сложных таблиц</div>
            <div className="login-feat"><span className="ico"><ShieldCheck size={15} /></span>Спокойно за данные: вход, доступы и история под контролем</div>
          </div>
        </div>
        <div className="sub" style={{ fontSize: 12 }}>NEX</div>
      </aside>

      <main className="login-main">
        <form className="login-card" onSubmit={submit}>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em' }}>Здравствуйте</h1>
          <p className="muted" style={{ fontSize: 14, marginTop: 4, marginBottom: 20 }}>Выберите, кто вы, и войдите. Пароль для входа: <b className="mono">0000</b></p>

          <label className="field-label">Кто вы</label>
          <div className="role-grid" style={{ marginBottom: 14 }}>
            {ROLE_OPTS.map((o) => {
              const Icon = o.icon;
              const frozen = o.role !== 'admin';
              return (
                <button type="button" key={o.role} disabled={frozen}
                  className={`role-btn ${role === o.role ? 'active' : ''} ${frozen ? 'frozen' : ''}`}
                  onClick={() => !frozen && setRole(o.role)}>
                  <Icon className="ico" size={18} /><b>{roleLabel[o.role]}</b>
                  <span>{frozen ? 'Скоро' : o.hint}</span>
                  {frozen && <span className="frozen-badge"><Snowflake size={11} /></span>}
                </button>
              );
            })}
          </div>

          <label className="field-label">Имя</label>
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <UserIcon size={15} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingLeft: 34 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Любое имя" />
          </div>

          <label className="field-label">Пароль</label>
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <Lock size={15} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingLeft: 34 }} type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="0000" />
          </div>

          {err && <div className="chip chip-danger" style={{ marginBottom: 14 }}>{err}</div>}

          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', height: 40 }} type="submit">
            Войти как {roleLabel[role]} <ArrowRight size={16} />
          </button>
        </form>
      </main>
    </div>
  );
}

/* ===================== Topbar NEX omnibox (AI-native search + ask, in one) ===================== */
interface AiAction { id: string; label: string; hint: string; icon: LucideIcon; kw: string; run: (ask: (t?: string) => void, go: (id: string) => void) => void; }

/* Каталог ИИ-действий прямо в поиске — «AI-native» омнибокс */
const AI_ACTIONS: AiAction[] = [
  { id: 'daybrief', label: 'Сводка дня', hint: 'что важно прямо сейчас', icon: Sparkles, kw: 'сводка день важно итоги', run: (ask) => ask('Что сегодня важно? Дай короткую сводку по колледжу.') },
  { id: 'risk', label: 'Студенты в зоне риска', hint: 'кто и почему — с объяснением', icon: AlertTriangle, kw: 'риск студенты отчисление успеваемость', run: (ask) => ask('Покажи студентов в зоне риска и объясни, почему.') },
  { id: 'compose-mail', label: 'Составить письмо', hint: 'NEX напишет черновик за вас', icon: PenLine, kw: 'письмо email составить черновик написать', run: (ask) => ask('Помоги составить деловое письмо. Уточни, кому и о чём.') },
  { id: 'recap', label: 'Пересказать переписку', hint: 'краткий конспект чата или письма', icon: MessageSquare, kw: 'пересказ конспект чат переписка кратко', run: (ask) => ask('Сделай краткий пересказ последней переписки и выдели договорённости.') },
  { id: 'finance', label: 'Финансовая сводка', hint: 'платежи, долги, стипендии', icon: Wallet, kw: 'финансы деньги долг платежи стипендии бюджет', run: (ask) => ask('Что с финансами и задолженностью? Дай сводку.') },
  { id: 'report', label: 'Сгенерировать отчёт', hint: 'по ключевым показателям', icon: FileBarChart, kw: 'отчёт report показатели аналитика выгрузка', run: (ask) => ask('Сгенерируй отчёт по ключевым показателям колледжа.') },
  { id: 'broadcast', label: 'Составить рассылку', hint: 'объявление по группам', icon: Megaphone, kw: 'рассылка объявление сообщение группам', run: (_ask, go) => go('broadcast') },
  { id: 'plan', label: 'Спланировать неделю', hint: 'расписание, дедлайны, задачи', icon: CalendarDays, kw: 'план неделя расписание календарь дедлайн', run: (ask) => ask('Помоги спланировать рабочую неделю по расписанию и задачам.') },
  { id: 'tasks', label: 'Разобрать задачи', hint: 'приоритеты и следующий шаг', icon: ListChecks, kw: 'задачи приоритет todo дела', run: (ask) => ask('Разбери мои задачи по приоритету и подскажи первый шаг.') },
  { id: 'translate', label: 'Перевести текст', hint: 'на нужный язык', icon: Languages, kw: 'перевод перевести язык translate', run: (ask) => ask('Переведи текст. Вставь текст и укажи язык.') },
  { id: 'security', label: 'Проверить безопасность', hint: 'аномалии входов и доступы', icon: ShieldCheck, kw: 'безопасность доступ вход аномалия защита', run: (ask) => ask('Проверь состояние безопасности: входы, доступы, аномалии.') },
  { id: 'find-person', label: 'Найти человека', hint: 'студент, группа, сотрудник', icon: UserSearch, kw: 'найти студент человек группа сотрудник поиск', run: (_ask, go) => go('students') },
];

function NexOmni() {
  const { setPage, openChat, openStudent } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  /* Cmd/Ctrl+K фокусирует омнибокс из любого места */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setOpen(true); inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const query = q.trim().toLowerCase();
  const hasQuery = query.length > 0;

  const aiList = useMemo(() => (
    hasQuery ? AI_ACTIONS.filter((a) => (a.label + ' ' + a.kw).toLowerCase().includes(query)) : AI_ACTIONS.slice(0, 4)
  ), [query, hasQuery]);

  const sections = useMemo(() => {
    const all = SECTIONS.flatMap((s) => s.items.map((it) => ({ id: it.id, label: it.label, section: s.label })));
    const filtered = hasQuery ? all.filter((x) => (x.label + ' ' + x.section).toLowerCase().includes(query)) : all;
    return filtered.slice(0, hasQuery ? 6 : 5);
  }, [query, hasQuery]);

  const people = useMemo(() => {
    if (query.length < 2) return [];
    return students
      .filter((s) => `${s.lastname} ${s.firstname} ${s.patronymic} ${s.group}`.toLowerCase().includes(query))
      .slice(0, 5);
  }, [query]);

  const close = () => { setOpen(false); setQ(''); setSel(0); };
  const go = (id: string) => { setPage(id); close(); };
  const ask = (text?: string) => { openChat((text ?? q).trim() || undefined); close(); };
  const openPerson = (id: number) => { openStudent(id); close(); };

  /* Плоский список для навигации стрелками: [спросить, ИИ-действия, разделы, люди] */
  const flat: (() => void)[] = [
    () => ask(),
    ...aiList.map((a) => () => a.run(ask, go)),
    ...sections.map((s) => () => go(s.id)),
    ...people.map((p) => () => openPerson(p.id)),
  ];
  const aiOffset = 1;
  const secOffset = aiOffset + aiList.length;
  const peopleOffset = secOffset + sections.length;

  useEffect(() => { setSel(0); }, [query]);

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, flat.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); (flat[sel] ?? flat[0])(); return; }
  };

  const suggestions = ['Что сегодня важно?', 'Кто в зоне риска и почему', 'Что с финансами?', 'Состояние безопасности'];

  return (
    <div className={`omni ${open ? 'expanded' : ''}`} ref={wrapRef}>
      <div className={`ask-bar ${open ? 'on' : ''}`} onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        <Sparkles size={15} className="spark" />
        <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
          placeholder="Поиск и NEX — спросите что угодно…" />
        {!open && <span className="omni-kbd"><kbd>⌘</kbd><kbd>K</kbd></span>}
      </div>

      {open && (
        <div className="omni-pop">
          {/* NEX как первый, «родной» вариант в той же поверхности */}
          <div className={`cmd-ask ${sel === 0 ? 'sel' : ''}`} onMouseEnter={() => setSel(0)} onClick={() => ask()}>
            <span className="ic"><Sparkles size={17} /></span>
            <span className="tx">
              <b>{hasQuery ? `Спросить NEX: «${q.trim()}»` : 'Открыть чат NEX'}</b>
              <span>{hasQuery ? 'ответит по данным и при необходимости откроет экран' : 'опишите задачу своими словами — NEX сделает'}</span>
            </span>
            <span className="cmd-ask-enter"><CornerDownLeft size={14} /></span>
          </div>

          {aiList.length > 0 && (
            <>
              <div className="cmd-section">{hasQuery ? 'ИИ-действия' : 'Что умеет NEX'}</div>
              {aiList.map((a, i) => {
                const Icon = a.icon; const idx = aiOffset + i;
                return (
                  <div className={`cmd-item ai ${sel === idx ? 'sel' : ''}`} key={a.id} onMouseEnter={() => setSel(idx)} onClick={() => a.run(ask, go)}>
                    <span className="cmd-ai-ic"><Icon size={15} /></span>
                    <span className="cmd-item-tx"><b>{a.label}</b><span>{a.hint}</span></span>
                    <Wand2 size={13} className="cmd-item-tail" />
                  </div>
                );
              })}
            </>
          )}

          {sections.length > 0 && (
            <>
              <div className="cmd-section">Разделы</div>
              {sections.map((it, i) => {
                const Icon = ALL_ITEMS[it.id].icon; const idx = secOffset + i;
                return (
                  <div className={`cmd-item ${sel === idx ? 'sel' : ''}`} key={it.id} onMouseEnter={() => setSel(idx)} onClick={() => go(it.id)}>
                    <Icon size={16} />{it.label}<span className="hint">{it.section}</span>
                  </div>
                );
              })}
            </>
          )}

          {people.length > 0 && (
            <>
              <div className="cmd-section">Люди</div>
              {people.map((p, i) => {
                const idx = peopleOffset + i;
                return (
                  <div className={`cmd-item ${sel === idx ? 'sel' : ''}`} key={p.id} onMouseEnter={() => setSel(idx)} onClick={() => openPerson(p.id)}>
                    <span className="avatar sm">{p.lastname[0]}{p.firstname[0]}</span>
                    {p.lastname} {p.firstname}<span className="hint">{p.group}</span>
                  </div>
                );
              })}
            </>
          )}

          {!hasQuery && (
            <>
              <div className="cmd-section">Подсказки</div>
              <div className="omni-chips">
                {suggestions.map((s) => (
                  <button className="omni-chip" key={s} onClick={() => ask(s)}><Sparkles size={12} />{s}</button>
                ))}
              </div>
            </>
          )}

          {hasQuery && flat.length === 1 && (
            <div className="cmd-item dim"><SearchIcon size={15} />Ничего не найдено — Enter, чтобы спросить NEX</div>
          )}

          <div className="omni-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> выбрать</span>
            <span><kbd>↵</kbd> открыть</span>
            <span><kbd>esc</kbd> закрыть</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== Shell (двухуровневая навигация) ===================== */
function Shell() {
  const { user, page, setPage, navOpen, setNavOpen, prefs } = useApp();
  if (!user) return null;

  const special = page === 'settings' || page === 'chat';
  const activeSection = special ? '' : (SECTION_OF[page] || 'feed');
  const section = SECTIONS.find((s) => s.id === activeSection);
  const nav = (id: string) => { setPage(id); setNavOpen(false); };
  const goSection = (s: Section) => { setPage(s.items[0].id); setNavOpen(false); };

  /* верхняя панель настраивается — скрытые разделы остаются доступны в поиске */
  const topIds = prefs.topbar && prefs.topbar.length ? prefs.topbar : DEFAULT_TOPBAR;
  const topSections = topIds.map((id) => SECTIONS.find((s) => s.id === id)).filter(Boolean) as Section[];

  return (
    <div className={`app2 ${navOpen ? 'subnav-open' : ''}`}>
      {/* верхняя панель: бренд + разделы + поиск/ИИ + профиль */}
      <header className="topbar2">
        <div className="brand2" onClick={() => nav('home')}>
          <div className="brand-mark">N</div><b>NEX</b>
        </div>
        <nav className="sections">
          {topSections.map((s) => {
            const Icon = s.icon;
            return (
              <button key={s.id} className={`section-tab ${activeSection === s.id ? 'on' : ''}`} onClick={() => goSection(s)}>
                <Icon size={17} /><span>{s.label}</span>
              </button>
            );
          })}
        </nav>
        <NexOmni />
        <button className="icon-btn" onClick={() => nav('settings')} aria-label="Настройки"><SettingsIcon size={19} /></button>
        <div className="avatar" title={`${user.name} · ${roleLabel[user.role]}`}>{(user.name[0] || 'U').toUpperCase()}</div>
      </header>

      {/* тело: слева подстраницы раздела, справа контент */}
      <div className="body2">
        {!special && section && (
          <>
            <aside className="subnav glass">
              <div className="subnav-title">{section.label}</div>
              {section.items.map((it) => {
                const Icon = it.icon;
                return (
                  <button key={it.id} className={`subnav-item ${page === it.id ? 'on' : ''}`} onClick={() => nav(it.id)}>
                    <Icon size={17} /><span>{it.label}</span>
                    {it.beta && <Beta />}
                    {it.id === 'security' && <span className="nav-badge">2</span>}
                  </button>
                );
              })}
            </aside>
            {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
          </>
        )}
        <main className={`stage2 ${special ? 'full' : ''} ${page === 'chat' ? 'content-flush' : ''}`}>
          {renderSub(page)}
        </main>
      </div>

      {page !== 'mail' && <MiniMessenger />}
      <ContextDrawer />
      <AiLayer />
    </div>
  );
}

/* ===================== Mobile shell (разделы снизу, подстраницы чипами) ===================== */
function MobileShell() {
  const { user, page, setPage, openChat, setUser, prefs } = useApp();
  const [drawer, setDrawer] = useState(false);
  const [dockHidden, setDockHidden] = useState(false);
  const lastY = useRef(0);

  /* докбар прячется при скролле вниз (и вместе с ним не мешает адресной
     строке Safari сворачиваться), возвращается при скролле вверх */
  useEffect(() => {
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastY.current;
      if (y < 48) setDockHidden(false);
      else if (dy > 6) setDockHidden(true);
      else if (dy < -6) setDockHidden(false);
      lastY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => { setDockHidden(false); }, [page]);

  if (!user) return null;

  const go = (id: string) => { setPage(id); setDrawer(false); };
  const isChat = page === 'chat';
  const isMail = page === 'mail';
  const special = page === 'settings' || isChat;
  const fullPage = isChat || isMail;
  const activeSection = special ? 'feed' : (SECTION_OF[page] || 'feed');
  const section = SECTIONS.find((s) => s.id === activeSection)!;
  const initials = (user.name[0] || 'U').toUpperCase();
  const title = special ? 'NEX' : isMail ? 'Сообщения' : section.label;

  const dockIds = prefs.dock && prefs.dock.length ? prefs.dock : DEFAULT_DOCK;
  const dockItems = dockIds.map((id) => DOCK_BY_ID[id]).filter(Boolean);
  const activeDock = special ? '' : isMail ? 'mail' : (SECTION_OF[page] || 'feed');

  return (
    <div className="m-shell">
      <header className="m-top x">
        <button className="m-avatar-btn" onClick={() => setDrawer(true)} aria-label="Меню"><span className="avatar">{initials}</span></button>
        <div className="m-brand-c"><div className="brand-mark" style={{ width: 24, height: 24, fontSize: 12 }}>N</div><b>{title}</b></div>
        <button className="icon-btn" onClick={() => openChat()} aria-label="Спросить NEX"><Sparkles size={19} /></button>
        <button className="icon-btn" onClick={() => go('settings')} aria-label="Настройки"><SettingsIcon size={20} /></button>
      </header>

      {!special && !isMail && (
        <div className="m-subtabs">
          {section.items.map((it) => (
            <button key={it.id} className={`m-subtab ${page === it.id ? 'on' : ''}`} onClick={() => go(it.id)}>{it.label}</button>
          ))}
        </div>
      )}

      <div className={`m-content ${fullPage ? 'flush' : ''}`}>
        {renderSub(page)}
      </div>

      <nav className={`m-tabs x ${dockHidden ? 'hide' : ''}`}>
        {dockItems.map((d) => {
          const Icon = d.icon;
          return <button key={d.id} className={`m-tab ${activeDock === d.id ? 'active' : ''}`} onClick={() => go(d.page)} aria-label={d.label}><Icon size={23} /></button>;
        })}
      </nav>

      {drawer && (
        <div className="m-drawer-veil" onClick={() => setDrawer(false)}>
          <div className="m-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="m-drawer-head">
              <span className="avatar lg">{initials}</span>
              <div className="m-drawer-id"><b>{user.name}</b><span className="dim">{roleLabel[user.role]}</span></div>
            </div>
            <div className="m-drawer-nav">
              {SECTIONS.map((s) => (
                <div key={s.id}>
                  <div className="m-drawer-group">{s.label}</div>
                  {s.items.map((it) => {
                    const Icon = it.icon;
                    return (
                      <button key={it.id} className={`m-drawer-item ${page === it.id ? 'active' : ''}`} onClick={() => go(it.id)}>
                        <Icon size={20} /><span>{it.label}</span>{it.beta && <Beta />}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className="m-drawer-sep" />
              <button className={`m-drawer-item ${page === 'settings' ? 'active' : ''}`} onClick={() => go('settings')}><SettingsIcon size={20} /><span>Настройки</span></button>
              <button className="m-drawer-item" onClick={() => setUser(null)}><LogOut size={20} /><span>Выйти</span></button>
            </div>
          </div>
        </div>
      )}

      {!fullPage && <MiniMessenger />}
      <ContextDrawer />
      <AiLayer />
    </div>
  );
}

export default function App() {
  const { user } = useApp();
  const isMobile = useIsMobile();
  if (!user) return <Login />;
  return isMobile ? <MobileShell /> : <Shell />;
}
