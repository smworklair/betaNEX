// NEX prototype data. In production this comes from the backend (kernel + modules);
// here it is local seed + mock telemetry that mirrors the future API shapes.

export type Role = 'admin' | 'teacher' | 'accountant' | 'student';

export const roleLabel: Record<Role, string> = {
  admin: 'Администратор',
  teacher: 'Преподаватель',
  accountant: 'Бухгалтер',
  student: 'Студент',
};

export interface Group { id: number; name: string; spec: string; course: number; curator: string; year: number; students: number; }
export interface Student {
  id: number; lastname: string; firstname: string; patronymic: string;
  dob: string; group: string; form: string; finance: string;
  phone: string; email: string; status: string;
}
export interface StaffMember { id: number; name: string; role: string; dept: string; load: number; email: string; status: string; }

export const groups: Group[] = [
  { id: 1, name: 'ПИ-21-1', spec: 'Прикладная информатика', course: 3, curator: 'Козлова М.В.', year: 2021, students: 24 },
  { id: 2, name: 'ПИ-22-1', spec: 'Прикладная информатика', course: 2, curator: 'Петров А.И.', year: 2022, students: 26 },
  { id: 3, name: 'ИС-21-1', spec: 'Информационные системы', course: 3, curator: 'Сидорова Н.П.', year: 2021, students: 22 },
  { id: 4, name: 'ЭК-22-1', spec: 'Экономика и бухучёт', course: 2, curator: 'Фёдорова О.В.', year: 2022, students: 28 },
];

export const students: Student[] = [
  { id: 1, lastname: 'Иванов', firstname: 'Алексей', patronymic: 'Сергеевич', dob: '2003-05-12', group: 'ПИ-21-1', form: 'Очная', finance: 'Бюджет', phone: '+7 921 111-22-33', email: 'ivanov@stud.ru', status: 'Обучается' },
  { id: 2, lastname: 'Петрова', firstname: 'Мария', patronymic: 'Александровна', dob: '2003-09-28', group: 'ПИ-21-1', form: 'Очная', finance: 'Бюджет', phone: '+7 921 222-33-44', email: 'petrova@stud.ru', status: 'Обучается' },
  { id: 3, lastname: 'Сидоров', firstname: 'Дмитрий', patronymic: 'Николаевич', dob: '2004-01-15', group: 'ПИ-21-1', form: 'Очная', finance: 'Контракт', phone: '+7 921 333-44-55', email: 'sidorov@stud.ru', status: 'Обучается' },
  { id: 4, lastname: 'Козлова', firstname: 'Анна', patronymic: 'Петровна', dob: '2003-07-22', group: 'ПИ-21-1', form: 'Очная', finance: 'Бюджет', phone: '+7 921 444-55-66', email: 'kozlova@stud.ru', status: 'Обучается' },
  { id: 5, lastname: 'Новиков', firstname: 'Игорь', patronymic: 'Витальевич', dob: '2003-11-03', group: 'ПИ-22-1', form: 'Очная', finance: 'Бюджет', phone: '+7 921 555-66-77', email: 'novikov@stud.ru', status: 'Обучается' },
  { id: 6, lastname: 'Соколова', firstname: 'Елена', patronymic: 'Михайловна', dob: '2004-03-18', group: 'ПИ-22-1', form: 'Очная', finance: 'Контракт', phone: '+7 921 666-77-88', email: 'sokolova@stud.ru', status: 'Обучается' },
  { id: 7, lastname: 'Морозов', firstname: 'Антон', patronymic: 'Дмитриевич', dob: '2004-06-30', group: 'ПИ-22-1', form: 'Очная', finance: 'Бюджет', phone: '+7 921 777-88-99', email: 'morozov@stud.ru', status: 'Обучается' },
  { id: 8, lastname: 'Волкова', firstname: 'Ольга', patronymic: 'Ивановна', dob: '2003-08-14', group: 'ИС-21-1', form: 'Очная', finance: 'Бюджет', phone: '+7 921 888-99-00', email: 'volkova@stud.ru', status: 'Обучается' },
  { id: 9, lastname: 'Лебедев', firstname: 'Сергей', patronymic: 'Анатольевич', dob: '2003-12-05', group: 'ИС-21-1', form: 'Очная', finance: 'Контракт', phone: '+7 921 999-00-11', email: 'lebedev@stud.ru', status: 'Академический отпуск' },
  { id: 10, lastname: 'Зайцева', firstname: 'Татьяна', patronymic: 'Олеговна', dob: '2004-04-11', group: 'ЭК-22-1', form: 'Заочная', finance: 'Контракт', phone: '+7 921 100-200-300', email: 'zaitseva@stud.ru', status: 'Обучается' },
  { id: 11, lastname: 'Смирнов', firstname: 'Павел', patronymic: 'Романович', dob: '2004-07-08', group: 'ЭК-22-1', form: 'Очная', finance: 'Бюджет', phone: '+7 921 200-300-400', email: 'smirnov@stud.ru', status: 'Обучается' },
  { id: 12, lastname: 'Попова', firstname: 'Виктория', patronymic: 'Алексеевна', dob: '2003-10-25', group: 'ПИ-21-1', form: 'Очная', finance: 'Бюджет', phone: '+7 921 300-400-500', email: 'popova@stud.ru', status: 'Обучается' },
];

