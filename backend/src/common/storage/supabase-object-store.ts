import { SupabaseService } from '../supabase/supabase.service';
import { ObjectExistsError, type ObjectStore } from './object-store';

const isNotFound = (error: { message: string; statusCode?: string | number }) =>
  String(error.statusCode ?? '') === '404' || /not found/i.test(error.message);

/** Supabase Storage, used until the move to an S3-compatible bucket. Runs as the service role: callers check access themselves. */
export class SupabaseObjectStore implements ObjectStore {
  constructor(private readonly supabase: SupabaseService) {}

  private bucket(name: string) {
    return this.supabase.getPrivilegedClient('storage: object store for uploaded files, callers authorise by key').storage.from(name);
  }

  async put(bucket: string, key: string, body: Buffer, options: { contentType?: string; upsert?: boolean } = {}): Promise<void> {
    const { error } = await this.bucket(bucket).upload(key, body, { contentType: options.contentType ?? 'application/octet-stream', upsert: options.upsert ?? false });
    if (!error) return;
    if (/already exists|duplicate/i.test(error.message)) throw new ObjectExistsError(bucket, key);
    throw new Error(`storage put failed: ${error.message}`);
  }

  async get(bucket: string, key: string): Promise<Buffer | null> {
    const { data, error } = await this.bucket(bucket).download(key);
    if (error) {
      if (isNotFound(error as { message: string; statusCode?: string })) return null;
      throw new Error(`storage get failed: ${error.message}`);
    }
    return data ? Buffer.from(await data.arrayBuffer()) : null;
  }

  async remove(bucket: string, keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 100) {
      const { error } = await this.bucket(bucket).remove(keys.slice(i, i + 100));
      if (error) throw new Error(`storage remove failed: ${error.message}`);
    }
  }

  async list(bucket: string, prefix: string): Promise<string[]> {
    const { data, error } = await this.bucket(bucket).list(prefix, { limit: 1000 });
    if (error) throw new Error(`storage list failed: ${error.message}`);
    return (data ?? []).map((item) => item.name);
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    const slash = key.lastIndexOf('/');
    const { data, error } = await this.bucket(bucket).list(key.slice(0, Math.max(slash, 0)), { limit: 1, search: key.slice(slash + 1) });
    if (error) throw new Error(`storage exists failed: ${error.message}`);
    return (data ?? []).length > 0;
  }

  async signedGetUrl(bucket: string, key: string, ttlSeconds: number): Promise<string> {
    const { data, error } = await this.bucket(bucket).createSignedUrl(key, ttlSeconds);
    if (error || !data?.signedUrl) throw new Error(`storage signed url failed: ${error?.message ?? 'no url returned'}`);
    return data.signedUrl;
  }
}
