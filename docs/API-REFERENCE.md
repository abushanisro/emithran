# eMithran API reference

Every route of the public API, grouped by resource. Generated from the reviewed route inventory by `backend/scripts/api-reference.sh`; do not edit by hand. Rules and conventions (envelope, errors, paging, caching, versioning): [API.md](API.md). A live, browsable version with request and response schemas is served by the backend at `/docs` where enabled.

**Base path:** `/api/v1`. **Auth:** `Authorization: Bearer <token>` on everything except `public`. **Errors:** RFC 9457 `application/problem+json`. **Success:** `{ "success": true, "data": …, "metadata": { "timestamp", "requestId" } }`.

**Access levels**

| Level | Who may call |
|---|---|
| `public` | Anyone, no sign-in |
| `authenticated` | Any signed-in user, no organization needed |
| `viewer` | Organization member with at least read access |
| `member` | Organization member who may edit project data |
| `admin` | Organization admin: org settings, rates and master data, forced or bulk deletes |
| `platform-admin` | eMithran staff only |

## (unversioned: liveness and health)

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/` | public | AppController.healthCheck |
| GET | `/api/health` | public | HealthController.check |
| GET | `/api/health/db` | platform-admin | HealthController.checkDatabase |
| GET | `/api/health/live` | public | HealthController.live |
| GET | `/api/health/ready` | public | HealthController.ready |
| GET | `/ping` | public | AppController.ping |

## audit-events

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/audit-events` | admin | AuditController.list |

## auth

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/auth/me` | authenticated | AuthController.me |
| GET | `/api/v1/auth/session` | authenticated | SessionController.status |
| POST | `/api/v1/auth/session/activity` | authenticated | SessionController.activity |

## balloon-diagrams

| Method | Path | Access | Handler |
|---|---|---|---|
| POST | `/api/v1/balloon-diagrams` | member | ProjectReportsController.createBalloonDiagram |
| DELETE | `/api/v1/balloon-diagrams/:diagramId/annotations/:annotationId` | member | ProjectReportsController.deleteAnnotation |
| PUT | `/api/v1/balloon-diagrams/:diagramId/annotations/:annotationId` | member | ProjectReportsController.updateAnnotation |
| DELETE | `/api/v1/balloon-diagrams/:id` | member | ProjectReportsController.deleteBalloonDiagram |
| GET | `/api/v1/balloon-diagrams/:id` | viewer | ProjectReportsController.getBalloonDiagram |
| PUT | `/api/v1/balloon-diagrams/:id` | member | ProjectReportsController.updateBalloonDiagram |
| POST | `/api/v1/balloon-diagrams/:id/annotations` | member | ProjectReportsController.addAnnotation |

## benchmark-sessions

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/benchmark-sessions` | viewer | BenchmarkSessionsController.findAll |
| POST | `/api/v1/benchmark-sessions` | member | BenchmarkSessionsController.create |
| DELETE | `/api/v1/benchmark-sessions/:id` | member | BenchmarkSessionsController.remove |
| GET | `/api/v1/benchmark-sessions/:id` | viewer | BenchmarkSessionsController.findOne |
| PUT | `/api/v1/benchmark-sessions/:id` | member | BenchmarkSessionsController.update |

