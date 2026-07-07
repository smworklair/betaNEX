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
