/* ============================================================
   API терминала «Администратор · альфа».

   POST /api/v1/terminal/exec — одна точка входа для всех команд
   консоли. Бэкенд возвращает структурированный результат (text /
   table / kpi), фронт только рисует. В демо-режиме (VITE_API_URL
   пуст) терминал исполняет те же команды локальным движком в
   Home.tsx — сюда обращений нет.
   ============================================================ */

import { apiFetch } from './client';

export interface TermKPI { label: string; value: string }

export interface TermResult {
  kind: 'text' | 'table' | 'kpi';
  title?: string;
  text?: string;
  columns?: string[];
  rows?: string[][];
  kpis?: TermKPI[];
  hint?: string;
}

/** Выполнить команду консоли на бэкенде (право terminal:exec, admin). */
export function terminalExec(line: string): Promise<TermResult> {
  return apiFetch<TermResult>('/api/v1/terminal/exec', {
    method: 'POST',
    body: JSON.stringify({ line }),
  });
}

/** Первые слова команд, которые понимает бэкенд-модуль terminal (зеркало
    его alias-карты). В API-режиме такие строки идут на сервер — данные
    настоящие; остальное исполняет локальный демо-реестр. */
export const TERMINAL_BACKEND_TOKENS = new Set([
  'status', 'статус', 'обзор', 'сводка', 'whoami', 'кто',
  'tasks', 'задачи', 'task', 'задача', 'новая', 'готово',
  'users', 'люди', 'пользователи', 'notify', 'уведомить',
  'audit', 'аудит', 'журнал',
  'analytics', 'аналитика', 'groups', 'группы', 'students', 'студенты', 'grades', 'оценки',
  'finance', 'финансы', 'accounts', 'счета', 'entries', 'проводки',
  'security', 'безопасность',
]);
