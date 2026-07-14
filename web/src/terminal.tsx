import { useState, useEffect, useRef, type ReactNode, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles, X, CornerDownLeft, LayoutDashboard, LineChart, Wallet, ShieldCheck, ListChecks,
} from 'lucide-react';
import { useApp } from './ui';
import { Md } from './md';
import { Line, Donut, Legend, type Segment } from './charts';
import {
  students, staff, sessions, auditEvents, failedLogins, services, finance, groups,
} from './data';
import { atRisk, attendanceRate, avgGrade, groupAvg, PAGE_TITLES } from './nexbrain';
import { type TermResult } from './api/terminal';
import { type Entity } from './beta/store';

/* ============================================================
   «NEX Терминал» (альфа) — экосистема администратора: весь
   функционал сайта доступен из одной консоли, без навигации по
   разделам. Это НЕ замена сайта (обычный UI живёт как жил) и не
   инструмент для программиста: команды — человеческие слова,
   подсказки всегда на виду, результат — те же таблицы/KPI/графики,
   что и на страницах. Один реестр команд обслуживает и компактный
   блок на «Главном», и полноэкранную среду.
   ============================================================ */

/* Результат демо-движка: структурированный ответ (как у бэкенда) +
   необязательный живой узел (график) — его умеет только фронт. */
export type TermRes = TermResult & { node?: ReactNode };

/* Задача в терминальном представлении — узкий взгляд на коллекцию
   'tasks', общую с разделом «Задачи». */
export interface TermTask extends Entity {
  title: string;
  status: string;
  due: string;
  [k: string]: unknown;
}

export const TERM_STATUS_LABEL: Record<string, string> = { open: 'открыта', in_progress: 'в работе', done: 'выполнена', canceled: 'отменена' };

/* --- Демо-журнал действий консоли (аудит терминала) --------------------- */

const TERM_AUDIT_KEY = 'nex-term-audit';
interface TermAuditRow { at: string; cmd: string; outcome: string }

export function termAuditPush(cmd: string) {
  try {
    const rows: TermAuditRow[] = JSON.parse(sessionStorage.getItem(TERM_AUDIT_KEY) || '[]');
    rows.unshift({ at: new Date().toISOString(), cmd, outcome: 'ok' });
    sessionStorage.setItem(TERM_AUDIT_KEY, JSON.stringify(rows.slice(0, 50)));
  } catch { /* квота — не критично */ }
}
export function termAuditList(): TermAuditRow[] {
  try { return JSON.parse(sessionStorage.getItem(TERM_AUDIT_KEY) || '[]'); } catch { return []; }
}

/* --- Реестр команд ------------------------------------------------------- */

export type TermDomain = 'Обзор' | 'Аналитика' | 'Финансы' | 'Безопасность' | 'Задачи';

export interface EngineCtx {
  userName: string;
  userRole: string;
  toast: (m: string) => void;
  setPage: (p: string) => void;
  tasks: { items: TermTask[]; add: (t: Partial<TermTask>) => unknown; update: (id: string, patch: Partial<TermTask>) => void };
}

export interface TermCommand {
  id: string;          // каноническое написание (показывается в подсказках)
  domain: TermDomain;
  aliases: string[];   // всё, что распознаём в первом слове (ru/en)
  arg?: string;        // подпись аргумента для подсказки, напр. "<текст>"
  desc: string;
  run: (args: string[], ctx: EngineCtx) => TermRes;
}

const rub = (n: number) => '₽ ' + n.toLocaleString('ru');

/* Должники: просроченные и частичные платежи. */
function debtors() {
  return finance.payments.filter((p) => p.status !== 'Оплачено');
}

