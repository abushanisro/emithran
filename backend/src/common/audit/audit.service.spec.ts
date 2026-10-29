import { ServiceUnavailableException } from '@nestjs/common';

import { runWithRequestAuth } from '../request-context/request-auth-context';
import { AuditService } from './audit.service';

function setup(rpcError: { message: string } | null = null, selectRow: unknown = { organization_id: 'org-7', name: 'Bracket' }) {
  const rpc = jest.fn(async () => ({ data: 1, error: rpcError }));
  const client = {
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: selectRow, error: null }) }) }) }),
  };
  return { service: new AuditService({ getPrivilegedClient: () => client } as never), rpc };
}
const asUser = <T>(fn: () => T) => runWithRequestAuth({ accessToken: 't', userId: 'user-1', organizationId: 'org-1', ip: '203.0.113.9', requestId: 'req-1' }, fn);

describe('AuditService', () => {
  it('writes through record_audit_event with the request\'s actor, organization, address and request id', async () => {
    const { service, rpc } = setup();
    await asUser(() => service.record({ action: 'bom.deleted', targetType: 'bom', targetId: 'b-1', meta: { name: 'Main' } }));
    expect(rpc).toHaveBeenCalledWith('record_audit_event', expect.objectContaining({
      p_org: 'org-1', p_actor: 'user-1', p_actor_kind: 'user', p_action: 'bom.deleted', p_ip: '203.0.113.9', p_request_id: 'req-1', p_meta: { name: 'Main' },
    }));
  });

  it('record() fails the request when the audit write fails', async () => {
    const { service } = setup({ message: 'db down' });
    await expect(asUser(() => service.record({ action: 'bom.deleted' }))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('recordBestEffort() never throws, whatever goes wrong', async () => {
    await expect(setup({ message: 'db down' }).service.recordBestEffort({ action: 'upload.created' })).resolves.toBeUndefined();
    await expect(setup().service.recordBestEffort({ action: 'nope.nope' as never })).resolves.toBeUndefined();
  });

  describe('audited()', () => {
    it('records a success after it happened, and returns the result', async () => {
      const { service, rpc } = setup();
      const result = await asUser(() => service.audited({ action: 'cost.applied', targetId: 'i-1' }, async () => 'applied'));
      expect(result).toBe('applied');
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc.mock.calls[0]).toEqual(['record_audit_event', expect.objectContaining({ p_outcome: 'ok' })]);
    });

    it('records a failure as an error and rethrows the original error, not an audit one', async () => {
      const { service, rpc } = setup();
      const boom = new Error('delete refused');
      await expect(asUser(() => service.audited({ action: 'bom_item.deleted' }, async () => { throw boom; }))).rejects.toBe(boom);
      expect(rpc.mock.calls[0]).toEqual(['record_audit_event', expect.objectContaining({ p_outcome: 'error' })]);
    });

    it('fails the request when a successful action cannot be recorded', async () => {
      const { service } = setup({ message: 'db down' });
      await expect(asUser(() => service.audited({ action: 'bom.deleted' }, async () => 'deleted'))).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('does not let a failing audit write hide the action\'s own error', async () => {
      const { service } = setup({ message: 'db down' });
      const boom = new Error('delete refused');
      await expect(asUser(() => service.audited({ action: 'bom.deleted' }, async () => { throw boom; }))).rejects.toBe(boom);
    });
  });

  it('records a repeated denial once a minute per actor and reason, not once per request', async () => {
    const { service, rpc } = setup();
    for (let i = 0; i < 20; i++) await service.recordDenied('no_membership', 'user-1', {});
    await service.recordDenied('other_reason', 'user-1', {});
    await service.recordDenied('no_membership', 'user-2', {});
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[0]).toEqual(['record_audit_event', expect.objectContaining({ p_action: 'auth.forbidden', p_outcome: 'denied', p_meta: { reason: 'no_membership' } })]);
  });

  it('describes a row (its organization and name), and is empty rather than throwing when it cannot', async () => {
    expect(await setup().service.describe('bom_items', 'i-1')).toEqual({ organizationId: 'org-7', name: 'Bracket' });
    expect(await setup(null, null).service.describe('boms', 'b-1')).toEqual({});
    expect(await setup(null, { organization_id: null, name: null }).service.describe('boms', 'b-1')).toEqual({});
  });
});
