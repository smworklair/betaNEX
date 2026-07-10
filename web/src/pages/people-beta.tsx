import type { ReactNode } from 'react';
import { Building, UserCog, UserCheck, Sparkles } from 'lucide-react';
import { PageHead, NexAsk, Beta } from '../ui';
import { useCollection, type Entity } from '../beta/store';
import { EntityManager, type Col, type FieldDef } from '../beta/manager';
import { groups, staff } from '../data';

const GROUP_NAMES = groups.map((g) => g.name);
const STAFF_NAMES = staff.map((s) => s.name);

interface Dept extends Entity, Record<string, unknown> { name: string; head: string; kind: string; staffCount: number; }
interface Employee extends Entity, Record<string, unknown> { name: string; role: string; dept: string; email: string; phone: string; status: string; }
interface Curator extends Entity, Record<string, unknown> { teacher: string; group: string; since: string; status: string; }

const SEED_DEPT: Dept[] = [
  { id: 'de1', name: 'Кафедра ИТ', head: 'Сидорова Н.П.', kind: 'Кафедра', staffCount: 8 },
  { id: 'de2', name: 'Экономическое отделение', head: 'Фёдорова О.В.', kind: 'Отделение', staffCount: 6 },
  { id: 'de3', name: 'Бухгалтерия', head: 'Григорьев П.С.', kind: 'Служба', staffCount: 3 },
];
const SEED_EMP: Employee[] = staff.map((s, i) => ({
  id: `emp${i + 1}`, name: s.name, role: s.role, dept: s.dept, email: s.email, phone: '+7 921 000-00-0' + i, status: s.status,
}));
const SEED_CUR: Curator[] = [
  { id: 'cr1', teacher: 'Козлова Мария Викторовна', group: 'ПИ-21-1', since: '2021-09-01', status: 'Активен' },
  { id: 'cr2', teacher: 'Петров Андрей Иванович', group: 'ПИ-22-1', since: '2022-09-01', status: 'Активен' },
];

function Screen({ title, sub, icon, children }: { title: string; sub: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="fade content-narrow">
      <PageHead title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{icon}{title}</span>} sub={sub} actions={<Beta />} />
      <div className="ai-card" style={{ marginBottom: 14 }}>
        <div className="ai-head"><Sparkles size={14} /> NEX</div>
        <div className="ai-body">Полный набор операций: создание, изменение, удаление, поиск, экспорт и импорт. Единый профиль человека и связи с расписанием/финансами — на бэкенде (см. backend.md).</div>
        <div className="ai-actions"><NexAsk q={`Проанализируй раздел «${title}»`} label="Разобрать" subtle={false} /></div>
      </div>
      {children}
    </div>
  );
}
const cols = <T,>(...c: Col<T>[]) => c;
const flds = <T,>(...f: FieldDef<T>[]) => f;

export function Departments() {
  const col = useCollection<Dept>('people-depts', SEED_DEPT);
  return <Screen title="Отделения и кафедры" sub="Организационная структура" icon={<Building size={18} />}>
    <EntityManager title="Отделения" col={col} empty="Подразделений пока нет"
      columns={cols<Dept>({ key: 'name', label: 'Название' }, { key: 'kind', label: 'Тип', kind: 'chip' }, { key: 'head', label: 'Руководитель' }, { key: 'staffCount', label: 'Сотрудников' })}
      fields={flds<Dept>({ key: 'name', label: 'Название' }, { key: 'kind', label: 'Тип', options: ['Кафедра', 'Отделение', 'Служба', 'Отдел'] }, { key: 'head', label: 'Руководитель', options: STAFF_NAMES }, { key: 'staffCount', label: 'Сотрудников', type: 'number' })} />
  </Screen>;
}

export function Employees() {
  const col = useCollection<Employee>('people-employees', SEED_EMP);
  return <Screen title="Кадры" sub="Сотрудники, преподаватели, персонал" icon={<UserCog size={18} />}>
    <EntityManager title="Кадры" col={col} empty="Сотрудников пока нет"
      columns={cols<Employee>({ key: 'name', label: 'ФИО' }, { key: 'role', label: 'Должность' }, { key: 'dept', label: 'Подразделение' }, { key: 'email', label: 'Email' }, { key: 'status', label: 'Статус', kind: 'status' })}
      fields={flds<Employee>({ key: 'name', label: 'ФИО' }, { key: 'role', label: 'Должность', options: ['Преподаватель', 'Зав. отделением', 'Бухгалтер', 'Методист', 'Секретарь', 'Администратор'] }, { key: 'dept', label: 'Подразделение' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Телефон' }, { key: 'status', label: 'Статус', options: ['Активен', 'Отпуск', 'Уволен'] })} />
  </Screen>;
}

export function Curators() {
  const col = useCollection<Curator>('people-curators', SEED_CUR);
  return <Screen title="Кураторы" sub="Закрепление преподавателей за группами" icon={<UserCheck size={18} />}>
    <EntityManager title="Кураторы" col={col} empty="Назначений пока нет"
      columns={cols<Curator>({ key: 'teacher', label: 'Преподаватель' }, { key: 'group', label: 'Группа' }, { key: 'since', label: 'С даты' }, { key: 'status', label: 'Статус', kind: 'status' })}
      fields={flds<Curator>({ key: 'teacher', label: 'Преподаватель', options: STAFF_NAMES }, { key: 'group', label: 'Группа', options: GROUP_NAMES }, { key: 'since', label: 'С даты', type: 'date' }, { key: 'status', label: 'Статус', options: ['Активен', 'Завершён'] })} />
  </Screen>;
}