## bom-items

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/bom-items` | viewer | BOMItemsController.findAll |
| POST | `/api/v1/bom-items` | member | BOMItemsController.create |
| DELETE | `/api/v1/bom-items/:bomItemId/process-specifications` | member | ProcessPlanningController.deleteSpecifications |
| GET | `/api/v1/bom-items/:bomItemId/process-specifications` | viewer | ProcessPlanningController.getSpecificationsByBomItem |
| PUT | `/api/v1/bom-items/:bomItemId/process-specifications` | member | ProcessPlanningController.updateSpecifications |
| DELETE | `/api/v1/bom-items/:id` | member | BOMItemsController.remove |
| GET | `/api/v1/bom-items/:id` | viewer | BOMItemsController.findOne |
| PUT | `/api/v1/bom-items/:id` | member | BOMItemsController.update |
| POST | `/api/v1/bom-items/:id/cad-analyses` | member | BOMItemsController.analyzeBOMItemCAD |
| GET | `/api/v1/bom-items/:id/cad-analysis` | viewer | BOMItemsController.getBOMItemCADAnalysis |
| GET | `/api/v1/bom-items/:id/cad-analysis/history` | viewer | BOMItemsController.getBOMItemAnalysisHistory |
| POST | `/api/v1/bom-items/:id/calculator-inputs` | member | BOMItemsController.resolveCalculatorInputs |
| GET | `/api/v1/bom-items/:id/candidate-routes` | viewer | BOMItemsController.getCandidateRoutes |
| POST | `/api/v1/bom-items/:id/cost-override` | member | BOMItemsController.setCostOverride |
| GET | `/api/v1/bom-items/:id/cost-summary` | viewer | BOMItemsController.getCostSummary |
| POST | `/api/v1/bom-items/:id/custom-route-applications` | member | BOMItemsController.applyCustomRoute |
| GET | `/api/v1/bom-items/:id/dependencies` | viewer | BOMItemsController.checkDeleteDependencies |
| GET | `/api/v1/bom-items/:id/dfm-scores` | viewer | BOMItemsController.getDFMScores |
| POST | `/api/v1/bom-items/:id/drawing-analyses` | member | BOMItemsController.analyzeDrawing |
| GET | `/api/v1/bom-items/:id/dxf-content` | viewer | BOMItemsController.getDxfContent |
| GET | `/api/v1/bom-items/:id/dxf-content-legacy` | viewer | BOMItemsController.getDxfContentLegacy |
| GET | `/api/v1/bom-items/:id/feature-tolerances` | viewer | BOMItemsController.getFeatureTolerances |
| PUT | `/api/v1/bom-items/:id/feature-tolerances/:featureKey` | member | BOMItemsController.setFeatureTolerances |
| GET | `/api/v1/bom-items/:id/file-url/:fileType` | viewer | BOMItemsController.getFileUrl |
| GET | `/api/v1/bom-items/:id/file-url/dxf` | viewer | BOMItemsController.getDxfFileUrl |
| POST | `/api/v1/bom-items/:id/files` | member | BOMItemsController.uploadFiles |
| DELETE | `/api/v1/bom-items/:id/force` | admin | BOMItemsController.forceRemove |
| GET | `/api/v1/bom-items/:id/gdt-analysis` | viewer | BOMItemsController.getGdtAnalysis |
| POST | `/api/v1/bom-items/:id/machine-override` | member | BOMItemsController.setMachineOverride |
| POST | `/api/v1/bom-items/:id/machining-calculator-inputs` | member | BOMItemsController.resolveMachiningCalculatorInputs |
| GET | `/api/v1/bom-items/:id/machining-need` | viewer | BOMItemsController.getMachiningNeed |
| GET | `/api/v1/bom-items/:id/manufacturing-implications` | viewer | BOMItemsController.getManufacturingImplications |
| GET | `/api/v1/bom-items/:id/material-intelligence` | viewer | BOMItemsController.getMaterialIntelligence |
| GET | `/api/v1/bom-items/:id/material-strengths` | viewer | BOMItemsController.getMaterialStrengths |
| GET | `/api/v1/bom-items/:id/nre` | viewer | BOMItemsController.getNre |
| GET | `/api/v1/bom-items/:id/pmi-records` | viewer | BOMItemsController.getPmiRecords |
| POST | `/api/v1/bom-items/:id/pmi-records/review` | member | BOMItemsController.reviewPmiRecord |
| POST | `/api/v1/bom-items/:id/reanalyze` | member | BOMItemsController.reanalyze |
| POST | `/api/v1/bom-items/:id/route-applications` | member | BOMItemsController.applyRoute |
| GET | `/api/v1/bom-items/:id/route-comparison` | viewer | BOMItemsController.getRouteComparison |
| PATCH | `/api/v1/bom-items/:id/scenario-overrides` | member | BOMItemsController.patchScenarioOverrides |
| GET | `/api/v1/bom-items/:id/secondary-processes` | viewer | BOMItemsController.getSecondaryProcesses |
| POST | `/api/v1/bom-items/:id/step-conversions` | member | BOMItemsController.convertStepFile |
| PATCH | `/api/v1/bom-items/:id/thumbnail` | member | BOMItemsController.updateThumbnail |
| PUT | `/api/v1/bom-items/:id/tolerance-policy` | member | BOMItemsController.setTolerancePolicy |
| GET | `/api/v1/bom-items/:id/true-nest` | viewer | BOMItemsController.getTrueNest |
| GET | `/api/v1/bom-items/analysis-version` | viewer | BOMItemsController.getAnalysisVersion |
| POST | `/api/v1/bom-items/autofill-analyses` | member | BOMItemsController.analyzeForAutoFill |
| POST | `/api/v1/bom-items/autofill-analysis-jobs` | member | BOMItemsController.startAnalyzeForAutoFill |
| GET | `/api/v1/bom-items/autofill-analysis-jobs/:jobId` | viewer | BOMItemsController.getAnalyzeForAutoFillStatus |
| POST | `/api/v1/bom-items/cad-analysis-batches` | member | BOMItemsController.batchAnalyzeCAD |
| GET | `/api/v1/bom-items/material-density` | viewer | BOMItemsController.getMaterialDensity |
| POST | `/api/v1/bom-items/measure-for-autofill` | member | BOMItemsController.measureForAutoFill |
| POST | `/api/v1/bom-items/process-step-file` | member | BOMItemsController.processStepFile |
| PATCH | `/api/v1/bom-items/reorder` | member | BOMItemsController.updateSortOrder |

## boms

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/boms` | viewer | BOMsController.findAll |
| POST | `/api/v1/boms` | member | BOMsController.create |
| DELETE | `/api/v1/boms/:id` | member | BOMsController.remove |
| GET | `/api/v1/boms/:id` | viewer | BOMsController.findOne |
| PUT | `/api/v1/boms/:id` | member | BOMsController.update |
| POST | `/api/v1/boms/:id/cost-recalculations` | member | BOMsController.recalculateAllCosts |
| GET | `/api/v1/boms/:id/cost-report` | viewer | BOMsController.getCostReport |
| GET | `/api/v1/boms/:id/items` | viewer | BOMsController.getBomItems |

## cad-uploads

| Method | Path | Access | Handler |
|---|---|---|---|
| POST | `/api/v1/cad-uploads` | member | CadUploadsController.create |
| GET | `/api/v1/cad-uploads/:id` | viewer | CadUploadsController.get |

## calculators

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/calculators` | viewer | CalculatorsController.findAll |
| POST | `/api/v1/calculators` | admin | CalculatorsController.create |
| DELETE | `/api/v1/calculators/:id` | admin | CalculatorsController.remove |
| GET | `/api/v1/calculators/:id` | viewer | CalculatorsController.findOne |
| PUT | `/api/v1/calculators/:id` | admin | CalculatorsController.update |
| POST | `/api/v1/calculators/:id/execute` | member | CalculatorsController.execute |
| GET | `/api/v1/calculators/:id/fields` | viewer | CalculatorsController.getFields |
| POST | `/api/v1/calculators/:id/fields` | admin | CalculatorsController.createField |
| DELETE | `/api/v1/calculators/:id/fields/:fieldId` | admin | CalculatorsController.removeField |
| PUT | `/api/v1/calculators/:id/fields/:fieldId` | admin | CalculatorsController.updateField |
| GET | `/api/v1/calculators/:id/formulas` | viewer | CalculatorsController.getFormulas |
| POST | `/api/v1/calculators/:id/formulas` | admin | CalculatorsController.createFormula |
| DELETE | `/api/v1/calculators/:id/formulas/:formulaId` | admin | CalculatorsController.removeFormula |
| PUT | `/api/v1/calculators/:id/formulas/:formulaId` | admin | CalculatorsController.updateFormula |
| POST | `/api/v1/calculators/sheet-metal/lookups` | member | CalculatorsController.sheetMetalLookup |

## child-part-costs

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/child-part-costs` | viewer | ChildPartCostController.findAll |
| POST | `/api/v1/child-part-costs` | member | ChildPartCostController.create |
| DELETE | `/api/v1/child-part-costs/:id` | member | ChildPartCostController.remove |
| GET | `/api/v1/child-part-costs/:id` | viewer | ChildPartCostController.findOne |
| PUT | `/api/v1/child-part-costs/:id` | member | ChildPartCostController.update |
| POST | `/api/v1/child-part-costs/calculations` | member | ChildPartCostController.calculateOnly |

## copilot

