import { ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { AuditService } from '../../common/audit/audit.service';
import { API_KEY_SCOPES, hashApiKey, type ApiKeyScope } from '../../common/api-keys/api-key-scopes';
import { DatabaseService } from '../../common/database/database.service';

/** The key a request was authenticated with: what the scope check and the rate limiter need. */
export interface RequestApiKey {
  id: string;
  organizationId: string;
  scopes: ApiKeyScope[];
}

export interface ApiKeyLogin {
  user: { id: string; email: string; role: 'authenticated' };
  /** The token PostgREST trusts: the key acts as its owner, so row-level security applies exactly as to that person. */
  dbToken: string;
  apiKey: RequestApiKey;
}

interface LookupRow {
  status: 'ok' | 'unknown' | 'revoked' | 'expired' | 'not_authorized' | 'organization';
  key_id: string | null;
  user_id: string | null;
  email: string | null;
  organization_id: string | null;
  scopes: string[] | null;
}

/**
 * Turns a raw API key into the request's identity. Every request looks the key up (no cache), so revoking a key, removing its
 * owner from the organization or withdrawing the owner's invitation takes effect on the next request. The lookup and its rules
 * live in the database function authenticate_api_key (migration 935). Refusals are audited, at most once a minute per key and reason.
 */
@Injectable()
export class ApiKeyAuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async authenticate(rawKey: string): Promise<ApiKeyLogin> {
    const { data, error } = await this.db
      .getPrivilegedClient('api keys: look up a key by its hash before any user context exists (service-only function)')
      .rpc('authenticate_api_key', { p_key_hash: hashApiKey(rawKey) });
    if (error) throw new ServiceUnavailableException('Sign-in is temporarily unavailable');
    const row = (Array.isArray(data) ? data[0] : data) as LookupRow | undefined;
    if (!row) throw new ServiceUnavailableException('Sign-in is temporarily unavailable');

    if (row.status !== 'ok') {
      await this.refused(row, rawKey);
      if (row.status === 'not_authorized') throw new ForbiddenException('The owner of this API key is no longer invited to eMithran');
      if (row.status === 'organization') {
        throw new ForbiddenException("API keys work only while their owner belongs to exactly one organization, the key's");
      }
      throw new UnauthorizedException('Invalid, revoked or expired API key');
    }
    if (!row.key_id || !row.user_id || !row.organization_id) throw new ServiceUnavailableException('Sign-in is temporarily unavailable');

    const email = row.email ?? '';
    return {
      user: { id: row.user_id, email, role: 'authenticated' },
      dbToken: this.db.mintDbUserToken(row.user_id, { email }),
      apiKey: {
        id: row.key_id,
        organizationId: row.organization_id,
        scopes: (row.scopes ?? []).filter((s): s is ApiKeyScope => (API_KEY_SCOPES as readonly string[]).includes(s)),
      },
    };
  }

  /** A scope the key lacks, or an endpoint that does not take keys: audited like any other refusal. */
  async refuseScope(apiKey: RequestApiKey, userId: string, reason: string): Promise<void> {
    await this.audit.recordDenied(reason, `api-key:${apiKey.id}`, {
      organizationId: apiKey.organizationId,
      actor: { kind: 'user', userId },
      targetType: 'api_key',
      targetId: apiKey.id,
    });
  }

  private refused(row: LookupRow, rawKey: string): Promise<void> {
    // An unknown key has no owner to name: it is keyed by the visible prefix only (never the key itself).
    const actorKey = row.key_id ? `api-key:${row.key_id}` : `api-key-prefix:${rawKey.slice(0, 12)}`;
    return this.audit.recordDenied(`api_key_${row.status}`, actorKey, {
      ...(row.organization_id ? { organizationId: row.organization_id } : {}),
      ...(row.user_id ? { actor: { kind: 'user' as const, userId: row.user_id } } : { actor: { kind: 'system' as const } }),
      ...(row.key_id ? { targetType: 'api_key', targetId: row.key_id } : {}),
    });
  }
}
