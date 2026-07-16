import { useApp } from '../../ui';
import { atRisk, type NexData } from './nexbrain';
import { finance } from '../../data';
import { Donut, Legend, type Segment } from '../../components/charts';

/* ============================================================
   Рендер структурированных данных NEX (NexReply.data): таблица
   риска, финансовая сводка, KPI-панель. Общий для полного чата
   (Chat.tsx) и терминала на «Главном» (Home.tsx) — один источник
   правды для того, как выглядит «настоящий», не текстовый ответ.
   ============================================================ */
export function DataBlock({ kind }: { kind: NexData }) {
  const { setPage, openStudent } = useApp();
  if (kind === 'atrisk') {
    const rows = atRisk().slice(0, 5);
    return (
      <div className="chat-data table-wrap"><table className="tbl">
        <thead><tr><th>Студент</th><th>Группа</th><th className="right">Посещ.</th><th className="right">Балл</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => openStudent(r.id)}>
            <td style={{ fontWeight: 600 }}>{r.name}</td>
            <td className="mono">{r.group}</td>
            <td className="right mono" style={{ color: r.rate < 70 ? 'var(--danger)' : 'var(--warn)' }}>{r.rate}%</td>
            <td className="right mono">{r.avg.toFixed(1)}</td>
          </tr>
        ))}</tbody>
      </table></div>
    );
  }
  if (kind === 'finance') {
    const paid = finance.payments.filter((p) => p.status === 'Оплачено').reduce((a, p) => a + p.sum, 0);
    const segs: Segment[] = [
      { label: 'Поступило', value: paid, color: 'var(--success)' },
      { label: 'Задолженность', value: 248000, color: 'var(--danger)' },
    ];
    return <div className="chat-data chart-flex"><Donut segments={segs} size={120} centerTop="₽" centerSub="период" /><Legend segments={segs} withValues /></div>;
  }
  if (kind === 'security') {
    return (
      <div className="chat-data kpi-row">
        <div className="kpi"><div className="kpi-label">Целостность ядра</div><div className="kpi-value" style={{ color: 'var(--success)' }}>OK</div></div>
        <div className="kpi"><div className="kpi-label">Подозрительные входы</div><div className="kpi-value" style={{ color: 'var(--danger)' }}>2</div></div>
        <div className="kpi"><div className="kpi-label">Активные сессии</div><div className="kpi-value">14</div></div>
      </div>
    );
  }
  return (
    <div className="chat-data kpi-row" onClick={() => setPage('analytics')} style={{ cursor: 'pointer' }}>
      <div className="kpi"><div className="kpi-label">Студентов</div><div className="kpi-value">100</div></div>
      <div className="kpi"><div className="kpi-label">Посещаемость</div><div className="kpi-value">91%</div></div>
      <div className="kpi"><div className="kpi-label">Средний балл</div><div className="kpi-value">4.2</div></div>
      <div className="kpi"><div className="kpi-label">Задолженность</div><div className="kpi-value">₽248K</div></div>
    </div>
  );
}
