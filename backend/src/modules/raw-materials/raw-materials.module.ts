import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { RawMaterialsController } from './raw-materials.controller';
import { RawMaterialsService } from './raw-materials.service';
import { RawMaterialCostController } from './controllers/raw-material-cost.controller';
import { RawMaterialCostService } from './services/raw-material-cost.service';
import { MaterialStockPricesService } from './services/material-stock-prices.service';
import { PlasticRubberContainerService } from './containers/plastic-rubber-container.service';
import { FerrousContainerService } from './containers/ferrous-container.service';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { ExchangeRateModule } from '../../common/exchange-rate/exchange-rate.module';

@Module({
  imports: [
    SupabaseModule,
    LoggerModule,
    ExchangeRateModule,
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
      },
    }),
  ],
  controllers: [RawMaterialsController, RawMaterialCostController],
  providers: [
    RawMaterialsService, 
    RawMaterialCostService,
    MaterialStockPricesService,
    PlasticRubberContainerService,
    FerrousContainerService,
  ],
  exports: [
    RawMaterialsService, 
    RawMaterialCostService,
    PlasticRubberContainerService,
    FerrousContainerService,
  ],
})
export class RawMaterialsModule { }
