/* ============================================================
   АГЕНТЫ NEX — модель слоя агентности (прототип перед бэкендом).

   Идея: NEX — не один чат, а штат фоновых агентов по доменам.
   У каждого агента есть УРОВЕНЬ АВТОНОМИИ, который выставляет
   человек; всё, что выше уровня — попадает в очередь на
   подтверждение; всё сделанное — в журнал.

   BACKEND: агенты = воркеры на сервере; уровень автономии —
   политика в БД; очередь/журнал — таблицы + аудит.
   ============================================================ */

/** 0..3 — сколько агенту позволено без человека. */
export const AUTONOMY_LEVELS = [
  { level: 0, name: 'Наблюдает', desc: 'только отчёты, ничего не предлагает' },
  { level: 1, name: 'Советует', desc: 'находит проблемы и предлагает действия' },
  { level: 2, name: 'Готовит', desc: 'готовит действие, ждёт вашего подтверждения' },
  { level: 3, name: 'Автономен', desc: 'делает сам, каждое действие в аудите' },
] as const;
export type Autonomy = 0 | 1 | 2 | 3;

/* ==== GET /agents ==== */
export interface Agent {
  id: string;
  name: string;
  domain: string;
  desc: string;
  autonomy: Autonomy;
  paused: boolean;
  lastAction: string;
  actionsToday: number;
}

export const AGENTS: Agent[] = [
  { id: 'risk', name: 'Куратор-риск', domain: 'Студенты', desc: 'Следит за посещаемостью и баллами, ловит зону риска до задолженности', autonomy: 2, paused: false, lastAction: 'Составил список из 4 студентов в зоне риска', actionsToday: 6 },
  { id: 'fin', name: 'Финконтролёр', domain: 'Финансы', desc: 'Долги, сроки оплат, аномальные платежи', autonomy: 2, paused: false, lastAction: 'Отметил 3 аномальных платежа', actionsToday: 4 },
  { id: 'guard', name: 'Страж', domain: 'Безопасность', desc: 'Входы, сессии, целостность; готовит блокировки', autonomy: 2, paused: false, lastAction: 'Подготовил блокировку IP 45.9.148.3', actionsToday: 9 },
  { id: 'sched', name: 'Диспетчер', domain: 'Расписание', desc: 'Конфликты, свободные окна, переносы', autonomy: 3, paused: false, lastAction: 'Закрыл окно Пн 12:00 переносом «Сетей»', actionsToday: 2 },
  { id: 'adm', name: 'Приёмная', domain: 'Приём', desc: 'Распознаёт документы, ищет дубликаты заявлений', autonomy: 1, paused: false, lastAction: 'Нашёл возможный дубликат заявления', actionsToday: 3 },
  { id: 'docs', name: 'Документовед', domain: 'Документы', desc: 'Черновики приказов, справок и уведомлений по шаблонам', autonomy: 2, paused: false, lastAction: 'Подготовил 2 черновика приказов', actionsToday: 5 },
  { id: 'scout', name: 'Кампус-скаут', domain: 'Кампус', desc: 'Собирает стажировки/гранты, следит за дедлайнами студентов', autonomy: 3, paused: false, lastAction: 'Добавил 2 новые стажировки в ленту', actionsToday: 7 },
];

/* ==== GET /agents/queue — действия, ждущие подтверждения ==== */
export interface PendingAction {
  id: number;
  agentId: string;
  action: string;
  why: string;
  risk: 'low' | 'medium' | 'high';
}
export const QUEUE: PendingAction[] = [
  { id: 1, agentId: 'guard', action: 'Заблокировать IP 45.9.148.3', why: '12 неудачных входов за ночь, паттерн перебора', risk: 'high' },
  { id: 2, agentId: 'fin', action: 'Разослать уведомления 8 должникам', why: 'срок оплаты истекает 30.06', risk: 'medium' },
  { id: 3, agentId: 'docs', action: 'Отправить 2 приказа на подпись', why: 'студенты с незакрытыми задолженностями', risk: 'high' },
  { id: 4, agentId: 'risk', action: 'Назначить встречи кураторам по 4 студентам', why: 'посещаемость ниже 75% две недели подряд', risk: 'low' },
];

