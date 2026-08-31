import { Module } from '@nestjs/common';
import { MHRController } from './mhr.controller';
import { MHRService } from './mhr.service';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { ExchangeRateModule } from '../../common/exchange-rate/exchange-rate.module';
import { LHRModule } from '../lhr/lhr.module';

@Module({
  imports: [SupabaseModule, LoggerModule, ExchangeRateModule, LHRModule],
  controllers: [MHRController],
  providers: [MHRService],
  exports: [MHRService],
})
export class MHRModule {}
