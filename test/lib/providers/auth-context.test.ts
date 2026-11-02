import { describe, expect, it } from 'vitest';

import { isOrganizationAdmin } from '@/lib/providers/auth-context';

// The Exchange Rates card shows its edit control only to those the API lets change budget rates (@OrgRole('admin')).
describe('isOrganizationAdmin', () => {
  it('is true for an admin and the owner only', () => {
    expect(isOrganizationAdmin({ id: 'u', organizationRole: 'admin' })).toBe(true);
    expect(isOrganizationAdmin({ id: 'u', organizationRole: 'owner' })).toBe(true);
    for (const organizationRole of ['member', 'viewer', null, undefined] as const) {
      expect(isOrganizationAdmin({ id: 'u', organizationRole })).toBe(false);
    }
    expect(isOrganizationAdmin(null)).toBe(false);
  });

  it('does not treat a platform administrator as an organization admin', () => {
    expect(isOrganizationAdmin({ id: 'u', organizationRole: 'member', platformAdmin: true })).toBe(false);
  });
});
