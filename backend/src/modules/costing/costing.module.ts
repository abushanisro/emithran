import { Module } from '@nestjs/common';
import { CostAggregationService } from './cost-aggregation.service';
import { LocationComparisonService } from './location-comparison.service';
import { ExcelReportService } from './excel-report.service';
import { CostAnalysisController } from './cost-analysis.controller';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { ExchangeRateModule } from '../../common/exchange-rate/exchange-rate.module';
import { BOMItemsModule } from '../bom-items/bom-items.module';

@Module({
  // BOMItemsModule gives ExcelReportService access to BOMItemsService.getCostSummary —
  // the SAME live CAD-geometry-driven computation (calculation traces, feature
  // breakdowns, real machine selection) the Direct Process Costs panel renders on
  // screen, so the "verify the calculation" sheet can't drift from what's displayed.
  imports: [SupabaseModule, LoggerModule, ExchangeRateModule, BOMItemsModule],
  controllers: [CostAnalysisController],
  providers: [CostAggregationService, LocationComparisonService, ExcelReportService],
  exports: [CostAggregationService, LocationComparisonService, ExcelReportService],
})
export class CostingModule {}
