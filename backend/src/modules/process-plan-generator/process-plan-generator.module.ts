import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ProcessPlanGeneratorController } from './process-plan-generator.controller';

import { OrchestratorService } from './services/orchestrator.service';
import { RetrievalService } from './services/retrieval.service';
import { ScopeClassifierService } from './services/scope-classifier.service';
import { ReasoningService } from './services/reasoning.service';
import { ResolverService } from './services/resolver.service';
import { PersistenceService } from './services/persistence.service';
import { CreditMeterService } from './services/credit-meter.service';
import { DrawingExtractorService } from './services/drawing-extractor.service';
import { ExpandCandidatesTool } from './services/tools/expand-candidates.tool';

import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { BOMItemsModule } from '../bom-items/bom-items.module';

@Module({
  imports: [SupabaseModule, LoggerModule, ConfigModule, BOMItemsModule],
  controllers: [ProcessPlanGeneratorController],
  providers: [
    OrchestratorService,
    RetrievalService,
    ScopeClassifierService,
    ReasoningService,
    ResolverService,
    PersistenceService,
    CreditMeterService,
    DrawingExtractorService,
    ExpandCandidatesTool,
  ],
  exports: [OrchestratorService],
})
export class ProcessPlanGeneratorModule {}
