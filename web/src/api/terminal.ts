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
