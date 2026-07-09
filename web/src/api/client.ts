/* ============================================================
   API-инфраструктура NEX — единый клиент к бэкенду nexd.

   Одна точка входа для всех обращений к серверу: базовый URL,
   куки-сессии, разбор ошибок в формате RFC 9457 (Problem Details)
   и автоматический фолбэк на встроенные моки, когда бэкенд не
   сконфигурирован или недоступен.

   Конфигурация — через VITE_API_URL (см. .env.example):
     • пусто / не задано → демо-режим на моках (сеть не трогаем);
     • URL бэкенда       → реальные вызовы (`/`, если тот же origin).
   ============================================================ */

const RAW_BASE = (import.meta.env.VITE_API_URL ?? '').trim();

/** Базовый URL для запросов. Пусто = тот же origin. */
export const API_BASE = RAW_BASE === '/' ? '' : RAW_BASE.replace(/\/+$/, '');

/** Сконфигурирован ли бэкенд. Если нет — весь слой отдаёт моки. */
export const API_CONFIGURED = RAW_BASE.length > 0;

/** Ошибка API: несёт HTTP-статус и человекочитаемые title/detail
    из тела application/problem+json. */
export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail?: string;

  constructor(status: number, title: string, detail?: string) {
    super(detail ? `${title}: ${detail}` : title);
    this.name = 'ApiError';
    this.status = status;
    this.title = title;
    this.detail = detail;
  }
}

interface Problem {
  title?: string;
  detail?: string;
}

/**
 * Низкоуровневый запрос к API. Всегда шлёт куки сессии
 * (credentials: 'include'), проставляет Content-Type для тела и
 * разбирает ошибки в ApiError. 204 → возвращает undefined.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body != null && !(init.headers && 'Content-Type' in (init.headers as object))) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(API_BASE + path, {
    credentials: 'include',
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const p = (data && typeof data === 'object' ? data : {}) as Problem;
    throw new ApiError(res.status, p.title || res.statusText || 'Ошибка запроса', p.detail);
  }

  return data as T;
}

/**
 * Обёртка для ЧТЕНИЙ: пытается получить данные с сервера, а при любой
 * ошибке (бэкенд не сконфигурирован, сеть недоступна, 5xx, нет сессии)
 * прозрачно возвращает мок. Экраны продолжают работать всегда.
 *
 * Мутации (login, create, complete, delete) намеренно НЕ используют
 * этот фолбэк — их результат должен отражать реальный ответ сервера.
 */
export async function withFallback<T>(
  call: () => Promise<T>,
  mock: () => T | Promise<T>,
): Promise<T> {
  if (!API_CONFIGURED) return mock();
  try {
    return await call();
  } catch (err) {
    if (import.meta.env.VITE_API_URL) {
      // Диагностика в консоли — но UI не ломаем.
      console.warn('[api] запрос не удался, показываю моки:', err);
    }
    return mock();
  }
}

/** Короткая сводка о состоянии подключения — для диагностики в UI. */
export function apiStatus(): { configured: boolean; base: string } {
  return { configured: API_CONFIGURED, base: API_BASE || '(тот же origin)' };
}