| Method | Path | Access | Handler |
|---|---|---|---|
| POST | `/api/v1/copilot/chat` | member | CopilotController.chat |
| DELETE | `/api/v1/copilot/memory` | member | CopilotController.clearMemory |
| GET | `/api/v1/copilot/memory` | viewer | CopilotController.getMemory |
| POST | `/api/v1/copilot/memory-proposals/:id/confirm` | member | CopilotController.confirmMemoryProposal |
| DELETE | `/api/v1/copilot/memory/preferences` | member | CopilotController.deleteMemoryItem |

## cost-analysis

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/cost-analysis/bom-item/:bomItemId` | viewer | CostAnalysisController.getBomItemCost |
| GET | `/api/v1/cost-analysis/bom-item/:bomItemId/excel` | viewer | CostAnalysisController.downloadBomItemExcel |
| GET | `/api/v1/cost-analysis/bom-item/:bomItemId/location-comparison` | viewer | CostAnalysisController.getLocationComparison |

## currencies

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/currencies` | viewer | FxController.listCurrencies |

## electronic-coverage-reports

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/electronic-coverage-reports` | viewer | ElectronicsController.coverage |

## electronic-designs

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/electronic-designs` | viewer | ElectronicsController.listDesigns |
| POST | `/api/v1/electronic-designs` | member | ElectronicsController.createDesign |
| DELETE | `/api/v1/electronic-designs/:designId` | member | ElectronicsController.deleteDesign |
| GET | `/api/v1/electronic-designs/:designId` | viewer | ElectronicsController.getDesign |
| DELETE | `/api/v1/electronic-designs/:designId/revisions/:revisionId` | member | ElectronicsController.deleteRevision |

## electronic-file-formats

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/electronic-file-formats` | viewer | ElectronicsController.formats |

## electronic-jobs

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/electronic-jobs/:jobId` | viewer | ElectronicsController.job |

## electronic-quotes

| Method | Path | Access | Handler |
|---|---|---|---|
| POST | `/api/v1/electronic-quotes` | member | ElectronicsController.quote |

## electronic-results

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/electronic-results/:resultId` | viewer | ElectronicsController.result |

## electronic-uploads

| Method | Path | Access | Handler |
|---|---|---|---|
| POST | `/api/v1/electronic-uploads` | member | ElectronicsController.upload |
| GET | `/api/v1/electronic-uploads/:uploadId/features` | viewer | ElectronicsController.features |
| GET | `/api/v1/electronic-uploads/:uploadId/latest-result` | viewer | ElectronicsController.latestResult |
| GET | `/api/v1/electronic-uploads/:uploadId/preview` | viewer | ElectronicsController.preview |
| POST | `/api/v1/electronic-uploads/:uploadId/reparse` | member | ElectronicsController.reparseUpload |
| GET | `/api/v1/electronic-uploads/:uploadId/scenario-options` | viewer | ElectronicsController.scenarioOptions |
| GET | `/api/v1/electronic-uploads/:uploadId/thumbnail` | viewer | ElectronicsController.thumbnail |

## exchange-rates

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/exchange-rates` | viewer | FxController.listExchangeRates |
| PUT | `/api/v1/exchange-rates/:currency` | admin | FxController.setExchangeRate |
| GET | `/api/v1/exchange-rates/effective` | viewer | FxController.getRate |
| POST | `/api/v1/exchange-rates/refresh` | platform-admin | FxController.refresh |

## factories

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/factories` | viewer | FxController.listFactories |

## factory-currencies

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/factory-currencies` | viewer | FxController.getFactoryCurrency |

## feature-process-mappings

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/feature-process-mappings` | viewer | ManufacturingKnowledgeController.getFeatureProcessMapping |
| POST | `/api/v1/feature-process-mappings` | member | ManufacturingKnowledgeController.createFeatureProcessMapping |

## labour-rates

| Method | Path | Access | Handler |
|---|---|---|---|
| DELETE | `/api/v1/labour-rates` | admin | LHRController.removeAll |
| GET | `/api/v1/labour-rates` | viewer | LHRController.findAll |
| POST | `/api/v1/labour-rates` | admin | LHRController.create |
| DELETE | `/api/v1/labour-rates/:id` | admin | LHRController.remove |
| GET | `/api/v1/labour-rates/:id` | viewer | LHRController.findOne |
| PUT | `/api/v1/labour-rates/:id` | admin | LHRController.update |
| POST | `/api/v1/labour-rates/batches` | admin | LHRController.bulkCreate |
| GET | `/api/v1/labour-rates/benchmark` | viewer | LHRController.getBenchmarkRates |
| GET | `/api/v1/labour-rates/code/:labourCode` | viewer | LHRController.findByLabourCode |
| GET | `/api/v1/labour-rates/count` | viewer | LHRController.count |
| GET | `/api/v1/labour-rates/effective-rate` | viewer | LHRController.getEffectiveRate |
| POST | `/api/v1/labour-rates/imports` | admin | LHRController.importFromExcel |

## machine-capabilities

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/machine-capabilities` | viewer | ManufacturingKnowledgeController.getMachineCapabilities |
| POST | `/api/v1/machine-capabilities` | member | ManufacturingKnowledgeController.createMachineCapability |

## machine-rates

| Method | Path | Access | Handler |
|---|---|---|---|
| DELETE | `/api/v1/machine-rates` | admin | MHRController.removeAll |
| GET | `/api/v1/machine-rates` | viewer | MHRController.findAll |
| POST | `/api/v1/machine-rates` | admin | MHRController.create |
| DELETE | `/api/v1/machine-rates/:id` | admin | MHRController.remove |
| GET | `/api/v1/machine-rates/:id` | viewer | MHRController.findOne |
| PUT | `/api/v1/machine-rates/:id` | admin | MHRController.update |
| GET | `/api/v1/machine-rates/:id/reference-detail` | viewer | MHRController.getReferenceDetail |
| GET | `/api/v1/machine-rates/benchmark` | viewer | MHRController.getBenchmarkRates |
| GET | `/api/v1/machine-rates/categories` | viewer | MHRController.getCategories |
| GET | `/api/v1/machine-rates/categories-with-class` | viewer | MHRController.getCategoriesWithClass |
| GET | `/api/v1/machine-rates/currencies` | viewer | MHRController.getCurrencies |
| POST | `/api/v1/machine-rates/imports` | admin | MHRController.importFromExcel |
| GET | `/api/v1/machine-rates/locations` | viewer | MHRController.getLocations |
| GET | `/api/v1/machine-rates/manufacturer-countries` | viewer | MHRController.getManufacturerCountries |
| GET | `/api/v1/machine-rates/picker` | viewer | MHRController.findPickerRows |
| GET | `/api/v1/machine-rates/process-groups` | viewer | MHRController.getProcessGroups |
| GET | `/api/v1/machine-rates/wage-grades` | viewer | MHRController.getWageGrades |

