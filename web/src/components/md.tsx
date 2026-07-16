import { type ReactNode } from 'react';

/* ============================================================
   Лёгкий markdown-рендер для ответов NEX (без зависимостей).
   Поддержка: **жирный**, *курсив*, `код`, списки, заголовки.
   Для обычного текста работает как простой параграф.
   ============================================================ */

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\n]+)\*|_([^_\n]+)_)/g;
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined) nodes.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[3] !== undefined) nodes.push(<code key={k++}>{m[3]}</code>);
    else if (m[4] !== undefined) nodes.push(<em key={k++}>{m[4]}</em>);
    else if (m[5] !== undefined) nodes.push(<em key={k++}>{m[5]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const isBullet = (l: string) => /^\s*[-*•]\s+/.test(l);
const isNum = (l: string) => /^\s*\d+[.)]\s+/.test(l);
const isHead = (l: string) => /^#{1,4}\s+/.test(l);
const isHr = (l: string) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l);

export function Md({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0; let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push(<hr className="md-hr" key={key++} />); i++; continue; }

    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) { blocks.push(<div className="md-h" key={key++}>{inline(h[1])}</div>); i++; continue; }

    if (isBullet(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isBullet(lines[i])) { items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*[-*•]\s+/, ''))}</li>); i++; }
      blocks.push(<ul className="md-ul" key={key++}>{items}</ul>);
      continue;
    }
    if (isNum(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && isNum(lines[i])) { items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*\d+[.)]\s+/, ''))}</li>); i++; }
      blocks.push(<ol className="md-ol" key={key++}>{items}</ol>);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBullet(lines[i]) && !isNum(lines[i]) && !isHead(lines[i]) && !isHr(lines[i])) { para.push(lines[i]); i++; }
    blocks.push(<p className="md-p" key={key++}>{inline(para.join(' '))}</p>);
  }
  return <>{blocks}</>;
}