export const TERM_COMMANDS: TermCommand[] = [
  /* ---------------- Обзор ---------------- */
  {
    id: 'обзор', domain: 'Обзор', aliases: ['обзор', 'status', 'статус', 'сводка'],
    desc: 'сводка системы: люди, задачи, деньги, безопасность',
    run: (_a, ctx) => ({
      kind: 'kpi', title: 'Система сейчас',
      kpis: [
        { label: 'Студентов', value: String(students.length) },
        { label: 'Открытых задач', value: String(ctx.tasks.items.filter((t) => t.status !== 'done' && t.status !== 'canceled').length) },
        { label: 'Задолженность', value: rub(248_000) },
        { label: 'Подозрительных входов', value: String(failedLogins.filter((f) => f.flagged).length) },
      ],
      hint: 'подробнее: аналитика · финансы · безопасность · задачи',
    }),
  },
  {
    id: 'кто я', domain: 'Обзор', aliases: ['кто', 'whoami', 'я'],
    desc: 'текущий пользователь и роль',
    run: (_a, ctx) => ({ kind: 'text', text: `**${ctx.userName}** · роль: ${ctx.userRole} · терминал-альфа` }),
  },
  {
    id: 'раздел', domain: 'Обзор', aliases: ['раздел', 'open', 'открой', 'открыть'], arg: '<имя>',
    desc: 'открыть раздел сайта (обычный UI никуда не делся)',
    run: (args, ctx) => {
      const n = args.join(' ').trim().toLowerCase();
      if (!n) return { kind: 'text', text: 'Какой раздел открыть? Например: раздел финансы.' };
      const targets = Object.entries(PAGE_TITLES).map(([page, label]) => ({ page, label }));
      const hit = targets.find((t) => t.label.toLowerCase() === n) || targets.find((t) => t.label.toLowerCase().includes(n));
      if (!hit) return { kind: 'text', text: `Раздел «${args.join(' ')}» не нашёл.`, hint: targets.slice(0, 6).map((t) => t.label.toLowerCase()).join(' · ') };
      window.setTimeout(() => ctx.setPage(hit.page), 150);
      return { kind: 'text', text: `Открываю «${hit.label}».` };
    },
  },

  /* ---------------- Аналитика ---------------- */
  {
    id: 'аналитика', domain: 'Аналитика', aliases: ['аналитика', 'analytics'],
    desc: 'ключевые показатели организации',
    run: () => {
      const rates = students.map((s) => attendanceRate(s.id));
      const att = Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);
      const avgs = students.map((s) => avgGrade(s.id, s.group)).filter((x) => x > 0);
      const avg = (avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(1);
      return {
        kind: 'kpi', title: 'Аналитика',
        kpis: [
          { label: 'Студентов', value: String(students.length) },
          { label: 'Посещаемость', value: att + '%' },
          { label: 'Средний балл', value: avg },
          { label: 'В зоне риска', value: String(atRisk().length) },
        ],
        hint: 'риск · группы · посещаемость',
      };
    },
  },
  {
    id: 'риск', domain: 'Аналитика', aliases: ['риск', 'risk', 'риски'],
    desc: 'студенты в зоне риска (посещаемость + балл)',
    run: () => ({
      kind: 'table', title: 'Зона риска',
      columns: ['Студент', 'Группа', 'Посещаемость', 'Балл'],
      rows: atRisk().slice(0, 8).map((r) => [r.name, r.group, r.rate + '%', r.avg.toFixed(1)]),
      hint: 'раздел студенты — открыть карточки',
    }),
  },
  {
    id: 'группы', domain: 'Аналитика', aliases: ['группы', 'groups', 'группа'],
    desc: 'сравнение групп: численность, балл, посещаемость',
    run: () => ({
      kind: 'table', title: 'Группы',
      columns: ['Группа', 'Студентов', 'Ср. балл', 'Посещаемость'],
      rows: groups.map((g) => {
        const inGroup = students.filter((s) => s.group === g.name);
        const att = inGroup.length ? Math.round(inGroup.map((s) => attendanceRate(s.id)).reduce((a, b) => a + b, 0) / inGroup.length) : 0;
        return [g.name, String(inGroup.length), groupAvg(g.name).toFixed(1), att + '%'];
      }),
    }),
  },
  {
    id: 'посещаемость', domain: 'Аналитика', aliases: ['посещаемость', 'attendance'],
    desc: 'динамика посещаемости за 12 недель',
    run: () => ({
      kind: 'text', title: 'Посещаемость · 12 недель', text: 'Средняя за период — **91%**, минимум на 9-й неделе (сессия).',
      node: <Line data={[93, 92, 94, 91, 90, 92, 91, 89, 86, 90, 92, 91]} height={110} color="var(--ai)" />,
      hint: 'риск — кто тянет вниз',
    }),
  },

  /* ---------------- Финансы ---------------- */
  {
    id: 'финансы', domain: 'Финансы', aliases: ['финансы', 'finance', 'деньги'],
    desc: 'сводка: поступления, долги, стипендии',
    run: () => {
      const paid = finance.payments.filter((p) => p.status === 'Оплачено').reduce((a, p) => a + p.sum, 0);
      const segs: Segment[] = [
        { label: 'Поступило', value: paid, color: 'var(--success)' },
        { label: 'Задолженность', value: 248_000, color: 'var(--danger)' },
      ];
      return {
        kind: 'kpi', title: 'Финансы',
        kpis: [
          { label: 'Поступило', value: rub(paid) },
          { label: 'Задолженность', value: rub(248_000) },
          { label: 'Должников', value: String(debtors().length) },
        ],
        node: <div className="chart-flex"><Donut segments={segs} size={110} centerTop="₽" centerSub="период" /><Legend segments={segs} withValues /></div>,
        hint: 'долги · платежи · напомнить должникам',
      };
    },
  },
  {
    id: 'долги', domain: 'Финансы', aliases: ['долги', 'debts', 'должники', 'задолженность'],
    desc: 'кто должен и сколько',
    run: () => ({
      kind: 'table', title: 'Должники',
      columns: ['Студент', 'Группа', 'Сумма', 'Статус'],
      rows: debtors().map((p) => [p.student, p.group, rub(p.sum), p.status]),
      hint: 'напомнить должникам — разослать уведомления',
    }),
  },
  {
    id: 'платежи', domain: 'Финансы', aliases: ['платежи', 'payments', 'оплаты'],
    desc: 'последние платежи',
    run: () => ({
      kind: 'table', title: 'Платежи',
      columns: ['Студент', 'Группа', 'Сумма', 'Дата', 'Статус'],
      rows: finance.payments.map((p) => [p.student, p.group, rub(p.sum), p.date, p.status]),
    }),
  },
  {
    id: 'стипендии', domain: 'Финансы', aliases: ['стипендии', 'scholarships', 'стипендия'],
    desc: 'назначенные стипендии',
    run: () => ({
      kind: 'table', title: 'Стипендии',
      columns: ['Студент', 'Тип', 'Сумма', 'Основание'],
      rows: finance.scholarships.map((s) => [s.student, s.type, rub(s.sum), s.basis]),
    }),
  },
  {
    id: 'напомнить должникам', domain: 'Финансы', aliases: ['напомнить', 'remind'],
    desc: 'разослать вежливые напоминания об оплате',
    run: (_a, ctx) => {
      const n = debtors().length;
      termAuditPush(`напоминания должникам (${n})`);
      ctx.toast(`Напоминания отправлены: ${n}`);
      return { kind: 'text', text: `Напоминания ушли **${n} должникам** · записано в журнал.`, hint: 'аудит — посмотреть журнал' };
    },
  },

  /* ---------------- Безопасность и система ---------------- */
  {
    id: 'безопасность', domain: 'Безопасность', aliases: ['безопасность', 'security'],
    desc: 'состояние безопасности и сервисов',
    run: () => ({
      kind: 'kpi', title: 'Безопасность',
      kpis: [
        { label: 'Подозрительные входы', value: String(failedLogins.filter((f) => f.flagged).length) },
        { label: 'Активные сессии', value: String(sessions.length) },
        { label: 'Сервисы с деградацией', value: String(services.filter((s) => s.status !== 'ok').length) },
      ],
      hint: 'входы · сессии · сервисы · аудит',
    }),
  },
  {
    id: 'входы', domain: 'Безопасность', aliases: ['входы', 'logins'],
    desc: 'неудачные попытки входа',
    run: () => ({
      kind: 'table', title: 'Неудачные входы',
      columns: ['Логин', 'IP', 'Откуда', 'Попыток', ''],
      rows: failedLogins.map((f) => [f.name, f.ip, f.location, String(f.attempts), f.flagged ? '⚑ подозрительно' : '']),
    }),
  },
  {
    id: 'сессии', domain: 'Безопасность', aliases: ['сессии', 'sessions'],
    desc: 'кто сейчас в системе',
    run: () => ({
      kind: 'table', title: 'Активные сессии',
      columns: ['Кто', 'Роль', 'Устройство', 'Где', 'Активность'],
      rows: sessions.map((s) => [s.name, s.role, s.device, s.location + (s.anomaly ? ' ⚑' : ''), s.active]),
    }),
  },
  {
    id: 'сервисы', domain: 'Безопасность', aliases: ['сервисы', 'services', 'система'],
    desc: 'здоровье компонентов системы',
    run: () => ({
      kind: 'table', title: 'Сервисы',
      columns: ['Компонент', 'Статус', 'Показатель'],
      rows: services.map((s) => [s.name, s.status === 'ok' ? 'ок' : 'деградация', s.value]),
    }),
  },
  {
    id: 'аудит', domain: 'Безопасность', aliases: ['аудит', 'audit', 'журнал'], arg: '[n]',
    desc: 'журнал действий: система + консоль',
    run: (args) => {
      const own = termAuditList().map((r) => [new Date(r.at).toLocaleTimeString('ru'), 'Вы (терминал)', r.cmd, 'консоль']);
      const sys = auditEvents.map((e) => [e.time, e.actor, e.action, e.target]);
      const limit = Math.min(Math.max(parseInt(args[0] || '12', 10) || 12, 1), 50);
      return {
        kind: 'table', title: 'Журнал аудита',
        columns: ['Когда', 'Кто', 'Действие', 'Где'],
        rows: [...own, ...sys].slice(0, limit),
      };
    },
  },
  {
    id: 'люди', domain: 'Безопасность', aliases: ['люди', 'users', 'пользователи', 'сотрудники'],
    desc: 'сотрудники и роли',
    run: () => ({
      kind: 'table', title: 'Люди организации',
      columns: ['Имя', 'Роль', 'Email'],
      rows: staff.map((s) => [s.name, s.role, s.email]),
      hint: 'уведомить <email|все> <текст> — написать',
    }),
  },

  /* ---------------- Задачи ---------------- */
  {
    id: 'задачи', domain: 'Задачи', aliases: ['задачи', 'tasks'], arg: '[open|done|all]',
    desc: 'список задач (та же коллекция, что и раздел)',
    run: (args, ctx) => {
      const st = (args[0] || 'open').toLowerCase();
      if (!['open', 'done', 'all'].includes(st)) return { kind: 'text', text: `Фильтр «${args[0]}» не знаю. Есть: open · done · all.` };
      const rows = ctx.tasks.items.filter((t) => (st === 'all' ? true : st === 'done' ? t.status === 'done' : t.status !== 'done' && t.status !== 'canceled'));
      if (!rows.length) return { kind: 'text', text: 'Задач нет.', hint: 'новая задача <текст> — создать' };
      return {
        kind: 'table', title: 'Задачи',
        columns: ['№', 'Задача', 'Статус', 'Срок'],
        rows: rows.slice(0, 15).map((t, i) => [String(i + 1), t.title, TERM_STATUS_LABEL[t.status] || t.status, t.due || '—']),
        hint: 'готово <№> — закрыть · новая задача <текст> — создать',
      };
    },
  },
  {
    id: 'новая задача', domain: 'Задачи', aliases: ['новая', 'task'], arg: '<текст>',
    desc: 'создать задачу — сразу видна в разделе «Задачи»',
    run: (args, ctx) => {
      /* поддерживаем и «task add <текст>», и «новая задача <текст>» */
      let words = args;
      if (words[0]?.toLowerCase() === 'add' || words[0]?.toLowerCase() === 'задача') words = words.slice(1);
      const title = words.join(' ').trim();
      if (!title) return { kind: 'text', text: 'Какую задачу создать? Например: новая задача Проверить отчёт.' };
      ctx.tasks.add({
        title, note: '', status: 'open', priority: 'normal', category: 'Общее', tags: [],
        due: '', assignees: [], watchers: [], recurrence: 'none', subtasks: [], checklist: [],
        comments: [], history: [{ id: 'h' + Date.now(), text: 'Создана из терминала', at: new Date().toISOString() }], attachments: [],
      } as Partial<TermTask>);
      termAuditPush(`новая задача: ${title}`);
      return { kind: 'text', text: `Задача создана: **${title}**.`, hint: 'задачи — список' };
    },
  },
  {
    id: 'готово', domain: 'Задачи', aliases: ['готово', 'done', 'закрыть'], arg: '<№>',
    desc: 'закрыть задачу по номеру из списка',
    run: (args, ctx) => {
      /* «task done 2» тоже работает */
      const n = parseInt(args[0] === 'done' ? args[1] : args[0], 10);
      const open = ctx.tasks.items.filter((t) => t.status !== 'done' && t.status !== 'canceled');
      const target = open[n - 1];
      if (!target) return { kind: 'text', text: `Открытой задачи №${args.join(' ')} нет.`, hint: 'задачи — посмотреть номера' };
      ctx.tasks.update(target.id, { status: 'done' } as Partial<TermTask>);
      termAuditPush(`готово: ${target.title}`);
      return { kind: 'text', text: `Задача закрыта: **${target.title}**.` };
    },
  },
  {
    id: 'уведомить', domain: 'Задачи', aliases: ['уведомить', 'notify'], arg: '<email|все> <текст>',
    desc: 'отправить уведомление сотрудникам',
    run: (args, ctx) => {
      if (args.length < 2) return { kind: 'text', text: 'Формат: уведомить <email|все> <текст>.', hint: 'люди — список адресов' };
      const to = args[0].toLowerCase();
      const text = args.slice(1).join(' ');
      const targets = to === 'все' || to === 'all' ? staff : staff.filter((s) => s.email.toLowerCase() === to);
      if (!targets.length) return { kind: 'text', text: `Получателя «${args[0]}» не нашёл.`, hint: 'люди — список адресов' };
      termAuditPush(`уведомить ${to}: ${text}`);
      ctx.toast(`Уведомление отправлено: ${targets.length}`);
      return { kind: 'text', text: `Уведомление ушло **${targets.length} получателям** · записано в журнал.` };
    },
  },
];

