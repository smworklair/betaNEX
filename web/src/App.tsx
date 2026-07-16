import { useState, useEffect, useMemo, useRef, lazy, Suspense, type ComponentType, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Users, School, ClipboardList, Calendar, BookOpen, CheckSquare,
  Wallet, Award, Briefcase, BarChart3, GraduationCap, ShieldCheck, Settings as SettingsIcon,
  Bell, Sparkles, Lock, User as UserIcon, ArrowRight, LogOut,
  Newspaper, Home as HomeIcon, CalendarDays, TrendingUp, Receipt, HandCoins,
  FileBarChart, Calculator, Banknote, PiggyBank, Landmark, UserCheck, ClipboardCheck, Snowflake,
  MessageSquare, FileText, Cloud as CloudIcon, Compass, Bot, Rss, FlaskConical, Megaphone,
  Wand2, PenLine, Languages, ListChecks, UserSearch, CornerDownLeft, Search as SearchIcon,
  AlertTriangle,
  Building2, BookOpenCheck, ReceiptText, FileCheck2, FileSignature, CreditCard,
  BookMarked, NotebookPen, FileSpreadsheet, ScrollText, Building, UserCog,
  LayoutDashboard, KeyRound, Activity, Monitor, BadgeCheck, DatabaseBackup,
  PanelLeftClose, PanelLeftOpen, ArrowLeftRight, LineChart,
  type LucideIcon,
} from 'lucide-react';
import { useApp, Beta, useIsMobile, type User } from './ui';
import { auth as authApi, ApiError } from './api';
import { DOCK_BY_ID, DEFAULT_DOCK, DEFAULT_TOPBAR } from './dock';
import { roleLabel, students, type Role } from './data';
import { ContextDrawer } from './blocks';
import { AiLayer } from './ai';
import { MiniMessenger } from './pages/social';

/* ---- Ленивая загрузка страниц: код каждого раздела попадает в свой чанк
   и подгружается только при первом переходе в него (React.lazy + Suspense
   в renderSub ниже), а не одним куском в главный бандл вместе со всем
   остальным приложением. lazyOf — маленький адаптер под именованные
   экспорты (не у всех страниц default export). */
function lazyOf<M, K extends keyof M>(loader: () => Promise<M>, name: K): ComponentType {
  return lazy(() => loader().then((m) => ({ default: m[name] as unknown as ComponentType }))) as ComponentType;
}

const Chat = lazy(() => import('./pages/Chat'));
const Settings = lazy(() => import('./pages/Settings'));
const Home = lazy(() => import('./pages/Home'));
const Campus = lazy(() => import('./pages/campus'));
const Agents = lazy(() => import('./pages/agents'));