## organizations

| Method | Path | Access | Handler |
|---|---|---|---|
| POST | `/api/v1/organizations` | authenticated | OrganizationsController.create |
| DELETE | `/api/v1/organizations/:id` | admin | OrganizationsController.remove |
| PATCH | `/api/v1/organizations/:id` | admin | OrganizationsController.update |
| GET | `/api/v1/organizations/:id/members` | viewer | OrganizationsController.members |
| POST | `/api/v1/organizations/:id/members` | admin | OrganizationsController.invite |
| DELETE | `/api/v1/organizations/:id/members/:memberId` | admin | OrganizationsController.removeMember |
| GET | `/api/v1/organizations/:id/workspaces` | viewer | OrganizationsController.workspaces |
| POST | `/api/v1/organizations/:id/workspaces` | admin | OrganizationsController.createWorkspace |
| DELETE | `/api/v1/organizations/:id/workspaces/:workspaceId` | admin | OrganizationsController.removeWorkspace |
| PATCH | `/api/v1/organizations/:id/workspaces/:workspaceId` | admin | OrganizationsController.updateWorkspace |
| GET | `/api/v1/organizations/mine` | authenticated | OrganizationsController.mine |

## packaging-logistics-costs

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/packaging-logistics-costs` | viewer | PackagingLogisticsCostController.findAll |
| POST | `/api/v1/packaging-logistics-costs` | member | PackagingLogisticsCostController.create |
| DELETE | `/api/v1/packaging-logistics-costs/:id` | member | PackagingLogisticsCostController.delete |
| GET | `/api/v1/packaging-logistics-costs/:id` | viewer | PackagingLogisticsCostController.findOne |
| PUT | `/api/v1/packaging-logistics-costs/:id` | member | PackagingLogisticsCostController.update |
| GET | `/api/v1/packaging-logistics-costs/freight-rate-benchmarks` | viewer | PackagingLogisticsCostController.getFreightRateBenchmarks |
| POST | `/api/v1/packaging-logistics-costs/totals` | member | PackagingLogisticsCostController.getBulkTotalCosts |

## pdf-documents

| Method | Path | Access | Handler |
|---|---|---|---|
| POST | `/api/v1/pdf-documents/dimension-extractions` | member | PDFProcessingController.extractDimensionsFromPDF |
| POST | `/api/v1/pdf-documents/validations` | member | PDFProcessingController.validatePDF |

## process-costs

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/process-costs` | viewer | ProcessCostController.findAll |
| POST | `/api/v1/process-costs` | member | ProcessCostController.create |
| DELETE | `/api/v1/process-costs/:id` | member | ProcessCostController.delete |
| GET | `/api/v1/process-costs/:id` | viewer | ProcessCostController.findOne |
| PUT | `/api/v1/process-costs/:id` | member | ProcessCostController.update |
| POST | `/api/v1/process-costs/calculations` | member | ProcessCostController.calculateOnly |
| POST | `/api/v1/process-costs/totals` | member | ProcessCostController.getBulkTotalCosts |

## process-specifications

| Method | Path | Access | Handler |
|---|---|---|---|
| POST | `/api/v1/process-specifications` | member | ProcessPlanningController.upsertSpecifications |

## processes

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/processes` | viewer | ProcessesController.findAll |
| POST | `/api/v1/processes` | admin | ProcessesController.create |
| DELETE | `/api/v1/processes/:id` | admin | ProcessesController.remove |
| GET | `/api/v1/processes/:id` | viewer | ProcessesController.findOne |
| PUT | `/api/v1/processes/:id` | admin | ProcessesController.update |
| GET | `/api/v1/processes/:processId/reference-tables` | viewer | ProcessesController.getReferenceTables |
| POST | `/api/v1/processes/:processId/reference-tables` | admin | ProcessesController.createReferenceTable |
| GET | `/api/v1/processes/by-vendor/:vendorId` | viewer | ProcessesController.getProcessesByVendor |
| DELETE | `/api/v1/processes/calculator-mappings` | admin | ProcessesController.clearAllCalculatorMappings |
| GET | `/api/v1/processes/calculator-mappings` | viewer | ProcessesController.getProcessCalculatorMappings |
| POST | `/api/v1/processes/calculator-mappings` | admin | ProcessesController.createProcessCalculatorMapping |
| DELETE | `/api/v1/processes/calculator-mappings/:id` | admin | ProcessesController.deleteProcessCalculatorMapping |
| GET | `/api/v1/processes/calculator-mappings/:id` | viewer | ProcessesController.getProcessCalculatorMapping |
| PUT | `/api/v1/processes/calculator-mappings/:id` | admin | ProcessesController.updateProcessCalculatorMapping |
| POST | `/api/v1/processes/calculator-mappings/imports` | admin | ProcessesController.importCalculatorMappings |
| GET | `/api/v1/processes/deslag-allowance-table` | viewer | ProcessesController.getDeslagAllowanceTable |
| GET | `/api/v1/processes/machining-lookup-tables/by-name/:table` | viewer | ProcessesController.getMachiningLookupTableByName |
| GET | `/api/v1/processes/reference-domains` | viewer | ProcessesController.getReferenceDomains |
| GET | `/api/v1/processes/reference-lookup` | viewer | ProcessesController.getReferenceLookup |
| DELETE | `/api/v1/processes/reference-tables/:tableId` | admin | ProcessesController.deleteReferenceTable |
| GET | `/api/v1/processes/reference-tables/:tableId` | viewer | ProcessesController.getReferenceTable |
| PUT | `/api/v1/processes/reference-tables/:tableId` | admin | ProcessesController.updateReferenceTable |
| POST | `/api/v1/processes/reference-tables/:tableId/row-batches` | admin | ProcessesController.bulkUpdateTableRows |
| POST | `/api/v1/processes/reference-tables/:tableId/rows` | admin | ProcessesController.createTableRow |
| DELETE | `/api/v1/processes/reference-tables/rows/:rowId` | admin | ProcessesController.deleteTableRow |
| PUT | `/api/v1/processes/reference-tables/rows/:rowId` | admin | ProcessesController.updateTableRow |
| PUT | `/api/v1/processes/sm-lookup-table-rows/:table/:id` | admin | ProcessesController.updateSmLookupRow |
| GET | `/api/v1/processes/sm-lookup-tables` | viewer | ProcessesController.getSmLookupTables |
| GET | `/api/v1/processes/sm-lookup-tables/by-name/:table` | viewer | ProcessesController.getSmLookupTableByName |
| GET | `/api/v1/processes/stroke-rate-factor-table` | viewer | ProcessesController.getStrokeRateFactorTable |
| GET | `/api/v1/processes/turret-machines-table` | viewer | ProcessesController.getTurretMachinesTable |
| GET | `/api/v1/processes/variables` | viewer | ProcessesController.getDomainVariables |
| GET | `/api/v1/processes/vendors-by-process/:processId` | viewer | ProcessesController.getVendorsByProcess |
| GET | `/api/v1/processes/waterjet-machines-table` | viewer | ProcessesController.getWaterjetMachinesTable |

## procured-parts-costs

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/procured-parts-costs` | viewer | ProcuredPartsCostController.findAll |
| POST | `/api/v1/procured-parts-costs` | member | ProcuredPartsCostController.create |
| DELETE | `/api/v1/procured-parts-costs/:id` | member | ProcuredPartsCostController.delete |
| GET | `/api/v1/procured-parts-costs/:id` | viewer | ProcuredPartsCostController.findOne |
| PUT | `/api/v1/procured-parts-costs/:id` | member | ProcuredPartsCostController.update |
| POST | `/api/v1/procured-parts-costs/totals` | member | ProcuredPartsCostController.getBulkTotalCosts |

