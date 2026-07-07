import { Sparkles, AlertTriangle, X, FileText, Clock } from 'lucide-react';
import { useApp, Chip, NexAsk } from './ui';
import { students, finance, gradesFor } from './data';

export const attendanceRate = (id: number) => 100 - ((id * 13) % 35);
export const avgGrade = (id: number, group: string) => {
  const m = (gradesFor(group)[id] || []).filter((g) => g > 0);
  return m.length ? m.reduce((a, b) => a + b, 0) / m.length : 0;
};
export const groupAvg = (group: string) => {
  const all = students.filter((s) => s.group === group).map((s) => avgGrade(s.id, group)).filter((x) => x > 0);
  return all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
};
export const hasDebt = (lastname: string) => finance.payments.some((p) => p.student.startsWith(lastname) && p.status !== 'Оплачено');

/** Composed list of at-risk students — reused by the command center. */
export function AtRiskList() {
  const { openStudent } = useApp();
  const risky = students
    .map((s) => ({ s, rate: attendanceRate(s.id), avg: avgGrade(s.id, s.group) }))
    .filter((x) => x.rate < 78 || x.avg < 3.6)
    .sort((a, b) => a.rate - b.rate);
  return (
    <div className="table-wrap"><table className="tbl">
      <thead><tr><th>Студент</th><th>Группа</th><th className="right">Посещ.</th><th className="right">Ср. балл</th><th>Риск</th></tr></thead>
      <tbody>{risky.map(({ s, rate, avg }) => (
        <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => openStudent(s.id)}>
          <td style={{ fontWeight: 600 }}>{s.lastname} {s.firstname}</td>
          <td className="mono">{s.group}</td>
          <td className="right mono" style={{ color: rate < 70 ? 'var(--danger)' : 'var(--warn)' }}>{rate}%</td>
          <td className="right mono">{avg.toFixed(1)}</td>
          <td><Chip tone={rate < 70 ? 'chip-danger' : 'chip-warn'}>{rate < 70 ? 'высокий' : 'средний'}</Chip></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

/** Context drawer: an object (student) with its stitched graph. Opens on row click. */
export function ContextDrawer() {
  const { objStudent, closeObject, setPage, toast } = useApp();
  if (objStudent == null) return null;
  const s = students.find((x) => x.id === objStudent);
  if (!s) return null;

  const rate = attendanceRate(s.id);
  const avg = avgGrade(s.id, s.group);
  const debt = hasDebt(s.lastname);

  return (
    <div className="drawer-overlay" onClick={closeObject}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div className="avatar" style={{ width: 40, height: 40, fontSize: 14 }}>{s.lastname[0] + s.firstname[0]}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{s.lastname} {s.firstname} {s.patronymic}</div>
            <div className="muted" style={{ fontSize: 13 }}>{s.group} · {s.form} · {s.finance}</div>
          </div>
          <button className="icon-btn" onClick={closeObject} aria-label="Закрыть"><X size={18} /></button>
        </div>

        <div className="drawer-body">
          <div className="ai-card">
            <div className="ai-head"><Sparkles size={14} /> Сводка NEX</div>
            <div className="ai-body">
              Средний балл <b>{avg.toFixed(1)}</b>, посещаемость <b>{rate}%</b>{rate < 78 ? ' — ниже нормы' : ''}.{' '}
              {debt ? 'Есть незакрытая задолженность по оплате.' : 'Задолженностей по оплате нет.'}{' '}
              {rate < 78 ? 'Рекомендуется связаться с куратором.' : 'Успеваемость стабильная.'}
            </div>
            <div className="ai-actions"><NexAsk q={`Разбери студента ${s.lastname} ${s.firstname} (${s.group}): риски, причины, что предпринять`} label="Разобрать с NEX" subtle={false} /></div>
          </div>

          <div className="obj-stats">
            <div className="obj-stat"><div className="l">Ср. балл</div><div className="v">{avg.toFixed(1)}</div></div>
            <div className="obj-stat"><div className="l">Посещ.</div><div className="v" style={{ color: rate < 78 ? 'var(--warn)' : 'var(--success)' }}>{rate}%</div></div>
            <div className="obj-stat"><div className="l">Оплата</div><div className="v" style={{ color: debt ? 'var(--danger)' : 'var(--success)' }}>{debt ? 'долг' : 'ок'}</div></div>
          </div>

          <div>
            <div className="sec-label" style={{ margin: '0 0 10px' }}><Clock size={13} /> История</div>
            <div className="tl">
              <div className="tl-item ai"><div style={{ fontSize: 13 }}>NEX отметил снижение посещаемости</div><div className="dim" style={{ fontSize: 11 }}>2 дня назад</div></div>
              <div className="tl-item"><div style={{ fontSize: 13 }}>Выставлена оценка по «Базы данных»</div><div className="dim" style={{ fontSize: 11 }}>5 дней назад</div></div>
              <div className="tl-item"><div style={{ fontSize: 13 }}>Зачислен в группу {s.group}</div><div className="dim" style={{ fontSize: 11 }}>{s.group.includes('21') ? '2021' : '2022'} г.</div></div>
            </div>
          </div>

          <div className="chips">
            <button className="btn btn-primary btn-sm" onClick={() => toast('Справка сформирована')}><FileText size={14} />Сформировать справку</button>
            <button className="btn btn-outline btn-sm" onClick={() => { closeObject(); setPage('journal'); }}>Открыть журнал</button>
            {rate < 78 && <button className="btn btn-outline btn-sm" onClick={() => toast('Задача куратору поставлена')}><AlertTriangle size={14} />Куратору</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
