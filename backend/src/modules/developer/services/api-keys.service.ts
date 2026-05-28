import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type { CreateApiKeyDto, ApiKeyResponseDto } from '../dto/api-key.dto';

@Injectable()
export class ApiKeysService {
  constructor(private readonly supabase: SupabaseService) {}

  async create(dto: CreateApiKeyDto, userId: string, accessToken: string): Promise<ApiKeyResponseDto> {
    const rawKey = `mk_live_${randomBytes(16).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 12);

    const client = this.supabase.getClient(accessToken);
    const { data, error } = await client
      .from('api_keys')
      .insert({
        user_id: userId,
        name: dto.name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        scopes: dto.scopes ?? ['read'],
      })
      .select('id, name, key_prefix, scopes, last_used_at, expires_at, created_at')
      .single();

    if (error) throw new Error(error.message);

    return {
      id: data.id,
      name: data.name,
      keyPrefix: data.key_prefix,
      scopes: data.scopes,
      lastUsedAt: data.last_used_at,
      expiresAt: data.expires_at,
      createdAt: data.created_at,
      rawKey,
    };
  }

  async findAll(userId: string, accessToken: string): Promise<ApiKeyResponseDto[]> {
    const client = this.supabase.getClient(accessToken);
    const { data, error } = await client
      .from('api_keys')
      .select('id, name, key_prefix, scopes, last_used_at, expires_at, created_at')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    return (data ?? []).map((row: any) => ({
      id: row.id,
      name: row.name,
      keyPrefix: row.key_prefix,
      scopes: row.scopes,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));
  }

  async revoke(id: string, userId: string, accessToken: string): Promise<void> {
    const client = this.supabase.getClient(accessToken);
    const { error } = await client
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new NotFoundException('API key not found');
  }
}
