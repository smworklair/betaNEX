import type { ReactNode } from 'react';
import { BookMarked, FileSpreadsheet, ScrollText, GraduationCap, ClipboardList, Sparkles, NotebookPen } from 'lucide-react';
import { PageHead, NexAsk, Beta } from '../ui';
import { useCollection, type Entity } from '../beta/store';
import { EntityManager, type Col, type FieldDef } from '../beta/manager';
import { groups } from '../data';

const GROUP_NAMES = groups.map((g) => g.name);
const TEACHERS = ['Козлова М.В.', 'Петров А.И.', 'Сидорова Н.П.', 'Фёдорова О.В.'];

interface Discipline extends Entity, Record<string, unknown> { name: string; code: string; hours: number; teacher: string; form: string; }
interface Homework extends Entity, Record<string, unknown> { subject: string; group: string; task: string; due: string; status: string; }
interface Sheet extends Entity, Record<string, unknown> { number: string; group: string; subject: string; type: string; date: string; status: string; }
interface Curriculum extends Entity, Record<string, unknown> { name: string; spec: string; year: number; semesters: number; status: string; }
interface Order extends Entity, Record<string, unknown> { number: string; type: string; subject: string; date: string; status: string; }

const SEED_DISC: Discipline[] = [
  { id: 'd1', name: 'Базы данных', code: 'ОП.08', hours: 144, teacher: 'Козлова М.В.', form: 'Экзамен' },
  { id: 'd2', name: 'Веб-технологии', code: 'ПМ.02', hours: 108, teacher: 'Петров А.И.', form: 'Зачёт' },
  { id: 'd3', name: 'Проектирование ИС', code: 'ПМ.03', hours: 120, teacher: 'Сидорова Н.П.', form: 'Экзамен' },
];
const SEED_HW: Homework[] = [
  { id: 'h1', subject: 'Базы данных', group: 'ПИ-21-1', task: 'Нормализация схемы до 3НФ', due: '2026-07-14', status: 'Задано' },
  { id: 'h2', subject: 'Веб-технологии', group: 'ПИ-21-1', task: 'Свёрстать лендинг', due: '2026-07-12', status: 'Проверка' },
];
const SEED_SHEET: Sheet[] = [
  { id: 's1', number: 'В-114', group: 'ПИ-21-1', subject: 'Базы данных', type: 'Экзаменационная', date: '2026-07-11', status: 'Открыта' },
  { id: 's2', number: 'В-115', group: 'ЭК-22-1', subject: 'Бухучёт', type: 'Зачётная', date: '2026-07-15', status: 'Черновик' },
];
const SEED_CUR: Curriculum[] = [
  { id: 'cu1', name: 'УП Прикладная информатика 2021', spec: 'Прикладная информатика', year: 2021, semesters: 8, status: 'Утверждён' },
  { id: 'cu2', name: 'УП Экономика 2022', spec: 'Экономика и бухучёт', year: 2022, semesters: 6, status: 'Утверждён' },
];
const SEED_ORD: Order[] = [
  { id: 'or1', number: '№ 214-с', type: 'Отчисление', subject: 'Лебедев С.А. — академ. задолженность', date: '2026-07-08', status: 'На рассмотрении' },
  { id: 'or2', number: '№ 215-с', type: 'Перевод', subject: 'Зайцева Т.О. — на бюджет', date: '2026-07-09', status: 'Черновик' },
];

function Screen({ title, sub, icon, children, ask }: { title: string; sub: string; icon: ReactNode; children: ReactNode; ask?: string }) {
  return (
    <div className="fade content-narrow">
      <PageHead title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{icon}{title}</span>} sub={sub} actions={<Beta />} />
      <div className="ai-card" style={{ marginBottom: 14 }}>
        <div className="ai-head"><Sparkles size={14} /> NEX</div>
        <div className="ai-body">Создавайте, изменяйте и удаляйте записи, ищите и выгружайте. Формирование печатных форм и связь с журналом/расписанием — на бэкенде (см. backend.md).</div>
        <div className="ai-actions"><NexAsk q={ask || `Помоги с разделом «${title}»`} label="Разобрать" subtle={false} /></div>
      </div>
      {children}
    </div>
  );
}
const cols = <T,>(...c: Col<T>[]) => c;
const flds = <T,>(...f: FieldDef<T>[]) => f;

export function Disciplines() {
  const col = useCollection<Discipline>('acad-disciplines', SEED_DISC);
  return <Screen title="Дисциплины" sub="Учебные дисциплины, часы и формы контроля" icon={<BookMarked size={18} />}>
    <EntityManager title="Дисциплины" col={col} empty="Дисциплин пока нет"
      columns={cols<Discipline>({ key: 'name', label: 'Дисциплина' }, { key: 'code', label: 'Индекс' }, { key: 'hours', label: 'Часы' }, { key: 'teacher', label: 'Преподаватель' }, { key: 'form', label: 'Контроль', kind: 'chip' })}
      fields={flds<Discipline>({ key: 'name', label: 'Название' }, { key: 'code', label: 'Индекс (ОП/ПМ)' }, { key: 'hours', label: 'Часов', type: 'number' }, { key: 'teacher', label: 'Преподаватель', options: TEACHERS }, { key: 'form', label: 'Форма контроля', options: ['Экзамен', 'Зачёт', 'Дифф. зачёт', 'Курсовая'] })} />
  </Screen>;
}

