import { Module } from '@nestjs/common';
import { MHRController } from './mhr.controller';
import { MHRService } from './mhr.service';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { ExchangeRateModule } from '../../common/exchange-rate/exchange-rate.module';
import { LHRModule } from '../lhr/lhr.module';

@Module({
  imports: [DatabaseModule, LoggerModule, ExchangeRateModule, LHRModule],
  controllers: [MHRController],
  providers: [MHRService],
  exports: [MHRService],
})
export class MHRModule {}
