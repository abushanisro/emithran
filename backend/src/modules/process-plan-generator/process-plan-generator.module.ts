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
import { ExchangeRateService } from './services/exchange-rate.service';
import { ExpandCandidatesTool } from './services/tools/expand-candidates.tool';
import { FeatureGraphService } from './services/feature-graph.service';
import { RuleEngineService } from './services/rule-engine.service';
import { DeterministicPlannerService } from './services/deterministic-planner.service';
import { AlternativeRoutePlannerService } from './services/alternative-route-planner.service';

import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { BOMItemsModule } from '../bom-items/bom-items.module';
import { ManufacturingKnowledgeModule } from '../manufacturing-knowledge/manufacturing-knowledge.module';

@Module({
  imports: [SupabaseModule, LoggerModule, ConfigModule, BOMItemsModule, ManufacturingKnowledgeModule],
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
    ExchangeRateService,
    ExpandCandidatesTool,
    FeatureGraphService,
    RuleEngineService,
    DeterministicPlannerService,
    AlternativeRoutePlannerService,
  ],
  exports: [OrchestratorService],
})
export class ProcessPlanGeneratorModule {}