export function Homeworks() {
  const col = useCollection<Homework>('acad-homework', SEED_HW);
  return <Screen title="Домашние задания" sub="Выдача и проверка заданий по группам" icon={<NotebookPen size={18} />}>
    <EntityManager title="Домашние задания" col={col} empty="Заданий пока нет"
      columns={cols<Homework>({ key: 'subject', label: 'Дисциплина' }, { key: 'group', label: 'Группа' }, { key: 'task', label: 'Задание' }, { key: 'due', label: 'Срок' }, { key: 'status', label: 'Статус', kind: 'status' })}
      fields={flds<Homework>({ key: 'subject', label: 'Дисциплина' }, { key: 'group', label: 'Группа', options: GROUP_NAMES }, { key: 'task', label: 'Задание', type: 'textarea' }, { key: 'due', label: 'Срок сдачи', type: 'date' }, { key: 'status', label: 'Статус', options: ['Задано', 'Проверка', 'Принято'] })} />
  </Screen>;
}

export function GradeSheets() {
  const col = useCollection<Sheet>('acad-sheets', SEED_SHEET);
  return <Screen title="Ведомости" sub="Экзаменационные и зачётные ведомости" icon={<FileSpreadsheet size={18} />}>
    <EntityManager title="Ведомости" col={col} empty="Ведомостей пока нет"
      columns={cols<Sheet>({ key: 'number', label: 'Номер' }, { key: 'group', label: 'Группа' }, { key: 'subject', label: 'Дисциплина' }, { key: 'type', label: 'Тип', kind: 'chip' }, { key: 'date', label: 'Дата' }, { key: 'status', label: 'Статус', kind: 'status' })}
      fields={flds<Sheet>({ key: 'number', label: 'Номер' }, { key: 'group', label: 'Группа', options: GROUP_NAMES }, { key: 'subject', label: 'Дисциплина' }, { key: 'type', label: 'Тип', options: ['Экзаменационная', 'Зачётная', 'Пересдача'] }, { key: 'date', label: 'Дата', type: 'date' }, { key: 'status', label: 'Статус', options: ['Черновик', 'Открыта', 'Закрыта'] })} />
  </Screen>;
}

export function Curricula() {
  const col = useCollection<Curriculum>('acad-curricula', SEED_CUR);
  return <Screen title="Учебные планы" sub="Планы по специальностям и годам набора" icon={<GraduationCap size={18} />}>
    <EntityManager title="Учебные планы" col={col} empty="Планов пока нет"
      columns={cols<Curriculum>({ key: 'name', label: 'План' }, { key: 'spec', label: 'Специальность' }, { key: 'year', label: 'Год' }, { key: 'semesters', label: 'Семестров' }, { key: 'status', label: 'Статус', kind: 'status' })}
      fields={flds<Curriculum>({ key: 'name', label: 'Название' }, { key: 'spec', label: 'Специальность' }, { key: 'year', label: 'Год набора', type: 'number' }, { key: 'semesters', label: 'Семестров', type: 'number' }, { key: 'status', label: 'Статус', options: ['Черновик', 'Утверждён', 'Архив'] })} />
  </Screen>;
}

export function Orders() {
  const col = useCollection<Order>('acad-orders', SEED_ORD);
  return <Screen title="Приказы" sub="Приказы по студенческому составу" icon={<ScrollText size={18} />} ask="Какие приказы ждут подписи и что проверить">
    <EntityManager title="Приказы" col={col} empty="Приказов пока нет"
      columns={cols<Order>({ key: 'number', label: 'Номер' }, { key: 'type', label: 'Тип', kind: 'chip' }, { key: 'subject', label: 'Содержание' }, { key: 'date', label: 'Дата' }, { key: 'status', label: 'Статус', kind: 'status' })}
      fields={flds<Order>({ key: 'number', label: 'Номер' }, { key: 'type', label: 'Тип', options: ['Зачисление', 'Отчисление', 'Перевод', 'Академ. отпуск', 'Восстановление', 'Поощрение'] }, { key: 'subject', label: 'Содержание', type: 'textarea' }, { key: 'date', label: 'Дата', type: 'date' }, { key: 'status', label: 'Статус', options: ['Черновик', 'На рассмотрении', 'Подписан'] })} />
  </Screen>;
}

/* переиспользуем иконку, чтобы не плодить импортов в App */
export const ACAD_ICON = ClipboardList;