## production-alerts

| Method | Path | Access | Handler |
|---|---|---|---|
| PUT | `/api/v1/production-alerts/:alertId/resolve` | member | ProductionPlanningController.resolveAlert |

## production-entries

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/production-entries` | viewer | ProductionEntryController.findAll |
| POST | `/api/v1/production-entries` | member | ProductionEntryController.create |
| DELETE | `/api/v1/production-entries/:id` | member | ProductionEntryController.remove |
| GET | `/api/v1/production-entries/:id` | viewer | ProductionEntryController.findOne |
| PUT | `/api/v1/production-entries/:id` | member | ProductionPlanningController.updateDailyProductionEntry |
| GET | `/api/v1/production-entries/weekly-summary/:lotId` | viewer | ProductionEntryController.getWeeklySummary |

## production-lots

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/production-lots` | viewer | ProductionPlanningController.getProductionLots |
| POST | `/api/v1/production-lots` | member | ProductionPlanningController.createProductionLot |
| DELETE | `/api/v1/production-lots/:id` | member | ProductionPlanningController.deleteProductionLot |
| GET | `/api/v1/production-lots/:id` | viewer | ProductionPlanningController.getProductionLotById |
| PUT | `/api/v1/production-lots/:id` | member | ProductionPlanningController.updateProductionLot |
| GET | `/api/v1/production-lots/:id/bom-items` | viewer | ProductionPlanningController.getProductionLotBomItems |
| POST | `/api/v1/production-lots/:id/cleanup-materials` | member | ProductionPlanningController.cleanupLotMaterials |
| POST | `/api/v1/production-lots/:id/status-updates` | member | ProductionPlanningController.updateLotStatusByProgress |
| GET | `/api/v1/production-lots/:id/vendor-assignments` | viewer | ProductionPlanningController.getProductionLotVendorAssignments |
| POST | `/api/v1/production-lots/:id/vendor-assignments` | member | ProductionPlanningController.createVendorAssignment |
| DELETE | `/api/v1/production-lots/:id/vendor-assignments/:assignmentId` | member | ProductionPlanningController.deleteVendorAssignment |
| PATCH | `/api/v1/production-lots/:id/vendor-assignments/:assignmentId` | member | ProductionPlanningController.updateVendorAssignment |
| GET | `/api/v1/production-lots/:lotId/alerts` | viewer | ProductionPlanningController.getProductionAlerts |
| POST | `/api/v1/production-lots/:lotId/alerts` | member | ProductionPlanningController.createManualAlert |
| GET | `/api/v1/production-lots/:lotId/gantt` | viewer | ProductionPlanningController.getGanttData |
| GET | `/api/v1/production-lots/:lotId/integrated-dashboard` | viewer | ProductionPlanningController.getIntegratedDashboard |
| GET | `/api/v1/production-lots/:lotId/materials` | viewer | ProductionPlanningController.getLotMaterials |
| POST | `/api/v1/production-lots/:lotId/materials` | member | ProductionPlanningController.initializeLotMaterials |
| GET | `/api/v1/production-lots/:lotId/monitoring` | viewer | ProductionPlanningController.getProductionMonitoring |
| GET | `/api/v1/production-lots/:lotId/processes` | viewer | ProductionPlanningController.getProductionProcesses |
| POST | `/api/v1/production-lots/:lotId/processes` | member | ProductionPlanningController.createProductionProcess |
| GET | `/api/v1/production-lots/:lotId/production-entries` | viewer | ProductionPlanningController.getDailyProductionEntries |
| POST | `/api/v1/production-lots/:lotId/production-entries` | member | ProductionPlanningController.createDailyProductionEntry |
| GET | `/api/v1/production-lots/:lotId/summary` | viewer | ProductionPlanningController.getProductionSummary |
| GET | `/api/v1/production-lots/dashboard` | viewer | ProductionPlanningController.getDashboardData |

## production-materials

| Method | Path | Access | Handler |
|---|---|---|---|
| PUT | `/api/v1/production-materials/:materialId/status` | member | ProductionPlanningController.updateMaterialStatus |

