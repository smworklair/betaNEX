/* ============================================================
   КАМПУС — модель данных + ИИ-слой (прототип перед бэкендом).

   Этот файл = будущий контракт API. Каждый интерфейс — форма
   ответа сервера; каждая функция с пометкой BACKEND: — место,
   где мок заменяется на реальный сервис / LLM-скоринг.
   ============================================================ */

/* ==== GET /campus/interests — теги-интересы для подписок ==== */
export const INTERESTS = [
  'Backend', 'Frontend', 'GameDev', 'AI', 'Data Science', 'Python', 'C#', 'Java',
  'Карьерный центр', 'Студсовет', 'Олимпиады', 'Наука', 'Стипендии', 'Стажировки', 'Обмен', 'Физика', 'Экономика',
] as const;
export type Interest = (typeof INTERESTS)[number];

/* ==== GET /campus/opportunities ==== */
export type OppKind = 'internship' | 'vacancy' | 'course' | 'hackathon' | 'grant' | 'conference' | 'club';
export const OPP_KIND_LABEL: Record<OppKind, string> = {
  internship: 'Стажировка', vacancy: 'Вакансия', course: 'Курс', hackathon: 'Хакатон',
  grant: 'Грант', conference: 'Конференция', club: 'Клуб',
};

export interface Opportunity {
  id: number;
  kind: OppKind;
  title: string;
  org: string;
  desc: string;
  tags: Interest[];
  /** Дней до дедлайна; null — бессрочно */
  deadlineDays: number | null;
  reward?: string;
}

export const OPPORTUNITIES: Opportunity[] = [
  { id: 1, kind: 'internship', title: 'Стажировка Backend', org: 'VK', desc: 'Оплачиваемая, 3 месяца, менторство', tags: ['Backend', 'Java', 'Стажировки'], deadlineDays: 2 },
  { id: 2, kind: 'course', title: 'Яндекс Практикум · Python', org: 'Яндекс', desc: 'Бесплатный трек для студентов', tags: ['Python', 'Backend'], deadlineDays: 12 },
  { id: 3, kind: 'hackathon', title: 'Хакатон по ИИ', org: 'Сбер', desc: 'Команды 3–5 человек, призовой фонд', tags: ['AI', 'Data Science'], deadlineDays: 7, reward: '₽300 000' },
  { id: 4, kind: 'grant', title: 'Грант для студентов IT', org: 'Фонд развития', desc: 'На собственный проект', tags: ['Backend', 'Frontend', 'AI'], deadlineDays: 5, reward: '₽500 000' },
  { id: 5, kind: 'course', title: 'Docker с нуля', org: 'Партнёр-школа', desc: 'Открыт до конца месяца, сертификат', tags: ['Backend'], deadlineDays: 20 },
  { id: 6, kind: 'internship', title: 'Junior Frontend', org: 'Ozon', desc: 'Part-time, совместимо с учёбой', tags: ['Frontend', 'Стажировки'], deadlineDays: 9 },
  { id: 7, kind: 'conference', title: 'Студенческая научная конференция', org: 'Колледж', desc: 'Публикация в сборнике', tags: ['Наука'], deadlineDays: 14 },
  { id: 8, kind: 'club', title: 'Клуб GameDev', org: 'Студсовет', desc: 'Собрания по четвергам', tags: ['GameDev', 'Студсовет'], deadlineDays: null },
  { id: 9, kind: 'vacancy', title: 'Лаборант кафедры ИТ', org: 'Колледж', desc: 'Part-time на кампусе', tags: ['Наука', 'Backend'], deadlineDays: 6 },
];

/* ==== GET /campus/perks — студенческие подписки и льготы ==== */
export interface Perk {
  id: number;
  service: string;
  what: string;
  status: 'active' | 'available';
  tags: Interest[];
}
export const PERKS: Perk[] = [
  { id: 1, service: 'GitHub Student Pack', what: 'Copilot, приватные репо и 100+ инструментов бесплатно', status: 'active', tags: ['Backend', 'Frontend'] },
  { id: 2, service: 'Яндекс Облако', what: 'Грант на облако для учебных проектов', status: 'available', tags: ['Backend', 'AI'] },
  { id: 3, service: 'Яндекс Плюс', what: 'Музыка и Кинопоиск по студенческому тарифу', status: 'active', tags: [] },
  { id: 4, service: 'JetBrains', what: 'Все IDE бесплатно по студенческой лицензии', status: 'active', tags: ['Backend', 'Java', 'Python'] },
  { id: 5, service: 'VK Музыка', what: 'Скидка 50% по студенческому', status: 'available', tags: [] },
  { id: 6, service: 'Figma Education', what: 'Профессиональный план бесплатно', status: 'available', tags: ['Frontend'] },
  { id: 7, service: 'Notion Education', what: 'Личный Pro-план бесплатно', status: 'available', tags: [] },
];

