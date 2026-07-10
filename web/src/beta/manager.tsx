/* ============================================================
   Универсальный менеджер сущностей: таблица + поиск + CRUD +
   массовое удаление + экспорт CSV + импорт JSON. Используется
   финансами, учебным процессом, людьми и безопасностью, чтобы
   «создание/изменение/удаление» выглядело одинаково везде.
   ============================================================ */

import { useMemo, useRef, useState, Fragment, type ReactNode, type ChangeEvent } from 'react';
import { Download, Upload, Trash2, Edit3, Search } from 'lucide-react';
import { useApp, Chip } from '../ui';
import { uid, type Entity, type Collection } from './store';
import { Modal, Field, Text, Select, Area, MultiSelect, AddButton, Confirm, Empty, RowCheck } from './kit';

export interface Col<T> { key: keyof T; label: string; kind?: 'money' | 'status' | 'chip' | 'text'; }
export interface FieldDef<T> { key: keyof T; label: string; type?: 'text' | 'number' | 'date' | 'textarea' | 'time'; options?: string[]; multi?: string[]; }

export const rub = (n: number) => '₽ ' + (n || 0).toLocaleString('ru');

export function statusTone(s: string): string {
  if (/оплач|подпис|провед|исполн|принят|активн|зачисл|утвержд|готов|сдан|допущ/i.test(s)) return 'chip-success';
  if (/просроч|отклон|долг|заблок|отчисл|не сдан|не допущ/i.test(s)) return 'chip-danger';
  if (/ждёт|черновик|на рассмотр|частично|отпуск|проверк/i.test(s)) return 'chip-warn';
  return 'chip-neutral';
}

