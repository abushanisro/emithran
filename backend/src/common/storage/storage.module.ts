import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SupabaseModule } from '../supabase/supabase.module';
import { SupabaseService } from '../supabase/supabase.service';
import { BomFileAccess } from './bom-file-access';
import { OBJECT_STORE, type ObjectStore } from './object-store';
import { S3ObjectStore } from './s3-object-store';
import { SupabaseObjectStore } from './supabase-object-store';

/** The one ObjectStore for the app, chosen by STORAGE_BACKEND (`supabase` today, `s3` for S3, R2 or MinIO). */
@Global()
@Module({
  imports: [SupabaseModule],
  providers: [
    BomFileAccess,
    {
      provide: OBJECT_STORE,
      inject: [ConfigService, SupabaseService],
      useFactory: (config: ConfigService, supabase: SupabaseService): ObjectStore => {
        if (config.get<string>('STORAGE_BACKEND') !== 's3') return new SupabaseObjectStore(supabase);
        return new S3ObjectStore({
          bucket: config.getOrThrow<string>('S3_BUCKET'),
          region: config.getOrThrow<string>('S3_REGION'),
          endpoint: config.get<string>('S3_ENDPOINT') || undefined,
          accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY_ID'),
          secretAccessKey: config.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
          forcePathStyle: config.get<string>('S3_FORCE_PATH_STYLE') === 'true',
        });
      },
    },
  ],
  exports: [OBJECT_STORE, BomFileAccess],
})
export class StorageModule {}
