import { AUDIT_ACTIONS, type AuditAction } from './audit-actions';
import { buildAuditRow, sanitizeMeta } from './audit-row';

const context = { userId: 'user-1', organizationId: 'org-1', ip: '203.0.113.9', requestId: 'req-1' };

describe('buildAuditRow', () => {
  it('takes actor, organization, address and request id from the request', () => {
    expect(buildAuditRow({ action: 'bom_item.deleted', targetType: 'bom_item', targetId: 'item-1', meta: { name: 'Bracket' } }, context)).toEqual({
      p_org: 'org-1', p_actor: 'user-1', p_actor_kind: 'user', p_action: 'bom_item.deleted', p_target_type: 'bom_item', p_target_id: 'item-1',
      p_outcome: 'ok', p_ip: '203.0.113.9', p_request_id: 'req-1', p_meta: { name: 'Bracket' },
    });
  });

  it('records the system when there is no request, with the organization the caller names', () => {
    const row = buildAuditRow({ action: 'upload.completed', organizationId: 'org-9', actor: { kind: 'system' } }, undefined);
    expect(row).toMatchObject({ p_org: 'org-9', p_actor: null, p_actor_kind: 'system', p_ip: null, p_request_id: null });
  });

  it('lets an explicit organization (read from the row being changed) win over the request\'s', () => {
    expect(buildAuditRow({ action: 'bom.deleted', organizationId: 'org-2' }, context).p_org).toBe('org-2');
  });

  it('never attributes a system action to the request\'s user', () => {
    expect(buildAuditRow({ action: 'upload.failed', actor: { kind: 'system' } }, context)).toMatchObject({ p_actor: null, p_actor_kind: 'system' });
  });

  it('refuses an action that is not in the registry', () => {
    expect(() => buildAuditRow({ action: 'user.exploded' as AuditAction }, context)).toThrow(/unknown audit action/);
  });

  it('bounds the free-text fields', () => {
    const row = buildAuditRow({ action: 'file.deleted', targetType: 't'.repeat(100), targetId: 'i'.repeat(200) }, context);
    expect([row.p_target_type?.length, row.p_target_id?.length]).toEqual([40, 80]);
  });
});

describe('sanitizeMeta', () => {
  it('keeps only the keys the action lists', () => {
    expect(sanitizeMeta('upload.created', { fileName: 'a.zip', sizeBytes: 10, duplicate: false, email: 'a@b.c', body: 'x' })).toEqual({ fileName: 'a.zip', sizeBytes: 10, duplicate: false });
  });

  it('drops values that are not plain: objects, arrays, null, NaN', () => {
    expect(sanitizeMeta('upload.completed', { fileName: { nested: 1 }, parts: [1, 2], items: null, durationMs: NaN })).toEqual({});
  });

  it('truncates long text', () => {
    expect((sanitizeMeta('bom.deleted', { name: 'n'.repeat(500) }).name as string).length).toBe(120);
  });

  it.each([
    ['a JWT', ['eyJhbGciOiJIUzI1NiJ9', 'eyJyb2xlIjoic2VydmljZV9yb2xlIn0', 'signature'].join('.')], // built at run time: no token-shaped literal in source
    ['a Supabase secret key', ['sb', 'secret', 'abcdef123456'].join('_')], // built at run time, like the JWT above
    ['a bearer header', 'Bearer abcdefghijklmnop'],
    ['an Anthropic key', 'sk-ant-api03-xxxxxxxxxxxx'],
  ])('drops %s even under an allowed key', (_label, value) => {
    expect(sanitizeMeta('bom.deleted', { name: value })).toEqual({});
  });

  it('every registered action has at least one allowed key, and none is named like a credential', () => {
    for (const [action, keys] of Object.entries(AUDIT_ACTIONS)) {
      expect({ action, keys: keys.length > 0 }).toEqual({ action, keys: true });
      for (const key of keys) expect({ action, key, credentialLike: /token|secret|password|authorization|email|key/i.test(key) }).toEqual({ action, key, credentialLike: false });
    }
  });
});
