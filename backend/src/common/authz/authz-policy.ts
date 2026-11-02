import { SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Who may call a route. Every route declares exactly one, on the handler or on its controller (the handler's wins); a route with
 * none is refused by AuthzGuard and fails the route inventory test (src/test/common/authz/route-policies.spec.ts).
 *
 *   @Public()               no sign-in at all (health, root). Reused from common/decorators/public.decorator.
 *   @Authenticated()        any signed-in, invited person, whatever their organizations: their own session, profile, identity,
 *                           and creating their first organization.
 *   @OrgRole('viewer')      reads organization data. @OrgRole('member') edits project data. @OrgRole('admin') changes
 *                           organization-wide settings (budget FX rates, API keys, members, workspaces, forced deletes).
 *   @PlatformAdmin()        platform-wide actions, for the operators in platform_admins (migration 943) only.
 *
 * @ApiKeyScopes is not a policy: it additionally lets an API key call the route, and the key's owner still needs the route's role.
 */
export type RequiredOrgRole = 'viewer' | 'member' | 'admin';

export type AuthzPolicy =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'org'; role: RequiredOrgRole }
  | { kind: 'platform_admin' };

export const AUTHZ_POLICY_KEY = 'authzPolicy';

export const Authenticated = () => SetMetadata(AUTHZ_POLICY_KEY, { kind: 'authenticated' } satisfies AuthzPolicy);
export const OrgRole = (role: RequiredOrgRole) => SetMetadata(AUTHZ_POLICY_KEY, { kind: 'org', role } satisfies AuthzPolicy);
export const PlatformAdmin = () => SetMetadata(AUTHZ_POLICY_KEY, { kind: 'platform_admin' } satisfies AuthzPolicy);

/** The policy declared on a handler, else on its controller, else null (refused). */
type DecoratedTarget = Parameters<Reflector['get']>[1];

export function resolveAuthzPolicy(reflector: Reflector, handler: DecoratedTarget, controller: DecoratedTarget): AuthzPolicy | null {
  for (const target of [handler, controller]) {
    if (reflector.get<boolean>(IS_PUBLIC_KEY, target)) return { kind: 'public' };
    const policy = reflector.get<AuthzPolicy | undefined>(AUTHZ_POLICY_KEY, target);
    if (policy) return policy;
  }
  return null;
}

/** One line per policy, as the route inventory snapshot shows it. */
export function describeAuthzPolicy(policy: AuthzPolicy | null): string {
  if (!policy) return 'NONE';
  return policy.kind === 'org' ? `org:${policy.role}` : policy.kind;
}
