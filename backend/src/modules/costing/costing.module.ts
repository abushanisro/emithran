import { Module } from '@nestjs/common';
import { CostAggregationService } from './cost-aggregation.service';
import { CostAnalysisController } from './cost-analysis.controller';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [SupabaseModule, LoggerModule],
  controllers: [CostAnalysisController],
  providers: [CostAggregationService],
  exports: [CostAggregationService],
})
export class CostingModule {}