export const subjectsByGroup: Record<string, string[]> = {
  'ПИ-21-1': ['Базы данных', 'Веб-технологии', 'Операционные системы', 'Математика', 'Алгоритмы'],
  'ПИ-22-1': ['Программирование', 'Информатика', 'Математика', 'Физика', 'Английский'],
  'ИС-21-1': ['Системный анализ', 'Проектирование ИС', 'СУБД', 'Сети', 'Безопасность'],
  'ЭК-22-1': ['Бухучёт', 'Экономика', 'Математика', 'Налоги', 'Менеджмент'],
};

// Deterministic pseudo-grades so the journal is stable between renders.
export function gradesFor(groupName: string): Record<number, number[]> {
  const list = students.filter((s) => s.group === groupName);
  const cols = 6;
  const out: Record<number, number[]> = {};
  for (const s of list) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      const seed = (s.id * 31 + c * 17) % 10;
      row.push(seed < 1 ? 0 : seed < 3 ? 3 : seed < 8 ? 4 : 5); // 0 = пропуск
    }
    out[s.id] = row;
  }
  return out;
}

export const staff: StaffMember[] = [
  { id: 1, name: 'Козлова Мария Викторовна', role: 'Преподаватель', dept: 'Кафедра ИТ', load: 720, email: 'kozlova@nex.ru', status: 'Активен' },
  { id: 2, name: 'Петров Андрей Иванович', role: 'Преподаватель', dept: 'Кафедра ИТ', load: 680, email: 'petrov@nex.ru', status: 'Активен' },
  { id: 3, name: 'Сидорова Нина Павловна', role: 'Зав. отделением', dept: 'Информ. системы', load: 540, email: 'sidorova@nex.ru', status: 'Активен' },
  { id: 4, name: 'Фёдорова Ольга Викторовна', role: 'Преподаватель', dept: 'Экономика', load: 700, email: 'fedorova@nex.ru', status: 'Отпуск' },
  { id: 5, name: 'Григорьев Пётр Сергеевич', role: 'Бухгалтер', dept: 'Бухгалтерия', load: 0, email: 'grigoriev@nex.ru', status: 'Активен' },
];

// ---------- Security / operations telemetry (mirrors future audit + sessions API) ----------
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type ActorType = 'human' | 'ai';

export interface SessionInfo { id: string; name: string; role: Role; device: string; location: string; ip: string; active: string; current?: boolean; anomaly?: string; }
export interface AuditEvent { id: string; actor: string; actorType: ActorType; action: string; target: string; severity: Severity; time: string; }
export interface FailedLogin { id: string; name: string; ip: string; location: string; time: string; attempts: number; flagged?: boolean; }
export interface AppNotification { id: string; title: string; desc: string; severity: Severity; time: string; }
export interface AiInsight { id: string; title: string; desc: string; confidence: number; page: string; }
export interface ServiceHealth { name: string; status: 'ok' | 'degraded' | 'down'; value: string; }

