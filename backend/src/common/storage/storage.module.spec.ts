import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { SupabaseService } from '../supabase/supabase.service';
import { OBJECT_STORE } from './object-store';
import { S3ObjectStore } from './s3-object-store';
import { StorageModule } from './storage.module';
import { SupabaseObjectStore } from './supabase-object-store';

const build = (env: Record<string, string>) =>
  Test.createTestingModule({ imports: [ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true, load: [() => env]}), StorageModule] })
    .overrideProvider(SupabaseService).useValue({})
    .compile();

describe('StorageModule', () => {
  it('uses Supabase Storage by default (no change for today\'s deployments)', async () => {
    expect((await build({})).get(OBJECT_STORE)).toBeInstanceOf(SupabaseObjectStore);
  });

  it('uses the S3-compatible store when STORAGE_BACKEND=s3', async () => {
    const env = { STORAGE_BACKEND: 's3', S3_BUCKET: 'b', S3_REGION: 'r', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's' };
    expect((await build(env)).get(OBJECT_STORE)).toBeInstanceOf(S3ObjectStore);
  });

  it('refuses to start with s3 selected but a setting missing, instead of failing on the first upload', async () => {
    await expect(build({ STORAGE_BACKEND: 's3', S3_BUCKET: 'b' })).rejects.toThrow(/S3_REGION/);
  });
});
