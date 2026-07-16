import { useMemo, useState } from 'react';
import { LayoutDashboard, TrendingUp, Grid3x3, Save, Download, Trash2, Sparkles, Wand2, PlayCircle } from 'lucide-react';
import { PageHead, NexAsk, Beta, useApp } from '../ui';
import { Bars, Line, Donut, Legend, type Segment } from '../components/charts';
import { groups, gradesFor } from '../data';
import { useCollection, type Entity } from '../beta/store';
import { Field, Select } from '../beta/kit';

const GROUP_NAMES = groups.map((g) => g.name);

/* ---------- тепловая карта посещаемости: группы × недели ---------- */
function heatValue(g: number, w: number) { return 62 + ((g * 7 + w * 13) % 38); }
function heatColor(v: number) {
  const t = (v - 60) / 40; // 0..1
  const h = 8 + t * 120;    // красный→зелёный
  return `hsl(${h} 65% ${58 - t * 8}%)`;
}
function Heatmap() {
  const weeks = 10;
  return (
    <div className="heatmap">
      <div className="heatmap-row heatmap-head">
        <span className="heatmap-label" />
        {Array.from({ length: weeks }, (_, w) => <span key={w} className="heatmap-cell head">Н{w + 1}</span>)}
      </div>
      {GROUP_NAMES.map((g, gi) => (
        <div className="heatmap-row" key={g}>
          <span className="heatmap-label mono">{g}</span>
          {Array.from({ length: weeks }, (_, w) => {
            const v = heatValue(gi, w);
            return <span key={w} className="heatmap-cell" style={{ background: heatColor(v) }} title={`${g} · неделя ${w + 1}: ${v}%`}>{v}</span>;
          })}
        </div>
      ))}
    </div>
  );
}

