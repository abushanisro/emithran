import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../common/database/database.module';
import { BOMItemsModule } from '../bom-items/bom-items.module';
import { CadUploadRunner } from './cad-upload-runner';
import { CadUploadsController } from './cad-uploads.controller';
import { CadUploadsService } from './cad-uploads.service';

@Module({
  imports: [DatabaseModule, BOMItemsModule],
  controllers: [CadUploadsController],
  providers: [CadUploadsService, CadUploadRunner],
})
export class CadUploadsModule {}
