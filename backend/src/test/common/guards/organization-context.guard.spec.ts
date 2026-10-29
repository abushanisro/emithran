import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OrganizationContextGuard } from '../../../common/guards/organization-context.guard';
import { type AuditService } from '../../../common/audit/audit.service';
import { type SupabaseService } from '../../../common/supabase/supabase.service';

function makeContext(request: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeSupabaseService(rows: Array<{ organization_id: string }>, error: any = null) {
  const eqStatus = jest.fn().mockResolvedValue({ data: rows, error });
  const eqUserId = jest.fn().mockReturnValue({ eq: eqStatus });
  const select = jest.fn().mockReturnValue({ eq: eqUserId });
  const from = jest.fn().mockReturnValue({ select });
  return { getPrivilegedClient: jest.fn().mockReturnValue({ from }) } as unknown as SupabaseService;
}

const audit = { recordDenied: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
const recordDenied = audit.recordDenied as jest.Mock;

describe('OrganizationContextGuard', () => {
  beforeEach(() => recordDenied.mockClear());

  it('records a denial for an account with no organization, and one naming the organization for a foreign request', async () => {
    const none = new OrganizationContextGuard(makeSupabaseService([]), audit);
    await expect(none.canActivate(makeContext({ user: { id: 'u1' }, headers: {} }))).rejects.toThrow(ForbiddenException);
    expect(recordDenied).toHaveBeenCalledWith('no_membership', 'u1', expect.objectContaining({ actor: { kind: 'user', userId: 'u1' } }));

    const foreign = new OrganizationContextGuard(makeSupabaseService([{ organization_id: 'org-a' }]), audit);
    await expect(
      foreign.canActivate(makeContext({ user: { id: 'u1' }, headers: { 'x-organization-id': 'org-b' } })),
    ).rejects.toThrow(ForbiddenException);
    expect(recordDenied).toHaveBeenCalledWith('not_a_member', 'u1', expect.objectContaining({ organizationId: 'org-b' }));
  });

  it('records nothing when access is allowed', async () => {
    const guard = new OrganizationContextGuard(makeSupabaseService([{ organization_id: 'org-a' }]), audit);
    await expect(guard.canActivate(makeContext({ user: { id: 'u1' }, headers: {} }))).resolves.toBe(true);
    expect(recordDenied).not.toHaveBeenCalled();
  });

  it('rejects when there is no authenticated user on the request', async () => {
    const guard = new OrganizationContextGuard(makeSupabaseService([]), audit);
    await expect(guard.canActivate(makeContext({ headers: {} }))).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the user has zero active organization memberships', async () => {
    const guard = new OrganizationContextGuard(makeSupabaseService([]), audit);
    const request = { user: { id: 'orphan-user' }, headers: {} };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(ForbiddenException);
  });

  it('attaches organizationId when the user has exactly one active membership', async () => {
    const guard = new OrganizationContextGuard(makeSupabaseService([{ organization_id: 'org-1' }]), audit);
    const request = { user: { id: 'user-1' }, headers: {} };
    const result = await guard.canActivate(makeContext(request));
    expect(result).toBe(true);
    expect(request).toHaveProperty('organizationId', 'org-1');
  });

  it('rejects an explicit foreign organization even for a single membership', async () => {
    const guard = new OrganizationContextGuard(makeSupabaseService([{ organization_id: 'org-1' }]), audit);
    const request = { user: { id: 'user-1' }, headers: { 'x-organization-id': 'org-2' } };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(ForbiddenException);
    expect(request).not.toHaveProperty('organizationId');
  });

  it('accepts an explicit matching organization for a single membership', async () => {
    const guard = new OrganizationContextGuard(makeSupabaseService([{ organization_id: 'org-1' }]), audit);
    const request = { user: { id: 'user-1' }, headers: { 'x-organization-id': 'org-1' } };
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request).toHaveProperty('organizationId', 'org-1');
  });

  it.each(['', ['org-1']])('rejects a malformed supplied organization header: %p', async (header) => {
    const guard = new OrganizationContextGuard(makeSupabaseService([{ organization_id: 'org-1' }]), audit);
    const request = { user: { id: 'user-1' }, headers: { 'x-organization-id': header } };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(BadRequestException);
    expect(request).not.toHaveProperty('organizationId');
  });

  it('fails closed if the organization lookup fails', async () => {
    const guard = new OrganizationContextGuard(makeSupabaseService([], { message: 'lookup failed' }), audit);
    const request = { user: { id: 'user-1' }, headers: {} };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(ForbiddenException);
    expect(request).not.toHaveProperty('organizationId');
  });

  it('requires an X-Organization-Id header when the user has multiple memberships', async () => {
    const guard = new OrganizationContextGuard(
      makeSupabaseService([{ organization_id: 'org-1' }, { organization_id: 'org-2' }]),
      audit,
    );
    const request = { user: { id: 'user-1' }, headers: {} };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(BadRequestException);
  });

  it('accepts the X-Organization-Id header when it matches a real membership', async () => {
    const guard = new OrganizationContextGuard(
      makeSupabaseService([{ organization_id: 'org-1' }, { organization_id: 'org-2' }]),
      audit,
    );
    const request = { user: { id: 'user-1' }, headers: { 'x-organization-id': 'org-2' } };
    const result = await guard.canActivate(makeContext(request));
    expect(result).toBe(true);
    expect(request).toHaveProperty('organizationId', 'org-2');
  });

  it('rejects an X-Organization-Id header for an organization the user is not a member of', async () => {
    const guard = new OrganizationContextGuard(
      makeSupabaseService([{ organization_id: 'org-1' }, { organization_id: 'org-2' }]),
      audit,
    );
    const request = { user: { id: 'user-1' }, headers: { 'x-organization-id': 'org-not-mine' } };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(ForbiddenException);
  });
});
