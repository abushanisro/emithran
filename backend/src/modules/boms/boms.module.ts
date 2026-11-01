import { Module } from '@nestjs/common';
import { BOMsController } from './boms.controller';
import { BOMsService } from './boms.service';
import { BOMItemsModule } from '../bom-items/bom-items.module';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { ExchangeRateModule } from '../../common/exchange-rate/exchange-rate.module';

@Module({
  imports: [DatabaseModule, LoggerModule, ExchangeRateModule, BOMItemsModule],
  controllers: [BOMsController],
  providers: [BOMsService],
  exports: [BOMsService],
})
export class BOMsModule {}
