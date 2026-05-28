import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BOMItemsController } from './bom-items.controller';
import { BOMItemsService } from './bom-items.service';
import { FileStorageService } from './services/file-storage.service';
import { StepConverterService } from './services/step-converter.service';
import { BomItemCostService } from './services/bom-item-cost.service';
import { CADAnalysisService } from './services/cad-analysis.service';
import { AutoFillService } from './services/auto-fill.service';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [SupabaseModule, LoggerModule, ConfigModule],
  controllers: [BOMItemsController],
  providers: [BOMItemsService, FileStorageService, StepConverterService, BomItemCostService, CADAnalysisService, AutoFillService],
  exports: [BOMItemsService, BomItemCostService, CADAnalysisService, AutoFillService],
})
export class BOMItemsModule {}