const PAGES: Record<string, ComponentType> = {
  home: Home,
  community: lazyOf(() => import('./pages/social'), 'Community'),
  mail: lazyOf(() => import('./pages/social'), 'Mail'),
  broadcast: lazyOf(() => import('./pages/social'), 'Broadcast'),
  tasks: lazyOf(() => import('./pages/tasks'), 'Tasks'),
  notifications: lazyOf(() => import('./pages/beta'), 'NotificationsPage'),
  calendar: lazyOf(() => import('./pages/calendar'), 'CalendarPage'),
  nexlog: lazyOf(() => import('./pages/extra'), 'NexHistory'),

  'fin-overview': lazyOf(() => import('./pages/finance-pro'), 'FinCockpit'),
  'fin-reconcile': lazyOf(() => import('./pages/finance-pro'), 'FinReconcile'),
  'fin-close': lazyOf(() => import('./pages/finance-pro'), 'FinClose'),
  'fin-studio': lazyOf(() => import('./pages/finance-pro'), 'FinStudio'),
  'fin-payments': lazyOf(() => import('./pages/accounting'), 'FinPayments'),
  'fin-invoices': lazyOf(() => import('./pages/finance-beta'), 'FinInvoices'),
  'fin-vat': lazyOf(() => import('./pages/finance-beta'), 'FinVat'),
  'fin-acts': lazyOf(() => import('./pages/finance-beta'), 'FinActs'),
  'fin-contracts': lazyOf(() => import('./pages/finance-beta'), 'FinContracts'),
  'fin-debts': lazyOf(() => import('./pages/accounting'), 'FinDebts'),
  'fin-receivables': lazyOf(() => import('./pages/finance-beta'), 'FinReceivables'),
  'fin-payables': lazyOf(() => import('./pages/finance-beta'), 'FinPayables'),
  'fin-charges': lazyOf(() => import('./pages/accounting'), 'FinCharges'),
  'fin-cash': lazyOf(() => import('./pages/finance-beta'), 'FinCashbook'),
  'fin-bank': lazyOf(() => import('./pages/finance-beta'), 'FinBank'),
  'fin-journal': lazyOf(() => import('./pages/finance-beta'), 'FinJournal'),
  'fin-calc': lazyOf(() => import('./pages/accounting'), 'FinCalc'),
  'fin-payroll': lazyOf(() => import('./pages/accounting'), 'FinPayroll'),
  'fin-scholarship': lazyOf(() => import('./pages/accounting'), 'FinScholarship'),
  'fin-budget': lazyOf(() => import('./pages/accounting'), 'FinBudget'),
  'fin-reports': lazyOf(() => import('./pages/accounting'), 'FinReports'),

  journal: lazyOf(() => import('./pages/academic'), 'Journal'),
  schedule: lazyOf(() => import('./pages/academic'), 'Schedule'),
  attendance: lazyOf(() => import('./pages/academic'), 'Attendance'),
  exams: lazyOf(() => import('./pages/extra'), 'Exams'),
  disciplines: lazyOf(() => import('./pages/academic-beta'), 'Disciplines'),
  homework: lazyOf(() => import('./pages/academic-beta'), 'Homeworks'),
  sheets: lazyOf(() => import('./pages/academic-beta'), 'GradeSheets'),
  curricula: lazyOf(() => import('./pages/academic-beta'), 'Curricula'),
  orders: lazyOf(() => import('./pages/academic-beta'), 'Orders'),

  students: lazyOf(() => import('./pages/people'), 'Students'),
  groups: lazyOf(() => import('./pages/people'), 'Groups'),
  staff: lazyOf(() => import('./pages/people'), 'Staff'),
  employees: lazyOf(() => import('./pages/people-beta'), 'Employees'),
  departments: lazyOf(() => import('./pages/people-beta'), 'Departments'),
  curators: lazyOf(() => import('./pages/people-beta'), 'Curators'),
  admissions: lazyOf(() => import('./pages/operations'), 'Admissions'),

  analytics: lazyOf(() => import('./pages/insights'), 'Analytics'),
  dashboards: lazyOf(() => import('./pages/analytics-beta'), 'AnalyticsPro'),
  graduation: lazyOf(() => import('./pages/insights'), 'Graduation'),

  security: lazyOf(() => import('./pages/Dashboard'), 'SecurityConsole'),
  'sec-users': lazyOf(() => import('./pages/security-beta'), 'SecUsers'),
  'sec-roles': lazyOf(() => import('./pages/security-beta'), 'SecRoles'),
  'sec-audit': lazyOf(() => import('./pages/security-beta'), 'SecAudit'),
  'sec-sessions': lazyOf(() => import('./pages/security-beta'), 'SecSessions'),
  'sec-keys': lazyOf(() => import('./pages/security-beta'), 'SecKeys'),
  'sec-policies': lazyOf(() => import('./pages/security-beta'), 'SecPolicies'),
  'sec-backup': lazyOf(() => import('./pages/security-beta'), 'SecBackup'),

  documents: lazyOf(() => import('./pages/beta'), 'Documents'),
  feed: lazyOf(() => import('./pages/beta'), 'Feed'),
  cloud: lazyOf(() => import('./pages/beta'), 'Cloud'),
  campus: Campus,
  agents: Agents,
};

/* ---- Двухуровневая навигация: разделы сверху → подстраницы слева ---- */
interface SubItem { id: string; label: string; icon: LucideIcon; beta?: boolean; }
interface Section { id: string; label: string; icon: LucideIcon; items: SubItem[]; }

