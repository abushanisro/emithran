import { Injectable } from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The user id inside a token the guard has already verified (this reads it, it does not verify it). */
export function userIdFromVerifiedToken(accessToken: string | undefined): string | null {
  try {
    const sub = JSON.parse(Buffer.from(String(accessToken).split('.')[1] ?? '', 'base64url').toString('utf8')).sub;
    return typeof sub === 'string' && UUID.test(sub) ? sub : null;
  } catch {
    return null;
  }
}

/**
 * Who may read a stored BOM file. This is the rule storage row-level security used to apply (migration 008), now that the bytes are
 * read with the service role: the key is `<userId>/<projectId>/...`, the first part must be the caller, and the project must be one
 * the caller owns (read with the caller's own RLS-scoped client). Anything that is not exactly that is refused.
 */
@Injectable()
export class BomFileAccess {
  constructor(private readonly supabase: SupabaseService) {}

  async canRead(key: string, accessToken: string | undefined): Promise<boolean> {
    const userId = userIdFromVerifiedToken(accessToken);
    const [owner, projectId, ...rest] = key.split('/');
    if (!userId || owner !== userId || !projectId || !UUID.test(projectId) || rest.length === 0 || key.includes('..')) return false;
    const { data, error } = await this.supabase.getUserClient(accessToken).from('projects').select('id').eq('id', projectId).eq('user_id', userId).maybeSingle();
    return !error && !!data;
  }
}
