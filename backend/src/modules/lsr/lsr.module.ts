import { Module } from '@nestjs/common';
import { LSRService } from './lsr.service';
import { LSRController } from './lsr.controller';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { ExchangeRateModule } from '../../common/exchange-rate/exchange-rate.module';

@Module({
  imports: [SupabaseModule, LoggerModule, ExchangeRateModule],
  controllers: [LSRController],
  providers: [LSRService],
  exports: [LSRService],
})
export class LSRModule {}