const SECTIONS: Section[] = [
  { id: 'feed', label: 'Лента', icon: Newspaper, items: [
    { id: 'home', label: 'Главное', icon: HomeIcon },
    { id: 'community', label: 'Сообщество', icon: Rss },
    { id: 'mail', label: 'Сообщения', icon: MessageSquare },
    { id: 'broadcast', label: 'Рассылка', icon: Megaphone },
    { id: 'tasks', label: 'Задачи', icon: CheckSquare },
    { id: 'notifications', label: 'Уведомления', icon: Bell },
    { id: 'calendar', label: 'Календарь', icon: CalendarDays },
    { id: 'nexlog', label: 'История NEX', icon: Sparkles },
  ] },
  { id: 'finance', label: 'Финансы', icon: Wallet, items: [
    { id: 'fin-overview', label: 'Финансовый центр', icon: TrendingUp },
    { id: 'fin-reconcile', label: 'Сверка банка', icon: ArrowLeftRight },
    { id: 'fin-close', label: 'Закрытие периода', icon: ClipboardCheck },
    { id: 'fin-studio', label: 'Экономика и сценарии', icon: LineChart },
    { id: 'fin-payments', label: 'Платежи', icon: Receipt },
    { id: 'fin-invoices', label: 'Счета', icon: FileText, beta: true },
    { id: 'fin-vat', label: 'Счета-фактуры', icon: ReceiptText, beta: true },
    { id: 'fin-acts', label: 'Акты', icon: FileCheck2, beta: true },
    { id: 'fin-contracts', label: 'Договоры', icon: FileSignature, beta: true },
    { id: 'fin-debts', label: 'Задолженности', icon: HandCoins },
    { id: 'fin-receivables', label: 'Дебиторка', icon: HandCoins, beta: true },
    { id: 'fin-payables', label: 'Кредиторка', icon: CreditCard, beta: true },
    { id: 'fin-charges', label: 'Начисления', icon: FileBarChart },
    { id: 'fin-cash', label: 'Касса', icon: Wallet, beta: true },
    { id: 'fin-bank', label: 'Банк', icon: Building2, beta: true },
    { id: 'fin-journal', label: 'Журнал операций', icon: BookOpenCheck, beta: true },
    { id: 'fin-calc', label: 'Расчёты', icon: Calculator },
    { id: 'fin-payroll', label: 'Зарплата', icon: Banknote },
    { id: 'fin-scholarship', label: 'Стипендии', icon: Award },
    { id: 'fin-budget', label: 'Бюджет', icon: PiggyBank },
    { id: 'fin-reports', label: 'Отчёты', icon: Landmark },
  ] },
  { id: 'study', label: 'Учёба', icon: GraduationCap, items: [
    { id: 'journal', label: 'Журнал оценок', icon: BookOpen },
    { id: 'schedule', label: 'Расписание', icon: Calendar },
    { id: 'attendance', label: 'Посещаемость', icon: UserCheck },
    { id: 'exams', label: 'Сессия', icon: ClipboardCheck },
    { id: 'disciplines', label: 'Дисциплины', icon: BookMarked, beta: true },
    { id: 'homework', label: 'Домашние задания', icon: NotebookPen, beta: true },
    { id: 'sheets', label: 'Ведомости', icon: FileSpreadsheet, beta: true },
    { id: 'curricula', label: 'Учебные планы', icon: GraduationCap, beta: true },
    { id: 'orders', label: 'Приказы', icon: ScrollText, beta: true },
  ] },
  { id: 'people', label: 'Люди', icon: Users, items: [
    { id: 'students', label: 'Студенты', icon: Users },
    { id: 'groups', label: 'Группы', icon: School },
    { id: 'staff', label: 'Сотрудники', icon: Briefcase },
    { id: 'employees', label: 'Кадры', icon: UserCog, beta: true },
    { id: 'departments', label: 'Отделения', icon: Building, beta: true },
    { id: 'curators', label: 'Кураторы', icon: UserCheck, beta: true },
    { id: 'admissions', label: 'Приём', icon: ClipboardList },
  ] },
  { id: 'analytics', label: 'Аналитика', icon: BarChart3, items: [
    { id: 'analytics', label: 'Обзор', icon: BarChart3 },
    { id: 'dashboards', label: 'Дашборды', icon: LayoutDashboard, beta: true },
    { id: 'graduation', label: 'Выпуск', icon: GraduationCap },
  ] },
  { id: 'security', label: 'Безопасность', icon: ShieldCheck, items: [
    { id: 'security', label: 'Обзор', icon: ShieldCheck },
    { id: 'sec-users', label: 'Пользователи', icon: Users, beta: true },
    { id: 'sec-roles', label: 'Роли и права', icon: BadgeCheck, beta: true },
    { id: 'sec-audit', label: 'Аудит', icon: Activity, beta: true },
    { id: 'sec-sessions', label: 'Сессии и устройства', icon: Monitor, beta: true },
    { id: 'sec-keys', label: 'Ключи и доступ', icon: KeyRound, beta: true },
    { id: 'sec-policies', label: 'Политики', icon: Lock, beta: true },
    { id: 'sec-backup', label: 'Копии и мониторинг', icon: DatabaseBackup, beta: true },
  ] },
  { id: 'beta', label: 'Бета', icon: FlaskConical, items: [
    { id: 'documents', label: 'Документы', icon: FileText, beta: true },
    { id: 'feed', label: 'Витрина', icon: Newspaper, beta: true },
    { id: 'cloud', label: 'Облако', icon: CloudIcon, beta: true },
    { id: 'campus', label: 'Кампус', icon: Compass, beta: true },
    { id: 'agents', label: 'Агенты', icon: Bot, beta: true },
  ] },
];

const ALL_ITEMS: Record<string, SubItem> = {};
const SECTION_OF: Record<string, string> = {};
SECTIONS.forEach((s) => s.items.forEach((it) => { ALL_ITEMS[it.id] = it; SECTION_OF[it.id] = s.id; }));

/* Пустой fallback: большинство разделов подгружаются за десятки
   миллисекунд на локальной сети/кэше браузера, отдельный спиннер под
   каждый переход добавил бы больше мерцания, чем пользы. */