/* Ищет команду по первому слову (или двум) строки. Возвращает null,
   если строка не похожа на команду — тогда её разберёт ИИ. */
export function execRegistry(line: string, ctx: EngineCtx): TermRes | null {
  const words = line.trim().split(/\s+/);
  if (!words.length || !words[0]) return null;
  const w1 = words[0].toLowerCase();
  const cmd = TERM_COMMANDS.find((c) => c.aliases.includes(w1));
  if (!cmd) return null;
  return cmd.run(words.slice(1), ctx);
}

/* Подсказки: команды, чьё имя/алиас начинается с ввода. Пустой ввод —
   ничего (легенда доменов и так на экране). */
export function suggest(input: string): TermCommand[] {
  const q = input.trim().toLowerCase();
  if (!q) return [];
  return TERM_COMMANDS
    .filter((c) => c.id.startsWith(q) || c.aliases.some((a) => a.startsWith(q)))
    .slice(0, 6);
}

/* --- Рендер структурированного результата -------------------------------- */

export function TermResBlock({ r }: { r: TermRes }) {
  return (
    <>
      {r.title && <div className="term-res-title">{r.title}</div>}
      {r.text && <Md text={r.text} />}
      {r.kind === 'kpi' && r.kpis && (
        <div className="chat-data kpi-row">
          {r.kpis.map((k) => (
            <div className="kpi" key={k.label}><div className="kpi-label">{k.label}</div><div className="kpi-value">{k.value}</div></div>
          ))}
        </div>
      )}
      {r.kind === 'table' && r.rows && r.rows.length > 0 && (
        <div className="chat-data table-wrap">
          <table className="tbl">
            <thead><tr>{r.columns?.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{r.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {r.node && <div className="chat-data">{r.node}</div>}
      {r.hint && <div className="term-hint">{r.hint}</div>}
    </>
  );
}

/* ============================================================
   Полноэкранная среда терминала. Поверх сайта (обычный UI остаётся),
   Esc или ✕ возвращают назад. Слева — домены функционала, снизу —
   строка с живыми подсказками, посередине — лента результатов.
   ============================================================ */

const DOMAIN_META: { id: TermDomain; icon: typeof Sparkles; cmd: string }[] = [
  { id: 'Обзор', icon: LayoutDashboard, cmd: 'обзор' },
  { id: 'Аналитика', icon: LineChart, cmd: 'аналитика' },
  { id: 'Финансы', icon: Wallet, cmd: 'финансы' },
  { id: 'Безопасность', icon: ShieldCheck, cmd: 'безопасность' },
  { id: 'Задачи', icon: ListChecks, cmd: 'задачи' },
];

interface WsMsg { who: 'u' | 'n'; text?: string; res?: TermRes }

export function TerminalWorkspace({ ctx, onClose }: { ctx: EngineCtx; onClose: () => void }) {
  const { user } = useApp();
  const [log, setLog] = useState<WsMsg[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [domain, setDomain] = useState<TermDomain>('Обзор');
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sugs = suggest(q);

  const runLine = (line: string) => {
    const cmd = line.trim();
    if (!cmd) return;
    setQ(''); setSel(0);
    if (cmd.toLowerCase() === 'очистить' || cmd.toLowerCase() === 'clear') { setLog([]); return; }
    const res = execRegistry(cmd, ctx);
    const found = TERM_COMMANDS.find((c) => c.aliases.includes(cmd.split(/\s+/)[0].toLowerCase()));
    if (found) setDomain(found.domain);
    setLog((l) => [...l, { who: 'u', text: cmd },
      res ? { who: 'n', res } : { who: 'n', res: { kind: 'text', text: 'Не понял команду — попробуйте подсказки под строкой или кликните домен слева.', hint: TERM_COMMANDS.slice(0, 5).map((c) => c.id).join(' · ') } }]);
  };

  /* Esc — выход; автозапуск обзора при первом входе. */
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  /* защёлка от двойного вызова эффекта в StrictMode (dev) */
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    runLine('обзор'); inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; }, [log]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!sugs.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, sugs.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Tab') { e.preventDefault(); setQ(sugs[sel].id + (sugs[sel].arg ? ' ' : '')); }
    else if (e.key === 'Enter' && sugs[sel] && !q.trim().includes(' ') && !sugs[sel].arg) {
      /* Enter по подсказке без аргументов — запускаем её сразу */
      e.preventDefault(); runLine(sugs[sel].id);
    }
  };

  const submit = (e: FormEvent) => { e.preventDefault(); runLine(q); };
  const domainCmds = TERM_COMMANDS.filter((c) => c.domain === domain);

  /* Портал в body: у карточек сайта есть backdrop-filter, а такой предок
     превращает position:fixed в «absolute относительно себя» — среда
     должна жить поверх всего документа, вне стеклянных контейнеров. */
  return createPortal(
    <div className="term-ws" role="dialog" aria-label="Терминал NEX">
      <div className="term-ws-head">
        <span className="ai-orb sm"><Sparkles size={12} /></span>
        <b>NEX Терминал</b>
        <span className="alpha-badge">альфа</span>
        <span className="term-ws-user">{user?.name || ctx.userName} · {ctx.userRole}</span>
        <button className="icon-btn" title="Выйти из терминала (Esc)" onClick={onClose}><X size={17} /></button>
      </div>

      <div className="term-ws-main">
        <div className="term-ws-rail">
          {DOMAIN_META.map((d) => { const Icon = d.icon; return (
            <button key={d.id} className={domain === d.id ? 'on' : ''} onClick={() => { setDomain(d.id); runLine(d.cmd); }}>
              <Icon size={15} /><span>{d.id}</span>
            </button>
          ); })}
        </div>

        <div className="term-ws-work">
          <div className="term-ws-body" ref={bodyRef}>
            {log.map((m, i) => m.who === 'u' ? (
              <div className="term-u" key={i}><span className="term-prompt">›</span><b className="term-cmd">{m.text}</b></div>
            ) : (
              <div className="term-n" key={i}>{m.res && <TermResBlock r={m.res} />}</div>
            ))}
          </div>

          {/* команды активного домена — всегда на виду, кликабельны */}
          <div className="term-ws-cmds">
            {domainCmds.map((c) => (
              <button key={c.id} onClick={() => (c.arg ? (setQ(c.id + ' '), inputRef.current?.focus()) : runLine(c.id))}>
                <code>{c.id}{c.arg ? ' ' + c.arg : ''}</code><span>{c.desc}</span>
              </button>
            ))}
          </div>

          <form className="term-ws-input" onSubmit={submit}>
            {sugs.length > 0 && (
              <div className="term-sug">
                {sugs.map((s, i) => (
                  <button type="button" key={s.id} className={i === sel ? 'sel' : ''}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => (s.arg ? (setQ(s.id + ' '), inputRef.current?.focus()) : runLine(s.id))}>
                    <code>{s.id}{s.arg ? ' ' + s.arg : ''}</code><span>{s.desc}</span>
                  </button>
                ))}
              </div>
            )}
            <span className="term-prompt">›</span>
            <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKeyDown}
              placeholder="Команда или слово: финансы, риск, долги, сессии… (Tab — дополнить)" />
            <button className="console-send" type="submit" aria-label="Выполнить"><CornerDownLeft size={15} /></button>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  );
}
