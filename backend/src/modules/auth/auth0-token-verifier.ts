import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** A login that Auth0 vouches for. Nothing here is trusted until the signature, issuer, audience and lifetime have been checked. */
export interface VerifiedLogin {
  provider: 'auth0';
  /** Auth0's id for the person, e.g. auth0|abc123 or google-oauth2|1234. NOT a uuid. */
  sub: string;
  email?: string;
  emailVerified: boolean;
  /** Auth0's session id (the `sid` claim added by the post-login Action): what the idle-timeout tracks. */
  sessionId?: string;
  /** Seconds since the epoch. */
  expiresAt: number;
}

export type RejectionCode = 'malformed' | 'expired' | 'bad_signature' | 'wrong_issuer' | 'wrong_audience' | 'no_subject' | 'keys_unavailable';

/** `keys_unavailable` is our problem (Auth0's key set could not be fetched): a 503, not a verdict on the caller. Everything else is a 401. */
export class TokenRejected extends Error {
  constructor(readonly code: RejectionCode, message: string) {
    super(message);
  }
  get isServiceFailure(): boolean {
    return this.code === 'keys_unavailable';
  }
}

export interface Auth0VerifierOptions {
  /** e.g. https://emithran.eu.auth0.com/ (Auth0 issues tokens with the trailing slash). */
  issuer: string;
  /** The API identifier the tokens are meant for. */
  audience: string;
  /** Namespace of the custom claims the post-login Action adds, e.g. https://emithran.com/ (email, email_verified, sid). */
  claimNamespace: string;
  keys: JWTVerifyGetKey;
  clockToleranceSeconds?: number;
}

export class Auth0TokenVerifier {
  constructor(private readonly options: Auth0VerifierOptions) {}

  /** Production wiring: keys are fetched from the tenant's JWKS endpoint and cached; a rotated key is picked up automatically. */
  static forTenant(domain: string, audience: string, claimNamespace: string): Auth0TokenVerifier {
    const issuer = `https://${domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/`;
    const keys = createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`), { timeoutDuration: 5_000, cooldownDuration: 30_000, cacheMaxAge: 600_000 });
    return new Auth0TokenVerifier({ issuer, audience, claimNamespace, keys });
  }

  async verify(token: string): Promise<VerifiedLogin> {
    if (typeof token !== 'string' || token.split('.').length !== 3) throw new TokenRejected('malformed', 'not a JWT');
    try {
      // RS256 only: never the algorithm the token itself asks for (that is how "alg: none" and key-confusion attacks work).
      const { payload } = await jwtVerify(token, this.options.keys, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ['RS256'],
        clockTolerance: this.options.clockToleranceSeconds ?? 5,
      });
      if (typeof payload.sub !== 'string' || payload.sub === '') throw new TokenRejected('no_subject', 'the token names nobody');
      // Only the namespaced claims written by our post-login Action count; plain email/email_verified/sid are never read.
      const ns = this.options.claimNamespace;
      const email = payload[`${ns}email`] as unknown;
      const verified = payload[`${ns}email_verified`] as unknown;
      const sid = payload[`${ns}sid`] as unknown;
      return {
        provider: 'auth0',
        sub: payload.sub,
        ...(typeof email === 'string' && email !== '' && { email: email.toLowerCase() }),
        emailVerified: verified === true,
        ...(typeof sid === 'string' && sid !== '' && { sessionId: sid }),
        expiresAt: payload.exp ?? 0,
      };
    } catch (error) {
      throw translate(error);
    }
  }
}

function translate(error: unknown): TokenRejected {
  if (error instanceof TokenRejected) return error;
  if (error instanceof errors.JWTExpired) return new TokenRejected('expired', 'the token has expired');
  if (error instanceof errors.JWTClaimValidationFailed) {
    return error.claim === 'aud' ? new TokenRejected('wrong_audience', 'the token is for another API')
      : error.claim === 'iss' ? new TokenRejected('wrong_issuer', 'the token was issued by someone else')
      : new TokenRejected('malformed', `claim ${error.claim} is not acceptable`);
  }
  if (error instanceof errors.JWKSTimeout || (error instanceof Error && /fetch|network|ECONN|ENOTFOUND|socket/i.test(error.message) && !(error instanceof errors.JOSEError))) {
    return new TokenRejected('keys_unavailable', 'could not fetch the signing keys');
  }
  if (error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWSSignatureVerificationFailed || error instanceof errors.JOSEAlgNotAllowed || error instanceof errors.JWKSMultipleMatchingKeys) {
    return new TokenRejected('bad_signature', 'the signature does not match any key of the tenant');
  }
  return new TokenRejected('malformed', error instanceof Error ? error.message : 'unreadable token');
}
