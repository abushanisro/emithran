import { Module } from '@nestjs/common';
import { CalculatorsController } from './calculators.controller';
import { CalculatorsServiceV2 } from './calculators.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { Logger } from '../../common/logger/logger.service';
import { BOMItemsModule } from '../bom-items/bom-items.module';

@Module({
  imports: [BOMItemsModule],
  controllers: [CalculatorsController],
  providers: [CalculatorsServiceV2, SupabaseService, Logger],
  exports: [CalculatorsServiceV2],
})
export class CalculatorsModule {}
