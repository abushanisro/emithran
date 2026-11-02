import type { RequiredOrgRole } from './authz-policy';

/** organization_members.role, least to most privileged. An owner can do everything an admin can. */
export const ORG_ROLES = ['viewer', 'member', 'admin', 'owner'] as const;
export type OrgRoleName = (typeof ORG_ROLES)[number];

const rank = (role: string): number => (ORG_ROLES as readonly string[]).indexOf(role);

/**
 * The role a person acts with: the LOWEST of their active memberships, or null when they have none.
 *
 * Row-level security lets a request read and write every organization the person belongs to (current_user_org_ids()), and
 * nothing ties a request to one of them (X-Organization-Id is honoured only by the routes that resolve an organization, and even
 * there RLS still reaches the others). So the only role that is true for whatever a request touches is the lowest one. For the usual single
 * organization it is simply that membership's role. A membership with a role this code does not know counts as no role at all.
 */
export function effectiveOrgRole(roles: readonly string[]): OrgRoleName | null {
  if (roles.length === 0) return null;
  if (roles.some((r) => rank(r) < 0)) return null;
  return roles.reduce((low, r) => (rank(r) < rank(low) ? r : low)) as OrgRoleName;
}

export function satisfiesOrgRole(actual: OrgRoleName | null, required: RequiredOrgRole): boolean {
  return actual !== null && rank(actual) >= rank(required);
}
