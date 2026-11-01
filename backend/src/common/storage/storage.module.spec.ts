import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { DatabaseService } from '../database/database.service';
import { OBJECT_STORE } from './object-store';
import { S3ObjectStore } from './s3-object-store';
import { StorageModule } from './storage.module';

const S3 = { S3_BUCKET: 'b', S3_REGION: 'r', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 's' };

const build = (env: Record<string, string>) =>
  Test.createTestingModule({ imports: [ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true, load: [() => env] }), StorageModule] })
    .overrideProvider(DatabaseService).useValue({})
    .compile();

describe('StorageModule', () => {
  it('stores files in the S3-compatible bucket', async () => {
    expect((await build(S3)).get(OBJECT_STORE)).toBeInstanceOf(S3ObjectStore);
  });

  it('refuses to start with a setting missing, instead of failing on the first upload', async () => {
    await expect(build({ S3_BUCKET: 'b' })).rejects.toThrow(/S3_REGION/);
  });
});
