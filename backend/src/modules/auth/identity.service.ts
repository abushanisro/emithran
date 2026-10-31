import { ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { DatabaseService } from '../../common/database/database.service';
import { Auth0TokenVerifier, TokenRejected } from './auth0-token-verifier';
import { sessionKeyFromAuth0Sid } from './session-key';

/** Who a request is, in the terms the rest of the backend already uses. */
export interface AuthenticatedRequestUser {
  user: { id: string; email: string; role: 'authenticated' };
  /** The token PostgREST trusts for this user: it is what `request.accessToken` carries. */
  dbToken: string;
  /** The key of this login's inactivity clock (a uuid derived from Auth0's `sid`). Missing sid means no clock can run: rejected. */
  sessionId: string;
}

const DECISION_TTL_MS = 60_000;
const MAX_DECISIONS = 5_000;

/**
 * Turns an Auth0 access token into the internal user: verify locally, map `sub` to our uuid (linking by VERIFIED email only),
 * confirm the person is still authorised (invite-only), mint the database token. Unknown or unauthorised people get 403, a bad
 * token 401, an unreachable key set 503.
 */
@Injectable()
export class IdentityService {
  private readonly decisions = new Map<string, { userId: string; email: string; until: number }>();

  constructor(
    private readonly verifier: Auth0TokenVerifier,
    private readonly db: DatabaseService,
    private readonly now: () => number = Date.now,
  ) {}

  async authenticate(token: string): Promise<AuthenticatedRequestUser> {
    let login;
    try {
      login = await this.verifier.verify(token);
    } catch (error) {
      if (error instanceof TokenRejected && error.isServiceFailure) throw new ServiceUnavailableException('Sign-in is temporarily unavailable');
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Without a session id the inactivity timeout cannot be enforced, so the login is refused rather than let through unbounded.
    if (!login.sessionId) throw new UnauthorizedException('Invalid or expired token');
    const sessionId = sessionKeyFromAuth0Sid(login.sessionId);

    // A decision is only reused for the very same login facts, so a changed email or verification re-checks the database.
    const key = `${login.sub}|${login.email ?? ''}|${login.emailVerified}`;
    let decision = this.decisions.get(key);
    if (!decision || decision.until <= this.now()) {
      decision = { ...(await this.resolve(login)), until: this.now() + DECISION_TTL_MS };
      if (this.decisions.size >= MAX_DECISIONS) this.decisions.delete(this.decisions.keys().next().value as string);
      this.decisions.set(key, decision);
    }

    return {
      user: { id: decision.userId, email: decision.email, role: 'authenticated' },
      dbToken: this.db.mintDbUserToken(decision.userId, { email: decision.email, sessionId }),
      sessionId,
    };
  }

  private async resolve(login: { sub: string; email?: string; emailVerified: boolean }): Promise<{ userId: string; email: string }> {
    const admin = this.db.getPrivilegedClient('identity: map an Auth0 login to an internal user (service-only functions)');
    const linked = await admin.rpc('link_identity', {
      p_provider: 'auth0',
      p_sub: login.sub,
      p_email: login.email ?? null,
      p_email_verified: login.emailVerified,
    });
    if (linked.error) throw new ServiceUnavailableException('Sign-in is temporarily unavailable');
    const userId = linked.data as string | null;
    if (!userId) throw new ForbiddenException('This account has not been invited to eMithran');

    const allowed = await admin.rpc('identity_is_authorized', { p_user_id: userId });
    if (allowed.error) throw new ServiceUnavailableException('Sign-in is temporarily unavailable');
    if (allowed.data !== true) throw new ForbiddenException('This account has not been invited to eMithran');
    return { userId, email: login.email ?? '' };
  }
}