## production-process-templates

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/production-process-templates` | viewer | ProductionPlanningController.getDefaultProcessTemplates |
| POST | `/api/v1/production-process-templates` | member | ProductionPlanningController.createProcessTemplate |

## production-processes

| Method | Path | Access | Handler |
|---|---|---|---|
| DELETE | `/api/v1/production-processes/:id` | member | ProductionPlanningController.deleteProductionProcess |
| GET | `/api/v1/production-processes/:id` | viewer | ProductionProcessController.getProductionProcess |
| PUT | `/api/v1/production-processes/:id` | member | ProductionPlanningController.updateProductionProcess |
| GET | `/api/v1/production-processes/:processId/subtasks` | viewer | ProductionPlanningController.getProcessSubtasks |
| POST | `/api/v1/production-processes/:processId/subtasks` | member | ProductionPlanningController.createProcessSubtask |
| GET | `/api/v1/production-processes/:processId/vendor-assignments` | viewer | ProductionProcessController.getProcessVendorAssignments |
| POST | `/api/v1/production-processes/:processId/vendor-assignments` | member | ProductionProcessController.assignVendorToProcess |
| GET | `/api/v1/production-processes/lot/:lotId` | viewer | ProductionProcessController.getProcessesByLot |
| PUT | `/api/v1/production-processes/vendor-assignments/:assignmentId` | member | ProductionProcessController.updateVendorAssignment |

## production-subtasks

| Method | Path | Access | Handler |
|---|---|---|---|
| DELETE | `/api/v1/production-subtasks/:id` | member | ProductionPlanningController.deleteProcessSubtask |
| PUT | `/api/v1/production-subtasks/:id` | member | ProductionPlanningController.updateProcessSubtask |

## profile

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/profile` | authenticated | ProfileController.getProfile |
| PATCH | `/api/v1/profile` | authenticated | ProfileController.updateProfile |
| POST | `/api/v1/profile/avatar` | authenticated | ProfileController.uploadAvatar |

## project-reports

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/project-reports/projects/:projectId/balloon-diagrams` | viewer | ProjectReportsController.getBalloonDiagrams |
| GET | `/api/v1/project-reports/projects/:projectId/full-report` | viewer | ProjectReportsController.generateCompleteReport |
| GET | `/api/v1/project-reports/projects/:projectId/inspection-report` | viewer | ProjectReportsController.generateInspectionReport |

## projects

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/projects` | viewer | ProjectsController.findAll |
| POST | `/api/v1/projects` | member | ProjectsController.create |
| DELETE | `/api/v1/projects/:id` | member | ProjectsController.remove |
| GET | `/api/v1/projects/:id` | viewer | ProjectsController.findOne |
| PUT | `/api/v1/projects/:id` | member | ProjectsController.update |
| GET | `/api/v1/projects/:id/cost-analysis` | viewer | ProjectsController.getCostAnalysis |
| GET | `/api/v1/projects/:id/team` | viewer | ProjectsController.getTeamMembers |
| POST | `/api/v1/projects/:id/team` | member | ProjectsController.addTeamMember |
| DELETE | `/api/v1/projects/:id/team/:memberId` | member | ProjectsController.removeTeamMember |
| PUT | `/api/v1/projects/:id/team/:memberId` | member | ProjectsController.updateTeamMember |

## quality-inspections

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/quality-inspections` | viewer | QualityControlController.getInspections |
| POST | `/api/v1/quality-inspections` | member | QualityControlController.createInspection |
| DELETE | `/api/v1/quality-inspections/:id` | member | QualityControlController.deleteInspection |
| GET | `/api/v1/quality-inspections/:id` | viewer | QualityControlController.getInspectionById |
| PUT | `/api/v1/quality-inspections/:id` | member | QualityControlController.updateInspection |
| POST | `/api/v1/quality-inspections/:id/approve` | member | QualityControlController.approveInspection |
| DELETE | `/api/v1/quality-inspections/:id/detailed-report` | member | QualityControlController.deleteDetailedInspectionReport |
| GET | `/api/v1/quality-inspections/:id/detailed-report` | viewer | QualityControlController.getDetailedInspectionReport |
| POST | `/api/v1/quality-inspections/:id/detailed-report` | member | QualityControlController.saveDetailedInspectionReport |
| POST | `/api/v1/quality-inspections/:id/reject` | member | QualityControlController.rejectInspection |
| POST | `/api/v1/quality-inspections/:id/reset` | member | QualityControlController.resetInspectionStatus |

## raw-material-costs

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/raw-material-costs` | viewer | RawMaterialCostController.findAll |
| POST | `/api/v1/raw-material-costs` | member | RawMaterialCostController.create |
| DELETE | `/api/v1/raw-material-costs/:id` | member | RawMaterialCostController.delete |
| GET | `/api/v1/raw-material-costs/:id` | viewer | RawMaterialCostController.findOne |
| PUT | `/api/v1/raw-material-costs/:id` | member | RawMaterialCostController.update |
| POST | `/api/v1/raw-material-costs/totals` | member | RawMaterialCostController.getBulkTotalCosts |

## raw-materials

| Method | Path | Access | Handler |
|---|---|---|---|
| DELETE | `/api/v1/raw-materials` | admin | RawMaterialsController.removeAll |
| GET | `/api/v1/raw-materials` | viewer | RawMaterialsController.findAll |
| POST | `/api/v1/raw-materials` | admin | RawMaterialsController.create |
| DELETE | `/api/v1/raw-materials/:id` | admin | RawMaterialsController.remove |
| GET | `/api/v1/raw-materials/:id` | viewer | RawMaterialsController.findOne |
| PUT | `/api/v1/raw-materials/:id` | admin | RawMaterialsController.update |
| GET | `/api/v1/raw-materials/:id/editor` | viewer | RawMaterialsController.getEditor |
| PUT | `/api/v1/raw-materials/:id/editor` | admin | RawMaterialsController.saveEditor |
| GET | `/api/v1/raw-materials/:id/properties` | viewer | RawMaterialsController.getProperties |
| GET | `/api/v1/raw-materials/:id/stock-prices` | viewer | RawMaterialsController.getMaterialStockPrices |
| GET | `/api/v1/raw-materials/aliases` | viewer | RawMaterialsController.getAliases |
| POST | `/api/v1/raw-materials/classes` | member | RawMaterialsController.materialClasses |
| GET | `/api/v1/raw-materials/enhanced` | viewer | RawMaterialsController.getEnhancedMaterials |
| GET | `/api/v1/raw-materials/filter-options` | viewer | RawMaterialsController.getFilterOptions |
| GET | `/api/v1/raw-materials/grouped` | viewer | RawMaterialsController.getGrouped |
| POST | `/api/v1/raw-materials/imports` | admin | RawMaterialsController.uploadExcel |
| GET | `/api/v1/raw-materials/process-material-groups` | viewer | RawMaterialsController.getProcessMaterialGroups |
| GET | `/api/v1/raw-materials/stock-forms` | viewer | RawMaterialsController.stockForms |
| GET | `/api/v1/raw-materials/stock-prices` | viewer | RawMaterialsController.getStockPrices |

