/* ============================================================
   Модуль «Агенты» — пока БЕЗ бэкенда.

   Соответствующего модуля на сервере ещё нет (см. agents.ts и
   roadmap). Экран работает на моках, но получает данные через
   этот же слой api/ — поэтому подключение реального бэкенда
   будет правкой одного файла, без изменения экранов.

   Когда появятся эндпоинты /api/v1/agents/*, тело функций ниже
   меняется на apiFetch(...) + withFallback — сигнатуры те же.
   ============================================================ */

import {
  AGENTS,
  QUEUE,
  AGENT_LOG,
  type Agent,
  type PendingAction,
  type AgentLogEntry,
} from '../agents';

/** Список агентов (мок; бэкенд планируется). */
export function listAgents(): Promise<Agent[]> {
  return Promise.resolve(AGENTS);
}

/** Очередь действий, ждущих подтверждения (мок). */
export function agentQueue(): Promise<PendingAction[]> {
  return Promise.resolve(QUEUE);
}

/** Журнал выполненных агентами действий (мок). */
export function agentLog(): Promise<AgentLogEntry[]> {
  return Promise.resolve(AGENT_LOG);
}

// Реэкспорт сидов, чтобы экраны тянули данные через слой api/, а не
// напрямую из ../agents — единая точка будущего переключения на бэкенд.
export { AGENTS, QUEUE, AGENT_LOG };
