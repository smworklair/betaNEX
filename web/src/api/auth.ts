/* ============================================================
   Аутентификация — обёртка над /api/v1/auth/*.

   Контракт бэкенда (internal/platform/httpapi/auth.go):
     POST /api/v1/auth/login  {tenant, email, password}
       → 200 SessionUser + httpOnly-cookie nex_session
     GET  /api/v1/auth/me     → 200 SessionUser | 401
     POST /api/v1/auth/logout → 204 (идемпотентно)

   Сессия хранится в httpOnly-cookie, поэтому клиент не держит
   токен — достаточно credentials:'include' в каждом запросе.
   ============================================================ */

import type { Role } from '../data';
import { apiFetch, API_CONFIGURED } from './client';

/** Пользователь в форме ответа /auth/me и /auth/login. */
export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
  roles: string[];
  tenant: string;
}

/** Есть ли реальный бэкенд для входа (иначе — демо-режим). */
export const authConfigured = (): boolean => API_CONFIGURED;

const ROLE_MAP: Record<string, Role> = {
  admin: 'admin',
  teacher: 'teacher',
  accountant: 'accountant',
  student: 'student',
};

/** Первая известная роль пользователя → роль интерфейса прототипа. */
export function primaryRole(roles: string[] | undefined): Role {
  for (const r of roles ?? []) {
    if (ROLE_MAP[r]) return ROLE_MAP[r];
  }
  return 'admin';
}

/** Вход. Пробрасывает ApiError (401 — неверные данные, 429 — лимит). */
export function apiLogin(tenant: string, email: string, password: string): Promise<SessionUser> {
  return apiFetch<SessionUser>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ tenant, email, password }),
  });
}

/** Текущая сессия или null. Не бросает — используется при старте. */
export async function apiMe(): Promise<SessionUser | null> {
  if (!API_CONFIGURED) return null;
  try {
    return await apiFetch<SessionUser>('/api/v1/auth/me');
  } catch {
    return null;
  }
}

/** Выход. Best-effort: гасит серверную сессию, ошибки игнорирует. */
export async function apiLogout(): Promise<void> {
  if (!API_CONFIGURED) return;
  try {
    await apiFetch('/api/v1/auth/logout', { method: 'POST' });
  } catch {
    /* logout идемпотентен — молча продолжаем */
  }
}
