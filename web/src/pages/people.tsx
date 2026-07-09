import { useState, useMemo, useEffect } from 'react';
import { Search, Plus, Users } from 'lucide-react';
import { PageHead, Chip, Avatar, AiInsightCard, NexAsk, Soon, useApp } from '../ui';
import { students, groups, staff, type Student, type Group } from '../data';
import { campusApi } from '../api';

const statusTone = (s: string) => (s === 'Обучается' || s === 'Активен' ? 'chip-success' : s === 'Академический отпуск' || s === 'Отпуск' ? 'chip-warn' : 'chip-neutral');

export function Students() {
  const { openStudent, setPage, toast } = useApp();
  const [q, setQ] = useState('');
  // Студенты из бэкенда (/api/v1/campus/students) с автофолбэком на моки.
  const [all, setAll] = useState<Student[]>(students);
  useEffect(() => {
    let live = true;
    campusApi.listStudents().then((s) => { if (live) setAll(s); });
    return () => { live = false; };
  }, []);
  const list = useMemo(
    () => all.filter((s) => `${s.lastname} ${s.firstname} ${s.group}`.toLowerCase().includes(q.toLowerCase())),
    [q, all],
  );

  return (
    <div className="fade content-narrow">
      <PageHead
        title="Студенты"
        sub={`Всего ${all.length} · отсортированы по релевантности`}
        actions={<><Soon /><button className="btn btn-primary" onClick={() => toast('Функция в разработке')}><Plus size={15} />Добавить</button></>}
      />

      <div style={{ marginBottom: 16 }}>
        <AiInsightCard
          title="3 студента в зоне риска"
          desc="Снижение посещаемости и среднего балла в ПИ-21-1 за 2 недели. Список уже отфильтрован сверху."
          confidence={0.92}
          onAct={() => setPage('attendance')}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <div className="cmd-trigger" style={{ maxWidth: 320, cursor: 'text' }}>
            <Search size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по ФИО или группе…"
              style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', color: 'var(--text)', fontSize: 13 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <NexAsk q="Кто из студентов в зоне риска и почему? Предложи действия." label="Анализ выборки" />
            <span className="dim" style={{ fontSize: 12 }}>{list.length} записей</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Студент</th><th>Группа</th><th>Форма</th><th>Финансирование</th><th>Статус</th><th>Контакты</th></tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => openStudent(s.id)}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Avatar name={`${s.lastname} ${s.firstname}`} /><div><div style={{ fontWeight: 600 }}>{s.lastname} {s.firstname}</div><div className="dim" style={{ fontSize: 12 }}>{s.patronymic}</div></div></div></td>
                  <td className="mono">{s.group}</td>
                  <td>{s.form}</td>
                  <td>{s.finance}</td>
                  <td><Chip tone={statusTone(s.status)}>{s.status}</Chip></td>
                  <td className="dim" style={{ fontSize: 12 }}>{s.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function Groups() {
  const { toast } = useApp();
  // Группы из бэкенда (/api/v1/campus/groups) с автофолбэком на моки.
  const [all, setAll] = useState<Group[]>(groups);
  useEffect(() => {
    let live = true;
    campusApi.listGroups().then((g) => { if (live) setAll(g); });
    return () => { live = false; };
  }, []);
  return (
    <div className="fade content-narrow">
      <PageHead title="Группы" sub={`${all.length} учебных групп`} actions={<><NexAsk q="Сравни группы: численность, успеваемость, риски" label="Сравнить группы" /><Soon /><button className="btn btn-primary" onClick={() => toast('Функция в разработке')}><Plus size={15} />Новая группа</button></>} />
      <div className="grid cols-2">
        {all.map((g) => (
          <div className="card" key={g.id}>
            <div className="card-body">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }} className="mono">{g.name}</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{g.spec}</div>
                </div>
                <Chip tone="chip-info">{g.course} курс</Chip>
              </div>
              <div style={{ display: 'flex', gap: 20, marginTop: 14 }}>
                <div><div className="dim" style={{ fontSize: 11 }}>Студентов</div><div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}><Users size={14} />{g.students}</div></div>
                <div><div className="dim" style={{ fontSize: 11 }}>Куратор</div><div style={{ fontWeight: 600 }}>{g.curator}</div></div>
                <div><div className="dim" style={{ fontSize: 11 }}>Год набора</div><div style={{ fontWeight: 600 }}>{g.year}</div></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Staff() {
  const { toast } = useApp();
  return (
    <div className="fade content-narrow">
      <PageHead title="Сотрудники" sub={`${staff.length} сотрудников`} actions={<><NexAsk q="Проанализируй нагрузку сотрудников и где есть перекос" label="Анализ нагрузки" /><Soon /><button className="btn btn-primary" onClick={() => toast('Функция в разработке')}><Plus size={15} />Добавить</button></>} />
      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Сотрудник</th><th>Должность</th><th>Подразделение</th><th className="right">Нагрузка, ч</th><th>Статус</th></tr></thead>
            <tbody>
              {staff.map((m) => (
                <tr key={m.id}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Avatar name={m.name} /><span style={{ fontWeight: 600 }}>{m.name}</span></div></td>
                  <td>{m.role}</td>
                  <td className="muted">{m.dept}</td>
                  <td className="right mono">{m.load}</td>
                  <td><Chip tone={statusTone(m.status)}>{m.status}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