export const sessions: SessionInfo[] = [
  { id: 's1', name: 'Вы (текущая)', role: 'admin', device: 'Chrome · Windows', location: 'Санкт-Петербург', ip: '95.30.11.4', active: 'сейчас', current: true },
  { id: 's2', name: 'Козлова М.В.', role: 'teacher', device: 'Safari · macOS', location: 'Санкт-Петербург', ip: '95.30.11.78', active: '3 мин назад' },
  { id: 's3', name: 'Григорьев П.С.', role: 'accountant', device: 'Chrome · Windows', location: 'Москва', ip: '178.140.2.9', active: '12 мин назад' },
  { id: 's4', name: 'Сидорова Н.П.', role: 'teacher', device: 'Firefox · Linux', location: 'Казань', ip: '188.43.7.221', active: '40 мин назад', anomaly: 'Новый регион входа' },
];

export const auditEvents: AuditEvent[] = [
  { id: 'a1', actor: 'NEX AI', actorType: 'ai', action: 'Отметил 3 платежа как аномальные', target: 'Финансы', severity: 'medium', time: '2 мин назад' },
  { id: 'a2', actor: 'Григорьев П.С.', actorType: 'human', action: 'Экспорт реестра платежей', target: 'Финансы / Платежи', severity: 'high', time: '14 мин назад' },
  { id: 'a3', actor: 'Вы', actorType: 'human', action: 'Изменена роль пользователя', target: 'Петров А.И. → Зав. кафедрой', severity: 'critical', time: '1 ч назад' },
  { id: 'a4', actor: 'NEX AI', actorType: 'ai', action: 'Предотвращён конфликт в расписании', target: 'Расписание / ауд. 305', severity: 'low', time: '1 ч назад' },
  { id: 'a5', actor: 'Козлова М.В.', actorType: 'human', action: 'Выставлены оценки', target: 'Журнал / ПИ-21-1', severity: 'low', time: '2 ч назад' },
  { id: 'a6', actor: 'Сидорова Н.П.', actorType: 'human', action: 'Вход в систему', target: 'Сессия · Казань', severity: 'medium', time: '40 мин назад' },
];

export const criticalActions: AuditEvent[] = auditEvents.filter((e) => e.severity === 'critical' || e.severity === 'high');

export const failedLogins: FailedLogin[] = [
  { id: 'f1', name: 'admin', ip: '193.41.22.7', location: 'Неизвестно (VPN)', time: '08:42', attempts: 7, flagged: true },
  { id: 'f2', name: 'g.petrov', ip: '95.30.11.78', location: 'Санкт-Петербург', time: '09:15', attempts: 2 },
  { id: 'f3', name: 'root', ip: '45.9.148.3', location: 'Нидерланды', time: '03:20', attempts: 12, flagged: true },
];

export const failedLoginTrend = [1, 0, 2, 0, 5, 12, 3, 1, 2, 7, 4, 2];

export const notifications: AppNotification[] = [
  { id: 'n1', title: 'Подозрительная активность входа', desc: '12 неудачных попыток с IP 45.9.148.3', severity: 'critical', time: '3 ч назад' },
  { id: 'n2', title: 'Срок оплаты истекает', desc: '8 студентов на контракте — оплата до 30.06', severity: 'high', time: '5 ч назад' },
  { id: 'n3', title: 'Резервное копирование выполнено', desc: 'Снимок БД создан успешно', severity: 'low', time: 'сегодня, 04:00' },
  { id: 'n4', title: 'Ожидает подтверждения', desc: '2 приказа об отчислении готовы к подписи', severity: 'medium', time: 'вчера' },
];

export const aiInsights: AiInsight[] = [
  { id: 'i1', title: '3 студента в зоне риска', desc: 'Снижение посещаемости и успеваемости в ПИ-21-1 за 2 недели.', confidence: 0.92, page: 'students' },
  { id: 'i2', title: 'Аномалия в платежах', desc: 'Три перевода на нетипичную сумму от одного контрагента.', confidence: 0.81, page: 'fin-overview' },
  { id: 'i3', title: 'Окно в расписании', desc: 'Ауд. 305 свободна Пн 12:00 — можно перенести «Сети».', confidence: 0.74, page: 'schedule' },
];

export const services: ServiceHealth[] = [
  { name: 'Ядро NEX (API)', status: 'ok', value: '99.98%' },
  { name: 'База данных', status: 'ok', value: 'отклик 4 мс' },
  { name: 'Журнал аудита', status: 'ok', value: 'целостен' },
  { name: 'AI-мониторинг', status: 'ok', value: 'активен' },
  { name: 'Резервные копии', status: 'ok', value: '4 ч назад' },
  { name: 'Шлюз входа (2FA)', status: 'degraded', value: 'задержка SMS' },
];

