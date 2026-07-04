import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BOMItemsController } from './bom-items.controller';
import { BOMItemsService } from './bom-items.service';
import { FileStorageService } from './services/file-storage.service';
import { StepConverterService } from './services/step-converter.service';
import { BomItemCostService } from './services/bom-item-cost.service';
import { CADAnalysisService } from './services/cad-analysis.service';
import { AutoFillService } from './services/auto-fill.service';
import { SheetMetalFeatureExtractorService } from './services/sheet-metal-feature-extractor.service';
import { DFMScoringService } from './services/dfm-scoring.service';
import { MaterialIntelligenceService } from './services/material-intelligence.service';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { ManufacturingKnowledgeModule } from '../manufacturing-knowledge/manufacturing-knowledge.module';

@Module({
  imports: [SupabaseModule, LoggerModule, ConfigModule, ManufacturingKnowledgeModule],
  controllers: [BOMItemsController],
  providers: [BOMItemsService, FileStorageService, StepConverterService, BomItemCostService, CADAnalysisService, AutoFillService, SheetMetalFeatureExtractorService, DFMScoringService, MaterialIntelligenceService],
  exports: [BOMItemsService, BomItemCostService, CADAnalysisService, AutoFillService],
})
export class BOMItemsModule {}