export function EntityManager<T extends Entity & Record<string, unknown>>({
  title, col, columns, fields, empty, extraActions,
}: {
  title: string; col: Collection<T>; columns: Col<T>[]; fields: FieldDef<T>[]; empty: string; extraActions?: ReactNode;
}) {
  const { toast } = useApp();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [confirmDel, setConfirmDel] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => col.items.filter((r) =>
    !q || columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q.toLowerCase()))
  ), [col.items, q, columns]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allChecked = list.length > 0 && list.every((r) => sel.has(r.id));

  const exportCsv = () => {
    const header = columns.map((c) => c.label).join(';');
    const rows = list.map((r) => columns.map((c) => `"${String(r[c.key] ?? '').replace(/"/g, '""')}"`).join(';'));
    const blob = new Blob(['﻿' + [header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${title}.csv`; a.click();
    toast('Экспортировано в CSV');
  };
  const doImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    file.text().then((txt) => {
      try {
        const data = JSON.parse(txt);
        if (Array.isArray(data)) { data.forEach((row) => col.add({ ...row, id: uid('imp') })); toast(`Импортировано: ${data.length}`); }
        else toast('Ожидается JSON-массив');
      } catch { toast('Не удалось разобрать файл'); }
    });
    e.target.value = '';
  };

  const cell = (r: T, c: Col<T>): ReactNode => {
    const v = r[c.key];
    if (c.kind === 'money') return <span className="mono">{rub(Number(v))}</span>;
    if (c.kind === 'status') return <Chip tone={statusTone(String(v))}>{String(v)}</Chip>;
    if (c.kind === 'chip') return <Chip tone="chip-info">{String(v)}</Chip>;
    if (Array.isArray(v)) return v.join(', ') || '—';
    return String(v ?? '—');
  };

  return (
    <>
      <div className="bk-toolbar">
        <div className="bk-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск…" /></div>
        <div className="bk-toolbar-right">
          {extraActions}
          <button className="btn btn-outline btn-sm" onClick={exportCsv}><Download size={14} />Экспорт</button>
          <button className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}><Upload size={14} />Импорт</button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={doImport} />
          <AddButton label="Создать" onClick={() => setEditing('new')} />
        </div>
      </div>

      {sel.size > 0 && (
        <div className="bk-bulk">
          <span className="bk-bulk-count">{sel.size} выбрано</span>
          <div className="bk-bulk-actions"><button className="btn btn-sm btn-danger" onClick={() => setConfirmDel([...sel])}><Trash2 size={14} />Удалить</button></div>
          <button className="btn btn-ghost btn-sm" onClick={() => setSel(new Set())}>Снять</button>
        </div>
      )}

      {list.length === 0 ? <Empty title={empty} action={<AddButton label="Создать" onClick={() => setEditing('new')} />} /> : (
        <div className="card"><div className="table-wrap"><table className="tbl">
          <thead><tr>
            <th style={{ width: 34 }}><RowCheck checked={allChecked} onChange={(v) => setSel(v ? new Set(list.map((r) => r.id)) : new Set())} /></th>
            {columns.map((c) => <th key={String(c.key)} className={c.kind === 'money' ? 'right' : ''}>{c.label}</th>)}
            <th></th>
          </tr></thead>
          <tbody>{list.map((r) => (
            <tr key={r.id}>
              <td><RowCheck checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
              {columns.map((c) => <td key={String(c.key)} className={c.kind === 'money' ? 'right' : ''}>{cell(r, c)}</td>)}
              <td className="right"><div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <button className="icon-btn sm" onClick={() => setEditing(r)}><Edit3 size={14} /></button>
                <button className="icon-btn sm" onClick={() => setConfirmDel([r.id])}><Trash2 size={14} /></button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div></div>
      )}

      {editing && <Editor title={title} col={col} row={editing === 'new' ? null : editing} fields={fields} onClose={() => setEditing(null)} />}
      {confirmDel && <Confirm title="Удалить записи?" body={`Будет удалено: ${confirmDel.length}. Действие необратимо.`}
        onConfirm={() => { col.removeMany(confirmDel); setSel(new Set()); toast('Удалено'); }} onClose={() => setConfirmDel(null)} />}
    </>
  );
}

function Editor<T extends Entity & Record<string, unknown>>({ title, col, row, fields, onClose }: {
  title: string; col: Collection<T>; row: T | null; fields: FieldDef<T>[]; onClose: () => void;
}) {
  const { toast } = useApp();
  const [f, setF] = useState<Record<string, unknown>>(() => {
    const base: Record<string, unknown> = {};
    fields.forEach((fd) => {
      base[String(fd.key)] = row ? row[fd.key] : (fd.multi ? [] : fd.type === 'number' ? 0 : fd.options ? fd.options[0] : '');
    });
    return base;
  });
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));
  const save = () => {
    const first = fields[0];
    if (!String(f[String(first.key)] ?? '').trim()) { toast(`Заполните «${first.label}»`); return; }
    if (row) col.update(row.id, f as Partial<T>); else col.add(f as Omit<T, keyof Entity>);
    toast(row ? 'Сохранено' : 'Создано'); onClose();
  };
  return (
    <Modal wide title={row ? `Изменить · ${title}` : `Создать · ${title}`} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" onClick={save}>Сохранить</button>
    </>}>
      <div className="bk-form-grid">
        {fields.map((fd) => (
          <Fragment key={String(fd.key)}><Field label={fd.label}>
            {fd.multi ? <MultiSelect value={(f[String(fd.key)] as string[]) || []} onChange={(v) => set(String(fd.key), v)} options={fd.multi} />
              : fd.options ? <Select value={String(f[String(fd.key)])} onChange={(v) => set(String(fd.key), v)} options={fd.options.map((o) => ({ value: o, label: o }))} />
              : fd.type === 'textarea' ? <Area value={String(f[String(fd.key)] ?? '')} onChange={(v) => set(String(fd.key), v)} />
              : <Text type={fd.type || 'text'} value={String(f[String(fd.key)] ?? '')} onChange={(v) => set(String(fd.key), fd.type === 'number' ? (Number(v) || 0) : v)} />}
          </Field></Fragment>
        ))}
      </div>
    </Modal>
  );
}