/* ==== GET /campus/lectures ==== */
export interface Lecture { id: number; title: string; subject: string; by: string; dur: string; progress: number; tags: Interest[]; }
export const LECTURES: Lecture[] = [
  { id: 1, title: 'Нормализация БД', subject: 'Базы данных', by: 'Петров А.И.', dur: '48 мин', progress: 62, tags: ['Backend'] },
  { id: 2, title: 'Основы сетей', subject: 'Сети', by: 'Иванова М.С.', dur: '35 мин', progress: 0, tags: ['Backend'] },
  { id: 3, title: 'Алгоритмы сортировки', subject: 'Алгоритмы', by: 'NEX-конспект', dur: '12 мин', progress: 100, tags: ['Python', 'AI'] },
  { id: 4, title: 'Введение в нейросети', subject: 'ИИ', by: 'Козлова М.В.', dur: '52 мин', progress: 15, tags: ['AI', 'Data Science'] },
];

/* ==== GET /campus/calendar ==== */
export interface CampusEvent { id: number; when: string; title: string; kind: 'exam' | 'deadline' | 'event'; }
export const CALENDAR: CampusEvent[] = [
  { id: 1, when: 'Завтра', title: 'Экзамен · Базы данных', kind: 'exam' },
  { id: 2, when: 'Через 2 дня', title: 'Дедлайн: стажировка VK', kind: 'deadline' },
  { id: 3, when: 'Через 5 дней', title: 'Дедлайн: грант IT', kind: 'deadline' },
  { id: 4, when: 'Через неделю', title: 'Хакатон по ИИ', kind: 'event' },
  { id: 5, when: 'Через 2 недели', title: 'Карьерная ярмарка', kind: 'event' },
];

/* ==== GET /campus/progress + /campus/achievements ==== */
export const PROGRESS = { lectures: 14, certificates: 2, applications: 3, events: 5, hours: 96 };
export interface Achievement { id: number; title: string; desc: string; done: boolean; progress: number; }
export const ACHIEVEMENTS: Achievement[] = [
  { id: 1, title: 'Первые 10 лекций', desc: 'Пройдено 10 лекций', done: true, progress: 100 },
  { id: 2, title: 'Первый сертификат', desc: 'Получен сертификат курса', done: true, progress: 100 },
  { id: 3, title: '100 часов обучения', desc: '96 из 100 часов', done: false, progress: 96 },
  { id: 4, title: 'Первая стажировка', desc: 'Подайте заявку и пройдите отбор', done: false, progress: 30 },
  { id: 5, title: 'Первый хакатон', desc: 'Участие в хакатоне', done: false, progress: 0 },
];

/* ==== GET /campus/portfolio — собирается автоматически ==== */
export interface PortfolioItem { kind: string; title: string; source: string; }
export const PORTFOLIO: PortfolioItem[] = [
  { kind: 'Сертификат', title: 'Python для анализа данных', source: 'из «Курсы»' },
  { kind: 'Курсовая', title: 'Проектирование БД колледжа', source: 'из «Журнал»' },
  { kind: 'Достижение', title: 'Победитель олимпиады по программированию', source: 'из «Достижения»' },
  { kind: 'Практика', title: 'Учебная практика, 2 семестр', source: 'из «Журнал»' },
];

/* ============================================================
   ИИ-слой кампуса. Всё детерминированный мок.
   BACKEND: каждую функцию заменит вызов сервера (LLM-скоринг
   по эмбеддингам профиля студента + активности).
   ============================================================ */

/** Совпадение возможности с подписками: 0..100.
    BACKEND: заменить на скоринг моделью (профиль+история). */
export function matchScore(opp: Opportunity, interests: Interest[]): number {
  if (interests.length === 0) return 50;
  const hit = opp.tags.filter((t) => interests.includes(t)).length;
  if (hit === 0) return 25;
  return Math.min(97, 55 + hit * 18 + (opp.deadlineDays !== null && opp.deadlineDays <= 7 ? 6 : 0));
}

/** Человекочитаемое «почему это вам» — объяснимость рекомендации.
    BACKEND: генерирует LLM по факторам скоринга. */
export function whyRecommended(opp: Opportunity, interests: Interest[]): string {
  const hits = opp.tags.filter((t) => interests.includes(t));
  if (hits.length > 0) return `по вашим подпискам: ${hits.join(', ')}`;
  return 'популярно у студентов вашего направления';
}

/** Срочность дедлайна для «радара» NEX. */
export function urgency(days: number | null): 'critical' | 'soon' | 'ok' {
  if (days === null) return 'ok';
  return days <= 3 ? 'critical' : days <= 8 ? 'soon' : 'ok';
}

/** Лента «Для вас»: ранжирование по match + срочности.
    BACKEND: персональная выдача рекомендательного сервиса. */
export function forYou(interests: Interest[]): Opportunity[] {
  return [...OPPORTUNITIES].sort((a, b) => {
    const ub = (o: Opportunity) => (urgency(o.deadlineDays) === 'critical' ? 20 : 0);
    return matchScore(b, interests) + ub(b) - (matchScore(a, interests) + ub(a));
  });
}

/** Лекция, которую NEX советует продолжить (начата и не закончена). */
export function continueLecture(): Lecture | null {
  return LECTURES.filter((l) => l.progress > 0 && l.progress < 100).sort((a, b) => b.progress - a.progress)[0] || null;
}