/* ---------- прогноз (простая линейная экстраполяция) ---------- */
function forecast(series: number[], ahead: number) {
  const n = series.length;
  const xs = series.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = series.reduce((a, b) => a + b, 0) / n;
  const b = xs.reduce((a, x, i) => a + (x - mx) * (series[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const a = my - b * mx;
  return Array.from({ length: ahead }, (_, i) => Math.round(a + b * (n + i)));
}

/* ---------- сохранённые представления (конструктор отчётов) ---------- */
interface View extends Entity { name: string; metric: string; dim: string; chart: string; }
const METRICS = ['Средний балл', 'Посещаемость', 'Задолженность', 'Численность'];
const DIMS = ['По группам', 'По специальностям', 'По месяцам'];
const CHARTS = ['Столбцы', 'Пончик', 'Линия'];
const SEED_VIEWS: View[] = [
  { id: 'vw1', name: 'Средний балл по группам', metric: 'Средний балл', dim: 'По группам', chart: 'Столбцы' },
];

export function AnalyticsPro() {
  const { toast } = useApp();
  const views = useCollection<View>('analytics-views', SEED_VIEWS);
  const [metric, setMetric] = useState(METRICS[0]);
  const [dim, setDim] = useState(DIMS[0]);
  const [chart, setChart] = useState(CHARTS[0]);
  const [name, setName] = useState('');

  const byGroup = useMemo(() => groups.map((g) => {
    const all = Object.values(gradesFor(g.name)).flat().filter((x) => x > 0);
    const avg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
    return { label: g.name, value: Math.round(avg * 20) };
  }), []);
  const segs: Segment[] = byGroup.map((b, i) => ({ label: b.label, value: b.value, color: ['var(--accent)', 'var(--ai)', 'var(--success)', 'var(--warn)'][i % 4] }));

  const history = [88, 86, 90, 84, 87, 89, 85, 88];
  const fc = forecast(history, 4);
  const kpis = [
    { label: 'Средний балл', value: '4.2', delta: '+0.1' },
    { label: 'Посещаемость', value: '86%', delta: '−2%' },
    { label: 'Собираемость оплат', value: '78%', delta: '+5%' },
    { label: 'Отсев (риск)', value: '3', delta: '−1' },
  ];

  const runView = (v: View) => { setMetric(v.metric); setDim(v.dim); setChart(v.chart); toast(`Представление «${v.name}» загружено`); };
  const save = () => { if (!name.trim()) { toast('Введите название представления'); return; } views.add({ name: name.trim(), metric, dim, chart }); setName(''); toast('Представление сохранено'); };

  return (
    <div className="fade content-narrow">
      <PageHead title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><LayoutDashboard size={18} />Дашборды и отчёты</span>}
        sub="KPI, тепловые карты, прогноз и конструктор отчётов" actions={<><Beta />
          <button className="btn btn-outline" onClick={() => toast('Дашборд выгружен (PDF)')}><Download size={15} />Экспорт</button></>} />

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        {kpis.map((k) => (
          <div className="kpi" key={k.label}><div className="kpi-label">{k.label}</div><div className="kpi-value">{k.value}</div>
            <div className="kpi-foot" style={{ color: k.delta.startsWith('−') ? 'var(--danger)' : 'var(--success)' }}><TrendingUp size={13} />{k.delta}</div></div>
        ))}
      </div>

      {/* Конструктор отчётов */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><div className="card-title"><Wand2 size={15} /> Конструктор отчётов</div>
          <NexAsk q="Собери отчёт по ключевым показателям и выдели, что важно" label="Собрать с NEX" /></div>
        <div className="card-body">
          <div className="bk-builder">
            <Field label="Показатель"><Select value={metric} onChange={setMetric} options={METRICS.map((o) => ({ value: o, label: o }))} /></Field>
            <Field label="Разрез"><Select value={dim} onChange={setDim} options={DIMS.map((o) => ({ value: o, label: o }))} /></Field>
            <Field label="Тип графика"><Select value={chart} onChange={setChart} options={CHARTS.map((o) => ({ value: o, label: o }))} /></Field>
            <div className="bk-builder-save">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Название представления…" />
              <button className="btn btn-primary" onClick={save}><Save size={15} />Сохранить</button>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            {chart === 'Столбцы' && <Bars data={byGroup} />}
            {chart === 'Пончик' && <div className="chart-flex"><Donut segments={segs} centerTop="Σ" centerSub={metric} /><Legend segments={segs} withValues /></div>}
            {chart === 'Линия' && <Line data={byGroup.map((b) => b.value)} min={60} max={100} />}
          </div>
        </div>
      </div>

      {views.items.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head"><div className="card-title"><Save size={15} /> Сохранённые представления</div></div>
          <div className="row-list">
            {views.items.map((v) => (
              <div className="feed-row" key={v.id}>
                <div className="feed-ico"><LayoutDashboard size={14} /></div>
                <div className="feed-main"><div className="t">{v.name}</div><div className="m">{v.metric} · {v.dim} · {v.chart}</div></div>
                <button className="btn btn-sm btn-outline" onClick={() => runView(v)}><PlayCircle size={14} />Открыть</button>
                <button className="icon-btn sm" onClick={() => { views.remove(v.id); toast('Удалено'); }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head"><div className="card-title"><Grid3x3 size={15} /> Тепловая карта посещаемости</div>
            <NexAsk q="Где по тепловой карте проседает посещаемость и почему" label="Разобрать" /></div>
          <div className="card-body" style={{ overflowX: 'auto' }}><Heatmap /></div>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title"><TrendingUp size={15} /> Прогноз посещаемости</div>
            <NexAsk q="Объясни прогноз посещаемости и риски на ближайшие недели" label="Объяснить" /></div>
          <div className="card-body">
            <Line data={[...history, ...fc]} min={78} max={100} />
            <div className="bk-forecast-note"><Sparkles size={13} style={{ color: 'var(--ai)' }} /> Прогноз на 4 недели: {fc.join('% · ')}%. Пунктир — экстраполяция по тренду.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
