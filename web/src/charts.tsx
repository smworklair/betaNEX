import type { ReactNode } from 'react';

/* Lightweight dependency-free charts (SVG + CSS), themeable via CSS variables. */

export interface Segment { label: string; value: number; color: string; }

export function Donut({ segments, size = 150, thickness = 20, centerTop, centerSub }: {
  segments: Segment[]; size?: number; thickness?: number; centerTop?: ReactNode; centerSub?: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />
      {segments.map((s, i) => {
        const len = (s.value / total) * circ;
        const el = (
          <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
            strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset}
            transform={`rotate(-90 ${c} ${c})`}>
            <title>{s.label}: {s.value} ({Math.round((s.value / total) * 100)}%)</title>
          </circle>
        );
        offset += len;
        return el;
      })}
      {centerTop !== undefined && <text x={c} y={c - 1} textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--text)">{centerTop}</text>}
      {centerSub && <text x={c} y={c + 16} textAnchor="middle" fontSize="10.5" fill="var(--text-3)">{centerSub}</text>}
    </svg>
  );
}

export function Legend({ segments, withValues }: { segments: Segment[]; withValues?: boolean }) {
  return (
    <div className="legend">
      {segments.map((s) => (
        <div className="legend-item" key={s.label}>
          <span className="legend-dot" style={{ background: s.color }} />{s.label}
          {withValues && <b>{s.value}</b>}
        </div>
      ))}
    </div>
  );
}

export function Bars({ data, color = 'var(--accent)', height = 170 }: {
  data: { label: string; value: number; color?: string }[]; color?: string; height?: number;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="bars" style={{ height }}>
      {data.map((d) => (
        <div className="bar-col" key={d.label}>
          <span className="bar-v">{d.value}</span>
          <div className="bar-track" title={`${d.label}: ${d.value}`}><div className="bar-fill" style={{ height: `${(d.value / max) * 100}%`, background: d.color || color }} /></div>
          <span className="bar-x">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Line({ data, color = 'var(--accent)', height = 150, min, max }: {
  data: number[]; color?: string; height?: number; min?: number; max?: number;
}) {
  const w = 320; const h = height; const pad = 8;
  const lo = min ?? Math.min(...data);
  const hi = max ?? Math.max(...data);
  const range = hi - lo || 1;
  const step = (w - pad * 2) / Math.max(data.length - 1, 1);
  const pts = data.map((v, i) => [pad + i * step, h - pad - ((v - lo) / range) * (h - pad * 2)] as const);
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={height} preserveAspectRatio="none">
      <polygon points={area} fill={color} opacity={0.1} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill={color}><title>{data[i]}</title></circle>)}
    </svg>
  );
}

/* Две линии на одном поле (например, план и факт / базовый и осторожный сценарий). */
export function DualLine({ a, b, colorA = 'var(--accent)', colorB = 'var(--text-3)', height = 160, dashB = true }: {
  a: number[]; b: number[]; colorA?: string; colorB?: string; height?: number; dashB?: boolean;
}) {
  const w = 320; const h = height; const pad = 8;
  const all = [...a, ...b];
  const lo = Math.min(...all); const hi = Math.max(...all); const range = hi - lo || 1;
  const mk = (d: number[]) => {
    const step = (w - pad * 2) / Math.max(d.length - 1, 1);
    return d.map((v, i) => `${pad + i * step},${(h - pad - ((v - lo) / range) * (h - pad * 2)).toFixed(1)}`).join(' ');
  };
  const la = mk(a); const lb = mk(b);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={height} preserveAspectRatio="none">
      <polygon points={`${pad},${h - pad} ${la} ${w - pad},${h - pad}`} fill={colorA} opacity={0.09} />
      <polyline points={lb} fill="none" stroke={colorB} strokeWidth={2} strokeDasharray={dashB ? '5 5' : undefined} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <polyline points={la} fill="none" stroke={colorA} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* Кольцевой индикатор прогресса (закрытие периода, исполнение бюджета). */
export function Gauge({ value, size = 132, thickness = 12, color = 'var(--accent)', label, sub }: {
  value: number; size?: number; thickness?: number; color?: string; label?: ReactNode; sub?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const len = (pct / 100) * circ;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round"
          strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={circ / 4} transform={`rotate(-90 ${c} ${c})`}
          style={{ transition: 'stroke-dasharray .5s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: size / 5.2, fontWeight: 700, letterSpacing: '-0.03em' }}>{label ?? `${Math.round(pct)}%`}</div>
        {sub && <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

/* Горизонтальные бары — рейтинги статей, структура затрат. */
export function HBars({ data, format }: { data: { label: string; value: number; color?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d) => (
        <div key={d.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}>
            <span>{d.label}</span>
            <span className="mono" style={{ fontWeight: 600 }}>{format ? format(d.value) : d.value}</span>
          </div>
          <div className="meter" style={{ height: 8 }}><i style={{ width: `${(Math.abs(d.value) / max) * 100}%`, background: d.color || 'var(--accent)' }} /></div>
        </div>
      ))}
    </div>
  );
}

/* Водопад (bridge): как из начального значения складывается итог по вкладам «+/−». */
export function Waterfall({ steps, height = 190, format }: {
  steps: { label: string; delta: number; kind?: 'start' | 'end' | 'delta' }[]; height?: number; format?: (n: number) => string;
}) {
  let running = 0;
  const bars = steps.map((s) => {
    if (s.kind === 'start' || s.kind === 'end') { const base = 0; const top = s.delta; running = s.delta; return { ...s, base, top, total: s.delta }; }
    const base = running; running += s.delta; return { ...s, base, top: running, total: running };
  });
  const hi = Math.max(...bars.map((b) => Math.max(b.base, b.top)), 1);
  const w = 100 / bars.length;
  return (
    <div style={{ position: 'relative', height, display: 'flex', alignItems: 'flex-end', gap: 0 }}>
      {bars.map((b, i) => {
        const y0 = Math.min(b.base, b.top); const y1 = Math.max(b.base, b.top);
        const isMarker = b.kind === 'start' || b.kind === 'end';
        const up = b.top >= b.base;
        const color = isMarker ? 'var(--accent)' : up ? 'var(--success)' : 'var(--danger)';
        const bottomPct = (y0 / hi) * 100; const hPct = ((y1 - y0) / hi) * 100;
        return (
          <div key={i} style={{ width: `${w}%`, height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }} title={`${b.label}: ${format ? format(b.delta) : b.delta}`}>
            <div style={{ position: 'absolute', bottom: `${Math.max(bottomPct, 0)}%`, height: `${Math.max(hPct, 1.5)}%`, width: '62%', background: color, borderRadius: 4, minHeight: 3 }} />
            <span style={{ position: 'absolute', bottom: 'calc(100% - 12px)', fontSize: 9.5, color: 'var(--text-3)', textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 2px' }}>{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}