/* ==== GET /agents/log — что агенты уже сделали сами ==== */
export interface AgentLogEntry { id: number; agentId: string; text: string; time: string; }
export const AGENT_LOG: AgentLogEntry[] = [
  { id: 1, agentId: 'sched', text: 'Перенёс «Сети» в свободное окно Пн 12:00, ауд. 305', time: '09:40' },
  { id: 2, agentId: 'scout', text: 'Добавил стажировку VK в ленту 12 студентам по подпискам', time: '09:12' },
  { id: 3, agentId: 'fin', text: 'Сверил реестр платежей, расхождений нет', time: '08:30' },
  { id: 4, agentId: 'guard', text: 'Завершил 2 неактивные сессии старше 30 дней', time: '07:02' },
  { id: 5, agentId: 'risk', text: 'Обновил прогноз риска по всем группам (ночной пересчёт)', time: '04:00' },
];

export const agentById = (id: string) => AGENTS.find((a) => a.id === id)!;

/* ==== Автопилот: пресет выставляет уровень всем агентам разом ==== */
export const AUTOPILOT_PRESETS = [
  { id: 'careful', name: 'Осторожный', desc: 'все агенты только советуют', level: 1 as Autonomy },
  { id: 'standard', name: 'Стандартный', desc: 'готовят действия, вы подтверждаете', level: 2 as Autonomy },
  { id: 'bold', name: 'Смелый', desc: 'рутина автономно, риск — на подтверждение', level: 3 as Autonomy },
] as const;

/* ==== GET /agents/rules — автоматизации, описанные словами.
   BACKEND: текст правила парсит LLM → триггер + действие в БД. ==== */
export interface Rule { id: number; text: string; agentId: string; enabled: boolean; }
export const RULES: Rule[] = [
  { id: 1, text: 'Если посещаемость студента ниже 70% две недели — уведомить куратора', agentId: 'risk', enabled: true },
  { id: 2, text: 'Если 5+ неудачных входов с одного IP за час — готовить блокировку', agentId: 'guard', enabled: true },
  { id: 3, text: 'За 3 дня до срока оплаты — напомнить студенту и родителю', agentId: 'fin', enabled: true },
  { id: 4, text: 'Новая стажировка по подпискам студента — сразу в его ленту', agentId: 'scout', enabled: true },
  { id: 5, text: 'Появилось окно в расписании — предложить перенос ближайшей пары', agentId: 'sched', enabled: false },
];

/** Подбор агента под новое правило по ключевым словам.
    BACKEND: классификация LLM. */
export function guessAgent(ruleText: string): string {
  const t = ruleText.toLowerCase();
  if (/вход|ip|сесси|парол/.test(t)) return 'guard';
  if (/оплат|долг|плат|деньг/.test(t)) return 'fin';
  if (/расписан|пар|аудитор|окно/.test(t)) return 'sched';
  if (/заявлен|абитур|приём|прием/.test(t)) return 'adm';
  if (/приказ|справк|документ/.test(t)) return 'docs';
  if (/стажировк|грант|кампус|подписк/.test(t)) return 'scout';
  return 'risk';
}

/** Прогноз последствий действия ДО подтверждения (dry-run).
    BACKEND: симуляция на копии данных / предсказание модели. */
export function dryRun(action: string): string[] {
  const t = action.toLowerCase();
  if (/блокир|ip/.test(t)) return ['IP попадёт в чёрный список на 72 часа', 'Активных сессий с этого IP нет — никого не отключит', 'При ложном срабатывании разблокировка в 1 клик'];
  if (/уведомлени|должник|разосл/.test(t)) return ['8 студентов получат письмо и push', 'Тон — напоминание, не требование', 'Ожидаемый эффект: ~5 оплат до срока (по прошлым рассылкам)'];
  if (/приказ|подпис/.test(t)) return ['2 приказа уйдут на подпись директору', 'Студенты НЕ будут уведомлены до подписания', 'Отзыв возможен до подписи'];
  if (/куратор|встреч/.test(t)) return ['4 кураторам придут задачи со сроком 3 дня', 'В задачу вложена сводка по каждому студенту'];
  return ['Действие обратимо', 'Затронутые записи будут помечены в аудите'];
}
