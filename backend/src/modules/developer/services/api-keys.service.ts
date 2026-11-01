import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';

import { AuditService } from '../../../common/audit/audit.service';
import { API_KEY_DEFAULT_DAYS, API_KEY_PREFIX, hashApiKey } from '../../../common/api-keys/api-key-scopes';
import { DatabaseService } from '../../../common/database/database.service';
import type { CreateApiKeyDto, ApiKeyResponseDto } from '../dto/api-key.dto';

const COLUMNS = 'id, name, key_prefix, scopes, organization_id, last_used_at, expires_at, created_at';
const DAY_MS = 24 * 60 * 60 * 1000;

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  organization_id: string;
  last_used_at: string | null;
  expires_at: string;
  created_at: string;
}

const toDto = (row: ApiKeyRow): ApiKeyResponseDto => ({
  id: row.id,
  name: row.name,
  keyPrefix: row.key_prefix,
  scopes: row.scopes,
  organizationId: row.organization_id,
  lastUsedAt: row.last_used_at,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
});

/**
 * Issues, lists and revokes a person's API keys, as that person (row-level security, migration 935): a key is bound to the
 * person's one organization, expires within a year, and can afterwards only be revoked.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateApiKeyDto, userId: string, organizationId: string, accessToken: string): Promise<ApiKeyResponseDto> {
    const rawKey = `${API_KEY_PREFIX}${randomBytes(16).toString('hex')}`;
    const expiresAt = new Date(Date.now() + (dto.expiresInDays ?? API_KEY_DEFAULT_DAYS) * DAY_MS).toISOString();

    const row = await this.audited(
      { action: 'api_key.created', targetType: 'api_key', organizationId, meta: { name: dto.name, scopes: dto.scopes.join(' '), expiresAt } },
      async () => {
        const { data, error } = await this.database
          .getClient(accessToken)
          .from('api_keys')
          .insert({
            user_id: userId,
            organization_id: organizationId,
            name: dto.name,
            key_hash: hashApiKey(rawKey),
            key_prefix: rawKey.substring(0, 12),
            scopes: dto.scopes,
            expires_at: expiresAt,
          })
          .select(COLUMNS)
          .single();
        // The insert policy refuses a key for anything but the person's one organization (42501).
        if (error?.code === '42501') {
          throw new ForbiddenException('API keys can only be issued by accounts that belong to exactly one organization');
        }
        if (error || !data) throw new Error(error?.message ?? 'API key not created');
        return data as ApiKeyRow;
      },
    );
    return { ...toDto(row), rawKey };
  }

  async findAll(userId: string, accessToken: string): Promise<ApiKeyResponseDto[]> {
    const { data, error } = await this.database
      .getClient(accessToken)
      .from('api_keys')
      .select(COLUMNS)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return ((data ?? []) as ApiKeyRow[]).map(toDto);
  }

  async revoke(id: string, userId: string, accessToken: string): Promise<void> {
    const client = this.database.getClient(accessToken);
    const { data, error } = await client
      .from('api_keys')
      .update({ revoked_at: new Date(Date.now()).toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .select('id, name, organization_id');

    if (error) throw new Error(error.message);
    const revoked = (data ?? []) as { id: string; name: string; organization_id: string | null }[];
    if (revoked.length === 0) throw new NotFoundException('API key not found');
    await this.audit.record({
      action: 'api_key.revoked',
      targetType: 'api_key',
      targetId: id,
      ...(revoked[0].organization_id ? { organizationId: revoked[0].organization_id } : {}),
      meta: { name: revoked[0].name },
    });
  }

  /** Records the creation once the row exists (so the event carries its id), and a failed attempt best-effort. */
  private async audited(
    event: { action: 'api_key.created'; targetType: string; organizationId: string; meta: Record<string, unknown> },
    run: () => Promise<ApiKeyRow>,
  ): Promise<ApiKeyRow> {
    let row: ApiKeyRow;
    try {
      row = await run();
    } catch (error) {
      await this.audit.recordBestEffort({ ...event, outcome: 'error' });
      throw error;
    }
    await this.audit.record({ ...event, targetId: row.id, outcome: 'ok' });
    return row;
  }
}