export const finance = {
  payments: [
    { id: 'p1', student: 'Зайцева Т.О.', group: 'ЭК-22-1', sum: 62000, date: '2024-06-15', method: 'Карта', status: 'Оплачено' },
    { id: 'p2', student: 'Сидоров Д.Н.', group: 'ПИ-21-1', sum: 62000, date: '2024-06-12', method: 'Счёт', status: 'Оплачено' },
    { id: 'p3', student: 'Лебедев С.А.', group: 'ИС-21-1', sum: 62000, date: '—', method: '—', status: 'Просрочено' },
    { id: 'p4', student: 'Соколова Е.М.', group: 'ПИ-22-1', sum: 31000, date: '2024-06-18', method: 'Карта', status: 'Частично' },
  ],
  scholarships: [
    { id: 'sc1', student: 'Иванов А.С.', group: 'ПИ-21-1', type: 'Академическая', sum: 4200, basis: 'Средний балл 4.8' },
    { id: 'sc2', student: 'Петрова М.А.', group: 'ПИ-21-1', type: 'Повышенная', sum: 8600, basis: 'Отличная учёба + НИР' },
    { id: 'sc3', student: 'Козлова А.П.', group: 'ПИ-21-1', type: 'Социальная', sum: 5100, basis: 'Подтверждающие документы' },
  ],
};

export const admissions = [
  { id: 'ap1', name: 'Орлов Кирилл Дмитриевич', spec: 'Прикладная информатика', score: 246, status: 'На рассмотрении', flag: 'Возможный дубликат' },
  { id: 'ap2', name: 'Васильева Дарья Игоревна', spec: 'Информационные системы', score: 271, status: 'Рекомендован', flag: '' },
  { id: 'ap3', name: 'Кузнецов Артём Павлович', spec: 'Экономика и бухучёт', score: 198, status: 'Документы неполные', flag: 'Не хватает аттестата' },
];

export const scheduleDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];
export const scheduleSlots = [
  { time: '08:30', mon: 'Базы данных · 305', tue: 'Алгоритмы · 210', wed: 'Математика · 114', thu: 'Веб · 305', fri: 'ОС · 207' },
  { time: '10:15', mon: 'Веб-технологии · 305', tue: 'Базы данных · 305', wed: 'Алгоритмы · 210', thu: 'Математика · 114', fri: 'Базы данных · 305' },
  { time: '12:00', mon: '— окно —', tue: 'ОС · 207', wed: 'Веб · 305', thu: 'Алгоритмы · 210', fri: 'Математика · 114' },
  { time: '13:45', mon: 'Математика · 114', tue: 'Веб · 305', wed: 'Базы данных · 305', thu: 'ОС · 207', fri: 'Алгоритмы · 210' },
];

/* ======================= Расширение: бухгалтерия ======================= */
export interface Charge { id: string; student: string; group: string; kind: string; sum: number; due: string; paid: boolean; }
export const charges: Charge[] = [
  { id: 'c1', student: 'Лебедев С.А.', group: 'ИС-21-1', kind: 'Обучение · 2 семестр', sum: 62000, due: '30 июн', paid: false },
  { id: 'c2', student: 'Смирнов П.Р.', group: 'ЭК-22-1', kind: 'Обучение · 2 семестр', sum: 62000, due: '30 июн', paid: false },
  { id: 'c3', student: 'Козлова А.П.', group: 'ПИ-21-1', kind: 'Общежитие · июнь', sum: 4500, due: '25 июн', paid: false },
  { id: 'c4', student: 'Зайцева Т.О.', group: 'ЭК-22-1', kind: 'Обучение · 2 семестр', sum: 62000, due: '15 июн', paid: true },
  { id: 'c5', student: 'Волкова О.И.', group: 'ИС-21-1', kind: 'Пересдача', sum: 1200, due: '20 июн', paid: false },
];

