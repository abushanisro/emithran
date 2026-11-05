import { ForbiddenException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { DatabaseService } from '../../common/database/database.service';
import { Auth0TokenVerifier, TokenRejected, type VerifiedLogin } from './auth0-token-verifier';
import { sessionKeyFromAuth0Sid } from './session-key';

/** Who a request is, in the terms the rest of the backend already uses. */
export interface AuthenticatedRequestUser {
  user: { id: string; email: string; role: 'authenticated' };
  /** The token PostgREST trusts for this user: it is what `request.accessToken` carries. */
  dbToken: string;
  /** The key of this login's inactivity clock (a uuid derived from Auth0's `sid`). Missing sid means no clock can run: rejected. */
  sessionId: string;
}

const MAX_DECISIONS = 5_000;

export interface IdentityPolicy {
  /** Auth0 connections whose verified email may link a new login to an invited account (AUTH0_TRUSTED_CONNECTIONS, decision D3). */
  trustedConnections: readonly string[];
  /**
   * How long one "who is this and are they still authorised" answer is reused (AUTH_DECISION_CACHE_SECONDS). It bounds how long a
   * user removed from authorized_users keeps access; 0 asks the database on every request.
   */
  decisionTtlMs: number;
}

/**
 * Turns an Auth0 access token into the internal user: verify locally, map `sub` to our uuid (linking by VERIFIED email from a
 * TRUSTED connection only), confirm the person is still authorised (invite-only) and read their account email, mint the database
 * token. Unknown or unauthorised people get 403, a bad token 401, an unreachable key set 503.
 */
@Injectable()
export class IdentityService {
  private readonly decisions = new Map<string, { userId: string; email: string; until: number }>();
  private readonly logger = new Logger(IdentityService.name);
  private readonly trustedConnections: string[];

  constructor(
    private readonly verifier: Auth0TokenVerifier,
    private readonly db: DatabaseService,
    private readonly policy: IdentityPolicy,
    private readonly now: () => number = Date.now,
  ) {
    // Fails at boot, not at the first sign-in: an empty list would let nobody new in, a negative TTL would be meaningless.
    this.trustedConnections = policy.trustedConnections.map((c) => c.trim()).filter((c) => c !== '');
    if (this.trustedConnections.length === 0) throw new Error('IdentityService: at least one trusted Auth0 connection is required');
    if (!Number.isInteger(policy.decisionTtlMs) || policy.decisionTtlMs < 0) throw new Error('IdentityService: decisionTtlMs must be a whole number >= 0');
  }

  async authenticate(token: string): Promise<AuthenticatedRequestUser> {
    let login;
    try {
      login = await this.verifier.verify(token);
    } catch (error) {
      if (error instanceof TokenRejected && error.isServiceFailure) {
        // A 503 the person cannot explain: say here why (Auth0's signing keys could not be fetched in time).
        this.logger.error(`Sign-in 503: ${error.code}: ${error.message}`);
        throw new ServiceUnavailableException('Sign-in is temporarily unavailable');
      }
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Without a session id the inactivity timeout cannot be enforced, so the login is refused rather than let through unbounded.
    if (!login.sessionId) throw new UnauthorizedException('Invalid or expired token');
    const sessionId = sessionKeyFromAuth0Sid(login.sessionId);

    // A decision is only reused for the very same login facts, so a changed email, verification or connection re-checks the database.
    const key = `${login.sub}|${login.email ?? ''}|${login.emailVerified}|${login.connection ?? ''}`;
    let decision = this.decisions.get(key);
    if (!decision || decision.until <= this.now()) {
      decision = { ...(await this.resolve(login)), until: this.now() + this.policy.decisionTtlMs };
      if (this.policy.decisionTtlMs > 0) {
        if (this.decisions.size >= MAX_DECISIONS) this.decisions.delete(this.decisions.keys().next().value as string);
        this.decisions.set(key, decision);
      }
    }

    return {
      user: { id: decision.userId, email: decision.email, role: 'authenticated' },
      dbToken: this.db.mintDbUserToken(decision.userId, { email: decision.email, sessionId }),
      sessionId,
    };
  }

  private async resolve(login: VerifiedLogin): Promise<{ userId: string; email: string }> {
    const admin = this.db.getPrivilegedClient('identity: map an Auth0 login to an internal user (service-only functions)');
    // The database decides and records the decision (migration 947): a known sub resolves whatever its connection; a new one links
    // only by a verified email, from a connection in this allow-list, to an invited account that has no login yet.
    const linked = await admin.rpc('link_identity', {
      p_provider: 'auth0',
      p_sub: login.sub,
      p_email: login.email ?? null,
      p_email_verified: login.emailVerified,
      p_connection: login.connection ?? null,
      p_trusted_connections: this.trustedConnections,
    });
    if (linked.error) {
      this.logger.error(`Sign-in 503: link_identity failed: ${linked.error.code} ${linked.error.message}`);
      throw new ServiceUnavailableException('Sign-in is temporarily unavailable');
    }
    const userId = linked.data as string | null;
    if (!userId) throw new ForbiddenException('This account has not been invited to eMithran');

    // The allow-list check and the account's own email in one step (migration 938): the email bound into the request and the
    // database token is auth.users.email, never the token's claim, which an upstream change could make differ for a known sub.
    const account = await admin.rpc('identity_user_email', { p_user_id: userId });
    if (account.error) {
      this.logger.error(`Sign-in 503: identity_user_email failed: ${account.error.code} ${account.error.message}`);
      throw new ServiceUnavailableException('Sign-in is temporarily unavailable');
    }
    const email = account.data;
    if (typeof email !== 'string' || email === '') throw new ForbiddenException('This account has not been invited to eMithran');
    return { userId, email };
  }
}