## remarks

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/remarks` | viewer | RemarkController.getRemarks |
| POST | `/api/v1/remarks` | member | RemarkController.createRemark |
| DELETE | `/api/v1/remarks/:id` | member | RemarkController.deleteRemark |
| GET | `/api/v1/remarks/:id` | viewer | RemarkController.getRemarkById |
| PUT | `/api/v1/remarks/:id` | member | RemarkController.updateRemark |
| GET | `/api/v1/remarks/:remarkId/comments` | viewer | RemarkController.getCommentsByRemark |
| POST | `/api/v1/remarks/:remarkId/comments` | member | RemarkController.createComment |
| DELETE | `/api/v1/remarks/comments/:commentId` | member | RemarkController.deleteComment |
| PUT | `/api/v1/remarks/comments/:commentId` | member | RemarkController.updateComment |
| GET | `/api/v1/remarks/lot/:lotId` | viewer | RemarkController.getRemarksByLot |

## rfq-trackings

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/rfq-trackings` | viewer | RfqTrackingController.getTracking |
| POST | `/api/v1/rfq-trackings` | member | RfqTrackingController.createTracking |
| DELETE | `/api/v1/rfq-trackings/:id` | member | RfqTrackingController.deleteTracking |
| GET | `/api/v1/rfq-trackings/:id` | viewer | RfqTrackingController.getTrackingById |
| PATCH | `/api/v1/rfq-trackings/:id/status` | member | RfqTrackingController.updateTrackingStatus |
| GET | `/api/v1/rfq-trackings/stats` | viewer | RfqTrackingController.getTrackingStats |

## rfqs

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/rfqs` | viewer | RfqController.findAll |
| POST | `/api/v1/rfqs` | member | RfqController.create |
| GET | `/api/v1/rfqs/:id` | viewer | RfqController.findOne |
| PATCH | `/api/v1/rfqs/:id/close` | member | RfqController.closeRfq |
| PATCH | `/api/v1/rfqs/:id/send` | member | RfqController.sendRfq |

## routing-rules

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/routing-rules` | viewer | ManufacturingKnowledgeController.getRoutingRules |
| POST | `/api/v1/routing-rules` | member | ManufacturingKnowledgeController.createRoutingRule |

## routing-templates

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/routing-templates` | viewer | ManufacturingKnowledgeController.getTemplates |

## supplier-evaluation-groups

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/supplier-evaluation-groups` | viewer | SupplierEvaluationGroupsController.findAll |
| POST | `/api/v1/supplier-evaluation-groups` | member | SupplierEvaluationGroupsController.create |
| DELETE | `/api/v1/supplier-evaluation-groups/:id` | member | SupplierEvaluationGroupsController.remove |
| GET | `/api/v1/supplier-evaluation-groups/:id` | viewer | SupplierEvaluationGroupsController.findOne |
| PATCH | `/api/v1/supplier-evaluation-groups/:id` | member | SupplierEvaluationGroupsController.update |
| GET | `/api/v1/supplier-evaluation-groups/:id/deletion-check` | viewer | SupplierEvaluationGroupsController.validateDeletion |
| GET | `/api/v1/supplier-evaluation-groups/project/:projectId` | viewer | SupplierEvaluationGroupsController.findByProject |

## supplier-evaluations

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/supplier-evaluations` | viewer | SupplierEvaluationController.findAll |
| POST | `/api/v1/supplier-evaluations` | member | SupplierEvaluationController.create |

## supplier-nominations

| Method | Path | Access | Handler |
|---|---|---|---|
| POST | `/api/v1/supplier-nominations` | member | SupplierNominationsController.create |
| DELETE | `/api/v1/supplier-nominations/:id` | member | SupplierNominationsController.remove |
| GET | `/api/v1/supplier-nominations/:id` | viewer | SupplierNominationsController.findOne |
| PUT | `/api/v1/supplier-nominations/:id` | member | SupplierNominationsController.update |
| GET | `/api/v1/supplier-nominations/:id/capability-scores` | viewer | SupplierNominationsController.getCapabilityScores |
| POST | `/api/v1/supplier-nominations/:id/capability-scores` | member | SupplierNominationsController.initializeCapabilityScores |
| PUT | `/api/v1/supplier-nominations/:id/capability-scores` | member | SupplierNominationsController.batchUpdateCapabilityScores |
| PUT | `/api/v1/supplier-nominations/:id/capability-scores/:criteriaId` | member | SupplierNominationsController.updateCapabilityCriteria |
| PUT | `/api/v1/supplier-nominations/:id/capability-scores/:criteriaId/:vendorId` | member | SupplierNominationsController.updateCapabilityScore |
| POST | `/api/v1/supplier-nominations/:id/complete` | member | SupplierNominationsController.complete |
| GET | `/api/v1/supplier-nominations/:id/cost-analysis` | viewer | SupplierNominationsController.getCostAnalysis |
| PUT | `/api/v1/supplier-nominations/:id/cost-analysis` | member | SupplierNominationsController.updateCostAnalysis |
| PUT | `/api/v1/supplier-nominations/:id/cost-analysis/:component` | member | SupplierNominationsController.updateCostComponent |
| PUT | `/api/v1/supplier-nominations/:id/criteria` | member | SupplierNominationsController.updateCriteria |
| POST | `/api/v1/supplier-nominations/:id/vendors` | member | SupplierNominationsController.addVendors |
| GET | `/api/v1/supplier-nominations/:nominationId/factor-weights` | viewer | SupplierNominationsController.getFactorWeights |
| PUT | `/api/v1/supplier-nominations/:nominationId/factor-weights` | member | SupplierNominationsController.updateFactorWeights |
| GET | `/api/v1/supplier-nominations/:nominationId/part-cost-analyses/:bomItemId` | viewer | SupplierNominationsController.getPartWiseCostAnalysis |
| POST | `/api/v1/supplier-nominations/:nominationId/part-cost-analyses/:bomItemId` | member | SupplierNominationsController.initializePartWiseCostAnalysis |
| PUT | `/api/v1/supplier-nominations/:nominationId/part-cost-analyses/:bomItemId` | member | SupplierNominationsController.bulkUpdatePartWiseCostAnalysis |
| GET | `/api/v1/supplier-nominations/:nominationId/part-wise-analysis-summary` | viewer | SupplierNominationsController.getPartWiseAnalysisSummary |
| GET | `/api/v1/supplier-nominations/:nominationId/rankings` | viewer | SupplierNominationsController.getStoredRankings |
| POST | `/api/v1/supplier-nominations/:nominationId/rankings` | member | SupplierNominationsController.storeSupplierRankings |
| POST | `/api/v1/supplier-nominations/:nominationId/rankings/calculations` | member | SupplierNominationsController.calculateSupplierRankings |
| GET | `/api/v1/supplier-nominations/:nominationId/vendor-overall-scores/:vendorId` | viewer | SupplierNominationsController.getVendorRatingOverallScores |
| GET | `/api/v1/supplier-nominations/:nominationId/vendor-ratings/:vendorId` | viewer | SupplierNominationsController.getVendorRatingMatrix |
| POST | `/api/v1/supplier-nominations/:nominationId/vendor-ratings/:vendorId` | member | SupplierNominationsController.initializeVendorRatingMatrix |
| PUT | `/api/v1/supplier-nominations/:nominationId/vendor-ratings/:vendorId` | member | SupplierNominationsController.batchUpdateVendorRatingMatrix |
| GET | `/api/v1/supplier-nominations/approved-vendors/bom-part/:bomPartId` | viewer | SupplierNominationsController.getApprovedVendorsByBomPart |
| PUT | `/api/v1/supplier-nominations/evaluation-sections/:evaluationId/:section` | member | SupplierNominationsController.updateEvaluationSection |
| PUT | `/api/v1/supplier-nominations/evaluations/:evaluationId` | member | SupplierNominationsController.updateVendorEvaluation |
| GET | `/api/v1/supplier-nominations/evaluations/:evaluationId/scores` | viewer | SupplierNominationsController.getEvaluationScores |
| PUT | `/api/v1/supplier-nominations/evaluations/:evaluationId/scores` | member | SupplierNominationsController.updateEvaluationScores |
| GET | `/api/v1/supplier-nominations/project/:projectId` | viewer | SupplierNominationsController.findByProject |

## tooling-costs

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/tooling-costs` | viewer | ToolingCostController.findAll |
| POST | `/api/v1/tooling-costs` | member | ToolingCostController.create |
| DELETE | `/api/v1/tooling-costs/:id` | member | ToolingCostController.delete |
| GET | `/api/v1/tooling-costs/:id` | viewer | ToolingCostController.findOne |
| PUT | `/api/v1/tooling-costs/:id` | member | ToolingCostController.update |
| POST | `/api/v1/tooling-costs/totals` | member | ToolingCostController.getBulkTotalCosts |