export interface Payroll { id: string; name: string; role: string; base: number; bonus: number; }
export const payroll: Payroll[] = [
  { id: 'w1', name: 'Козлова Мария В.', role: 'Преподаватель', base: 68000, bonus: 12000 },
  { id: 'w2', name: 'Петров Андрей И.', role: 'Преподаватель', base: 66000, bonus: 8000 },
  { id: 'w3', name: 'Сидорова Нина П.', role: 'Зав. отделением', base: 82000, bonus: 15000 },
  { id: 'w4', name: 'Фёдорова Ольга В.', role: 'Преподаватель', base: 64000, bonus: 0 },
  { id: 'w5', name: 'Григорьев Пётр С.', role: 'Бухгалтер', base: 58000, bonus: 6000 },
];

export const budgetLines = [
  { name: 'Зарплаты', plan: 620000, fact: 548000 },
  { name: 'Стипендии', plan: 180000, fact: 172000 },
  { name: 'Содержание здания', plan: 240000, fact: 261000 },
  { name: 'Оборудование', plan: 150000, fact: 92000 },
  { name: 'Прочее', plan: 90000, fact: 74000 },
];

export const reports = [
  { id: 'r1', name: 'Оборотно-сальдовая ведомость', period: 'Июнь 2024', ready: true },
  { id: 'r2', name: 'Реестр платежей', period: 'Июнь 2024', ready: true },
  { id: 'r3', name: 'Задолженность по договорам', period: 'на 30.06', ready: true },
  { id: 'r4', name: 'Начисление стипендий', period: 'Июнь 2024', ready: true },
  { id: 'r5', name: 'Отчёт для налоговой (УСН)', period: '2 квартал', ready: false },
];

/* ======================= Расширение: лента ======================= */
export interface Task { id: string; title: string; due: string; done: boolean; who: string; }
export const tasks: Task[] = [
  { id: 't1', title: 'Подписать 2 приказа об отчислении', due: 'сегодня', done: false, who: 'вы' },
  { id: 't2', title: 'Утвердить расписание сессии', due: 'до 8 июля', done: false, who: 'вы' },
  { id: 't3', title: 'Проверить аномальные платежи', due: 'сегодня', done: false, who: 'бухгалтерия' },
  { id: 't4', title: 'Ответить на 3 заявления в приёмную', due: 'до 6 июля', done: false, who: 'секретарь' },
  { id: 't5', title: 'Отправить напоминания должникам', due: 'вчера', done: true, who: 'NEX' },
];

export const nexLog = [
  { id: 'l1', text: 'Приостановил подозрительный адрес после 12 неудачных входов.', time: 'сегодня, 03:20' },
  { id: 'l2', text: 'Отправил вежливые напоминания 6 должникам.', time: 'вчера, 18:00' },
  { id: 'l3', text: 'Нашёл свободное окно в расписании и предложил перенос.', time: 'вчера, 12:10' },
  { id: 'l4', text: 'Пометил 3 платежа как аномальные для проверки.', time: 'вчера, 09:40' },
  { id: 'l5', text: 'Собрал 2 приказа и проверил данные студентов.', time: 'позавчера' },
];

export interface CalEvent { day: number; title: string; kind: 'meet' | 'exam' | 'deadline'; }
export const calEvents: CalEvent[] = [
  { day: 5, title: 'Педсовет 15:00', kind: 'meet' },
  { day: 8, title: 'Утвердить сессию', kind: 'deadline' },
  { day: 11, title: 'Экзамен · Базы данных', kind: 'exam' },
  { day: 14, title: 'Экзамен · Математика', kind: 'exam' },
  { day: 18, title: 'Совет по стипендиям', kind: 'meet' },
  { day: 30, title: 'Срок оплаты договоров', kind: 'deadline' },
];

export interface ExamRow { group: string; subject: string; date: string; room: string; ready: number; total: number; }
export const exams: ExamRow[] = [
  { group: 'ПИ-21-1', subject: 'Базы данных', date: '11 июл', room: '305', ready: 20, total: 24 },
  { group: 'ПИ-21-1', subject: 'Математика', date: '14 июл', room: '114', ready: 18, total: 24 },
  { group: 'ИС-21-1', subject: 'Проектирование ИС', date: '12 июл', room: '210', ready: 19, total: 22 },
  { group: 'ЭК-22-1', subject: 'Бухучёт', date: '15 июл', room: '118', ready: 25, total: 28 },
];

