import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BOMItemsController } from './bom-items.controller';
import { BOMItemsService } from './bom-items.service';
import { FileStorageService } from './services/file-storage.service';
import { StepConverterService } from './services/step-converter.service';
import { BomItemCostService } from './services/bom-item-cost.service';
import { CADAnalysisService } from './services/cad-analysis.service';
import { AutoFillService } from './services/auto-fill.service';
import { DFMScoringService } from './services/dfm-scoring.service';
import { MaterialIntelligenceService } from './services/material-intelligence.service';
import { RateResolutionService } from './services/rate-resolution.service';
import { CalculatorCatalogService } from './services/calculator-catalog.service';
import { MaterialResolutionService } from './services/material-resolution.service';
import { MachineDiscoveryService } from './services/machine-discovery.service';
import { BlankOptimizerService } from './costing/sheet-metal/machine/blank-optimizer.service';
import { SheetMetalLookupService } from './costing/sheet-metal/lookup/sheet-metal-lookup.service';
import { BomItemPullDirectionController } from './bom-item-pull-direction.controller';
import { RawMaterialsModule } from '../raw-materials/raw-materials.module';
import { MaterialCostSnapshotService } from './services/material-cost-snapshot.service';
import { ToolingCostSnapshotService } from './services/tooling-cost-snapshot.service';
import { ToolingCostsModule } from '../tooling-costs/tooling-costs.module';
import { CostTableService } from './services/cost-table.service';
import { ScenarioApplicationService } from './services/scenario-application.service';
import { RouteApplicationService } from './services/route-application.service';
import { AnalysisRunService } from './services/analysis-run.service';
import { BomItemReanalysisService } from './services/bom-item-reanalysis.service';
import { PlasticPullDirectionService } from './services/plastic-pull-direction.service';
import { PlasticCatalogOperationsService } from './costing/plastic-molding/operation/plastic-catalog-operations.service';
import { SheetMetalCatalogOperationsService } from './costing/sheet-metal/operation/catalog-operations.service';
import { HydroformingReferenceService } from './costing/hydroforming/hydroforming-reference.service';
import { MachiningLookupService } from './costing/machining/lookup/machining-lookup.service';
import { SecondaryProcessService } from './services/secondary-process.service';
import { PlasticReferenceService } from './costing/plastic-molding/lookup/plastic-reference.service';
import { PartSummaryService } from './services/part-summary.service';
import { PlasticDfmService } from './costing/plastic-molding/dfm/plastic-dfm.service';
import { MachiningDfmService } from './costing/machining/dfm/machining-dfm.service';
import { PlasticRouteComparisonService } from './costing/plastic-molding/plastic-route-comparison.service';
import { CastingReferenceService } from './costing/casting/casting-reference.service';
import { SandReferenceService } from './costing/casting/sand/sand-reference.service';
import { FeatureToleranceService } from './services/feature-tolerance.service';
import { PmiReviewService } from './services/pmi-review.service';
import { ToleranceReferenceService } from './costing/shared/tolerance/tolerance-reference.service';
import { NreService } from './services/nre.service';
import { AnalysisStatusService } from './services/analysis-status.service';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { ManufacturingKnowledgeModule } from '../manufacturing-knowledge/manufacturing-knowledge.module';
import { ManufacturingRulesModule } from '../manufacturing-rules/manufacturing-rules.module';
import { ExchangeRateModule } from '../../common/exchange-rate/exchange-rate.module';
import { MHRModule } from '../mhr/mhr.module';
import { SandCastingModule } from '../sand-casting/sand-casting.module';
import { SandMachineService } from './costing/casting/sand/sand-machine.service';
import { SandCatalogOperationsService } from './costing/casting/sand/sand-catalog-operations.service';
import { MachiningAllowanceService } from './costing/casting/machining-allowance.service';
import { SandCostService } from './costing/casting/sand/sand-cost.service';
import { SandVariableOverridesService } from './costing/casting/sand/sand-variable-overrides.service';
import { SandVariableOverridesController } from './sand-variable-overrides.controller';
import { CalculatorFieldOverridesController } from './calculator-field-overrides.controller';
import { CalculatorFieldOverridesService } from './services/calculator-field-overrides.service';
import { SandSnapshotsService } from './costing/casting/sand/sand-snapshots.service';
import { SandSnapshotReviewController, SandSnapshotsController } from './sand-snapshots.controller';

@Module({
  imports: [DatabaseModule, LoggerModule, ConfigModule, ManufacturingKnowledgeModule, ManufacturingRulesModule, ExchangeRateModule, MHRModule, SandCastingModule, RawMaterialsModule, ToolingCostsModule],
  controllers: [BOMItemsController, BomItemPullDirectionController, SandVariableOverridesController, CalculatorFieldOverridesController, SandSnapshotsController, SandSnapshotReviewController],
  providers: [BOMItemsService, FileStorageService, StepConverterService, BomItemCostService, CADAnalysisService, AutoFillService, DFMScoringService, MaterialIntelligenceService, BlankOptimizerService, SheetMetalLookupService, MachiningLookupService, RateResolutionService, CalculatorCatalogService, MaterialResolutionService, MachineDiscoveryService, SecondaryProcessService, NreService, PlasticReferenceService, PlasticDfmService, MachiningDfmService, PartSummaryService, PlasticRouteComparisonService, CastingReferenceService, SandReferenceService, SandMachineService, SandCostService, SandCatalogOperationsService, MachiningAllowanceService, SandVariableOverridesService, CalculatorFieldOverridesService, SandSnapshotsService, FeatureToleranceService, PmiReviewService, ToleranceReferenceService, SheetMetalCatalogOperationsService, PlasticCatalogOperationsService, PlasticPullDirectionService, BomItemReanalysisService, AnalysisRunService, RouteApplicationService, MaterialCostSnapshotService, ToolingCostSnapshotService, ScenarioApplicationService, CostTableService, HydroformingReferenceService, AnalysisStatusService],
  exports: [BOMItemsService, AnalysisStatusService, FileStorageService, BomItemCostService, CADAnalysisService, AutoFillService, SheetMetalLookupService, MachiningLookupService],
})
export class BOMItemsModule {}
