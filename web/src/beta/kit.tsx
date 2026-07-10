/* ============================================================
   Набор переиспользуемых элементов для бета-разделов:
   модальные окна, формы, теги, панель массовых действий,
   подтверждение, пустое состояние. Стили — в index.css (.bk-*).
   ============================================================ */

import { useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import { X, Search, Plus, Check, ChevronDown, Trash2, AlertTriangle } from 'lucide-react';

/* ---------------- Модальное окно ---------------- */
export function Modal({ title, sub, onClose, children, footer, wide }: {
  title: string; sub?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  return (
    <div className="bk-overlay" onMouseDown={onClose}>
      <div className={`bk-modal ${wide ? 'wide' : ''}`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="bk-modal-head">
          <div>
            <div className="bk-modal-title">{title}</div>
            {sub && <div className="bk-modal-sub">{sub}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
        </div>
        <div className="bk-modal-body">{children}</div>
        {footer && <div className="bk-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- Поля формы ---------------- */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="bk-field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="bk-hint">{hint}</span>}
    </label>
  );
}

export function Text({ value, onChange, placeholder, type = 'text', autoFocus }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; autoFocus?: boolean;
}) {
  return <input className="input" type={type} value={value} autoFocus={autoFocus}
    onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

export function Area({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return <textarea className="input bk-area" rows={rows} value={value}
    onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

export function Select<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/* ---------------- Ввод тегов / списков ---------------- */
export function TagInput({ value, onChange, placeholder = 'Добавить и Enter…' }: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const t = draft.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="bk-tags">
      {value.map((t) => (
        <span className="bk-tag" key={t}>{t}<button onClick={() => onChange(value.filter((x) => x !== t))} aria-label="Убрать"><X size={11} /></button></span>
      ))}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={commit} placeholder={placeholder} />
    </div>
  );
}

/* ---------------- Мультивыбор (исполнители / участники) ---------------- */
export function MultiSelect({ value, onChange, options, placeholder = 'Выбрать…' }: {
  value: string[]; onChange: (v: string[]) => void; options: string[]; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <div className="bk-multi" ref={ref}>
      <button type="button" className="bk-multi-trigger" onClick={() => setOpen((o) => !o)}>
        <span className={value.length ? '' : 'dim'}>{value.length ? value.join(', ') : placeholder}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="bk-multi-pop">
          {options.map((o) => (
            <button type="button" key={o} className={`bk-multi-opt ${value.includes(o) ? 'on' : ''}`} onClick={() => toggle(o)}>
              <span className="bk-check">{value.includes(o) && <Check size={12} />}</span>{o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Панель инструментов: поиск + действия ---------------- */
export function Toolbar({ query, onQuery, placeholder = 'Поиск…', right, children }: {
  query?: string; onQuery?: (v: string) => void; placeholder?: string; right?: ReactNode; children?: ReactNode;
}) {
  return (
    <div className="bk-toolbar">
      {onQuery && (
        <div className="bk-search">
          <Search size={15} />
          <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} />
        </div>
      )}
      {children}
      <div className="bk-toolbar-right">{right}</div>
    </div>
  );
}

/* Кнопка «создать» — единый вид во всех разделах */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="btn btn-primary" onClick={onClick}><Plus size={15} />{label}</button>;
}

/* ---------------- Панель массовых действий ---------------- */
export function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  if (!count) return null;
  return (
    <div className="bk-bulk">
      <span className="bk-bulk-count">{count} выбрано</span>
      <div className="bk-bulk-actions">{children}</div>
      <button className="btn btn-ghost btn-sm" onClick={onClear}>Снять выделение</button>
    </div>
  );
}

/* ---------------- Подтверждение удаления ---------------- */
export function Confirm({ title, body, danger = true, onConfirm, onClose, confirmLabel = 'Удалить' }: {
  title: string; body: string; danger?: boolean; onConfirm: () => void; onClose: () => void; confirmLabel?: string;
}) {
  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { onConfirm(); onClose(); }}>
          {danger && <Trash2 size={15} />}{confirmLabel}
        </button>
      </>
    }>
      <div className="bk-confirm">
        {danger && <span className="bk-confirm-ico"><AlertTriangle size={20} /></span>}
        <p>{body}</p>
      </div>
    </Modal>
  );
}

/* ---------------- Пустое состояние ---------------- */
export function Empty({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="bk-empty">
      {icon && <div className="bk-empty-ico">{icon}</div>}
      <div className="bk-empty-title">{title}</div>
      {hint && <div className="bk-empty-hint">{hint}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

/* ---------------- Чекбокс строки таблицы ---------------- */
export function RowCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={`bk-rowcheck ${checked ? 'on' : ''}`}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }} aria-label="Выбрать">
      {checked && <Check size={12} />}
    </button>
  );
}

/* ---------------- Небольшая метка-«таб» с бейджем «в разработке» ---------------- */
export function SectionNote({ children }: { children: ReactNode }) {
  return <div className="bk-note">{children}</div>;
}