/* ======================= Расширение: соцлента, сообщения ======================= */
export type PostKind = 'official' | 'teacher' | 'club' | 'service';
export interface Post { id: string; author: string; role: string; kind: PostKind; time: string; text: string; likes: number; comments: number; pinned?: boolean; }
export const posts: Post[] = [
  { id: 'ps1', author: 'Администрация', role: 'Официально', kind: 'official', time: '2 ч назад', pinned: true, likes: 42, comments: 8,
    text: 'Расписание летней сессии опубликовано. Проверьте свои группы и сообщите о конфликтах до 8 июля.' },
  { id: 'ps2', author: 'Козлова М.В.', role: 'Преподаватель', kind: 'teacher', time: '4 ч назад', likes: 17, comments: 3,
    text: 'Консультация по базам данных перенесена на понедельник 12:00, ауд. 305. Приходите с вопросами по курсовым.' },
  { id: 'ps3', author: 'Студсовет', role: 'Сообщество', kind: 'club', time: 'вчера', likes: 65, comments: 21,
    text: 'В пятницу турнир по киберспорту в актовом зале. Регистрация команд открыта — 12 мест осталось.' },
  { id: 'ps4', author: 'Библиотека', role: 'Сервис', kind: 'service', time: 'вчера', likes: 9, comments: 1,
    text: 'Новые поступления: 40 книг по программированию и экономике. Электронный доступ уже активен.' },
];
export interface Comment { author: string; text: string; time: string; }
export const postComments: Record<string, Comment[]> = {
  ps1: [
    { author: 'Иванов А.', text: 'А для заочников тоже до 8 июля?', time: '1 ч назад' },
    { author: 'Администрация', text: 'Да, срок общий для всех форм обучения.', time: '45 мин назад' },
  ],
  ps3: [{ author: 'Петрова М.', text: 'Записали команду от ПИ-21-1!', time: '20 ч назад' }],
};

export interface Chat { id: string; name: string; role: string; last: string; time: string; unread: number; kind: 'person' | 'group'; }
export const chats: Chat[] = [
  { id: 'ch1', name: 'Козлова М.В.', role: 'Преподаватель', last: 'Хорошо, тогда до понедельника', time: '10:24', unread: 2, kind: 'person' },
  { id: 'ch2', name: 'Григорьев П.С.', role: 'Бухгалтер', last: 'Отчёт по платежам готов', time: '09:15', unread: 0, kind: 'person' },
  { id: 'ch3', name: 'Кафедра ИТ', role: '6 участников', last: 'Петров: согласен по нагрузке', time: 'вчера', unread: 5, kind: 'group' },
  { id: 'ch4', name: 'Сидорова Н.П.', role: 'Зав. отделением', last: 'Спасибо за информацию', time: 'вчера', unread: 0, kind: 'person' },
];
export interface Msg { me?: boolean; text: string; time: string; }
export const thread: Msg[] = [
  { text: 'Добрый день! Подскажите, консультация в понедельник будет?', time: '10:18' },
  { me: true, text: 'Да, в 12:00, аудитория 305. Перенёс из-за экзамена в четверг.', time: '10:20' },
  { text: 'Отлично, предупрежу группу.', time: '10:22' },
  { text: 'Хорошо, тогда до понедельника', time: '10:24' },
];

/* Отдельная переписка для каждого чата — чтобы мессенджер был живым */
export const threads: Record<string, Msg[]> = {
  ch1: thread,
  ch2: [
    { text: 'Отчёт по платежам за июнь готов, отправил на почту.', time: '09:05' },
    { me: true, text: 'Спасибо! Задолженности свёл?', time: '09:10' },
    { text: 'Да, 8 студентов, список внутри. По двоим уже договорились о рассрочке.', time: '09:14' },
    { me: true, text: 'Отлично, тогда на планёрке обсудим.', time: '09:15' },
  ],
  ch3: [
    { text: 'Коллеги, распределение нагрузки на осень во вложении.', time: 'вчера' },
    { text: 'Петров: согласен по нагрузке, вопросов нет.', time: 'вчера' },
    { me: true, text: 'Принято. Утверждаю до пятницы.', time: 'вчера' },
  ],
  ch4: [
    { text: 'Направила данные по успеваемости ПИ-21-1.', time: 'вчера' },
    { me: true, text: 'Получил, спасибо за информацию.', time: 'вчера' },
  ],
};

