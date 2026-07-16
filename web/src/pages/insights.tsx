import { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { PageHead, Chip, NexAsk } from '../ui';
import { groups, gradesFor, finance } from '../data';
import { Donut, Line, Legend, type Segment } from '../charts';

/* распределение оценок: по выбранной группе или по всем */
function distFor(scope: string) {
  const dist: Record<number, number> = { 2: 0, 3: 0, 4: 0, 5: 0 };
  const src = scope === 'all' ? groups.map((g) => g.name) : [scope];
  src.forEach((name) => Object.values(gradesFor(name)).forEach((row) => row.forEach((v) => { if (v >= 2 && v <= 5) dist[v]++; })));
  return dist;
}
/* динамика посещаемости — своя форма для каждой группы и периода */
function attendanceSeries(scope: string, points: number) {
  const seed = scope === 'all' ? 3 : scope.length;
  return Array.from({ length: points }, (_, i) => 84 + ((Math.sin(i * 0.7 + seed) + 1) * 5) + (scope === 'ПИ-21-1' ? -3 : 0));
}

export function Analytics() {
  const [scope, setScope] = useState<string>('all');            // группа-фильтр
  const [period, setPeriod] = useState<'month' | 'sem' | 'year'>('sem'); // период для линии
  const points = period === 'month' ? 4 : period === 'sem' ? 12 : 24;

  const byGroup = groups.map((g) => {
    const all = Object.values(gradesFor(g.name)).flat().filter((x) => x > 0);
    return { name: g.name, avg: all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0 };
  });
  const max = Math.max(...byGroup.map((b) => b.avg), 5);

  const dist = distFor(scope);
  const gradeSegs: Segment[] = [
    { label: 'Отлично (5)', value: dist[5], color: 'var(--success)' },
    { label: 'Хорошо (4)', value: dist[4], color: 'var(--accent)' },
    { label: 'Удовл. (3)', value: dist[3], color: 'var(--warn)' },
    { label: 'Неуд. (2)', value: dist[2], color: 'var(--danger)' },
  ];
  const totalGrades = gradeSegs.reduce((a, s) => a + s.value, 0);
  const attAvg = Math.round(attendanceSeries(scope, points).reduce((a, b) => a + b, 0) / points);
  const paid = finance.payments.filter((p) => p.status === 'Оплачено').reduce((a, p) => a + p.sum, 0);
  const finSegs: Segment[] = [
    { label: 'Поступило', value: paid, color: 'var(--success)' },
    { label: 'Задолженность', value: 248000, color: 'var(--danger)' },
  ];

  return (
    <div className="fade content-narrow">
      <PageHead title="Аналитика" sub="Интерактивные показатели — фильтры меняют графики" />

      {/* Управление: группа + период реально пересчитывают диаграммы */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body an-controls">
          <div className="an-ctl">
            <span className="field-label" style={{ margin: 0 }}>Группа</span>
            <div className="seg">
              <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Все</button>
              {groups.map((g) => <button key={g.id} className={scope === g.name ? 'on' : ''} onClick={() => setScope(g.name)}>{g.name}</button>)}
            </div>
          </div>
          <div className="an-ctl">
            <span className="field-label" style={{ margin: 0 }}>Период</span>
            <div className="seg">
              <button className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>Месяц</button>
              <button className={period === 'sem' ? 'on' : ''} onClick={() => setPeriod('sem')}>Семестр</button>
              <button className={period === 'year' ? 'on' : ''} onClick={() => setPeriod('year')}>Год</button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="kpi-label">Оценок в выборке</div><div className="kpi-value">{totalGrades}</div></div>
        <div className="kpi"><div className="kpi-label">Средний балл</div><div className="kpi-value">{totalGrades ? ((dist[5] * 5 + dist[4] * 4 + dist[3] * 3 + dist[2] * 2) / totalGrades).toFixed(1) : '—'}</div></div>
        <div className="kpi"><div className="kpi-label">Посещаемость</div><div className="kpi-value">{attAvg}%</div></div>
        <div className="kpi"><div className="kpi-label">Отличников</div><div className="kpi-value">{dist[5]}</div></div>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><div className="card-title">Распределение оценок · {scope === 'all' ? 'все' : scope}</div><NexAsk q={`Разбери распределение оценок ${scope === 'all' ? 'по организации' : 'группы ' + scope} и где проседает`} label="Разобрать" /></div>
          <div className="card-body chart-flex"><Donut segments={gradeSegs} centerTop={totalGrades} centerSub="оценок" /><Legend segments={gradeSegs} withValues /></div>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">Посещаемость · {period === 'month' ? 'месяц' : period === 'sem' ? 'семестр' : 'год'}</div><NexAsk q="Объясни динамику посещаемости и спрогнозируй риск" label="Объяснить" /></div>
          <div className="card-body"><Line data={attendanceSeries(scope, points)} min={78} max={100} /><div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Средняя {attAvg}%{scope === 'ПИ-21-1' ? ' · группа тянет вниз' : ''}</div></div>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">Финансы</div><NexAsk q="Сформируй финансовую сводку: поступления, задолженность, риски" label="Сводка" /></div>
          <div className="card-body chart-flex"><Donut segments={finSegs} centerTop="₽" centerSub="период" /><Legend segments={finSegs} /></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Средний балл по группам</div><NexAsk q="Какие группы отстают по среднему баллу и почему?" label="Найти отстающих" /></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {byGroup.map((b) => (
            <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', opacity: scope === 'all' || scope === b.name ? 1 : 0.4 }} onClick={() => setScope(scope === b.name ? 'all' : b.name)}>
              <span className="mono" style={{ width: 72, fontSize: 13, fontWeight: scope === b.name ? 700 : 400 }}>{b.name}</span>
              <div className="meter" style={{ flex: 1, height: 10 }}><i style={{ width: `${(b.avg / max) * 100}%`, background: scope === b.name ? 'var(--accent)' : 'linear-gradient(90deg, var(--accent), var(--ai))' }} /></div>
              <span className="mono" style={{ width: 36, fontWeight: 600, textAlign: 'right' }}>{b.avg.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Graduation() {
  const readiness = [
    { group: 'ПИ-21-1', ready: 22, total: 24 },
    { group: 'ИС-21-1', ready: 19, total: 22 },
  ];
  return (
    <div className="fade content-narrow">
      <PageHead title="Выпуск" sub="Готовность к выпуску 2024" />
      <div className="ai-card" style={{ marginBottom: 16 }}>
        <div className="ai-head"><GraduationCap size={14} /> Готовность документов</div>
        <div className="ai-body">У 5 студентов не хватает закрытых задолженностей для допуска. Список сформирован автоматически.</div>
        <div className="ai-actions"><NexAsk q="Кто не готов к выпуску и что нужно закрыть для допуска?" label="Что мешает выпуску" subtle={false} /></div>
      </div>
      <div className="grid cols-2">
        {readiness.map((r) => (
          <div className="card" key={r.group}>
            <div className="card-body">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span className="mono" style={{ fontSize: 16, fontWeight: 700 }}>{r.group}</span>
                <Chip tone={r.ready === r.total ? 'chip-success' : 'chip-warn'}>{r.ready}/{r.total} готовы</Chip>
              </div>
              <div className="meter" style={{ height: 10 }}><i style={{ width: `${(r.ready / r.total) * 100}%`, background: 'var(--success)' }} /></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
