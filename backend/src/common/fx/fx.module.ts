import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';
import { FxRateCacheService } from './fx-rate-cache.service';
import { FrankfurterFxProvider } from './frankfurter-fx.provider';

@Module({
  imports: [DatabaseModule, ExchangeRateModule],
  controllers: [FxController],
  providers: [FxService, FxRateCacheService, FrankfurterFxProvider],
  exports: [FxService],
})
export class FxModule {}