/* ======================= Почта (полноценный почтовый клиент) ======================= */
export type MailFolder = 'inbox' | 'sent' | 'drafts' | 'archive';
export interface Email {
  id: string; folder: MailFolder; from: string; fromRole: string; to: string;
  subject: string; preview: string; body: string; time: string; date: string;
  unread?: boolean; starred?: boolean; attachments?: string[];
}
export const emails: Email[] = [
  { id: 'em1', folder: 'inbox', from: 'Ректорат', fromRole: 'rector@college.ru', to: 'Вы',
    subject: 'Итоги приёмной кампании — совещание в четверг', time: '11:42', date: 'Сегодня', unread: true, starred: true,
    preview: 'Прошу подготовить сводку по вашему направлению к 14:00 четверга…',
    body: 'Уважаемые коллеги!\n\nПо итогам приёмной кампании назначено совещание в четверг в 14:00, кабинет 210. Прошу подготовить сводку по вашему направлению: план/факт зачисления, средний балл и остаток бюджетных мест.\n\nС уважением,\nРекторат',
    attachments: ['Повестка_совещания.pdf'] },
  { id: 'em2', folder: 'inbox', from: 'Бухгалтерия', fromRole: 'buh@college.ru', to: 'Вы',
    subject: 'Отчёт по стипендиям за июнь', time: '10:05', date: 'Сегодня', unread: true,
    preview: 'Во вложении — ведомость начислений и список к пересмотру…',
    body: 'Добрый день!\n\nНаправляю ведомость по стипендиям за июнь. Обратите внимание на список студентов к пересмотру по успеваемости — 5 человек. Прошу согласовать до конца недели.',
    attachments: ['Стипендии_июнь.xlsx'] },
  { id: 'em3', folder: 'inbox', from: 'Козлова М.В.', fromRole: 'kozlova@college.ru', to: 'Вы',
    subject: 'Перенос консультации по базам данных', time: 'Вчера', date: 'Вчера',
    preview: 'Прошу согласовать перенос консультации на понедельник 12:00…',
    body: 'Здравствуйте!\n\nВ связи с экзаменом в четверг прошу согласовать перенос консультации по базам данных на понедельник, 12:00, аудитория 305. Группу предупрежу отдельно.\n\nС уважением, Козлова М.В.' },
  { id: 'em4', folder: 'inbox', from: 'IT-отдел', fromRole: 'it@college.ru', to: 'Вы',
    subject: 'Плановое обновление системы 8 июля', time: 'Вчера', date: 'Вчера',
    preview: 'В ночь на 8 июля сервисы будут недоступны с 02:00 до 04:00…',
    body: 'Уведомляем о плановых технических работах в ночь на 8 июля с 02:00 до 04:00. В это время личный кабинет и журнал будут недоступны. Приносим извинения за неудобства.' },
  { id: 'em5', folder: 'sent', from: 'Вы', fromRole: 'you@college.ru', to: 'Ректорат',
    subject: 'Re: Итоги приёмной кампании', time: '11:55', date: 'Сегодня',
    preview: 'Сводку по направлению подготовлю к среде, приложу диаграммы…',
    body: 'Здравствуйте!\n\nСводку по направлению подготовлю к среде, приложу диаграммы по динамике зачисления. Остаток бюджетных мест — 6.\n\nС уважением' },
  { id: 'em6', folder: 'sent', from: 'Вы', fromRole: 'you@college.ru', to: 'Григорьев П.С.',
    subject: 'Задолженности — рассрочка', time: 'Вчера', date: 'Вчера',
    preview: 'По двум студентам оформляем рассрочку, приложите шаблон…',
    body: 'Пётр Сергеевич, по двум студентам оформляем рассрочку. Пришлите, пожалуйста, шаблон соглашения.' },
  { id: 'em7', folder: 'drafts', from: 'Вы', fromRole: 'you@college.ru', to: 'Кафедра ИТ',
    subject: 'Нагрузка на осенний семестр', time: 'Вчера', date: 'Вчера',
    preview: '(черновик) Коллеги, во вложении проект распределения…',
    body: 'Коллеги, во вложении проект распределения нагрузки на осень. Прошу посмотреть и прислать замечания до пятницы.' },
];
export const MAIL_FOLDERS: { id: MailFolder; label: string }[] = [
  { id: 'inbox', label: 'Входящие' },
  { id: 'sent', label: 'Отправленные' },
  { id: 'drafts', label: 'Черновики' },
  { id: 'archive', label: 'Архив' },
];
