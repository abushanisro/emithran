import { Injectable } from '@nestjs/common';

import { SupabaseService } from './supabase.service';

export interface DirectoryUser {
  id: string;
  email: string | null;
  fullName: string | null;
}

/**
 * Who is this person (email, display name)? The one place that knows how to ask: the Supabase admin API today, the service-only
 * `directory_*` functions (migration 932) on plain Postgres. Only the ids asked for are ever returned, never the whole directory.
 */
@Injectable()
export class UserDirectory {
  constructor(private readonly db: SupabaseService) {}

  async findByIds(ids: string[]): Promise<Map<string, DirectoryUser>> {
    const unique = [...new Set(ids.filter(Boolean))];
    const found = new Map<string, DirectoryUser>();
    if (unique.length === 0) return found;
    const admin = this.db.getPrivilegedClient('user-directory: read email and display name for the ids asked');
    if (this.db.usesPostgrest()) {
      const { data, error } = await admin.rpc('directory_users', { p_ids: unique });
      if (error) throw new Error(`user directory unavailable: ${error.message}`);
      for (const u of (data ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>) {
        found.set(u.id, { id: u.id, email: u.email, fullName: u.full_name });
      }
      return found;
    }
    // Supabase: one lookup per id (the admin API has no batch-by-id call; listUsers would read every user in the system).
    await Promise.all(unique.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      if (data?.user) found.set(id, { id, email: data.user.email ?? null, fullName: (data.user.user_metadata?.full_name as string | undefined) ?? null });
    }));
    return found;
  }

  async findIdByEmail(email: string): Promise<string | null> {
    const admin = this.db.getPrivilegedClient('user-directory: find a user id by email');
    if (this.db.usesPostgrest()) {
      const { data, error } = await admin.rpc('directory_find_by_email', { p_email: email });
      if (error) throw new Error(`user directory unavailable: ${error.message}`);
      return (data as string | null) ?? null;
    }
    const { data } = await admin.auth.admin.listUsers();
    return data?.users?.find((u: { id: string; email?: string }) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
  }

  async setFullName(id: string, fullName: string): Promise<void> {
    const admin = this.db.getPrivilegedClient('user-directory: keep a user display name in sync');
    if (this.db.usesPostgrest()) {
      const { error } = await admin.rpc('directory_set_full_name', { p_user_id: id, p_full_name: fullName });
      if (error) throw new Error(`user directory unavailable: ${error.message}`);
      return;
    }
    await admin.auth.admin.updateUserById(id, { user_metadata: { full_name: fullName } });
  }
}