## vave-bom-analyses

| Method | Path | Access | Handler |
|---|---|---|---|
| POST | `/api/v1/vave-bom-analyses` | member | VaveAiController.bomAnalysis |

## vave-projects

| Method | Path | Access | Handler |
|---|---|---|---|
| GET | `/api/v1/vave-projects` | viewer | VaveController.listProjects |
| POST | `/api/v1/vave-projects` | member | VaveController.createProject |
| DELETE | `/api/v1/vave-projects/:id` | member | VaveController.deleteProject |
| GET | `/api/v1/vave-projects/:id` | viewer | VaveController.getProject |
| PUT | `/api/v1/vave-projects/:id` | member | VaveController.updateProject |
| POST | `/api/v1/vave-projects/:id/ai/cost-analysis` | member | VaveAiController.costAnalysis |
| POST | `/api/v1/vave-projects/:id/ai/ideation` | member | VaveAiController.ideation |
| GET | `/api/v1/vave-projects/:id/bom` | viewer | VaveController.listBomItems |
| POST | `/api/v1/vave-projects/:id/bom` | member | VaveController.createBomItem |
| DELETE | `/api/v1/vave-projects/:id/bom/:itemId` | member | VaveController.deleteBomItem |
| POST | `/api/v1/vave-projects/:id/bom/batches` | member | VaveController.bulkImportBom |
| GET | `/api/v1/vave-projects/:id/ideas` | viewer | VaveController.listIdeas |
| POST | `/api/v1/vave-projects/:id/ideas` | member | VaveController.createIdea |
| DELETE | `/api/v1/vave-projects/:id/ideas/:ideaId` | member | VaveController.deleteIdea |
| PUT | `/api/v1/vave-projects/:id/ideas/:ideaId` | member | VaveController.updateIdea |
| POST | `/api/v1/vave-projects/:id/ideas/batches` | member | VaveController.bulkCreateIdeas |
| POST | `/api/v1/vave-projects/:id/should-cost-estimates/:itemId` | member | VaveAiController.shouldCost |
| GET | `/api/v1/vave-projects/:id/should-costs` | viewer | VaveController.listShouldCosts |
| POST | `/api/v1/vave-projects/:id/should-costs` | member | VaveController.upsertShouldCost |
| DELETE | `/api/v1/vave-projects/:id/should-costs/:costId` | member | VaveController.deleteShouldCost |

## vendors

| Method | Path | Access | Handler |
|---|---|---|---|
| DELETE | `/api/v1/vendors` | admin | VendorsController.removeAll |
| GET | `/api/v1/vendors` | viewer | VendorsController.findAll |
| POST | `/api/v1/vendors` | member | VendorsController.create |
| DELETE | `/api/v1/vendors/:id` | member | VendorsController.remove |
| GET | `/api/v1/vendors/:id` | viewer | VendorsController.findOne |
| PUT | `/api/v1/vendors/:id` | member | VendorsController.update |
| GET | `/api/v1/vendors/:vendorId/contacts` | viewer | VendorsController.findContacts |
| GET | `/api/v1/vendors/:vendorId/equipment` | viewer | VendorsController.findEquipment |
| GET | `/api/v1/vendors/:vendorId/services` | viewer | VendorsController.findServices |
| POST | `/api/v1/vendors/contacts` | member | VendorsController.createContact |
| DELETE | `/api/v1/vendors/contacts/:id` | member | VendorsController.removeContact |
| PUT | `/api/v1/vendors/contacts/:id` | member | VendorsController.updateContact |
| POST | `/api/v1/vendors/equipment` | member | VendorsController.createEquipment |
| GET | `/api/v1/vendors/equipment-types` | viewer | VendorsController.getEquipmentTypes |
| DELETE | `/api/v1/vendors/equipment/:id` | member | VendorsController.removeEquipment |
| PUT | `/api/v1/vendors/equipment/:id` | member | VendorsController.updateEquipment |
| POST | `/api/v1/vendors/imports` | member | VendorsController.uploadCsv |
| POST | `/api/v1/vendors/matches` | member | VendorsController.matchForPart |
| POST | `/api/v1/vendors/services` | member | VendorsController.createService |
| DELETE | `/api/v1/vendors/services/:id` | member | VendorsController.removeService |
| PUT | `/api/v1/vendors/services/:id` | member | VendorsController.updateService" |

---

454 routes in 59 resources.
