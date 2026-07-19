import { Module } from '@nestjs/common';
import { LHRService } from './lhr.service';
import { LHRController } from './lhr.controller';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { ExchangeRateModule } from '../../common/exchange-rate/exchange-rate.module';

@Module({
  imports: [SupabaseModule, LoggerModule, ExchangeRateModule],
  controllers: [LHRController],
  providers: [LHRService],
  exports: [LHRService],
})
export class LHRModule {}
