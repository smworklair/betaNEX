/* ============================================================
   Модуль «Аудит» — обёртка над GET /api/v1/audit.

   Append-only журнал хребта Commands → Events → Audit:
   каждая мутация системы (люди, задачи, агенты) видна здесь.
   Доступ — только роль admin (иначе 403 problem+json).

   Чтение через withFallback: без бэкенда — мок auditEvents
   из data.ts в той же UI-форме.
   ============================================================ */

import { auditEvents } from '../data';
import { apiFetch, withFallback, humanIso } from './client';

/** DTO бэкенда (schema AuditEntry в api/openapi.yaml). */
export interface ApiAuditEntry {
  command: string;
  outcome: string; // ok | denied | error
  actor_id?: string;
  detail?: string;
  occurred_at?: string;
  trace_id?: string;
}

/** Форма строки журнала для экрана «Аудит». */
export interface UiAuditRow {
  id: string;
  actor: string;
  action: string;
  target: string;
  severity: string;
  time: string;
  outcome: string;
}

const OUTCOME_SEVERITY: Record<string, string> = { ok: 'low', denied: 'medium', error: 'high' };

function fromApi(e: ApiAuditEntry, i: number): UiAuditRow {
  return {
    id: `a${i}`,
    actor: e.actor_id ? `${e.actor_id.slice(0, 8)}…` : '—',
    action: e.command,
    target: e.detail || '—',
    severity: OUTCOME_SEVERITY[e.outcome] || 'low',
    time: humanIso(e.occurred_at),
    outcome: e.outcome,
  };
}

/** Журнал аудита организации, свежие первыми. */
export function listAudit(params: { limit?: number; command?: string; actor?: string } = {}): Promise<UiAuditRow[]> {
  const q = new URLSearchParams();
  if (params.limit) q.set('limit', String(params.limit));
  if (params.command) q.set('command', params.command);
  if (params.actor) q.set('actor', params.actor);
  const qs = q.toString();
  return withFallback(
    async () => (await apiFetch<ApiAuditEntry[]>(`/api/v1/audit${qs ? `?${qs}` : ''}`)).map(fromApi),
    () => auditEvents.map((e, i) => ({
      id: e.id || `m${i}`,
      actor: e.actor,
      action: e.action,
      target: e.target,
      severity: e.severity,
      time: e.time,
      outcome: e.actorType === 'ai' ? 'ai' : 'ok',
    })),
  );
}
