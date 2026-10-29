#!/usr/bin/env ts-node
/**
 * Copies every stored file from Supabase Storage to the S3-compatible bucket, verifying each by hash. Read-only on Supabase.
 *
 *   npm run storage:copy                 dry run: what would be copied
 *   npm run storage:copy -- --apply      copy (safe to repeat; identical objects are skipped, nothing is ever deleted)
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_KEY (the source) and S3_* (the destination) from the environment / root .env. Exits non-zero
 * if any object failed, so a script or CI step cannot mistake a partial copy for a finished one.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { copyObjects } from '../src/common/storage/copy-objects';
import { S3ObjectStore } from '../src/common/storage/s3-object-store';
import { SupabaseObjectStore } from '../src/common/storage/supabase-object-store';

const BUCKETS = ['bom-files', 'electronics-uploads'];

function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
  return value;
}

/** Every file key under a prefix (folders have no id in Supabase's listing, so they are walked, not copied). */
async function walk(client: SupabaseClient, bucket: string, prefix = ''): Promise<string[]> {
  const keys: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`listing ${bucket}/${prefix}: ${error.message}`);
    for (const item of data ?? []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) keys.push(...(await walk(client, bucket, path)));
      else keys.push(path);
    }
    if ((data ?? []).length < 1000) return keys;
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const client = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_KEY'), { auth: { persistSession: false } });
  const source = new SupabaseObjectStore({ getPrivilegedClient: () => client } as never);
  const destination = new S3ObjectStore({
    bucket: need('S3_BUCKET'),
    region: need('S3_REGION'),
    endpoint: process.env.S3_ENDPOINT || undefined,
    accessKeyId: need('S3_ACCESS_KEY_ID'),
    secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });

  let failures = 0;
  for (const bucket of BUCKETS) {
    const keys = await walk(client, bucket);
    const report = await copyObjects({ source, destination, bucket, keys, apply });
    console.log(`${bucket}: ${keys.length} objects, ${report.copied.length} ${apply ? 'copied' : 'to copy'}, ${report.skipped.length} already there, ${report.failed.length} failed`);
    for (const f of report.failed) console.error(`  x ${bucket}/${f.key}: ${f.reason}`);
    failures += report.failed.length;
  }
  if (!apply) console.log('dry run: nothing was written (add --apply)');
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
