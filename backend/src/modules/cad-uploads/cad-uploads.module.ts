import { Module } from '@nestjs/common';

import { SupabaseModule } from '../../common/supabase/supabase.module';
import { BOMItemsModule } from '../bom-items/bom-items.module';
import { CadUploadRunner } from './cad-upload-runner';
import { CadUploadsController } from './cad-uploads.controller';
import { CadUploadsService } from './cad-uploads.service';

@Module({
  imports: [SupabaseModule, BOMItemsModule],
  controllers: [CadUploadsController],
  providers: [CadUploadsService, CadUploadRunner],
})
export class CadUploadsModule {}
