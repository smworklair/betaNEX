import { useState } from 'react';
import { Sparkles, ShieldCheck, AlertTriangle, Bell, Pencil } from 'lucide-react';
import { PageHead, Chip, NexAsk, useApp } from '../ui';
import { groups, students, subjectsByGroup, gradesFor, scheduleDays, scheduleSlots } from '../data';

function GroupSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className="select" style={{ maxWidth: 220 }} value={value} onChange={(e) => onChange(e.target.value)}>
      {groups.map((g) => <option key={g.id} value={g.name}>{g.name} — {g.spec}</option>)}
    </select>
  );
}

export function Schedule() {
  const [group, setGroup] = useState(groups[0].name);
  return (
    <div className="fade content-narrow">
      <PageHead title="Расписание" sub={`Группа ${group} · текущая неделя`} actions={<GroupSelect value={group} onChange={setGroup} />} />

      <div className="ai-card" style={{ marginBottom: 16, borderLeftColor: 'var(--success)' }}>
        <div className="ai-head" style={{ color: 'var(--success)' }}><ShieldCheck size={14} /> Проверка расписания</div>
        <div className="ai-body">Конфликтов не найдено: преподаватели и аудитории не пересекаются. Найдено свободное окно — <b>Пн 12:00, ауд. 305</b> — можно перенести «Сети».</div>
        <div className="ai-actions"><NexAsk q={`Предложи оптимизацию расписания группы ${group} и как заполнить свободные окна`} label="Оптимизировать" subtle={false} /></div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl jtbl">
            <thead><tr><th>Время</th>{scheduleDays.map((d) => <th key={d}>{d}</th>)}</tr></thead>
            <tbody>
              {scheduleSlots.map((row) => (
                <tr key={row.time}>
                  <td className="mono" style={{ fontWeight: 600 }}>{row.time}</td>
                  {[row.mon, row.tue, row.wed, row.thu, row.fri].map((cell, i) => (
                    <td key={i} style={cell.includes('окно') ? { color: 'var(--text-3)', fontStyle: 'italic' } : undefined}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* даты последних 6 занятий — понятнее, чем безликие «1 2 3 4 5 6» */
const LESSON_DATES = ['3 июн', '6 июн', '10 июн', '13 июн', '17 июн', '20 июн'];

export function Journal() {
  const { toast } = useApp();
  const [group, setGroup] = useState(groups[0].name);
  const [subject, setSubject] = useState((subjectsByGroup[groups[0].name] || [''])[0]);
  const [edits, setEdits] = useState<Record<string, number>>({});   // «studentId-col» → оценка
  const subs = subjectsByGroup[group] || [];
  const list = students.filter((s) => s.group === group);
  const grades = gradesFor(group);
  const cls = (g: number) => (g === 0 ? '' : g === 5 ? 'g5' : g === 4 ? 'g4' : g === 3 ? 'g3' : 'g2');
  const onGroup = (v: string) => { setGroup(v); setSubject((subjectsByGroup[v] || [''])[0]); setEdits({}); };
  const markOf = (sid: number, col: number, orig: number) => edits[`${sid}-${col}`] ?? orig;
  /* клик по клетке ставит следующую оценку: 5→4→3→2→пропуск→5 — так «выставляешь» оценки */
  const CYCLE = [5, 4, 3, 2, 0];
  const cycle = (sid: number, col: number, cur: number) => {
    const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
    setEdits((e) => ({ ...e, [`${sid}-${col}`]: next }));
  };

  return (
    <div className="fade content-narrow">
      <PageHead title="Журнал оценок" sub="Нажмите на оценку, чтобы её изменить. Прочерк — пропуск."
        actions={
          <>
            <GroupSelect value={group} onChange={onGroup} />
            <select className="select" style={{ maxWidth: 200 }} value={subject} onChange={(e) => setSubject(e.target.value)}>
              {subs.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        } />

      <div className="ai-card" style={{ marginBottom: 16 }}>
        <div className="ai-head"><Sparkles size={14} /> Что видит NEX</div>
        <div className="ai-body">У <b>Сидорова Дмитрия</b> две тройки подряд и один пропуск — успеваемость падает. Можно отметить пересдачу и сразу уведомить студента, чтобы взялся за ум.</div>
        <div className="ai-actions"><NexAsk q={`Кому в группе ${group} нужна помощь по успеваемости и что предпринять?`} label="Кому нужна помощь" subtle={false} /></div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title"><Pencil size={14} /> {group} · {subject}</div>
          <button className="btn btn-sm btn-primary" onClick={() => toast('Оценки сохранены')}>Сохранить</button></div>
        <div className="table-wrap">
          <table className="tbl jtbl">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Студент</th>
                {LESSON_DATES.map((d) => <th key={d} style={{ fontWeight: 600 }}>{d}</th>)}
                <th>Средний</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const row = grades[s.id] || [];
                const cur = row.map((g, i) => markOf(s.id, i, g));
                const marks = cur.filter((g) => g > 0);
                const avgN = marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : 0;
                const avg = marks.length ? avgN.toFixed(1) : '—';
                return (
                  <tr key={s.id}>
                    <td style={{ textAlign: 'left', fontWeight: 600 }}>{s.lastname} {s.firstname}</td>
                    {cur.map((g, i) => (
                      <td key={i} className={`${cls(g)} jcell`} title="Нажмите, чтобы изменить" onClick={() => cycle(s.id, i, g)}>{g === 0 ? '—' : g}</td>
                    ))}
                    <td style={{ fontWeight: 700 }}>{avg}</td>
                    <td>
                      {avgN > 0 && avgN < 3.5
                        ? <button className="btn btn-sm btn-outline" title="Уведомить студента" onClick={() => toast(`Уведомление отправлено: ${s.lastname} ${s.firstname[0]}.`)}><Bell size={13} />Уведомить</button>
                        : <span className="dim">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="jrn-legend">
          <span><b className="g5">5</b> отлично</span>
          <span><b className="g4">4</b> хорошо</span>
          <span><b className="g3">3</b> удовлетворительно</span>
          <span><b className="g2">2</b> неудовлетворительно</span>
          <span><b style={{ color: 'var(--text-3)' }}>—</b> пропуск занятия</span>
        </div>
      </div>
    </div>
  );
}

export function Attendance() {
  const { toast } = useApp();
  const [group, setGroup] = useState(groups[0].name);
  const list = students.filter((s) => s.group === group);
  const rate = (id: number) => 100 - ((id * 13) % 35);

  return (
    <div className="fade content-narrow">
      <PageHead title="Посещаемость" sub={`Группа ${group} · текущий месяц`} actions={<GroupSelect value={group} onChange={setGroup} />} />

      <div className="ai-card" style={{ marginBottom: 16, borderLeftColor: 'var(--warn)' }}>
        <div className="ai-head" style={{ color: 'var(--warn)' }}><AlertTriangle size={14} /> Раннее предупреждение</div>
        <div className="ai-body">У 2 студентов посещаемость опустилась ниже 70% — высокий риск задолженности. Они помечены ниже.</div>
        <div className="ai-actions"><NexAsk q={`Составь план работы с прогульщиками в группе ${group}`} label="План действий" subtle={false} /></div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Студент</th><th style={{ width: '40%' }}>Посещаемость</th><th className="right">%</th><th>Статус</th><th>Действие NEX</th></tr></thead>
            <tbody>
              {list.map((s) => {
                const r = rate(s.id);
                const tone = r >= 85 ? 'var(--success)' : r >= 70 ? 'var(--warn)' : 'var(--danger)';
                return (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.lastname} {s.firstname[0]}.</td>
                    <td><div className="meter"><i style={{ width: `${r}%`, background: tone }} /></div></td>
                    <td className="right mono" style={{ color: tone, fontWeight: 600 }}>{r}%</td>
                    <td>{r < 70 ? <Chip tone="chip-danger">риск</Chip> : r < 85 ? <Chip tone="chip-warn">внимание</Chip> : <Chip tone="chip-success">норма</Chip>}</td>
                    <td>{r < 85
                      ? <button className="btn btn-sm btn-outline" onClick={() => toast(`NEX составил и отправил уведомление: ${s.lastname} ${s.firstname[0]}.`)}><Sparkles size={13} />Уведомить</button>
                      : <span className="dim">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
