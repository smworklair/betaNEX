/* ============================================================
   Локальное хранилище бета-сущностей (frontend-first).

   Пока в бэкенде нет соответствующих модулей (см. backend.md),
   расширенные разделы работают на этом слое: данные живут в
   localStorage конкретного браузера, но по форме и операциям
   совпадают с будущим API (CRUD + массовые действия + история).

   Когда появится сервер — эти хуки заменяются на api-обёртки
   (как уже сделано для tasks/campus), UI-компоненты не меняются.
   ============================================================ */

import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'nex-beta:';

export interface Entity { id: string; createdAt?: string; updatedAt?: string; }

function read<T>(key: string, seed: T[]): T[] {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return seed;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : seed;
  } catch {
    return seed;
  }
}

function write<T>(key: string, value: T[]) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* переполнение квоты — молча игнорируем, это демо-слой */
  }
}

/** Короткий стабильный идентификатор. */
export function uid(prefix = 'x'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Человекочитаемая метка времени «сегодня, 14:32» / «12 июл». */
export function humanTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `сегодня, ${time}`;
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' }) + ', ' + time;
}

export interface Collection<T extends Entity> {
  items: T[];
  add: (partial: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & Partial<Entity>) => T;
  update: (id: string, patch: Partial<T>) => void;
  remove: (id: string) => void;
  removeMany: (ids: string[]) => void;
  patchMany: (ids: string[], patch: Partial<T>) => void;
  replace: (items: T[]) => void;
  reset: () => void;
}

/* Синхронизация между экземплярами одного ключа в пределах вкладки. */
const listeners: Record<string, Set<() => void>> = {};
function notify(key: string) {
  listeners[key]?.forEach((fn) => fn());
}

/**
 * Коллекция сущностей с CRUD и массовыми операциями поверх localStorage.
 * `seed` используется только при первом обращении (когда в хранилище пусто).
 */
export function useCollection<T extends Entity>(key: string, seed: T[]): Collection<T> {
  const [items, setItems] = useState<T[]>(() => read<T>(key, seed));

  useEffect(() => {
    const set = listeners[key] || (listeners[key] = new Set());
    const onChange = () => setItems(read<T>(key, seed));
    set.add(onChange);
    const onStorage = (e: StorageEvent) => { if (e.key === PREFIX + key) onChange(); };
    window.addEventListener('storage', onStorage);
    return () => { set.delete(onChange); window.removeEventListener('storage', onStorage); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const commit = useCallback((next: T[]) => {
    write(key, next);
    setItems(next);
    notify(key);
  }, [key]);

  const add: Collection<T>['add'] = useCallback((partial) => {
    const row = {
      id: partial.id || uid(key.split(':')[0] || 'e'),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...partial,
    } as T;
    commit([row, ...read<T>(key, seed)]);
    return row;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, commit]);

  const update = useCallback((id: string, patch: Partial<T>) => {
    commit(read<T>(key, seed).map((r) => (r.id === id ? { ...r, ...patch, updatedAt: nowIso() } : r)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, commit]);

  const remove = useCallback((id: string) => {
    commit(read<T>(key, seed).filter((r) => r.id !== id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, commit]);

  const removeMany = useCallback((ids: string[]) => {
    const set = new Set(ids);
    commit(read<T>(key, seed).filter((r) => !set.has(r.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, commit]);

  const patchMany = useCallback((ids: string[], patch: Partial<T>) => {
    const set = new Set(ids);
    commit(read<T>(key, seed).map((r) => (set.has(r.id) ? { ...r, ...patch, updatedAt: nowIso() } : r)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, commit]);

  const replace = useCallback((next: T[]) => commit(next), [commit]);
  const reset = useCallback(() => { write(key, seed); setItems(seed); notify(key); }, [key, seed]);

  return { items, add, update, remove, removeMany, patchMany, replace, reset };
}

/** Однозначное значение (не коллекция) в localStorage — для настроек представлений. */
export function useLocalValue<T>(key: string, initial: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    try { const raw = localStorage.getItem(PREFIX + key); return raw ? (JSON.parse(raw) as T) : initial; }
    catch { return initial; }
  });
  const set = useCallback((v: T) => {
    setVal(v);
    try { localStorage.setItem(PREFIX + key, JSON.stringify(v)); } catch { /* ignore */ }
  }, [key]);
  return [val, set];
}
