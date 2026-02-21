import { Module } from '@nestjs/common';
import { BOMsController } from './boms.controller';
import { BOMsService } from './boms.service';
import { BOMItemsModule } from '../bom-items/bom-items.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [SupabaseModule, LoggerModule, BOMItemsModule],
  controllers: [BOMsController],
  providers: [BOMsService],
  exports: [BOMsService],
})
export class BOMsModule {}