function renderSub(id: string) {
  if (id === 'settings') {
    return <Suspense fallback={null}><Settings /></Suspense>;
  }
  const Comp = id === 'chat' ? Chat : (PAGES[id] ?? Home);
  return <Suspense fallback={null}><Comp /></Suspense>;
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
  const apiMode = authApi.authConfigured();
  const [role, setRole] = useState<Role>('admin');
  const [name, setName] = useState('');
  const [tenant, setTenant] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');

    // Реальный вход через бэкенд (VITE_API_URL задан).
    if (apiMode) {
      if (!tenant.trim() || !email.trim() || !pass) { setErr('Заполните организацию, email и пароль'); return; }
      setBusy(true);
      try {
        const u = await authApi.apiLogin(tenant.trim(), email.trim(), pass);
        setUser({
          name: u.display_name || u.email,
          role: authApi.primaryRole(u.roles),
          id: u.id, email: u.email, tenant: u.tenant, roles: u.roles,
        });
        setPage('home');
      } catch (e2) {
        setErr(e2 instanceof ApiError ? (e2.detail || e2.title) : 'Не удалось войти. Проверьте подключение к серверу.');
      } finally {
        setBusy(false);
      }
      return;
    }

    // Демо-режим (бэкенд не подключён): вход по имени и паролю 0000.
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
          <p className="muted" style={{ fontSize: 14, marginTop: 4, marginBottom: 20 }}>
            {apiMode
              ? <>Вход в вашу организацию NEX по email и паролю.</>
              : <>Выберите, кто вы, и войдите. Пароль для входа: <b className="mono">0000</b></>}
          </p>

          {apiMode ? (
            <>
              <label className="field-label">Организация</label>
              <div style={{ position: 'relative', marginBottom: 14 }}>
                <ShieldCheck size={15} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-3)' }} />
                <input className="input" style={{ paddingLeft: 34 }} value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="slug организации" autoComplete="organization" />
              </div>

              <label className="field-label">Email</label>
              <div style={{ position: 'relative', marginBottom: 14 }}>
                <UserIcon size={15} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-3)' }} />
                <input className="input" style={{ paddingLeft: 34 }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.ru" autoComplete="username" />
              </div>
            </>
          ) : (
            <>
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
            </>
          )}

          <label className="field-label">Пароль</label>
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <Lock size={15} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingLeft: 34 }} type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={apiMode ? '••••••••' : '0000'} autoComplete="current-password" />
          </div>

          {err && <div className="chip chip-danger" style={{ marginBottom: 14 }}>{err}</div>}

          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', height: 40 }} type="submit" disabled={busy}>
            {apiMode ? (busy ? 'Вхожу…' : <>Войти <ArrowRight size={16} /></>) : <>Войти как {roleLabel[role]} <ArrowRight size={16} /></>}
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
  const { user, page, setPage, navOpen, setNavOpen, prefs, setPref, openChat } = useApp();
  const collapsed = prefs.sidebar === 'collapsed';

  /* --- Горячие клавиши --- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      // Ctrl+B — свернуть/развернуть боковую панель
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault(); setPref('sidebar', prefs.sidebar === 'collapsed' ? 'expanded' : 'collapsed'); return;
      }
      // Ctrl+I — открыть чат NEX
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); openChat(); return; }
      // Alt+1..9 — перейти к разделу верхней панели
      if (e.altKey && !typing && /^[1-9]$/.test(e.key)) {
        const ids = prefs.topbar && prefs.topbar.length ? prefs.topbar : DEFAULT_TOPBAR;
        const s = SECTIONS.find((x) => x.id === ids[+e.key - 1]);
        if (s) { e.preventDefault(); setPage(s.items[0].id); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [prefs.sidebar, prefs.topbar, setPref, setPage, openChat]);

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
            <aside className={`subnav glass ${collapsed ? 'collapsed' : ''}`}>
              <div className="subnav-head">
                <span className="subnav-title">{section.label}</span>
                <button className="subnav-collapse" onClick={() => setPref('sidebar', collapsed ? 'expanded' : 'collapsed')}
                  title={collapsed ? 'Развернуть панель (Ctrl+B)' : 'Свернуть панель (Ctrl+B)'} aria-label="Свернуть панель">
                  {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
                </button>
              </div>
              {section.items.map((it) => {
                const Icon = it.icon;
                return (
                  <button key={it.id} className={`subnav-item ${page === it.id ? 'on' : ''}`} onClick={() => nav(it.id)} title={collapsed ? it.label : undefined}>
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
              <button className="m-drawer-item" onClick={() => { void authApi.apiLogout(); setUser(null); }}><LogOut size={20} /><span>Выйти</span></button>
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
