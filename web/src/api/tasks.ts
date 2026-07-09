/* ============================================================
   Модуль «Задачи» — обёртка над /api/v1/tasks.

   Контракт бэкенда (internal/module/tasks/http.go):
     GET    /api/v1/tasks                 → taskDTO[]
     POST   /api/v1/tasks                 {title, note, due_on, assignee}
     POST   /api/v1/tasks/{id}/complete
     DELETE /api/v1/tasks/{id}

   Чтения идут через withFallback → на мок из data.ts, если бэкенд
   не сконфигурирован/недоступен. Мутации бросают ApiError.
   ============================================================ */

import { tasks as seedTasks, type Task } from '../data';
import { apiFetch, withFallback } from './client';

/** DTO бэкенда (internal/module/tasks/http.go: taskDTO). */
export interface ApiTask {
  id: string;
  title: string;
  note?: string;
  status: string; // open | done
  due_on?: string; // YYYY-MM-DD
  assignee?: string;
  created_by?: string;
  created_at: string;
  done_at?: string;
}

/** Форма, которую рисует прототип (Task) + богатые поля бэкенда. */
export interface UITask extends Task {
  note?: string;
  status: string;
}

function fromApi(t: ApiTask): UITask {
  return {
    id: t.id,
    title: t.title,
    note: t.note,
    due: t.due_on || '—',
    done: t.status === 'done',
    who: t.assignee || '—',
    status: t.status,
  };
}

/** Мок-задача прототипа → та же UI-форма. */
export function seedToUI(t: Task): UITask {
  return { ...t, status: t.done ? 'done' : 'open' };
}

/** Список задач: реальный бэкенд или моки. */
export function listTasks(): Promise<UITask[]> {
  return withFallback(
    async () => (await apiFetch<ApiTask[]>('/api/v1/tasks')).map(fromApi),
    () => seedTasks.map(seedToUI),
  );
}

export interface NewTask {
  title: string;
  note?: string;
  due_on?: string; // YYYY-MM-DD
  assignee?: string;
}

/** Создать задачу. Бросает ApiError при ошибке валидации/доступа. */
export function createTask(input: NewTask): Promise<void> {
  return apiFetch<void>('/api/v1/tasks', { method: 'POST', body: JSON.stringify(input) });
}

/** Отметить выполненной. */
export function completeTask(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/tasks/${encodeURIComponent(id)}/complete`, { method: 'POST' });
}

/** Удалить задачу. */
export function deleteTask(id: string): Promise<void> {
  return apiFetch<void>(`/api/v1/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
