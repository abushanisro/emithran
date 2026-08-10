import { Module } from '@nestjs/common';
import { CostAggregationService } from './cost-aggregation.service';
import { LocationComparisonService } from './location-comparison.service';
import { CostAnalysisController } from './cost-analysis.controller';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { ExchangeRateModule } from '../../common/exchange-rate/exchange-rate.module';

@Module({
  imports: [SupabaseModule, LoggerModule, ExchangeRateModule],
  controllers: [CostAnalysisController],
  providers: [CostAggregationService, LocationComparisonService],
  exports: [CostAggregationService, LocationComparisonService],
})
export class CostingModule {}
