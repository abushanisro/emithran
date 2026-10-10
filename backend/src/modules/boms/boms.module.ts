import { Module } from '@nestjs/common';
import { BOMsController } from './boms.controller';
import { BOMsService } from './boms.service';
import { BOMItemsModule } from '../bom-items/bom-items.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { ExchangeRateModule } from '../../common/exchange-rate/exchange-rate.module';

@Module({
  imports: [SupabaseModule, LoggerModule, ExchangeRateModule, BOMItemsModule],
  controllers: [BOMsController],
  providers: [BOMsService],
  exports: [BOMsService],
})
export class BOMsModule {}
