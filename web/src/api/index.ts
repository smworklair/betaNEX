/* ============================================================
   Слой доступа к API NEX — единая точка входа.

   import { tasksApi, campusApi, auth, apiStatus } from '../api';

   Инфраструктура (client) реэкспортируется напрямую; доменные
   модули — как пространства имён, чтобы одноимённые функции
   (listTasks / listStudents / listAgents) не конфликтовали.
   ============================================================ */

export { API_BASE, API_CONFIGURED, ApiError, apiFetch, withFallback, apiStatus } from './client';

export * as auth from './auth';
export * as tasksApi from './tasks';
export * as campusApi from './campus';
export * as agentsApi from './agents';
