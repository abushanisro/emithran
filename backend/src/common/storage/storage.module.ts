import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DatabaseModule } from '../database/database.module';
import { BomFileAccess } from './bom-file-access';
import { OBJECT_STORE, type ObjectStore } from './object-store';
import { S3ObjectStore } from './s3-object-store';

/** The one ObjectStore for the app: an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, SeaweedFS). */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    BomFileAccess,
    {
      provide: OBJECT_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ObjectStore =>
        new S3ObjectStore({
          bucket: config.getOrThrow<string>('S3_BUCKET'),
          region: config.getOrThrow<string>('S3_REGION'),
          endpoint: config.get<string>('S3_ENDPOINT') || undefined,
          accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY_ID'),
          secretAccessKey: config.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
          forcePathStyle: config.get<string>('S3_FORCE_PATH_STYLE') === 'true',
        }),
    },
  ],
  exports: [OBJECT_STORE, BomFileAccess],
})
export class StorageModule {}
