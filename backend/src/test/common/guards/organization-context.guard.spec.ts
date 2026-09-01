import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OrganizationContextGuard } from '../../../common/guards/organization-context.guard';
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
  return { getAdminClient: jest.fn().mockReturnValue({ from }) } as unknown as SupabaseService;
}

describe('OrganizationContextGuard', () => {
  it('rejects when there is no authenticated user on the request', async () => {
    const guard = new OrganizationContextGuard(makeSupabaseService([]));
    await expect(guard.canActivate(makeContext({ headers: {} }))).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the user has zero active organization memberships', async () => {
    const guard = new OrganizationContextGuard(makeSupabaseService([]));
    const request = { user: { id: 'orphan-user' }, headers: {} };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(ForbiddenException);
  });

  it('attaches organizationId when the user has exactly one active membership', async () => {
    const guard = new OrganizationContextGuard(makeSupabaseService([{ organization_id: 'org-1' }]));
    const request = { user: { id: 'user-1' }, headers: {} };
    const result = await guard.canActivate(makeContext(request));
    expect(result).toBe(true);
    expect(request).toHaveProperty('organizationId', 'org-1');
  });

  it('requires an X-Organization-Id header when the user has multiple memberships', async () => {
    const guard = new OrganizationContextGuard(
      makeSupabaseService([{ organization_id: 'org-1' }, { organization_id: 'org-2' }]),
    );
    const request = { user: { id: 'user-1' }, headers: {} };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(BadRequestException);
  });

  it('accepts the X-Organization-Id header when it matches a real membership', async () => {
    const guard = new OrganizationContextGuard(
      makeSupabaseService([{ organization_id: 'org-1' }, { organization_id: 'org-2' }]),
    );
    const request = { user: { id: 'user-1' }, headers: { 'x-organization-id': 'org-2' } };
    const result = await guard.canActivate(makeContext(request));
    expect(result).toBe(true);
    expect(request).toHaveProperty('organizationId', 'org-2');
  });

  it('rejects an X-Organization-Id header for an organization the user is not a member of', async () => {
    const guard = new OrganizationContextGuard(
      makeSupabaseService([{ organization_id: 'org-1' }, { organization_id: 'org-2' }]),
    );
    const request = { user: { id: 'user-1' }, headers: { 'x-organization-id': 'org-not-mine' } };
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(ForbiddenException);
  });
});
