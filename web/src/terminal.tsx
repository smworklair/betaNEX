import { useState, useEffect, useRef, useMemo, type ReactNode, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles, X, CornerDownLeft, LayoutDashboard, LineChart, Wallet, ShieldCheck, ListChecks,
  Users, Calendar, GraduationCap, RotateCw,
} from 'lucide-react';
import { useApp } from './ui';
import { Md } from './md';
import { Line, Donut, Legend, type Segment } from './charts';
import {
  students, staff, sessions, auditEvents, failedLogins, services, finance, groups,
  scheduleDays, scheduleSlots, charges, payroll, exams,
} from './data';
import { atRisk, attendanceRate, avgGrade, groupAvg, PAGE_TITLES } from './nexbrain';
import { TERMINAL_BACKEND_TOKENS, type TermResult } from './api/terminal';
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

export type TermDomain = 'Обзор' | 'Аналитика' | 'Финансы' | 'Безопасность' | 'Задачи' | 'Кампус' | 'Люди' | 'Расписание';

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
  mutates?: boolean;  // true — команда изменяет данные (требует подтверждения)
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
  {
    id: 'студент', domain: 'Кампус', aliases: ['студент', 'student'], arg: '<фамилия|email>',
    desc: 'найти студента по фамилии или email (разрешение неоднозначности)',
    run: (args, ctx) => {
      if (args.length === 0) return { kind: 'text', text: 'Укажите фамилию или email: студент иванов' };
      const q = args.join(' ').toLowerCase().trim();
      const matches = students.filter((s) =>
        s.lastname.toLowerCase().includes(q) ||
        s.firstname.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q)
      );
      if (matches.length === 0) return { kind: 'text', text: `Студент «${args.join(' ')}» не найден.`, hint: 'студенты — список всех' };
      if (matches.length > 1) {
        return {
          kind: 'table',
          title: 'Нашлось несколько студентов',
          columns: ['ФИО', 'Группа', 'Email', 'Статус'],
          rows: matches.map((s) => [s.lastname + ' ' + s.firstname, s.group, s.email, s.status]),
          hint: 'укажите точнее фамилию или email',
        };
      }
      const s = matches[0];
      return {
        kind: 'table',
        title: `Студент: ${s.lastname} ${s.firstname}`,
        columns: ['Поле', 'Значение'],
        rows: [
          ['Группа', s.group],
          ['Форма', s.form],
          ['Финансирование', s.finance],
          ['Email', s.email],
          ['Телефон', s.phone],
          ['Статус', s.status],
        ],
        hint: `оценки ${s.lastname.toLowerCase()} — журнал оценок`,
      };
    },
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
    id: 'новая задача', domain: 'Задачи', aliases: ['новая', 'task'], arg: '<текст>', mutates: true,
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
    id: 'готово', domain: 'Задачи', aliases: ['готово', 'done', 'закрыть'], arg: '<№>', mutates: true,
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

  /* ---------------- Кампус (учёба) ---------------- */
  {
    id: 'расписание', domain: 'Кампус', aliases: ['расписание', 'schedule'],
    desc: 'расписание групп на текущую неделю',
    run: () => ({
      kind: 'table', title: 'Расписание',
      columns: ['Время', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт'],
      rows: scheduleSlots.map((s) => [s.time, s.mon, s.tue, s.wed, s.thu, s.fri]),
    }),
  },
  {
    id: 'экзамены', domain: 'Кампус', aliases: ['экзамены', 'exams'],
    desc: 'сессия: экзамены и готовность',
    run: () => ({
      kind: 'table', title: 'Экзамены (сессия)',
      columns: ['Группа', 'Предмет', 'Дата', 'Ауд.', 'Готово', 'Всего'],
      rows: exams.map((e) => [e.group, e.subject, e.date, e.room, String(e.ready), String(e.total)]),
      hint: 'расписание — обычное расписание',
    }),
  },
  {
    id: 'начисления', domain: 'Кампус', aliases: ['начисления', 'charges'],
    desc: 'студенты со счётами за учёбу и услуги',
    run: () => ({
      kind: 'table', title: 'Начисления',
      columns: ['Студент', 'Группа', 'Вид', 'Сумма', 'Срок', 'Статус'],
      rows: charges.map((c) => [c.student, c.group, c.kind, rub(c.sum), c.due, c.paid ? 'Оплачено' : 'Долг']),
      hint: 'долги — только просроченные',
    }),
  },

  /* ---------------- Люди (сотрудники) ---------------- */
  {
    id: 'сотрудники', domain: 'Люди', aliases: ['сотрудники', 'staff', 'преподаватели'],
    desc: 'преподаватели и их нагрузка',
    run: () => ({
      kind: 'table', title: 'Сотрудники',
      columns: ['Имя', 'Роль', 'Отдел', 'Нагрузка', 'Email', 'Статус'],
      rows: staff.map((s) => [s.name, s.role, s.dept, s.load ? `${s.load} ч` : '—', s.email, s.status]),
    }),
  },

  /* ---------------- Расписание ---------------- */
  {
    id: 'новое окно', domain: 'Расписание', aliases: ['окно', 'free', 'free slot'], arg: '<день> <время>',
    desc: 'найти свободное окно в расписании',
    run: (args) => {
      if (args.length < 2) {
        return { kind: 'text', text: 'Укажите день и время: новое окно Пн 12:00' };
      }
      const day = args[0].toLowerCase();
      const time = args[1];
      const dayMap: Record<string, number> = { пн: 0, вт: 1, ср: 2, чт: 3, пт: 4 };
      const slot = scheduleSlots.find((s) => s.mon.includes(time) || s.tue.includes(time) || s.wed.includes(time) || s.thu.includes(time) || s.fri.includes(time));
      if (!slot) return { kind: 'text', text: `Время "${time}" не найдено в расписании.` };
      const dayIdx = dayMap[day] || 0;
      const times = [slot.mon, slot.tue, slot.wed, slot.thu, slot.fri];
      const hit = times[dayIdx];
      if (hit && hit.includes('— окно —')) {
        return { kind: 'text', text: `Свободное окно: ${time} в ${scheduleDays[dayIdx]}` };
      }
      return { kind: 'text', text: `В это время уже есть занятие. Попробуйте другое время.` };
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

/* --- Поиск команд для меню (.cmenu) — общий для обоих режимов ----------- */

/* Группирует команды по доменам (для меню с пустым запросом). */
function paletteByDomain(): { domain: TermDomain; commands: TermCommand[] }[] {
  const byDomain: Record<string, TermCommand[]> = {};
  TERM_COMMANDS.forEach((c) => { (byDomain[c.domain] ||= []).push(c); });
  return Object.entries(byDomain).map(([domain, commands]) => ({
    domain: domain as TermDomain,
    commands: [...commands].sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

/* Ранг совпадения: точное имя/алиас → префикс имени → префикс алиаса →
   вхождение в имя → вхождение в описание. -1 — не совпало. */
function cmdScore(c: TermCommand, q: string): number {
  if (c.id === q || c.aliases.includes(q)) return 0;
  if (c.id.startsWith(q)) return 1;
  if (c.aliases.some((a) => a.startsWith(q))) return 2;
  if (c.id.includes(q)) return 3;
  if (c.desc.toLowerCase().includes(q)) return 4;
  return -1;
}

export interface CmdSearch {
  /* domain === null — плоский режим поиска: без секций, лучшие сверху */
  groups: { domain: TermDomain | null; commands: TermCommand[] }[];
  flat: TermCommand[];
}

/* Пустой запрос — все команды по доменам; непустой — плоский список,
   отсортированный по качеству совпадения (id, алиасы, описание). */
export function searchCommands(input: string): CmdSearch {
  const q = input.trim().toLowerCase();
  if (!q) {
    const groups = paletteByDomain();
    return { groups, flat: groups.flatMap((g) => g.commands) };
  }
  const flat = TERM_COMMANDS
    .map((c) => ({ c, s: cmdScore(c, q) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.c);
  return { groups: [{ domain: null, commands: flat }], flat };
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
   Меню команд (.cmenu) — встроенный выпадающий список под/над
   строкой ввода. ОДНА реализация на оба режима терминала:
   модальных палитр больше нет, ввод остаётся в основной строке,
   меню лишь фильтруется по ней. Управление — с клавиатуры
   родителя (↑↓ / Tab / Enter / Esc), мышь дублирует.
   ============================================================ */

const DOMAIN_ICON: Record<TermDomain, typeof Sparkles> = {
  'Обзор': LayoutDashboard, 'Аналитика': LineChart, 'Финансы': Wallet,
  'Безопасность': ShieldCheck, 'Задачи': ListChecks, 'Кампус': GraduationCap,
  'Люди': Users, 'Расписание': Calendar,
};

const DOMAIN_META: { id: TermDomain; cmd: string }[] = [
  { id: 'Обзор', cmd: 'обзор' },
  { id: 'Аналитика', cmd: 'аналитика' },
  { id: 'Финансы', cmd: 'финансы' },
  { id: 'Безопасность', cmd: 'безопасность' },
  { id: 'Задачи', cmd: 'задачи' },
  { id: 'Кампус', cmd: 'расписание' },
  { id: 'Люди', cmd: 'сотрудники' },
  { id: 'Расписание', cmd: 'расписание' },
];

export function CmdMenu({ search, sel, onHover, onPick, up }: {
  search: CmdSearch;
  sel: number;
  onHover: (i: number) => void;
  onPick: (c: TermCommand) => void;
  /* true — меню раскрывается вверх (компактный блок на «Главном») */
  up?: boolean;
}) {
  return (
    <div className={'cmenu' + (up ? ' up' : '')} role="listbox" aria-label="Команды терминала">
      <div className="cmenu-list">
        {search.groups.map((g, gi) => {
          const Icon = g.domain ? DOMAIN_ICON[g.domain] : null;
          return (
            <div key={g.domain ?? 'найдено-' + gi}>
              {g.domain && <div className="cmenu-sec">{Icon && <Icon size={13} />}<span>{g.domain}</span></div>}
              {g.commands.map((c) => {
                const idx = search.flat.indexOf(c);
                return (
                  <button
                    type="button"
                    key={c.id}
                    role="option"
                    aria-selected={idx === sel}
                    /* выбранный пункт всегда в видимой области списка */
                    ref={idx === sel ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                    className={'cmenu-item' + (idx === sel ? ' sel' : '') + (c.mutates ? ' mutate' : '')}
                    onMouseEnter={() => onHover(idx)}
                    /* mousedown + preventDefault: фокус не уходит из строки ввода */
                    onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
                  >
                    <code>{c.id}{c.arg ? ' ' + c.arg : ''}</code>
                    <span className="d">{c.desc}</span>
                    {!g.domain && <span className="dom">{c.domain}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
        {search.flat.length === 0 && <div className="cmenu-empty">Ничего не нашлось — Enter отправит строку как есть.</div>}
      </div>
      <div className="cmenu-keys">
        <span><kbd>↑</kbd><kbd>↓</kbd> выбор</span>
        <span><kbd>Tab</kbd> подставить</span>
        <span><kbd>Enter</kbd> выполнить</span>
        <span><kbd>Esc</kbd> закрыть</span>
      </div>
    </div>
  );
}

/* ============================================================
   Полноэкранная среда терминала v2 — «командный центр».
   Модель Raycast: командная строка СВЕРХУ, под ней доменные чипы
   и лента результатов блоками — свежий блок появляется прямо под
   строкой, скроллить к ответу не нужно. Меню команд — встроенное
   (.cmenu), открывается по `/` и фильтруется тем же вводом.
   Esc: сначала закрывает меню, потом среду. Поверх сайта, портал
   в body (у карточек есть backdrop-filter — fixed внутри них
   ведёт себя как absolute).
   ============================================================ */

interface WsBlock { id: number; cmd: string; res?: TermRes; meta?: string; pending?: boolean }

export function TerminalWorkspace({ ctx, remote, onClose }: {
  ctx: EngineCtx;
  /* бэкенд-исполнитель (POST /terminal/exec); undefined = демо-режим */
  remote?: (line: string) => Promise<TermResult>;
  onClose: () => void;
}) {
  const { user } = useApp();
  const [blocks, setBlocks] = useState<WsBlock[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hist, setHist] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState<number | null>(null);
  const [domain, setDomain] = useState<TermDomain>('Обзор');
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const search = useMemo(() => searchCommands(q), [q]);
  /* Пустой ввод — меню только по явному `/`; при наборе — живой список
     совпадений (среда командная, свободного чата тут нет). */
  const menuVisible = q.trim() ? search.flat.length > 0 : menuOpen;

  const runLine = async (line: string) => {
    const cmd = line.trim();
    if (!cmd) return;
    setQ(''); setSel(0); setHIdx(null); setMenuOpen(false);
    setHist((h) => (h[h.length - 1] === cmd ? h : [...h, cmd].slice(-40)));
    if (/^(очистить|clear)$/i.test(cmd)) { setBlocks([]); return; }

    const found = TERM_COMMANDS.find((c) => c.aliases.includes(cmd.split(/\s+/)[0].toLowerCase()));
    if (found) setDomain(found.domain);

    const id = ++seq.current;
    const t0 = performance.now();
    const stamp = (src?: string) =>
      `${new Date().toLocaleTimeString('ru')} · ${Math.max(1, Math.round(performance.now() - t0))} мс${src ? ' · ' + src : ''}`;

    /* свежий блок — В НАЧАЛО ленты, прямо под строкой команд */
    setBlocks((b) => [{ id, cmd, pending: true }, ...b].slice(0, 60));
    const finish = (res: TermRes, meta: string) =>
      setBlocks((b) => b.map((x) => (x.id === id ? { ...x, pending: false, res, meta } : x)));

    /* Бэкенд-режим: известные серверу команды идут на nexd — данные
       настоящие; при ошибке честно показываем её и падаем на демо. */
    if (remote && TERMINAL_BACKEND_TOKENS.has(cmd.split(/\s+/)[0].toLowerCase())) {
      try {
        finish(await remote(cmd), stamp('сервер'));
      } catch {
        const res = execRegistry(cmd, ctx);
        finish(
          res ?? { kind: 'text', text: 'Сервер недоступен, а в демо такой команды нет.' },
          stamp(res ? 'демо · сервер недоступен' : undefined),
        );
      }
      return;
    }

    const res = execRegistry(cmd, ctx);
    finish(res ?? {
      kind: 'text',
      text: 'Не понял команду. Нажмите `/` — откроются все команды, или кликните домен сверху.',
      hint: TERM_COMMANDS.slice(0, 5).map((c) => c.id).join(' · '),
    }, stamp());
  };

  /* Выбор из меню: без аргумента — исполняем сразу, с аргументом —
     подставляем «команда␣» и оставляем курсор в строке. */
  const pick = (c: TermCommand) => {
    setMenuOpen(false); setSel(0);
    if (c.arg) { setQ(c.id + ' '); inputRef.current?.focus(); }
    else runLine(c.id);
  };

  /* Esc глобально: открытое меню закрывается первым, потом — среда. */
  const menuRef = useRef(false);
  menuRef.current = menuVisible;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menuRef.current) { setMenuOpen(false); setQ(''); setSel(0); }
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* автозапуск обзора при первом входе (защёлка от StrictMode) */
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    runLine('обзор'); inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === '/' && !q) { e.preventDefault(); setMenuOpen(true); setSel(0); return; }
    if (menuVisible) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, search.flat.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); return; }
      if (e.key === 'Tab') { e.preventDefault(); const c = search.flat[sel]; if (c) setQ(c.id + (c.arg ? ' ' : '')); return; }
      if (e.key === 'Enter') { e.preventDefault(); const c = search.flat[sel]; if (c) pick(c); else runLine(q); return; }
      return;
    }
    /* меню закрыто: стрелки листают историю команд, как в консоли */
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

  const degraded = services.some((s) => s.status !== 'ok');

  return createPortal(
    <div className="tws" role="dialog" aria-label="Терминал NEX">
      <div className="tws-head">
        <span className="ai-orb sm"><Sparkles size={12} /></span>
        <b>NEX Терминал</b>
        <span className="alpha-badge">альфа</span>
        <span className="tws-pulse"><i className={degraded ? 'warn' : ''} />{degraded ? 'есть деградация' : 'система в норме'}</span>
        <span className="tws-user">{user?.name || ctx.userName} · {ctx.userRole}</span>
        <button className="icon-btn" title="Выйти из терминала (Esc)" onClick={onClose}><X size={17} /></button>
      </div>

      <div className="tws-col">
        <form className="tws-bar" onSubmit={(e) => { e.preventDefault(); runLine(q); }}>
          <div className="tws-bar-line">
            <span className="term-prompt">›</span>
            <input
              ref={inputRef} value={q}
              onChange={(e) => { setQ(e.target.value); setSel(0); setHIdx(null); }}
              onKeyDown={onKeyDown}
              placeholder="Команда: финансы, риск, долги, сессии… — или нажмите /"
            />
            <button type="button" className="tws-slash" title="Все команды (/)"
              onMouseDown={(e) => { e.preventDefault(); setMenuOpen((v) => !v); setSel(0); inputRef.current?.focus(); }}>/</button>
            <button className="console-send" type="submit" aria-label="Выполнить"><CornerDownLeft size={15} /></button>
          </div>
          {menuVisible && <CmdMenu search={search} sel={sel} onHover={setSel} onPick={pick} />}
        </form>

        <div className="tws-domains">
          {DOMAIN_META.map((d) => {
            const Icon = DOMAIN_ICON[d.id];
            return (
              /* mousedown + preventDefault: фокус остаётся в строке команд —
                 `/` и история работают сразу после клика по чипу */
              <button key={d.id} type="button" className={domain === d.id ? 'on' : ''}
                onMouseDown={(e) => { e.preventDefault(); runLine(d.cmd); }}>
                <Icon size={14} /><span>{d.id}</span>
              </button>
            );
          })}
        </div>

        <div className="tws-feed">
          {blocks.map((b) => (
            <section className="tws-block" key={b.id}>
              <div className="tws-block-h">
                <span className="term-prompt">›</span>
                <code>{b.cmd}</code>
                {!b.pending && b.meta && <span className="meta">{b.meta}</span>}
                {!b.pending && (
                  <button type="button" className="tws-rerun" title="Выполнить ещё раз"
                    onMouseDown={(e) => { e.preventDefault(); runLine(b.cmd); }}>
                    <RotateCw size={13} />
                  </button>
                )}
              </div>
              <div className="tws-block-b">
                {b.pending
                  ? <span className="term-busy"><span className="term-cursor" />выполняю…</span>
                  : b.res && <TermResBlock r={b.res} />}
              </div>
            </section>
          ))}
          {blocks.length === 0 && (
            <div className="tws-empty">Нажмите <kbd>/</kbd> — все команды, или начните печатать.</div>
          )}
        </div>

        <div className="tws-foot">
          <span><kbd>/</kbd> все команды</span>
          <span><kbd>Tab</kbd> дополнить</span>
          <span><kbd>↑</kbd><kbd>↓</kbd> история и выбор</span>
          <span><kbd>Enter</kbd> выполнить</span>
          <span><kbd>Esc</kbd> выйти</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
