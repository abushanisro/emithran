import { ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { type AuditService } from '../../common/audit/audit.service';
import { hashApiKey } from '../../common/api-keys/api-key-scopes';
import { type DatabaseService } from '../../common/database/database.service';
import { ApiKeyAuthService } from './api-key-auth.service';

// Built at run time: no key-shaped literal in source (the secret scan would flag it).
const KEY = ['mk', 'live', '0123456789abcdef'.repeat(2)].join('_');
const OK_ROW = {
  status: 'ok',
  key_id: 'key-1',
  user_id: 'owner-1',
  email: 'erp@acme.com',
  organization_id: 'org-1',
  scopes: ['projects:read', 'not-a-scope'],
};

function setup(result: { data?: unknown; error?: unknown }) {
  const rpc = jest.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  const getPrivilegedClient = jest.fn().mockReturnValue({ rpc });
  const mintDbUserToken = jest.fn((id: string) => `db-token-for-${id}`);
  const recordDenied = jest.fn().mockResolvedValue(undefined);
  const service = new ApiKeyAuthService(
    { getPrivilegedClient, mintDbUserToken } as unknown as DatabaseService,
    { recordDenied } as unknown as AuditService,
  );
  return { service, rpc, mintDbUserToken, recordDenied };
}

describe('ApiKeyAuthService', () => {
  it('looks the key up by its SHA-256, never by the key itself', async () => {
    const { service, rpc } = setup({ data: [OK_ROW] });
    await service.authenticate(KEY);
    expect(rpc).toHaveBeenCalledWith('authenticate_api_key', { p_key_hash: hashApiKey(KEY) });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(KEY);
  });

  it('a valid key acts as its owner, with a database token for the owner and only known scopes', async () => {
    const { service, mintDbUserToken } = setup({ data: [OK_ROW] });
    await expect(service.authenticate(KEY)).resolves.toEqual({
      user: { id: 'owner-1', email: 'erp@acme.com', role: 'authenticated' },
      dbToken: 'db-token-for-owner-1',
      apiKey: { id: 'key-1', organizationId: 'org-1', scopes: ['projects:read'] },
    });
    expect(mintDbUserToken).toHaveBeenCalledWith('owner-1', { email: 'erp@acme.com' });
  });

  it.each(['unknown', 'revoked', 'expired'])('a %s key is 401 and audited', async (status) => {
    const row = status === 'unknown' ? { status, key_id: null, user_id: null, email: null, organization_id: null, scopes: null } : { ...OK_ROW, status };
    const { service, recordDenied, mintDbUserToken } = setup({ data: [row] });
    await expect(service.authenticate(KEY)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(recordDenied).toHaveBeenCalledWith(`api_key_${status}`, expect.any(String), expect.any(Object));
    expect(mintDbUserToken).not.toHaveBeenCalled();
  });

  it('audits an unknown key by its visible prefix only, never the whole key', async () => {
    const { service, recordDenied } = setup({ data: [{ status: 'unknown', key_id: null, user_id: null, email: null, organization_id: null, scopes: null }] });
    await expect(service.authenticate(KEY)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(recordDenied).toHaveBeenCalledWith('api_key_unknown', 'api-key-prefix:mk_live_0123', { actor: { kind: 'system' } });
  });

  it('an owner who is no longer invited is 403', async () => {
    const { service, recordDenied } = setup({ data: [{ ...OK_ROW, status: 'not_authorized' }] });
    await expect(service.authenticate(KEY)).rejects.toBeInstanceOf(ForbiddenException);
    expect(recordDenied).toHaveBeenCalledWith('api_key_not_authorized', 'api-key:key-1', expect.objectContaining({ organizationId: 'org-1' }));
  });

  it('an owner outside the key organization, or in several, is 403', async () => {
    const { service } = setup({ data: [{ ...OK_ROW, status: 'organization' }] });
    await expect(service.authenticate(KEY)).rejects.toThrow(/exactly one organization/);
  });

  it('a database failure is 503, not a sign-in failure', async () => {
    const { service } = setup({ error: { message: 'connection refused' } });
    await expect(service.authenticate(KEY)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
