/* ============================================================
   Модуль «Уведомления» — обёртка над /api/v1/notifications.

   Контракт бэкенда (internal/module/notifications):
     GET  /api/v1/notifications            → ApiNotification[]
     GET  /api/v1/notifications/unread-count → {unread}
     POST /api/v1/notifications/{id}/read    (идемпотентен)
     POST /api/v1/notifications/read-all

   Чтения идут через withFallback: без бэкенда страница получает
   мок из data.ts (severity → непрочитано). Мутации бросают ApiError.
   ============================================================ */

import { notifications as seedNotifications } from '../data';
import { apiFetch, withFallback, humanIso } from './client';

/** DTO бэкенда (модель Notification). */
export interface ApiNotification {
  id: string;
  kind: string; // например task.assigned
  title: string;
  body: string;
  ref_type?: string;
  ref_id?: string;
  created_at: string;
  read_at?: string;
}

/** Форма строки для страницы «Уведомления». */
export interface UiNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  time: string;
  unread: boolean;
}

function fromApi(n: ApiNotification): UiNotification {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    time: humanIso(n.created_at),
    unread: !n.read_at,
  };
}

function seedToUi(): UiNotification[] {
  return seedNotifications.map((n) => ({
    id: n.id,
    kind: n.severity === 'critical' || n.severity === 'high' ? 'alert' : 'info',
    title: n.title,
    body: n.desc,
    time: n.time,
    unread: n.severity === 'critical' || n.severity === 'high',
  }));
}

/** Своя лента, свежие первыми. */
export function listNotifications(params: { unread?: boolean; limit?: number } = {}): Promise<UiNotification[]> {
  const q = new URLSearchParams();
  if (params.unread) q.set('unread', '1');
  if (params.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  return withFallback(
    async () => (await apiFetch<ApiNotification[]>(`/api/v1/notifications${qs ? `?${qs}` : ''}`)).map(fromApi),
    seedToUi,
  );
}

/** Число непрочитанных. */
export function unreadCount(): Promise<number> {
  return withFallback(
    async () => (await apiFetch<{ unread: number }>('/api/v1/notifications/unread-count')).unread,
    () => seedToUi().filter((n) => n.unread).length,
  );
}

/** Отметить прочитанным (идемпотентно). */
export function markRead(id: string): Promise<void> {
  return apiFetch(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

/** Отметить все прочитанными. */
export function markAllRead(): Promise<void> {
  return apiFetch('/api/v1/notifications/read-all', { method: 'POST' });
}
