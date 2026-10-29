import { AUDIT_ACTIONS, type AuditAction } from './audit-actions';

export type AuditOutcome = 'ok' | 'denied' | 'error';
export type AuditActorKind = 'user' | 'service' | 'system';

export interface AuditEventInput {
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  outcome?: AuditOutcome;
  meta?: Record<string, unknown>;
  /** The organization the change belongs to, when the request itself did not resolve one (e.g. read from the row being deleted). */
  organizationId?: string;
  /** Override who did it: the upload runner acts as the system on behalf of a user. */
  actor?: { kind: AuditActorKind; userId?: string };
}

/** What the current request knows (common/request-context). */
export interface AuditContext {
  userId?: string;
  organizationId?: string;
  ip?: string;
  requestId?: string;
}

/** The arguments of the record_audit_event() database function (migration 919). */
export interface AuditRowArgs {
  p_org: string | null;
  p_actor: string | null;
  p_actor_kind: AuditActorKind;
  p_action: string;
  p_target_type: string | null;
  p_target_id: string | null;
  p_outcome: AuditOutcome;
  p_ip: string | null;
  p_request_id: string | null;
  p_meta: Record<string, string | number | boolean>;
}

const MAX_TEXT = 120;
// A value shaped like a credential is dropped even under an allowed key: a JWT, a Supabase key, or a bearer header.
const SECRET_SHAPED = /eyJ[\w-]{10,}\.[\w-]{10,}|sb_(secret|publishable)_|\bbearer\s+\S{10,}|sk-ant-|AIza[\w-]{20,}/i;

/** Keeps only the keys this action lists, with plain bounded values. Anything else (objects, arrays, long text, secrets) is dropped. */
export function sanitizeMeta(action: AuditAction, meta: Record<string, unknown> | undefined): AuditRowArgs['p_meta'] {
  const allowed: readonly string[] = AUDIT_ACTIONS[action];
  const clean: AuditRowArgs['p_meta'] = {};
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (!allowed.includes(key)) continue;
    if (typeof value === 'boolean') clean[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === 'string' && !SECRET_SHAPED.test(value)) clean[key] = value.slice(0, MAX_TEXT);
  }
  return clean;
}

export function buildAuditRow(event: AuditEventInput, context: AuditContext | undefined): AuditRowArgs {
  if (!(event.action in AUDIT_ACTIONS)) throw new Error(`unknown audit action: ${String(event.action)}`);
  const kind: AuditActorKind = event.actor?.kind ?? (context?.userId ? 'user' : 'system');
  const actorId = event.actor ? event.actor.userId : kind === 'user' ? context?.userId : undefined;
  return {
    p_org: event.organizationId ?? context?.organizationId ?? null,
    p_actor: actorId ?? null,
    p_actor_kind: kind,
    p_action: event.action,
    p_target_type: event.targetType?.slice(0, 40) ?? null,
    p_target_id: event.targetId?.slice(0, 80) ?? null,
    p_outcome: event.outcome ?? 'ok',
    p_ip: context?.ip ?? null,
    p_request_id: context?.requestId ?? null,
    p_meta: sanitizeMeta(event.action, event.meta),
  };
}
