// Every event the audit trail can hold, and the only metadata keys each may carry. Adding an event is one line here plus the
// call that records it. The list is closed on purpose: an unknown action is a programming error, and metadata that is not
// listed is dropped, so a token, an email address or a file's contents cannot end up in a row by accident.
//
// What is audited: state changes and security decisions. Not per request (the request log has that), and not sign-ins
// (Auth0 keeps those in its tenant logs). Refused API keys are security decisions: they are recorded as auth.forbidden.
export const AUDIT_ACTIONS = {
  'upload.created': ['fileName', 'sizeBytes', 'duplicate'],
  'upload.completed': ['fileName', 'parts', 'items', 'durationMs'],
  'upload.failed': ['fileName', 'errorCode'],
  'file.deleted': ['fileType'],
  'bom.deleted': ['name'],
  'bom_item.deleted': ['name', 'itemType'],
  // written by the delete_bom_item_cascade() database function itself (migration 945), listed so the trail has one vocabulary
  'bom_item.force_deleted': ['name', 'lotMaterials', 'lots'],
  'fx_rate.changed': ['currency', 'previousRate', 'rate', 'reason', 'confirmed'],
  'cost.applied': ['route', 'custom'],
  'export.generated': ['kind', 'rows'],
  'rfq.sent': ['recipients'],
  'member.added': ['role'],
  'member.removed': ['role'],
  'member.role_changed': ['role', 'previousRole'],
  'auth.forbidden': ['reason'],
  'copilot_memory.changed': ['saved', 'removed', 'via'],
  'copilot_memory.cleared': ['via'],
} as const satisfies Record<string, readonly string[]>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;
