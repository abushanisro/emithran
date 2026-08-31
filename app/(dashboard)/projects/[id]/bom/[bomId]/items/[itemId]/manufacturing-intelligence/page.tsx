'use client';

import { useState, useEffect, useMemo, useCallback, useRef, Fragment, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import {
  ArrowLeft, Maximize2, Minimize2, ChevronDown, ChevronRight,
  AlertCircle, GripVertical, GripHorizontal, RefreshCw,
  Calculator, ShieldCheck, Flame, Crosshair, Loader2, Edit, X, Download,
  FileSpreadsheet, Search, Database,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/sidebar';
import type { HeatmapSource, HeatmapLayerType, HeatmapNormalization } from '@/components/ui/model-viewer';
import {
  buildManufacturingRiskSources, buildCostDensitySources, type CostHeatmapWeights,
  buildToleranceSources, type ToleranceHeatmapWeights,
  buildSustainabilitySources, type SustainabilityHeatmapWeights,
  buildThermalSources, buildToolWearSources,
  buildIMHeatmapSources,
} from '@/lib/heatmap/sources';
import type { IMHeatmapFeatures, IMHeatmapSignals } from '@/lib/heatmap/types';
import { cn } from '@/lib/utils';
import { downloadBomItemExcel } from '@/lib/utils/download-bom-item-excel';
import { generateCalculationReportPdf } from '@/lib/utils/calculation-report';
import { CalculationTracePanel } from '@/components/features/process-planning/CalculationTracePanel';
import { toast } from 'sonner';
import { ModelViewer } from '@/components/ui/model-viewer';
import { useBOMItem, useAnalysisVersion, useDFMScores, useMaterialIntelligence, useUpdateBOMItem, usePatchScenarioOverrides, useCostSummary, useRouteComparison, useGdtAnalysis, useCostOverride, useApplyRoute, useApplyCustomRoute, useMachineOverride, type BlankSpecDto, type ProcessLineCost, type ApplyCustomRouteStep } from '@/lib/api/hooks/useBOMItems';
import { useMHRRecords, useMHRBenchmark } from '@/lib/api/hooks/useMHR';
import { useFactoryCurrency, useFactories, useCurrencies, useFxRate, useRefreshFxRate, useFxRateOnDemand, type FxRateType } from '@/lib/api/hooks/useFx';
import { useProcessCalculatorMappings } from '@/lib/api/hooks/useProcessCalculatorMappings';
import { useSmLookupTables, type ReferenceTable } from '@/lib/api/hooks/useProcesses';
import { resolveMhrUsdRate } from '@/lib/api/mhr';
import type { GdtSeverity, CostSummaryDto, RouteResultDto } from '@/lib/api/hooks/useBOMItems';
import { useRawMaterials, useMaterialAliases } from '@/lib/api/hooks/useRawMaterials';
import type { RawMaterial } from '@/lib/api/hooks/useRawMaterials';
import { useCreateRawMaterialCost, useRawMaterialCosts } from '@/lib/api/hooks/useRawMaterialCosts';
import { getThreadIntelligence } from '@/lib/manufacturing-kb/thread-standards';
import { suggestMaterialCandidates, type MaterialSuggestion } from '@/lib/manufacturing-kb/material-candidates';
import type { ClearanceHole } from '@/lib/api/vave';
import { apiClient, ApiError } from '@/lib/api/client';
import { PartDimensionViewer } from '@/components/ui/part-dimension-viewer';
import { MachineSelector } from '@/components/features/manufacturing-intelligence/MachineSelector';
import { CopilotPanel } from '@/components/features/manufacturing-intelligence/CopilotPanel';
import { VendorNetworkPanel } from '@/components/features/manufacturing-intelligence/VendorNetworkPanel';
import { RawMaterialsSection } from '@/components/features/process-planning/RawMaterialsSection';
import { ProcessCostDialog } from '@/components/features/process-planning/ProcessCostDialog';
import { PackagingLogisticsSection } from '@/components/features/process-planning/PackagingLogisticsSection';
import { ProcuredPartsSection } from '@/components/features/process-planning/ProcuredPartsSection';
import { ToolingSection } from '@/components/features/process-planning/ToolingSection';
import { useCreateProcessCost, useUpdateProcessCost, useDeleteProcessCost, useProcessCosts, type CreateProcessCostDto } from '@/lib/api/hooks/useProcessCosts';
import { usePackagingLogisticsCosts } from '@/lib/api/hooks/usePackagingLogisticsCosts';
import { useProcuredPartsCosts } from '@/lib/api/hooks/useProcuredPartsCosts';
import { useToolingCosts } from '@/lib/api/hooks/useToolingCosts';
import type { BOMItem } from '@/lib/api/hooks/useBOMItems';
import type { FeatureGraph, FeatureGraphSummary, DFMWarning, DFMSeverity, ValidationResult, ManufacturingFeature, HoleGroup, HoleGroupLocation, BendFeature, FeatureNodeV2, FaceMapEntry, FeatureCategory, DFMScoresResponse } from '@/lib/types/manufacturing';
import { hasDfmRiskFactor } from '@/lib/dfm/hasRiskFactor';
// ── Types ──────────────────────────────────────────────────────────────────────

type PanelId = 'left' | 'center' | 'right' | 'process' | 'drivers';

interface ManualRouteOption {
  id: string;
  label: string;
  complexityLevel: 'simple' | 'standard' | 'complex';
  isRecommended: boolean;
  processes: string[];
  rationale: string;
  // Real machine picks made in the Workflow Builder (page.tsx's
  // RouteSelectionDialog) — applied via useMachineOverride AFTER apply-route
  // creates the process_cost_records rows, since machine-override updates an
  // existing row rather than creating one.
  machineOverrides?: { processKey: string; mhrRecordId: string }[];
  // Exact identity of a dynamically-assembled (Workflow Builder) route, so
  // reopening the dialog to EDIT this same route restores exactly what's
  // applied instead of resetting to the CAD-optimal default. `processes`
  // above is cosmetic-label-only and `id` is a synthetic `custom-<timestamp>`
  // — neither can round-trip back to a real cuttingRouteId ('sm-laser' etc.)
  // or the real additional-step identities, so this is tracked separately.
  dynamicCuttingRouteId?: string;
  dynamicSteps?: Array<{ process: string; machineClass: string; isReal: boolean; processGroup?: string; processRoute?: string }>;
  // The cutting route's OWN process line (e.g. "Turret Punching") — tracked
  // separately from dynamicSteps ("additional steps" only, deliberately, so
  // the Workflow Builder's cutting-method selector and its additional-steps
  // list don't show it twice). apply-custom-route writes ONLY what's in its
  // `steps` payload — it does NOT implicitly add baseCuttingRouteId's own
  // cutting line — so this must be prepended at the call site, or the
  // cutting operation is silently missing from every applied route.
  dynamicCuttingStep?: { process: string; machineClass: string };
}

interface RouteScoringContext {
  summary: FeatureGraphSummary;
  item: BOMItem;
  batchSize: number;
}

interface RouteScore {
  costScore: number;
  leadTimeScore: number;
  qualityScore: number;
  flexScore: number;
  toolingScore: number;
  totalScore: number;
  confidence: number;
  scoreFactors: string[];
  reasons: string[];
}

interface ProcessTreeNode {
  id: string;
  kind: 'part' | 'group' | 'operation' | 'sub_op' | 'feature';
  label: string;
  factory?: string;
  machine?: string;
  children?: ProcessTreeNode[];
  attrs?: { name: string; value: string }[];
  source?: string;
  // Set on hole-diameter-group feature nodes ("Ø1.6 × 24") so
  // computeFeatureNodeVisual can match this row to its v2Features occurrences
  // for highlighting — matching by diameter, not by parsing the display label.
  holeDiameterMm?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const SUB_OP: Record<string, string> = {
  'Fiber Laser Cutting': 'As Cut',
  'Sheet Metal Laser Cutting': 'As Cut',
  'CNC Press Brake': 'As Bent',
  'Sheet Metal Bending': 'As Bent',
  'Injection Moulding': 'As Moulded',
  'Injection Molding': 'As Moulded',
  'Material Drying': 'As Dried',
  'Gate Trimming': 'As Trimmed',
  'Deflashing': 'As Deflashed',
  'Insert Installation': 'As Assembled',
  'CNC Milling': 'As Machined',
  'CNC Machining': 'As Machined',
  'CNC Turning': 'As Turned',
  'Die Casting': 'As Cast',
  'Deburring': 'As Finished',
  'Drilling': 'As Drilled',
  'Inspection': 'As Inspected',
  'Tapping': 'As Tapped',
  'Surface Treatment': 'As Coated',
};

// ── Surface Treatment KB ───────────────────────────────────────────────────────
// Keyed by treatment process name. Phase 2: ctx.coatingType from drawing drives lookup.

type KBFeature = { label: string; machine?: string; attrs: Array<{ name: string; value: string }> };

const SURFACE_TREATMENT_KB: Record<string, KBFeature[]> = {
  'Zinc + Powder Coat': [
    {
      label: 'Zinc Phosphating',
      machine: 'Phosphating Tank',
      attrs: [
        { name: 'Type',    value: 'Chemical conversion coating' },
        { name: 'Purpose', value: 'Corrosion inhibition + paint adhesion' },
        { name: 'Substrate', value: 'Carbon / mild steel only' },
      ],
    },
    {
      label: 'Powder Coating',
      machine: 'Powder Coat Booth',
      attrs: [
        { name: 'Finish',   value: 'RAL (per drawing)' },
        { name: 'DFT',      value: '60–80 µm' },
        { name: 'Adhesion', value: 'Cross-cut ISO 2409 Class 0' },
      ],
    },
  ],
  'Anodize': [
    {
      label: 'Anodizing',
      machine: 'Anodizing Line',
      attrs: [
        { name: 'Type',      value: 'Type II sulfuric (per drawing)' },
        { name: 'Thickness', value: '10–25 µm' },
        { name: 'Substrate', value: 'Aluminium alloys' },
      ],
    },
  ],
  'Powder Coat Only': [
    {
      label: 'Powder Coating',
      machine: 'Powder Coat Booth',
      attrs: [
        { name: 'Pre-treatment', value: 'Chromate conversion (aluminium)' },
        { name: 'Finish',        value: 'RAL (per drawing)' },
        { name: 'DFT',           value: '60–80 µm' },
      ],
    },
  ],
};

// Default treatment sequence for carbon steels (CRCA, MS, IS2062, DC01)
const CARBON_STEEL_TREATMENT_KEY = 'Zinc + Powder Coat';

// Carbon/mild steel grades that corrode bare and default to Zinc + Powder Coat
// SECC/SPCC/SGCC/SPHC/SPCE: JIS G3141/G3302/G3313 cold-rolled and
// galvanized/electrogalvanized mild-steel sheet codes — same substrate
// family as CRCA/IS2062/DC01, just JIS-coded instead of IS/EN-coded.
const RUSTY_MATERIALS = ['CRCA', 'MS', 'IS2062', 'DC01', 'SECC', 'SPCC', 'SGCC', 'SPHC', 'SPCE'];

type SubstrateClass = 'aluminum' | 'stainless' | 'carbon_steel' | 'unknown';

// Substrate classification drives surface-treatment defaults. Zinc phosphating is a
// steel-only chemistry — it must never be applied to aluminium or stainless.
function classifySubstrate(materialText: string): SubstrateClass {
  const m = materialText.toUpperCase();
  if (m.trim().length === 0) return 'unknown';
  // T6 (ANSI H35.1 temper designation) is exclusive to heat-treatable
  // aluminum alloys — real parts here are stored as e.g. "T6 - Sheet" with
  // no alloy number, so match the temper code itself.
  if (/ALUMIN|(^|[^A-Z0-9])(AA\s?\d{4}|AL)([^A-Z]|$)|6061|6063|5052|5754|7075|2024|\bT6\b/.test(m)) {
    return 'aluminum';
  }
  if (/STAINLESS|(^|[^A-Z])SS([^A-Z]|$)|304|316|430|17-4/.test(m)) return 'stainless';
  if (RUSTY_MATERIALS.some((k) => m.includes(k)) || /MILD|EN\s?8|S235|S355|HR\b|CR[1-5]\b/.test(m)) {
    return 'carbon_steel';
  }
  return 'unknown';
}

// Cast alloys that can never run a laser + press-brake route, however flat the
// geometry looks (ALBC bronze plate ≙ sheet steel to the geometric classifier).
// Mirrors backend isSheetFormableMaterial — keep the keyword lists in sync.
const NON_SHEET_FORMABLE_RE = /BRONZE|ALBC|AL\.?\s?BR|CU\s?AL|C9[0-5]\d|GUNMETAL|LG[124]\b|CAST\s?IRON|FG\s?\d{3}|SG\s?IRON|EN-?GJ/i;
function isSheetFormableMaterial(materialText: string): boolean {
  if (materialText.trim().length === 0) return true; // unknown → don't veto
  return !NON_SHEET_FORMABLE_RE.test(materialText);
}

// Family for routing/display: geometric classification with the material veto
// applied. Single source of truth — every consumer of classification.family on
// this page must go through here or a bronze plate gets a press-brake route.
function resolveDisplayFamily(
  item: { materialGrade?: string | null; material?: string | null },
  fg: { classification?: { family?: string } } | null,
): string {
  const family = fg?.classification?.family ?? 'cnc_milled';
  if (family !== 'sheet_metal') return family;
  return isSheetFormableMaterial(`${item.materialGrade ?? ''} ${item.material ?? ''}`)
    ? family
    : 'cnc_milled';
}

// Resolve which SURFACE_TREATMENT_KB sequence applies. Explicit drawing coating wins;
// otherwise the substrate decides (aluminium → anodize, steel → zinc + powder coat).
function resolveTreatmentKey(substrate: SubstrateClass, coating: string | null | undefined): string {
  const c = (coating ?? '').toLowerCase();
  if (coating && SURFACE_TREATMENT_KB[coating]) return coating;
  if (c.includes('anodiz')) return 'Anodize';
  if (c.includes('powder')) return substrate === 'aluminum' ? 'Powder Coat Only' : CARBON_STEEL_TREATMENT_KEY;
  if (substrate === 'aluminum') return 'Anodize';
  return CARBON_STEEL_TREATMENT_KEY;
}

// ── Inspection KB ──────────────────────────────────────────────────────────────
// Composable inspection templates. Phase 2: driven by drawing quality requirements.

const INSPECTION_KB: Record<string, KBFeature> = {
  // Default for general-tolerance parts (no GD&T frames, no tight tolerances)
  dimensional: {
    label: 'Dimensional Inspection',
    machine: 'Inspection Bench',
    attrs: [
      { name: 'Scope',  value: 'Critical holes + bends' },
      { name: 'Method', value: 'Calipers / height gauge / Go-NoGo gauge' },
    ],
  },
  // Upgraded only when the drawing carries GD&T callouts or tolerance ≤ 0.10 mm
  // (same gate as backend feature-graph.service.ts CMM rule)
  dimensional_cmm: {
    label: 'CMM Inspection',
    machine: 'CMM',
    attrs: [
      { name: 'Scope',  value: 'GD&T callouts + critical dimensions' },
      { name: 'Method', value: 'CMM per drawing datum scheme' },
    ],
  },
  visual: {
    label: 'Visual Inspection',
    machine: 'Inspection Bench',
    attrs: [
      { name: 'Scope',  value: 'Surface finish, coating adhesion' },
      { name: 'Method', value: 'Visual + cross-cut test' },
    ],
  },
  coating_thickness: {
    label: 'Coating Thickness Check',
    machine: 'Elcometer',
    attrs: [
      { name: 'Method',          value: 'Elcometer / magnetic gauge' },
      { name: 'Accept criteria', value: '60–80 µm DFT' },
      { name: 'Frequency',       value: '5 pieces per batch' },
    ],
  },
};

const FAMILY_GROUP: Record<string, string> = {
  sheet_metal: 'Sheet Metal',
  cnc_milled: 'CNC Machining',
  cnc_turned: 'CNC Turning',
  injection_molded: 'Plastic Molding',
  casting: 'Die Casting',
  forging: 'Forging',
  weldment: 'Welding',
  additive: 'Additive Manufacturing',
  extrusion: 'Extrusion',
};

// ── Validation tab types & constants ──────────────────────────────────────────
type SolverType = 'fea_plastic_elastic' | 'fea_elastic_only' | 'geometric_unfolding';
type SurfaceForFlattening = 'mid_surface' | 'larger_area' | 'smaller_area';

interface ValidationConfig {
  solverType: SolverType;
  surfaceForFlattening: SurfaceForFlattening;
  fillHolesInBlanks: boolean;
}

// ANSI Y14.5 standard K-factor for mid-surface blank development
const K_FACTOR_MID_SURFACE = 0.44;

const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  solverType: 'fea_plastic_elastic',
  surfaceForFlattening: 'mid_surface',
  fillHolesInBlanks: false,
};

const KB_ROUTE_ALTERNATIVES: Record<string, ManualRouteOption[]> = {
  sheet_metal: [
    {
      id: 'sm-laser',
      label: 'Fiber Laser + Press Brake',
      complexityLevel: 'standard',
      isRecommended: true,
      processes: ['Fiber Laser Cutting', 'CNC Press Brake', 'Deburring'],
      rationale: 'Best surface finish and speed for complex profiles with tight tolerances',
    },
    {
      id: 'sm-turret',
      label: 'Turret Punch + Press Brake',
      complexityLevel: 'simple',
      isRecommended: false,
      processes: ['Turret Punching', 'CNC Press Brake', 'Deburring'],
      rationale: 'Lower tooling cost at high volume for simple blanks',
    },
    {
      id: 'sm-waterjet',
      label: 'Waterjet + Press Brake',
      complexityLevel: 'complex',
      isRecommended: false,
      processes: ['Waterjet Cutting', 'CNC Press Brake', 'Deburring'],
      rationale: 'No heat-affected zone — use for hardened or heat-sensitive materials',
    },
  ],
  cnc_turned: [
    {
      id: 'ct-2axis',
      label: 'CNC Turning (2-Axis)',
      complexityLevel: 'simple',
      isRecommended: true,
      processes: ['CNC Turning', 'Deburring'],
      rationale: 'Standard OD/ID/facing/threading — most cost-effective for symmetric parts',
    },
    {
      id: 'ct-livetools',
      label: 'Turn-Mill (Live Tooling)',
      complexityLevel: 'standard',
      isRecommended: false,
      processes: ['CNC Turning', 'CNC Milling', 'Deburring'],
      rationale: 'Cross-holes, flats, or keyways machined in single setup',
    },
    {
      id: 'ct-grind',
      label: 'Turning + Grinding',
      complexityLevel: 'complex',
      isRecommended: false,
      processes: ['CNC Turning', 'Cylindrical Grinding', 'Deburring'],
      rationale: 'H6/h6 fits or Ra < 0.8 µm surface finish requirements',
    },
  ],
  cnc_milled: [
    {
      id: 'cm-3axis',
      label: '3-Axis Milling',
      complexityLevel: 'simple',
      isRecommended: true,
      processes: ['CNC Milling', 'Deburring'],
      rationale: 'Prismatic features accessible from three orthogonal directions',
    },
    {
      id: 'cm-4axis',
      label: '4-Axis Milling',
      complexityLevel: 'standard',
      isRecommended: false,
      processes: ['CNC Milling', 'Deburring'],
      rationale: 'Helical features or parts needing 4th-axis continuous indexing',
    },
    {
      id: 'cm-5axis',
      label: '5-Axis Milling',
      complexityLevel: 'complex',
      isRecommended: false,
      processes: ['CNC Milling', 'Deburring'],
      rationale: 'Complex contoured surfaces or deep undercuts — single-setup advantage',
    },
  ],
};

// Maps KB_ROUTE_ALTERNATIVES IDs → apply-route DTO IDs accepted by the backend.
// Grinding has no backend route, so it's absent — clicking it only updates local UI.
const KB_TO_APPLY_ROUTE: Record<string, string> = {
  'sm-laser':    'sm-laser',
  'sm-turret':   'sm-turret',
  'sm-waterjet': 'sm-waterjet',
  'cm-3axis':    'cnc-3ax',
  'cm-4axis':    'cnc-4ax',
  'cm-5axis':    'cnc-5ax',
  'ct-2axis':    'cnc-lathe',
  'ct-livetools': 'cnc-lathe-lt',
};

// ── Route Scoring Engine ───────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function computeConfidence(item: BOMItem, summary: FeatureGraphSummary): number {
  let score = 100;
  if (!item.materialGrade && !item.material) score -= 40;
  else if (!item.materialGrade) score -= 15;
  if (!item.annualVolume) score -= 20;
  if (!summary.sheetThicknessMm) score -= 15;
  if (!summary.holeCount) score -= 10;
  return Math.max(10, score);
}

function computeRouteScore(routeId: string, ctx: RouteScoringContext): RouteScore {
  const { summary, item, batchSize } = ctx;
  const uniqueDiameters = summary.holeGroups?.length ?? 0;
  const holeCount = summary.holeCount;
  const thickness = summary.sheetThicknessMm;
  const volume = item.annualVolume ?? 0;
  const matStr = `${item.materialGrade ?? ''} ${item.material ?? ''}`.toUpperCase();
  const isHeatSensitive = ['STAINLESS', 'INCONEL', 'TITANIUM', 'SPRING', 'HARDENED'].some((m) => matStr.includes(m));
  const isThick = thickness > 8;
  const confidence = computeConfidence(item, summary);

  if (routeId === 'sm-laser') {
    // Base scores
    let costBase = 85;
    let leadBase = 90;
    let qualBase = 92;

    const scoreFactors: string[] = [];
    const reasons: string[] = [];

    // Volume signal
    if (volume < 5_000) { costBase += 5; scoreFactors.push(`Low volume (${volume.toLocaleString()} pcs) — no tooling amortization needed`); }
    if (volume > 50_000) { costBase -= 10; scoreFactors.push(`High volume (${volume.toLocaleString()} pcs) — laser cost disadvantage at scale`); }

    // Hole signals — laser excels with diverse, dense holes
    if (holeCount > 150) { costBase += 8; scoreFactors.push(`${holeCount} holes — laser pierce cycle well-suited`); }
    if (uniqueDiameters > 10) { costBase += 8; scoreFactors.push(`${uniqueDiameters} unique hole sizes — no die investment; laser unaffected`); }
    else if (uniqueDiameters > 5) { costBase += 4; scoreFactors.push(`${uniqueDiameters} unique hole diameters — no die investment`); }

    // Cut length signal
    const cutLength = summary.cutLengthMm;
    if (cutLength > 3_000) { leadBase += 3; scoreFactors.push(`Long cut profile (${Math.round(cutLength)} mm) — fiber laser cycle efficient`); }

    // Material / thickness penalties
    if (isHeatSensitive) { qualBase -= 4; scoreFactors.push(`Heat-sensitive material — HAZ risk reduces quality score`); }
    if (isThick) { leadBase -= 5; scoreFactors.push(`Thick sheet (${thickness} mm) — edge quality degrades above 8 mm`); }

    const costScore = clamp(costBase, 0, 100);
    const leadTimeScore = clamp(leadBase, 0, 100);
    const qualityScore = clamp(qualBase, 0, 100);
    const flexScore = 95;
    const toolingScore = 100;
    const totalScore = Math.round(costScore * 0.35 + leadTimeScore * 0.20 + qualityScore * 0.20 + flexScore * 0.15 + toolingScore * 0.10);

    if (uniqueDiameters > 0) reasons.push(`${uniqueDiameters} unique hole size${uniqueDiameters > 1 ? 's' : ''} — no die investment needed`);
    if (holeCount > 50) reasons.push(`${holeCount} holes at high pierce speed`);
    if (volume > 0 && volume < 10_000) reasons.push(`Volume ${volume.toLocaleString()} pcs — no tooling amortization required`);
    if (batchSize > 0 && batchSize < 100) reasons.push(`Batch of ${batchSize} pcs — instant changeover`);
    reasons.push('Profile changes are program edits — no hard tooling');
    return { costScore, leadTimeScore, qualityScore, flexScore, toolingScore, totalScore, confidence, scoreFactors, reasons };
  }

  if (routeId === 'sm-turret') {
    let costBase = 70;
    let leadBase = 75;

    const scoreFactors: string[] = [];
    const reasons: string[] = [];

    // Volume signal — turret wins at scale with simple hole sets
    if (volume > 50_000) { costBase += 12; scoreFactors.push(`High volume (${volume.toLocaleString()} pcs) — tooling cost fully amortized`); }
    if (volume < 5_000 && volume > 0) { costBase -= 10; scoreFactors.push(`Low volume — punch-die tooling not amortized`); }

    // Hole diversity — turret penalized by unique diameters
    const diePenalty = Math.min(20, uniqueDiameters * 2);
    costBase -= diePenalty;
    leadBase -= diePenalty;
    if (uniqueDiameters > 5) scoreFactors.push(`${uniqueDiameters} unique diameters → ${uniqueDiameters} punch-die sets required`);

    // Simple repeating patterns at high volume — turret strength
    if (uniqueDiameters <= 3 && holeCount > 100) {
      costBase += 15;
      scoreFactors.push(`Simple hole set (${uniqueDiameters} sizes × ${holeCount} hits) — high-speed turret cycle`);
    }
    // Large flat blanks favour turret throughput
    if (summary.flatPatternAreaMm2 > 100_000) {
      leadBase += 5;
      scoreFactors.push(`Large flat pattern (${fmtInt(summary.flatPatternAreaMm2)} mm²) — high blank utilisation per stroke`);
    }
    // Thin sheet — turret strokes faster
    if (thickness < 1.5 && thickness > 0) { leadBase += 5; scoreFactors.push(`Thin sheet (${thickness} mm) — high strokes/min`); }

    const costScore = clamp(costBase, 0, 100);
    const leadTimeScore = clamp(leadBase, 0, 100);
    const qualityScore = 80;
    const flexScore = clamp(65 - Math.min(30, uniqueDiameters * 3), 0, 100);
    const toolingScore = clamp(40 - Math.min(30, uniqueDiameters * 3), 0, 100);
    const totalScore = Math.round(costScore * 0.35 + leadTimeScore * 0.20 + qualityScore * 0.20 + flexScore * 0.15 + toolingScore * 0.10);

    if (volume > 50_000) reasons.push(`Volume ${volume.toLocaleString()} pcs — tooling amortized`);
    if (uniqueDiameters > 5) reasons.push(`${uniqueDiameters} unique diameters → tooling budget required`);
    if (uniqueDiameters <= 3 && holeCount > 100) reasons.push(`Simple hole pattern (${uniqueDiameters} sizes, ${holeCount} hits) — turret strength`);
    if (thickness < 1.5 && thickness > 0) reasons.push(`Thin sheet ${thickness} mm — high strokes/min lowers cycle time`);
    return { costScore, leadTimeScore, qualityScore, flexScore, toolingScore, totalScore, confidence, scoreFactors, reasons };
  }

  if (routeId === 'sm-waterjet') {
    let qualBase = 88;
    let leadBase = 50;

    const scoreFactors: string[] = [];
    const reasons: string[] = [];

    if (isHeatSensitive) { qualBase += 8; scoreFactors.push(`Heat-sensitive material — waterjet has no HAZ`); }
    if (isThick) { leadBase += 8; scoreFactors.push(`Thick sheet (${thickness} mm) — laser edge quality degrades above 8 mm`); }

    // Short complex profiles suit waterjet
    const cutLength = summary.cutLengthMm;
    if (cutLength > 0 && cutLength < 1_000) { leadBase += 5; scoreFactors.push(`Short complex profile (${Math.round(cutLength)} mm) — waterjet contour advantage`); }

    if (!isHeatSensitive && !isThick) scoreFactors.push(`Standard material and thickness — waterjet cost penalty not offset`);

    const costScore = 45;
    const leadTimeScore = clamp(leadBase, 0, 100);
    const qualityScore = clamp(qualBase, 0, 100);
    const flexScore = 70;
    const toolingScore = 100;
    const totalScore = Math.round(costScore * 0.35 + leadTimeScore * 0.20 + qualityScore * 0.20 + flexScore * 0.15 + toolingScore * 0.10);

    if (isHeatSensitive) reasons.push('No heat-affected zone — preserves material properties');
    if (isThick) reasons.push(`Thick section ${thickness} mm — laser degrades above 8 mm`);
    if (!isHeatSensitive && !isThick) reasons.push('Laser offers lower cost and faster cycle on this material');
    reasons.push('No hard tooling — any shape cuts without dies');
    return { costScore, leadTimeScore, qualityScore, flexScore, toolingScore, totalScore, confidence, scoreFactors, reasons };
  }

  return { costScore: 75, leadTimeScore: 75, qualityScore: 80, flexScore: 75, toolingScore: 75, totalScore: 76, confidence: 50, scoreFactors: [], reasons: [] };
}

const RIGHT_TABS = [
  { key: 'copilot',       label: '✦ Copilot'   },
  { key: 'cost',          label: 'Cost'         },
  { key: 'validation',    label: 'Validation'   },
  { key: 'part_summary',  label: 'Part Info'    },
  { key: 'sustainability', label: 'Sustain'     },
  { key: 'detail',        label: 'Detail'       },
  { key: 'investment',    label: 'Invest'       },
  { key: 'vendor_network', label: 'Vendors'     },
] as const;
type RightTabKey = (typeof RIGHT_TABS)[number]['key'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null, d = 1): string {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
}
// A bare grade/temper fragment ("T6 - Round Bar", "HAZ Weldable Sheet") means
// nothing on its own — "T6" applies to many unrelated aluminum alloys. Prefix
// the material name so the saved/displayed value is unambiguous, unless the
// grade string already names the material (e.g. "AA6061-T6" already says
// aluminum) — avoids "Aluminum AA6061-T6 Aluminum".
function materialLabel(material: string, materialGrade?: string | null): string {
  if (!materialGrade) return material;
  const g = materialGrade.toLowerCase();
  const m = material.toLowerCase();
  if (g.includes(m) || m.includes(g)) return materialGrade;
  return `${material} ${materialGrade}`;
}
function fmtInt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-IN');
}
// A real ~5s operation (e.g. a short cut path + a handful of pierces) rounds
// to "0.0 min" at 1-decimal-place minutes, indistinguishable from unset/zero.
// Show sub-minute durations in seconds instead.
function formatCycleMin(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min <= 0) return '0.0 min';
  if (min < 1) return `${(min * 60).toFixed(1)} s`;
  return `${min.toFixed(1)} min`;
}
// Never substitute the process route/group for a missing machine name — that
// silently displays the process as if it were the machine (e.g. "Laser Cutting"
// shown where a real machine like "Trumpf 3030" belongs). Say what's actually true.
function machineDisplayLabel(proc: { machineName?: string | null; mhrId?: string | null }): string {
  if (proc.machineName) return proc.machineName;
  if (proc.mhrId) return 'Machine name unavailable';
  return 'Manual rate — not linked to a machine';
}
// machineClass (e.g. 'fiber_laser') is a machine-table key, not a process_group —
// never store it directly as processGroup (that produced the "Group: fiber_laser"
// bug). Mirrors backend's deriveProcessGroupFromMachineClass in
// bom-items.controller.ts, expanded to the fuller machine_class vocabulary
// introduced by migrations 369/371.
function deriveProcessGroupFromMachineClass(machineClass: string | null | undefined): string {
  if (!machineClass) return '';
  const sheetMetal = ['fiber_laser', 'co2_laser', 'plasma', 'waterjet', 'press_brake', 'turret_punch', 'roll_forming', 'deep_draw', 'band_saw'];
  const machining = ['cnc_lathe', 'cnc_lathe_live', 'cnc_mill_turn', 'cnc_3ax_vmc', 'cnc_4ax_vmc', 'cnc_5ax_mc', 'grinding', 'drill_press', 'tapping', 'edm'];
  const assembly = ['welding', 'manual_assembly', 'adhesive_bonding', 'electrical_assembly'];
  const postProcessing = ['cmm', 'ndt_test', 'heat_treat_furnace', 'anodize', 'powder_coat', 'plating', 'chem_treatment', 'laser_marking', 'deburring'];
  const plastics = ['injection_molding', 'thermoforming', 'blow_molding', 'extrusion', 'rotational_molding', 'rubber_molding', 'compression_molding'];
  if (sheetMetal.includes(machineClass)) return 'Sheet Metal';
  if (machining.includes(machineClass)) return 'Machining';
  if (assembly.includes(machineClass)) return 'Assembly';
  if (postProcessing.includes(machineClass)) return 'Post Processing';
  if (plastics.includes(machineClass)) return 'Plastic & Rubber';
  return '';
}
// Maps one FeatureBreakdown row to the 3D-viewer highlight it represents, so
// clicking "Bend R1mm x2" shows exactly those 2 bends (not every bend in the
// part), "Pierces x19"/pierce cleanup shows all pierced holes, and cut-path/
// edge-length rows (no discrete feature — the cut path runs around the whole
// part) show the full model outline via the face map. Returns null when there's
// nothing to highlight (feature graph not loaded, or an unrecognized type),
// which the caller uses to disable the row rather than showing a dead click.
function resolveFeatureOpHighlight(
  op: { name: string; featureType: string },
  v2Features: FeatureNodeV2[],
  faceMap: FaceMapEntry[],
): FeatureNodeV2 | null {
  if (op.featureType === 'bend') {
    const bendFeatures = v2Features.filter((f) => f.feature_type === 'bend');
    const m = op.name.match(/R([\d.]+)mm/);
    if (m) {
      const bucket = parseFloat(m[1]!);
      const matched = bendFeatures.filter((f) => Math.round((f.radius_mm ?? 0) * 2) / 2 === bucket);
      if (matched.length) return mergeFeaturesToHL(`fb_bend_r${bucket}`, matched);
    }
    return mergeFeaturesToHL('fb_bend_all', bendFeatures);
  }
  if (op.featureType === 'pierce' || op.featureType === 'deburr_pierce') {
    return mergeFeaturesToHL('fb_holes', v2Features.filter((f) => f.feature_type === 'hole'));
  }
  if (op.featureType === 'pem_insertion') {
    // buildPemFeatureBreakdown (bom-items.service.ts) names each row
    // "<part spec> x<count> (ØXmm, Ys/insertion)" — extract the diameter and
    // match holes at that diameter (0.3mm tolerance, same as the backend's
    // own sm_lookup_pem_hardware match tolerance in getPemMatches), same
    // bucket-matching pattern as bend/radius above. The feature graph has no
    // separate "this hole is a PEM insertion point" tag, so diameter is the
    // real, available signal — not a guess.
    const holeFeatures = v2Features.filter((f) => f.feature_type === 'hole');
    const m = op.name.match(/Ø([\d.]+)mm/);
    if (m) {
      const dia = parseFloat(m[1]!);
      const matched = holeFeatures.filter((f) => Math.abs((f.diameter_mm ?? 0) - dia) < 0.3);
      if (matched.length) return mergeFeaturesToHL(`fb_pem_d${dia}`, matched);
    }
    return mergeFeaturesToHL('fb_pem_all', holeFeatures);
  }
  if (op.featureType === 'laser_cut' || op.featureType === 'deburr_edge') {
    return buildFullModelHL('fb_outline', faceMap);
  }
  return null;
}

// eMithran-style per-feature sub-operation list (cut path, pierces, bends...) —
// shared by both the live-engine row and the saved-process-record row, since
// it's driven by the same geometry regardless of which is currently showing.
// Clickable when a matching 3D feature is resolvable (see resolveFeatureOpHighlight)
// — clicking highlights that exact feature in the 3D viewer so the number can
// be visually verified against the model, reusing the same highlight mechanism
// the Properties tree already uses for holes/bends.
function FeatureBreakdown({
  items,
  fg,
  onSelectHighlight,
}: {
  items: Array<{ name: string; timeSec: number; featureType: string; count: number }> | undefined;
  fg?: FeatureGraph | null | undefined;
  onSelectHighlight?: ((node: FeatureNodeV2 | null) => void) | undefined;
}) {
  if (!items || items.length === 0) return null;
  const v2Features = fg?.feature_graph_v2?.features ?? [];
  const faceMap = fg?.feature_graph_v2?.metadata?.face_map ?? [];
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1">Feature breakdown</div>
      {items.map((op, oi) => {
        const highlight = onSelectHighlight ? resolveFeatureOpHighlight(op, v2Features, faceMap) : null;
        return (
          <button
            key={oi}
            type="button"
            disabled={!highlight}
            onClick={() => highlight && onSelectHighlight?.(highlight)}
            title={highlight ? 'Click to highlight in the 3D view' : undefined}
            className="w-full flex items-center justify-between py-0.5 pl-3 border-l-2 border-violet-500/20 text-left transition-colors disabled:cursor-default enabled:hover:border-violet-500/60 enabled:hover:bg-violet-500/5"
          >
            <span className="text-[11px] text-muted-foreground/80 font-mono">{op.name}</span>
            <span className="text-[11px] text-muted-foreground/60 tabular-nums">{formatCycleMin(op.timeSec / 60)}</span>
          </button>
        );
      })}
    </div>
  );
}
function familyLabel(f: string): string {
  const m: Record<string, string> = {
    sheet_metal: 'Sheet Metal', cnc_milled: 'CNC Milled', cnc_turned: 'CNC Turned',
    mill_turn: 'Mill-Turn', injection_molded: 'Injection Moulded',
    casting: 'Casting', forging: 'Forging',
    extrusion: 'Extrusion', weldment: 'Weldment', additive: 'Additive',
  };
  if (!f) return '—';
  return m[f] ?? f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function confidenceCls(c: number): string {
  if (c >= 0.85) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (c >= 0.65) return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-red-700 bg-red-50 border-red-200';
}
// TODO: Remove after all BOM items are migrated to feature_graph_version >= 4
function normalizeFeatureGraph(raw: FeatureGraph | null): FeatureGraph | null {
  if (!raw?.summary) return raw;
  const summary = raw.summary;

  // Rebuild holeGroups for old DB entries that have holeDiameters but no holeGroups.
  // NaN→null serialization bug in old pipeline left holeGroups: [] with diameter_mm: null entries.
  const validGroups = (summary.holeGroups ?? []).filter(
    (g): g is { diameter_mm: number; count: number } =>
      typeof g.diameter_mm === 'number' && isFinite(g.diameter_mm) && g.diameter_mm > 0 && g.count > 0,
  );
  let holeGroups = validGroups;

  if (holeGroups.length === 0 && (summary.holeDiameters ?? []).length > 0) {
    const acc: Record<string, number> = {};
    for (const d of summary.holeDiameters!) {
      if (typeof d === 'number' && isFinite(d) && d > 0) {
        const k = d.toFixed(1);
        acc[k] = (acc[k] ?? 0) + 1;
      }
    }
    holeGroups = Object.entries(acc)
      .map(([k, count]) => ({ id: `hole_d${k}_c${count}`, diameter_mm: parseFloat(k), count, geometry_refs: { faces: [], edges: [] } }))
      .sort((a, b) => a.diameter_mm - b.diameter_mm);
  }

  if (holeGroups === validGroups) return raw;
  return { ...raw, summary: { ...summary, holeGroups } };
}

function buildSummary(item: BOMItem, fg: import('@/lib/types/manufacturing').FeatureGraph | null): FeatureGraphSummary {
  return {
    bendCount: item.bendCount ?? 0,
    cutLengthMm: item.cutLengthMm ?? 0,
    holeCount: item.holeCount ?? 0,
    sheetThicknessMm: item.sheetThicknessMm ?? 0,
    slotCount: 0,
    pierceCount: item.pierceCount ?? 0,
    flatPatternAreaMm2: item.flatPatternAreaMm2 ?? 0,
    holeDiameters: fg?.summary?.holeDiameters ?? [],
    holeGroups: fg?.summary?.holeGroups ?? [],
    bendRadii: fg?.summary?.bendRadii ?? [],
  };
}
function collectLeaves(node: ProcessTreeNode): ProcessTreeNode[] {
  if (!node.children?.length) return node.kind === 'feature' ? [node] : [];
  return node.children.flatMap(collectLeaves);
}
function findNode(node: ProcessTreeNode, id: string): ProcessTreeNode | null {
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const f = findNode(c, id); if (f) return f; }
  return null;
}

// ── Real cycle-time lookups for the Properties tree ────────────────────────────
// The backend already computes per-feature cycle time for Laser Cutting/Press
// Brake lines (featureBreakdown on ProcessLineCost, from bom-items.service.ts's
// buildLaserFeatureBreakdown/buildPressBrakeFeatureBreakdown — same lookup tables
// cost-engine.ts uses for real costing). These read that real data instead of the
// flat 2.5 sec/pierce, 42 sec/bend, /4000mm/min constants the tree used to guess.

function realPierceCycleTimeSec(count: number, cost: CostSummaryDto | null | undefined): number | null {
  const pierceEntry = cost?.processLines
    ?.find((l) => l.process === 'Laser Cutting')
    ?.featureBreakdown?.find((f) => f.featureType === 'pierce');
  if (!pierceEntry || !pierceEntry.count) return null;
  // Real aggregate isn't split per hole-diameter group — allocate this group's
  // share by count. Labelled "≈" at the call site since it's a real-data-derived
  // allocation, not an independently measured per-group figure.
  return (count / pierceEntry.count) * pierceEntry.timeSec;
}

function realBendCycleTimeSec(count: number, radiusMm: number | null, cost: CostSummaryDto | null | undefined): number | null {
  const breakdown = cost?.processLines
    ?.find((l) => l.process === 'Press Brake')
    ?.featureBreakdown?.filter((f) => f.featureType === 'bend') ?? [];
  if (!breakdown.length) return null;
  if (radiusMm != null) {
    // Backend buckets radii identically (Math.round(r*2)/2) before naming each
    // group "Bend R{bucket}mm ×{count}" — match that exact group, no allocation needed.
    const bucket = Math.round(radiusMm * 2) / 2;
    const exact = breakdown.find((f) => f.name.includes(`R${bucket}mm`));
    if (exact) return exact.timeSec;
  }
  const totalCount = breakdown.reduce((s, f) => s + f.count, 0);
  const totalSec = breakdown.reduce((s, f) => s + f.timeSec, 0);
  if (!totalCount) return null;
  return (count / totalCount) * totalSec;
}

// Load/Unload is a real, but PART-level (not per-radius-group) handling time —
// buildPressBrakeFeatureBreakdown emits it once per part, not once per bend
// group. Surfaced on whichever bend node is selected for reference; not
// summed across multiple bend nodes if a part has more than one radius group.
function realBendHandlingSec(cost: CostSummaryDto | null | undefined): number | null {
  const entry = cost?.processLines
    ?.find((l) => l.process === 'Press Brake')
    ?.featureBreakdown?.find((f) => f.featureType === 'handling');
  return entry ? entry.timeSec : null;
}

// Real machine-selection result for Press Brake — same object the
// MachineSelector component renders elsewhere; surfaced here too so the Bend
// tree node can show "why this machine" (tonnage/bed-length reasons) and
// required tonnage (from the SAME PressBrakeRequirement the selector used —
// see physics.ts's pressBrakeRequirement) without recomputing anything.
function realBendMachineSelection(cost: CostSummaryDto | null | undefined) {
  return cost?.processLines?.find((l) => l.process === 'Press Brake')?.machineSelection ?? null;
}

// Matched by the real, applied process name — not a hardcoded 'Laser Cutting'
// literal — so this resolves correctly for whichever cutting process (Laser,
// Waterjet, Plasma...) is actually applied. cycleTimes.laserMin is a laser-
// specific fallback field on CostSummaryDto with no equivalent for other
// cutting processes yet, so it's only consulted when processName really is
// 'Laser Cutting'; otherwise this honestly returns null rather than reusing
// a laser-specific number for a different process.
function realCutTimeSec(cost: CostSummaryDto | null | undefined, processName: string): number | null {
  const line = cost?.processLines?.find((l) => l.process === processName);
  const cutEntry = line?.featureBreakdown?.find((f) => f.featureType === 'laser_cut');
  if (cutEntry) return cutEntry.timeSec;
  if (processName === 'Laser Cutting' && typeof cost?.cycleTimes?.laserMin === 'number' && cost.cycleTimes.laserMin > 0) {
    return cost.cycleTimes.laserMin * 60;
  }
  return null;
}

// Real Cutting/Piercing split from the SAME featureBreakdown entries that
// drive the actual $ cost (buildLaserFeatureBreakdown, backend) — not a
// separate client-side re-estimate. Returns null (not a guess) unless BOTH
// entries are present, e.g. cost summary hasn't loaded yet, or the applied
// process's cost line doesn't have a per-feature breakdown at all.
function realCutTimeSplit(cost: CostSummaryDto | null | undefined, processName: string): { cuttingSec: number; piercingSec: number } | null {
  const line = cost?.processLines?.find((l) => l.process === processName);
  const cutEntry = line?.featureBreakdown?.find((f) => f.featureType === 'laser_cut');
  const pierceEntry = line?.featureBreakdown?.find((f) => f.featureType === 'pierce');
  if (!cutEntry && !pierceEntry) return null;
  return { cuttingSec: cutEntry?.timeSec ?? 0, piercingSec: pierceEntry?.timeSec ?? 0 };
}

function formatEstCycleTime(sec: number | null, allocated = false): string {
  if (sec == null || !Number.isFinite(sec)) return 'unavailable';
  return allocated ? `≈${sec.toFixed(0)} sec` : `${sec.toFixed(0)} sec`;
}

// ── featureToTreeNode ──────────────────────────────────────────────────────────

function featureToTreeNode(f: ManufacturingFeature, factory: string, machine: string, cost?: CostSummaryDto | null, processName?: string): ProcessTreeNode {
  if (f.type === 'flat_pattern') {
    const r = f.recognition;
    // processName is the real, applied cutting process name (e.g. 'Water Jet
    // Cutting') — falls back to 'Laser Cutting' only when the caller has no
    // process context at all, so existing non-cutting callers (bend/hole
    // features, which never read realCutSec/timeSplit below) are unaffected.
    const cuttingProcessName = processName ?? 'Laser Cutting';
    const realCutSec = realCutTimeSec(cost, cuttingProcessName);
    const timeSplit = realCutTimeSplit(cost, cuttingProcessName);
    return {
      id: f.id, kind: 'feature', label: 'Flat Pattern', factory, machine,
      attrs: [
        { name: 'Part Area', value: `${fmtInt(r.area_mm2)} mm²` },
        // Nesting/material-utilization metrics — directly affects nesting
        // cost, so surfaced alongside area rather than buried in a cost tab.
        // Only present when the true 2D unfold solver could resolve this
        // part's flat-pattern layout (fails gracefully otherwise, e.g. non-
        // manifold topology — never a guessed number).
        ...(r.bounding_rect_mm2 ? [
          { name: 'Bounding Rectangle', value: `${fmtInt(r.bounding_rect_mm2)} mm²` },
          { name: 'Material Utilization', value: `${fmt(r.material_utilization_pct ?? 0, 1)}%` },
          { name: 'Scrap', value: `${fmtInt(r.scrap_area_mm2 ?? 0)} mm²` },
        ] : []),
        ...(r.cut_length_mm > 0 ? [{ name: 'Cut Length', value: `${fmt(r.cut_length_mm, 0)} mm` }] : []),
        // Breakdown by category — lets the number be checked instead of
        // trusted as one opaque total. Only present when the CAD engine's
        // panel-wire walk produced it (STEP topology path).
        ...(r.cut_length_breakdown ? [
          { name: '— Outer Profile', value: `${fmt(r.cut_length_breakdown.outer_profile_mm, 1)} mm` },
          ...(r.cut_length_breakdown.circular_holes_mm > 0 ? [{ name: '— Circular Holes', value: `${fmt(r.cut_length_breakdown.circular_holes_mm, 1)} mm` }] : []),
          ...(r.cut_length_breakdown.internal_profiles_mm > 0 ? [{ name: '— Internal Profiles', value: `${fmt(r.cut_length_breakdown.internal_profiles_mm, 1)} mm` }] : []),
        ] : []),
        // Laser machines slow down on long unbroken contours — this is the
        // single longest cut path, not the summed total above, so it's
        // surfaced as its own DFM-relevant row. Only present when the
        // panel-wire walk produced it (same convention as the breakdown).
        ...(r.longest_continuous_cut_mm != null ? [{ name: 'Longest Continuous Cut', value: `${fmt(r.longest_continuous_cut_mm, 1)} mm` }] : []),
        // Corner count by turn angle — useful for estimating machine
        // deceleration. Acute is always a SUBSET of sharp, not a separate
        // total. Only present when the panel-wire walk produced it.
        ...(r.sharp_corner_count != null ? [
          { name: 'Sharp Corners (>60°)', value: String(r.sharp_corner_count) },
          { name: 'Acute Corners (<30°)', value: String(r.acute_corner_count ?? 0) },
        ] : []),
        // Reported as Lead-ins/Lead-outs (matching commercial CAM software
        // convention) rather than one "Pierce Count" — each pierce point is
        // one closed-contour entry (lead-in) and one exit before the head
        // lifts (lead-out). Same count as pierce_count under this system's
        // current model (no chain-cutting between adjacent contours), so
        // both rows share the one underlying number rather than being two
        // independently-measured quantities.
        ...(r.pierce_count > 0 ? [
          { name: 'Lead-ins', value: String(r.pierce_count) },
          { name: 'Lead-outs', value: String(r.pierce_count) },
        ] : []),
        // Holes under 2x sheet thickness need a reduced feed rate to pierce
        // cleanly — useful for estimating cycle-time slowdown. Only present
        // when the panel-wire walk produced it.
        ...(r.small_hole_count != null ? [{ name: 'Small Holes (<2×Thickness)', value: String(r.small_hole_count) }] : []),
        { name: 'Sheet Thickness', value: `${fmt(r.sheet_thickness_mm, 1)} mm` },
        // Breakdown instead of one opaque "Est. Laser Time" — matches how
        // commercial CAM software explains a cycle-time estimate. Cutting/
        // Piercing come from the SAME featureBreakdown entries that drive
        // the actual $ cost (not a separate re-estimate); Rapid Traverse is
        // a real addition on top (head repositioning between pierce points
        // isn't in the cost engine's total at all currently). Falls back to
        // the single old row when either piece of real data isn't loaded
        // yet, rather than showing a partially-real, partially-guessed mix.
        ...(timeSplit && r.rapid_traverse_sec != null ? [
          { name: 'Rapid Traverse', value: `${fmt(r.rapid_traverse_sec, 1)} sec` },
          { name: 'Piercing', value: `${fmt(timeSplit.piercingSec, 1)} sec` },
          { name: cuttingProcessName, value: `${fmt(timeSplit.cuttingSec, 1)} sec` },
          { name: 'Total', value: `${fmt(r.rapid_traverse_sec + timeSplit.piercingSec + timeSplit.cuttingSec, 1)} sec` },
        ] : [
          { name: `Est. ${cuttingProcessName} Time`, value: formatEstCycleTime(realCutSec) },
        ]),
      ],
    };
  }
  if (f.type === 'hole') {
    const r = f.recognition;
    const holeType = r.hole_type ?? 'through';
    const dLabel = r.diameter_mm != null ? `Ø${r.diameter_mm.toFixed(1)}` : 'Ø?';
    const typeLabel = holeType === 'counterbore' ? 'Counterbore' : holeType === 'countersink' ? 'Countersink' : null;
    const realSec = realPierceCycleTimeSec(r.count, cost);
    return {
      id: f.id, kind: 'feature',
      label: typeLabel ? `${typeLabel} ${dLabel} × ${r.count}` : `${dLabel} × ${r.count}`,
      factory, machine,
      ...(r.diameter_mm != null ? { holeDiameterMm: r.diameter_mm } : {}),
      attrs: [
        { name: 'Diameter', value: r.diameter_mm != null ? `${r.diameter_mm.toFixed(1)} mm` : '—' },
        { name: 'Count', value: String(r.count) },
        { name: 'Hole Type', value: typeLabel ?? 'Through' },
        { name: 'Process', value: typeLabel ?? 'Laser Pierce' },
        { name: 'Est. Cycle Time', value: formatEstCycleTime(realSec, true) },
      ],
    };
  }
  if (f.type === 'bend') {
    const r = f.recognition;
    const realSec = realBendCycleTimeSec(r.count, r.radius_mm ?? null, cost);
    const handlingSec = realBendHandlingSec(cost);
    const totalSec = realSec != null || handlingSec != null ? (realSec ?? 0) + (handlingSec ?? 0) : null;
    const ms = realBendMachineSelection(cost);
    const req = ms?.requirement as ({ kind: string; tonnage?: number; bendLengthMm?: number } | undefined);
    const requiredTonnage = req?.kind === 'press_brake' && typeof req.tonnage === 'number' ? req.tonnage : null;
    const pickedMachine = ms?.balanced?.candidate ?? null;
    const maxTonnage = pickedMachine?.capability?.maxTonnage ?? null;
    const utilizationPct = requiredTonnage != null && maxTonnage != null && maxTonnage > 0
      ? Math.round((requiredTonnage / maxTonnage) * 1000) / 10
      : null;
    return {
      id: f.id, kind: 'feature',
      label: r.radius_mm != null ? `R${r.radius_mm.toFixed(1)} × ${r.count}` : `Bends × ${r.count}`,
      factory, machine,
      attrs: [
        ...(r.radius_mm != null ? [{ name: 'Bend Radius', value: `${r.radius_mm.toFixed(1)} mm` }] : []),
        { name: 'Bend Count', value: String(r.count) },
        // Real per-bend angle/length from the cad-engine's bend clustering —
        // null (omitted) rather than guessed when that pass wasn't usable
        // (mesh-inference-only parts, or a sharp-fold part with no bend radius).
        ...(r.angle_deg != null ? [{ name: 'Bend Angle', value: `${r.angle_deg.toFixed(0)}°` }] : []),
        ...(r.bend_length_mm != null ? [{ name: 'Bend Length', value: `${r.bend_length_mm.toFixed(1)} mm` }] : []),
        // Required tonnage/machine/utilization all come from the SAME
        // PressBrakeRequirement + selectMachine result that actually picked
        // the machine and drove the $ cost — not a separate re-estimate.
        ...(requiredTonnage != null ? [{ name: 'Required Force', value: `${requiredTonnage.toFixed(2)} ton` }] : []),
        ...(pickedMachine?.machineName ? [{ name: 'Recommended Machine', value: pickedMachine.machineName }] : []),
        ...(utilizationPct != null ? [{ name: 'Capacity Utilization', value: `${utilizationPct.toFixed(1)}%` }] : []),
        ...((ms?.balanced?.reasons ?? []).map((reason) => ({ name: '— Why', value: reason }))),
        // Cycle time: Bending is this radius group's real stroke time; Load/
        // Unload is a real but PART-level (not per-group) handling time — see
        // realBendHandlingSec. Falls back to the old single estimate when
        // the real breakdown isn't loaded yet.
        ...(realSec != null || handlingSec != null ? [
          { name: 'Bending', value: formatEstCycleTime(realSec) },
          { name: 'Load / Unload', value: formatEstCycleTime(handlingSec) },
          { name: 'Total', value: formatEstCycleTime(totalSec) },
        ] : [
          { name: 'Est. Cycle Time', value: formatEstCycleTime(realSec, r.radius_mm == null) },
        ]),
      ],
    };
  }
  // exhaustive guard — f is `never` here; cast to access id/type at runtime
  const fallback = f as { id: string; type: string };
  return { id: fallback.id, kind: 'feature', label: String(fallback.type), factory, machine };
}

// Mirrors backend HYGROSCOPIC_RESIN_TOKENS — keep in sync with process-tree.ts.
const HYGROSCOPIC_TOKENS = new Set([
  'PA', 'PA6', 'PA66', 'PA12', 'NYLON', 'POLYAMIDE',
  'PC', 'POLYCARBONATE',
  'PET', 'PBT',
  'ABS',
  'PMMA', 'ACRYLIC',
  'PEI', 'ULTEM', 'PSU', 'PES',
  'TPU',
  'PEEK',
]);

function isHygroscopicResin(grade: string | null | undefined): boolean {
  if (!grade) return false;
  const tokens = new Set(
    grade.toUpperCase()
      .replace(/([A-Z])(\d)/g, '$1 $2')
      .replace(/(\d)([A-Z])/g, '$1 $2')
      .split(/[^A-Z0-9]+/)
      .filter(Boolean),
  );
  for (const t of tokens) if (HYGROSCOPIC_TOKENS.has(t)) return true;
  return false;
}

// ── Feature-driven gate helpers ─────────────────────────────────────────────────
// Single source of truth for "does this part need X" — shared by autoCompleteRoute
// (below) and RouteSelectionDialog's WORKFLOW_KB step visibility, so the Workflow
// Builder's step list and the tree's auto-completion can never silently disagree
// about which real, feature-driven operations apply to this part.

// Tapping: pilot-hole diameter filter — Ø ≤ 6mm covers M2–M6 pilot sizes.
function tappingCandidateCount(summary: FeatureGraphSummary): number {
  if (!(summary.sheetThicknessMm > 0 && summary.sheetThicknessMm < 3)) return 0;
  return (summary.holeGroups ?? [])
    .filter((g) => g.diameter_mm <= 6.0)
    .reduce((sum, g) => sum + g.count, 0);
}

// ── autoCompleteRoute ──────────────────────────────────────────────────────────

function autoCompleteRoute(
  recs: Array<{ process: string; estimated_time_sec?: number | null }>,
  family: string,
  summary: FeatureGraphSummary,
  ctx: { materialGrade?: string | null; material?: string | null; coating?: string | null } = {},
): Array<{ process: string; estimated_time_sec?: number | null }> {
  const processes = new Set(recs.map((r) => r.process));
  const completed = [...recs];

  if (family === 'sheet_metal') {
    const hasCutting = [...processes].some((p) =>
      p.includes('Laser') || p.includes('Punch') || p.includes('Waterjet') || p.includes('Cutting'),
    );
    if (!hasCutting) completed.unshift({ process: 'Fiber Laser Cutting' });

    // Hole Extrusion (Burring) + Tapping run right after cutting, BEFORE Press
    // Brake + Deburring: the M3 thread sits in the extruded collar, so the
    // collar must be formed and tapped while the part is still flat — tapping
    // into an already-bent flange risks tool access/interference, and this
    // also avoids handling an already-bent part through tapping. Same reorder
    // as cost-engine.ts / bom-items.service.ts::getRouteComparison's allLines.
    // `frontIdx` tracks the insertion point so each step lands right after the
    // previous one, in this order, regardless of which are actually present.
    const cutIdx = completed.findIndex((r) =>
      r.process.includes('Laser') || r.process.includes('Punch') || r.process.includes('Waterjet'),
    );
    let frontIdx = cutIdx >= 0 ? cutIdx : -1;

    if ((summary.extrudedFlangeCount ?? 0) > 0 && !completed.some((r) => r.process === 'Hole Extrusion (Burring)')) {
      completed.splice(frontIdx + 1, 0, { process: 'Hole Extrusion (Burring)' });
      frontIdx += 1;
    } else {
      const existingIdx = completed.findIndex((r) => r.process === 'Hole Extrusion (Burring)');
      if (existingIdx >= 0) frontIdx = existingIdx;
    }

    if (tappingCandidateCount(summary) > 0 && !completed.some((r) => r.process === 'Tapping')) {
      completed.splice(frontIdx + 1, 0, { process: 'Tapping' });
      frontIdx += 1;
    } else {
      const existingIdx = completed.findIndex((r) => r.process === 'Tapping');
      if (existingIdx >= 0) frontIdx = existingIdx;
    }

    const hasBending = [...processes].some((p) => p.includes('Press Brake') || p.includes('Bending'));
    if (summary.bendCount > 0 && !hasBending) {
      completed.splice(frontIdx + 1, 0, { process: 'CNC Press Brake' });
    }

    if (!completed.some((r) => r.process === 'Deburring')) completed.push({ process: 'Deburring' });

    // Counterboring/Countersinking: feature-driven, mirrors cost-engine.ts's gating
    // on summary.counterboreGroups/countersinkGroups (see migration 381).
    if ((summary.counterboreGroups?.length ?? 0) > 0 && !completed.some((r) => r.process === 'Counterboring')) {
      const deburrIdx = completed.findIndex((r) => r.process === 'Deburring');
      completed.splice(deburrIdx >= 0 ? deburrIdx : completed.length, 0, { process: 'Counterboring' });
    }
    if ((summary.countersinkGroups?.length ?? 0) > 0 && !completed.some((r) => r.process === 'Countersinking')) {
      const deburrIdx = completed.findIndex((r) => r.process === 'Deburring');
      completed.splice(deburrIdx >= 0 ? deburrIdx : completed.length, 0, { process: 'Countersinking' });
    }

    // Surface Treatment: only when the drawing calls out a coating, or the substrate
    // is a known carbon/mild steel that corrodes bare. An unknown/pending material is
    // MISSING INFORMATION, not a coating requirement — inventing a treatment op there
    // adds phantom cost to quotes. The material-pending state is surfaced separately.
    const substrate = classifySubstrate(`${ctx.materialGrade ?? ''} ${ctx.material ?? ''}`);
    const coatingSpecified =
      !!ctx.coating?.trim() && !/^(none|n\/?a|nil|-)$/i.test(ctx.coating.trim());
    if (
      (coatingSpecified || substrate === 'carbon_steel') &&
      !completed.some((r) => r.process === 'Surface Treatment')
    ) {
      completed.push({ process: 'Surface Treatment' });
    }

    // Inspection: always present for sheet metal (eMithran "Quality" step)
    if (!completed.some((r) => r.process === 'Inspection')) {
      completed.push({ process: 'Inspection' });
    }
  } else if (family === 'cnc_turned') {
    if (!processes.has('CNC Turning') && !processes.has('CNC Machining')) {
      completed.unshift({ process: 'CNC Turning' });
    }
    if (!processes.has('Deburring')) completed.push({ process: 'Deburring' });
  } else if (family === 'mill_turn') {
    if (!processes.has('CNC Turning')) {
      const firstOp = completed.findIndex((r) => r.process !== 'Manufacturing');
      completed.splice(firstOp >= 0 ? firstOp : 0, 0, { process: 'CNC Turning' });
    }
    if (!processes.has('CNC Milling') && !processes.has('CNC Machining')) {
      const turnIdx = completed.findIndex((r) => r.process === 'CNC Turning');
      completed.splice(turnIdx >= 0 ? turnIdx + 1 : completed.length, 0, { process: 'CNC Milling' });
    }
    if (!processes.has('Deburring')) completed.push({ process: 'Deburring' });
  } else if (family === 'cnc_milled') {
    if (!processes.has('CNC Milling') && !processes.has('CNC Machining')) {
      completed.unshift({ process: 'CNC Milling' });
    }
    if (!processes.has('Deburring')) completed.push({ process: 'Deburring' });
  } else if (family === 'injection_molded') {
    // Mirror backend routing-engine.ts rules — same precedence, same conservative defaults.
    // Gate type unknown → cold edge gate → Gate Trimming always routed (conservative).
    // Hot-tip suppression is a Phase-2 signal.

    const hasDrying = processes.has('Material Drying');
    const hasMolding = [...processes].some((p) => p.includes('Moulding') || p.includes('Molding'));
    const hasGateTrim = processes.has('Gate Trimming');
    const hasInspection = processes.has('Inspection');

    if (!hasDrying && isHygroscopicResin(ctx.materialGrade)) {
      completed.unshift({ process: 'Material Drying' });
    }

    if (!hasMolding) {
      const dryIdx = completed.findIndex((r) => r.process === 'Material Drying');
      completed.splice(dryIdx >= 0 ? dryIdx + 1 : 0, 0, { process: 'Injection Moulding' });
    }

    if (!hasGateTrim) {
      const moldIdx = completed.findIndex((r) => r.process.includes('Moulding') || r.process.includes('Molding'));
      completed.splice(moldIdx >= 0 ? moldIdx + 1 : completed.length, 0, { process: 'Gate Trimming' });
    }

    if (!hasInspection) completed.push({ process: 'Inspection' });
  }

  return completed;
}

// ── buildProcessTree ───────────────────────────────────────────────────────────

function buildProcessTree(
  item: BOMItem,
  fg: FeatureGraph | null,
  summary: FeatureGraphSummary,
  factory: string,
  overrideProcesses?: string[],
  cost?: CostSummaryDto | null,
): ProcessTreeNode {
  const family = resolveDisplayFamily(item, fg);
  const groupLabel = FAMILY_GROUP[family] ?? 'Manufacturing';
  const baseRecs = overrideProcesses?.map((p) => ({ process: p, estimated_time_sec: null as number | null }))
    ?? fg?.processRecommendations
    ?? [];
  const recs = autoCompleteRoute(baseRecs, family, summary, {
    materialGrade: item.materialGrade ?? null,
    material: item.material ?? null,
    coating: item.coating ?? null,
  });

  const substrate = classifySubstrate(`${item.materialGrade ?? ''} ${item.material ?? ''}`);
  const routeHasCoating = recs.some((r) => r.process === 'Surface Treatment');
  // CMM only on GD&T callouts or tolerance ≤ 0.10 mm — same gate as the backend
  // feature graph (feature-graph.service.ts). General-tolerance parts get manual.
  const gdtCallouts = (item.drawingIntelligence?.gdt_callouts ?? []).filter(
    (g) => typeof g.tolerance === 'number' && g.tolerance > 0,
  );
  const needsCmm =
    gdtCallouts.length > 0 ||
    (item.tightestToleranceMm != null && item.tightestToleranceMm > 0 && item.tightestToleranceMm <= 0.10);

  const operations: ProcessTreeNode[] = recs.map((rec, opIdx) => {
    const isSheetMetal = family === 'sheet_metal';
    const isCutting = rec.process.includes('Laser') || rec.process.includes('Cutting');
    const isBending = rec.process.includes('Press Brake') || rec.process.includes('Bending');
    const isTurning = rec.process.includes('Turning');
    const isMilling = !isTurning && (rec.process.includes('Milling') || rec.process.includes('Machining'));
    const isMolding = rec.process.includes('Moulding') || rec.process.includes('Molding');

    // Only the real, DB-resolved machine from the live cost engine is ever
    // shown here — no fabricated placeholder. Matched by EXACT process name
    // against cost.processLines[].process (both machineName and
    // machineClass are read straight off that same real, backend-resolved
    // line — nothing here classifies or guesses a machine class from the
    // process label). This used to hardcode a family lookup ('Cutting' ->
    // always 'Laser Cutting') that silently pulled the laser's machine onto a
    // Waterjet Cutting step; matching on the actual name this tree is already
    // using (rec.process, itself now sourced from the applied route when one
    // exists — see appliedRouteProcessNames at the buildProcessTree call site)
    // removes the guesswork entirely instead of trading one guess for another.
    // A machine that hasn't been resolved yet shows '—', never a plausible-
    // looking specific spec (e.g. "Fiber Laser 6kW") that was never selected.
    const matchedCostLine = cost?.processLines?.find((l) => l.process === rec.process);
    const realMachineName = matchedCostLine?.machineName ?? null;
    const machine = rec.process === 'Inspection'
      ? (needsCmm ? 'CMM' : 'Inspection Bench')
      : realMachineName ?? '—';
    const subLabel = SUB_OP[rec.process] ?? 'As Processed';
    const featureNodes: ProcessTreeNode[] = [];

    // For CNC parts: which feature groups belong to this operation
    const OP_GROUPS: Record<string, string[]> = {
      turning:  ['Turning', 'Boring'],
      milling:  (family as string) === 'mill_turn' ? ['Cross-Drilling', 'Milling', 'Finishing'] : ['Turning', 'Boring', 'Cross-Drilling', 'Milling', 'Finishing'],
      drilling: ['Cross-Drilling'],
    };
    const ALL_CNC_GROUPS: Array<{ label: string; types: string[] }> = [
      { label: 'Turning',        types: ['external_diameter', 'groove', 'fillet'] },
      { label: 'Boring',         types: ['through_hole', 'blind_hole'] },
      { label: 'Cross-Drilling', types: ['cross_hole', 'pcd_hole_pattern'] },
      { label: 'Milling',        types: ['slot', 'radial_slot', 'keyway', 'pocket'] },
      { label: 'Finishing',      types: ['counterbore', 'countersink', 'chamfer'] },
    ];

    if (isSheetMetal && isCutting) {
      const flatFeat = (fg?.features ?? []).find((f) => f.type === 'flat_pattern') ?? null;
      const holeFeats = (fg?.features ?? []).filter((f) => f.type === 'hole');

      let flatNode: ProcessTreeNode | null = null;
      if (flatFeat) {
        flatNode = featureToTreeNode(flatFeat, factory, machine, cost, rec.process);
      } else if (summary.flatPatternAreaMm2 > 0) {
        const cutTimeSec = realCutTimeSec(cost, rec.process);
        flatNode = {
          id: 'feat_flat', kind: 'feature', label: 'Flat Pattern', factory, machine,
          attrs: [
            { name: 'Area', value: `${fmtInt(summary.flatPatternAreaMm2)} mm²` },
            ...(summary.cutLengthMm > 0 ? [{ name: 'Cut Length', value: `${fmt(summary.cutLengthMm, 0)} mm` }] : []),
            ...(summary.pierceCount > 0 ? [
              { name: 'Lead-ins', value: String(summary.pierceCount) },
              { name: 'Lead-outs', value: String(summary.pierceCount) },
            ] : []),
            // realCutTimeSec only ever resolves a real number when the matched
            // cost line has a per-feature breakdown — correctly returns null
            // (never a fabricated guess) for a cutting process with no such
            // breakdown yet. The label names whichever process actually
            // matched the real cost line (falling back to rec.process, itself
            // the real applied-route name, not a guess) instead of a
            // hardcoded process-family list.
            { name: `Est. ${matchedCostLine?.process ?? rec.process} Time`, value: formatEstCycleTime(cutTimeSec) },
          ],
        };
      }

      // Every hole feature — grouped-by-diameter ("symmetric" repeats) and any
      // ungrouped/one-off ("asymmetric") hole below in the SECONDARY/TERTIARY
      // fallbacks alike — nests under Flat Pattern instead of showing as its
      // own top-level row: a dozen+ separate "Ø1.6 × 24" / "Ø2.5 × 10" / ...
      // siblings cluttered the tree. Each is still individually selectable,
      // just as a child. Flat Pattern's own Cut Length/Pierce Count attrs
      // above already sum every real hole via the backend's
      // _compute_cut_length, so this nesting only ever changes display, never
      // the cost-accuracy number itself.
      const holeNodes: ProcessTreeNode[] = [];
      const holeGroups = summary.holeGroups ?? [];
      if (holeGroups.length > 0) {
        // PRIMARY: pre-grouped from CAD engine — diameter guaranteed correct
        holeGroups.forEach((g) => {
          holeNodes.push({
            id: g.id ?? `hole_d${g.diameter_mm.toFixed(1)}_c${g.count}`, kind: 'feature',
            label: `Ø${g.diameter_mm.toFixed(1)} × ${g.count}`,
            factory, machine,
            holeDiameterMm: g.diameter_mm,
            attrs: [
              { name: 'Diameter',        value: `${g.diameter_mm.toFixed(1)} mm` },
              { name: 'Count',           value: String(g.count) },
              { name: 'Process',         value: 'Laser Pierce' },
              { name: 'Est. Cycle Time', value: formatEstCycleTime(realPierceCycleTimeSec(g.count, cost), true) },
            ],
          });
        });
      } else if (holeFeats.length > 0) {
        // SECONDARY: stored HoleFeature objects (may have null diameter on old DB entries)
        holeFeats.forEach((f) => holeNodes.push(featureToTreeNode(f, factory, machine, cost, rec.process)));
      } else {
        // TERTIARY: flat diameter list → group on the fly
        const diameters = summary.holeDiameters ?? [];
        if (diameters.length > 0) {
          const diaGroups: Record<string, number> = {};
          for (const d of diameters) { const k = d.toFixed(1); diaGroups[k] = (diaGroups[k] ?? 0) + 1; }
          Object.entries(diaGroups).forEach(([d, count], i) => {
            holeNodes.push({
              id: `feat_hole_d${i}`, kind: 'feature', label: `Ø${d} × ${count}`, factory, machine,
              holeDiameterMm: parseFloat(d),
              attrs: [
                { name: 'Diameter',        value: `${d} mm` },
                { name: 'Count',           value: String(count) },
                { name: 'Process',         value: 'Laser Pierce' },
                { name: 'Est. Cycle Time', value: formatEstCycleTime(realPierceCycleTimeSec(count, cost), true) },
              ],
            });
          });
        } else if (summary.holeCount > 0) {
          holeNodes.push({
            id: 'feat_holes', kind: 'feature', label: `Holes (${summary.holeCount})`, factory, machine,
            attrs: [{ name: 'Count', value: String(summary.holeCount) }, { name: 'Process', value: 'Laser' }],
          });
        }
      }

      if (flatNode) {
        if (holeNodes.length > 0) flatNode.children = holeNodes;
        featureNodes.push(flatNode);
      } else {
        // No flat-pattern data at all (rare) — still surface hole info rather
        // than silently dropping it with no parent to nest under.
        featureNodes.push(...holeNodes);
      }

    } else if (isSheetMetal && isBending && summary.bendCount > 0) {
      const bendFeats = (fg?.features ?? []).filter((f) => f.type === 'bend');
      if (bendFeats.length > 0) {
        bendFeats.forEach((f) => featureNodes.push(featureToTreeNode(f, factory, machine, cost, rec.process)));
      } else {
        const radii = summary.bendRadii ?? [];
        if (radii.length > 0) {
          const radGroups: Record<string, number> = {};
          for (const r of radii) { const k = r.toFixed(1); radGroups[k] = (radGroups[k] ?? 0) + 1; }
          Object.entries(radGroups).forEach(([r, count], i) => {
            featureNodes.push({
              id: `feat_bend_r${i}`, kind: 'feature', label: `R${r} × ${count}`, factory, machine,
              attrs: [
                { name: 'Radius', value: `${r} mm` },
                { name: 'Count', value: String(count) },
                { name: 'PB Hits', value: String(count) },
                { name: 'Est. Cycle Time', value: formatEstCycleTime(realBendCycleTimeSec(count, parseFloat(r), cost)) },
              ],
            });
          });
        } else {
          featureNodes.push({
            id: 'feat_bends', kind: 'feature', label: `Bends × ${summary.bendCount}`, factory, machine,
            attrs: [
              { name: 'Count', value: String(summary.bendCount) },
              { name: 'PB Hits', value: String(summary.bendCount) },
              { name: 'Est. Cycle Time', value: formatEstCycleTime(realBendCycleTimeSec(summary.bendCount, null, cost), true) },
            ],
          });
        }
      }
    } else if (isTurning || isMilling) {
      const cncFts = (fg as any)?.cnc_features;
      if (cncFts) {
        const cncSum: Record<string, number> = cncFts.feature_summary ?? {};
        const cncFeatureArr: any[] = cncFts.features ?? [];
        const opKey = isTurning ? 'turning' : 'milling';
        const allowedGroupLabels = new Set(OP_GROUPS[opKey] ?? []);
        ALL_CNC_GROUPS
          .filter(({ label }) => allowedGroupLabels.has(label))
          .forEach(({ label, types }) => {
            const groupCount = types.reduce((s, t) => s + (cncSum[t] ?? 0), 0);
            if (groupCount === 0) return;
            const diaMap: Record<string, number> = {};
            for (const f of cncFeatureArr) {
              if (!types.includes(f.type)) continue;
              const d = f.params?.diameter_mm;
              if (d != null) { const k = `Ø${Number(d).toFixed(1)}`; diaMap[k] = (diaMap[k] ?? 0) + 1; }
            }
            const diaAttrs = Object.entries(diaMap)
              .sort(([a], [b]) => parseFloat(a.slice(1)) - parseFloat(b.slice(1)))
              .slice(0, 4)
              .map(([d, c]) => ({ name: d, value: `×${c}` }));
            featureNodes.push({
              id: `cnc_${opKey}_${label.toLowerCase().replace(/[^a-z]/g, '_')}`,
              kind: 'feature' as const,
              label: `${label} ×${groupCount}`,
              factory,
              machine,
              attrs: [{ name: 'Count', value: String(groupCount) }, ...diaAttrs],
            });
          });
      } else if (isMilling && summary.holeCount > 0) {
        featureNodes.push({
          id: 'feat_holes_m', kind: 'feature', label: `Holes (${summary.holeCount})`, factory, machine,
          attrs: [{ name: 'Count', value: String(summary.holeCount) }, { name: 'Process', value: 'Drilling' }],
        });
      }
    } else if (isMolding) {
      // ── In-cycle sub-ops as feature nodes ──────────────────────────────────
      // Each step in the molding cycle gets its own feature row so the cost
      // engineer can see WHAT drives cycle time without opening the cost panel.
      const wall = summary.wallThicknessNominalMm ?? 2.0;
      const wallMin = summary.wallThicknessMinMm;
      const wallMax = summary.wallThicknessMaxMm;
      const bossCount = summary.holeOrBossCount ?? 0;
      const ribCount = (summary as any).ribCount ?? (summary as any).ribCountProxy ?? 0;
      const volMm3 = (item.volume as number | null | undefined) ?? 0;
      const densityGcm3 = 1.15; // PA66 default for mass estimate display
      const massG = volMm3 > 0 ? Math.round((volMm3 / 1e3) * densityGcm3 * 10) / 10 : 0;
      const undercutCount = (summary as any).undercutFaceCount ?? 0;
      const undraftedCount = (summary as any).undraftedFaceCount ?? 0;
      const partingComplexity = (summary as any).partingComplexity ?? null;

      featureNodes.push({
        id: 'feat_im_setup', kind: 'feature', label: 'Mold Setup',
        factory, machine,
        attrs: [
          { name: 'Std. time',  value: '60 min (amortized per batch)' },
          { name: 'Cavities',   value: 'Estimated from clamp tonnage + batch (see Cost tab)' },
          { name: 'Includes',   value: 'Mount mold, clamp, trial shots, process stabilization' },
        ],
      });
      featureNodes.push({
        id: 'feat_im_injection', kind: 'feature', label: 'Injection (Fill)',
        factory, machine,
        attrs: [
          { name: 'Fill time', value: 'Computed via flow-length model (see Cost tab)' },
          { name: 'Gate',      value: 'Auto-recommended from geometry + material (see Cost tab)' },
        ],
      });
      featureNodes.push({
        id: 'feat_im_packing', kind: 'feature', label: 'Packing / Holding',
        factory, machine,
        attrs: [
          { name: 'Hold time', value: '35% of cooling time (gate-freeze proxy — Menges)' },
          { name: 'Purpose',   value: 'Compensate volumetric shrinkage; prevent sink marks' },
        ],
      });
      featureNodes.push({
        id: 'feat_im_cooling', kind: 'feature', label: 'Cooling',
        factory, machine,
        attrs: [
          { name: 'Cool time', value: 'Menges formula: t = (wall²/π²α) × ln(4(Tm-Tw)/π(Te-Tw))' },
          { name: 'Wall (nom)', value: `${fmt(wall, 1)} mm` },
          ...(wallMin != null && wallMax != null
            ? [{ name: 'Wall range', value: `${fmt(wallMin, 1)} – ${fmt(wallMax, 1)} mm` }]
            : []),
          { name: 'Note', value: 'Uniform wall → shorter cycle; thick bosses/ribs → longer' },
        ],
      });
      featureNodes.push({
        id: 'feat_im_ejection', kind: 'feature', label: 'Ejection',
        factory, machine,
        attrs: [{ name: 'Eject time', value: '~2.5 sec (mold open + ejector stroke + part release)' }],
      });
      featureNodes.push({
        id: 'feat_im_part', kind: 'feature', label: 'Moulded Part',
        factory, machine,
        attrs: [
          { name: 'Volume',    value: volMm3 > 0 ? `${fmtInt(volMm3)} mm³` : '—' },
          { name: 'Est. mass', value: massG > 0 ? `${massG} g (net part)` : '—' },
          { name: 'Wall nom.', value: `${fmt(wall, 1)} mm` },
          ...(partingComplexity != null ? [{ name: 'Parting complexity', value: `${Math.round(partingComplexity * 100)}%` }] : []),
          ...(bossCount > 0 ? [{ name: 'Bosses / holes', value: String(bossCount) }] : []),
          ...(ribCount > 0  ? [{ name: 'Ribs (detected)', value: String(ribCount) }] : []),
        ],
      });

      // ── DFM feature nodes — clickable → 3D face highlighting ─────────────
      if (undercutCount > 0) {
        featureNodes.push({
          id: 'feat_im_undercut', kind: 'feature', label: `Undercuts (${undercutCount} face${undercutCount > 1 ? 's' : ''})`,
          factory, machine,
          attrs: [
            { name: 'Severity', value: 'High — requires slide or lifter' },
            { name: 'Back-angle', value: '>5° opposing pull direction' },
            { name: 'Action', value: 'Click to highlight in 3D viewer' },
          ],
        });
      }
      if (undraftedCount > 0) {
        featureNodes.push({
          id: 'feat_im_undrafted', kind: 'feature', label: `Undrafted Faces (${undraftedCount})`,
          factory, machine,
          attrs: [
            { name: 'Severity', value: 'Medium — ejection stick risk' },
            { name: 'Draft angle', value: '<0.3° (below industry minimum)' },
            { name: 'Action', value: 'Click to highlight in 3D viewer' },
          ],
        });
      }
    }

    // ── Secondary operation feature nodes (KB-backed) ─────────────────────────

    const isTapping = rec.process === 'Tapping';
    const isSurfaceTreatment = rec.process === 'Surface Treatment';
    const isInspection = rec.process === 'Inspection';
    const isMaterialDrying = rec.process === 'Material Drying';
    const isGateTrimming = rec.process === 'Gate Trimming';

    if (isMaterialDrying) {
      const grade = (item.materialGrade ?? item.material ?? '').toUpperCase();
      const dryParams: Record<string, { temp: string; time: string; target: string }> = {
        PA66: { temp: '80°C',  time: '4 h',  target: '<0.20% moisture' },
        PA6:  { temp: '80°C',  time: '4 h',  target: '<0.20% moisture' },
        PC:   { temp: '120°C', time: '4 h',  target: '<0.02% moisture' },
        ABS:  { temp: '80°C',  time: '2–3 h', target: '<0.10% moisture' },
        PET:  { temp: '160°C', time: '4 h',  target: '<0.02% moisture' },
        PBT:  { temp: '120°C', time: '3 h',  target: '<0.04% moisture' },
        PEEK: { temp: '150°C', time: '3 h',  target: '<0.02% moisture' },
        TPU:  { temp: '90°C',  time: '2 h',  target: '<0.05% moisture' },
        PMMA: { temp: '80°C',  time: '4 h',  target: '<0.10% moisture' },
      };
      const key = Object.keys(dryParams).find((k) => grade.includes(k));
      const params = key ? dryParams[key]! : null;
      featureNodes.push({
        id: 'feat_im_dry_resin', kind: 'feature', label: 'Hygroscopic Resin — Pre-Drying',
        factory, machine,
        attrs: [
          { name: 'Material',  value: item.materialGrade ?? item.material ?? '—' },
          { name: 'Dryer',     value: 'Dehumidifying hopper dryer (unattended operation)' },
          ...(params
            ? [
                { name: 'Temp',    value: params.temp },
                { name: 'Time',    value: params.time },
                { name: 'Target',  value: params.target },
              ]
            : [{ name: 'Params', value: 'Refer to material datasheet (grade not in table)' }]),
          { name: 'Risk if skipped', value: 'Splay / voids / hydrolysis / loss of mechanical properties' },
        ],
      });
    }

    if (isGateTrimming) {
      featureNodes.push({
        id: 'feat_im_gate', kind: 'feature', label: 'Gate Vestige',
        factory, machine,
        attrs: [
          { name: 'Gate type',  value: 'Cold runner gate (auto-recommended from geometry — see Cost tab)' },
          { name: 'Vestige',    value: 'Trim flush to part surface; max protrusion per drawing' },
          { name: 'Note',       value: 'Hot-tip / sub gates self-de-gate (this step suppressed for those types)' },
        ],
      });
    }

    if (isTapping) {
      const threadSpecs = (item.drawingIntelligence as any)?.threads as Array<{ size: string; pitch: number; count: number }> | undefined;
      const tappingHint = threadSpecs && threadSpecs.length > 0
        ? threadSpecs.map((t) => {
            const intel = getThreadIntelligence(t.size, t.pitch);
            const drill = intel.tapDrillMm != null ? ` | Tap drill: Ø${intel.tapDrillMm}` : '';
            return `${t.size} pitch ${t.pitch}mm ×${t.count}${drill}`;
          }).join('; ')
        : 'Requires drawing review';
      featureNodes.push({
        id: 'feat_tapping', kind: 'feature',
        label: 'Potential tapping features',
        factory, machine,
        attrs: [
          { name: 'Basis',           value: `Ø≤6 mm holes present, thickness ${fmt(summary.sheetThicknessMm, 1)} mm < 3 mm` },
          { name: 'Thread callouts', value: tappingHint },
          { name: 'Class of fit',    value: threadSpecs && threadSpecs.length > 0 ? '6H (ISO 965-1)' : '—' },
          { name: 'Inspection',      value: threadSpecs && threadSpecs.length > 0 ? 'Go/No-Go Thread Gauge' : 'Confirm from drawing' },
        ],
      });
    }

    if (isSurfaceTreatment) {
      const matStr = `${item.materialGrade ?? ''} ${item.material ?? ''}`.trim();
      const materialUnknownHere = matStr.length === 0;
      const coatingKey = resolveTreatmentKey(substrate, item.coating);
      const steps = SURFACE_TREATMENT_KB[coatingKey] ?? [];
      steps.forEach((step, i) => {
        const attrs = materialUnknownHere && i === 0
          ? [...step.attrs, { name: 'Note', value: 'Material unknown — verify treatment type from drawing' }]
          : step.attrs;
        featureNodes.push({ id: `feat_surface_${i}`, kind: 'feature', label: step.label, factory, machine: step.machine ?? machine, attrs });
      });
    }

    if (isInspection) {
      if (family === 'injection_molded') {
        // Injection-molded QC: visual → dimensional → weight check (routing engine baseline).
        featureNodes.push({
          id: 'feat_im_visual', kind: 'feature', label: 'Visual Inspection',
          factory, machine,
          attrs: [
            { name: 'Check for', value: 'Splay, sink marks, short shots, flash, colour streaks, weld lines' },
            { name: 'Method',    value: '100% visual (operator)' },
            { name: 'Est. time', value: '~10 sec / part' },
          ],
        });
        featureNodes.push({
          id: 'feat_im_dimensional', kind: 'feature', label: 'Dimensional Inspection',
          factory, machine,
          attrs: [
            { name: 'Scope',     value: 'Critical dimensions vs drawing — shrinkage compensation verification' },
            { name: 'Method',    value: 'Calipers + height gauge; CMM for GD&T callouts' },
            { name: 'Frequency', value: 'First article + 1-in-10 in-process' },
            { name: 'Est. time', value: '~5 min / batch setup + per-part criticals' },
          ],
        });
        featureNodes.push({
          id: 'feat_im_weight', kind: 'feature', label: 'Weight Check',
          factory, machine,
          attrs: [
            { name: 'Method',  value: 'Precision scale (±0.1 g)' },
            { name: 'Purpose', value: 'Shot weight monitoring — detects short shots and pack pressure drift' },
            { name: 'Est. time', value: '~5 sec / part' },
          ],
        });
      } else {
        // Coating-thickness check exists only when the route actually coats the part;
        // CMM only when GD&T / tight tolerance demands it (needsCmm computed above).
        const templates: KBFeature[] = [
          needsCmm ? INSPECTION_KB.dimensional_cmm! : INSPECTION_KB.dimensional!,
          INSPECTION_KB.visual!,
          ...(routeHasCoating ? [INSPECTION_KB.coating_thickness!] : []),
        ];
        templates.forEach((tmpl, i) => {
          featureNodes.push({ id: `feat_insp_${i}`, kind: 'feature', label: tmpl.label, factory, machine: tmpl.machine ?? machine, attrs: tmpl.attrs });
        });
      }
    }

    const subOp: ProcessTreeNode = {
      id: `subop_${opIdx}`, kind: 'sub_op', label: subLabel,
      ...(featureNodes.length > 0 ? { children: featureNodes } : {}),
    };
    return { id: `op_${opIdx}`, kind: 'operation', label: rec.process, factory, machine, children: [subOp] };
  });

  // Inject Threaded Features from drawing intelligence for CNC families
  const isCNCFamily = family !== 'sheet_metal' && family !== 'injection_molded';
  const diThreadSpecs = isCNCFamily
    ? ((item.drawingIntelligence as any)?.threads as Array<{ size: string; pitch: number; count: number }> | undefined)
    : undefined;
  if (diThreadSpecs && diThreadSpecs.length > 0) {
    const threadChildren: ProcessTreeNode[] = diThreadSpecs.map((t, i) => ({
      id: `thread_di_${i}`,
      kind: 'feature' as const,
      label: `${t.size} ×${t.count}`,
      factory,
      machine: 'Tapping Machine',
      source: 'drawing_intelligence',
      attrs: [
        { name: 'Specification', value: `${t.size} × ${t.pitch}` },
        { name: 'Count',         value: String(t.count) },
        { name: 'Operation',     value: /helicoil/i.test(t.size) ? 'Helicoil Insert' : 'Tapping' },
        { name: 'Inspection',    value: 'Thread Plug Gauge' },
      ],
    }));
    const threadSubOp: ProcessTreeNode = {
      id: 'subop_threads',
      kind: 'sub_op',
      label: 'Thread Features',
      children: threadChildren,
    };
    const deburrIdx = operations.findIndex((op) => op.label === 'Deburring');
    operations.splice(deburrIdx >= 0 ? deburrIdx : operations.length, 0, {
      id: 'op_threads',
      kind: 'operation',
      label: 'Threaded Features',
      factory,
      machine: 'Tapping Machine',
      children: [threadSubOp],
    });
  }

  return {
    id: 'root', kind: 'part', label: item.name, factory,
    children: operations.length > 0
      ? [{ id: 'grp_0', kind: 'group', label: groupLabel, factory, children: operations }]
      : [],
  };
}

// ── Operation → 3D highlight helpers ──────────────────────────────────────────

function mergeFeaturesToHL(id: string, features: FeatureNodeV2[]): FeatureNodeV2 | null {
  if (!features.length) return null;
  const first = features[0]!;
  const occurrences = features.flatMap((f) =>
    f.occurrences.map((occ) => ({ centroid: occ.centroid, face_ids: occ.face_ids })),
  );
  return { id, feature_type: first.feature_type, occurrences };
}

// ── Operation-specific visualization ─────────────────────────────────────────
// Each operation gets a semantically correct face set AND a distinct color.
// Only hole/bend FEATURE nodes use the existing selectedV2Feature chain (unchanged).

type OperationVisual = { highlight: FeatureNodeV2; color: string } | null;

function buildFullModelHL(id: string, faceMap: FaceMapEntry[]): FeatureNodeV2 | null {
  if (!faceMap.length) return null;
  return { id, feature_type: 'hole', occurrences: [{ centroid: [0, 0, 0] as [number, number, number], face_ids: faceMap.map((e) => e.face_id) }] };
}

function computeOperationVisual(
  label: string,
  v2Features: FeatureNodeV2[],
  faceMap: FaceMapEntry[],
): OperationVisual {
  const l = label.toLowerCase();
  const merge = (id: string, feats: FeatureNodeV2[], color: string): OperationVisual => {
    const hl = mergeFeaturesToHL(id, feats);
    return hl ? { highlight: hl, color } : null;
  };
  if (l.includes('laser') || l.includes('cutting') || l.includes('punch') || l.includes('waterjet'))
    return merge('op-cutting', v2Features.filter((f) => f.feature_type === 'hole' || f.feature_type === 'cut_profile'), '#3b82f6');
  if (l.includes('press brake') || l.includes('bending'))
    return merge('op-bending', v2Features.filter((f) => f.feature_type === 'bend'), '#eab308');
  if (l.includes('tapping'))
    return merge('op-tapping',
      v2Features.filter((f) => f.feature_type === 'hole' && (f.diameter_mm ?? 99) <= 6.0), '#a855f7');
  if (l.includes('deburr')) {
    // Phase 2: replace with true edge highlight (EdgeHighlight component exists in EDrawingsViewer)
    return merge('op-deburr',
      v2Features.filter((f) => f.feature_type === 'hole' || f.feature_type === 'bend'), '#06b6d4');
  }
  if (l.includes('surface treatment') || l.includes('coating')) {
    const hl = buildFullModelHL('op-surface', faceMap);
    return hl ? { highlight: hl, color: '#93c5fd' } : null;
  }
  if (l.includes('inspection')) {
    return merge('op-inspection', v2Features, '#e2e8f0');
  }
  if (l.includes('turning') || l.includes('milling') || l.includes('machining'))
    return merge('op-all', v2Features, '#64748b');
  // ── Injection molding operations ──
  if (l.includes('material drying') || l.includes('drying'))
    return null; // Pre-process — no part geometry involved yet
  if (l.includes('injection mould') || l.includes('injection mold')) {
    const hl = buildFullModelHL('op-injection', faceMap);
    return hl ? { highlight: hl, color: '#f97316' } : null; // orange — molten cavity fill
  }
  if (l.includes('gate trimming') || l.includes('degating')) {
    const hl = buildFullModelHL('op-gate-trim', faceMap);
    return hl ? { highlight: hl, color: '#eab308' } : null; // yellow — secondary bench op
  }
  return null;
}

function computeFeatureNodeVisual(
  node: ProcessTreeNode,
  v2Features: FeatureNodeV2[],
  faceMap: FaceMapEntry[],
): OperationVisual {
  const l = node.label.toLowerCase();
  const merge = (id: string, feats: FeatureNodeV2[], color: string): OperationVisual => {
    const hl = mergeFeaturesToHL(id, feats);
    return hl ? { highlight: hl, color } : null;
  };
  if (node.id === 'feat_tapping')
    return merge('hl-tapping',
      v2Features.filter((f) => f.feature_type === 'hole' && (f.diameter_mm ?? 99) <= 6.0), '#a855f7');
  if (node.id.startsWith('feat_surface_')) {
    const hl = buildFullModelHL('hl-surface', faceMap);
    if (!hl) return null;
    const color = l.includes('zinc') ? '#86efac' : '#93c5fd';
    return { highlight: hl, color };
  }
  if (node.id.startsWith('feat_insp_')) {
    if (l.includes('dimensional'))
      return merge('hl-dimensional', v2Features, '#e2e8f0');
    // Visual Inspection + Coating Thickness Check → full model tint
    const hl = buildFullModelHL('hl-inspect-surface', faceMap);
    return hl ? { highlight: hl, color: '#e2e8f0' } : null;
  }
  // ── Injection molding feature nodes ──
  if (node.id === 'feat_im_part' || node.id === 'feat_im_injection' || node.id === 'feat_im_cooling') {
    const hl = buildFullModelHL('hl-im-part', faceMap);
    return hl ? { highlight: hl, color: '#f97316' } : null; // orange — molded geometry
  }
  if (node.id === 'feat_im_gate') {
    const hl = buildFullModelHL('hl-im-gate', faceMap);
    return hl ? { highlight: hl, color: '#eab308' } : null; // yellow — gate location
  }
  if (node.id === 'feat_im_visual' || node.id === 'feat_im_dimensional' || node.id === 'feat_im_weight') {
    const hl = buildFullModelHL('hl-im-inspect', faceMap);
    return hl ? { highlight: hl, color: '#e2e8f0' } : null; // light — quality overlay
  }
  if (node.id === 'feat_im_dry_resin') return null; // Pre-process — no geometry
  // Individual hole-diameter-group rows ("Ø1.6 × 24") nested under Flat
  // Pattern — previously fell through every branch above to `return null`,
  // so clicking one never highlighted anything at all. Match by diameter
  // (tagged on the node at build time) rather than parsing the label.
  if (node.holeDiameterMm != null) {
    // Round both sides to 1dp before comparing — summary.holeGroups and
    // feature_graph_v2.features are computed by two separate backend calls
    // that both round to 1dp with the same formula, but comparing raw floats
    // risks a spurious mismatch from binary floating-point representation
    // (e.g. 1.6 stored as 1.5999999999999999 on one side).
    const targetD = Math.round(node.holeDiameterMm * 10) / 10;
    const matches = v2Features.filter(
      (f) => f.feature_type === 'hole' && f.diameter_mm != null && Math.round(f.diameter_mm * 10) / 10 === targetD,
    );
    const hl = mergeFeaturesToHL(`hl-hole-${targetD}`, matches);
    if (hl) return { highlight: hl, color: '#3b82f6' };
    // No v2 occurrence matched this diameter (e.g. stale/out-of-sync feature
    // graph data) — fall back to the full-model tint rather than nothing,
    // same convention Flat Pattern's own highlight below uses.
    const full = buildFullModelHL(`hl-hole-${targetD}`, faceMap);
    return full ? { highlight: full, color: '#3b82f6' } : null;
  }
  if (node.label === 'Flat Pattern') {
    // The complete laser-cutting operation: every hole (every diameter group
    // — "symmetric" repeats — and any one-off/ungrouped "asymmetric" hole
    // alike) TOGETHER WITH every real cut boundary's side-wall faces
    // ('cut_profile' — every panel's outer perimeter AND any cutout in it,
    // whatever shape it is — what the laser actually cuts along, not the
    // flat panel surface itself), merged into one highlight. Falls back to
    // the full-model tint only when the part has neither (e.g.
    // feature_graph_v2 not yet computed for this part), so clicking Flat
    // Pattern always shows something.
    const cutFeatures = v2Features.filter((f) => f.feature_type === 'hole' || f.feature_type === 'cut_profile');
    const holeHl = mergeFeaturesToHL('hl-flat-pattern', cutFeatures);
    if (holeHl) return { highlight: holeHl, color: '#38bdf8' }; // sky blue — unfolded blank
    const hl = buildFullModelHL('hl-flat-pattern', faceMap);
    return hl ? { highlight: hl, color: '#38bdf8' } : null;
  }
  return null;
}

function getVizLabel(node: ProcessTreeNode): string | null {
  const l = node.label.toLowerCase();
  if (node.id === 'feat_tapping') return 'Candidate tapped holes (Ø ≤ 6 mm)';
  if (node.id.startsWith('feat_surface_')) {
    if (l.includes('zinc')) return 'Zinc Phosphating — full exterior surface';
    if (l.includes('powder')) return 'Powder Coating — full exterior surface';
    return 'Surface treatment — full exterior surface';
  }
  if (node.id.startsWith('feat_insp_')) {
    if (l.includes('dimensional')) return 'Dimensional Inspection — holes & bends';
    if (l.includes('visual')) return 'Visual Inspection — full exterior surface';
    if (l.includes('coating thickness')) return 'Coating Thickness — full exterior surface';
  }
  if (node.id === 'feat_im_part') return 'Moulded part — full cavity geometry';
  if (node.id === 'feat_im_injection') return 'Cavity fill — full mold geometry';
  if (node.id === 'feat_im_cooling') return 'Cooling — full part surface (wall thickness drives cycle time)';
  if (node.id === 'feat_im_gate') return 'Gate vestige location — full part surface';
  if (node.id === 'feat_im_visual') return 'Visual Inspection — full exterior surface';
  if (node.id === 'feat_im_dimensional') return 'Dimensional Inspection — critical features vs drawing';
  if (node.id === 'feat_im_weight') return 'Weight Check — full part (shot weight monitoring)';
  if (node.kind === 'operation') {
    if (l.includes('laser') || l.includes('cutting')) return 'Pierce holes';
    if (l.includes('press brake') || l.includes('bending')) return 'Bend lines';
    if (l.includes('tapping')) return 'Candidate tapped holes (Ø ≤ 6 mm)';
    if (l.includes('deburr')) return 'All cut edges — holes & bends';
    if (l.includes('surface treatment') || l.includes('coating')) return 'Full exterior surface';
    if (l.includes('inspection')) return 'Holes & bends (geometric features)';
    if (l.includes('injection mould') || l.includes('injection mold')) return 'Cavity + core faces — full mold geometry';
    if (l.includes('gate trimming')) return 'Gate vestige — bench degating operation';
    if (l.includes('material drying')) return null; // pre-process, no geometry
  }
  return null;
}

// ── PanelHeader ────────────────────────────────────────────────────────────────

function PanelHeader({
  title, panelId, maximized, onMaximize, children,
}: {
  title: string;
  panelId: PanelId;
  maximized: PanelId | null;
  onMaximize: (id: PanelId | null) => void;
  children?: React.ReactNode;
}) {
  const isMax = maximized === panelId;
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b bg-muted/40 shrink-0 min-w-0">
      <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground shrink-0">{title}</span>
      <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
      <button
        onClick={() => onMaximize(isMax ? null : panelId)}
        className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
        title={isMax ? 'Restore' : 'Maximize'}
      >
        {isMax ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ── Section ────────────────────────────────────────────────────────────────────

// ── Inline-editable value cell (eMithran-style) ────────────────────────────────

function EditCell({
  value, prefix = '', suffix = '', decimals = 2, fieldKey, editingKey,
  onStartEdit, onCommit, onDismiss, onReset, isOverridden,
}: {
  value: number; prefix?: string; suffix?: string; decimals?: number;
  fieldKey: string; editingKey: string | null;
  onStartEdit: (key: string, currentValue: number) => void;
  onCommit: (key: string, newValue: number) => void;
  onDismiss: () => void;
  onReset: (key: string) => void;
  isOverridden: boolean;
}) {
  const isEditing = editingKey === fieldKey;
  const [draft, setDraft] = useState('');

  const handleStartEdit = () => { setDraft(value.toFixed(decimals)); onStartEdit(fieldKey, value); };
  const handleBlur = () => {
    const n = parseFloat(draft);
    if (!isNaN(n) && n > 0) onCommit(fieldKey, n);
    else onDismiss();
  };

  if (isEditing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { const n = parseFloat(draft); if (!isNaN(n) && n > 0) onCommit(fieldKey, n); else onDismiss(); }
          if (e.key === 'Escape') onDismiss();
        }}
        className="w-24 text-right text-[11px] tabular-nums bg-background border border-violet-500 rounded px-1 py-0 focus:outline-none text-violet-300"
      />
    );
  }

  return (
    <span className="inline-flex items-center gap-0.5 group/edit cursor-pointer" onClick={handleStartEdit}>
      <span className={cn('text-[11px] tabular-nums', isOverridden ? 'text-amber-400' : '')}>
        {prefix}{fmt(value, decimals)}{suffix}
      </span>
      {isOverridden && (
        <button onClick={(e) => { e.stopPropagation(); onReset(fieldKey); }}
          className="opacity-60 hover:opacity-100 text-[9px] text-amber-400 leading-none ml-0.5" title="Reset to calculated">↩</button>
      )}
      {!isOverridden && (
        <span className="opacity-0 group-hover/edit:opacity-60 text-[9px] text-muted-foreground ml-0.5">✏</span>
      )}
    </span>
  );
}

// ── CostSummaryTab — eMithran-style with inline editing ─────────────────────

function CostSummaryTab({
  item, batchSize, appliedRouteId, factory = 'USA', fg, onSelectHighlight,
}: {
  item: BOMItem; batchSize: number; appliedRouteId?: string | null; factory?: string;
  fg?: FeatureGraph | null | undefined;
  onSelectHighlight?: ((node: FeatureNodeV2 | null) => void) | undefined;
}) {
  const { data: cost, isLoading } = useCostSummary(item.id, batchSize, factory);
  const { data: comparison } = useRouteComparison(item.id, batchSize, factory);
  const { data: existingProcRecords, isLoading: isLoadingProcRecords } = useProcessCosts({ bomItemId: item.id, isActive: true, enabled: !!item.id });
  // The caller never actually passes appliedRouteId (see <CostSummaryTab .../>
  // call site) -- it's a leftover prop from when route selection lived only in
  // RouteComparisonCard's own local useState, which resets to null on every
  // reload/navigation and was never wired to this tab at all. That meant
  // `eff.lines` below always fell back to cost.processLines (the cost engine's
  // OWN default-recommended route), so any process class that only exists in
  // a route the engineer manually applied (e.g. Waterjet Cutting, when the
  // engine's own default pick is Laser Cutting) permanently lost the live
  // MachineSelector "Why"/alternatives UI and showed the flat "$X/hr · Edit to
  // change" fallback instead -- even though machine_class/location were both
  // correctly persisted. Recover the REAL applied route from persisted data
  // instead: applyRoute() stamps every inserted row's `notes` with
  // `auto_fill_from_route:${routeId}` specifically for this purpose.
  const persistedAppliedRouteId = useMemo(() => {
    const records = existingProcRecords?.records ?? [];
    for (const rec of records) {
      const m = /^auto_fill_from_route:(.+)$/.exec((rec as any).notes ?? '');
      if (m) return m[1];
    }
    // A Workflow Builder (dynamic/custom) apply stamps `auto_fill_from_
    // custom_route:<itemId>` instead — it never embeds a real routeId the
    // way the simple apply-route path does (see bom-items.controller.ts's
    // applyCustomRoute), so the regex above always missed it and this fell
    // through to `comparison.processLines`' own auto-recommended default
    // (e.g. Laser Cut) — even when the real applied route was, say, Turret
    // Punching. Derive the real routeId from the persisted rows' own
    // machine_class instead, same lookup the restore-effect below uses.
    const isCustomApply = records.some((r: any) => /^auto_fill_from_custom_route:/.test(r.notes ?? ''));
    if (isCustomApply && comparison?.routes) {
      const sorted = [...records].sort((a: any, b: any) => (a.opNbr || 0) - (b.opNbr || 0));
      const classToRouteId = cuttingMachineClassToRouteId(comparison.routes);
      const cuttingClass = sorted[0]?.machineClass as string | undefined;
      if (cuttingClass && classToRouteId[cuttingClass]) return classToRouteId[cuttingClass];
    }
    return null;
  }, [existingProcRecords, comparison]);
  const effectiveAppliedRouteId = appliedRouteId ?? persistedAppliedRouteId;
  const appliedRoute: RouteResultDto | null = effectiveAppliedRouteId
    ? (comparison?.routes.find((r) => r.routeId === effectiveAppliedRouteId) ?? null)
    : null;

  // eMithran-style persistent overrides — sourced from the server response
  // (bom_item_cost_overrides, scoped by BOM item + Digital Factory location),
  // not local useState. Survives refresh and is visible to anyone else who
  // opens this BOM item; previously these were pure client state that vanished
  // on navigation.
  const costOverride = useCostOverride(item.id, factory);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const persistedOverrides = cost?.costOverrides ?? {};
  const matRateOverride = persistedOverrides['mat_rate'] ?? null;
  const procOverrides = useMemo(() => {
    const map: Record<string, { rate?: number; cycleMin?: number }> = {};
    for (const [key, val] of Object.entries(persistedOverrides)) {
      if (key === 'mat_rate') continue;
      const [proc, field] = key.split('::');
      if (!proc || !field) continue;
      map[proc] = { ...map[proc], [field === 'rate' ? 'rate' : 'cycleMin']: val };
    }
    return map;
  }, [cost?.costOverrides]);

  const handleStartEdit = (key: string) => setEditingKey(key);

  const handleCommit = (key: string, val: number) => {
    setEditingKey(null);
    costOverride.mutate({ fieldKey: key, value: val });
  };

  const handleReset = (key: string) => {
    costOverride.mutate({ fieldKey: key, value: null });
  };

  const hasAnyOverride = Object.keys(persistedOverrides).length > 0;

  // Compute effective figures (uses applied route's process lines when a route is selected)
  const eff = useMemo(() => {
    if (!cost) return null;
    const matRate = matRateOverride ?? cost.materialCostPerKg;
    const matCost = matRate * cost.grossWeightKg;
    const scrapLoss = cost.materialRemoval
      ? matRate * (cost.materialRemoval.billetWeightKg - cost.materialRemoval.finishedWeightKg)
      : 0;

    const baseLines = appliedRoute?.processLines ?? cost.processLines;
    const lines = baseLines.map((line) => {
      const ov = procOverrides[line.process] ?? {};
      const rate = ov.rate ?? line.hourlyRate;
      const cycleMin = ov.cycleMin ?? line.cycleTimeMin;
      const runCost = (rate / 60) * cycleMin;
      const setupCost = line.setupCost;
      return { ...line, rate, cycleMin, runCost, setupCost, totalCost: runCost + setupCost };
    });

    const totalProcess = lines.reduce((s, l) => s + l.totalCost, 0);
    const totalCost = matCost + scrapLoss + totalProcess;
    const pct = (v: number) => totalCost > 0 ? (v / totalCost) * 100 : 0;
    return { matRate, matCost, scrapLoss, lines, totalProcess, totalCost, pct };
  }, [cost, appliedRoute, matRateOverride, procOverrides]);

  const [expandedProcs, setExpandedProcs] = useState<Set<string>>(new Set());
  const toggleProc = (key: string) =>
    setExpandedProcs((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });

  // Build classPeers once — shared by the combined process+machine section
  const classPeers = new Map<string, string[]>();
  for (const l of eff?.lines ?? []) {
    if (l.machineSelection) {
      classPeers.set(l.machineClass, [...(classPeers.get(l.machineClass) ?? []), l.process]);
    }
  }

  // ── Stored cost records (for grand total + currency conversion) ─────────
  const { data: storedRawMat } = useRawMaterialCosts({ bomItemId: item.id, isActive: true });
  const { data: storedPackaging } = usePackagingLogisticsCosts({ bomItemId: item.id, isActive: true });
  const { data: storedProcured } = useProcuredPartsCosts({ bomItemId: item.id });
  const { data: storedTooling } = useToolingCosts({ bomItemId: item.id });

  // ── Process dialog (Edit / Add Process) ──────────────────────────────────
  const [procDialogOpen, setProcDialogOpen] = useState(false);
  const [procDialogPrefill, setProcDialogPrefill] = useState<any>(null);
  // True only when the dialog was opened via the Cycle Time calculator icon
  // specifically — makes it land straight on the computed-cycle-time view
  // instead of the plain edit form.
  const [procDialogAutoOpenCalculator, setProcDialogAutoOpenCalculator] = useState(false);
  const createProcCost = useCreateProcessCost();
  const updateProcCost = useUpdateProcessCost();
  const deleteProcCost = useDeleteProcessCost();
  const sortedStoredProcs = [...(existingProcRecords?.records ?? [])].sort((a: any, b: any) => (a.opNbr || 0) - (b.opNbr || 0));

  // NOTE: there used to be an auto-resync effect here that re-linked saved
  // process rows to the current Digital Factory's live machine/labour rates
  // on every Apply. Removed — it raced against reapplyExistingOrDefaultRoute/
  // autoAddProcessCosts (top-level, see runApplyScenario), which ALREADY
  // deactivates and fully recreates every process_cost_records row from the
  // live engine on every non-manual-routing Apply. Two independent processes
  // both mutating the same rows in the same Apply click produced exactly the
  // flip-flopping/inflating numbers this was meant to fix — confirmed live:
  // "Re-synced 6 process rows..." and "Process cost added successfully" x6
  // firing together, one process updating rows the other was mid-deactivating.
  // autoAddProcessCosts's own currency-unit bug (display-currency values sent
  // as if native-local) is the fix that actually matters, and it now lives
  // there, the single place that recreates these rows.

  const handleOpenEditProc = (line: { process: string; machineClass: string; rate: number; cycleMin: number; setupCost: number; hourlyRate: number; labourRate?: number | null; processGroup?: string; processRoute?: string; operation?: string }, index: number, openCalculator = false) => {
    const batchSz = cost?.batchSize ?? 1;
    // Reverse-compute setup time from amortized setupCost — must divide by the
    // SAME combined machine+labor rate the backend used to produce setupCost
    // (eMithranTerms: setupCost = (mhrMin + dlrMin*setupNDL) * setupTimeMin —
    // cost-engine.ts:365), not machine rate alone. Dividing by hourlyRate only
    // silently ignores the labor-rate term, wildly inflating the derived
    // minutes whenever labor rate dwarfs machine rate — confirmed live: Hole
    // Extrusion (Burring)'s machine rate is ~$0.28/hr (India) against a
    // ~$47/hr labor rate, turning a real 5-minute seeded setup into a
    // reverse-derived "1200 minutes" shown in the Edit Process Cost dialog.
    const combinedRate = line.hourlyRate + (line.labourRate ?? 0);
    const setupTimeMins = combinedRate > 0
      ? parseFloat(((line.setupCost * batchSz * 60) / combinedRate).toFixed(1))
      : 0;
    // Look for an existing stored record for this process (match by operation name)
    const existingRecord = existingProcRecords?.records?.find(
      (r: any) => r.operation === line.process || r.processRoute === line.process,
    );
    // No saved record for this line — fall back to the SAME live,
    // machine-selection candidate this row already shows (ms.balanced,
    // the ⭐ pick surfaced in eff.lines) rather than opening the calculator
    // with no machine at all. Without this, a real recommended/manually-
    // selected machine like "Salvagnini L3-30 2KW Fiber" — visibly shown on
    // this exact row — never reaches the dialog, so Machine Capability
    // shows "no machine selected" and power-dependent fields (Cutting
    // Speed, Piercing Time Per Start) can never auto-fill, even though the
    // row itself proves a real candidate is already known.
    const liveCandidate = (line as any).machineSelection?.balanced?.candidate;
    // Inspection (and any other class priced via a flat resource rate rather
    // than the CNC/laser-style machineSelection candidate list) carries its
    // real resolved resource's id directly as line.mhrId/line.benchmarkMhrId
    // (see finalizeInspectionLine in inspection-engine.ts) — machineSelection
    // is simply absent for it, not empty. Falling back to liveCandidate alone
    // dropped that id, so ProcessCostDialog could never pre-select the real
    // machine/benchmark row, and every such line saved as "not linked to a
    // machine" despite a real, priced resource already being used for its rate.
    setProcDialogPrefill(existingRecord ?? {
      opNbr: (index + 1) * 10,
      operation: line.operation || line.process,
      processGroup: line.processGroup || deriveProcessGroupFromMachineClass(line.machineClass),
      processRoute: line.processRoute || line.process,
      location: factory,
      mhrId: liveCandidate?.machineId ?? (line as any).mhrId ?? null,
      benchmarkMhrId: (line as any).benchmarkMhrId ?? undefined,
      machineName: liveCandidate?.machineName ?? (line as any).machineName ?? undefined,
      // line.rate/labourRate are display-currency (already converted by
      // normalizeCostSummaryToCurrency). This prefill seeds editData.machineRate/
      // laborRate, which effectiveMachineRate/effectiveLaborRate in
      // ProcessCostDialog fall back to ONLY when neither selectedMHR nor
      // savedMHRRecord resolves — every OTHER branch of that fallback chain
      // (resolveMhrUsdRate, lhrUsdEffective) is USD, so this must match: USD,
      // not native-local-currency (dividing by usdToDisplayRate, not
      // toUsdRate — see handleProcDialogSubmit's own doc comment for why
      // those are different conversions and which one belongs where).
      machineRate: line.rate / (cost?.usdToDisplayRate ?? 1),
      laborRate: (line.labourRate ?? 0) / (cost?.usdToDisplayRate ?? 1),
      // process_cost_records.cycle_time is NUMERIC(12,2) — rounding to a
      // whole integer here silently threw away real precision the schema
      // already supports (confirmed live: a genuine 19.2s line was saved as
      // 19s, then visibly disagreed with the calculator's own exact 19.2s
      // recomputation).
      cycleTime: Math.round(line.cycleMin * 60 * 100) / 100,
      setupTime: setupTimeMins,
      batchSize: batchSz,
      heads: 1,
      setupManning: 1,
      partsPerCycle: 1,
      scrap: 0,
      shiftPatternHoursPerDay: 8,
    });
    setProcDialogAutoOpenCalculator(openCalculator);
    setProcDialogOpen(true);
  };

  const handleProcDialogSubmit = async (data: any) => {
    const existing = existingProcRecords?.records?.find(
      (r: any) => r.id === procDialogPrefill?.id,
    );
    // ProcessCostDialog's own rates (data.machineRate/laborRate/directRate/
    // machineValue) are USD internally — effectiveMachineRate/effectiveLaborRate
    // there are built entirely from USD sources (resolveMhrUsdRate,
    // lhrUsdEffective). The backend's create()/update() do the OPPOSITE
    // conversion: they always treat an incoming rate as being in `location`'s
    // own NATIVE currency and convert native->USD via toUsdCreate/
    // toUsdIfProvided (using the live BUDGET exchange rate, not the
    // scenario's reference rate). Sending a true-USD number straight through
    // got it divided a second time — confirmed live: a real $13.41/hr Quality
    // Inspector rate was silently re-priced to ~$1.85/hr (÷7.25, the exact
    // CNY budget rate) after editing and saving this exact row.
    //
    // usdToDisplayRate = budgetUSDtoLocal * referenceLocalToDisplay,
    // toUsdRate = referenceLocalToDisplay (native->display) -- dividing
    // cancels the reference rate cleanly regardless of its value, leaving
    // exactly budgetUSDtoLocal, the one factor the backend's own conversion
    // needs to invert back to the original USD figure.
    const usdToNativeLocal = (cost?.usdToDisplayRate ?? 1) / (cost?.toUsdRate ?? 1);
    const toNativeLocal = (usdValue: number) => usdValue * usdToNativeLocal;
    try {
      if (existing?.id) {
        await updateProcCost.mutateAsync({
          id: existing.id,
          data: {
            opNbr: data.opNbr,
            processGroup: data.group,
            processRoute: data.processRoute,
            operation: data.operation,
            location: data.location || undefined,
            mhrId: data.mhrId || undefined,
            benchmarkMhrId: data.benchmarkMhrId || undefined,
            lhrId: data.lhrId || undefined,
            benchmarkLhrId: data.benchmarkLhrId || undefined,
            directRate: toNativeLocal(data.directRate || data.laborRate || 0),
            indirectRate: data.indirectRate || 0,
            fringeRate: data.fringeRate || 0,
            machineRate: toNativeLocal(data.machineRate || 0),
            machineValue: toNativeLocal(data.machineValue || 0),
            laborRate: toNativeLocal(data.laborRate || 0),
            shiftPatternHoursPerDay: data.shiftPatternHoursPerDay || 8,
            setupManning: data.setupManning,
            setupTime: data.setupTime,
            batchSize: data.batchSize,
            heads: data.heads,
            cycleTime: data.cycleTime,
            partsPerCycle: data.partsPerCycle,
            scrap: data.scrap,
          },
        });
      } else {
        await createProcCost.mutateAsync({
          bomItemId: item.id,
          opNbr: data.opNbr,
          processGroup: data.group,
          processRoute: data.processRoute,
          operation: data.operation,
          location: data.location || undefined,
          mhrId: data.mhrId || undefined,
          benchmarkMhrId: data.benchmarkMhrId || undefined,
          lhrId: data.lhrId || undefined,
          benchmarkLhrId: data.benchmarkLhrId || undefined,
          directRate: toNativeLocal(data.directRate || data.laborRate || 0),
          indirectRate: data.indirectRate || 0,
          fringeRate: data.fringeRate || 0,
          machineRate: toNativeLocal(data.machineRate || 0),
          machineValue: toNativeLocal(data.machineValue || 0),
          laborRate: toNativeLocal(data.laborRate || 0),
          shiftPatternHoursPerDay: data.shiftPatternHoursPerDay || 8,
          setupManning: data.setupManning,
          setupTime: data.setupTime,
          batchSize: data.batchSize,
          heads: data.heads,
          cycleTime: data.cycleTime,
          partsPerCycle: data.partsPerCycle,
          scrap: data.scrap,
          isActive: true,
        });
      }
      setProcDialogOpen(false);
      setProcDialogPrefill(null);
    } catch { /* errors surfaced by mutation hooks */ }
  };

  if (isLoading) return (
    <div className="py-10 text-center text-sm text-muted-foreground">Calculating cost…</div>
  );
  if (!cost || !eff) return (
    <div className="py-10 px-4 text-center text-sm text-muted-foreground">
      Run Auto-Fill to generate cost estimate.
    </div>
  );

  // Financial quote requires a committed material grade; operations/cycle times do not.
  // When scenarioReady === false, show process lines (route + cycle times) from the route
  // comparison engine so engineers can answer "3-axis or 5-axis?" without a grade set.
  const isScenarioReady = cost.scenarioReady !== false;
  const previewRoute = !isScenarioReady
    ? (comparison?.routes?.find((r) => r.capability.overallCapable && (r.processLines?.length ?? 0) > 0) ??
       comparison?.routes?.[0] ?? null)
    : null;

  const sym = cost.currencySymbol ?? '$';
  const showUsd = (cost.currency ?? 'INR') !== 'USD';
  // amount_usd × fromUsd = amount in `sym`'s currency — for converting fields
  // that are ALWAYS stored in USD regardless of factory (raw material/
  // packaging/procured/tooling/process-cost records). Deliberately NOT
  // derived from cost.toUsdRate (that rate converts the factory's own
  // native-currency figures already embedded in `cost`, a different
  // conversion — conflating the two is exactly how a real $1.175/kg got
  // relabeled ₹1.175/kg instead of converted). See cost-breakdown.dto.ts's
  // usdToDisplayRate doc comment.
  const fromUsd = cost.usdToDisplayRate ?? 1;
  // A real, non-zero cost this small (e.g. Hole Extrusion (Burring) at
  // $0.28/hr machine + $1.73/hr labour, 2.1s cycle, batch 250 — a genuine
  // ~$0.0019/part) rounds to "$0.00" at the default 2dp, reading as broken/
  // missing rather than a real, correctly-computed tiny figure. Bump
  // precision automatically whenever 2dp would otherwise hide it — every
  // caller across this page benefits without needing its own fix.
  const fmtL = (v: number, d = 2) => {
    const effectiveD = v > 0 && v < 0.01 && d <= 2 ? 4 : d;
    return `${sym}${v.toLocaleString(undefined, { minimumFractionDigits: effectiveD, maximumFractionDigits: effectiveD })}`;
  };
  const fmtUsd = (v: number) =>
    `$${(v / fromUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Grand total: engine estimate (process + material) + stored records converted to factory currency
  const hasStoredMat = (storedRawMat?.records?.length ?? 0) > 0;
  const storedMatTotal = (storedRawMat?.records ?? []).reduce((s, r: any) => s + (r.totalCost ?? 0), 0) * fromUsd;
  const packagingTotal = (storedPackaging?.items ?? []).reduce((s, i: any) => s + (i.totalCost ?? 0), 0) * fromUsd;
  const procuredTotal = (storedProcured?.items ?? []).reduce((s, p: any) => {
    const base = Number(p.unitCost ?? 0) * Number(p.quantity ?? 1);
    return s + base * (1 + Number(p.scrapPercentage ?? 0) / 100 + Number(p.overheadPercentage ?? 0) / 100);
  }, 0) * fromUsd;
  const toolingTotal = (storedTooling?.records ?? []).reduce((s, r: any) => s + (r.totalCost ?? 0), 0) * fromUsd;
  // Stored process records — additive on top of engine estimate, converted from USD.
  // Must use the exact same live-data preference as the per-row display below
  // (matchedEngineLine / liveCycleSec / liveCandidate) — otherwise this grand total
  // silently disagrees with what the individual rows show and their percentages
  // stop summing to 100%.
  const storedProcessTotal = (existingProcRecords?.records ?? []).reduce((s: number, p: any) => {
    const matchedLine = (eff?.lines ?? []).find(
      (l) => l.machineClass && p.machineClass && l.machineClass === p.machineClass,
    );
    const liveCycleSec = matchedLine ? matchedLine.cycleTimeMin * 60 : null;
    // Mirrors the per-row display's hasSavedMachine trust rule — a saved
    // machine link is a deliberate pick, not stale data, so it wins unless the
    // row was never given a machine at all.
    const hasSavedMachine = !!(p.mhrId || p.machineName);
    const liveCandidate = (!hasSavedMachine && !matchedLine?.machineSelection?.overridden)
      ? matchedLine?.machineSelection?.balanced?.candidate
      : null;
    const machineRate  = hasSavedMachine ? Number(p.machineRate || 0) : (liveCandidate ? liveCandidate.hourlyRate : Number(p.machineRate || 0));
    const laborRate    = Number(p.laborRate    || 0);
    const setupMin     = Number(p.setupTime    || 0);
    const setupManning = Number(p.setupManning || 1);
    const batch        = Math.max(Number(p.batchSize     || 1), 1);
    const cycleSec     = liveCycleSec != null ? liveCycleSec : Number(p.cycleTime || 0);
    const heads        = Math.max(Number(p.heads         || 1), 1);
    const ppc          = Math.max(Number(p.partsPerCycle || 1), 1);
    const scrap        = Number(p.scrap        || 0);
    const setupPerPart = ((setupMin / 60) * (machineRate + laborRate * setupManning)) / batch;
    const cyclePerPart = ((cycleSec / 3600) * (machineRate + laborRate * heads)) / ppc;
    return s + (setupPerPart + cyclePerPart) * (1 + scrap / 100);
  }, 0) * fromUsd;
  // Stored process records replace the engine estimate (same pattern as raw material)
  const hasStoredProcs = sortedStoredProcs.length > 0;
  // Process costs are only valid when a material is present — every process parameter
  // (laser speed, press brake tonnage, cycle time derating) was computed from that
  // material. If the material record is deleted, stored process costs are stale and
  // must not contribute to the total until material is re-applied.
  // Process costs are only valid when a committed material record exists — machine
  // selection, laser speed, press-brake tonnage, and LHR derating all depend on
  // material family and thickness. Without a raw-material record there is no basis
  // for any dollar figure, so the total process contribution is $0.
  const totalProcessCombined = !hasStoredMat ? 0
    : hasStoredProcs ? storedProcessTotal
    : (eff?.totalProcess ?? 0);
  // When no material record exists, use $0 for the material component — do not silently
  // include the engine's estimate while "No raw materials added yet" is displayed.
  const matComponent = hasStoredMat ? storedMatTotal : 0;
  const grandTotal = matComponent + totalProcessCombined + packagingTotal + procuredTotal + toolingTotal;

  const cellProps = { editingKey, onStartEdit: handleStartEdit, onCommit: handleCommit, onDismiss: () => setEditingKey(null), onReset: handleReset };

  const SectionHeader = ({ label }: { label: string }) => (
    <div className="px-0 pt-4 pb-1">
      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
    </div>
  );

  const TotalRow = ({ label, value, pct }: { label: string; value: number; pct: number }) => (
    <div className="flex items-baseline justify-between py-2.5 border-t border-border mt-1">
      <span className="text-sm font-bold text-foreground">{label}</span>
      <div className="shrink-0 text-right">
        <span className="text-sm font-bold tabular-nums text-foreground">{fmtL(value)}</span>
        <span className="text-xs text-muted-foreground tabular-nums ml-2">{pct.toFixed(1)}%</span>
      </div>
    </div>
  );

  return (
    <div className="px-4 pb-4">

      {/* ── Applied route label ── */}
      {appliedRoute && (
        <div className="pt-3 pb-1 text-xs text-muted-foreground">
          Route: <span className="font-semibold text-foreground">{appliedRoute.routeLabel}</span>
        </div>
      )}

      {/* ── Benchmark rate override notice ── */}
      {cost.processLines?.some((l) => l.rateSource === 'benchmark_override') && (
        <div className="flex items-center gap-1.5 text-[11px] text-sky-600 dark:text-sky-400 pt-2 pb-1">
          <span>ℹ</span>
          <span>Using {factory} benchmark MHR rates — verify machine records for actual shop rates</span>
        </div>
      )}

      {/* ── Grand total header ──
          costStatus === 'incomplete' means at least one required process has
          an unresolved physicsGap (see backend CostStatus's doc comment) —
          grandTotal below still sums whatever DID resolve, for engineering
          inspection, but it is a partial figure, not a real quote. Surfacing
          this next to the number itself (not just as a warning further down)
          so it can never be read as "the part costs $X" when it doesn't yet. */}
      <div className="flex items-start justify-between pt-3 pb-2 border-b-2 border-border">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-bold text-foreground">Total Manufacturing Cost</p>
            {isScenarioReady && cost.costStatus === 'incomplete' && (
              <span
                className="text-[10px] font-semibold uppercase tracking-wide text-destructive border border-destructive/40 rounded px-1 py-0.5"
                title={cost.incompleteProcesses?.length ? `Unresolved: ${cost.incompleteProcesses.join(', ')}` : undefined}
              >
                Incomplete
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">1 pc · batch {cost.batchSize}</p>
          {isScenarioReady && cost.costStatus === 'incomplete' && !!cost.incompleteProcesses?.length && (
            <p className="text-[10px] text-destructive mt-0.5 max-w-[220px]">
              Partial total — {cost.incompleteProcesses.join(', ')} unresolved
            </p>
          )}
        </div>
        <div className="text-right shrink-0 ml-4">
          {isScenarioReady ? (
            <>
              <p className={cn(
                'text-2xl font-bold tabular-nums leading-tight',
                cost.costStatus === 'incomplete' ? 'text-destructive' : hasAnyOverride ? 'text-amber-500' : 'text-foreground',
              )}>
                {fmtL(grandTotal)}
              </p>
              {showUsd && <p className="text-sm text-muted-foreground tabular-nums mt-0.5">{fmtUsd(grandTotal)}</p>}
            </>
          ) : (
            <>
              <p className="text-2xl font-bold tabular-nums leading-tight text-muted-foreground/30">—</p>
              <p className="text-[10px] text-amber-500 mt-0.5">Set material to quote</p>
            </>
          )}
        </div>
      </div>

      {/* ── DIRECT MATERIAL ── editable via RawMaterialsSection ── */}
      <SectionHeader label="Direct Material Costs" />

      {/* Estimated row (shown when no DB records exist yet — gives the user context) */}
      {!isScenarioReady ? (
        <div className="pl-2 pb-2">
          <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            Apply a material grade — engine will price this part from your DB rates
          </div>
        </div>
      ) : cost.materialSource === 'default' && !matRateOverride ? (
        <div className="pl-5 pb-2">
          <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
            <span className="text-amber-500">(est.)</span>
            <span>{fmt(cost.grossWeightKg, 3)} kg × {sym}{eff.matRate.toFixed(2)}/kg — add material records below to replace this estimate</span>
          </div>
        </div>
      ) : null}

      {/* Editable raw material records — principal-engineer-grade calculator */}
      <div className="-mx-4">
        <RawMaterialsSection
          bomItemId={item.id}
          bomItem={item}
          location={factory}
          batchSize={batchSize}
          compact
          currencySymbol={sym}
          conversionRate={fromUsd}
          onAllMaterialsDeleted={() => {
            // Cascade-delete auto-generated process records — they were computed from
            // the material that was just removed and are now stale. isOverride records
            // (manually entered by the engineer) are intentionally preserved.
            const autoRecords = sortedStoredProcs.filter((p: any) => !p.isOverride);
            for (const rec of autoRecords) {
              deleteProcCost.mutate(rec.id);
            }
          }}
        />
      </div>

      {/* ── DIRECT PROCESS COSTS ── engine rows shown only when no stored records exist ── */}
      <SectionHeader label="Direct Process Costs" />

      {/* Stale process costs warning — stored records exist but no material is applied */}
      {!hasStoredMat && hasStoredProcs && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 mb-2 text-xs text-amber-600 dark:text-amber-400">
          Process costs below were computed from a material that was removed — they are excluded from the total. Remove them or add a material to recalculate.
        </div>
      )}

      {/* No material grade yet — show route + cycle times from comparison engine,
          hide cost columns. Engineers can still answer "3-axis or 5-axis?" etc.
          Gated on !hasStoredProcs too: when stale stored records exist (see the
          amber warning above), the "Stored process records" block below already
          renders these same operations — showing this geometry preview as well
          would duplicate every row under the same header. */}
      {!isScenarioReady && !hasStoredProcs && previewRoute && previewRoute.processLines.length > 0 && (
        <>
          <p className="text-[10px] text-muted-foreground/50 pb-1.5">
            {previewRoute.routeLabel} · cycle times from geometry · apply material grade to see cost
          </p>
          {previewRoute.processLines.map((line, lineIdx) => (
            <div key={line.process} className="flex items-baseline justify-between py-2 border-b border-border/20">
              <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                <span className="text-[10px] tabular-nums text-muted-foreground/50 font-mono w-5 shrink-0 text-right">
                  {(lineIdx + 1) * 10}
                </span>
                <div>
                  <span className="text-sm text-foreground">{line.process}</span>
                  <span className="text-xs text-muted-foreground ml-2">{formatCycleMin(line.cycleTimeMin)}</span>
                </div>
              </div>
              <span className="text-sm tabular-nums text-muted-foreground/30 shrink-0">—</span>
            </div>
          ))}
          <div className="flex items-baseline justify-between py-2 border-t border-border mt-1">
            <span className="text-xs text-muted-foreground">Total Cycle Time (est.)</span>
            <span className="text-sm tabular-nums font-medium text-foreground">
              {formatCycleMin(previewRoute.cycleTimes.totalMin)}
            </span>
          </div>
        </>
      )}

      {/* Material-grade set but no committed cost record — show cycle times only so
          the engineer can see the route without any dollar figures that would be
          inaccurate (laser speed, press-brake tonnage, LHR all depend on material).
          Gated on !hasStoredProcs for the same reason as the preview block above —
          stale stored records already render these operations below. */}
      {isScenarioReady && !hasStoredMat && !hasStoredProcs && (eff?.lines ?? []).length > 0 && (
        <>
          <p className="text-[10px] text-muted-foreground/50 pb-1.5">
            Cycle times from geometry · add material to see cost
          </p>
          {(eff?.lines ?? []).map((line, lineIdx) => (
            <div key={line.process} className="flex items-baseline justify-between py-2 border-b border-border/20">
              <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
                <span className="text-[10px] tabular-nums text-muted-foreground/50 font-mono w-5 shrink-0 text-right">
                  {(lineIdx + 1) * 10}
                </span>
                <div>
                  <span className="text-sm text-foreground">{line.process}</span>
                  <span className="text-xs text-muted-foreground ml-2">{formatCycleMin(line.cycleMin ?? 0)}</span>
                </div>
              </div>
              <span className="text-sm tabular-nums text-muted-foreground/30 shrink-0">—</span>
            </div>
          ))}
          <div className="flex items-baseline justify-between py-2 border-t border-border mt-1">
            <span className="text-xs text-muted-foreground">Total Cycle Time (est.)</span>
            <span className="text-sm tabular-nums font-medium text-foreground">
              {formatCycleMin((eff?.lines ?? []).reduce((s, l) => s + (l.cycleMin ?? 0), 0))}
            </span>
          </div>
        </>
      )}

      {/* ── All processes, merged and ordered by real manufacturing sequence —
          NOT by save status. Saved rows (Deburr, Inspect, ...) and not-yet-
          saved/gapped rows (Laser Cutting, Press Brake, ...) used to render as
          two separate, sequential blocks — every saved row before every
          unsaved one, regardless of which actually happens earlier in the
          real process (cut → form → machine → finish → inspect). Confirmed
          live: Deburr/Inspect (finishing/inspection — properly LAST) showed
          at the top with low numbers just because they were saved, while
          Laser Cutting/Press Brake (cutting/forming — properly FIRST) were
          pushed to the bottom just because they weren't. Both row "kinds"
          are merged into one array and sorted by PROCESS_ORDER_RANK before
          rendering, so op numbers 10/20/30/... always reflect the real
          sequence regardless of which lines happen to be saved. */}
      {(() => {
        const PROCESS_ORDER_RANK: Record<string, number> = {
          fiber_laser: 1, co2_laser: 1, turret_punch: 1, waterjet: 1,
          press_brake: 2, hole_forming: 2,
          tapping: 3, drill_press: 3, pem_press: 3, cnc_3ax_vmc: 3, cnc_4ax_vmc: 3, cnc_5ax_mc: 3, cnc_lathe: 3, cnc_lathe_live: 3, cnc_mill_turn: 3,
          deburring: 4, cleaning: 4,
          surface_treatment: 5,
          cmm: 6,
        };
        const rankOf = (machineClass: string | null | undefined) => PROCESS_ORDER_RANK[machineClass ?? ''] ?? 99;

        const CANON_PROCESS_NAME: Record<string, string> = {
          'laser cut': 'laser cutting',
          'bend brake': 'press brake',
          'deburr': 'deburring',
          'inspect': 'inspection',
        };
        const canonName = (s: string) => CANON_PROCESS_NAME[s] ?? s;
        const storedProcessNames = new Set(
          sortedStoredProcs
            .map((p: any) => canonName((p.operation || p.processRoute || '').toLowerCase()))
            .filter(Boolean),
        );
        const storedMachineClasses = new Set(
          sortedStoredProcs.map((p: any) => p.machineClass).filter(Boolean),
        );
        // Gated on !isLoadingProcRecords — otherwise, on first paint (before
        // the stored-records query resolves), sortedStoredProcs is
        // momentarily empty and every real engine line would flash as
        // "missing"/"Result Unavailable" for an instant before correcting
        // itself once the real stored rows arrive — reads as "it worked,
        // then reverted to the old data" even though nothing was ever wrong.
        const missingLines = (hasStoredMat && !isLoadingProcRecords) ? (eff?.lines ?? []).filter(
          (l) => !storedProcessNames.has(canonName(l.process.toLowerCase()))
            && !(l.machineClass && storedMachineClasses.has(l.machineClass)),
        ) : [];

        type Row = { key: string; kind: 'stored'; proc: any } | { key: string; kind: 'missing'; line: any };
        const rows: Row[] = [
          ...sortedStoredProcs.map((proc: any): Row => ({ key: `stored:${proc.id}`, kind: 'stored', proc })),
          ...missingLines.map((line: any): Row => ({ key: `missing:${line.process}`, kind: 'missing', line })),
        ];
        rows.sort((a, b) => rankOf(a.kind === 'stored' ? a.proc.machineClass : a.line.machineClass)
          - rankOf(b.kind === 'stored' ? b.proc.machineClass : b.line.machineClass));

        return rows.map((row, rowIdx) => {
          const opNbr = (rowIdx + 1) * 10;

          if (row.kind === 'missing') {
            const line = row.line;
            const gap = line.physicsGap;
            const reason = gap ? (gap.gapType === 'missing_lookup' ? gap.requiredAction : gap.reason) : null;
            // Same rich expandable panel as a saved/live engine row (feature
            // breakdown, calculation trace, ⭐/alternatives machine picker) —
            // a process being "not saved"/"Result Unavailable" is about its
            // COST OUTPUT, not about whether it deserves the same real,
            // sourced provenance and machine-selection detail every other
            // process line already shows. `line` IS the live engine line
            // itself here, so line.machineSelection is used directly.
            const ms = line.machineSelection;
            const procOv = procOverrides[line.process] ?? {};
            const isExpanded = expandedProcs.has(`missing:${line.process}`);
            const peers = (classPeers.get(line.machineClass) ?? []).filter((p) => p !== line.process);
            return (
              <div key={row.key} className="group/procrow">
                <div className="flex items-stretch border-b border-border/20 hover:bg-muted/10 transition-colors">
                  <button
                    type="button"
                    onClick={() => toggleProc(`missing:${line.process}`)}
                    className="flex-1 flex items-baseline justify-between py-2 text-left pl-2 min-w-0"
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-[10px] tabular-nums text-muted-foreground/50 font-mono w-5 shrink-0 text-right">
                          {opNbr}
                        </span>
                        <span className="text-sm text-foreground">
                          {isExpanded ? '▾' : '▸'} {line.process}
                        </span>
                        {reason ? (
                          <span className="text-xs text-destructive font-medium">· Result Unavailable</span>
                        ) : (
                          <span className="text-xs text-amber-500">· not saved</span>
                        )}
                        {peers.length > 0 && <span className="text-xs text-muted-foreground shrink-0">· same machine as {peers.join(', ')}</span>}
                        {ms?.overridden && <span className="text-xs text-amber-500 shrink-0">· overridden</span>}
                        {ms?.availabilityWarning && <span className="text-xs text-amber-500 shrink-0">⚠</span>}
                        {(procOv.rate || procOv.cycleMin) && <span className="text-xs text-amber-500 shrink-0">· rate overridden</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 pl-[26px]">
                        {reason ?? 'Re-apply the route to save this process, or set it up manually.'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right pr-2">
                      <span className="text-sm tabular-nums text-foreground">{fmtL(line.totalCost)}</span>
                      <span className="text-xs text-muted-foreground tabular-nums ml-2">{eff.pct(line.totalCost).toFixed(1)}%</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenEditProc(line, rowIdx, true)}
                    className="shrink-0 px-2.5 flex items-center text-muted-foreground/40 hover:text-foreground opacity-0 group-hover/procrow:opacity-100 transition-opacity"
                    title="Open in process calculator"
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </button>
                </div>
                {isExpanded && (
                  <div className="pl-9 pr-4 py-2 bg-muted/10 border-b border-border/20 space-y-3">
                    <FeatureBreakdown items={(line as any).featureBreakdown} fg={fg} onSelectHighlight={onSelectHighlight} />
                    <CalculationTracePanel line={line} />
                    {!!line.calculationTrace?.length && (
                      <button
                        type="button"
                        onClick={() => generateCalculationReportPdf({
                          partNumber: item.partNumber ?? item.id,
                          location: factory,
                          currencySymbol: sym,
                          batchSize: cost.batchSize,
                          line,
                          cycleTimeSec: line.cycleTimeMin * 60,
                          laborRate: line.labourRate ?? null,
                        })}
                        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground border border-border/40 rounded px-2 py-1 transition-colors"
                        title="Download the full calculation (formulas + real values) as a PDF for engineering review"
                      >
                        <Download className="h-3 w-3" />
                        Download calculation (PDF)
                      </button>
                    )}
                    {ms && (
                      <MachineSelector
                        itemId={item.id}
                        processKey={line.machineClass}
                        selection={ms}
                        currencySymbol={sym}
                        location={factory}
                      />
                    )}
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 min-w-0">
                        <span className="text-xs text-muted-foreground truncate min-w-0">Machine Rate</span>
                        <span className="shrink-0">
                          <EditCell value={line.rate ?? line.hourlyRate} prefix={sym} suffix="/hr" decimals={0}
                            fieldKey={`${line.process}::rate`} isOverridden={!!procOv.rate} {...cellProps} />
                        </span>
                      </div>
                      {(line.labourRate ?? 0) > 0 && (
                        <div className="flex items-baseline justify-between gap-2 min-w-0">
                          <span className="text-xs text-muted-foreground truncate min-w-0">Labour Rate</span>
                          <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                            {sym}{fmt(line.labourRate!, 0)}/hr
                          </span>
                        </div>
                      )}
                      <div className="flex items-baseline justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="text-xs text-muted-foreground truncate min-w-0">Cycle Time</span>
                          <button
                            type="button"
                            onClick={() => handleOpenEditProc(line, rowIdx, true)}
                            className="text-muted-foreground/40 hover:text-violet-500 transition-colors shrink-0"
                            title="Open cycle time in process calculator"
                          >
                            <Calculator className="h-3 w-3" />
                          </button>
                        </div>
                        <span className="shrink-0">
                          <EditCell value={(line.cycleMin ?? line.cycleTimeMin) * 60} suffix=" s" decimals={2}
                            fieldKey={`${line.process}::cycleMin`} isOverridden={!!procOv.cycleMin} {...cellProps}
                            onCommit={(key, secs) => cellProps.onCommit(key, secs / 60)} />
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between border-t border-border/20 pt-1">
                        <span className="text-xs text-muted-foreground">Setup (÷{cost.batchSize})</span>
                        <span className="text-xs tabular-nums text-foreground">{fmtL(line.setupCost)}</span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs text-muted-foreground">Run</span>
                        <span className="text-xs tabular-nums text-foreground">{fmtL(line.runCost)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          }

        const proc = row.proc;
        // Live engine data for this row's machine class — feature breakdown
        // (cut path, pierces, bends...) and the ⭐/alternatives/"Why" picker are
        // computed from current geometry + MHR data regardless of whether this
        // operation has a saved row, so a saved row can show the exact same
        // rich view as a not-yet-saved one, just persisting picks to ITS OWN
        // record instead of the class-wide machine-override preference.
        const matchedEngineLine = (eff?.lines ?? []).find(
          (l) => l.machineClass && proc.machineClass && l.machineClass === proc.machineClass,
        );
        const ms = matchedEngineLine?.machineSelection;

        // cycleTime is an INPUT field, not something any cost formula derives — it's
        // whatever was last saved on this row, and goes stale the moment the CAD
        // geometry-driven cycle-time formula improves (as it did today), even though
        // the "Feature breakdown" shown right below it is always freshly recomputed
        // from current geometry. is_override is NOT a usable signal here — every
        // record saved via ProcessCostDialog gets is_override=true unconditionally
        // (confirmed directly against the DB), so gating on it made this a no-op for
        // every manually-saved line, which is effectively all of them. Always prefer
        // the live, geometry-derived cycle time when a matching engine line exists;
        // fall back to the stored value only when this machine class has no live
        // engine counterpart at all (e.g. Hand Deburring with no linked machine_class).
        const liveCycleSec = matchedEngineLine ? matchedEngineLine.cycleTimeMin * 60 : null;
        // The machine itself is different from cycle time: it's not a derived
        // formula output, it's a deliberate pick the engineer made via Edit
        // Process Cost / the machine picker below, and that flow now writes a
        // real, current machine (the mhrApi.getAll() dropdown-defaulting bug
        // that used to silently pick the wrong benchmark is fixed). So a saved
        // machine link on this row IS trustworthy — prefer it, and fall back to
        // the live ⭐ recommendation only when the row was never given a
        // machine at all (e.g. an AI/geometry-generated line with NULL machine
        // fields — the actual original bug this fallback exists for).
        const hasSavedMachine = !!(proc.mhrId || proc.machineName);
        const liveCandidate = (!hasSavedMachine && !ms?.overridden) ? ms?.balanced?.candidate : null;
        const machineRate  = hasSavedMachine ? Number(proc.machineRate || 0) : (liveCandidate ? liveCandidate.hourlyRate : Number(proc.machineRate || 0));
        const liveMachineName = hasSavedMachine ? null : (liveCandidate?.machineName ?? null);
        const laborRate    = Number(proc.laborRate    || 0);
        const setupMin     = Number(proc.setupTime    || 0);
        const setupManning = Number(proc.setupManning || 1);
        const batch        = Math.max(Number(proc.batchSize     || 1), 1);
        const cycleSec     = liveCycleSec != null ? liveCycleSec : Number(proc.cycleTime || 0);
        const heads        = Math.max(Number(proc.heads         || 1), 1);
        const ppc          = Math.max(Number(proc.partsPerCycle || 1), 1);
        const scrap        = Number(proc.scrap        || 0);
        const setupPerPart = ((setupMin / 60) * (machineRate + laborRate * setupManning)) / batch;
        const cyclePerPart = ((cycleSec / 3600) * (machineRate + laborRate * heads)) / ppc;
        // Always derive from setupPerPart/cyclePerPart — the SAME values the
        // Setup/Run rows below display — rather than ever substituting the
        // stored proc.totalCostPerPart. That stored field previously won
        // whenever neither cycle time nor machine rate had been live-
        // substituted, on the theory that it was "the same number the shared
        // ProcessCostCalculationEngine computed at save time" — but a row
        // auto-created for a newly-applied route (confirmed: e.g. this
        // part's waterjet_cutting/press_brake/deburring/tapping rows after
        // switching routes) can have totalCostPerPart still 0/null despite
        // real, non-zero setupPerPart+cyclePerPart — showing "$0.00 · 0.0%"
        // in the header while Setup/Run just below it showed real numbers,
        // an internally-inconsistent, obviously-wrong result. Recomputing
        // unconditionally can only ever match what's already displayed.
        const procCost     = (setupPerPart + cyclePerPart) * (1 + scrap / 100) * fromUsd;
        const cycleMin     = cycleSec ? formatCycleMin(cycleSec / 60) : null;
        const isExpanded   = expandedProcs.has(`stored:${proc.id}`);
        return (
          <div key={proc.id} className="group/storedrow">
            {/* Row header — click to expand */}
            <div className="flex items-stretch border-b border-border/20 hover:bg-muted/10 transition-colors">
              <button
                type="button"
                onClick={() => toggleProc(`stored:${proc.id}`)}
                className="flex-1 flex items-baseline justify-between py-2 text-left pl-2 min-w-0"
              >
                <div className="flex-1 min-w-0 pr-2">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[10px] tabular-nums text-muted-foreground/50 font-mono w-5 shrink-0 text-right">{opNbr}</span>
                    <span className="text-sm text-foreground">
                      {isExpanded ? '▾' : '▸'} {proc.operation || proc.processGroup || 'Process'}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap pl-[26px]">
                    <span className="truncate">{liveMachineName ?? machineDisplayLabel(proc)}</span>
                    {cycleMin && <span>· {cycleMin}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right pr-2">
                  <span className="text-sm tabular-nums text-foreground">{fmtL(procCost)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums ml-2">{grandTotal > 0 ? ((procCost / grandTotal) * 100).toFixed(1) : '0.0'}%</span>
                </div>
              </button>
              {/* Always-visible Edit + X delete */}
              <div className="shrink-0 flex items-center gap-0.5 pr-1">
                <button
                  type="button"
                  onClick={() => { setProcDialogPrefill(proc); setProcDialogAutoOpenCalculator(false); setProcDialogOpen(true); }}
                  className="px-1.5 flex items-center text-muted-foreground/60 hover:text-foreground transition-colors"
                  title="Edit"
                >
                  <Edit className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteProcCost.mutate(proc.id)}
                  className="px-1 flex items-center text-muted-foreground/30 hover:text-destructive transition-colors"
                  title="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Expanded calculation breakdown */}
            {isExpanded && (
              <div className="pl-9 pr-4 py-2 bg-muted/10 border-b border-border/20 space-y-3">
                {/* eMithran-style feature-level sub-operations — same as the live engine rows */}
                <FeatureBreakdown items={matchedEngineLine?.featureBreakdown} fg={fg} onSelectHighlight={onSelectHighlight} />
                {matchedEngineLine && <CalculationTracePanel line={matchedEngineLine} />}
                {/* Full end-to-end calculation export — only offered when the live engine
                    actually has a real DB-calculator audit trail for this process (Laser
                    Cutting, Press Brake so far); no placeholder button for processes that
                    don't have one yet. */}
                {!!matchedEngineLine?.calculationTrace?.length && (
                  <button
                    type="button"
                    onClick={() => generateCalculationReportPdf({
                      partNumber: item.partNumber ?? item.id,
                      location: factory,
                      currencySymbol: sym,
                      batchSize: batch,
                      line: matchedEngineLine,
                      cycleTimeSec: cycleSec,
                      laborRate: laborRate || null,
                    })}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground border border-border/40 rounded px-2 py-1 transition-colors"
                    title="Download the full calculation (formulas + real values) as a PDF for engineering review"
                  >
                    <Download className="h-3 w-3" />
                    Download calculation (PDF)
                  </button>
                )}
                {/* Machine — the same ⭐ recommended/alternatives/"Why" picker as the live
                    engine rows, persisting picks to THIS saved row (via onApply) instead
                    of the class-wide machine-override preference. When this operation has
                    no live engine counterpart (e.g. Hand Deburring — genuinely manual, no
                    machine class to match), there's no candidate list to offer inline —
                    show the saved machine/rate read-only and point to Edit to change it,
                    rather than an inline picker with no way to filter by the right class. */}
                {ms ? (
                  <MachineSelector
                    itemId={item.id}
                    processKey={proc.machineClass ?? ''}
                    selection={ms}
                    currencySymbol={sym}
                    conversionRate={fromUsd}
                    location={factory}
                    currentMachine={{ mhrId: proc.mhrId ?? null, machineName: proc.machineName ?? null, machineRate: proc.machineRate ?? null }}
                    savedExplanation={proc.mhrId ? matchedEngineLine?.savedMachineExplanations?.[proc.mhrId] ?? null : null}
                    applyPending={updateProcCost.isPending}
                    applyError={updateProcCost.isError}
                    onApply={(candidate) => {
                      // candidate.hourlyRate is already converted to the
                      // scenario's DISPLAY currency (convertMachineSelectionCost) —
                      // process_cost_records.machineRate is always USD, and the
                      // PUT endpoint re-derives USD itself via toUsdIfProvided,
                      // assuming whatever number it's sent is in THIS row's
                      // location's own native currency. Dividing by
                      // cost.toUsdRate recovers that native-currency figure —
                      // but the backend also needs `location` in the payload to
                      // know WHICH currency that is; without it (and with the
                      // existing row's own location column also often null) it
                      // falls back to getCurrencyForLocation('') -> 'USD',
                      // making the conversion a no-op and storing the native
                      // value verbatim mislabeled USD. Same root cause fixed in
                      // autoAddProcessCosts above.
                      const displayRate = candidate?.hourlyRate ?? 0;
                      updateProcCost.mutate({
                        id: proc.id,
                        data: {
                          mhrId: candidate?.machineId ?? null,
                          benchmarkMhrId: null,
                          machineRate: displayRate / (cost.toUsdRate ?? 1),
                          location: factory,
                        } as any,
                      });
                    }}
                  />
                ) : (
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-foreground min-w-0 truncate">
                      {proc.machineName ?? 'Manual rate — not linked to a machine'}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {sym}{(machineRate * fromUsd).toFixed(2)}/hr · Edit to change
                    </span>
                  </div>
                )}
                {laborRate > 0 && (
                  <div className="flex items-baseline justify-between gap-2 min-w-0">
                    <span className="text-xs text-muted-foreground truncate min-w-0">Labour Rate</span>
                    <span className="text-xs tabular-nums text-foreground shrink-0">{sym}{(laborRate * fromUsd).toFixed(0)}/hr</span>
                  </div>
                )}
                {/* Cycle Time — with calculator button */}
                <div className="flex items-baseline justify-between gap-2 min-w-0">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-xs text-muted-foreground truncate min-w-0">Cycle Time</span>
                    <button
                      type="button"
                      onClick={() => {
                        // proc.cycleTime is whatever was last saved — stale the
                        // moment the geometry-driven engine's cycle-time formula
                        // improves (see liveCycleSec's own comment above). The
                        // read-only value just below already prefers
                        // liveCycleSec; the calculator popup must open with the
                        // SAME real, database-driven value, not the stale one.
                        // featureBreakdown (when present, e.g. Inspection) feeds
                        // the "Sheet Metal - Inspection" calculator's fields —
                        // same real per-feature counts/times already shown in
                        // the Feature breakdown panel, not re-derived here.
                        setProcDialogPrefill({
                          // process_cost_records.cycle_time is NUMERIC(12,2) —
                          // round to 2dp, not to a whole integer (that silently
                          // dropped real precision the schema already supports).
                          ...(liveCycleSec != null ? { ...proc, cycleTime: Math.round(liveCycleSec * 100) / 100 } : proc),
                          ...(matchedEngineLine?.featureBreakdown ? { featureBreakdown: matchedEngineLine.featureBreakdown } : {}),
                        });
                        setProcDialogAutoOpenCalculator(true);
                        setProcDialogOpen(true);
                      }}
                      className="text-muted-foreground/40 hover:text-violet-500 transition-colors shrink-0"
                      title="Open in process calculator"
                    >
                      <Calculator className="h-3 w-3" />
                    </button>
                  </div>
                  <span className="text-xs tabular-nums text-foreground shrink-0">{cycleMin ?? '—'}</span>
                </div>
                {(heads > 1 || ppc > 1) && (
                  <div className="flex items-baseline justify-between gap-2 min-w-0">
                    <span className="text-xs text-muted-foreground truncate min-w-0">Heads × Parts/Cycle</span>
                    <span className="text-xs tabular-nums text-foreground shrink-0">{heads} × {ppc}</span>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-2 min-w-0 border-t border-border/20 pt-1">
                  <span className="text-xs text-muted-foreground truncate min-w-0">Setup ({setupMin.toFixed(1)} min ÷ {batch})</span>
                  <span className="text-xs tabular-nums text-foreground shrink-0">{fmtL(setupPerPart * fromUsd)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground truncate min-w-0">Run</span>
                  <span className="text-xs tabular-nums text-foreground shrink-0">{fmtL(cyclePerPart * fromUsd)}</span>
                </div>
                {scrap > 0 && (
                  <div className="flex items-baseline justify-between gap-2 min-w-0">
                    <span className="text-xs text-muted-foreground truncate min-w-0">Scrap ({scrap}%)</span>
                    <span className="text-xs tabular-nums text-foreground shrink-0">+{fmtL((setupPerPart + cyclePerPart) * (scrap / 100) * fromUsd)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
        });
      })()}

      {/* Add Process button */}
      <div className="py-2 pl-2">
        <button
          type="button"
          onClick={() => {
            const lastOpNbr = sortedStoredProcs.length > 0
              ? (sortedStoredProcs[sortedStoredProcs.length - 1]?.opNbr || 0)
              : 0;
            setProcDialogPrefill({ opNbr: lastOpNbr + 10 });
            setProcDialogAutoOpenCalculator(false);
            setProcDialogOpen(true);
          }}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <span className="text-base leading-none">+</span> Add Process
        </button>
      </div>

      <TotalRow label="Total Direct Process" value={totalProcessCombined} pct={grandTotal > 0 ? (totalProcessCombined / grandTotal) * 100 : 0} />

      {/* Process cost dialog */}
      <ProcessCostDialog
        open={procDialogOpen}
        onOpenChange={setProcDialogOpen}
        onSubmit={handleProcDialogSubmit}
        editData={procDialogPrefill}
        bomItemData={item}
        existingProcesses={existingProcRecords?.records ?? []}
        defaultLocation={factory}
        currencySymbol={sym}
        conversionRate={fromUsd}
        autoOpenCalculator={procDialogAutoOpenCalculator}
      />

      {/* ── PACKAGING & LOGISTICS ── */}
      <SectionHeader label="Packaging & Logistics" />
      <div className="-mx-4">
        <PackagingLogisticsSection bomItemId={item.id} compact currencySymbol={sym} conversionRate={fromUsd} />
      </div>

      {/* ── PROCURED PARTS ── */}
      <SectionHeader label="Procured Parts" />
      <div className="-mx-4">
        <ProcuredPartsSection bomItemId={item.id} compact currencySymbol={sym} conversionRate={fromUsd} />
      </div>

      {/* ── TOOLING & FIXTURES ── */}
      <SectionHeader label="Tooling & Fixtures" />
      <div className="-mx-4">
        <ToolingSection bomItemId={item.id} bomItem={item} compact currencySymbol={sym} conversionRate={fromUsd} />
      </div>

      {/* ── Grand total footer ── */}
      <div className="flex items-baseline justify-between pt-3 mt-1 border-t-2 border-border">
        <span className="text-base font-bold text-foreground">Total Manufacturing Cost</span>
        <div className="text-right shrink-0 ml-4">
          <span className={cn('text-xl font-bold tabular-nums', hasAnyOverride ? 'text-amber-500' : 'text-foreground')}>
            {fmtL(grandTotal)}
          </span>
          {showUsd && <span className="text-sm text-muted-foreground tabular-nums ml-2">{fmtUsd(grandTotal)}</span>}
        </div>
      </div>

      {/* override reset */}
      {hasAnyOverride && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={() => { for (const key of Object.keys(persistedOverrides)) costOverride.mutate({ fieldKey: key, value: null }); }}
            className="text-xs text-amber-500 hover:text-amber-400 underline underline-offset-2 transition-colors">
            Reset all overrides
          </button>
        </div>
      )}

      {/* warnings */}
      {cost.warnings.length > 0 && (
        <div className="mt-3 space-y-1">
          {cost.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600 leading-snug">⚠ {w}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function RouteComparisonCard({
  item, batchSize, appliedRouteId, onAppliedRouteChange, factory = 'USA', onSelectHighlight,
}: {
  item: BOMItem; batchSize: number;
  appliedRouteId: string | null;
  onAppliedRouteChange: (id: string | null) => void;
  factory?: string;
  onSelectHighlight?: (node: FeatureNodeV2 | null) => void;
}) {
  const { data: comparison, isLoading } = useRouteComparison(item.id, batchSize, factory);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const sym = comparison?.currencySymbol ?? '$';
  // Persists the applied route to process_cost_records — same mutation the
  // removed Candidate Routes panel used, so "Apply Route" here now actually
  // commits the change server-side instead of only updating local UI state.
  const applyRoute = useApplyRoute(item.id);

  if (isLoading) return (
    <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
      <div className="h-4 w-4 rounded-full border-2 border-violet-500/40 border-t-violet-500 animate-spin" />
      <span className="text-xs">Comparing routes…</span>
    </div>
  );
  if (!comparison?.routes?.length) return null;

  const appliedRoute = comparison.routes.find((r) => r.routeId === appliedRouteId) ?? null;
  const feasibleCosts = comparison.routes
    .filter((r) => r.capability?.overallCapable !== false && r.totalCost != null)
    .map((r) => r.totalCost as number);
  const minCost = feasibleCosts.length > 0 ? Math.min(...feasibleCosts) : 0;
  const maxCost = feasibleCosts.length > 0 ? Math.max(...feasibleCosts) : 0;

  // "Detected Geometry" + "Derived Manufacturing Operations" — real, CAD-
  // derived counts shown directly (never aggregated into a fabricated
  // combined metric — an earlier version summed sharp corners + small holes
  // into a "burr regions" count that came out ~10x any real notion of
  // distinct regions, since 15 raw sharp-corner flags on 2-3 physical zones
  // of a part are not 15 "regions"), plus a second section explaining WHICH
  // raw counts justify WHICH operation, so the reasoning is inspectable
  // rather than opaque. Every number traces to real data: item.featureGraph.
  // summary (cad-engine/feature_extractors.py) for bends/holes/corners/
  // extrusions, item.drawingIntelligence for taps — never fabricated, and
  // each row (and each section) only renders when its real count is > 0.
  const fg = item.featureGraph;
  const summary = fg?.summary;
  const tapCount = item.drawingIntelligence?.threads?.reduce((s, t) => s + t.count, 0) ?? 0;
  // Click-to-highlight for the "Detected Geometry" rows below — reuses the same
  // FeatureNodeV2/mergeFeaturesToHL mechanism the Feature breakdown rows already
  // use (see FeatureBreakdown/resolveFeatureOpHighlight above). Only feature
  // types that carry real OCC face_ids in feature_graph_v2 are clickable: hole,
  // bend, extruded_flange (geo_v40+). Internal profiles have no per-wire face_id
  // plumbing yet (_face_breakdown only accumulates aggregate length/count, not
  // per-wire face identity) — that row stays plain text until that OCC-side work
  // is done, disclosed rather than silently faked.
  const v2Features = fg?.feature_graph_v2?.features ?? [];
  const highlightFor = (featureType: string): FeatureNodeV2 | null =>
    onSelectHighlight ? mergeFeaturesToHL(`detected_${featureType}`, v2Features.filter((f) => f.feature_type === featureType)) : null;
  const bendHL = highlightFor('bend');
  const holeHL = highlightFor('hole');
  const extrusionHL = highlightFor('extruded_flange');
  const detectedRow = (label: string, highlight: FeatureNodeV2 | null) => (
    <button
      type="button"
      disabled={!highlight}
      onClick={() => highlight && onSelectHighlight?.(highlight)}
      title={highlight ? 'Click to highlight in the 3D view' : undefined}
      className={cn(
        'w-full flex items-center justify-between py-0.5 pl-3 border-l-2 text-left transition-colors',
        highlight
          ? 'border-violet-500/20 hover:border-violet-500/60 hover:bg-violet-500/5 cursor-pointer'
          : 'border-transparent cursor-default',
      )}
    >
      <p className="text-[10px] text-muted-foreground">✓ {label}</p>
      {highlight && <span className="text-[9px] text-violet-500/70 shrink-0">show in 3D</span>}
    </button>
  );
  const hasDetected = !!summary && (
    (summary.bendCount ?? 0) > 0 || tapCount > 0 || (summary.holeCount ?? 0) > 0 ||
    (summary.internalProfileCount ?? 0) > 0 || (summary.sharpCornerCount ?? 0) > 0 ||
    (summary.smallHoleCount ?? 0) > 0 || (summary.extrudedFlangeCount ?? 0) > 0
  );
  const opReasons: Array<{ op: string; reasons: string[] }> = summary ? [
    ...((summary.bendCount ?? 0) > 0
      ? [{ op: 'Press Brake', reasons: [`${summary.bendCount} bend line${summary.bendCount === 1 ? '' : 's'}`] }]
      : []),
    // Hole Extrusion (Burring) must physically happen before Tapping (the
    // collar is formed, then threaded) — its own operation, not a footnote
    // under Tapping, since it's now separately costed (see cost-engine.ts).
    ...((summary.extrudedFlangeCount ?? 0) > 0
      ? [{ op: 'Hole Extrusion (Burring)', reasons: [`${summary.extrudedFlangeCount} hole extrusion${summary.extrudedFlangeCount === 1 ? '' : 's'}`] }]
      : []),
    ...(tapCount > 0
      ? [{ op: 'Tapping', reasons: [`${tapCount} tap${tapCount === 1 ? '' : 's'}`] }]
      : []),
    ...(((summary.sharpCornerCount ?? 0) > 0 || (summary.smallHoleCount ?? 0) > 0)
      ? [{
          op: 'Deburring',
          reasons: [
            ...((summary.sharpCornerCount ?? 0) > 0 ? [`${summary.sharpCornerCount} sharp corner${summary.sharpCornerCount === 1 ? '' : 's'}`] : []),
            ...((summary.smallHoleCount ?? 0) > 0 ? [`${summary.smallHoleCount} small hole${summary.smallHoleCount === 1 ? '' : 's'}`] : []),
          ],
        }]
      : []),
  ] : [];
  // Self-validating check: if the CAD engine detected hole extrusions but the
  // currently-displayed route has no matching operation, surface it as a rule
  // violation rather than silently under-costing (catches a stale pre-fix
  // cache, a manually-edited route that dropped the line, etc.).
  const burringExpected = (summary?.extrudedFlangeCount ?? 0) > 0;
  const routeForViolationCheck = appliedRoute ?? comparison.routes[0] ?? null;
  const burringPresent = (routeForViolationCheck?.processLines ?? []).some(
    (l) => l.process === 'Hole Extrusion (Burring)',
  );
  const burringRuleViolation = burringExpected && !burringPresent;

  return (
    <>
      {hasDetected && summary && (
        <Section title="Detected Geometry" defaultOpen>
          <div className="space-y-0.5 pt-1">
            {(summary.bendCount ?? 0) > 0 &&
              detectedRow(`${summary.bendCount} bend line${summary.bendCount === 1 ? '' : 's'}`, bendHL)}
            {tapCount > 0 && (
              <p className="text-[10px] text-muted-foreground py-0.5">✓ {tapCount} tap{tapCount === 1 ? '' : 's'}</p>
            )}
            {(summary.holeCount ?? 0) > 0 &&
              detectedRow(`${summary.holeCount} hole${summary.holeCount === 1 ? '' : 's'}`, holeHL)}
            {(summary.internalProfileCount ?? 0) > 0 && (
              <p className="text-[10px] text-muted-foreground py-0.5" title="Highlighting not yet available — needs per-wire face-id tracking not yet built in the CAD engine">
                ✓ {summary.internalProfileCount} internal profile{summary.internalProfileCount === 1 ? '' : 's'}
              </p>
            )}
            {(summary.sharpCornerCount ?? 0) > 0 && (
              <p className="text-[10px] text-muted-foreground py-0.5">✓ {summary.sharpCornerCount} sharp internal corner{summary.sharpCornerCount === 1 ? '' : 's'}</p>
            )}
            {(summary.smallHoleCount ?? 0) > 0 && (
              <p className="text-[10px] text-muted-foreground py-0.5">✓ {summary.smallHoleCount} small hole{summary.smallHoleCount === 1 ? '' : 's'}</p>
            )}
            {(summary.extrudedFlangeCount ?? 0) > 0 &&
              detectedRow(`${summary.extrudedFlangeCount} hole extrusion${summary.extrudedFlangeCount === 1 ? '' : 's'}`, extrusionHL)}
          </div>
        </Section>
      )}
      {opReasons.length > 0 && (
        <Section title="Derived Manufacturing Operations" defaultOpen>
          <div className="space-y-2 pt-1">
            {opReasons.map(({ op, reasons }) => (
              <div key={op}>
                <p className="text-[11px] font-semibold text-foreground">{op}</p>
                {reasons.map((r) => (
                  <p key={r} className="text-[10px] text-muted-foreground pl-2">• {r}</p>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}
      {burringRuleViolation && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 space-y-0.5">
          <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">⚠ Manufacturing Rule Violation</p>
          <p className="text-[10px] text-muted-foreground">Detected: {summary?.extrudedFlangeCount} hole extrusion{summary?.extrudedFlangeCount === 1 ? '' : 's'}</p>
          <p className="text-[10px] text-muted-foreground">Expected operation: Hole Extrusion (Burring)</p>
          <p className="text-[10px] text-muted-foreground">Current route: Missing</p>
        </div>
      )}
    <Section title="Route Comparison" defaultOpen>
      <div className="space-y-2.5 pt-1">
        {comparison.routes.filter((r) => r.capability?.overallCapable !== false).map((route) => {
          const isSelected = selectedRouteId === route.routeId;
          const isApplied = appliedRouteId === route.routeId;
          const incapable = false;
          const costBarPct = maxCost > 0 && route.totalCost != null ? (route.totalCost / maxCost) * 100 : 0;
          const savings = route.totalCost != null ? route.totalCost - minCost : 0;

          return (
            <div
              key={route.routeId}
              onClick={() => !incapable && setSelectedRouteId(isSelected ? null : route.routeId)}
              className={cn(
                'rounded-lg border transition-all cursor-pointer overflow-hidden',
                incapable ? 'border-red-200/40 opacity-60 cursor-default' :
                isApplied ? 'border-violet-500/60 ring-1 ring-violet-500/20' :
                isSelected ? 'border-violet-400/50' :
                'border-border/50 hover:border-border',
              )}
            >
              {/* Route header */}
              <div className={cn('px-3 py-2.5', isApplied ? 'bg-violet-500/8' : 'bg-muted/10')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground">{route.routeLabel}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {route.badges.lowestCost && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 font-medium">↓ Lowest Cost</span>
                      )}
                      {route.badges.fastest && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-700 border border-blue-500/20 font-medium">⚡ Fastest</span>
                      )}
                      {route.badges.bestQuality && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-700 border border-violet-500/20 font-medium">★ Best Quality</span>
                      )}
                      {isApplied && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-600 border border-violet-500/30 font-semibold">✓ Applied</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {incapable ? (
                      <p className="text-sm font-bold text-red-500">INFEASIBLE</p>
                    ) : (
                      <>
                        <p className="text-sm font-bold tabular-nums text-foreground">
                          {sym}{fmt(route.totalCost ?? 0, 2)}
                        </p>
                        {savings > 0.01 && (
                          <p className="text-[10px] text-muted-foreground tabular-nums">+{sym}{fmt(savings, 2)}</p>
                        )}
                        {route.badges.lowestCost && (
                          <p className="text-[10px] text-emerald-600 font-medium">Lowest</p>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Cost bar */}
                {!incapable && (
                  <div className="mt-2.5 h-1.5 w-full bg-border/30 rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', isApplied ? 'bg-violet-500' : 'bg-border')}
                      style={{ width: `${costBarPct}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Metrics row */}
              {!incapable && (
                <div className="px-3 py-2 border-t border-border/30 grid grid-cols-3 gap-2 bg-background">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Cycle</p>
                    <p className="text-xs font-medium tabular-nums text-foreground">{fmt(route.cycleTimes.totalMin, 1)} min</p>
                  </div>
                  {route.sustainability && (
                    <div>
                      <p className="text-[10px] text-muted-foreground">CO₂</p>
                      <p className="text-xs font-medium tabular-nums text-foreground">{route.sustainability.totalCo2Kg} kg</p>
                    </div>
                  )}
                  {route.abrasiveCost > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground">Abrasive</p>
                      <p className="text-xs font-medium tabular-nums text-foreground">{sym}{fmt(route.abrasiveCost, 2)}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Warnings */}
              {incapable && (
                <div className="px-3 py-2 border-t border-red-200/30 bg-red-50/10 space-y-0.5">
                  {route.capability.warnings.map((w, i) => (
                    <p key={i} className="text-[11px] text-red-500 flex items-start gap-1.5">
                      <span className="shrink-0">⚠</span>{w}
                    </p>
                  ))}
                </div>
              )}
              {!incapable && (route.machineCapabilityWarnings?.length ?? 0) > 0 && (
                <div className="px-3 py-1.5 border-t border-amber-400/20 bg-amber-500/5 flex flex-wrap gap-1">
                  {route.machineCapabilityWarnings!.map((w, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 border border-amber-400/20">⚠ {w}</span>
                  ))}
                </div>
              )}

              {/* Apply button — shown when selected but not yet applied */}
              {isSelected && !isApplied && !incapable && (
                <div className="px-3 py-2 border-t border-violet-500/20 bg-violet-500/5 flex justify-end">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (route.routeId) {
                        applyRoute.mutate({ routeId: route.routeId, batchSize, location: factory });
                      }
                      onAppliedRouteChange(route.routeId);
                      setSelectedRouteId(null);
                    }}
                    disabled={applyRoute.isPending}
                    className="text-xs px-3 py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700 font-medium transition-colors disabled:opacity-50"
                  >
                    {applyRoute.isPending ? 'Applying…' : 'Apply Route'}
                  </button>
                </div>
              )}
              {isApplied && (
                <div className="px-3 py-2 border-t border-violet-500/20 bg-violet-500/5 flex justify-end">
                  <button
                    onClick={(e) => { e.stopPropagation(); onAppliedRouteChange(null); }}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {comparison.comparisonWarnings.map((w, i) => (
          <p key={i} className="text-[11px] text-amber-500/80 flex items-start gap-1.5 px-1">
            <span className="shrink-0">⚠</span>{w}
          </p>
        ))}

        {/* ── Applied route cost breakdown ── */}
        {appliedRoute && (
          <div className="rounded-lg border border-violet-500/30 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5 bg-violet-500/8 border-b border-violet-500/20">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-500">Cost Breakdown</p>
                <p className="text-xs font-medium text-violet-700 mt-0.5">{appliedRoute.routeLabel}</p>
              </div>
              <button onClick={() => onAppliedRouteChange(null)}
                className="text-xs text-muted-foreground hover:text-foreground w-6 h-6 flex items-center justify-center rounded hover:bg-muted/40 transition-colors">
                ✕
              </button>
            </div>
            <div className="divide-y divide-border/30">
              <div className="flex items-center justify-between px-3 py-2.5">
                <div>
                  <p className="text-xs font-medium text-foreground">{item.materialGrade ?? comparison.materialGrade}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {fmt(comparison.grossWeightKg, 3)} kg × {sym}{fmt(comparison.materialCostPerKg, 0)}/kg
                  </p>
                </div>
                <span className="text-xs font-semibold tabular-nums shrink-0 ml-2">{sym}{fmt(comparison.materialCost, 2)}</span>
              </div>
              {appliedRoute.processLines.map((line) => (
                <div key={line.process} className="px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">{line.process}</p>
                    <span className="text-xs font-semibold tabular-nums shrink-0 ml-2">{sym}{fmt(line.totalCost, 2)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-1">
                    {line.machineName && <span>{line.machineName}</span>}
                    <span className="tabular-nums">{fmt(line.cycleTimeMin, 1)} min</span>
                    <span className="tabular-nums">{sym}{fmt(line.hourlyRate, 0)}/hr</span>
                    <span className={line.rateSource === 'mhr_database' ? 'text-emerald-600' : line.rateSource === 'tier_synthetic' ? 'text-slate-400' : line.rateSource === 'no_db_rate' ? 'text-red-600' : 'text-amber-600'}>
                      {line.rateSource === 'mhr_database' ? 'MHR DB'
                        : line.rateSource === 'tier_synthetic' ? 'Benchmark'
                        : line.rateSource === 'no_db_rate' ? 'no rate on file'
                        : 'est.'}
                    </span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-3 bg-muted/20">
                <div>
                  <p className="text-xs font-bold text-foreground">Total</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    1 pc · batch {comparison.batchSize} · {fmt(appliedRoute.cycleTimes.totalMin, 1)} min
                  </p>
                </div>
                <span className="text-sm font-bold tabular-nums shrink-0 ml-2">{sym}{fmt(appliedRoute.totalCost, 2)}</span>
              </div>
              {appliedRoute.sustainability && (
                <div className="flex items-center justify-between px-3 py-2 text-[11px] text-muted-foreground">
                  <span>CO₂ footprint</span>
                  <span className="tabular-nums">{appliedRoute.sustainability.totalCo2Kg} kg CO₂e</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Section>
    </>
  );
}

const SEVERITY_COLOR: Record<GdtSeverity, string> = {
  high: "text-red-600",
  medium: "text-amber-600",
  low: "text-muted-foreground",
};
const SEVERITY_BG: Record<GdtSeverity, string> = {
  high: "bg-red-50/40 border-red-200/60",
  medium: "bg-amber-50/40 border-amber-200/60",
  low: "bg-muted/20 border-border/50",
};

// ── Risk label helpers ─────────────────────────────────────────────────────────

type RiskLevel = 'High' | 'Medium' | 'Low';

function RiskBadge({ level }: { level: RiskLevel }) {
  const cls =
    level === 'High'   ? 'bg-red-500/15 text-red-700 dark:text-red-400' :
    level === 'Medium' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' :
                         'bg-green-500/15 text-green-700 dark:text-green-400';
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-px rounded shrink-0 ${cls}`}>{level}</span>
  );
}

function ComplexityBadge({ level }: { level: string }) {
  const cls =
    level === 'High' || level === 'complex'   ? 'bg-red-500/15 text-red-700 dark:text-red-400' :
    level === 'Medium' || level === 'medium'  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' :
                                                'bg-green-500/15 text-green-700 dark:text-green-400';
  const label = level.charAt(0).toUpperCase() + level.slice(1);
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-px rounded shrink-0 ${cls}`}>{label}</span>
  );
}

// ── ManufacturingFeaturesTab ───────────────────────────────────────────────────

function ManufacturingFeaturesTab({
  item, summary, dfmScores,
}: {
  item: BOMItem;
  summary: FeatureGraphSummary | null;
  // Real per-occurrence DFM risk from dfm-scoring.service.ts (the single DFM
  // authority, see P0.3) — presentation-only here: this tab reads whether the
  // backend already flagged an UNDERSIZED_HOLE/CRACK_RISK finding anywhere in
  // the part, it never recomputes the geometry itself. Undefined while the
  // query hasn't resolved yet.
  dfmScores?: DFMScoresResponse | undefined;
}) {
  if (!summary || (summary.holeCount === 0 && summary.bendCount === 0 && summary.cutLengthMm === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 gap-2 text-muted-foreground">
        <AlertCircle className="h-8 w-8 opacity-30" />
        <p className="text-xs text-center">No CAD feature data.</p>
        <p className="text-[10px] text-center opacity-70">Upload a 3D model to enable manufacturing feature extraction.</p>
      </div>
    );
  }

  // ── Hole calculations ──────────────────────────────────────────────────────
  const areaMm2 = summary.flatPatternAreaMm2 ?? 0;
  const area1000mm2 = areaMm2 / 1000;
  const holeDensityPer1000 = area1000mm2 > 0 ? summary.holeCount / area1000mm2 : 0;

  const allDiameters = summary.holeDiameters ?? [];
  const uniqueDiameters = Array.from(new Set(allDiameters)).sort((a, b) => a - b);
  const smallestHole = uniqueDiameters.length > 0 ? uniqueDiameters[0]! : null;
  const largestHole = uniqueDiameters.length > 0 ? uniqueDiameters[uniqueDiameters.length - 1]! : null;
  const thickness = summary.sheetThicknessMm ?? 0;

  // Real backend finding (dfm-scoring.service.ts's UNDERSIZED_HOLE, material/
  // UTS-bracketed) — replaces a flat, independently-computed 1.5x-thickness
  // judgment that only checked the single smallest hole in the part and
  // could disagree with the authoritative DFM scorer (see P0.3).
  const hasUndersizedHoleFinding = hasDfmRiskFactor(dfmScores, 'hole', 'UNDERSIZED_HOLE');

  const holeRisk: RiskLevel =
    holeDensityPer1000 > 5 || hasUndersizedHoleFinding
      ? 'High'
      : uniqueDiameters.length > 10 || holeDensityPer1000 > 2
      ? 'Medium'
      : 'Low';

  // ── Bend calculations ──────────────────────────────────────────────────────
  const uniqueRadii = summary.bendRadii
    ? Array.from(new Set(summary.bendRadii)).sort((a, b) => a - b)
    : [];
  const minRadius = uniqueRadii.length > 0 ? uniqueRadii[0]! : null;
  const multiRadius = uniqueRadii.length > 1;

  const bendComplexity: RiskLevel =
    summary.bendCount > 20 || uniqueRadii.length > 5 ? 'High' :
    summary.bendCount > 8  || uniqueRadii.length > 2 ? 'Medium' : 'Low';

  // Real backend finding (dfm-scoring.service.ts's CRACK_RISK, material +
  // thickness-bracketed via resolveBendRadiusMinFactor) — replaces a flat,
  // material-blind 2.0x-thickness judgment that only checked the single
  // tightest bend radius and could disagree with the authoritative DFM
  // scorer (see P0.3).
  const springbackRisk = hasDfmRiskFactor(dfmScores, 'bend', 'CRACK_RISK');

  // ── Cutting calculations ───────────────────────────────────────────────────
  const contourComplexity: RiskLevel =
    summary.cutLengthMm > 5_000 || summary.pierceCount > 200 ? 'High' :
    summary.cutLengthMm > 2_000 || summary.pierceCount > 50  ? 'Medium' : 'Low';

  // ── Feature density ────────────────────────────────────────────────────────
  const areaCm2 = areaMm2 / 100;
  const featureDensityPer100cm2 = areaCm2 > 0
    ? (summary.holeCount + summary.bendCount) / areaCm2
    : 0;
  const featureDensityLevel: RiskLevel =
    featureDensityPer100cm2 > 10 ? 'High' :
    featureDensityPer100cm2 > 4  ? 'Medium' : 'Low';

  // ── Primary cost drivers (derived when costDrivers absent) ─────────────────
  const hasCostDrivers = (summary.costDrivers?.length ?? 0) > 0;
  const derivedDrivers: string[] = [];
  if (!hasCostDrivers) {
    if (summary.pierceCount > 100) derivedDrivers.push(`High pierce count (${summary.pierceCount} pierces)`);
    if (summary.bendCount > 10)    derivedDrivers.push(`High bend count (${summary.bendCount} bends)`);
    if (uniqueDiameters.length > 5) derivedDrivers.push(`Multiple hole groups (${uniqueDiameters.length} unique sizes)`);
    if (summary.cutLengthMm > 3_000) derivedDrivers.push(`Long cut profile (${Math.round(summary.cutLengthMm)} mm)`);
    if (multiRadius) derivedDrivers.push(`Multi-radius bends (${uniqueRadii.length} groups)`);
  }

  return (
    <div>
      {/* ── Hole Intelligence ──────────────────────────────────────────── */}
      {summary.holeCount > 0 && (
        <Section title="Hole Intelligence">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground flex-1">Total Holes</span>
            <span className="text-xs font-semibold tabular-nums">{summary.holeCount}</span>
          </div>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground flex-1">Unique Sizes</span>
            <span className="text-xs font-medium tabular-nums">{uniqueDiameters.length > 0 ? uniqueDiameters.length : '—'}</span>
          </div>
          {smallestHole !== null && (
            <div className="flex items-center justify-between py-0.5">
              <span className="text-xs text-muted-foreground flex-1">Smallest Hole</span>
              <span className="text-xs font-medium tabular-nums">{smallestHole} mm</span>
            </div>
          )}
          {largestHole !== null && (
            <div className="flex items-center justify-between py-0.5">
              <span className="text-xs text-muted-foreground flex-1">Largest Hole</span>
              <span className="text-xs font-medium tabular-nums">{largestHole} mm</span>
            </div>
          )}
          {holeDensityPer1000 > 0 && (
            <div className="flex items-center justify-between py-0.5">
              <span className="text-xs text-muted-foreground flex-1">Hole Density</span>
              <span className="text-xs font-medium tabular-nums">{holeDensityPer1000.toFixed(1)} / 1000 mm²</span>
            </div>
          )}
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground flex-1">Risk</span>
            <RiskBadge level={holeRisk} />
          </div>
          {uniqueDiameters.length > 0 && (
            <div className="pt-1">
              <p className="text-[9px] text-muted-foreground mb-0.5">Hole sizes (mm)</p>
              <div className="flex flex-wrap gap-1">
                {uniqueDiameters.map((d) => (
                  <span key={d} className="text-[9px] font-mono border border-border/60 rounded px-1 py-px bg-muted/30">{d}</span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* ── Bend Intelligence ──────────────────────────────────────────── */}
      {summary.bendCount > 0 && (
        <Section title="Bend Intelligence">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground flex-1">Total Bends</span>
            <span className="text-xs font-semibold tabular-nums">{summary.bendCount}</span>
          </div>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground flex-1">Unique Radii</span>
            <span className="text-xs font-medium tabular-nums">{uniqueRadii.length > 0 ? uniqueRadii.length : '—'}</span>
          </div>
          {minRadius !== null && (
            <div className="flex items-center justify-between py-0.5">
              <span className="text-xs text-muted-foreground flex-1">Min Radius</span>
              <span className="text-xs font-medium tabular-nums">{minRadius} mm</span>
            </div>
          )}
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground flex-1">Complexity</span>
            <ComplexityBadge level={bendComplexity} />
          </div>
          {springbackRisk && (
            <p className="text-[9px] text-amber-600 dark:text-amber-400 py-0.5">⚠ Springback risk — min radius below the material/thickness-specific minimum</p>
          )}
          {multiRadius && (
            <p className="text-[9px] text-amber-600 dark:text-amber-400 py-0.5">⚠ Multi-radius — sequential press brake setups required</p>
          )}
          {uniqueRadii.length > 0 && (
            <div className="pt-1">
              <p className="text-[9px] text-muted-foreground mb-0.5">Radii (mm)</p>
              <div className="flex flex-wrap gap-1">
                {uniqueRadii.map((r) => (
                  <span key={r} className="text-[9px] font-mono border border-border/60 rounded px-1 py-px bg-muted/30">{r}</span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* ── Cutting Intelligence ───────────────────────────────────────── */}
      {summary.cutLengthMm > 0 && (
        <Section title="Cutting Intelligence">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground flex-1">Cut Length</span>
            <span className="text-xs font-semibold tabular-nums">{fmtInt(summary.cutLengthMm)} mm</span>
          </div>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground flex-1">Pierce Count</span>
            <span className="text-xs font-medium tabular-nums">{summary.pierceCount}</span>
          </div>
          {summary.slotCount > 0 && (
            <div className="flex items-center justify-between py-0.5">
              <span className="text-xs text-muted-foreground flex-1">Slots</span>
              <span className="text-xs font-medium tabular-nums">{summary.slotCount}</span>
            </div>
          )}
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground flex-1">Contour Complexity</span>
            <ComplexityBadge level={contourComplexity} />
          </div>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground flex-1">Internal Contours</span>
            <span className="text-xs font-medium tabular-nums">—</span>
          </div>
        </Section>
      )}

      {/* ── Sheet Metal Manufacturability ──────────────────────────────── */}
      <Section title="Sheet Metal Manufacturability">
        {item.complexity && (
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground flex-1">Manufacturing Complexity</span>
            <ComplexityBadge level={item.complexity} />
          </div>
        )}
        {featureDensityPer100cm2 > 0 && (
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground flex-1">Feature Density</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-medium tabular-nums text-muted-foreground">{featureDensityPer100cm2.toFixed(1)}/100cm²</span>
              <ComplexityBadge level={featureDensityLevel} />
            </div>
          </div>
        )}
        {thickness > 0 && (
          <Row label="Sheet Thickness" value={`${thickness} mm`} />
        )}
        {areaMm2 > 0 && (
          <Row label="Flat Pattern Area" value={`${fmtInt(areaMm2)} mm²`} />
        )}
        <Row label="Material Utilisation" value="—" />
        <Row label="Tooling Requirement" value="None (laser)" />
      </Section>

      {/* ── Reference Data (staged reconciliation export + live cost-engine
           lookup tables, same data source as the Process admin page's
           "Lookup Tables" dialog) ─────────────────────────────────────── */}
      <ReferenceDataPanels summary={summary} />

      {/* ── Primary Cost Drivers ───────────────────────────────────────── */}
      {(hasCostDrivers || derivedDrivers.length > 0) && (
        <Section title="Primary Cost Drivers">
          {hasCostDrivers
            ? summary.costDrivers!.map((cd, i) => (
                <div key={i} className="flex items-baseline justify-between py-0.5">
                  <span className="text-[10px] text-muted-foreground">✓ {cd.name}</span>
                  <span className="text-[10px] font-medium tabular-nums shrink-0">
                    {fmt(cd.value, 1)} {cd.unit}
                  </span>
                </div>
              ))
            : derivedDrivers.map((d, i) => (
                <p key={i} className="text-[10px] text-muted-foreground py-0.5">✓ {d}</p>
              ))
          }
        </Section>
      )}
    </div>
  );
}

// Live, read-only bridge to the SAME data source as the Process admin page's
// "Lookup Tables" dialog (backend's sm-lookup-bridge.config.ts /
// GET /processes/sm-lookup-tables) — surfaces, per this part's actual detected
// feature types, both the real sm_lookup_* cost-engine tables and the staged
// reconciliation export relevant to them. This app has no per-item resolved
// "which cutting process was selected" until a route is applied, so for
// hole-bearing parts every real candidate hole-making route (Cutting/
// Waterjet, Laser Cutting, Sheet Metal Fabrication/Turret) is shown, each
// honestly labeled by its own route name — never guessed down to one.
// Bending always resolves to machine_class='press_brake' in this app (see
// sm-lookup-bridge.config.ts's own Bending/Press Brake route comments), so
// that one is unambiguous.
function ReferenceDataPanels({ summary }: { summary: FeatureGraphSummary | null }) {
  const hasBend = !!summary && summary.bendCount > 0;
  const hasHole = !!summary && summary.holeCount > 0;

  const bend = useSmLookupTables('Sheet Metal', hasBend ? 'Bending/Floating /Forming' : undefined);
  const cutting = useSmLookupTables('Sheet Metal', hasHole ? 'Cutting' : undefined);
  const laser = useSmLookupTables('Sheet Metal', hasHole ? 'Laser Cutting' : undefined);
  const fab = useSmLookupTables('Sheet Metal', hasHole ? 'Sheet Metal Fabrication' : undefined);

  if (!hasBend && !hasHole) return null;

  const groups: Array<{ route: string; tables: ReferenceTable[] | undefined }> = [
    { route: 'Bending/Floating /Forming', tables: bend.data },
    { route: 'Cutting (Waterjet)', tables: cutting.data },
    { route: 'Laser Cutting', tables: laser.data },
    { route: 'Sheet Metal Fabrication (Turret)', tables: fab.data },
  ].filter((g) => (g.tables?.length ?? 0) > 0);

  if (groups.length === 0) return null;

  return (
    <Section title="Reference Data" defaultOpen={false}>
      <p className="text-[9px] text-muted-foreground mb-1.5 leading-snug">
        Live cost-engine lookup tables and staged reconciliation data for this part's detected feature types.
        {hasHole && ' The hole-making route hasn’t been applied yet for this part, so every real candidate route is shown.'}
      </p>
      {groups.map((g) => (
        <div key={g.route} className="mb-2 last:mb-0">
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{g.route}</p>
          {g.tables!.map((t) => (
            <ReferenceTableMini key={t.id} table={t} />
          ))}
        </div>
      ))}
    </Section>
  );
}

function ReferenceTableMini({ table }: { table: ReferenceTable }) {
  const [expanded, setExpanded] = useState(false);
  const rows = table.rows ?? [];
  return (
    <div className="border border-border/40 rounded mb-1 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-2 py-1 text-left hover:bg-muted/20"
      >
        <span className="text-[10px] font-medium truncate pr-2">{table.tableName}</span>
        <span className="text-[9px] text-muted-foreground shrink-0">{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
      </button>
      {expanded && (
        <div className="px-2 pb-1.5">
          {table.tableDescription && (
            <p className="text-[9px] text-muted-foreground mb-1 leading-snug">{table.tableDescription}</p>
          )}
          {rows.length === 0 ? (
            <p className="text-[9px] text-muted-foreground italic">Nothing collected for this route yet.</p>
          ) : (
            <div className="overflow-auto max-h-40">
              <table className="w-full text-[9px]">
                <thead>
                  <tr>
                    {table.columnDefinitions.map((c) => (
                      <th key={c.name} className="text-left font-medium text-muted-foreground pr-2 py-0.5 whitespace-nowrap">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r) => (
                    <tr key={r.id}>
                      {table.columnDefinitions.map((c) => (
                        <td key={c.name} className="pr-2 py-0.5 font-mono whitespace-nowrap">{String((r.rowData as Record<string, unknown>)?.[c.name] ?? '—')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 50 && (
                <p className="text-[9px] text-muted-foreground mt-1">Showing first 50 of {rows.length} rows.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GdtFunctionalTab({
  item, fg, summary,
}: {
  item: BOMItem;
  fg: FeatureGraph | null;
  summary: FeatureGraphSummary | null;
}) {
  const { data: gdt, isLoading } = useGdtAnalysis(item.id);

  const hasCad = summary != null && (
    summary.bendCount > 0 || summary.holeCount > 0 || summary.cutLengthMm > 0 || summary.sheetThicknessMm > 0
  );

  // ── Derived CAD values ───────────────────────────────────────────────────────
  const areaCm2 = (summary?.flatPatternAreaMm2 ?? 0) / 100;
  const featureDensity = areaCm2 > 0
    ? ((summary!.holeCount + summary!.bendCount) / areaCm2)
    : 0;
  const holeDensity = areaCm2 > 0 ? ((summary?.holeCount ?? 0) / areaCm2) : 0;
  const uniqueRadii = summary?.bendRadii ? Array.from(new Set(summary.bendRadii)).sort((a, b) => a - b) : [];
  const multiRadius = uniqueRadii.length > 1;

  // ── Feature risks (CAD-derived, not inferred GD&T) ───────────────────────────
  const featureRisks: string[] = [];
  if (summary) {
    if (summary.pierceCount > 20) featureRisks.push(`High pierce count (${summary.pierceCount}) — may affect laser cycle time`);
    if (summary.sheetThicknessMm > 0 && summary.sheetThicknessMm < 1.0) featureRisks.push(`Thin sheet (${summary.sheetThicknessMm} mm) — material handling risk`);
    if (multiRadius) featureRisks.push(`Multi-radius bends (${uniqueRadii.length} groups) — sequential setups required`);
    if (holeDensity > 5) featureRisks.push(`Dense hole pattern (${holeDensity.toFixed(1)}/100 cm²) — fixture design critical`);
    if (summary.bendCount > 8) featureRisks.push(`High bend count (${summary.bendCount}) — verify bend sequence for springback`);
    if (summary.slotCount > 0) featureRisks.push(`${summary.slotCount} slot${summary.slotCount > 1 ? 's' : ''} — check minimum web width`);
  }

  // ── Inspection drivers (CAD-derived geometry signals) ────────────────────────
  const inspectionDrivers: string[] = [];
  if (summary) {
    if (summary.bendCount > 0) inspectionDrivers.push('Bend angle and springback verification');
    if (summary.holeCount > 0) inspectionDrivers.push('Hole diameter and true position check');
    if (summary.cutLengthMm > 500) inspectionDrivers.push('Profile dimensional inspection (cut length > 500 mm)');
    if (featureDensity > 3) inspectionDrivers.push('High feature density — 100% first-article inspection recommended');
    if (multiRadius) inspectionDrivers.push('Bend radius compliance check per group');
  }

  // ── GD&T drawing signals ─────────────────────────────────────────────────────
  const generalTolerance = gdt?.generalTolerance ?? null;
  const tightestToleranceMm = item.tightestToleranceMm ?? null;
  const rawNotes: string = (item.drawingIntelligence as any)?.drawing_notes ?? "";
  const noteLines = rawNotes.split(/\d+\)/).map((s) => s.trim()).filter(Boolean);
  const hasDrawingControls = generalTolerance || tightestToleranceMm !== null || noteLines.length > 0;

  const hasGdtFcf = gdt?.source === 'drawing_intelligence' && (gdt.features?.length ?? 0) > 0;

  if (!hasCad && !hasDrawingControls && !hasGdtFcf) {
    if (isLoading) return (
      <div className="p-3 text-xs text-muted-foreground animate-pulse">Loading…</div>
    );
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 gap-2 text-muted-foreground">
        <Crosshair className="h-8 w-8 opacity-30" />
        <p className="text-xs text-center">No functional requirements data.</p>
        <p className="text-[10px] text-center opacity-70">Upload a 3D model or 2D drawing to enable analysis.</p>
      </div>
    );
  }

  // ── GD&T FCF data (for explicit callout case) ────────────────────────────────
  const gdtDatums = hasGdtFcf
    ? Array.from(new Set(gdt!.features.flatMap((f) => (f.datum ? f.datum.split('|') : [])).filter(Boolean)))
    : [];
  const gdtActions = hasGdtFcf
    ? Array.from(new Set(gdt!.features.flatMap((f) => f.manufacturingActions)))
    : [];

  return (
    <div>
      {/* ── CAD: Functional Requirements ──────────────────────────────── */}
      {hasCad && summary && (
        <>
          <Section title="Manufacturing Complexity">
            {item.complexity && (
              <Row
                label="Complexity"
                value={item.complexity.charAt(0).toUpperCase() + item.complexity.slice(1)}
              />
            )}
            {fg?.difficultyLevel && (
              <Row label="Difficulty" value={fg.difficultyLevel.replace(/_/g, ' ')} />
            )}
            {summary.sheetThicknessMm > 0 && (
              <Row label="Sheet Thickness" value={`${summary.sheetThicknessMm} mm`} />
            )}
            {summary.flatPatternAreaMm2 > 0 && (
              <Row label="Flat Pattern Area" value={`${fmtInt(summary.flatPatternAreaMm2)} mm²`} />
            )}
            {summary.cutLengthMm > 0 && (
              <Row label="Cut Length" value={`${fmt(summary.cutLengthMm, 0)} mm`} />
            )}
            {featureDensity > 0 && (
              <Row label="Feature Density" value={`${featureDensity.toFixed(1)} / 100 cm²`} />
            )}
          </Section>

          {summary.holeCount > 0 && (
            <Section title="Hole Density">
              <Row label="Total Holes" value={String(summary.holeCount)} />
              {summary.pierceCount > 0 && (
                <Row label="Pierce Count" value={String(summary.pierceCount)} />
              )}
              {holeDensity > 0 && (
                <Row label="Density" value={`${holeDensity.toFixed(1)} / 100 cm²`} />
              )}
              {(summary.holeGroups?.length ?? 0) > 0 && (
                <div className="pt-0.5">
                  <p className="text-[9px] text-muted-foreground mb-0.5 uppercase tracking-wide">Groups</p>
                  <table className="w-full text-[10px] border-collapse">
                    <thead>
                      <tr className="text-[9px] text-muted-foreground/70">
                        <th className="text-left font-medium pb-0.5">Ø (mm)</th>
                        <th className="text-right font-medium pb-0.5">Qty</th>
                        <th className="text-right font-medium pb-0.5">Region</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.holeGroups!.map((g, i) => (
                        <tr key={i} className="border-t border-border/30">
                          <td className="py-0.5 tabular-nums">{g.diameter_mm}</td>
                          <td className="py-0.5 text-right tabular-nums">{g.count}</td>
                          <td className="py-0.5 text-right text-muted-foreground">
                            {g.location?.manufacturing_region ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}

          {summary.bendCount > 0 && (
            <Section title="Bend Complexity">
              <Row label="Bend Count" value={String(summary.bendCount)} />
              {uniqueRadii.length > 0 && (
                <Row label="Radius Groups" value={String(uniqueRadii.length)} />
              )}
              {uniqueRadii.length > 0 && (
                <div className="pt-0.5">
                  <p className="text-[9px] text-muted-foreground mb-0.5">Radii (mm)</p>
                  <div className="flex flex-wrap gap-1">
                    {uniqueRadii.map((r) => (
                      <span key={r} className="text-[10px] font-mono border border-border rounded px-1.5 py-px bg-muted/40">{r}</span>
                    ))}
                  </div>
                </div>
              )}
              {multiRadius && (
                <p className="text-[9px] text-amber-600 dark:text-amber-400 pt-1">
                  ⚠ Multi-radius — multiple press brake setups required
                </p>
              )}
            </Section>
          )}

          {featureRisks.length > 0 && (
            <Section title="Feature Risks">
              {featureRisks.map((r, i) => (
                <p key={i} className="text-[10px] text-amber-600 dark:text-amber-400 py-0.5">⚠ {r}</p>
              ))}
            </Section>
          )}

          {inspectionDrivers.length > 0 && (
            <Section title="Inspection Drivers">
              {inspectionDrivers.map((d, i) => (
                <p key={i} className="text-[10px] text-muted-foreground py-0.5">• {d}</p>
              ))}
            </Section>
          )}

          {(summary.costDrivers?.length ?? 0) > 0 && (
            <Section title="Primary Cost Drivers">
              {summary.costDrivers!.map((cd, i) => (
                <div key={i} className="flex items-baseline justify-between py-0.5">
                  <span className="text-[10px] text-muted-foreground">{cd.name}</span>
                  <span className="text-[10px] font-medium tabular-nums shrink-0">
                    {fmt(cd.value, 1)} {cd.unit}
                  </span>
                </div>
              ))}
            </Section>
          )}
        </>
      )}

      {/* ── GD&T: Explicit feature control frames ─────────────────────── */}
      {hasGdtFcf && (
        <>
          <Section title={`Feature Control Frames (${gdt!.features.length})`}>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-[10px] text-muted-foreground">
                  <th className="text-left font-medium pb-0.5">Type</th>
                  <th className="text-right font-medium pb-0.5">Tol.</th>
                  <th className="text-right font-medium pb-0.5">Datum</th>
                  <th className="text-right font-medium pb-0.5">Severity</th>
                  <th className="text-right font-medium pb-0.5">Inspection</th>
                </tr>
              </thead>
              <tbody>
                {gdt!.features.map((f, i) => (
                  <tr key={i} className="border-t border-border/40">
                    <td className="py-0.5 font-medium capitalize">{f.type}</td>
                    <td className="py-0.5 text-right tabular-nums text-muted-foreground">⌀{f.toleranceMm}</td>
                    <td className="py-0.5 text-right font-mono text-[10px]">{f.datum || '—'}</td>
                    <td className="py-0.5 text-right">
                      <span className={`text-[9px] font-semibold px-1 py-px rounded ${SEVERITY_BG[f.severity]} ${SEVERITY_COLOR[f.severity]}`}>
                        {f.severity}
                      </span>
                    </td>
                    <td className="py-0.5 text-right text-[10px] text-muted-foreground">
                      {f.inspectionMethod.replace(/_/g, ' ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {gdt!.generalTolerance && (
              <p className="text-[9px] text-muted-foreground pt-1">General: {gdt!.generalTolerance}</p>
            )}
          </Section>

          {gdtDatums.length > 0 && (
            <Section title="Datums">
              <div className="flex flex-wrap gap-1.5 py-0.5">
                {gdtDatums.map((d) => (
                  <span key={d} className="text-[11px] font-mono font-semibold border border-border rounded px-2 py-0.5 bg-muted/40">{d}</span>
                ))}
              </div>
            </Section>
          )}

          {gdtActions.length > 0 && (
            <Section title="Manufacturing Impact">
              {gdtActions.map((a, i) => (
                <p key={i} className="text-[10px] text-muted-foreground py-0.5">✓ {a}</p>
              ))}
            </Section>
          )}

          {gdt!.recommendedInspectionMethod && (
            <Section title="Inspection Impact">
              <Row label="Primary Method" value={gdt!.recommendedInspectionMethod.replace(/_/g, ' ')} />
              <Row label="Estimated Time" value={`${gdt!.totalInspectionTimeMin} min`} />
              {gdt!.analysisConfidence > 0 && (
                <Row label="Confidence" value={`${Math.round(gdt!.analysisConfidence * 100)}%`} />
              )}
              {gdt!.maxCostImpactPercent > 0 && (
                <Row label="Cost Impact" value={`+${gdt!.maxCostImpactPercent}%`} />
              )}
              <Row label="Overall Severity" value={(gdt!.overallSeverity ?? '—').toUpperCase()} />
            </Section>
          )}
        </>
      )}

      {/* ── Drawing controls (raw extraction, no GD&T inference) ──────── */}
      {hasDrawingControls && !hasGdtFcf && (
        <Section title="Drawing Controls" defaultOpen={!hasCad}>
          {generalTolerance && <Row label="General Tolerance" value={generalTolerance} />}
          {tightestToleranceMm !== null && (
            <Row label="Tightest Dimension" value={`±${tightestToleranceMm} mm`} />
          )}
          {noteLines.length > 0 && (
            <div className="pt-0.5">
              <p className="text-[9px] text-muted-foreground mb-0.5">Drawing Notes</p>
              {noteLines.map((n, i) => (
                <p key={i} className="text-[9px] text-muted-foreground/80">• {n}</p>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function Section({ title, defaultOpen = true, children }: { title: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b last:border-b-0">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left hover:bg-muted/40 transition-colors">
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">{title}</span>
      </button>
      {open && <div className="px-3 pb-2 pt-0.5 space-y-0.5">{children}</div>}
    </div>
  );
}

// ── Row / InputRow ─────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{label}</span>
      <span className="text-xs font-medium tabular-nums text-right shrink-0">{value}</span>
    </div>
  );
}

function InputRow({ label, value, onChange, onBlur }: { label: string; value: number; onChange: (v: number) => void; onBlur?: () => void }) {
  // Click-to-edit, same pattern as the Cost Guide's Blank Thickness override:
  // renders as static text by default, click (or the pencil) reveals the
  // input. Escape restores whatever value was current when editing started.
  const [isEditing, setIsEditing] = useState(false);
  const [priorValue, setPriorValue] = useState(value);
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{label}</span>
      {isEditing ? (
        <input
          autoFocus
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          onBlur={() => { onBlur?.(); setIsEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') { onChange(priorValue); setIsEditing(false); }
          }}
          className="text-xs font-medium text-right w-20 shrink-0 border border-border rounded px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500 tabular-nums"
        />
      ) : (
        <button
          onClick={() => { setPriorValue(value); setIsEditing(true); }}
          title="Click to edit"
          className="flex items-center gap-1 w-20 shrink-0 justify-end px-1.5 py-0.5 rounded border border-transparent hover:border-border group"
        >
          <Edit className="h-3 w-3 text-muted-foreground group-hover:text-foreground shrink-0" />
          <span className="text-xs font-medium tabular-nums">{value.toLocaleString()}</span>
        </button>
      )}
    </div>
  );
}

// ── Resize handles ─────────────────────────────────────────────────────────────

function HResizeHandle() {
  return (
    <PanelResizeHandle className="w-1 bg-border hover:bg-violet-400 transition-colors relative group flex items-center justify-center">
      <GripVertical className="h-4 w-4 text-muted-foreground group-hover:text-violet-600 absolute" />
    </PanelResizeHandle>
  );
}
function VResizeHandle() {
  return (
    <PanelResizeHandle className="h-1 bg-border hover:bg-violet-400 transition-colors relative group flex items-center justify-center">
      <GripHorizontal className="h-4 w-4 text-muted-foreground group-hover:text-violet-600 absolute" />
    </PanelResizeHandle>
  );
}

// ── TreeRow ────────────────────────────────────────────────────────────────────

function TreeRow({
  node, depth, expanded, selectedId, onToggle, onSelect, factory,
}: {
  node: ProcessTreeNode; depth: number; expanded: Set<string>; selectedId: string | null;
  onToggle: (id: string) => void; onSelect: (node: ProcessTreeNode) => void; factory: string;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isExpanded = expanded.has(node.id);
  const isSelected = selectedId === node.id;
  return (
    <>
      <tr
        onClick={() => onSelect(node)}
        className={`border-b border-border/30 cursor-pointer transition-colors text-xs ${isSelected ? 'bg-primary/10' : 'hover:bg-primary/5'}`}
      >
        <td className="px-2 py-1 w-5 text-center shrink-0">
          <span className="text-emerald-500 text-[9px]">●</span>
        </td>
        <td className="py-1 pr-2 max-w-0">
          <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 14}px` }}>
            {hasChildren
              ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  title={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
              )
              : <span className="w-3 shrink-0" />}
            {node.kind === 'feature' && <span className="text-blue-400 text-[9px] shrink-0">▣</span>}
            <span className={`truncate ${
              node.kind === 'part' ? 'font-semibold' :
              node.kind === 'group' ? 'font-medium' :
              node.kind === 'operation' ? 'text-foreground' : 'text-foreground/75'
            }`}>{node.label}</span>
          </div>
        </td>
        <td className="px-2 py-1 text-muted-foreground text-[11px] truncate max-w-0 w-28">
          {node.kind !== 'sub_op' ? (node.factory ?? factory) : ''}
        </td>
        <td className="px-2 py-1 text-muted-foreground text-[11px] truncate max-w-0 w-40">
          {node.machine ?? ''}
        </td>
      </tr>
      {isExpanded && node.children?.map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} expanded={expanded}
          selectedId={selectedId} onToggle={onToggle} onSelect={onSelect} factory={factory} />
      ))}
    </>
  );
}

// ── Workflow Builder KB ────────────────────────────────────────────────────────

interface WorkflowStepOption {
  id: string;
  process: string;
  label: string;
  machine?: string;
  // Real mhr_records machine_class key (default-rates.ts's machine registry) —
  // when set, RouteSelectionDialog resolves the real machine name/rate for
  // this class+location instead of showing the static `machine` placeholder.
  machineClassKey?: string;
  isDefault: boolean;
  costNote?: string;
  constraintNote?: string;
}

interface WorkflowStep {
  id: string;
  category: string;
  visible: (ctx: RouteScoringContext | null) => boolean;
  contextHint: (ctx: RouteScoringContext | null) => string;
  options: WorkflowStepOption[];
}

const WORKFLOW_KB: Record<string, WorkflowStep[]> = {
  sheet_metal: [
    {
      id: 'cutting',
      category: 'Cutting',
      visible: () => true,
      contextHint: (ctx) => ctx
        ? `${ctx.summary.holeCount ?? 0} holes · ${Math.round(ctx.summary.cutLengthMm ?? 0)} mm cut length`
        : '',
      options: [
        {
          id: 'fiber-laser', process: 'Fiber Laser Cutting', label: 'Fiber Laser',
          machineClassKey: 'fiber_laser', isDefault: true,
          costNote: 'Best for complex profiles, diverse hole sizes, and batch < 50,000 pcs',
        },
        {
          id: 'turret-punch', process: 'Turret Punching', label: 'Turret Punch',
          machineClassKey: 'turret_punch', isDefault: false,
          costNote: 'Lower unit cost at high volume with simple, repeating hole patterns',
          constraintNote: 'Requires dedicated punch-die per hole size — tooling lead time',
        },
        {
          id: 'waterjet', process: 'Waterjet Cutting', label: 'Waterjet',
          machineClassKey: 'waterjet', isDefault: false,
          costNote: 'No heat-affected zone — use for hardened or heat-sensitive alloys',
          constraintNote: 'Slow cycle — not economical above ~5,000 pcs/yr',
        },
      ],
    },
    {
      id: 'bending',
      category: 'Bending',
      visible: (ctx) => (ctx?.summary.bendCount ?? 1) > 0,
      contextHint: (ctx) => ctx ? `${ctx.summary.bendCount ?? 0} bends detected` : '',
      options: [
        {
          id: 'press-brake', process: 'CNC Press Brake', label: 'CNC Press Brake',
          machineClassKey: 'press_brake', isDefault: true,
        },
        {
          id: 'folding', process: 'Sheet Metal Folding', label: 'Folding Machine',
          machine: 'Folding Machine', isDefault: false,
          costNote: 'Good for simple edge folds on thin sheet (≤ 2mm)',
          constraintNote: 'Limited to single-axis bends — cannot form complex sequences',
        },
      ],
    },
    {
      id: 'finishing',
      category: 'Finishing',
      visible: () => true,
      contextHint: () => 'Burr removal and edge cleanup',
      options: [
        {
          id: 'deburring', process: 'Deburring', label: 'Deburring',
          machineClassKey: 'deburring', isDefault: true,
        },
        {
          id: 'skip-deburr', process: '', label: 'Skip',
          isDefault: false,
          constraintNote: 'Only for non-critical internal parts — sharp edges risk operator injury',
        },
      ],
    },
    // The four steps below are purely feature-driven — real gates shared with
    // autoCompleteRoute (tappingCandidateCount, summary.extrudedFlangeCount/
    // counterboreGroups/countersinkGroups), same real machineClassKey rate
    // resolution as every step above. No alternative machine/approach exists
    // for any of these in this system yet, so each has exactly one option
    // (still database-driven — the RATE is real, only the CHOICE isn't
    // meaningful) rather than a fabricated second "alternative" to fill the
    // dropdown. Ordered to match cost-engine.ts's real processLines sequence:
    // Deburring -> Hole Extrusion (Burring) -> Tapping -> Counterboring ->
    // Countersinking -> Surface Treatment.
    {
      id: 'hole-forming',
      category: 'Hole Extrusion (Burring)',
      visible: (ctx) => (ctx?.summary.extrudedFlangeCount ?? 0) > 0,
      contextHint: (ctx) => ctx
        ? `${ctx.summary.extrudedFlangeCount ?? 0} hole extrusion${(ctx.summary.extrudedFlangeCount ?? 0) === 1 ? '' : 's'} detected`
        : '',
      options: [
        {
          id: 'hole-forming-press', process: 'Hole Extrusion (Burring)', label: 'Hole Flanging Press',
          machineClassKey: 'hole_forming', isDefault: true,
          costNote: 'Forms the extruded collar before tapping — required whenever the drawing calls out burling',
        },
      ],
    },
    {
      id: 'tapping',
      category: 'Tapping',
      visible: (ctx) => tappingCandidateCount(ctx?.summary ?? ({} as FeatureGraphSummary)) > 0,
      contextHint: (ctx) => ctx ? `${tappingCandidateCount(ctx.summary)} tap${tappingCandidateCount(ctx.summary) === 1 ? '' : 's'} detected` : '',
      options: [
        {
          id: 'tapping-arm', process: 'Tapping', label: 'Tapping Arm',
          machineClassKey: 'tapping', isDefault: true,
        },
      ],
    },
    {
      id: 'counterboring',
      category: 'Counterboring',
      visible: (ctx) => (ctx?.summary.counterboreGroups?.length ?? 0) > 0,
      contextHint: (ctx) => ctx
        ? `${(ctx.summary.counterboreGroups ?? []).reduce((s, g) => s + g.count, 0)} counterbore(s) detected`
        : '',
      options: [
        {
          id: 'counterboring-drill', process: 'Counterboring', label: 'Drill Press',
          machineClassKey: 'drill_press', isDefault: true,
        },
      ],
    },
    {
      id: 'countersinking',
      category: 'Countersinking',
      visible: (ctx) => (ctx?.summary.countersinkGroups?.length ?? 0) > 0,
      contextHint: (ctx) => ctx
        ? `${(ctx.summary.countersinkGroups ?? []).reduce((s, g) => s + g.count, 0)} countersink(s) detected`
        : '',
      options: [
        {
          id: 'countersinking-drill', process: 'Countersinking', label: 'Drill Press',
          machineClassKey: 'drill_press', isDefault: true,
        },
      ],
    },
    {
      id: 'surface',
      category: 'Surface Treatment',
      visible: () => true,
      contextHint: () => 'Corrosion protection',
      options: [
        {
          id: 'zinc-pc', process: 'Surface Treatment', label: 'Zinc + Powder Coat',
          machine: 'Surface Treatment Line', isDefault: true,
          costNote: 'Standard for carbon steel — phosphating + powder coat',
        },
        {
          id: 'pc-only', process: 'Powder Coating', label: 'Powder Coat Only',
          machine: 'Powder Coat Booth', isDefault: false,
          costNote: 'Lower cost — use where mild corrosion protection is sufficient',
        },
        {
          id: 'none-surface', process: '', label: 'None (raw finish)',
          isDefault: false,
          constraintNote: 'Only for internal structures or pre-coated assemblies',
        },
      ],
    },
  ],
  cnc_turned: [
    {
      id: 'turning',
      category: 'Turning',
      visible: () => true,
      contextHint: () => 'Primary stock removal',
      options: [
        {
          id: '2axis', process: 'CNC Turning', label: 'CNC Lathe (2-Axis)',
          machine: 'CNC Lathe', isDefault: true,
        },
        {
          id: 'livetools', process: 'CNC Turning', label: 'Turn-Mill (Live Tooling)',
          machine: 'CNC Turn-Mill', isDefault: false,
          costNote: 'Cross-holes, flats, or keyways in a single setup',
        },
      ],
    },
    {
      id: 'finishing-ct',
      category: 'Finishing',
      visible: () => true,
      contextHint: () => '',
      options: [
        {
          id: 'deburr-ct', process: 'Deburring', label: 'Deburring',
          machine: 'Deburring Station', isDefault: true,
        },
      ],
    },
    {
      id: 'inspection-ct',
      category: 'Inspection',
      visible: () => true,
      contextHint: () => '',
      options: [
        {
          id: 'dim-ct', process: 'Inspection', label: 'Dimensional Inspection',
          machine: 'CMM', isDefault: true,
        },
      ],
    },
  ],
  cnc_milled: [
    {
      id: 'milling',
      category: 'Milling',
      visible: () => true,
      contextHint: () => 'Primary material removal',
      options: [
        {
          id: '3axis', process: 'CNC Milling', label: '3-Axis Milling',
          machine: 'CNC Milling Center', isDefault: true,
        },
        {
          id: '4axis', process: 'CNC Milling', label: '4-Axis Milling',
          machine: 'CNC 4-Axis Machining Center', isDefault: false,
          costNote: 'Helical features or continuous 4th-axis indexing required',
        },
        {
          id: '5axis', process: 'CNC Milling', label: '5-Axis Milling',
          machine: 'CNC 5-Axis Machining Center', isDefault: false,
          costNote: 'Complex contoured surfaces — single-setup advantage',
          constraintNote: 'Highest machine cost — justify with complex surface requirements',
        },
      ],
    },
    {
      id: 'finishing-cm',
      category: 'Finishing',
      visible: () => true,
      contextHint: () => '',
      options: [
        {
          id: 'deburr-cm', process: 'Deburring', label: 'Deburring',
          machine: 'Deburring Station', isDefault: true,
        },
      ],
    },
    {
      id: 'inspection-cm',
      category: 'Inspection',
      visible: () => true,
      contextHint: () => '',
      options: [
        {
          id: 'dim-cm', process: 'Inspection', label: 'Dimensional Inspection',
          machine: 'CMM', isDefault: true,
        },
      ],
    },
  ],
};

// ── Dynamic route step model (sheet_metal only — real, DB-driven, no
// hardcoded option lists) ────────────────────────────────────────────────────
interface DynamicRouteStep {
  key: string;
  process: string;
  machineClass: string;
  hourlyRate: number; // real, local-currency — from the engine-computed line
                       // when isReal, else a from-scratch real machine rate
  cycleTimeMin: number; // real when isReal; 0/manual-entry-needed otherwise
  // True when `process` matches a line the engine actually computed from this
  // part's real geometry. False for a step picked from the full catalog with
  // no geometric trigger here yet — processGroup/processRoute are required in
  // that case so the backend can validate + resolve a real machine class from
  // process_calculator_mappings (see applyCustomRoute).
  isReal: boolean;
  processGroup?: string;
  processRoute?: string;
}

// Every route getRouteComparison returns shares identical non-cutting lines
// (deburr/press-brake/tapping/burring — computed once, reused across all
// routes; see that method's "Shared process lines" section) — only each
// route's own cutting line differs. So "which machineClass is a cutting
// machineClass" is derivable structurally from the live API response itself
// (whatever machineClass ISN'T common to every route), never a hardcoded set
// that silently goes stale the moment the backend's engine registry grows.
function cuttingMachineClassesFromRoutes(routes: Pick<RouteResultDto, 'processLines'>[]): Set<string> {
  if (routes.length === 0) return new Set();
  const classSets = routes.map((r) => new Set(r.processLines.map((l) => l.machineClass)));
  const shared = new Set([...classSets[0]!].filter((cls) => classSets.every((s) => s.has(cls))));
  const cutting = new Set<string>();
  for (const s of classSets) for (const cls of s) if (!shared.has(cls)) cutting.add(cls);
  return cutting;
}
// Inverse of the above — used to recover which real cutting route a stored
// process_cost_records row's machine_class corresponds to (see the routing-
// restoration effect below), never a guessed/computed mapping.
function cuttingMachineClassToRouteId(routes: Pick<RouteResultDto, 'routeId' | 'processLines'>[]): Record<string, string> {
  const cuttingClasses = cuttingMachineClassesFromRoutes(routes);
  const map: Record<string, string> = {};
  for (const r of routes) {
    const cuttingLine = r.processLines.find((l) => cuttingClasses.has(l.machineClass));
    if (cuttingLine) map[cuttingLine.machineClass] = r.routeId;
  }
  return map;
}
// Tied to computeRouteScore's hand-authored engineering judgment below (real
// tooling-amortization/HAZ/edge-quality tradeoffs specific to these 3 methods)
// — NOT structural like the two functions above, so deliberately NOT derived
// from the live route list: a future 4th registered engine needs its own real
// scoring heuristic added to computeRouteScore (and a literal added here) before
// it's meaningful to rank, same as it needs its own real cost formula on the
// backend. Iterating whatever the API happens to return would silently score
// an unresearched method using computeRouteScore's neutral 76/100 default,
// which is exactly the "fabricated confidence" this whole registry redesign
// was meant to prevent.
const CUTTING_ROUTE_IDS = ['sm-laser', 'sm-turret', 'sm-waterjet'] as const;

// Real physical ordering already encoded elsewhere in this codebase
// (cost-engine.ts's real processLines sequence, autoCompleteRoute's insertion
// points) — used only to softly WARN on an invalid custom reorder, never to
// block it (a real shop may have a genuine reason to deviate).
// Real process names as cost-engine.ts/turret-punch-engine.ts/waterjet-engine.ts
// actually emit them (confirmed by grep — "Laser Cutting" and "Press Brake",
// NOT the old WORKFLOW_KB display labels "Fiber Laser Cutting"/"CNC Press
// Brake", which never matched and silently made every ordering check a no-op).
// Hole Extrusion (Burring) + Tapping come BEFORE Press Brake + Deburring:
// the thread sits in the extruded collar, so the collar must be formed and
// tapped while the part is still flat (tapping an already-bent flange risks
// tool access/interference, and this also avoids handling an already-bent
// part through tapping) — see the matching reorder in cost-engine.ts /
// bom-items.service.ts::getRouteComparison's allLines assembly.
const REAL_PROCESS_ORDER = [
  'Laser Cutting', 'Turret Punching', 'Waterjet Cutting',
  'Hole Extrusion (Burring)', 'Tapping', 'Press Brake', 'Deburring',
  'Counterboring', 'Countersinking', 'PEM Insertion', 'Reaming', 'CMM Inspection',
  'Surface Treatment',
];
function orderingWarnings(orderedProcesses: string[]): Record<string, string> {
  const warnings: Record<string, string> = {};
  for (let i = 0; i < orderedProcesses.length; i++) {
    const p = orderedProcesses[i]!;
    const pIdx = REAL_PROCESS_ORDER.indexOf(p);
    if (pIdx < 0) continue;
    for (let j = 0; j < i; j++) {
      const q = orderedProcesses[j]!;
      const qIdx = REAL_PROCESS_ORDER.indexOf(q);
      if (qIdx > pIdx) { warnings[p] = `Typically performed before ${q}`; break; }
    }
  }
  return warnings;
}

// ── RouteSelectionDialog (Workflow Builder) ────────────────────────────────────

function RouteSelectionDialog({
  open, onClose, onApplied, partFamily, currentRouteId, onSelectRoute, scoringCtx, factory = 'USA',
  itemId, batchSize = 1, existingCuttingRouteId, existingSteps,
}: {
  open: boolean;
  // Cancel / backdrop-dismiss / Escape — genuinely closing without applying.
  // Falls back to Auto routing if no manual route had ever been applied yet.
  onClose: () => void;
  // A route was just successfully applied — just close, never fall back to
  // Auto. Calling onClose() here instead used to race: onSelectRoute's
  // setProcessRouting('manual')/setSelectedManualRoute(route) haven't
  // re-rendered yet when onClose's own "if (!selectedManualRoute) revert to
  // auto" check runs in the same tick, so it read the pre-update (null) value
  // and clobbered 'manual' back to 'auto' immediately after every apply.
  onApplied: () => void;
  partFamily: string | null;
  currentRouteId: string | null;
  onSelectRoute: (route: ManualRouteOption) => void;
  cost: CostSummaryDto | null;
  scoringCtx: RouteScoringContext | null;
  factory?: string;
  itemId?: string;
  batchSize?: number;
  // Exact identity of the currently-applied dynamic route (see
  // ManualRouteOption.dynamicCuttingRouteId/dynamicSteps) — when present and
  // still a valid real route, reopening this dialog to edit restores exactly
  // what's applied instead of resetting to the CAD-optimal default (which is
  // only right the FIRST time a part gets a manual route, not on every re-edit).
  existingCuttingRouteId?: string | null;
  existingSteps?: ManualRouteOption['dynamicSteps'];
}) {
  const isSheetMetal = partFamily === 'sheet_metal';

  // ── Universal real machine/rate resolution — ONE fetch each, no fixed
  // per-class array. The old array existed because React hooks can't be
  // called in a variable-length loop — but mhrApi.getAll/getBenchmarkRates
  // both treat machineClass as optional (lib/api/mhr.ts), returning every
  // class for the location when omitted. Filtering client-side per row
  // removes that ceiling structurally, which is what actually made dynamic
  // (any number of, any class) steps possible.
  const allMhr = useMHRRecords({ location: factory, limit: 300 }, { enabled: open });
  const allBenchmark = useMHRBenchmark(factory, undefined, { enabled: open });
  const resolveForClass = (cls: string): { id: string; machineName: string; rate: number; isBenchmark: boolean } | null => {
    const own = (allMhr.data?.records ?? []).filter((r) => r.machineClass === cls);
    const bm = (allBenchmark.data ?? []).filter((r) => r.machineClass === cls);
    if (own.length > 0) {
      const cheapest = [...own].sort((a, b) => resolveMhrUsdRate(a) - resolveMhrUsdRate(b))[0]!;
      return { id: cheapest.id, machineName: cheapest.machineName, rate: resolveMhrUsdRate(cheapest), isBenchmark: false };
    }
    if (bm.length > 0) {
      const cheapest = [...bm].sort((a, b) => (a.calculations?.totalMachineHourRate ?? 0) - (b.calculations?.totalMachineHourRate ?? 0))[0]!;
      return { id: cheapest.id, machineName: cheapest.machineName, rate: cheapest.calculations?.totalMachineHourRate ?? 0, isBenchmark: true };
    }
    return null;
  };
  // Old fixed-family path still keys into this by machineClassKey — kept
  // working via resolveForClass instead of the retired per-class object.
  const resolvedMachine: Record<string, { id: string; machineName: string; rate: number; isBenchmark: boolean } | null> = {};

  // ═══ Dynamic path (sheet_metal): real, comparison-driven steps ═══════════
  // "Add Step" can only ever offer operations from this real, already-
  // engine-computed set — never an unconstrained browse of the whole DB
  // catalog. Every route the engine returns shares identical non-cutting
  // lines (see getRouteComparison's "shared process lines" — gated purely by
  // this part's real geometry, not by cutting method), so any one route's
  // full line set (minus its own cutting line) is the real universe of
  // addable operations; cutting itself gets exactly 3 real alternatives.
  const comparison = useRouteComparison(isSheetMetal ? itemId : undefined, batchSize, factory);
  const realRoutes = comparison.data?.routes ?? [];
  const cuttingMachineClasses = cuttingMachineClassesFromRoutes(realRoutes);
  const sharedLines: ProcessLineCost[] = (realRoutes[0]?.processLines ?? []).filter(
    (l) => !cuttingMachineClasses.has(l.machineClass),
  );
  const cuttingLineByRouteId = new Map<string, ProcessLineCost>();
  for (const r of realRoutes) {
    const cuttingLine = r.processLines.find((l) => cuttingMachineClasses.has(l.machineClass));
    if (cuttingLine) cuttingLineByRouteId.set(r.routeId, cuttingLine);
  }

  const [cuttingRouteId, setCuttingRouteId] = useState<string | null>(null);
  const [additionalSteps, setAdditionalSteps] = useState<DynamicRouteStep[] | null>(null);
  const wasOpenRef = useRef(false);

  // Real, CAD-derived best cutting route for THIS part's geometry (tonnage,
  // thickness, hole count, etc. — see computeRouteScore) — recomputed from
  // live scoringCtx, never cached from a prior selection, so it always
  // reflects the part actually loaded in the dialog.
  const cuttingRouteScores = scoringCtx
    ? CUTTING_ROUTE_IDS.map((rid) => [rid, computeRouteScore(rid, scoringCtx).totalScore] as const)
    : null;
  const recommendedCuttingId = cuttingRouteScores
    ? [...cuttingRouteScores].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    : null;
  const selectedCuttingRouteLabel = cuttingRouteId
    ? realRoutes.find((r) => r.routeId === cuttingRouteId)?.routeLabel ?? null
    : null;
  // Surfaced only as an honest "previously applied X" note when it differs
  // from the CAD-optimal pick above — the dialog's default no longer follows
  // it (see the seeding effect below), but silently discarding it would hide
  // a real change from the user.
  const previouslyAppliedRouteLabel = (currentRouteId && currentRouteId !== recommendedCuttingId)
    ? realRoutes.find((r) => r.routeId === currentRouteId)?.routeLabel ?? null
    : null;

  // ── "Add Step" — full real Group → Route → Operation cascade, same source
  // (process_calculator_mappings) and derivation pattern as ProcessCostDialog's
  // own hierarchical picker, so any real, active catalog operation can be
  // added — not just ones this part's geometry already triggered. An
  // operation added this way that ISN'T also a real engine-computed line for
  // this part gets a real machine rate (resolveForClass) but an honest 0
  // cycle time — see DynamicRouteStep.isReal.
  const { data: allMappingsData } = useProcessCalculatorMappings({ limit: 1000 }, { enabled: open && isSheetMetal });
  const [addGroup, setAddGroup] = useState('');
  const [addRoute, setAddRoute] = useState('');
  const [addOperation, setAddOperation] = useState('');
  const addGroupOptions = Array.from(new Set((allMappingsData?.mappings ?? []).map((m) => m.processGroup))).sort();
  const addRouteOptions = addGroup
    ? Array.from(new Set((allMappingsData?.mappings ?? [])
        .filter((m) => m.processGroup === addGroup).map((m) => m.processRoute))).sort()
    : [];
  const addOperationOptions = (addGroup && addRoute)
    ? (allMappingsData?.mappings ?? [])
        .filter((m) => m.processGroup === addGroup && m.processRoute === addRoute && m.isActive)
        .filter((m) => !(additionalSteps ?? []).some((s) => s.process === m.operation || s.machineClass === m.machineClass))
    : [];
  useEffect(() => {
    if (!isSheetMetal) return;
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened || realRoutes.length === 0) return;

    // Editing an already-applied dynamic route restores exactly what's
    // applied — CAD-optimal is only the right default the FIRST time a part
    // gets a manual route, not every time its existing custom route is
    // reopened (that would silently discard the customization on every edit).
    if (existingCuttingRouteId && cuttingLineByRouteId.has(existingCuttingRouteId)) {
      setCuttingRouteId(existingCuttingRouteId);
      setAdditionalSteps((existingSteps ?? []).map((s, i): DynamicRouteStep => {
        // Match by machineClass, not process name — process_cost_records.operation
        // is resolved from process_calculator_mappings' real catalog name (e.g.
        // "Bend Brake", "Deburr") at apply time, which differs from the cost
        // engine's own internal process label ("Press Brake", "Deburring") for
        // the exact same machine class. machineClass is the stable identifier
        // both sides agree on; process is only a cosmetic display string that
        // differs between the two naming systems. Matching by process name here
        // silently lost the real engine cycleTimeMin/hourlyRate on every restore
        // for these two classes, falling back to isReal:false + cycleTimeMin:0.
        const real = sharedLines.find((l) => l.machineClass === s.machineClass) ?? sharedLines.find((l) => l.process === s.process);
        if (real) {
          return {
            key: `${s.process}-${i}`, process: real.process, machineClass: real.machineClass,
            hourlyRate: real.hourlyRate, cycleTimeMin: real.cycleTimeMin, isReal: true,
          };
        }
        const resolved = resolveForClass(s.machineClass);
        return {
          key: `${s.process}-${i}`, process: s.process, machineClass: s.machineClass,
          hourlyRate: resolved?.rate ?? 0, cycleTimeMin: 0, isReal: false,
          ...(s.processGroup !== undefined ? { processGroup: s.processGroup } : {}),
          ...(s.processRoute !== undefined ? { processRoute: s.processRoute } : {}),
        };
      }));
      return;
    }

    // No existing dynamic route to restore — default to the CAD-optimal
    // cutting route for this part's real geometry (computeRouteScore).
    setCuttingRouteId(recommendedCuttingId ?? realRoutes[0]!.routeId);
    setAdditionalSteps(sharedLines.map((l, i) => ({
      key: `${l.process}-${i}`, process: l.process, machineClass: l.machineClass,
      hourlyRate: l.hourlyRate, cycleTimeMin: l.cycleTimeMin, isReal: true,
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isSheetMetal, realRoutes.length]);

  const orderedRealProcesses = [
    cuttingRouteId ? cuttingLineByRouteId.get(cuttingRouteId)?.process : null,
    ...(additionalSteps ?? []).map((s) => s.process),
  ].filter((p): p is string => !!p);
  const stepOrderWarnings = orderingWarnings(orderedRealProcesses);
  // Real, geometry-triggered operations (sharedLines) this part actually
  // needs but that aren't in the current step list — happens whenever an
  // existing custom route is being re-edited (that path restores exactly
  // what was applied before, deliberately not auto-adding new steps — see
  // the seeding effect above) and the part's detected features have since
  // gained a new real operation (e.g. threads detected → Tapping) that
  // predates this particular saved route. Surfaced as an explicit prompt
  // instead of silently omitted or silently force-added.
  // Matched by machineClass, not process name — see the restore-effect
  // comment above for why a name-only match spuriously flagged Press
  // Brake/Deburring as "missing" (they were present, just stored under
  // the catalog's own operation name, "Bend Brake"/"Deburr").
  const missingRealSteps = sharedLines.filter(
    (l) => !(additionalSteps ?? []).some((s) => s.machineClass === l.machineClass || s.process === l.process),
  );
  function addMissingStep(l: ProcessLineCost) {
    setAdditionalSteps((prev) => [...(prev ?? []), {
      key: `${l.process}-${Date.now()}`, process: l.process, machineClass: l.machineClass,
      hourlyRate: l.hourlyRate, cycleTimeMin: l.cycleTimeMin, isReal: true,
    }]);
  }

  function moveStep(index: number, dir: -1 | 1) {
    setAdditionalSteps((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const swapWith = index + dir;
      if (swapWith < 0 || swapWith >= next.length) return prev;
      [next[index], next[swapWith]] = [next[swapWith]!, next[index]!];
      return next;
    });
  }
  function removeStep(key: string) {
    setAdditionalSteps((prev) => prev?.filter((s) => s.key !== key) ?? prev);
  }
  // Adds whatever operation is currently selected in the Group/Route/
  // Operation cascade. If it matches a real, engine-computed line for this
  // part (isReal: true), reuse its real cycleTimeMin/hourlyRate verbatim.
  // Otherwise it's a real catalog operation with no geometric trigger here
  // yet — real machine class + real machine rate (resolveForClass), but an
  // honest 0 cycle time, never fabricated (see applyCustomRoute server-side).
  function addStepFromCatalog() {
    const mapping = addOperationOptions.find((m) => m.operation === addOperation);
    if (!mapping) return;
    // Match by machineClass, not operation name — see the identical comment on
    // the restore-effect lookup above for why (catalog operation names like
    // "Bend Brake"/"Deburr" differ from the engine's own process labels
    // "Press Brake"/"Deburring" for the same machine class).
    const real = mapping.machineClass
      ? sharedLines.find((l) => l.machineClass === mapping.machineClass)
      : sharedLines.find((l) => l.process === mapping.operation);
    const key = `${mapping.operation}-${Date.now()}`;
    if (real) {
      setAdditionalSteps((prev) => [...(prev ?? []), {
        key, process: real.process, machineClass: real.machineClass,
        hourlyRate: real.hourlyRate, cycleTimeMin: real.cycleTimeMin, isReal: true,
      }]);
    } else if (mapping.machineClass) {
      const resolved = resolveForClass(mapping.machineClass);
      setAdditionalSteps((prev) => [...(prev ?? []), {
        key, process: mapping.operation, machineClass: mapping.machineClass!,
        hourlyRate: resolved?.rate ?? 0, cycleTimeMin: 0, isReal: false,
        processGroup: mapping.processGroup, processRoute: mapping.processRoute,
      }]);
    }
    setAddOperation('');
  }

  // Stages the dynamic (sheet-metal) route — builds the same ApplyCustomRouteStep
  // shape apply-custom-route will eventually need, but does NOT call the API
  // here. "Set Route" only sets processRouting='manual'/selectedManualRoute in
  // the parent; the real apply-custom-route call happens later, inside Apply
  // Scenario (see the parent's applyScenario), bundled with whatever Digital
  // Factory/Batch Size is committed at that point.
  function handleSetRouteDynamic() {
    if (!cuttingRouteId || !additionalSteps) return;
    const cuttingLine = cuttingLineByRouteId.get(cuttingRouteId);
    if (!cuttingLine) return;
    // Pin the exact real machine shown in this dialog for every step — the
    // engine's own internal selection could otherwise independently pick a
    // different real machine of the same class than what was displayed.
    const allClasses = [cuttingLine.machineClass, ...additionalSteps.map((s) => s.machineClass)];
    const machineOverrides: { processKey: string; mhrRecordId: string }[] = [];
    for (const cls of allClasses) {
      const resolved = resolveForClass(cls);
      if (resolved) machineOverrides.push({ processKey: cls, mhrRecordId: resolved.id });
    }
    const route: ManualRouteOption = {
      id: `custom-${Date.now()}`,
      label: [cuttingLine.process, ...additionalSteps.map((s) => s.process)].filter(Boolean).join(' + ') || 'Custom Workflow',
      complexityLevel: 'standard',
      isRecommended: false,
      processes: orderedRealProcesses,
      rationale: 'Custom workflow — assembled step by step, staged for Apply Scenario',
      machineOverrides,
      dynamicCuttingRouteId: cuttingRouteId,
      dynamicCuttingStep: { process: cuttingLine.process, machineClass: cuttingLine.machineClass },
      dynamicSteps: additionalSteps.map((s) => ({
        process: s.process, machineClass: s.machineClass, isReal: s.isReal,
        ...(s.processGroup !== undefined ? { processGroup: s.processGroup } : {}),
        ...(s.processRoute !== undefined ? { processRoute: s.processRoute } : {}),
      })),
    };
    onSelectRoute(route);
    onApplied();
  }

  // ═══ Fixed-family path (cnc_turned/cnc_milled/etc. — unchanged UX,
  // WORKFLOW_KB-driven) — kept for families not yet migrated to the real
  // comparison-driven model above. ═══════════════════════════════════════════
  const allSteps: WorkflowStep[] = WORKFLOW_KB[partFamily ?? ''] ?? [];
  const visibleSteps = allSteps.filter((s) => s.visible(scoringCtx));
  for (const step of visibleSteps) {
    for (const opt of step.options) {
      if (opt.machineClassKey) resolvedMachine[opt.machineClassKey] = resolveForClass(opt.machineClassKey);
    }
  }

  const [selectedPerStep, setSelectedPerStep] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const step of allSteps) {
      const def = step.options.find((o) => o.isDefault) ?? step.options[0];
      if (def) init[step.id] = def.id;
    }
    return init;
  });

  const cuttingScores = scoringCtx ? {
    'fiber-laser':  computeRouteScore('sm-laser',   scoringCtx).totalScore,
    'turret-punch': computeRouteScore('sm-turret',  scoringCtx).totalScore,
    'waterjet':     computeRouteScore('sm-waterjet', scoringCtx).totalScore,
  } : null;
  const recommendedOptionId: Record<string, string> = {};
  if (cuttingScores) {
    const best = Object.entries(cuttingScores).sort((a, b) => b[1] - a[1])[0];
    if (best) recommendedOptionId['cutting'] = best[0];
  }

  const appliedProcesses = visibleSteps
    .map((step) => {
      const selId = selectedPerStep[step.id] ?? step.options.find((o) => o.isDefault)?.id;
      return step.options.find((o) => o.id === selId)?.process ?? '';
    })
    .filter((p) => p.length > 0);

  // Real machine name per applied process — for the compact flow diagram,
  // which is keyed by process name rather than machineClassKey.
  const fixedProcessToMachineName: Record<string, string> = {};
  for (const step of visibleSteps) {
    const selId = selectedPerStep[step.id] ?? step.options.find((o) => o.isDefault)?.id;
    const opt = step.options.find((o) => o.id === selId);
    if (!opt?.process) continue;
    const real = opt.machineClassKey ? resolvedMachine[opt.machineClassKey] : null;
    fixedProcessToMachineName[opt.process] = real?.machineName ?? opt.machine ?? '';
  }

  const fixedFlowNodes = ['Raw Blank', ...appliedProcesses, 'Finished Part'];

  // ═══ Dynamic path's flow-diagram equivalents ═══════════════════════════════
  const dynamicFlowNodes = ['Raw Blank', ...orderedRealProcesses, 'Finished Part'];
  const dynamicProcessToMachineName: Record<string, string> = {};
  if (cuttingRouteId) {
    const cl = cuttingLineByRouteId.get(cuttingRouteId);
    if (cl) dynamicProcessToMachineName[cl.process] = resolveForClass(cl.machineClass)?.machineName ?? cl.machineName ?? '';
  }
  for (const s of additionalSteps ?? []) {
    dynamicProcessToMachineName[s.process] = resolveForClass(s.machineClass)?.machineName ?? '';
  }
  const flowNodes = isSheetMetal ? dynamicFlowNodes : fixedFlowNodes;
  const processToMachineName = isSheetMetal ? dynamicProcessToMachineName : fixedProcessToMachineName;

  function handleApplyFixed() {
    const label = visibleSteps
      .map((step) => {
        const selId = selectedPerStep[step.id] ?? step.options.find((o) => o.isDefault)?.id;
        return step.options.find((o) => o.id === selId)?.label ?? '';
      })
      .filter(Boolean)
      .slice(0, 3)
      .join(' + ');
    // Real machine picked per step where a real mhr_records/benchmark machine
    // was resolved — carried on the route so the parent can apply it via
    // useMachineOverride AFTER apply-route creates the process_cost_records
    // rows (machine-override updates an existing row, so firing it here,
    // before apply-route runs, would silently do nothing).
    const machineOverrides: { processKey: string; mhrRecordId: string }[] = [];
    for (const step of visibleSteps) {
      const selId = selectedPerStep[step.id] ?? step.options.find((o) => o.isDefault)?.id;
      const opt = step.options.find((o) => o.id === selId);
      if (opt?.machineClassKey && resolvedMachine[opt.machineClassKey]) {
        machineOverrides.push({ processKey: opt.machineClassKey, mhrRecordId: resolvedMachine[opt.machineClassKey]!.id });
      }
    }
    const route: ManualRouteOption = {
      id: `custom-${Date.now()}`,
      label: label || 'Custom Workflow',
      complexityLevel: 'standard',
      isRecommended: false,
      processes: appliedProcesses,
      rationale: 'Custom workflow — assembled step by step',
      machineOverrides,
    };
    onSelectRoute(route);
    onApplied();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }}>

        {/* Header */}
        <DialogHeader className="px-5 pt-4 pb-3 border-b shrink-0">
          <DialogTitle>Workflow Builder</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Select the operation for each step. The process flow updates live.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">

          {/* Live connected flow */}
          <div className="px-4 py-2.5 border-b bg-slate-950/60 shrink-0">
            <div className="flex items-center overflow-x-auto gap-0 pb-0.5">
              {flowNodes.map((proc, i) => (
                <Fragment key={proc + i}>
                  <div className={cn(
                    'rounded border px-2 py-1 text-center shrink-0',
                    i === 0 || i === flowNodes.length - 1
                      ? 'border-slate-600 bg-slate-800/60 text-slate-400 min-w-[64px]'
                      : 'border-violet-500/50 bg-violet-950/40 text-slate-100 min-w-[72px]',
                  )}>
                    <div className="text-[10px] font-medium leading-tight">{proc}</div>
                    {processToMachineName[proc] && (
                      <div className="text-[9px] text-muted-foreground mt-0.5 truncate">{processToMachineName[proc]}</div>
                    )}
                  </div>
                  {i < flowNodes.length - 1 && (
                    <div className="shrink-0 text-slate-600 px-0.5 text-xs">→</div>
                  )}
                </Fragment>
              ))}
            </div>
          </div>

          {/* Automatic route indicator — always reflects the real cutting
              line actually selected below, never a separate/stale label */}
          {isSheetMetal && selectedCuttingRouteLabel && (
            <div className="px-4 py-1.5 border-b bg-muted/20 flex items-center gap-1.5 text-[11px] shrink-0">
              <span className="text-muted-foreground">Route:</span>
              <span className="font-medium">{selectedCuttingRouteLabel}</span>
              {cuttingRouteId === recommendedCuttingId ? (
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium bg-blue-600/20 text-blue-400 border border-blue-500/30">CAD-optimal</span>
              ) : (
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium bg-violet-600/20 text-violet-400 border border-violet-500/30">Custom</span>
              )}
              {previouslyAppliedRouteLabel && (
                <span className="text-muted-foreground/60 italic">
                  (previously applied: {previouslyAppliedRouteLabel})
                </span>
              )}
            </div>
          )}

          {/* Operations table — eMithran style */}
          {isSheetMetal ? (
            <>
            {missingRealSteps.length > 0 && (
              <div className="mb-2 px-3 py-2 rounded border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] space-y-1.5">
                <div>⚠ This part's real geometry also triggers {missingRealSteps.length === 1 ? 'an operation' : 'operations'} not in this route:</div>
                <div className="flex flex-wrap gap-1.5">
                  {missingRealSteps.map((l) => (
                    <button
                      key={l.process}
                      type="button"
                      onClick={() => addMissingStep(l)}
                      className="text-[11px] font-medium bg-amber-500/20 border border-amber-500/40 rounded px-2 py-0.5 hover:bg-amber-500/30"
                    >
                      + Add {l.process}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b bg-muted/50 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="px-3 py-2 text-left w-6">#</th>
                  <th className="px-3 py-2 text-left w-16">Reorder</th>
                  <th className="px-3 py-2 text-left">Operation</th>
                  <th className="px-3 py-2 text-left w-36">Machine / Resource</th>
                  <th className="px-3 py-2 text-left w-24"></th>
                </tr>
              </thead>
              <tbody>
                {/* Add Step — full real Group → Route → Operation catalog
                    (process_calculator_mappings), cascading. Picks matching this
                    part's real engine-computed lines reuse their real rate/cycle
                    time; catalog-only picks resolve a real machine rate with an
                    honest "needs manual cycle time" flag — see addStepFromCatalog.
                    Kept at the top so it's visible without scrolling past the
                    whole route. */}
                <tr className="border-b bg-muted/10">
                  <td className="px-3 py-2.5" colSpan={2}></td>
                  <td className="px-3 py-2.5" colSpan={3}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        value={addGroup}
                        onChange={(e) => { setAddGroup(e.target.value); setAddRoute(''); setAddOperation(''); }}
                        className="text-xs bg-background border border-dashed border-border rounded px-2 py-1 focus:border-violet-500 focus:outline-none cursor-pointer"
                      >
                        <option value="">+ Group…</option>
                        {addGroupOptions.map((g) => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                      <select
                        value={addRoute}
                        onChange={(e) => { setAddRoute(e.target.value); setAddOperation(''); }}
                        disabled={!addGroup}
                        className="text-xs bg-background border border-dashed border-border rounded px-2 py-1 focus:border-violet-500 focus:outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <option value="">Route…</option>
                        {addRouteOptions.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <select
                        value={addOperation}
                        onChange={(e) => setAddOperation(e.target.value)}
                        disabled={!addRoute}
                        className="text-xs bg-background border border-dashed border-border rounded px-2 py-1 focus:border-violet-500 focus:outline-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <option value="">Operation…</option>
                        {addOperationOptions.map((m) => (
                          <option key={m.operation} value={m.operation}>{m.operation}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={addStepFromCatalog}
                        disabled={!addOperation}
                        className="text-xs px-2 py-1 rounded bg-violet-600/20 text-violet-400 border border-violet-500/30 hover:bg-violet-600/30 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        + Add
                      </button>
                    </div>
                    {addGroup && addRoute && addOperationOptions.length === 0 && (
                      <p className="text-[10px] text-muted-foreground/60 italic mt-1">
                        Every active operation in this route is already included.
                      </p>
                    )}
                  </td>
                </tr>

                {/* Cutting — always required, exactly 3 real alternatives (the
                    only thing that genuinely varies between the engine's routes) */}
                {(() => {
                  const cl = cuttingRouteId ? cuttingLineByRouteId.get(cuttingRouteId) : null;
                  const machine = cl ? resolveForClass(cl.machineClass) : null;
                  return (
                    <tr className="border-b hover:bg-muted/20 transition-colors align-top">
                      <td className="px-3 py-2.5 text-[11px] text-muted-foreground/60">1</td>
                      <td className="px-3 py-2.5 text-[10px] text-muted-foreground/40">fixed</td>
                      <td className="px-3 py-2.5">
                        <select
                          value={cuttingRouteId ?? ''}
                          onChange={(e) => setCuttingRouteId(e.target.value)}
                          className="w-full text-xs bg-background border border-border rounded px-2 py-1 focus:border-violet-500 focus:outline-none cursor-pointer"
                        >
                          {realRoutes.map((r) => (
                            <option key={r.routeId} value={r.routeId}>
                              {cuttingLineByRouteId.get(r.routeId)?.process ?? r.routeLabel}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground leading-tight">
                        {machine ? (
                          <>
                            <div>{machine.machineName}</div>
                            <div className="text-[10px] tabular-nums">
                              ${machine.rate.toFixed(2)}/hr{machine.isBenchmark ? ' ★' : ''}
                            </div>
                          </>
                        ) : <span className="italic text-muted-foreground/60">No machine on file</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {cuttingRouteId === recommendedCuttingId ? (
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium bg-blue-600/20 text-blue-400 border border-blue-500/30">Recommended</span>
                        ) : (
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium bg-violet-600/20 text-violet-400 border border-violet-500/30">Custom</span>
                        )}
                      </td>
                    </tr>
                  );
                })()}

                {/* Every other real, geometry-driven operation — add/remove/reorder freely */}
                {(additionalSteps ?? []).map((s, idx) => {
                  const machine = resolveForClass(s.machineClass);
                  const warning = stepOrderWarnings[s.process];
                  return (
                    <tr key={s.key} className="border-b hover:bg-muted/20 transition-colors align-top">
                      <td className="px-3 py-2.5 text-[11px] text-muted-foreground/60">{idx + 2}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => moveStep(idx, -1)} disabled={idx === 0}
                            className="text-muted-foreground/60 hover:text-foreground disabled:opacity-30 text-[10px] leading-none" title="Move up">▲</button>
                          <button type="button" onClick={() => moveStep(idx, 1)} disabled={idx === (additionalSteps?.length ?? 0) - 1}
                            className="text-muted-foreground/60 hover:text-foreground disabled:opacity-30 text-[10px] leading-none" title="Move down">▼</button>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-xs font-medium leading-tight">{s.process}</div>
                        {warning && <p className="text-[10px] text-orange-400/80 mt-1 leading-snug">⚠ {warning}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground leading-tight">
                        {machine ? (
                          <>
                            <div>{machine.machineName}</div>
                            <div className="text-[10px] tabular-nums">
                              ${machine.rate.toFixed(2)}/hr{machine.isBenchmark ? ' ★' : ''}
                            </div>
                          </>
                        ) : <span className="italic text-muted-foreground/60">No machine on file</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <button type="button" onClick={() => removeStep(s.key)}
                          className="text-muted-foreground/60 hover:text-red-400 text-xs" title="Remove step">✕ Remove</button>
                      </td>
                    </tr>
                  );
                })}

              </tbody>
            </table>
            </>
          ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/50 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                <th className="px-3 py-2 text-left w-6">#</th>
                <th className="px-3 py-2 text-left w-28">Step</th>
                <th className="px-3 py-2 text-left">Operation</th>
                <th className="px-3 py-2 text-left w-36">Machine / Resource</th>
                <th className="px-3 py-2 text-left w-24">Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleSteps.map((step, idx) => {
                const selectedId = selectedPerStep[step.id] ?? step.options.find((o) => o.isDefault)?.id;
                const selectedOpt = step.options.find((o) => o.id === selectedId);
                const hint = step.contextHint(scoringCtx);
                const isRec = recommendedOptionId[step.id]
                  ? selectedId === recommendedOptionId[step.id]
                  : selectedOpt?.isDefault ?? false;
                return (
                  <tr key={step.id} className="border-b hover:bg-muted/20 transition-colors align-top">
                    {/* # */}
                    <td className="px-3 py-2.5 text-[11px] text-muted-foreground/60">{idx + 1}</td>

                    {/* Step label */}
                    <td className="px-3 py-2.5">
                      <div className="text-xs font-medium leading-tight">{step.category}</div>
                      {hint && (
                        <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{hint}</div>
                      )}
                    </td>

                    {/* Operation dropdown + notes */}
                    <td className="px-3 py-2.5">
                      <select
                        value={selectedId ?? ''}
                        onChange={(e) => setSelectedPerStep((prev) => ({ ...prev, [step.id]: e.target.value }))}
                        className="w-full text-xs bg-background border border-border rounded px-2 py-1 focus:border-violet-500 focus:outline-none cursor-pointer"
                      >
                        {step.options.map((opt) => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </select>
                      {selectedOpt?.constraintNote && (
                        <p className="text-[10px] text-orange-400/80 mt-1 leading-snug">
                          ⚠ {selectedOpt.constraintNote}
                        </p>
                      )}
                      {selectedOpt?.costNote && (
                        <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                          {selectedOpt.costNote}
                        </p>
                      )}
                    </td>

                    {/* Machine — real mhr_records/benchmark name+rate when this
                        option has a machineClassKey; static text otherwise
                        (e.g. Folding Machine, Surface Treatment — no clean
                        single machine_class mapping exists for those yet) */}
                    <td className="px-3 py-2.5 text-xs text-muted-foreground leading-tight">
                      {selectedOpt?.machineClassKey ? (
                        resolvedMachine[selectedOpt.machineClassKey] ? (
                          <>
                            <div>{resolvedMachine[selectedOpt.machineClassKey]!.machineName}</div>
                            <div className="text-[10px] tabular-nums">
                              ${resolvedMachine[selectedOpt.machineClassKey]!.rate.toFixed(2)}/hr
                              {resolvedMachine[selectedOpt.machineClassKey]!.isBenchmark ? ' ★' : ''}
                            </div>
                          </>
                        ) : (
                          <span className="italic text-muted-foreground/60">No machine on file</span>
                        )
                      ) : (selectedOpt?.machine ?? '—')}
                    </td>

                    {/* Status badge */}
                    <td className="px-3 py-2.5">
                      {!selectedOpt?.process ? (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium bg-slate-700/30 text-slate-400 border border-slate-600/30">
                          Skipped
                        </span>
                      ) : isRec ? (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium bg-blue-600/20 text-blue-400 border border-blue-500/30">
                          Recommended
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium bg-violet-600/20 text-violet-400 border border-violet-500/30">
                          Custom
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}

        </div>

        {/* Footer */}
        <DialogFooter className="px-5 py-3 border-t shrink-0 flex-col items-stretch gap-2 sm:flex-col">
          <p className="text-[11px] text-muted-foreground text-right">
            Sets this as the manual route — nothing is written yet. Use the Cost Guide's Apply button to actually apply it, together with any Digital Factory/Batch Size change.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => { if (isSheetMetal) handleSetRouteDynamic(); else handleApplyFixed(); }}
              disabled={isSheetMetal && (!cuttingRouteId || !additionalSteps)}
            >
              Set Route
            </Button>
          </div>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}

// ── MaterialPickerDialog ───────────────────────────────────────────────────────

function MatPropRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 py-0.5">
      <span className="text-[10px] text-muted-foreground shrink-0 w-28">{label}</span>
      <span className="text-[10px] text-right font-medium leading-tight">{value ?? '—'}</span>
    </div>
  );
}

function MaterialPickerDialog({
  open, onClose, onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (grade: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [selected, setSelected] = useState<RawMaterial | null>(null);

  const { data, isLoading } = useRawMaterials(open ? { limit: 1000 } : undefined);
  const materials: RawMaterial[] = data?.items ?? [];

  // This dialog filters client-side (fetches all materials once above) rather
  // than calling the backend's search= param, so alias-aware matching (e.g.
  // "AL6101" -> Generic Aluminum, ANSI 6101) has to be checked here directly --
  // same normalization as raw-materials.service.ts's resolveAliasId().
  const { data: aliases } = useMaterialAliases();
  const normalize = (s: string) => s.toUpperCase().replace(/[\s-]/g, '');
  const aliasMatchId = search.trim()
    ? aliases?.find((a) => a.aliasNormalized === normalize(search))?.rawMaterialId
    : undefined;

  const groups = Array.from(new Set(materials.map((m) => m.materialGroup).filter(Boolean))).sort();

  const filtered = materials.filter((m) => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      m.material.toLowerCase().includes(q) ||
      (m.materialGrade ?? '').toLowerCase().includes(q) ||
      (m.materialGroup ?? '').toLowerCase().includes(q) ||
      (m.materialDescription ?? '').toLowerCase().includes(q) ||
      m.id === aliasMatchId;
    const matchGroup = !groupFilter || m.materialGroup === groupFilter;
    return matchSearch && matchGroup;
  });

  // The detail panel must never show a material that isn't in the current
  // filtered list -- without this, changing the search after already having
  // selected a row leaves the OLD selection's details on screen, looking like
  // it belongs to the new search results even though nothing there was clicked.
  useEffect(() => {
    if (selected && !filtered.some((m) => m.id === selected.id)) {
      setSelected(null);
    }
  }, [search, groupFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  function fmt(v: number | undefined | null, unit = '', dp = 0) {
    if (v == null) return null;
    return `${v.toFixed(dp)}${unit}`;
  }

  const sel = selected;
  const selDensityKgm3 = sel?.densityKgM3;
  const selDensityGcm3 = sel?.density;
  const densityDisplay = selDensityKgm3
    ? `${selDensityKgm3.toFixed(0)} kg/m³`
    : selDensityGcm3
    ? `${selDensityGcm3.toFixed(3)} g/cm³ (${(selDensityGcm3 * 1000).toFixed(0)} kg/m³)`
    : null;

  const standards = [
    sel?.astmStandard ? `ASTM: ${sel.astmStandard}` : null,
    sel?.dinStandard  ? `DIN: ${sel.dinStandard}`   : null,
    sel?.enStandard   ? `EN: ${sel.enStandard}`      : null,
    sel?.jisStandard  ? `JIS: ${sel.jisStandard}`   : null,
  ].filter(Boolean).join(' · ') || null;

  // Each column is a real, distinct raw_materials price in THAT country's own
  // native currency (cost_india is ₹, cost_china is ¥, ...) — never a single
  // shared currency. Labeling every row '$' regardless of which column it
  // came from silently mislabeled a ₹/¥/€ figure as dollars.
  const regionalCosts: { label: string; value: number | undefined; symbol: string }[] = [
    { label: 'India', value: sel?.costIndia, symbol: '₹' },
    { label: 'China', value: sel?.costChina, symbol: '¥' },
    { label: 'USA',   value: sel?.costUsa, symbol: '$' },
    { label: 'Germany', value: sel?.costGermany, symbol: '€' },
    { label: 'France',  value: sel?.costFrance, symbol: '€' },
    { label: 'W. Europe', value: sel?.costWEurope, symbol: '€' },
    { label: 'E. Europe', value: sel?.costEEurope, symbol: '€' },
    { label: 'Mexico', value: sel?.costMexico, symbol: 'MX$' },
  ];
  const hasAnyCost = regionalCosts.some((r) => r.value != null);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl p-0 overflow-hidden flex flex-col" style={{ maxHeight: '92vh' }}>

        {/* Header */}
        <DialogHeader className="px-5 pt-4 pb-3 border-b shrink-0">
          <DialogTitle>Material Database</DialogTitle>
          <p className="text-xs text-muted-foreground">Click a row to view all properties, then apply to this BOM item.</p>
        </DialogHeader>

        {/* Search + filter */}
        <div className="px-4 py-2 border-b shrink-0 flex items-center gap-2">
          <input
            type="text"
            placeholder="Search material, grade, group, description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            className="flex-1 text-xs border border-border rounded px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="text-xs border border-border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer w-40 shrink-0"
          >
            <option value="">All Groups</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <span className="text-[10px] text-muted-foreground shrink-0 w-16 text-right">
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Two-pane body */}
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* Left: list */}
          <div className="flex-1 overflow-auto border-r min-w-0">
            {isLoading ? (
              <div className="p-6 text-center text-xs text-muted-foreground">Loading materials…</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">No materials match your search.</div>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b bg-muted/60 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <th className="px-2.5 py-2 text-left w-28">Group</th>
                    <th className="px-2.5 py-2 text-left">Material</th>
                    <th className="px-2.5 py-2 text-left w-36">Grade</th>
                    <th className="px-2.5 py-2 text-right w-20">Density</th>
                    <th className="px-2.5 py-2 text-right w-16">UTS</th>
                    <th className="px-2.5 py-2 text-right w-16">YS</th>
                    <th className="px-2.5 py-2 text-right w-20">Cost India</th>
                    <th className="px-2.5 py-2 text-right w-16">Cost USA</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m) => {
                    const isActive = selected?.id === m.id;
                    const dens = m.densityKgM3 ?? (m.density ? m.density * 1000 : undefined);
                    return (
                      <tr
                        key={m.id}
                        onClick={() => setSelected(m)}
                        className={cn(
                          'border-b cursor-pointer transition-colors text-xs',
                          isActive
                            ? 'bg-violet-500/10 border-violet-500/20'
                            : 'hover:bg-muted/30',
                        )}
                      >
                        <td className="px-2.5 py-1.5 text-muted-foreground text-[10px]">{m.materialGroup ?? '—'}</td>
                        <td className="px-2.5 py-1.5 font-medium">{m.material}</td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">{m.materialGrade ?? '—'}</td>
                        <td className="px-2.5 py-1.5 text-right text-muted-foreground">
                          {dens ? `${dens.toFixed(0)}` : '—'}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-muted-foreground">
                          {m.ultimateTensileStrength != null ? m.ultimateTensileStrength : '—'}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-muted-foreground">
                          {m.yieldTensileStrength != null ? m.yieldTensileStrength : '—'}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-muted-foreground">
                          {m.costIndia != null ? `$${m.costIndia}` : '—'}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-muted-foreground">
                          {m.costUsa != null ? `$${m.costUsa}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Right: detail panel */}
          <div className="w-72 shrink-0 overflow-y-auto p-4 flex flex-col gap-3">
            {!sel ? (
              <div className="flex-1 flex items-center justify-center text-center">
                <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
                  Click a material row to view all properties
                </p>
              </div>
            ) : (
              <>
                {/* Identity */}
                <div>
                  <div className="text-sm font-semibold leading-tight">{sel.material}</div>
                  {sel.materialGrade && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">{sel.materialGrade}</div>
                  )}
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {sel.materialGroup && (
                      <span className="text-[9px] border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                        {sel.materialGroup}
                      </span>
                    )}
                    {sel.materialType && (
                      <span className="text-[9px] border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                        {sel.materialType}
                      </span>
                    )}
                    {sel.stockForm && (
                      <span className="text-[9px] border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                        {sel.stockForm}
                      </span>
                    )}
                    {sel.matlState && (
                      <span className="text-[9px] border border-border rounded px-1.5 py-0.5 text-muted-foreground">
                        {sel.matlState}
                      </span>
                    )}
                  </div>
                  {sel.materialDescription && (
                    <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{sel.materialDescription}</p>
                  )}
                </div>

                {/* Physical properties */}
                <div className="border-t pt-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Physical Properties</p>
                  <MatPropRow label="Density" value={densityDisplay} />
                  <MatPropRow label="UTS (MPa)" value={fmt(sel.ultimateTensileStrength)} />
                  <MatPropRow label="Yield Strength (MPa)" value={fmt(sel.yieldTensileStrength)} />
                  <MatPropRow label="Shear Strength (MPa)" value={fmt(sel.shearingStrength)} />
                  <MatPropRow label="Elongation (%)" value={fmt(sel.elongationPct)} />
                  <MatPropRow label="Elastic Modulus (GPa)" value={fmt(sel.elasticModulusGpa, '', 1)} />
                  <MatPropRow label="Poisson's Ratio" value={fmt(sel.poissonRatio, '', 2)} />
                  <MatPropRow label="Electrical Conductivity (%IACS)" value={fmt(sel.electricalConductivityIacsPct, '', 1)} />
                  <MatPropRow label="Thermal Conductivity (W/m-K)" value={fmt(sel.thermalConductivityWMk)} />
                </div>

                {/* Plastic-specific */}
                {(sel.meltingTempC != null || sel.moldTempC != null || sel.clampingPressureMpa != null) && (
                  <div className="border-t pt-3">
                    <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Process Properties</p>
                    <MatPropRow label="Melting Temp" value={fmt(sel.meltingTempC, ' °C')} />
                    <MatPropRow label="Mold Temp" value={fmt(sel.moldTempC, ' °C')} />
                    <MatPropRow label="Clamping Pressure" value={fmt(sel.clampingPressureMpa, ' MPa', 1)} />
                    <MatPropRow label="Ejection Deflect Temp" value={fmt(sel.ejectDeflectionTempC, ' °C')} />
                    <MatPropRow label="Specific Heat (melt)" value={fmt(sel.specificHeatMelt, '', 3)} />
                    <MatPropRow label="Thermal Conductivity" value={fmt(sel.thermalConductivityMelt, '', 3)} />
                    {sel.regrinding && <MatPropRow label="Regrinding" value={sel.regrinding} />}
                    {sel.regrindingPercentage != null && <MatPropRow label="Regrind %" value={`${sel.regrindingPercentage}%`} />}
                  </div>
                )}

                {/* Standards */}
                {standards && (
                  <div className="border-t pt-3">
                    <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Standards</p>
                    <p className="text-[10px] leading-relaxed text-muted-foreground">{standards}</p>
                  </div>
                )}

                {/* Regional costs */}
                <div className="border-t pt-3">
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Regional Cost (native currency/kg)</p>
                  {hasAnyCost ? (
                    regionalCosts.map((r) => r.value != null ? (
                      <div key={r.label} className="flex items-center justify-between py-0.5">
                        <span className="text-[10px] text-muted-foreground">{r.label}</span>
                        <span className="text-[10px] font-medium">{r.symbol}{r.value.toFixed(2)}/kg</span>
                      </div>
                    ) : null)
                  ) : (
                    <p className="text-[10px] text-muted-foreground/50">No cost data in database</p>
                  )}
                  {(sel.cost != null || sel.unitCost != null) && (
                    <div className="flex items-center justify-between py-0.5 border-t border-border/30 mt-1">
                      <span className="text-[10px] text-muted-foreground">Unit Cost</span>
                      <span className="text-[10px] font-medium">
                        {sel.currency ?? ''} {(sel.unitCost ?? sel.cost)!.toFixed(2)}/kg
                      </span>
                    </div>
                  )}
                </div>

                {/* Apply button */}
                <div className="border-t pt-3 mt-auto">
                  <Button
                    className="w-full"
                    onClick={() => { onSelect(materialLabel(sel.material, sel.materialGrade)); onClose(); }}
                  >
                    Apply Material
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t shrink-0">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── CostGuidePanel (Left) ──────────────────────────────────────────────────────

function CostGuidePanel({
  item, fg, summary, batchSize, productionLife, setProductionLife,
  processRouting, setProcessRouting, factory,
  factoryDraft, setFactoryDraft, batchSizeDraft, setBatchSizeDraft,
  applyScenario,
  onManualClick, selectedManualRoute, onSelectHighlight,
  dfmScores,
}: {
  item: BOMItem; fg: FeatureGraph | null; summary: FeatureGraphSummary | null;
  // Real per-occurrence DFM risk from dfm-scoring.service.ts (the single DFM
  // authority, see P0.3) — threaded through so ManufacturingFeaturesTab can
  // present the backend's own UNDERSIZED_HOLE/CRACK_RISK findings instead of
  // independently recomputing them. Undefined while the query hasn't resolved.
  dfmScores?: DFMScoresResponse | undefined;
  batchSize: number;
  productionLife: number; setProductionLife: (v: number) => void;
  processRouting: 'auto' | 'manual'; setProcessRouting: (v: 'auto' | 'manual') => void;
  factory: string;
  // Digital Factory + Batch Size drive live server recompute (useCostSummary/
  // useRouteComparison/useCostOverride etc. all key off the committed factory/
  // batchSize above) — staged as drafts (owned by the parent, not here, so the
  // Workflow Builder can also see scenarioDirty) so picking a new factory or
  // typing a new batch size doesn't refetch the whole scenario on every change.
  // Only committing both together via "Apply Scenario" updates factory/batchSize.
  factoryDraft: string; setFactoryDraft: (v: string) => void;
  batchSizeDraft: number; setBatchSizeDraft: (v: number) => void;
  applyScenario: () => Promise<void>;
  onManualClick: () => void;
  selectedManualRoute: ManualRouteOption | null;
  onSelectHighlight?: (node: FeatureNodeV2 | null) => void;
}) {
  const queryClient = useQueryClient();
  type LeftTab = 'scenario' | 'geo' | 'gdt' | 'features' | 'machine';
  const [tab, setTab] = useState<LeftTab>('scenario');
  const [leftAppliedRouteId, setLeftAppliedRouteId] = useState<string | null>(null);
  const applyRoute = useApplyRoute(item.id);
  const [productLine, setProductLine] = useState('');
  const [matPickerOpen, setMatPickerOpen] = useState(false);
  // Apply Scenario confirmation + progress — the apply-route/apply-custom-route
  // round trip re-runs the whole route-comparison engine server-side (observed
  // 12-60s live) with several more sequential steps after it (material grade
  // commit, cost-summary refetch, auto-add material/process, cache invalidation).
  // Previously this all fired instantly on click with no confirmation and no
  // feedback beyond a single toast at the very end, so a 30-60s wait looked
  // identical to the button doing nothing.
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [applyProgress, setApplyProgress] = useState<{ step: string; pct: number } | null>(null);
  const isApplying = applyProgress != null;
  // Draft for the Blank Thickness MANUAL OVERRIDE (bom_items.scenario_overrides.
  // sheetThicknessMm) — deliberately NOT the same field as the real CAD-
  // extracted thickness (item.featureGraph.summary.sheetThicknessMm) or the
  // bom_items.sheet_thickness_mm fallback column. Saving into either of
  // those would either be silently ignored by costing (CAD always wins over
  // the fallback column) or destroy the real CAD reference value — see
  // migration 420's own comment. Resynced whenever the item's saved
  // override changes (e.g. after this mutation succeeds, or after Discard).
  const [blankThickness, setBlankThickness] = useState(
    item.scenarioOverrides?.sheetThicknessMm != null ? String(item.scenarioOverrides.sheetThicknessMm) : '',
  );
  useEffect(() => {
    setBlankThickness(item.scenarioOverrides?.sheetThicknessMm != null ? String(item.scenarioOverrides.sheetThicknessMm) : '');
  }, [item.scenarioOverrides?.sheetThicknessMm]);
  // cadThicknessMm itself is declared further down (shared with the rest of
  // this component, already computed from the same featureGraph.summary).
  const effectiveThicknessMm =
    (item.scenarioOverrides?.sheetThicknessMm as number | undefined)
    ?? (item.featureGraph?.summary?.sheetThicknessMm || null)
    ?? item.sheetThicknessMm ?? 0;
  // Manual Override renders as static text by default — click it (or the
  // pencil icon) to reveal the editable input, matching an inline-edit
  // pattern instead of an always-open text box.
  const [isEditingBlankThickness, setIsEditingBlankThickness] = useState(false);
  const commitBlankThicknessOverride = () => {
    const trimmed = blankThickness.trim();
    if (trimmed === '') {
      if (item.scenarioOverrides?.sheetThicknessMm != null) {
        patchScenarioOverrides.mutate({ id: item.id, patch: { sheetThicknessMm: null } });
      }
      setIsEditingBlankThickness(false);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    if (parsed !== item.scenarioOverrides?.sheetThicknessMm) {
      patchScenarioOverrides.mutate({ id: item.id, patch: { sheetThicknessMm: parsed } });
    }
    setIsEditingBlankThickness(false);
  };
  const cancelBlankThicknessEdit = () => {
    setBlankThickness(item.scenarioOverrides?.sheetThicknessMm != null ? String(item.scenarioOverrides.sheetThicknessMm) : '');
    setIsEditingBlankThickness(false);
  };
  const [annualVolumeDraft, setAnnualVolumeDraft] = useState(item.annualVolume ?? 0);
  const commitAnnualVolume = () => {
    if (annualVolumeDraft !== (item.annualVolume ?? 0)) {
      updateBOMItem.mutate({ id: item.id, data: { annualVolume: annualVolumeDraft } });
    }
  };
  const [matInputValue, setMatInputValue] = useState(item.materialGrade ?? '');
  const [matDropOpen, setMatDropOpen] = useState(false);
  useEffect(() => { setMatInputValue(item.materialGrade ?? ''); }, [item.materialGrade]);
  // Search server-side (material / material_group / material_grade) instead of
  // a fixed 500-row client-side slice — a blind limit can miss "Aluminum"
  // entirely if it doesn't happen to sort within the first 500 rows fetched.
  const { data: allMatsData } = useRawMaterials(
    matInputValue.trim().length >= 1 ? { search: matInputValue.trim(), limit: 50 } : undefined,
  );
  const matDropItems = (allMatsData?.items ?? [])
    .filter((m) => {
      const q = matInputValue.toLowerCase();
      return q.length > 0 && (
        (m.materialGrade ?? '').toLowerCase().includes(q) ||
        m.material.toLowerCase().includes(q) ||
        (m.materialGroup ?? '').toLowerCase().includes(q)
      );
    })
    .slice(0, 18);

  // ── Auto-add raw material cost when material grade is applied ─────────────
  const createRawMatCost = useCreateRawMaterialCost();

  // ── Auto-add process costs when material grade is applied ──────────────────
  const createProcessCost = useCreateProcessCost();
  // React Query deduplicates by key — resolves from cache when CostSummaryTab already called it
  const { data: cgpCostSummary } = useCostSummary(item.id, batchSize, factory);

  // Synchronous guard — prevents duplicate records when SET is clicked rapidly
  // (React Query cache can be stale between two fast consecutive calls)
  const autoAddLock = useRef<Set<string>>(new Set());

  // `factory` is a prop, captured by value in whatever render created the
  // currently-executing async closure. runApplyScenario calls applyScenario()
  // (which does setFactory(factoryDraft) in the PARENT) and then, in the SAME
  // tick, calls autoAddMaterialCost/reapplyExistingOrDefaultRoute below —
  // long before the parent's re-render can flow the new `factory` prop back
  // down here. Reading bare `factory` at that point silently uses the
  // location the user just switched AWAY from. locationOverride lets
  // runApplyScenario pass factoryDraft (the value `factory` is actively
  // becoming) explicitly instead of waiting on a prop update that hasn't
  // happened yet — the same class of stale-closure hazard already handled
  // for applyManualMachineOverride/AnalysisTabsPanel via `scenarioDirty ?
  // factoryDraft : factory` at the ManufacturingIntelligencePage level.
  const fetchFreshCostSummary = async (loc: string) => {
    try {
      return await queryClient.fetchQuery<CostSummaryDto>({
        queryKey: ['bom-items', item.id, 'cost-summary', batchSize, loc],
        queryFn: () => apiClient.get<CostSummaryDto>(
          `/bom-items/${item.id}/cost-summary?batchSize=${batchSize}&location=${encodeURIComponent(loc)}`,
          { timeout: 180000 },
        ),
        staleTime: 1000 * 60 * 5,
      });
    } catch {
      return undefined;
    }
  };

  const autoAddProcessCosts = async (locationOverride?: string) => {
    if (autoAddLock.current.has('process')) return;
    autoAddLock.current.add('process');
    const loc = locationOverride ?? factory;
    try {
      // Fresh server check so stale React Query cache doesn't block re-creation
      // after a material-grade change (when the Apply button has already deactivated old records).
      try {
        const freshProcs = await apiClient.get<{ records: any[] }>('/process-costs', {
          params: { bomItemId: item.id, isActive: true, page: 1, limit: 5 },
        });
        if ((freshProcs?.records?.length ?? 0) > 0) return;
      } catch { /* pre-check failure — fall through */ }

      // Always read from the live query cache — the closure-captured cgpCostSummary
      // was fetched before material grade was set and has empty processLines.
      // When `loc` differs from the still-stale `factory` prop, the cache was
      // never populated under this key either — fetch it fresh so the machine/
      // labour selection below reflects the NEW location, not the old one.
      const liveSummary = queryClient.getQueryData<typeof cgpCostSummary>(
        ['bom-items', item.id, 'cost-summary', batchSize, loc],
      );
      const freshSummaryForProcess = liveSummary ?? (loc !== factory ? await fetchFreshCostSummary(loc) : cgpCostSummary);
      const lines = freshSummaryForProcess?.processLines ?? [];
      if (!lines.length) return;
      // line.hourlyRate/labourRate/machineSelection candidates are already
      // converted to the scenario's DISPLAY currency (see
      // normalizeCostSummaryToCurrency) — e.g. ₹ for an India/China factory
      // scenario priced in INR. process_cost_records.machineRate/laborRate
      // must always be USD; the create endpoint re-derives USD itself via
      // toUsdCreate(value, rowLocation), treating whatever number it's given
      // as ALREADY being in that row's location's OWN native currency (¥ for
      // China) — never the scenario's display currency. Sending a display
      // value straight through was silently mis-converted every time a route
      // got (re)applied (confirmed live: a real $21.26/hr China machine was
      // persisted as machineRate≈$301.7/hr — an ~14x inflation, the exact
      // CNY→INR reference rate — repeating on every Apply since this
      // function recreates every row from scratch). Dividing by toUsdRate
      // (the same native→display factor normalizeCostSummaryToCurrency
      // itself used) recovers the real native-currency figure the backend
      // expects, so it converts back to the correct USD value.
      // `?? 1` alone doesn't catch a literal 0 (nullish coalescing only
      // replaces null/undefined) — dividing by a real 0 would send Infinity
      // as machineRate/laborRate, which a NUMERIC DB column rejects outright,
      // silently failing the whole row's creation.
      const toUsdRateForProcess = freshSummaryForProcess?.toUsdRate || 1;
      const toNativeLocalForProcess = (displayValue: number) => displayValue / toUsdRateForProcess;
      for (const [i, line] of lines.entries()) {
        // process_cost_records.cycle_time is NUMERIC(12,2) — round to 2dp,
        // not to a whole integer (see the matching fix on the Calculator
        // button handlers above for why that silently loses real precision).
        const cycleTimeSec = Math.round(line.cycleTimeMin * 60 * 100) / 100;
        // Reverse-compute setup time from amortized setupCost — must divide by
        // the SAME combined machine+labor rate the backend used (eMithranTerms:
        // setupCost = (mhrMin + dlrMin*setupNDL) * setupTimeMin —
        // cost-engine.ts:365), not machine rate alone. See the identical fix
        // and its confirmed-live example on handleOpenEditProc above — this
        // path is worse: it PERSISTS the inflated minutes into a new
        // process_cost_records row via CreateProcessCostDto below, not just
        // displaying it.
        const combinedRateForSetup = line.hourlyRate + (line.labourRate ?? 0);
        const setupTimeMins = combinedRateForSetup > 0
          ? parseFloat(((line.setupCost * batchSize * 60) / combinedRateForSetup).toFixed(1))
          : 0;
        // Link the real recommended machine (same one the ⭐ picker already
        // shows) instead of leaving mhrId unset — otherwise every
        // auto-created row reads "Manual rate — not linked to a machine"
        // even though a specific real machine was already identified for it.
        const recommendedCandidate = line.machineSelection?.balanced?.candidate;
        const machineRateDisplay = recommendedCandidate?.hourlyRate ?? line.hourlyRate;
        const laborRateDisplay = line.labourRate ?? 0;
        const payload: CreateProcessCostDto = {
          bomItemId: item.id,
          opNbr: (i + 1) * 10,
          operation: line.operation || line.process,
          processGroup: line.processGroup || deriveProcessGroupFromMachineClass(line.machineClass),
          processRoute: line.processRoute || line.process,
          // ROOT CAUSE (confirmed live): without this, the backend's own
          // create() does getCurrencyForLocation(undefined ?? '') -> 'USD',
          // making toUsdCreate a no-op (rate * convertStrict('USD','USD') =
          // rate * 1) -- so the native-currency value below (correctly
          // recovered from the display-currency line via toNativeLocalForProcess)
          // was being stored VERBATIM and mislabeled currency='USD' instead of
          // actually being converted. Every "inflated rate" bug this session
          // traced back to this one missing field, not the conversion math.
          location: loc,
          machineRate: toNativeLocalForProcess(machineRateDisplay),
          laborRate: toNativeLocalForProcess(laborRateDisplay),
          directRate: toNativeLocalForProcess(machineRateDisplay),
          indirectRate: 0,
          fringeRate: 0,
          machineValue: 0,
          cycleTime: cycleTimeSec,
          setupTime: setupTimeMins,
          setupManning: 1,
          batchSize,
          heads: 1,
          partsPerCycle: 1,
          scrap: 0,
          shiftPatternHoursPerDay: 8,
          isActive: true,
        };
        if (recommendedCandidate?.machineId) payload.mhrId = recommendedCandidate.machineId;
        // Inspection (and any other class priced via a flat resource rate,
        // not the CNC/laser-style machineSelection candidate list) has no
        // machineSelection candidate, but DOES carry a real resolved
        // mhrId/benchmarkMhrId directly on the line (see finalizeInspectionLine
        // in inspection-engine.ts). Without this, every such auto-created row
        // persisted with no machine link at all, so it displayed "Manual rate
        // — not linked to a machine" forever, even though a real, priced
        // resource was used for its rate. machineName itself is never sent —
        // the backend always derives it server-side from mhrId/benchmarkMhrId.
        if (!payload.mhrId && (line as any).mhrId) payload.mhrId = (line as any).mhrId;
        if (!payload.mhrId && (line as any).benchmarkMhrId) payload.benchmarkMhrId = (line as any).benchmarkMhrId;
        try {
          await createProcessCost.mutateAsync(payload);
        } catch (err) {
          // Individual line failure is non-fatal to the rest of the loop, but
          // silently swallowing it left "· not saved" with no way to tell WHY
          // (bad payload value, validation error, etc.) — log it so the real
          // cause is visible instead of having to guess blind.
          console.error(`[autoAddProcessCosts] failed to create "${payload.operation}":`, err, payload);
        }
      }
    } finally {
      autoAddLock.current.delete('process');
    }
  };

  const autoAddMaterialCost = async (grade: string, locationOverride?: string) => {
    if (autoAddLock.current.has('material')) return;
    autoAddLock.current.add('material');
    const loc = locationOverride ?? factory;

    try {
      // Live nesting-derived weights -- fetched BEFORE the existing-record
      // guard below, so that guard can detect when a persisted record has
      // gone stale relative to the CURRENT nesting/costing result, not just
      // when material grade changed. Confirmed live: a record created
      // before this true-shape costing fix landed kept reporting its OLD
      // netUsage/scrap% forever (grossUsage happened to already be correct,
      // so comparing gross alone would NOT have caught this -- netUsage is
      // the field that actually goes stale here).
      const liveSummaryForStaleness = queryClient.getQueryData<typeof cgpCostSummary>(
        ['bom-items', item.id, 'cost-summary', batchSize, loc],
      );
      const freshSummaryForStaleness = liveSummaryForStaleness ?? (loc !== factory ? await fetchFreshCostSummary(loc) : cgpCostSummary);
      const rawLiveGrossKgForStaleness = freshSummaryForStaleness?.grossWeightKg ?? 0;
      const liveGrossKgForStaleness = rawLiveGrossKgForStaleness > 0 ? rawLiveGrossKgForStaleness : null;
      const rawLiveNetKgForStaleness = freshSummaryForStaleness?.blankSpec?.netWeightKg ?? 0;
      const liveNetKgForStaleness = rawLiveNetKgForStaleness > 0 ? rawLiveNetKgForStaleness : null;

      // Fresh server check — stale React Query cache after a deletion would incorrectly
      // block creation if we relied on `existingRawCosts` (stale until background refetch).
      // Only bail out if there's a record with a meaningful cost (totalCost > 0).
      // Zero-cost records from before the weight fix must be ignored so the correct
      // record can be created (the zero records are cleaned up server-side by the replace).
      let fresh: { records: any[] } | undefined;
      try {
        fresh = await apiClient.get<{ records: any[] }>('/raw-material-costs', {
          params: { bomItemId: item.id, isActive: true, page: 1, limit: 10 },
        });
      } catch (e) {
        // raw-material-costs.service.ts's create() has no server-side "deactivate
        // existing active rows for this bom item first" step — it always inserts a
        // fresh active row. Proceeding here on a failed pre-check (as this used to,
        // trusting the server to "enforce uniqueness" — it doesn't) would create a
        // second active material cost row alongside whatever is already active,
        // doubling Direct Material Costs. Abort instead.
        console.error('[autoAddMaterialCost] failed to read existing raw material costs:', e);
        toast.error('Could not verify the current material cost record — Apply was aborted to avoid a duplicate. Please retry.');
        return;
      }
      {
        const records = fresh?.records ?? [];
        const existingForGrade = records.find((r: any) => (r.totalCost ?? 0) > 0 && r.materialName === grade);
        // A record for this grade is only "still valid" if its stored
        // net/gross usage still agree with the CURRENT live nesting result
        // -- not merely because the grade hasn't changed. A >1% relative
        // disagreement on EITHER means the underlying nesting/costing
        // result has moved on since this record was created (a geometry
        // re-analysis, a sheet-size change, or a costing-formula fix like
        // this one), and the record must be rebuilt, never left frozen.
        const relDiff = (stored: number, live: number) => (live > 0 ? Math.abs(stored - live) / live : 0);
        const staleAgainstLiveNesting = !!existingForGrade && (
          (liveGrossKgForStaleness !== null && relDiff(Number(existingForGrade.grossUsage ?? 0), liveGrossKgForStaleness) > 0.01) ||
          (liveNetKgForStaleness !== null && relDiff(Number(existingForGrade.netUsage ?? 0), liveNetKgForStaleness) > 0.01)
        );
        // Geometry (gross/net usage) doesn't change when only the Digital
        // Factory location changes -- the price PER KG does. Without this,
        // switching factory and clicking Apply left the material's unit_cost
        // frozen at whatever location it was originally priced for forever,
        // since the geometry-only staleness check above always still agreed.
        const staleAgainstLocation = !!existingForGrade && (existingForGrade.country ?? '') !== loc;
        const hasValidRecordForThisGrade = !!existingForGrade && !staleAgainstLiveNesting && !staleAgainstLocation;
        if (hasValidRecordForThisGrade) return;
        // Mark ALL active records inactive — the grade changed, the record
        // is stale against the live nesting result or the Digital Factory
        // location, or it had $0 cost. This replaces stale material records
        // cleanly without leaving ghost entries.
        const staleIds = records.map((r: any) => r.id as string).filter(Boolean);
        const failedIds: string[] = [];
        for (const id of staleIds) {
          try {
            await apiClient.put(`/raw-material-costs/${id}`, { isActive: false });
          } catch (e) {
            failedIds.push(id);
            console.error(`[autoAddMaterialCost] failed to deactivate raw material cost ${id}:`, e);
          }
        }
        if (failedIds.length > 0) {
          // create() below always inserts a new active row with no server-side
          // dedup — proceeding while a stale row is still active produces two
          // active material cost records for this bom item.
          toast.error(`Could not clear ${failedIds.length} existing material cost row(s) — Apply was aborted to avoid a duplicate. Please retry.`);
          return;
        }
      }
      // Look up material — exact match first, then tokenized fallback for compound
      // grade strings like "IS2062 E250 CRCA" that span multiple DB rows
      // ("Mild Steel IS2062" + "CRCA Steel"). At least 2 tokens must match.
      const gradeTokens = grade.split(/[\s\-\/]+/).filter((t: string) => t.length >= 3);
      const tokenScore = (val: string | null | undefined) => {
        if (!val) return 0;
        const u = val.toUpperCase();
        return gradeTokens.filter((t: string) => u.includes(t.toUpperCase())).length;
      };
      const exactMatchMat = (m: RawMaterial) =>
        materialLabel(m.material, m.materialGrade) === grade ||
        m.materialGrade === grade ||
        m.material === grade;
      const tokenMatchMat = (m: RawMaterial) =>
        tokenScore(m.materialGrade) + tokenScore(m.material) >= Math.max(1, Math.floor(gradeTokens.length / 2));

      const bestToken = (items: RawMaterial[] | undefined) => {
        if (!items || gradeTokens.length <= 1) return undefined;
        return [...items]
          .sort((a, b) =>
            (tokenScore(b.materialGrade) + tokenScore(b.material)) -
            (tokenScore(a.materialGrade) + tokenScore(a.material))
          )
          .find(tokenMatchMat);
      };

      // 1. Try the search-filtered cache (exact search match, fastest path)
      // 2. Fall back to the broad validation cache (already in memory, avoids
      //    PostgREST special-character issues in the search endpoint).
      // 3. Last resort: direct API call (works after the PostgREST escaping fix is deployed)
      let mat: RawMaterial | undefined =
        allMatsData?.items?.find(exactMatchMat) ??
        bestToken(allMatsData?.items) ??
        dbMaterialsForValidation?.items?.find(exactMatchMat) ??
        bestToken(dbMaterialsForValidation?.items);

      if (!mat) {
        try {
          const resp = await apiClient.get<{ items: RawMaterial[] }>('/raw-materials', { params: { search: grade, limit: 10 } });
          mat = resp?.items?.find(exactMatchMat) ?? bestToken(resp?.items);
        } catch { /* lookup failure is non-fatal */ }
      }

      const density = mat?.densityKgM3 ?? null;

      // Weight chain — order depends on part family:
      //
      // item.volume and item.weight are BOTH snapshots captured once at CAD
      // upload time from the drawing's own detected thickness. Neither is
      // recomputed when Blank Thickness's Manual Override changes — so for a
      // sheet metal part with an active thickness override, both are stale
      // by construction (e.g. baked in at CAD's 1.5mm while the effective/
      // costed thickness is 2mm), regardless of whether the material's real
      // density is known. Confirmed live: a 2mm SS304 part with a 3,245 mm²
      // flat pattern (expected ~0.05-0.06 kg) came out as 0.0138 kg — right
      // in line with item.weight's 1.5mm-CAD-thickness snapshot, not the 2mm
      // override.
      //
      // The engine's own grossWeightKg is the only source that's always
      // live-recomputed from flatPatternAreaMm2 × the EFFECTIVE (override-
      // aware) thickness (see resolveEffectiveSheetThicknessMm in
      // getCostSummary) — so for sheet metal it is the authoritative weight,
      // even when the real material's density isn't in raw_materials yet
      // (that gap only affects price/density, not geometry, and is already
      // surfaced by its own warning banner).
      //
      // For non-sheet-metal (machined/solid) parts there's no flat-pattern
      // concept or thickness override to go stale against, so item.volume ×
      // a real DB density remains the most accurate source there.
      //
      // Read from live query cache — closure-captured cgpCostSummary is stale (ran before
      // material grade was set), so grossWeightKg there is 0. After Apply triggers a refetch,
      // the cache holds the correct value even though the closure variable hasn't updated.
      const liveSummary = queryClient.getQueryData<typeof cgpCostSummary>(
        ['bom-items', item.id, 'cost-summary', batchSize, loc],
      );
      const freshSummary = liveSummary ?? (loc !== factory ? await fetchFreshCostSummary(loc) : cgpCostSummary);
      const rawEngineGrossKg = freshSummary?.grossWeightKg ?? 0;
      const engineGrossKg = rawEngineGrossKg > 0 ? rawEngineGrossKg : null;
      // Real per-part net weight straight from the nesting engine
      // (computeNesting's mass-based formula, or the true-shape override --
      // see bom-items.service.ts's blankSpec construction) -- NEVER derived
      // from an assumed scrap% here. Confirmed live: deriving net weight as
      // grossUsage*(1-10%) instead of reading this real value silently
      // discarded the part's actual CAD net weight, and a real ~40% scrap
      // (59.7% utilization on an irregular frame part) got recorded to
      // Direct Material Costs as a fake, frozen 10%.
      const rawEngineNetKg = freshSummary?.blankSpec?.netWeightKg ?? 0;
      const engineNetKg = rawEngineNetKg > 0 ? rawEngineNetKg : null;
      const cadWeight = typeof item.weight === 'number' && item.weight > 0 ? item.weight : null;
      const isSheetMetalPart = fg?.classification?.family === 'sheet_metal' || (summary?.sheetThicknessMm ?? 0) > 0;
      // Only a genuine fallback -- used when the nesting engine hasn't
      // resolved a real net weight for this part yet (cost summary still
      // loading, or a non-sheet-metal part with no nesting concept at all).
      // Never silently substituted when the real net weight IS available,
      // which was the bug this whole block exists to fix.
      const FALLBACK_SCRAP_PCT = 10;
      let netUsage: number;
      let grossUsage: number;
      let scrap: number;
      if (isSheetMetalPart && engineGrossKg !== null && engineNetKg !== null) {
        grossUsage = parseFloat(engineGrossKg.toFixed(6));
        netUsage   = parseFloat(engineNetKg.toFixed(6));
        // Real scrap %, derived from the nesting engine's own gross/net
        // weights -- never assumed. For an irregular part with real
        // internal cutouts this can legitimately be far higher than 10%.
        scrap = grossUsage > 0 ? parseFloat((((grossUsage - netUsage) / grossUsage) * 100).toFixed(2)) : 0;
      } else if (item.volume && density) {
        netUsage  = parseFloat(((item.volume * density) / 1e9).toFixed(6));
        grossUsage = parseFloat((netUsage / (1 - FALLBACK_SCRAP_PCT / 100)).toFixed(6));
        scrap = FALLBACK_SCRAP_PCT;
      } else if (cadWeight != null) {
        netUsage  = parseFloat(cadWeight.toFixed(6));
        grossUsage = parseFloat((netUsage / (1 - FALLBACK_SCRAP_PCT / 100)).toFixed(6));
        scrap = FALLBACK_SCRAP_PCT;
      } else if (engineGrossKg != null) {
        grossUsage = parseFloat(engineGrossKg.toFixed(6));
        netUsage   = parseFloat((grossUsage * (1 - FALLBACK_SCRAP_PCT / 100)).toFixed(6));
        scrap = FALLBACK_SCRAP_PCT;
      } else {
        netUsage = 0;
        grossUsage = 0;
        scrap = 0;
      }

      // Location-based pricing. localCurr always matches the CURRENT factory's
      // own native currency (parsed from the same `factory` string as the
      // regional column pick below), so freshSummary's own live rates convert
      // it correctly — never a hardcoded per-currency table that drifts out
      // of date against the real exchange_rates data (the exact bug already
      // fixed in RawMaterialDialog.tsx/useExchangeRates.ts this session).
      // toUsdRate = native->display, usdToDisplayRate = USD->display, so
      // toUsdRate/usdToDisplayRate = native->USD.
      let unitCost = 0;
      if (mat) {
        const locLower = (loc || '').toLowerCase();
        let localAmt = 0;
        if      (locLower.includes('india'))       { localAmt = mat.costIndia   ?? 0; }
        else if (locLower.includes('usa'))         { localAmt = mat.costUsa     ?? 0; }
        else if (locLower.includes('china'))       { localAmt = mat.costChina   ?? 0; }
        else if (locLower.includes('germany'))     { localAmt = mat.costGermany ?? 0; }
        else if (locLower.includes('france'))      { localAmt = mat.costFrance  ?? 0; }
        else if (locLower.includes('w. europe') || locLower.includes('western europe')) { localAmt = mat.costWEurope ?? 0; }
        else if (locLower.includes('e. europe') || locLower.includes('eastern europe')) { localAmt = mat.costEEurope ?? 0; }
        else if (locLower.includes('mexico'))      { localAmt = mat.costMexico  ?? 0; }
        if (!localAmt) localAmt = Number(mat.cost ?? mat.unitCost ?? 0);
        const nativeToUsd = (freshSummary?.toUsdRate ?? 1) / (freshSummary?.usdToDisplayRate ?? 1);
        unitCost = localAmt * nativeToUsd;
      }

      // Fallback: DB has no pricing — use the engine's materialCostPerKg, which
      // is already in the DISPLAY currency (cost.currency), converted back to
      // USD for storage (raw_material_cost_records.unit_cost is always USD).
      // Dividing by usdToDisplayRate (USD→display), NOT multiplying by
      // toUsdRate (which converts a DIFFERENT thing — the factory's own
      // native-currency figures — see cost-breakdown.dto.ts's doc comment).
      if (!unitCost) {
        const usdToDisplay = freshSummary?.usdToDisplayRate ?? 1;
        unitCost = (freshSummary?.materialCostPerKg ?? 0) / usdToDisplay;
      }

      await createRawMatCost.mutateAsync({
        bomItemId: item.id,
        ...(mat?.id ? { materialId: mat.id } : {}),
        materialName: grade,
        materialGroup: mat?.materialGroup,
        materialType: mat?.materialType,
        materialDescription: mat?.materialDescription,
        country: loc,
        netUsage,
        grossUsage,
        scrap,
        overhead: 5,
        reclaimRate: 0,
        unitCost,
        isActive: true,
      } as any);
    } catch (e) {
      console.error('[autoAddMaterialCost] failed:', e);
    } finally {
      autoAddLock.current.delete('material');
    }
  };

  // Re-applies whatever manufacturing route is currently in effect — a
  // staged Workflow Builder pick, or an already-persisted route re-applied
  // with fresh material/batch/location — instead of blindly recreating the
  // engine's own default route. Every place that changes material grade
  // (Enter, dropdown pick, the mini "Apply" badge, drawing-suggested
  // "Apply") used to call autoAddProcessCosts() directly, which silently
  // discarded an explicitly-chosen alternate route (e.g. Turret Punching)
  // and replaced it with the engine default (Laser Cut + Bend Brake +
  // Deburr) every single time — confirmed live via process_cost_records
  // showing notes=null (never auto_fill_from_route/auto_fill_from_custom_
  // route) across an entire test session despite a manual route being
  // staged throughout.
  // No manual route staged this session — re-apply whatever route is
  // already persisted (so a material-grade-only change doesn't silently
  // revert an earlier explicit pick), else fall back to the engine's own
  // default route. Shared by reapplyEffectiveRoute below and the bottom
  // "Apply" button's own material-grade branch (which has already called
  // applyScenario() itself when a route WAS staged, so it skips this).
  const reapplyExistingOrDefaultRoute = async (locationOverride?: string) => {
    // Guards the WHOLE deactivate-then-recreate sequence, not just the create
    // step inside autoAddProcessCosts — without this, two overlapping calls
    // (a real double-click, or a scenario Apply landing while a material-grade
    // quick-apply from the sidebar is still in flight) could each fetch the
    // same still-active rows, each deactivate them, then each independently
    // recreate a full set — producing two active rows per operation with no
    // error, since neither call ever saw the other's writes.
    if (autoAddLock.current.has('route')) return;
    autoAddLock.current.add('route');
    const loc = locationOverride ?? factory;
    try {
      let existingRouteId: string | null = null;
      let freshProcs: { records: any[] } | undefined;
      try {
        freshProcs = await apiClient.get<{ records: any[] }>('/process-costs', {
          params: { bomItemId: item.id, isActive: true, page: 1, limit: 50 },
        });
        for (const r of (freshProcs?.records ?? [])) {
          const m = /^auto_fill_from_route:(.+)$/.exec(r?.notes ?? '');
          if (m) { existingRouteId = m[1] ?? null; break; }
        }
      } catch (e) {
        // Can't tell whether a route is already applied — do NOT fall through
        // to the "no route" default-create path below, which would add a
        // second full set of rows on top of whatever is already active.
        console.error('[reapplyExistingOrDefaultRoute] failed to read existing process costs:', e);
        toast.error('Could not verify the current process routing — Apply was aborted to avoid creating duplicate rows. Please retry.');
        return;
      }

      if (existingRouteId) {
        // applyRoute's backend endpoint deletes ALL active rows and inserts the
        // new set in one request (writeProcessLinesAsRecords) — atomic from the
        // client's point of view, no separate deactivation step needed here.
        try {
          await applyRoute.mutateAsync({ routeId: existingRouteId, batchSize, location: loc });
        } catch { /* errors surfaced by the mutation's own onError toast */ }
      } else {
        // No backend bulk-replace exists for the ad-hoc "engine default route"
        // path, so deactivation happens client-side, one row at a time. A
        // failed deactivation here must NOT be swallowed — proceeding to
        // autoAddProcessCosts afterward would leave that row active while a
        // freshly recreated duplicate of the same operation also becomes
        // active, which is exactly the "duplicate rows after Apply" defect.
        const staleRows = (freshProcs?.records ?? []).filter((r) => !!r?.id);
        const failedIds: string[] = [];
        for (const r of staleRows) {
          try {
            await apiClient.put(`/process-costs/${r.id}`, { isActive: false });
          } catch (e) {
            failedIds.push(r.id);
            console.error(`[reapplyExistingOrDefaultRoute] failed to deactivate process cost ${r.id}:`, e);
          }
        }
        queryClient.invalidateQueries({ queryKey: ['process-costs'], exact: false });
        if (failedIds.length > 0) {
          toast.error(`Could not clear ${failedIds.length} existing process cost row(s) — Apply was aborted to avoid duplicates. Please retry.`);
          return;
        }
        await autoAddProcessCosts(loc);
      }
    } finally {
      autoAddLock.current.delete('route');
    }
  };
  const reapplyEffectiveRoute = async () => {
    if (processRouting === 'manual' && selectedManualRoute) {
      await applyScenario();
      return;
    }
    await reapplyExistingOrDefaultRoute();
  };

  // ── Currency & Ask Price — real FX architecture ────────────────────────────
  // Factory currency is resolved server-side from LOCATION_INFO (the same
  // table real costing uses) via factoryDraft, never inferred/hardcoded here.
  const { data: factoryCurrencyInfo } = useFactoryCurrency(factoryDraft);
  // Digital Factory locations + scenario currencies both come from the
  // backend's LOCATION_INFO (via GET /api/fx/factories and /api/fx/
  // currencies) — never a hardcoded option list here, so a new location or
  // currency added on the backend shows up automatically.
  const { data: factories } = useFactories();
  const { data: currencies } = useCurrencies();
  const scenarioCurrencySymbols = useMemo(
    () => Object.fromEntries((currencies ?? []).map((c) => [c.code, c.symbol])),
    [currencies],
  );
  const savedScenarioCurrency = typeof item.scenarioOverrides?.scenarioCurrency === 'string'
    ? item.scenarioOverrides.scenarioCurrency as string : null;
  const savedFxSnapshot = item.scenarioOverrides?.fxSnapshot as {
    factoryCurrency: string; scenarioCurrency: string; provider: string | null; source: string | null;
    rate: number; rateDate: string | null; rateType: FxRateType; retrievedAt: string; customReason?: string;
  } | undefined;
  const savedAskPrice = item.scenarioOverrides?.askPrice as { amount: number; currency: string } | undefined;

  const [scenarioCurrencyDraft, setScenarioCurrencyDraft] = useState(savedScenarioCurrency ?? 'USD');
  const [rateTypeDraft, setRateTypeDraft] = useState<FxRateType>(savedFxSnapshot?.rateType ?? 'reference');
  const [customRateDraft, setCustomRateDraft] = useState(savedFxSnapshot?.rateType === 'custom' ? String(savedFxSnapshot.rate) : '');
  const [customReasonDraft, setCustomReasonDraft] = useState(savedFxSnapshot?.customReason ?? '');
  const [askPriceDraft, setAskPriceDraft] = useState(savedAskPrice ? String(savedAskPrice.amount) : '');
  // Ask Price is entered directly in the scenario currency — changing that
  // currency must never silently reinterpret an already-entered number as a
  // different currency. This banner is the explicit prompt: convert now at
  // today's rate, or clear and re-enter.
  const [askPriceConvertBanner, setAskPriceConvertBanner] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    setScenarioCurrencyDraft(savedScenarioCurrency ?? 'USD');
    setRateTypeDraft(savedFxSnapshot?.rateType ?? 'reference');
    setCustomRateDraft(savedFxSnapshot?.rateType === 'custom' ? String(savedFxSnapshot.rate) : '');
    setCustomReasonDraft(savedFxSnapshot?.customReason ?? '');
    setAskPriceDraft(savedAskPrice ? String(savedAskPrice.amount) : '');
    setAskPriceConvertBanner(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedScenarioCurrency, savedFxSnapshot?.rate, savedFxSnapshot?.rateType, savedFxSnapshot?.customReason, savedAskPrice?.amount, savedAskPrice?.currency]);

  const isIdentityCurrency = !!factoryCurrencyInfo && factoryCurrencyInfo.code === scenarioCurrencyDraft;
  const { data: liveFxRate, isFetching: isFxRateLoading, error: fxRateError } = useFxRate({
    base: factoryCurrencyInfo?.code,
    quote: scenarioCurrencyDraft,
    rateType: rateTypeDraft,
    enabled: rateTypeDraft !== 'custom' && !isIdentityCurrency,
  });
  // Always-on informational rate (1 USD → factory currency) — shown
  // regardless of the scenario currency choice, including the identity case
  // (factory currency === scenario currency) where the conversion rate above
  // is trivially 1 and carries no source/date info. This is purely
  // disclosure — it never feeds into any cost calculation. Tracks the
  // CURRENTLY SELECTED rate type (Reference or Budget) rather than always
  // querying Reference — otherwise switching to Budget would still show the
  // identical Frankfurter number, silently ignoring the Rate Type selector.
  // Custom has no USD-pivot meaning (it's a direct user-entered local→
  // scenario rate), so this falls back to Reference for that case only.
  const usdReferenceRateType = rateTypeDraft === 'custom' ? 'reference' : rateTypeDraft;
  const usdReferenceEnabled = !!factoryCurrencyInfo && factoryCurrencyInfo.code !== 'USD';
  const { data: usdReferenceRate } = useFxRate({
    base: 'USD',
    quote: factoryCurrencyInfo?.code,
    rateType: usdReferenceRateType,
    enabled: usdReferenceEnabled,
  });
  const customRateNum = parseFloat(customRateDraft);
  const resolvedFxRate: { rate: number; source: string | null; provider: string | null; rateDate: string | null; stale: boolean } | null =
    isIdentityCurrency
      ? { rate: 1, source: 'identity', provider: null, rateDate: null, stale: false }
      : rateTypeDraft === 'custom'
        ? (Number.isFinite(customRateNum) && customRateNum > 0 && customReasonDraft.trim()
            ? { rate: customRateNum, source: `user-entered — ${customReasonDraft.trim()}`, provider: null, rateDate: null, stale: false }
            : null)
        : (liveFxRate ?? null);
  const refreshFxRate = useRefreshFxRate();
  const fxRateOnDemand = useFxRateOnDemand();
  const handleScenarioCurrencyChange = (next: string) => {
    if (askPriceDraft.trim() && next !== scenarioCurrencyDraft) {
      setAskPriceConvertBanner({ from: scenarioCurrencyDraft, to: next });
    }
    setScenarioCurrencyDraft(next);
  };
  const convertAskPriceNow = async () => {
    if (!askPriceConvertBanner) return;
    const { from, to } = askPriceConvertBanner;
    try {
      const result = await fxRateOnDemand.mutateAsync({ base: from, quote: to });
      const amount = parseFloat(askPriceDraft);
      if (Number.isFinite(amount)) setAskPriceDraft((amount * result.rate).toFixed(2));
    } catch {
      toast.error('Could not fetch a conversion rate for Ask Price — clear and re-enter it instead.');
    } finally {
      setAskPriceConvertBanner(null);
    }
  };
  const { data: materialCandidates } = useMaterialIntelligence(item.id);
  const updateBOMItem = useUpdateBOMItem();
  const patchScenarioOverrides = usePatchScenarioOverrides();

  // Fetch a broad slice of DB materials to validate AI candidates against.
  // Candidates not present in the DB (e.g. ABS on a sheet-metal part) are hidden.
  const { data: dbMaterialsForValidation } = useRawMaterials(
    (materialCandidates?.length ?? 0) > 0 ? { limit: 500 } : undefined,
  );
  const UNSPECIFIED_MATERIALS = new Set(['Unknown', 'Not specified', 'Not Specified', 'None', '']);
  const drawingMaterial = item.drawingIntelligence?.material;
  const hasDrawingMaterial = !!drawingMaterial && !UNSPECIFIED_MATERIALS.has(drawingMaterial.trim());
  const cadThicknessMm = summary?.sheetThicknessMm ?? 0;

  // The actual apply logic — previously ran straight from the button's onClick
  // with no confirmation and no visible progress. Now triggered only after the
  // user confirms via the AlertDialog below, with applyProgress driving a
  // step-by-step indicator instead of a single silent 12-60s wait.
  const runApplyScenario = async () => {
    setApplyProgress({ step: 'Applying manufacturing route…', pct: 10 });
    try {
      try {
        const routeStagedThisSession = processRouting === 'manual' && !!selectedManualRoute;
        await applyScenario();

        // Persist Currency & Ask Price alongside factory/batch size — same
        // scenario_overrides bag, one atomic merge (merge_scenario_overrides).
        // Only written when a real rate resolved (identity, live reference/
        // budget, or a complete custom rate+reason) — never a fabricated
        // number under the applied scenario's identity.
        if (resolvedFxRate) {
          const fxSnapshot = {
            factoryCurrency: factoryCurrencyInfo?.code ?? '',
            scenarioCurrency: scenarioCurrencyDraft,
            provider: resolvedFxRate.provider,
            source: resolvedFxRate.source,
            rate: resolvedFxRate.rate,
            rateDate: resolvedFxRate.rateDate,
            rateType: rateTypeDraft,
            retrievedAt: new Date().toISOString(),
            ...(rateTypeDraft === 'custom' ? { customReason: customReasonDraft.trim() } : {}),
          };
          // If the user changed Scenario Currency and hasn't yet resolved the
          // ask-price-convert prompt (convert vs. clear), do NOT write Ask
          // Price at all — silently stamping the old, unconverted number with
          // the new currency would misrepresent it. The previously saved
          // Ask Price (if any) is simply left untouched.
          if (askPriceConvertBanner) {
            toast.warning('Ask Price left unchanged — resolve the currency-change prompt (Convert or Clear) before it is saved under the new currency.');
          }
          const trimmedAskPrice = askPriceDraft.trim();
          const askPriceNum = parseFloat(trimmedAskPrice);
          const askPricePatch: { amount: number; currency: string } | null | undefined =
            askPriceConvertBanner
              ? undefined // unresolved convert/clear prompt — leave the existing saved value untouched
              : trimmedAskPrice === ''
                ? null // explicit clear
                : Number.isFinite(askPriceNum)
                  ? { amount: askPriceNum, currency: scenarioCurrencyDraft }
                  : undefined; // invalid/mid-typing — leave the existing saved value untouched
          patchScenarioOverrides.mutate({
            id: item.id,
            patch: {
              scenarioCurrency: scenarioCurrencyDraft, fxSnapshot,
              ...(askPricePatch !== undefined ? { askPrice: askPricePatch } : {}),
            },
          });
        }
        setApplyProgress({ step: 'Saving material grade…', pct: 40 });

        const pendingGrade = matInputValue.trim();
        if (pendingGrade && pendingGrade !== item.materialGrade) {
          try {
            await updateBOMItem.mutateAsync({ id: item.id, data: { materialGrade: pendingGrade } });
          } catch { /* non-fatal — proceed with whatever is on the server */ }
        }

        setApplyProgress({ step: 'Recalculating cost summary…', pct: 60 });
        await queryClient.refetchQueries({
          queryKey: ['bom-items', item.id, 'cost-summary'],
          exact: false,
        });

        const currentGrade = pendingGrade || item.materialGrade;
        if (currentGrade) {
          setApplyProgress({ step: 'Updating material cost…', pct: 80 });
          // Pass factoryDraft explicitly rather than relying on the `factory`
          // prop: applyScenario() above just called setFactory(factoryDraft)
          // in the parent, but that state update hasn't flowed back down as
          // a new `factory` prop yet — this closure is still running against
          // the render that started it. Without this, switching Digital
          // Factory and clicking Apply silently re-priced material/machine/
          // labour against the OLD location every time.
          await autoAddMaterialCost(currentGrade, factoryDraft);

          if (!routeStagedThisSession) {
            setApplyProgress({ step: 'Re-applying process route…', pct: 90 });
            await reapplyExistingOrDefaultRoute(factoryDraft);
          }
        }

        setApplyProgress({ step: 'Finishing up…', pct: 95 });
        queryClient.invalidateQueries({ queryKey: ['bom-items', item.id, 'cost-summary'] });
        queryClient.invalidateQueries({ queryKey: ['bom-items', item.id, 'route-comparison'] });
      } catch { /* outer safety net — never block the toast */ }

      const appliedParts: string[] = [
        processRouting === 'manual' && selectedManualRoute ? selectedManualRoute.label : 'Auto-recommended route',
      ];
      const gradeForToast = matInputValue.trim() || item.materialGrade;
      if (gradeForToast) appliedParts.push(`Material: ${gradeForToast}`);
      appliedParts.push(`Batch: ${batchSizeDraft.toLocaleString()}`);
      appliedParts.push(`Location: ${factoryDraft}`);
      toast.success('Scenario applied', { description: appliedParts.join(' · ') });
    } finally {
      setApplyProgress(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex flex-wrap border-b shrink-0 bg-muted/20">
        {([['scenario', 'Scenario'], ['geo', 'Drawing'], ['gdt', 'GD&T'], ['features', 'Features'], ['machine', 'Process']] as [LeftTab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-2.5 py-1.5 text-[11px] font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === key ? 'border-violet-500 text-violet-600 dark:text-violet-400 bg-background' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
            }`}>{label}</button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'scenario' && (
          <>
            <Section title="Digital Factory">
              <select
                value={factoryDraft}
                onChange={(e) => setFactoryDraft(e.target.value)}
                className="w-full text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                {!factories && <option value={factoryDraft}>{factoryDraft}</option>}
                {(factories ?? []).map((f) => (
                  <option key={f.location} value={f.location}>{f.location}</option>
                ))}
              </select>
              {factoryCurrencyInfo && (
                <p className="text-[10px] text-muted-foreground/60 leading-tight mt-1">
                  Native factory currency: <span className="font-medium text-foreground">{factoryCurrencyInfo.code}</span> ({factoryCurrencyInfo.symbol})
                </p>
              )}
            </Section>

            <Section title="Currency &amp; Ask Price">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-20 shrink-0">Currency</span>
                  <select
                    value={scenarioCurrencyDraft}
                    onChange={(e) => handleScenarioCurrencyChange(e.target.value)}
                    className="flex-1 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
                  >
                    {!currencies && <option value={scenarioCurrencyDraft}>{scenarioCurrencyDraft}</option>}
                    {(currencies ?? []).map((c) => (
                      <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                    ))}
                  </select>
                </div>

                {askPriceConvertBanner && (
                  <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 space-y-1.5">
                    <p className="text-[10px] text-amber-400 leading-tight">
                      Ask Price was entered in {askPriceConvertBanner.from} — scenario currency is now {askPriceConvertBanner.to}. Convert it, or clear and re-enter.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void convertAskPriceNow()}
                        disabled={fxRateOnDemand.isPending}
                        className="text-[10px] font-medium text-amber-300 hover:text-amber-200 border border-amber-500/40 rounded px-1.5 py-0.5 disabled:opacity-50"
                      >{fxRateOnDemand.isPending ? 'Converting…' : `Convert to ${askPriceConvertBanner.to} now`}</button>
                      <button
                        onClick={() => { setAskPriceDraft(''); setAskPriceConvertBanner(null); }}
                        className="text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5"
                      >Clear and re-enter</button>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-20 shrink-0">Rate Type</span>
                  <select
                    value={rateTypeDraft}
                    onChange={(e) => setRateTypeDraft(e.target.value as FxRateType)}
                    className="flex-1 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
                  >
                    <option value="reference">Reference (latest available FX rate)</option>
                    <option value="budget">Budget (admin-set rate)</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                {rateTypeDraft === 'custom' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-20 shrink-0">Rate</span>
                    <input
                      type="number" min="0" step="0.0001"
                      placeholder={factoryCurrencyInfo ? `${factoryCurrencyInfo.code} → ${scenarioCurrencyDraft} rate` : 'rate'}
                      value={customRateDraft}
                      onChange={(e) => setCustomRateDraft(e.target.value)}
                      className="flex-1 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                  </div>
                ) : null}
                {rateTypeDraft === 'custom' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-20 shrink-0">Reason</span>
                    <input
                      type="text" placeholder="Required — e.g. contract-locked rate"
                      value={customReasonDraft}
                      onChange={(e) => setCustomReasonDraft(e.target.value)}
                      className="flex-1 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                  </div>
                ) : null}

                {!isIdentityCurrency && rateTypeDraft !== 'custom' && isFxRateLoading && (
                  <p className="text-[10px] text-muted-foreground/60 leading-tight">Resolving rate…</p>
                )}
                {!isIdentityCurrency && rateTypeDraft !== 'custom' && !isFxRateLoading && fxRateError && (
                  <p className="text-[10px] text-red-400 leading-tight">
                    {fxRateError instanceof ApiError ? fxRateError.message : 'Rate unavailable for this pair — try Reference or Custom.'}
                  </p>
                )}
                {resolvedFxRate && factoryCurrencyInfo && !isIdentityCurrency && (
                  <div className="text-[10px] text-muted-foreground/70 leading-tight space-y-0.5">
                    <p>1 {factoryCurrencyInfo.code} = {resolvedFxRate.rate.toFixed(5)} {scenarioCurrencyDraft}</p>
                    <p className="text-muted-foreground/50">
                      {resolvedFxRate.source ?? 'source unknown'}
                      {resolvedFxRate.rateDate ? ` · ${resolvedFxRate.rateDate}` : ''}
                      {resolvedFxRate.stale ? ' · stale (provider unavailable)' : ''}
                    </p>
                  </div>
                )}
                {/* Informational only — never used for costing. Always shown
                    (including when scenario currency = factory currency,
                    where the conversion rate above is trivially 1 and has no
                    source/date to disclose) so the live reference source is
                    always visible somewhere in this widget. */}
                {usdReferenceEnabled && usdReferenceRate && (
                  <p className="text-[10px] text-muted-foreground/50 leading-tight">
                    {usdReferenceRateType === 'budget' ? 'Budget' : 'Reference'}: 1 USD = {usdReferenceRate.rate.toFixed(4)} {factoryCurrencyInfo?.code}
                    {usdReferenceRate.source ? ` · ${usdReferenceRate.source}` : ''}
                    {usdReferenceRate.rateDate ? ` · ${usdReferenceRate.rateDate}` : ''}
                  </p>
                )}
                {rateTypeDraft !== 'custom' && !isIdentityCurrency && factoryCurrencyInfo && (
                  <button
                    onClick={() => refreshFxRate.mutate({ base: factoryCurrencyInfo.code, quote: scenarioCurrencyDraft })}
                    disabled={refreshFxRate.isPending}
                    className="text-[10px] text-violet-400 hover:text-violet-300 disabled:opacity-50"
                  >{refreshFxRate.isPending ? 'Refreshing…' : 'Refresh FX'}</button>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-muted-foreground w-20 shrink-0">Ask Price</span>
                  <div className="relative flex-1">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none select-none">
                      {scenarioCurrencySymbols[scenarioCurrencyDraft] ?? scenarioCurrencyDraft}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Target / quoted price"
                      value={askPriceDraft}
                      onChange={(e) => setAskPriceDraft(e.target.value)}
                      className="w-full text-xs border border-border rounded pl-6 pr-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                  </div>
                </div>
                {askPriceDraft && !isNaN(parseFloat(askPriceDraft)) && (
                  <p className="text-[10px] text-amber-400/80 leading-tight">
                    Ask {scenarioCurrencySymbols[scenarioCurrencyDraft] ?? scenarioCurrencyDraft}{parseFloat(askPriceDraft).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} — shown alongside cost for margin tracking. Saved on Apply Scenario.
                  </p>
                )}
              </div>
            </Section>

            <Section title="Process Routing">
              <div className="flex items-center gap-2 py-0.5">
                <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                  <input type="radio" name="proc_routing" checked={processRouting === 'auto'}
                    onChange={() => setProcessRouting('auto')}
                    className="accent-violet-600 shrink-0" />
                  <span className="text-xs font-medium leading-tight">Auto (process-computed)</span>
                </label>
                <button
                  onClick={() => setProcessRouting('auto')}
                  className="text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5 shrink-0 transition-colors"
                  title="View workflow"
                >...</button>
              </div>
              <div className="flex items-center gap-2 py-0.5 mt-1">
                <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                  <input type="radio" name="proc_routing" checked={processRouting === 'manual'}
                    onChange={() => { setProcessRouting('manual'); onManualClick(); }}
                    className="accent-violet-600 shrink-0" />
                  <span className="text-xs font-medium leading-tight">Manual routing</span>
                </label>
                <button
                  onClick={() => { setProcessRouting('manual'); onManualClick(); }}
                  className="text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5 shrink-0 transition-colors"
                  title="Open workflow builder"
                >...</button>
              </div>
              {processRouting === 'manual' && selectedManualRoute && (
                <button
                  onClick={onManualClick}
                  className="ml-4 mt-0.5 text-[11px] text-violet-400 hover:text-violet-300 underline text-left"
                >
                  {selectedManualRoute.label} ↗
                </button>
              )}
            </Section>

            <Section title="Material Grade">
              {/* Combobox input — deliberately styled to read as a live,
                  searchable pick-from-database control (search icon, dropdown
                  chevron, focus ring), not a static label. matDropItems is
                  always a real-time useRawMaterials() search against the DB;
                  nothing here is a hardcoded material list. */}
              <div className="relative mb-1.5">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
                <input
                  type="text"
                  value={matInputValue}
                  onChange={(e) => { setMatInputValue(e.target.value); setMatDropOpen(true); }}
                  onFocus={() => setMatDropOpen(true)}
                  onBlur={() => setTimeout(() => setMatDropOpen(false), 160)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && matInputValue.trim()) {
                      updateBOMItem.mutate({ id: item.id, data: { materialGrade: matInputValue.trim() } });
                      autoAddMaterialCost(matInputValue.trim());
                      void reapplyEffectiveRoute();
                      setMatDropOpen(false);
                    }
                    if (e.key === 'Escape') setMatDropOpen(false);
                  }}
                  placeholder="Search raw materials database…"
                  title="Select a material grade from the raw materials database"
                  className="w-full text-xs border border-border rounded px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500 pl-8 pr-24"
                />
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {matInputValue.trim() && matInputValue.trim() !== item.materialGrade && (
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        updateBOMItem.mutate({ id: item.id, data: { materialGrade: matInputValue.trim() } });
                        autoAddMaterialCost(matInputValue.trim());
                        void reapplyEffectiveRoute();
                        setMatDropOpen(false);
                      }}
                      className="text-[10px] font-semibold text-violet-500 border border-violet-500/40 rounded px-1.5 py-0.5 leading-none hover:bg-violet-500/10 transition-colors"
                    >Apply</button>
                  )}
                  <button
                    onMouseDown={(e) => { e.preventDefault(); setMatPickerOpen(true); setMatDropOpen(false); }}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5 leading-none transition-colors"
                    title="Browse the full raw materials database"
                  >
                    <Database className="h-3 w-3" />
                    Browse
                  </button>
                  <ChevronDown
                    className="h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none cursor-pointer"
                    onMouseDown={(e) => { e.preventDefault(); setMatDropOpen((v) => !v); }}
                  />
                </div>

                {/* Dropdown suggestions — always a live DB search result, never a static/hardcoded list */}
                {matDropOpen && matDropItems.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-popover border border-border rounded shadow-lg max-h-52 overflow-y-auto">
                    {matDropItems.map((m) => {
                      const grade = materialLabel(m.material, m.materialGrade);
                      const isCurrent = grade === item.materialGrade;
                      return (
                        <button
                          key={m.id}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setMatInputValue(grade);
                            updateBOMItem.mutate({ id: item.id, data: { materialGrade: grade } });
                            autoAddMaterialCost(grade);
                            void reapplyEffectiveRoute();
                            setMatDropOpen(false);
                          }}
                          className={`w-full text-left px-2.5 py-1.5 hover:bg-muted/60 transition-colors border-b border-border/20 last:border-0 flex items-center justify-between gap-2 ${isCurrent ? 'bg-emerald-500/5' : ''}`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">{grade}</div>
                            {m.materialGroup && (
                              <div className="text-[10px] text-muted-foreground truncate">{m.materialGroup}</div>
                            )}
                          </div>
                          {isCurrent && <span className="text-emerald-500 text-xs shrink-0">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Currently-costed confirmation — reads from DB-persisted grade so it
                  only appears after a real Apply/selection, distinct from whatever
                  is still being typed/searched above in matInputValue. */}
              {item.materialGrade && (
                <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 mb-1.5 px-0.5">
                  <span>✓</span>
                  <span>Currently costed as <strong>{item.materialGrade}</strong></span>
                </div>
              )}

              {/* Drawing / CAD suggestions shown below input when different from current */}
              {hasDrawingMaterial && drawingMaterial !== item.materialGrade && (
                <div className="flex items-center gap-1.5 mb-1.5 pb-1.5 border-b border-border/30">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium truncate block">{drawingMaterial}</span>
                    <span className="text-[9px] text-muted-foreground/60 leading-tight">From drawing title block</span>
                  </div>
                  <span className="text-[9px] font-semibold text-blue-400 border border-blue-500/40 rounded px-1 py-px leading-none shrink-0">DRAWING</span>
                  <button
                    onClick={() => { updateBOMItem.mutate({ id: item.id, data: { materialGrade: drawingMaterial! } }); autoAddMaterialCost(drawingMaterial!); void reapplyEffectiveRoute(); }}
                    className="text-[9px] font-medium text-violet-400 hover:text-violet-300 shrink-0"
                  >Apply</button>
                </div>
              )}
            </Section>

            <Section title="Blank Thickness">
              <div className="flex items-center justify-between text-[11px] py-1">
                <span className="text-muted-foreground">CAD Thickness</span>
                <span className="font-medium">{cadThicknessMm > 0 ? `${cadThicknessMm} mm` : '—'}</span>
              </div>
              <div className="flex items-center gap-2 py-1">
                <span className="text-[11px] text-muted-foreground w-28 shrink-0">Manual Override</span>
                {isEditingBlankThickness ? (
                  <>
                    <input
                      autoFocus
                      type="number"
                      min="0"
                      step="0.1"
                      value={blankThickness}
                      onChange={(e) => setBlankThickness(e.target.value)}
                      onBlur={commitBlankThicknessOverride}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') cancelBlankThicknessEdit();
                      }}
                      placeholder={cadThicknessMm > 0 ? String(cadThicknessMm) : '—'}
                      className="flex-1 text-xs border border-border rounded px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                    <span className="text-xs text-muted-foreground shrink-0">mm</span>
                  </>
                ) : (
                  <button
                    onClick={() => setIsEditingBlankThickness(true)}
                    className="flex-1 flex items-center justify-between text-xs border border-transparent hover:border-border rounded px-2.5 py-1.5 text-left group"
                    title="Click to edit"
                  >
                    <span className={item.scenarioOverrides?.sheetThicknessMm != null ? 'font-medium' : 'text-muted-foreground'}>
                      {item.scenarioOverrides?.sheetThicknessMm != null ? `${item.scenarioOverrides.sheetThicknessMm} mm` : 'Not set'}
                    </span>
                    <Edit className="h-3 w-3 text-muted-foreground group-hover:text-foreground shrink-0" />
                  </button>
                )}
                {item.scenarioOverrides?.sheetThicknessMm != null && (
                  <button
                    onClick={() => { setBlankThickness(''); setIsEditingBlankThickness(false); patchScenarioOverrides.mutate({ id: item.id, patch: { sheetThicknessMm: null } }); }}
                    title="Clear override — revert to CAD thickness"
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between text-[11px] py-1 border-t border-border/50 mt-1 pt-1.5">
                <span className="text-foreground font-medium">Effective Thickness</span>
                <span className="font-semibold text-violet-400">{effectiveThicknessMm} mm</span>
              </div>
              <p className="text-[10px] text-muted-foreground/50 mt-0.5">Used for costing — override wins when set, else the real CAD value</p>
            </Section>

            {cgpCostSummary?.blankSpec && (
              <Section title="Blank Stock">
                <BlankStockSection
                  blank={cgpCostSummary.blankSpec}
                  currencySymbol={cgpCostSummary.currencySymbol ?? '₹'}
                />
              </Section>
            )}

            <Section title="Volume and Batch Size">
              <InputRow label="Annual Volume" value={annualVolumeDraft} onChange={setAnnualVolumeDraft} onBlur={commitAnnualVolume} />
              <InputRow label="Batch Size" value={batchSizeDraft} onChange={setBatchSizeDraft} />
              <InputRow label="Production Life (yr)" value={productionLife} onChange={setProductionLife} />
            </Section>

            <Section title="Company Defined Attributes" defaultOpen={false}>
              <Row label="Description" value={item.description?.slice(0, 40) ?? '—'} />
              <div className="flex items-center gap-2 py-0.5">
                <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">Product Line</span>
                <input type="text" value={productLine} onChange={(e) => setProductLine(e.target.value)} placeholder="—"
                  className="text-xs text-right w-20 shrink-0 border border-border rounded px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500" />
              </div>
              <Row label="Model Number" value={item.partNumber ?? '—'} />
            </Section>
          </>
        )}

        {tab === 'geo' && (
          <DrawingIntelligenceTab item={item} />
        )}

        {tab === 'gdt' && (
          <GdtFunctionalTab item={item} fg={fg} summary={summary} />
        )}

        {tab === 'features' && (
          <ManufacturingFeaturesTab item={item} summary={summary} dfmScores={dfmScores} />
        )}

        {tab === 'machine' && (
          <RouteComparisonCard
            item={item}
            batchSize={batchSize}
            appliedRouteId={leftAppliedRouteId}
            onAppliedRouteChange={setLeftAppliedRouteId}
            factory={factory}
            {...(onSelectHighlight ? { onSelectHighlight } : {})}
          />
        )}

      </div>

      {/* Action buttons */}
      <div className="border-t px-3 py-2 shrink-0 space-y-1.5">
        {applyProgress && (
          <div className="space-y-1">
            <Progress value={applyProgress.pct} className="h-1.5" />
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {applyProgress.step}
            </p>
          </div>
        )}
        <div className="flex gap-1.5">
          <button
            onClick={() => setConfirmApplyOpen(true)}
            disabled={isApplying}
            className="flex-1 text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded px-2 py-1 font-medium transition-colors flex items-center justify-center gap-1.5"
          >
            {isApplying && <Loader2 className="h-3 w-3 animate-spin" />}
            {isApplying ? 'Applying…' : 'Apply'}
          </button>
          <button className="text-xs border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">Copy</button>
          <button className="text-xs border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">New</button>
        </div>
      </div>

      {/* Confirm before committing — apply-route/apply-custom-route re-runs the
          whole route-comparison engine and replaces this part's ENTIRE active
          process routing (writeProcessLinesAsRecords deletes+reinserts), so an
          accidental click had real, hard-to-notice consequences with no way
          back except re-applying again. */}
      <AlertDialog open={confirmApplyOpen} onOpenChange={(open) => { if (!isApplying) setConfirmApplyOpen(open); }}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Apply this scenario?</AlertDialogTitle>
            {/* AlertDialogDescription renders a real <p> (Radix's Description
                primitive) — it must only ever wrap plain inline text. The
                <ul>/second <p> below are real HTML block content and were
                nested INSIDE it, which is invalid (<p> can't contain <p> or
                <ul>) and threw a hydration error. Moved them to a sibling
                <div>, outside AlertDialogDescription, instead. */}
            <AlertDialogDescription>This replaces the part's current process routing with:</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <ul className="text-xs space-y-1 pl-1">
              <li>
                Route:{' '}
                <span className="text-foreground font-medium">
                  {processRouting === 'manual' && selectedManualRoute ? selectedManualRoute.label : 'Auto-recommended'}
                </span>
              </li>
              <li>Location: <span className="text-foreground font-medium">{factoryDraft}</span></li>
              <li>Batch size: <span className="text-foreground font-medium">{batchSizeDraft.toLocaleString()}</span></li>
              {matInputValue.trim() && (
                <li>Material: <span className="text-foreground font-medium">{matInputValue.trim()}</span></li>
              )}
              <li>
                Currency: <span className="text-foreground font-medium">{scenarioCurrencyDraft}</span>
                {resolvedFxRate && factoryCurrencyInfo && !isIdentityCurrency && (
                  <span className="text-muted-foreground"> (1 {factoryCurrencyInfo.code} = {resolvedFxRate.rate.toFixed(4)} {scenarioCurrencyDraft}, {rateTypeDraft})</span>
                )}
              </li>
              {askPriceDraft.trim() && !isNaN(parseFloat(askPriceDraft)) && (
                <li>Ask Price: <span className="text-foreground font-medium">{scenarioCurrencySymbols[scenarioCurrencyDraft] ?? scenarioCurrencyDraft}{parseFloat(askPriceDraft).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></li>
              )}
            </ul>
            <p className="text-xs">Any process whose cycle time can't be resolved will be reported below rather than saved.</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setConfirmApplyOpen(false);
                void runApplyScenario();
              }}
            >
              Apply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MaterialPickerDialog
        open={matPickerOpen}
        onClose={() => setMatPickerOpen(false)}
        onSelect={(grade) => {
          updateBOMItem.mutate({ id: item.id, data: { materialGrade: grade } });
          setMatPickerOpen(false);
        }}
      />
    </div>
  );
}

// ── SustainabilityTab ─────────────────────────────────────────────────────────

function SustainabilityTab({ item, batchSize, factory }: { item: BOMItem; batchSize: number; factory: string }) {
  // Was omitting location entirely — useCostSummary defaults to 'USA' when
  // no location is passed, so this tab silently ran a full second cost
  // computation for USA on every load/Apply regardless of the actual
  // Digital Factory, doubling backend costing work for no reason (its own
  // numbers were never even shown — CostSummaryTab right next to it already
  // fetches the real, factory-scoped cost correctly).
  const { data: cost, isLoading } = useCostSummary(item.id, batchSize, factory);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-4 text-muted-foreground text-xs">
        <Loader2 className="h-3 w-3 animate-spin" />
        Calculating sustainability…
      </div>
    );
  }

  const s = cost?.sustainability;
  if (!s) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 gap-2 text-muted-foreground">
        <AlertCircle className="h-8 w-8 opacity-30" />
        <p className="text-xs text-center">No sustainability data.</p>
        <p className="text-[10px] text-center opacity-70">Run a cost summary first.</p>
      </div>
    );
  }

  const scoreColor = s.sustainabilityScore >= 80 ? 'text-green-500'
    : s.sustainabilityScore >= 60 ? 'text-yellow-500'
    : 'text-red-500';
  const scoreBarColor = s.sustainabilityScore >= 80 ? 'bg-green-500'
    : s.sustainabilityScore >= 60 ? 'bg-yellow-500'
    : 'bg-red-500';
  const scoreLabel = s.sustainabilityScore >= 80 ? 'Good'
    : s.sustainabilityScore >= 60 ? 'Fair'
    : 'Needs Improvement';

  return (
    <div>
      <Section title="Sustainability Summary">
        <Row label="Part Weight"          value={`${s.netWeightKg} kg`} />
        <Row label="Scrap Generated"      value={`${s.scrapKg} kg`} />
        <Row label="Waste Cost"           value={`$${s.wasteCostInr.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} />
        <Row label="Material Yield (Weight)" value={`${s.materialUtilizationPct.toFixed(1)}%`} />
        <Row label="Total CO₂"            value={`${s.totalCo2Kg} kg CO₂e`} />
        <Row label="Manufacturing Energy" value={`${s.totalProcessEnergyKwh} kWh`} />
        <Row label="Recyclability"        value={`${s.recyclabilityPct}%`} />
      </Section>

      <Section title="CO₂ Contributors">
        <table className="w-full text-xs border-collapse">
          <tbody>
            {s.co2Contributors.map((c) => (
              <tr key={c.label} className="border-b border-border/40">
                <td className="py-0.5 text-muted-foreground">{c.label}</td>
                <td className="py-0.5 text-right tabular-nums text-muted-foreground w-16">{c.co2Kg} kg</td>
                <td className="py-0.5 text-right tabular-nums text-[10px] text-muted-foreground/70 w-10">{c.pct}%</td>
              </tr>
            ))}
            <tr>
              <td className="pt-1 text-xs font-medium">Total</td>
              <td className="pt-1 text-right tabular-nums text-xs font-medium w-16">{s.totalCo2Kg} kg CO₂e</td>
              <td />
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="Material Impact">
        <Row label="Material Grade"    value={cost.materialGrade || '—'} />
        <Row label="Embodied Carbon"   value={`${s.materialCo2PerKg} kg CO₂e/kg`} />
        <Row label="Data Source"       value={s.materialCo2Source === 'lookup' ? 'Material database' : 'Default estimate'} />
      </Section>

      {(item.annualVolume ?? 0) > 0 && (
        <Section title="Program CO₂ Impact">
          <Row label="Per Part"       value={`${s.totalCo2Kg} kg CO₂e`} />
          <Row label={`Annual (${(item.annualVolume ?? 0).toLocaleString('en-IN')} pcs)`}
               value={`${Math.round(s.totalCo2Kg * (item.annualVolume ?? 0)).toLocaleString('en-IN')} kg CO₂e`} />
          <Row label="5-Year Program" value={`${Math.round(s.totalCo2Kg * (item.annualVolume ?? 0) * 5).toLocaleString('en-IN')} kg CO₂e`} />
        </Section>
      )}

      <Section title="Improvement Opportunities">
        {s.opportunities.map((o, i) => (
          <p key={i} className="text-[10px] text-muted-foreground py-0.5">✓ {o}</p>
        ))}
      </Section>

      <Section title="Sustainability Score">
        <div className="flex items-center gap-3 py-1">
          <span className={`text-2xl font-bold tabular-nums ${scoreColor}`}>
            {s.sustainabilityScore}
          </span>
          <div className="flex-1">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${scoreBarColor}`}
                style={{ width: `${s.sustainabilityScore}%` }}
              />
            </div>
            <p className={`text-[10px] mt-0.5 ${scoreColor}`}>{scoreLabel}</p>
          </div>
          <span className="text-[10px] text-muted-foreground">/100</span>
        </div>
        {s.scoreBreakdown && (
          <table className="w-full text-[10px] border-collapse mt-1">
            <tbody>
              <tr className="border-b border-border/40">
                <td className="py-0.5 text-muted-foreground">Material Efficiency</td>
                <td className="py-0.5 text-right tabular-nums text-muted-foreground">
                  {s.scoreBreakdown.materialEfficiency.toFixed(1)}<span className="text-muted-foreground/50">/30</span>
                </td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-0.5 text-muted-foreground">Carbon Intensity</td>
                <td className="py-0.5 text-right tabular-nums text-muted-foreground">
                  {s.scoreBreakdown.carbonIntensity.toFixed(1)}<span className="text-muted-foreground/50">/30</span>
                </td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-0.5 text-muted-foreground">Recyclability</td>
                <td className="py-0.5 text-right tabular-nums text-muted-foreground">
                  {s.scoreBreakdown.recyclability.toFixed(1)}<span className="text-muted-foreground/50">/20</span>
                </td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-0.5 text-muted-foreground">Process Energy</td>
                <td className="py-0.5 text-right tabular-nums text-muted-foreground">
                  {s.scoreBreakdown.processEnergy.toFixed(1)}<span className="text-muted-foreground/50">/20</span>
                </td>
              </tr>
              <tr>
                <td className="pt-1 text-xs font-medium">Total</td>
                <td className={`pt-1 text-right tabular-nums text-xs font-medium ${scoreColor}`}>
                  {s.sustainabilityScore}<span className="text-muted-foreground/50 font-normal">/100</span>
                </td>
              </tr>
            </tbody>
          </table>
        )}
        <p className="text-[9px] text-muted-foreground/50 pt-2">{s.factorsSource}</p>
      </Section>
    </div>
  );
}

// ── CNCFeatureTree ────────────────────────────────────────────────────────────

const CNC_FEATURE_GROUPS: Array<{ label: string; types: string[] }> = [
  { label: 'Turning',        types: ['external_diameter', 'groove', 'fillet'] },
  { label: 'Boring',         types: ['through_hole', 'blind_hole'] },
  { label: 'Cross-Drilling', types: ['cross_hole', 'pcd_hole_pattern'] },
  { label: 'Milling',        types: ['slot', 'radial_slot', 'keyway', 'pocket'] },
  { label: 'Finishing',      types: ['counterbore', 'countersink', 'chamfer'] },
];

const CNC_TYPE_LABELS: Record<string, string> = {
  through_hole:    'Through Hole',
  blind_hole:      'Blind Hole',
  external_diameter: 'Outer Diameter',
  groove:          'Groove',
  fillet:          'Fillet',
  cross_hole:      'Cross Hole',
  pcd_hole_pattern:'PCD Pattern',
  counterbore:     'Counterbore',
  countersink:     'Countersink',
  chamfer:         'Chamfer',
  slot:            'Slot',
  pocket:          'Pocket',
  keyway:          'Keyway',
  radial_slot:     'Radial Slot',
};

const CNC_GROUP_META: Record<string, { operation: string; setup: 'Low' | 'Medium' | 'High'; inspection: string }> = {
  'Turning':        { operation: 'CNC Turning',   setup: 'Low',    inspection: 'Vernier Caliper' },
  'Boring':         { operation: 'Drilling',       setup: 'Low',    inspection: 'Plug Gauge' },
  'Cross-Drilling': { operation: 'Cross Drilling', setup: 'Medium', inspection: 'Plug Gauge' },
  'Milling':        { operation: 'CNC Milling',    setup: 'Medium', inspection: 'CMM' },
  'Finishing':      { operation: 'CNC Finishing',  setup: 'Low',    inspection: 'Depth Gauge' },
};

function CNCFeatureInspectorPanel({ selectedId, fg }: { selectedId: string; fg: FeatureGraph }) {
  const idTail = selectedId.replace(/^cnc_[^_]+_/, ''); // "cnc_turning_boring" → "boring"
  const group = CNC_FEATURE_GROUPS.find(
    (g) => g.label.toLowerCase().replace(/[^a-z]/g, '_') === idTail,
  );
  const cncFeats: any[] = (fg as any)?.cnc_features?.features ?? [];
  if (!group) return null;

  const matching = cncFeats.filter((f: any) => group.types.includes(f.type));
  if (matching.length === 0) return null;

  const typeCounts: Record<string, number> = {};
  for (const f of matching) typeCounts[f.type] = (typeCounts[f.type] ?? 0) + 1;
  const typeEntries = Object.entries(typeCounts).sort(([, a], [, b]) => b - a);

  const diamCounts: Record<string, number> = {};
  for (const f of matching) {
    const d = f.params?.diameter_mm ?? f.params?.major_diameter_mm;
    if (d != null) {
      const key = `Ø${Number(d).toFixed(1)}`;
      diamCounts[key] = (diamCounts[key] ?? 0) + 1;
    }
  }
  const diamEntries = Object.entries(diamCounts).sort(
    ([a], [b]) => parseFloat(a.slice(1)) - parseFloat(b.slice(1)),
  );

  const meta = CNC_GROUP_META[group.label] ?? { operation: 'CNC', setup: 'Low' as const, inspection: '—' };
  const primaryType =
    typeEntries.length === 1 && typeEntries[0]
      ? (CNC_TYPE_LABELS[typeEntries[0][0]] ?? group.label)
      : group.label;
  const maxDiamCount = Math.max(...diamEntries.map(([, c]) => c), 1);

  const setupColor =
    meta.setup === 'Low' ? 'text-green-400' : meta.setup === 'Medium' ? 'text-amber-400' : 'text-red-400';
  const setupDot =
    meta.setup === 'Low' ? 'bg-green-400' : meta.setup === 'Medium' ? 'bg-amber-400' : 'bg-red-400';

  return (
    <div className="divide-y divide-border/50">
      {/* Type + Count row */}
      <div className="px-3 py-3 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Feature Information</div>
          <div className="text-base font-semibold text-foreground leading-tight">{primaryType}</div>
          {typeEntries.length > 1 && (
            <div className="mt-1 flex flex-col gap-0.5">
              {typeEntries.map(([type, count]) => (
                <div key={type} className="text-[10px] text-muted-foreground">
                  {CNC_TYPE_LABELS[type] ?? type} ×{count}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Count</div>
          <div className="text-3xl font-bold text-foreground tabular-nums leading-none">{matching.length}</div>
        </div>
      </div>

      {/* Diameter breakdown */}
      {diamEntries.length > 0 && (
        <div className="px-3 py-3">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-2">Diameter</div>
          <div className="flex flex-col gap-2">
            {diamEntries.slice(0, 6).map(([d, count]) => (
              <div key={d} className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-cyan-400 w-10 shrink-0">{d}</span>
                <div className="flex-1 h-[3px] bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400/70 rounded-full"
                    style={{ width: `${(count / maxDiamCount) * 100}%` }}
                  />
                </div>
                <span className="text-[11px] text-muted-foreground tabular-nums w-6 text-right">×{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Operation */}
      <div className="px-3 py-2.5 flex items-baseline gap-2">
        <span className="text-[10px] text-muted-foreground w-28 shrink-0">Operation</span>
        <span className="text-[11px] font-medium text-foreground">{meta.operation}</span>
      </div>

      {/* Estimated Setup */}
      <div className="px-3 py-2.5 flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground w-28 shrink-0">Estimated Setup</span>
        <span className={`text-[11px] font-semibold flex items-center gap-1.5 ${setupColor}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${setupDot}`} />
          {meta.setup}
        </span>
      </div>

      {/* Inspection */}
      <div className="px-3 py-2.5 flex items-baseline gap-2">
        <span className="text-[10px] text-muted-foreground w-28 shrink-0">Inspection</span>
        <span className="text-[11px] font-medium text-foreground">{meta.inspection}</span>
      </div>
    </div>
  );
}

function ThreadFeatureInspectorPanel({ selectedId, item }: { selectedId: string; item: BOMItem }) {
  const idx = parseInt(selectedId.replace('thread_di_', ''), 10);
  const threadSpecs = (item.drawingIntelligence as any)?.threads as
    Array<{ size: string; pitch: number; count: number }> | undefined;
  const t = threadSpecs?.[idx];
  if (!t) return null;

  const isHelicoil = /helicoil/i.test(t.size);

  return (
    <div className="divide-y divide-border/50">
      <div className="px-3 py-3 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Thread Type</div>
          <div className="text-base font-semibold text-foreground leading-tight">
            {isHelicoil ? 'Helicoil Insert' : 'Internal Thread'}
          </div>
          <div className="text-[11px] font-mono text-cyan-400 mt-1">{t.size}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Count</div>
          <div className="text-3xl font-bold text-foreground tabular-nums leading-none">{t.count}</div>
        </div>
      </div>

      <div className="px-3 py-2.5 flex items-baseline gap-2">
        <span className="text-[10px] text-muted-foreground w-28 shrink-0">Specification</span>
        <span className="text-[11px] font-mono text-foreground">{t.size} × {t.pitch}</span>
      </div>

      <div className="px-3 py-2.5 flex items-baseline gap-2">
        <span className="text-[10px] text-muted-foreground w-28 shrink-0">Operation</span>
        <span className="text-[11px] font-medium text-foreground">{isHelicoil ? 'Helicoil Insert' : 'Tapping'}</span>
      </div>

      <div className="px-3 py-2.5 flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground w-28 shrink-0">Estimated Setup</span>
        <span className="text-[11px] font-semibold flex items-center gap-1.5 text-amber-400">
          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-amber-400" />
          Medium
        </span>
      </div>

      <div className="px-3 py-2.5 flex items-baseline gap-2">
        <span className="text-[10px] text-muted-foreground w-28 shrink-0">Inspection</span>
        <span className="text-[11px] font-medium text-foreground">Thread Plug Gauge</span>
      </div>

      <div className="px-3 py-2.5 flex items-baseline gap-2">
        <span className="text-[10px] text-muted-foreground w-28 shrink-0">Source</span>
        <span className="text-[11px] text-muted-foreground">Drawing Intelligence</span>
      </div>
    </div>
  );
}

function CNCFeatureTree({
  cncFeatures,
  selectedKey,
  onSelect,
}: {
  cncFeatures: any;
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedTypes, setExpandedTypes] = useState<Record<string, boolean>>({});

  const summary: Record<string, number> = cncFeatures?.feature_summary ?? {};
  const features: any[] = cncFeatures?.features ?? [];

  const familyLabel =
    cncFeatures?.family === 'mill_turn' ? 'Mill-Turn'
    : cncFeatures?.family === 'cnc_turned' ? 'CNC Turned'
    : cncFeatures?.family === 'cnc_milled' ? 'CNC Milled'
    : 'CNC';

  function getDiameterDist(type: string): Array<{ d: string; count: number }> {
    const byDiameter: Record<string, number> = {};
    for (const f of features) {
      if (f.type !== type) continue;
      const d = f.params?.diameter_mm;
      if (d != null) {
        const key = `Ø${Number(d).toFixed(1)}`;
        byDiameter[key] = (byDiameter[key] ?? 0) + 1;
      }
    }
    return Object.entries(byDiameter)
      .map(([d, count]) => ({ d, count }))
      .sort((a, b) => parseFloat(a.d.slice(1)) - parseFloat(b.d.slice(1)));
  }

  return (
    <Section title={`${familyLabel} Features`}>
      {CNC_FEATURE_GROUPS.map(({ label, types }) => {
        const groupCount = types.reduce((s, t) => s + (summary[t] ?? 0), 0);
        if (groupCount === 0) return null;
        const isOpen = !!expandedGroups[label];
        return (
          <div key={label} className="-mx-3 border-t first:border-t-0">
            <button
              onClick={() => setExpandedGroups((p) => ({ ...p, [label]: !p[label] }))}
              className="flex items-center gap-1.5 w-full px-3 py-1 text-left hover:bg-muted/30 transition-colors"
            >
              {isOpen
                ? <ChevronDown className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />}
              <span className="text-[10px] font-medium text-foreground flex-1">{label}</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{groupCount}</span>
            </button>
            {isOpen && (
              <div className="pl-7 pr-3 pb-1.5 space-y-0.5">
                {types.map((type) => {
                  const count = summary[type] ?? 0;
                  if (count === 0) return null;
                  const typeLabel = type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
                  const diams = getDiameterDist(type);
                  const typeKey = `${label}:${type}`;
                  const typeOpen = !!expandedTypes[typeKey];
                  const typeSelected = selectedKey === type;
                  return (
                    <div key={type}>
                      {diams.length > 0 ? (
                        <button
                          onClick={() => {
                            setExpandedTypes((p) => ({ ...p, [typeKey]: !p[typeKey] }));
                            onSelect?.(typeSelected ? null : type);
                          }}
                          className={cn(
                            "flex items-center gap-1 w-full text-left rounded px-1 -mx-1 transition-colors",
                            typeSelected
                              ? "bg-primary/10 ring-1 ring-primary/30"
                              : "hover:bg-muted/40",
                          )}
                        >
                          {typeOpen
                            ? <ChevronDown className="h-2 w-2 text-muted-foreground/60 shrink-0" />
                            : <ChevronRight className="h-2 w-2 text-muted-foreground/60 shrink-0" />}
                          <span className={cn("text-[10px] flex-1", typeSelected ? "text-foreground font-medium" : "text-muted-foreground")}>{typeLabel}</span>
                          <span className="text-[10px] font-medium tabular-nums">×{count}</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => onSelect?.(typeSelected ? null : type)}
                          className={cn(
                            "flex items-baseline gap-2 pl-3 w-full text-left rounded px-1 -mx-1 transition-colors",
                            typeSelected
                              ? "bg-primary/10 ring-1 ring-primary/30"
                              : "hover:bg-muted/40",
                          )}
                        >
                          <span className={cn("text-[10px] flex-1", typeSelected ? "text-foreground font-medium" : "text-muted-foreground")}>{typeLabel}</span>
                          <span className="text-[10px] font-medium tabular-nums">×{count}</span>
                        </button>
                      )}
                      {typeOpen && (
                        <div className="pl-5 pt-0.5 pb-0.5 space-y-0.5">
                          {diams.map(({ d, count: dc }) => {
                            const diamKey = `${type}:${d.slice(1)}`;
                            const diamSelected = selectedKey === diamKey;
                            return (
                              <button
                                key={d}
                                onClick={() => onSelect?.(diamSelected ? null : diamKey)}
                                className={cn(
                                  "flex items-baseline gap-2 w-full text-left rounded px-1 -mx-1 transition-colors",
                                  diamSelected
                                    ? "bg-primary/10 ring-1 ring-primary/30"
                                    : "hover:bg-muted/40",
                                )}
                              >
                                <span className={cn("text-[9px] font-mono flex-1", diamSelected ? "text-foreground" : "text-muted-foreground/70")}>{d}</span>
                                <span className="text-[9px] tabular-nums text-muted-foreground">×{dc}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

// ── PartDetailTab ─────────────────────────────────────────────────────────────

function deriveComplexity(item: BOMItem): { label: string; color: string } {
  const fg = item.featureGraph;
  if (fg?.difficultyLevel) {
    const map: Record<string, string> = { easy: 'Low', medium: 'Medium', hard: 'High', very_hard: 'High' };
    const label = map[fg.difficultyLevel] ?? 'Medium';
    return {
      label,
      color: label === 'Low' ? 'text-green-500' : label === 'Medium' ? 'text-yellow-500' : 'text-red-500',
    };
  }
  const threads = item.drawingIntelligence?.threads?.reduce((s, t) => s + t.count, 0) ?? 0;
  const score = (item.bendCount ?? 0) * 2 + (item.holeCount ?? 0) / 20 + threads * 5;
  const label = score < 10 ? 'Low' : score < 30 ? 'Medium' : 'High';
  return {
    label,
    color: label === 'Low' ? 'text-green-500' : label === 'Medium' ? 'text-yellow-500' : 'text-red-500',
  };
}

function deriveReadiness(item: BOMItem): { label: string; ready: boolean } {
  const hasCritical = (item.featureGraph?.dfmWarnings ?? []).some((w) => w.severity === 'critical');
  if (hasCritical) return { label: 'DFM Issues Found', ready: false };
  if (!item.materialGrade) return { label: 'Material Pending', ready: false };
  if (!item.file2dPath && !item.drawingIntelligence) return { label: 'Drawing Required', ready: false };
  return { label: 'Ready for RFQ', ready: true };
}

function buildRiskFlags(item: BOMItem): string[] {
  const flags: string[] = [];
  if (!item.materialGrade) flags.push('Material not confirmed');
  if (item.tightestToleranceMm != null && item.tightestToleranceMm < 0.1)
    flags.push(`Tightest tolerance ±${item.tightestToleranceMm} mm`);
  if ((item.holeCount ?? 0) > 200) flags.push(`${item.holeCount} holes — high pierce count`);
  if ((item.bendCount ?? 0) > 40) flags.push(`${item.bendCount} bends`);
  for (const w of item.featureGraph?.dfmWarnings ?? []) {
    if (w.severity === 'critical' || w.severity === 'warning') flags.push(w.message);
  }
  for (const v of item.featureGraph?.validationResults ?? []) {
    if (!v.passed && v.severity !== 'info') flags.push(v.check);
  }
  return flags;
}

function PartDetailTab({
  item, batchSize, factory = 'USA', selectedCNCFeatureKey, onCNCFeatureSelect,
}: {
  item: BOMItem;
  batchSize: number;
  factory?: string;
  selectedCNCFeatureKey?: string | null;
  onCNCFeatureSelect?: (key: string | null) => void;
}) {
  const { data: cost } = useCostSummary(item.id, batchSize, factory);
  const fg = item.featureGraph;
  const di = item.drawingIntelligence;

  const complexity = deriveComplexity(item);
  const readiness = deriveReadiness(item);
  const flags = buildRiskFlags(item);

  const holeCount = item.holeCount ?? fg?.summary?.holeCount ?? 0;
  const bendCount = item.bendCount ?? fg?.summary?.bendCount ?? 0;
  const threads = di?.threads ?? [];
  const threadTotal = threads.reduce((s, t) => s + t.count, 0);
  const cncFeatures: any = (fg as any)?.cnc_features ?? null;

  const family = item.familyClassification ?? fg?.classification?.family ?? '';
  const isIM = family === 'injection_molded';
  const isSM = family === 'sheet_metal';

  // IM-specific summary fields (zero-default so downstream display logic is clean)
  const imS = (fg?.summary as any) ?? {};
  const undraftedFaceCount: number = imS.undraftedFaceCount ?? 0;
  const undercutFaceCount: number = imS.undercutFaceCount ?? 0;
  const ribCount: number = imS.ribCount ?? imS.ribCountProxy ?? 0;
  const blindFeatureCount: number = imS.blindFeatureCount ?? 0;
  const insertCandidateCount: number = imS.insertCandidateCount ?? 0;
  const throughHoleCount: number = imS.throughHoleCount ?? 0;
  const wallNominalMm: number | null = imS.wallThicknessNominalMm || null;
  const wallMinMm: number | null = imS.wallThicknessMinMm || null;
  const wallMaxMm: number | null = imS.wallThicknessMaxMm || null;
  const thinWallViolations: number = imS.thinWallViolationCount ?? 0;
  const avgDraftDeg: number | null = imS.avgDraftAngleDeg ?? null;

  const complexityDrivers: string[] = [];
  if (isIM) {
    if (holeCount > 0) complexityDrivers.push(`${holeCount} holes`);
    if (undraftedFaceCount > 0) complexityDrivers.push(`${undraftedFaceCount} undrafted`);
    if (ribCount > 0) complexityDrivers.push(`${ribCount} ribs`);
  } else {
    if (holeCount > 0) complexityDrivers.push(`${holeCount} holes`);
    if (bendCount > 0) complexityDrivers.push(`${bendCount} bends`);
    if (threadTotal > 0) complexityDrivers.push(`${threadTotal} threads`);
  }

  const SHORT_NAME: Record<string, string> = {
    'Laser Cutting': 'Laser',
    'Press Brake': 'Press Brake',
    'Tapping': 'Tapping',
    'Deburring': 'Deburring',
  };
  const routeFromCost =
    cost?.processLines && cost.processLines.length > 0
      ? cost.processLines.map((l) => SHORT_NAME[l.process] ?? l.process)
      : null;
  const fgRecommended =
    fg?.processRecommendations
      ?.filter((r) => r.status === 'recommended')
      .map((r) => r.process) ?? [];
  const routeFromFg = fgRecommended.length > 0 ? fgRecommended : null;
  const routeParts = [...(routeFromCost ?? routeFromFg ?? [])];
  // A part with bends must show a bending step even when cost lines or
  // recommendations omit it (e.g. material pending → no tonnage/cost line yet).
  if (bendCount > 0 && routeParts.length > 0 && !routeParts.some((p) => /press brake|bend/i.test(p))) {
    const cutIdx = routeParts.findIndex((p) => /laser|punch|waterjet|cutting/i.test(p));
    routeParts.splice(cutIdx >= 0 ? cutIdx + 1 : 0, 0, 'Press Brake');
  }
  const route = routeParts.length > 0 ? routeParts.join(' → ') : '—';
  const routeConfidence = routeFromCost
    ? 'Based on cost analysis'
    : routeFromFg
    ? 'Based on feature analysis'
    : null;

  const topDrivers = [...(cost?.processLines ?? [])].sort((a, b) => b.totalCost - a.totalCost).slice(0, 2);
  const sustainDriver = cost?.sustainability?.co2Contributors?.[0];

  const thicknessSuffix =
    (item.sheetThicknessMm ?? 0) > 0 ? `${item.sheetThicknessMm} mm`
    : (wallNominalMm ?? 0) > 0 ? `${wallNominalMm} mm wall`
    : null;
  const materialLabel =
    [item.materialGrade, thicknessSuffix]
      .filter(Boolean)
      .join(' ') || '—';
  const materialSuffix = !item.materialGrade
    ? '(Not Set)'
    : item.materialSource === 'drawing'
    ? ''
    : thicknessSuffix
    ? ''
    : '(Estimated)';
  const materialRowLabel = isIM
    ? 'Grade & Wall Thickness'
    : isSM
    ? 'Grade & Sheet Thickness'
    : 'Grade';

  return (
    <div>
      <p className="text-[9px] text-muted-foreground/50 px-3 pt-2 pb-1 uppercase tracking-wide">
        Engineering Executive Summary
      </p>

      <Section title="Manufacturing Complexity">
        <div className="flex items-center justify-between py-0.5">
          <span className={`text-xs font-semibold ${complexity.color}`}>{complexity.label}</span>
          {complexityDrivers.length > 0 && (
            <span className="text-[10px] text-muted-foreground">{complexityDrivers.join(', ')}</span>
          )}
        </div>
      </Section>

      <Section title="Material">
        <Row label={materialRowLabel} value={`${materialLabel} ${materialSuffix}`.trim()} />
        {isIM && wallMinMm != null && wallMaxMm != null && wallMinMm > 0 && (
          <Row label="Wall Range (mm)" value={`${wallMinMm} – ${wallMaxMm}`} />
        )}
        {isIM && thinWallViolations > 0 && (
          <Row label="Thin Wall Violations" value={String(thinWallViolations)} />
        )}
        {di?.surface_finish_ra != null && (
          <Row label="Surface Finish" value={`Ra ${di.surface_finish_ra} µm`} />
        )}
        {di?.coating && <Row label="Coating" value={di.coating} />}
        {item.tightestToleranceMm != null && (
          <Row label="Tightest Tolerance" value={`±${item.tightestToleranceMm} mm`} />
        )}
      </Section>

      {cncFeatures ? (
        <CNCFeatureTree
          cncFeatures={cncFeatures}
          selectedKey={selectedCNCFeatureKey ?? null}
          {...(onCNCFeatureSelect ? { onSelect: onCNCFeatureSelect } : {})}
        />
      ) : isIM ? (
        <Section title="Feature Summary">
          {/* Prefer IM-specific through/blind split; fall back to general holeCount */}
          {throughHoleCount > 0 && <Row label="Through Holes" value={String(throughHoleCount)} />}
          {blindFeatureCount > 0 && <Row label="Bosses / Blind Holes" value={String(blindFeatureCount)} />}
          {throughHoleCount === 0 && blindFeatureCount === 0 && holeCount > 0 && (
            <Row label="Holes" value={String(holeCount)} />
          )}
          {ribCount > 0 && <Row label="Ribs" value={String(ribCount)} />}
          {undraftedFaceCount > 0 && <Row label="Undrafted Faces" value={String(undraftedFaceCount)} />}
          {undercutFaceCount > 0 && <Row label="Undercuts" value={String(undercutFaceCount)} />}
          {insertCandidateCount > 0 && <Row label="Insert Candidates" value={String(insertCandidateCount)} />}
          {avgDraftDeg != null && <Row label="Avg Draft Angle" value={`${avgDraftDeg.toFixed(1)}°`} />}
          {holeCount === 0 && ribCount === 0 && undraftedFaceCount === 0 && (
            <p className="text-[10px] text-muted-foreground">Features pending re-analysis.</p>
          )}
        </Section>
      ) : isSM ? (
        <Section title="Feature Summary">
          {holeCount > 0 && <Row label="Holes" value={String(holeCount)} />}
          {bendCount > 0 && <Row label="Bends" value={String(bendCount)} />}
          {(fg?.summary?.cutLengthMm ?? 0) > 0 && (
            <Row label="Cut Length (mm)" value={Math.round(fg!.summary!.cutLengthMm).toLocaleString()} />
          )}
          {(fg?.summary?.pierceCount ?? 0) > 0 && (
            <Row label="Pierces" value={String(fg!.summary!.pierceCount)} />
          )}
          {threadTotal > 0 && (
            <Row label="Threads" value={threads.map((t) => `${t.size} ×${t.count}`).join(', ')} />
          )}
          {holeCount === 0 && bendCount === 0 && (
            <p className="text-[10px] text-muted-foreground">No features extracted yet.</p>
          )}
        </Section>
      ) : (
        <Section title="Feature Summary">
          {holeCount > 0 && <Row label="Holes" value={String(holeCount)} />}
          {bendCount > 0 && <Row label="Bends" value={String(bendCount)} />}
          {threadTotal > 0 && (
            <Row label="Threads" value={threads.map((t) => `${t.size} ×${t.count}`).join(', ')} />
          )}
          {holeCount === 0 && bendCount === 0 && threadTotal === 0 && (
            <p className="text-[10px] text-muted-foreground">No features extracted yet.</p>
          )}
        </Section>
      )}

      <Section title="Manufacturing Route">
        <p className="text-[10px] text-muted-foreground py-0.5">{route}</p>
        {routeConfidence && (
          <p className="text-[9px] text-muted-foreground/50">{routeConfidence}</p>
        )}
      </Section>

      {topDrivers.length > 0 && (
        <Section title="Major Cost Drivers">
          {topDrivers.map((d) => {
            const sym = cost?.currencySymbol ?? '$';
            const isInr = !cost?.currency || cost.currency === 'INR';
            const formatted = isInr
              ? d.totalCost.toLocaleString('en-IN', { maximumFractionDigits: 0 })
              : d.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return (
              <Row
                key={d.process}
                label={d.process}
                value={`${sym}${formatted}`}
              />
            );
          })}
        </Section>
      )}

      {sustainDriver && (
        <Section title="Major Sustainability Driver">
          <Row label={sustainDriver.label} value={`${sustainDriver.pct}% of CO₂`} />
        </Section>
      )}

      <Section title="Production Readiness">
        <div className="flex items-center gap-1.5 py-0.5">
          <span className={readiness.ready ? 'text-green-500' : 'text-yellow-500'}>
            {readiness.ready ? '✓' : '⚠'}
          </span>
          <span className={`text-xs font-medium ${readiness.ready ? 'text-green-500' : 'text-yellow-500'}`}>
            {readiness.label}
          </span>
        </div>
        {flags.length > 0 && (
          <div className="mt-1 space-y-0.5">
            {flags.map((f, i) => (
              <p key={i} className="text-[10px] text-yellow-500/80">⚠ {f}</p>
            ))}
          </div>
        )}
      </Section>

      <Section title="Classification" defaultOpen={false}>
        <Row label="Family" value={familyLabel(item.familyClassification ?? fg?.classification?.family ?? '')} />
        {(() => {
          const conf = fg?.classification?.confidence ?? item.familyConfidence;
          return conf != null
            ? <Row label="Confidence" value={`${Math.round(conf * 100)}%`} />
            : null;
        })()}
      </Section>
    </div>
  );
}

// ── ValidationTab helpers ──────────────────────────────────────────────────────

const ValidationRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline gap-2 py-0.5">
    <span className="text-xs text-muted-foreground flex-1 truncate">{label}</span>
    <span className="text-xs font-medium truncate max-w-[140px]" title={value}>{value}</span>
  </div>
);

// ── BlankDevOptionsDialog ──────────────────────────────────────────────────────

function BlankDevOptionsDialog({
  open, initialConfig, onClose, onSave, saving,
}: {
  open: boolean;
  initialConfig: ValidationConfig;
  onClose: () => void;
  onSave: (cfg: ValidationConfig) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<ValidationConfig>(initialConfig);
  useEffect(() => { if (open) setDraft(initialConfig); }, [open, initialConfig]);

  const RadioSet = ({ label, field, options }: {
    label: string;
    field: keyof Pick<ValidationConfig, 'solverType' | 'surfaceForFlattening'>;
    options: Array<{ value: string; label: string }>;
  }) => (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-semibold text-foreground border-b border-border/40 pb-1 mb-1.5 w-full">
        {label}
      </legend>
      {options.map((opt) => (
        <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
          <input type="radio" name={field} value={opt.value}
            checked={draft[field] === opt.value}
            onChange={() => setDraft((d) => ({ ...d, [field]: opt.value as never }))}
            className="accent-violet-500 h-3.5 w-3.5" />
          <span className="text-xs text-foreground">{opt.label}</span>
        </label>
      ))}
    </fieldset>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm bg-[#2a2a2a] border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Blank Development Options</DialogTitle>
          <p className="text-xs text-muted-foreground">Control how blanks are developed for sheet metal parts.</p>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <RadioSet label="Solver Type" field="solverType" options={[
            { value: 'fea_plastic_elastic', label: 'FEA – Plastic and elastic behaviours considered' },
            { value: 'fea_elastic_only',    label: 'FEA – Only elastic behaviour considered' },
            { value: 'geometric_unfolding', label: 'Geometric Unfolding' },
          ]} />
          <RadioSet label="Surface for Flattening" field="surfaceForFlattening" options={[
            { value: 'mid_surface',  label: 'Mid-Surface' },
            { value: 'larger_area',  label: 'Larger Area Side' },
            { value: 'smaller_area', label: 'Smaller Area Side' },
          ]} />
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-foreground border-b border-border/40 pb-1 mb-1.5 w-full">
              Fill Holes in Blanks
            </legend>
            {([{ v: true, l: 'Yes' }, { v: false, l: 'No' }] as const).map(({ v, l }) => (
              <label key={String(v)} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="fillHolesInBlanks" checked={draft.fillHolesInBlanks === v}
                  onChange={() => setDraft((d) => ({ ...d, fillHolesInBlanks: v }))}
                  className="accent-violet-500 h-3.5 w-3.5" />
                <span className="text-xs text-foreground">{l}</span>
              </label>
            ))}
          </fieldset>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving} className="text-xs">Cancel</Button>
          <Button size="sm" onClick={() => onSave(draft)} disabled={saving}
            className="text-xs bg-violet-600 hover:bg-violet-700 text-white">
            {saving ? 'Saving…' : 'OK'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── ValidationTab ─────────────────────────────────────────────────────────────

function ValidationTab({ fg, item, file3dUrl }: { fg: FeatureGraph | null; item: BOMItem; file3dUrl?: string | null }) {
  const [optionsOpen, setOptionsOpen]     = useState(false);
  const [tolerancesOpen, setTolerancesOpen] = useState(false);
  const [machiningOpen, setMachiningOpen]   = useState(false);
  const updateBOMItem = useUpdateBOMItem();

  const isSheetMetal = (item.sheetThicknessMm ?? 0) > 0;

  const [liveConfig, setLiveConfig] = useState<ValidationConfig>(
    (item.validationConfig as ValidationConfig | null | undefined) ?? DEFAULT_VALIDATION_CONFIG,
  );
  useEffect(() => {
    setLiveConfig((item.validationConfig as ValidationConfig | null | undefined) ?? DEFAULT_VALIDATION_CONFIG);
  }, [item.validationConfig]);

  const kFactor = liveConfig.surfaceForFlattening === 'mid_surface' ? K_FACTOR_MID_SURFACE : null;

  const di = item.drawingIntelligence as Record<string, unknown> | undefined;
  const generalTolerance = (di?.general_tolerances as string | undefined) ?? null;
  const tightestToleranceMm: number | null =
    item.tightestToleranceMm ?? (di?.tightest_tolerance_mm as number | undefined) ?? null;
  const gdtCalloutCount = ((di?.gdt_callouts as unknown[]) ?? []).length;
  const tolerancedHoleCount = ((fg as any)?.summary?.holeGroups ?? []).filter(
    (g: any) => g?.tolerance_class || g?.fit_class,
  ).length;
  const toleranceCount = gdtCalloutCount + tolerancedHoleCount;

  const featureOps: string[] = (() => {
    if (!fg) return [];
    const summary = (fg as any)?.summary ?? {};
    if (isSheetMetal) {
      const ops: string[] = [];
      if ((summary.cutLengthMm ?? 0) > 0) ops.push('Laser Cutting');
      if ((summary.bendCount ?? 0) > 0)   ops.push('Press Brake');
      if ((summary.holeCount ?? 0) > 0)   ops.push('Deburring');
      return ops;
    }
    const cncSummary: Record<string, number> = (fg as any)?.cnc_features?.feature_summary ?? {};
    const ops: string[] = [];
    if ((cncSummary.pockets ?? 0) > 0) ops.push('Milling');
    if ((summary.holeCount ?? 0) > 0)  ops.push('Drilling');
    if ((cncSummary.threads ?? 0) > 0) ops.push('Tapping');
    return ops;
  })();
  const routeSummary = featureOps.length > 0 ? featureOps.join(' → ') : null;
  const surfaceFinishStr = item.surfaceFinishRa != null ? `Ra ${item.surfaceFinishRa} µm` : null;

  const checks = (fg?.validationResults ?? []) as ValidationResult[];
  const score = fg?.manufacturabilityScore;
  const difficulty = fg?.difficultyLevel;

  const severityIcon = (passed: boolean, severity: string) => {
    if (passed)                  return <span className="text-emerald-400 text-sm leading-none">✓</span>;
    if (severity === 'critical') return <span className="text-red-500 text-sm leading-none">✗</span>;
    return                              <span className="text-amber-400 text-sm leading-none">!</span>;
  };

  const difficultyColor = (d?: string) =>
    d === 'easy'      ? 'text-emerald-400 bg-emerald-500/20 border-emerald-500/40' :
    d === 'medium'    ? 'text-amber-400 bg-amber-500/20 border-amber-500/40' :
    d === 'hard'      ? 'text-orange-400 bg-orange-500/20 border-orange-500/40' :
    d === 'very_hard' ? 'text-red-400 bg-red-500/20 border-red-500/40' :
                        'text-muted-foreground bg-muted/30 border-border';

  const handleSaveOptions = (cfg: ValidationConfig) => {
    setLiveConfig(cfg);
    updateBOMItem.mutate(
      { id: item.id, data: { validationConfig: cfg as any } },
      {
        onSuccess: () => { toast.success('Blank development options saved'); setOptionsOpen(false); },
        onError:   () => toast.error('Failed to save options'),
      },
    );
  };

  return (
    <>
      <BlankDevOptionsDialog open={optionsOpen} initialConfig={liveConfig}
        onClose={() => setOptionsOpen(false)} onSave={handleSaveOptions}
        saving={updateBOMItem.isPending} />

      <div className="divide-y divide-border/40">

        {/* Part Envelope — live 3D render with projected dimension arrows */}
        {(file3dUrl || item.maxLength != null || item.maxWidth != null) && (
          <div className="px-3 pt-2 pb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
              Part Envelope
            </span>
            <div className="flex justify-center" style={{ minHeight: 158 }}>
              {file3dUrl && item.file3dPath?.toLowerCase().endsWith('.stl') ? (
                <PartDimensionViewer
                  fileUrl={file3dUrl}
                  maxLength={item.maxLength ?? null}
                  maxWidth={item.maxWidth ?? null}
                  maxHeight={item.maxHeight ?? null}
                />
              ) : (
                /* Fallback: proportional bounding-box rectangle when no model loaded yet */
                (() => {
                  const L = item.maxLength ?? 0;
                  const W = item.maxWidth ?? 0;
                  const D = item.maxHeight ?? 0;
                  if (L === 0 && W === 0) return null;
                  const svgW = 230, svgH = 155;
                  const padT = 10, padL = 10, padB = 44, padR = 82;
                  const areaW = svgW - padL - padR;
                  const areaH = svgH - padT - padB;
                  const s = Math.min(areaW / (L || 1), areaH / (W || 1), 4);
                  const rW = (L || areaW) * s;
                  const rH = (W || areaH) * s;
                  const rx = padL + (areaW - rW) / 2;
                  const ry = padT + (areaH - rH) / 2;
                  const extGap = 5;
                  const arrowY = ry + rH + extGap + 14;
                  const arrowX = rx + rW + extGap + 14;
                  return (
                    <svg width={svgW} height={svgH} style={{ overflow: 'visible' }}>
                      <defs>
                        <marker id="vl-arr-e" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
                          <polygon points="0,0 6,2.5 0,5" fill="#6b7280" />
                        </marker>
                        <marker id="vl-arr-s" markerWidth="6" markerHeight="5" refX="1" refY="2.5" orient="auto-start-reverse">
                          <polygon points="0,0 6,2.5 0,5" fill="#6b7280" />
                        </marker>
                        {isSheetMetal && (
                          <pattern id="vl-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                            <line x1="0" y1="0" x2="0" y2="7" stroke="#3b82f625" strokeWidth="2.5" />
                          </pattern>
                        )}
                      </defs>
                      <rect x={rx} y={ry} width={rW} height={rH} fill={isSheetMetal ? 'url(#vl-hatch)' : '#1e2a3a'} />
                      <rect x={rx} y={ry} width={rW} height={rH} fill="none" stroke="#3b82f6" strokeWidth="1.5" rx="1" />
                      <line x1={rx} y1={ry + rH + extGap} x2={rx} y2={arrowY + 4} stroke="#4b5563" strokeWidth="0.5" />
                      <line x1={rx + rW} y1={ry + rH + extGap} x2={rx + rW} y2={arrowY + 4} stroke="#4b5563" strokeWidth="0.5" />
                      {L > 0 && <>
                        <line x1={rx} y1={arrowY} x2={rx + rW} y2={arrowY} stroke="#6b7280" strokeWidth="0.9" markerStart="url(#vl-arr-s)" markerEnd="url(#vl-arr-e)" />
                        <text x={rx + rW / 2} y={arrowY + 13} textAnchor="middle" fontSize="9.5" fill="#d1d5db" fontFamily="ui-monospace,monospace">{L.toFixed(2)} mm</text>
                      </>}
                      <line x1={rx + rW + extGap} y1={ry} x2={arrowX + 4} y2={ry} stroke="#4b5563" strokeWidth="0.5" />
                      <line x1={rx + rW + extGap} y1={ry + rH} x2={arrowX + 4} y2={ry + rH} stroke="#4b5563" strokeWidth="0.5" />
                      {W > 0 && <>
                        <line x1={arrowX} y1={ry} x2={arrowX} y2={ry + rH} stroke="#6b7280" strokeWidth="0.9" markerStart="url(#vl-arr-s)" markerEnd="url(#vl-arr-e)" />
                        <text x={arrowX + 7} y={ry + rH / 2} textAnchor="start" dominantBaseline="middle" fontSize="9.5" fill="#d1d5db" fontFamily="ui-monospace,monospace">{W.toFixed(2)} mm</text>
                      </>}
                      {D > 0 && <text x={rx + rW} y={ry - 4} textAnchor="end" fontSize="8" fill="#6b7280" fontFamily="ui-monospace,monospace">D: {D.toFixed(2)} mm</text>}
                    </svg>
                  );
                })()
              )}
            </div>
          </div>
        )}

        {/* Score + Difficulty — or prompt to run Auto-Fill */}
        {!fg ? (
          <div className="px-3 py-2 flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="h-4 w-4 opacity-40 shrink-0" />
            <p className="text-xs">Run Auto-Fill to generate DFM validation results.</p>
          </div>
        ) : (
          <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
            {score != null && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                score >= 80 ? 'text-emerald-400 bg-emerald-500/20 border-emerald-500/40'
                : score >= 60 ? 'text-amber-400 bg-amber-500/20 border-amber-500/40'
                : 'text-red-400 bg-red-500/20 border-red-500/40'}`}>
                Score {score}/100
              </span>
            )}
            {difficulty && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded border uppercase ${difficultyColor(difficulty)}`}>
                {difficulty.replace('_', ' ')}
              </span>
            )}
          </div>
        )}

        {/* Blank Development — sheet metal only */}
        {isSheetMetal && (
          <div className="px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Blank Development
              </span>
              <Button variant="ghost" size="sm" onClick={() => setOptionsOpen(true)}
                className="text-[10px] h-5 px-2 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10">
                Options
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px]">
              <span className="text-muted-foreground">Solver</span>
              <span className="text-foreground font-medium truncate">
                {liveConfig.solverType === 'fea_plastic_elastic' ? 'FEA Plastic+Elastic'
                  : liveConfig.solverType === 'fea_elastic_only' ? 'FEA Elastic Only'
                  : 'Geometric Unfolding'}
              </span>
              <span className="text-muted-foreground">Surface</span>
              <span className="text-foreground font-medium">
                {liveConfig.surfaceForFlattening === 'mid_surface' ? 'Mid-Surface'
                  : liveConfig.surfaceForFlattening === 'larger_area' ? 'Larger Area'
                  : 'Smaller Area'}
              </span>
              <span className="text-muted-foreground">Fill Holes</span>
              <span className="text-foreground font-medium">{liveConfig.fillHolesInBlanks ? 'Yes' : 'No'}</span>
              {kFactor != null && (
                <>
                  <span className="text-muted-foreground">K-Factor</span>
                  <span className="text-foreground font-medium">{kFactor} (ANSI)</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Tolerances */}
        <div className="px-3 py-2">
          <div role="button" tabIndex={0} onClick={() => setTolerancesOpen((v) => !v)} onKeyDown={(e) => e.key === 'Enter' && setTolerancesOpen((v) => !v)}
            className="flex items-center gap-1.5 w-full text-left cursor-pointer">
            {tolerancesOpen
              ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
              : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex-1">
              Tolerances
            </span>
            <span className="text-[10px] tabular-nums text-foreground font-medium mr-2">
              {toleranceCount > 0 ? toleranceCount : '—'}
            </span>
            <Button variant="ghost" size="sm"
              onClick={(e) => { e.stopPropagation(); setTolerancesOpen(true); }}
              className="text-[10px] h-5 px-1.5 text-muted-foreground hover:text-foreground">
              Review
            </Button>
          </div>
          {tolerancesOpen && (
            <div className="mt-1.5 space-y-0.5 pl-4">
              <ValidationRow label="General Tolerance" value={generalTolerance ?? '—'} />
              <ValidationRow label="Tightest" value={tightestToleranceMm != null ? `±${tightestToleranceMm} mm` : '—'} />
              {item.toleranceGrade && <ValidationRow label="Grade" value={item.toleranceGrade} />}
            </div>
          )}
        </div>

        {/* Machining / Sheet Metal Details */}
        <div className="px-3 py-2">
          <div role="button" tabIndex={0} onClick={() => setMachiningOpen((v) => !v)} onKeyDown={(e) => e.key === 'Enter' && setMachiningOpen((v) => !v)}
            className="flex items-center gap-1.5 w-full text-left cursor-pointer">
            {machiningOpen
              ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
              : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex-1">
              {isSheetMetal ? 'Sheet Metal Details' : 'Machining Details'}
            </span>
            <Button variant="ghost" size="sm"
              onClick={(e) => { e.stopPropagation(); setMachiningOpen(true); }}
              className="text-[10px] h-5 px-1.5 text-muted-foreground hover:text-foreground">
              Review Setups
            </Button>
          </div>
          {machiningOpen && (
            <div className="mt-1.5 pl-4 space-y-1.5">
              <p className="text-[10px] text-muted-foreground leading-snug">
                Key {isSheetMetal ? 'sheet metal' : 'machining'} assumptions need to be validated
                to ensure outputs are accurate.
              </p>
              <div className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Process Route</span>
                {routeSummary ? (
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs text-foreground flex-1">{routeSummary}</p>
                    <Button variant="ghost" size="sm"
                      className="text-[10px] h-5 px-1.5 text-violet-400 hover:text-violet-300 shrink-0">
                      Edit Routing
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-amber-400">No Machining — upload a 3D model or run Auto-Fill</p>
                )}
              </div>
              {surfaceFinishStr && <ValidationRow label="Surface Finish" value={surfaceFinishStr} />}
              {isSheetMetal && item.sheetThicknessMm != null && (
                <ValidationRow label="Sheet Thickness" value={`${item.sheetThicknessMm} mm`} />
              )}
            </div>
          )}
        </div>

        {/* DFM Checks */}
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1.5">
            <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              DFM Checks ({checks.length})
            </span>
          </div>
          {checks.length === 0 ? (
            <p className="text-xs text-muted-foreground pl-4">No DFM checks available.</p>
          ) : (
            <div className="divide-y divide-border/30 border border-border/40 rounded text-[11px]">
              {checks.map((c) => (
                <div key={c.id} className="px-2 py-1.5 flex items-start gap-2">
                  <span className="shrink-0 mt-0.5 w-3">{severityIcon(c.passed, c.severity)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="font-medium text-foreground">{c.check}</span>
                      {c.threshold && <span className="text-muted-foreground">{c.threshold}</span>}
                      {c.actualValue && <span className="font-mono text-foreground/70">{c.actualValue}</span>}
                    </div>
                    {!c.passed && c.recommendation && (
                      <p className="text-amber-400/80 mt-0.5 leading-snug">{c.recommendation}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </>
  );
}

// ── DesignGuidanceTab ─────────────────────────────────────────────────────────

function DesignGuidanceTab({ fg }: { fg: FeatureGraph | null }) {
  const warnings = (fg?.dfmWarnings ?? []) as DFMWarning[];

  const severityConfig = {
    critical: { icon: '❌', cls: 'border-red-500/30 bg-red-500/10', labelCls: 'text-red-400 bg-red-500/20', textCls: 'text-red-100', mutedCls: 'text-red-300/70', label: 'CRITICAL' },
    warning:  { icon: '⚠️', cls: 'border-amber-500/30 bg-amber-500/10', labelCls: 'text-amber-400 bg-amber-500/20', textCls: 'text-amber-100', mutedCls: 'text-amber-300/70', label: 'WARNING' },
    info:     { icon: 'ℹ️', cls: 'border-blue-500/30 bg-blue-500/10', labelCls: 'text-blue-400 bg-blue-500/20', textCls: 'text-blue-100', mutedCls: 'text-blue-300/70', label: 'INFO' },
  };

  if (!fg) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground p-4">
        <AlertCircle className="h-6 w-6 opacity-30" />
        <p className="text-xs text-center">Run Auto-Fill to generate design guidance.</p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {warnings.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-muted-foreground">
          <span className="text-lg">✅</span>
          <p className="text-xs text-center">No DFM warnings — design looks manufacturable.</p>
        </div>
      ) : (
        warnings.map((w) => {
          const cfg = severityConfig[w.severity] ?? severityConfig.info;
          return (
            <div key={w.id} className={`rounded border p-2 space-y-1 ${cfg.cls}`}>
              <div className="flex items-center gap-1.5">
                <span className="text-sm">{cfg.icon}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${cfg.labelCls}`}>
                  {w.category.replace(/_/g, ' ')}
                </span>
              </div>
              <p className={`text-xs leading-snug ${cfg.textCls}`}>{w.message}</p>
              <p className={`text-[11px] ${cfg.mutedCls}`}>→ {w.recommendation}</p>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── DrawingIntelligenceTab ─────────────────────────────────────────────────────

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const cls =
    pct >= 80 ? 'bg-cyan-500/15 text-cyan-700 border-cyan-500/30' :
    pct >= 50 ? 'bg-blue-500/15 text-blue-700 border-blue-500/30' :
    'bg-amber-500/15 text-amber-700 border-amber-500/30';
  return (
    <span className={`text-[9px] font-semibold px-1 py-0.5 rounded border ${cls} tabular-nums`}>
      {pct}%
    </span>
  );
}

function DrawingIntelligenceTab({ item }: { item: BOMItem }) {
  const di = item.drawingIntelligence;

  if (!di) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 gap-2 text-muted-foreground">
        <AlertCircle className="h-8 w-8 opacity-30" />
        <p className="text-xs text-center">Upload a 2D drawing to extract intelligence.</p>
        <p className="text-[10px] text-center opacity-70">Supports PDF, PNG, JPG</p>
      </div>
    );
  }

  const threads = di.threads ?? [];

  return (
    <div>
      <Section title="Material & Finish">
        {item.materialGrade && (
          <div className="flex items-baseline gap-2 py-0.5">
            <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">Material</span>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs font-medium text-right">{item.materialGrade}</span>
              {item.materialConfidence != null && <ConfidenceBadge value={item.materialConfidence} />}
            </div>
          </div>
        )}
        {(() => {
          const diMaterial = (di as any).material as string | undefined;
          const suggestions = suggestMaterialCandidates(diMaterial, item.sheetThicknessMm, item.coating, item.partName, di.drawing_notes);
          if (!suggestions) return null;
          return (
            <div className="py-0.5 space-y-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-muted-foreground flex-1">Drawing material</span>
                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium shrink-0">Not specified</span>
              </div>
              <div className="pl-0.5 space-y-1.5">
                <p className="text-[9px] uppercase tracking-wide text-muted-foreground/60 font-semibold">Likely candidates</p>
                {suggestions.map((s: MaterialSuggestion, i: number) => (
                  <div key={s.name} className="space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-foreground/90 leading-tight">{s.name}</span>
                      <span className={`text-[9px] font-semibold px-1 py-px rounded shrink-0 ${
                        i === 0
                          ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                          : 'bg-muted/60 text-muted-foreground'
                      }`}>
                        {i === 0 ? 'Recommended' : 'Alternative'}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-snug">{s.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        <Row label="Coating" value={item.coating ?? 'None specified'} />
        <Row label="Heat Treatment" value={item.heatTreatment ?? 'None specified'} />
        {(item.surfaceFinishRa ?? 0) > 0 && (
          <div className="flex items-baseline gap-2 py-0.5">
            <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">Surface Finish</span>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs font-medium text-right">Ra {item.surfaceFinishRa} µm</span>
              {item.surfaceFinishConfidence != null && <ConfidenceBadge value={item.surfaceFinishConfidence} />}
            </div>
          </div>
        )}
        {item.complexity && (
          <div className="flex items-baseline gap-2 py-0.5">
            <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">Complexity</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              item.complexity === 'complex' ? 'bg-red-500/15 text-red-700' :
              item.complexity === 'medium'  ? 'bg-amber-500/15 text-amber-700' :
              'bg-green-500/15 text-green-700'
            }`}>
              {item.complexity.charAt(0).toUpperCase() + item.complexity.slice(1)}
            </span>
          </div>
        )}
      </Section>

      <Section title="Tolerances">
        {di.general_tolerances ? (
          <Row label="General" value={di.general_tolerances} />
        ) : (
          <Row label="General" value="—" />
        )}
        {(item.tightestToleranceMm ?? 0) > 0 && (
          <div className="flex items-baseline gap-2 py-0.5">
            <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">Tightest</span>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs font-medium text-right">±{item.tightestToleranceMm} mm</span>
              {item.toleranceConfidence != null && <ConfidenceBadge value={item.toleranceConfidence} />}
            </div>
          </div>
        )}
      </Section>

      {(() => {
        const hasLowConfidenceThread = threads.some(
          (t) => t.extractionConfidence != null && t.extractionConfidence < 0.85,
        );
        return (
          <Section
            title={
              <>
                {`Threads${threads.length > 0 ? ` (${threads.length})` : ''}`}
                {hasLowConfidenceThread && (
                  <span
                    className="text-[9px] font-medium px-1 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 normal-case tracking-normal"
                    title="One or more thread callouts were extracted with low confidence. Verify against the drawing callout table."
                  >
                    ⚠ Verify
                  </span>
                )}
              </>
            }
          >
            {threads.length === 0 ? (
              <p className="text-[10px] text-muted-foreground py-0.5">None detected</p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-[10px] text-muted-foreground">
                    <th className="text-left font-medium pb-0.5">Size</th>
                    <th className="text-right font-medium pb-0.5">Pitch</th>
                    <th className="text-right font-medium pb-0.5">Qty</th>
                    <th className="text-right font-medium pb-0.5">Tap Drill</th>
                    <th className="text-right font-medium pb-0.5">Fit</th>
                    <th className="text-right font-medium pb-0.5">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {threads.map((t, i) => {
                    const intel = getThreadIntelligence(t.size, t.pitch);
                    return (
                      <tr key={i} className="border-t border-border/40">
                        <td className="py-0.5 font-medium">{t.size}</td>
                        <td className="py-0.5 text-right tabular-nums text-muted-foreground">{t.pitch}</td>
                        <td className="py-0.5 text-right tabular-nums font-medium">{t.count}</td>
                        <td className="py-0.5 text-right tabular-nums text-blue-600 dark:text-blue-400 font-medium">
                          {intel.tapDrillMm != null ? `Ø${intel.tapDrillMm}` : '—'}
                        </td>
                        <td className="py-0.5 text-right text-[10px] text-muted-foreground">{intel.classFit}</td>
                        <td className="py-0.5 text-right text-[10px] text-muted-foreground/60">
                          {t.extractionSource === 'drawing_ai' ? 'AI' : (t.extractionSource ?? '')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>
        );
      })()}

      {(() => {
        const clearanceHoles = (di as any).clearanceHoles as ClearanceHole[] | undefined;
        return (
          <Section title={`Clearance Holes${clearanceHoles?.length ? ` (${clearanceHoles.length})` : ''}`}>
            {!clearanceHoles || clearanceHoles.length === 0 ? (
              <p className="text-[10px] text-muted-foreground py-0.5">None detected</p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-[10px] text-muted-foreground">
                    <th className="text-left font-medium pb-0.5">Ø (mm)</th>
                    <th className="text-right font-medium pb-0.5">Qty</th>
                    <th className="text-right font-medium pb-0.5">Tolerance</th>
                  </tr>
                </thead>
                <tbody>
                  {clearanceHoles.map((h, i) => (
                    <tr key={i} className="border-t border-border/40">
                      <td className="py-0.5 font-medium tabular-nums">Ø{h.diameterMm}</td>
                      <td className="py-0.5 text-right tabular-nums">{h.count}</td>
                      <td className="py-0.5 text-right tabular-nums text-muted-foreground text-[10px]">
                        {h.tolerancePlus != null
                          ? `+${h.tolerancePlus}/${h.toleranceMinus != null ? `-${h.toleranceMinus}` : '—'}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        );
      })()}

      <Section title="Drawing Info" defaultOpen={false}>
        {di.drawing_revision && <Row label="Revision" value={di.drawing_revision} />}
        {di.analyzedAt && (
          <Row
            label="Analyzed"
            value={new Date(di.analyzedAt).toLocaleString(undefined, {
              year: 'numeric', month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          />
        )}
        {(di.drawing_intelligence_confidence ?? 0) > 0 && (
          <div className="flex items-baseline gap-2 py-0.5">
            <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">Extraction confidence</span>
            <ConfidenceBadge value={di.drawing_intelligence_confidence} />
          </div>
        )}
        {di.drawing_notes && (
          <div className="py-0.5">
            <span className="text-[10px] text-muted-foreground block mb-0.5">Notes</span>
            <p className="text-[10px] leading-snug text-foreground/80 whitespace-pre-wrap">{di.drawing_notes}</p>
          </div>
        )}
      </Section>
    </div>
  );
}

// ── NRE Investment constants (INR base; converted at render time via the
// live cost-summary's currencySymbol/inrToDisplayRate — see fmtC in
// InvestmentTab below. No per-country FX table here: the Digital Factory's
// chosen currency and the real exchange_rates-backed conversion are the only
// source, exactly like every other cost figure in this page.) ─────────────

const INV_FIXTURE_NRE: Record<string, number> = {
  cnc_3ax_vmc: 25_000, cnc_4ax_vmc: 45_000, cnc_5ax_mc: 85_000,
  cnc_lathe: 12_000, cnc_lathe_live: 22_000, cnc_mill_turn: 35_000,
};
const INV_SETUP_COUNT: Record<string, number> = {
  cnc_3ax_vmc: 3, cnc_4ax_vmc: 2, cnc_5ax_mc: 1,
  cnc_lathe: 2, cnc_lathe_live: 1, cnc_mill_turn: 1,
};
const INV_TIGHT_TOL_PREMIUM   = 1.5;
const INV_PROG_BASE: Record<string, number> = {
  easy: 8_000, medium: 20_000, hard: 45_000, very_hard: 90_000,
};
const INV_PROG_PER_POCKET     = 500;
const INV_PROG_5AX_ADDER      = 25_000;
const INV_PROG_HOURLY_RATE    = 1_200;
const INV_TOOL_DRILL_SET      = 1_200;
const INV_TOOL_ENDMILL        = 3_000;
const INV_TOOL_CHAMFER        = 2_500;
const INV_TOOL_TAP_SET        = 800;
const INV_TOOL_BORING_BAR     = 8_000;
const INV_INSP_CMM_BASE       = 15_000;
const INV_INSP_CMM_HARD       = 5_000;
const INV_INSP_FAI_RATE       = 400;
const INV_INSP_MIN_PER_FEAT   = 3;
const INV_INSP_GAUGE          = 12_000;
const INV_INSP_PROFILOMETER   = 3_000;

// ── InvestmentTab ──────────────────────────────────────────────────────────────

function InvestmentTab({
  item, fg, batchSize, productionLife, factory,
}: {
  item: BOMItem; fg: FeatureGraph | null;
  batchSize: number; productionLife: number; factory: string;
}) {
  const { data: cost } = useCostSummary(item.id, batchSize, factory);

  const cncSummary: Record<string, number> = (fg as any)?.cnc_features?.feature_summary ?? {};
  const holeGroups   = fg?.summary?.holeGroups ?? [];
  const threads      = item.drawingIntelligence?.threads ?? [];
  const difficulty   = fg?.difficultyLevel ?? 'medium';
  const tightestTolMm =
    item.tightestToleranceMm ?? item.drawingIntelligence?.tightest_tolerance_mm ?? null;
  const surfaceRa =
    item.surfaceFinishRa ?? item.drawingIntelligence?.surface_finish_ra ?? null;
  const isTightTol = tightestTolMm != null && tightestTolMm <= 0.05;

  const machineClass =
    cost?.processLines?.find((l) => l.machineClass?.startsWith('cnc_'))?.machineClass
    ?? 'cnc_3ax_vmc';

  const pocketCount       = cncSummary['pocket']       ?? 0;
  const chamferCount      = cncSummary['chamfer']      ?? 0;
  const countersinkCount  = cncSummary['countersink']  ?? 0;
  const uniqueDrillDiams  = holeGroups.length || ((fg?.summary?.holeCount ?? 0) > 0 ? 3 : 0);
  const uniqueThreadSizes = new Set(threads.map((t) => t.size)).size;

  if (!fg) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground p-4">
        <AlertCircle className="h-6 w-6 opacity-30" />
        <p className="text-xs text-center">Run Auto-Fill to see investment estimate.</p>
      </div>
    );
  }

  // Symbol + FX come from this Digital Factory's live cost-summary — never a
  // per-country constant — so a location this tab has never seen before still
  // renders correctly the moment the scenario/exchange_rates table knows it.
  if (!cost?.currencySymbol || cost.inrToDisplayRate == null) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground p-4">
        <Loader2 className="h-5 w-5 animate-spin opacity-40" />
        <p className="text-xs text-center">Loading {factory} rates…</p>
      </div>
    );
  }
  const invSymbol = cost.currencySymbol;
  const invInrRate = cost.inrToDisplayRate;
  const fmtC = (inr: number, dec = 0) =>
    `${invSymbol}${(inr * invInrRate).toLocaleString(undefined, {
      minimumFractionDigits: dec, maximumFractionDigits: dec,
    })}`;

  // ── Fixture ──
  const fixtureBase   = INV_FIXTURE_NRE[machineClass] ?? 25_000;
  const fixtureSetups = INV_SETUP_COUNT[machineClass] ?? 3;
  const fixtureTotal  = fixtureBase * fixtureSetups * (isTightTol ? INV_TIGHT_TOL_PREMIUM : 1);

  // ── Programming ──
  const progBase = (INV_PROG_BASE[difficulty] ?? INV_PROG_BASE['medium'])!;
  const progPockets = pocketCount * INV_PROG_PER_POCKET;
  const prog5ax = machineClass === 'cnc_5ax_mc' ? INV_PROG_5AX_ADDER : 0;
  const progTotal = progBase + progPockets + prog5ax;
  const progHours   = Math.round(progTotal / INV_PROG_HOURLY_RATE);

  // ── Tools ──
  const toolDrills   = uniqueDrillDiams * INV_TOOL_DRILL_SET;
  const roughMills   = pocketCount > 0 ? Math.ceil(pocketCount / 5) : 0;
  const finishMills  = pocketCount > 0 ? Math.ceil(pocketCount / 3) : 0;
  const toolEndmills = (roughMills + finishMills) * INV_TOOL_ENDMILL;
  const toolChamfer  = (chamferCount + countersinkCount) > 0 ? INV_TOOL_CHAMFER : 0;
  const toolTaps     = uniqueThreadSizes * INV_TOOL_TAP_SET;
  const toolBoring   = isTightTol ? INV_TOOL_BORING_BAR : 0;
  const toolTotal    = toolDrills + toolEndmills + toolChamfer + toolTaps + toolBoring;

  // ── Inspection ──
  const cmmProg       = INV_INSP_CMM_BASE + (difficulty === 'very_hard' ? INV_INSP_CMM_HARD : 0);
  const totalFeats    = Object.values(cncSummary).reduce((s, v) => s + v, 0) || (fg.summary?.holeCount ?? 0);
  const faiHours      = (totalFeats * INV_INSP_MIN_PER_FEAT) / 60;
  const faiCost       = faiHours * INV_INSP_FAI_RATE;
  const needsGauge    = isTightTol || (surfaceRa != null && surfaceRa <= 0.8)
    || ['H6', 'H7', 'g6', 'f7'].includes(item.toleranceGrade ?? '');
  const criticalFeats = needsGauge
    ? Math.max(1, uniqueThreadSizes + Math.ceil(uniqueDrillDiams / 2))
    : 0;
  const gaugeNRE      = criticalFeats * INV_INSP_GAUGE;
  const profNRE       = surfaceRa != null ? INV_INSP_PROFILOMETER : 0;
  const inspTotal     = cmmProg + faiCost + gaugeNRE + profNRE;

  // ── Summary ──
  const totalNRE         = fixtureTotal + progTotal + toolTotal + inspTotal;
  const lifetimeVol      = (item.annualVolume ?? 0) * productionLife;
  const amortizedPerUnit = lifetimeVol > 0 ? totalNRE / lifetimeVol : null;
  const amortizedPct     =
    amortizedPerUnit != null && (cost?.totalCost ?? 0) > 0
      ? (amortizedPerUnit / cost!.totalCost) * 100
      : null;

  // Local row helpers
  const InvRow = ({
    label, sub, value, warn = false, indent = 0,
  }: {
    label: ReactNode; sub?: ReactNode;
    value?: string; warn?: boolean; indent?: number;
  }) => (
    <div className={cn(
      'flex items-baseline justify-between py-2 border-b border-border/20 last:border-0',
      indent === 1 && 'pl-5',
      indent === 2 && 'pl-9',
    )}>
      <div className="flex-1 min-w-0 pr-4">
        <span className="text-sm text-foreground">{label}</span>
        {warn && <span className="text-sm text-amber-500 ml-1">⚠</span>}
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </div>
      {value !== undefined && (
        <span className="text-sm tabular-nums text-foreground shrink-0">{value}</span>
      )}
    </div>
  );

  const InvSection = ({ label }: { label: string }) => (
    <div className="pt-4 pb-1">
      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
    </div>
  );

  const InvTotal = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="flex items-baseline justify-between py-2.5 border-t border-border mt-1">
      <div>
        <span className="text-sm font-bold text-foreground">{label}</span>
        {sub && <span className="text-xs text-muted-foreground ml-2">{sub}</span>}
      </div>
      <span className="text-sm font-bold tabular-nums text-foreground shrink-0">{value}</span>
    </div>
  );

  return (
    <div className="px-4 pb-6">

      {/* Grand Total Header */}
      <div className="flex items-start justify-between pt-3 pb-2 border-b-2 border-border">
        <div>
          <p className="text-sm font-bold text-foreground">Total NRE Investment</p>
          <p className="text-xs text-muted-foreground mt-0.5">One-time · pre-production</p>
        </div>
        <div className="text-right shrink-0 ml-4">
          <p className="text-2xl font-bold tabular-nums leading-tight text-foreground">
            {fmtC(totalNRE)}
          </p>
        </div>
      </div>

      {/* Section 1: Fixture */}
      <InvSection label="Fixture & Work-Holding" />
      <InvRow
        indent={1}
        label={`Fixture design & fab · ${machineClass.replace(/_/g, ' ').toUpperCase()}`}
        sub={`${fixtureSetups} setup${fixtureSetups > 1 ? 's' : ''} × ${fmtC(fixtureBase)} each`}
        value={fmtC(fixtureBase * fixtureSetups)}
      />
      {isTightTol && (
        <InvRow
          indent={1}
          label="Tight tolerance premium (+50%)"
          sub={`Tolerance ≤ 0.05 mm — precision datum & locating required`}
          value={fmtC(fixtureBase * fixtureSetups * 0.5)}
          warn
        />
      )}
      <InvTotal label="Total Fixture Investment" value={fmtC(fixtureTotal)} />

      {/* Section 2: Programming */}
      <InvSection label="CNC Programming" />
      <InvRow
        indent={1}
        label={`Programming base · ${difficulty.replace('_', ' ')}`}
        sub={`~${Math.round(progBase / INV_PROG_HOURLY_RATE)} hr @ ${fmtC(INV_PROG_HOURLY_RATE)}/hr`}
        value={fmtC(progBase)}
        warn={difficulty === 'hard' || difficulty === 'very_hard'}
      />
      {pocketCount > 0 && (
        <InvRow
          indent={1}
          label={`Pocket toolpath generation (${pocketCount} pockets)`}
          sub="Rough + finish pass per pocket"
          value={fmtC(progPockets)}
        />
      )}
      {prog5ax > 0 && (
        <InvRow
          indent={1}
          label="5-axis multi-axis strategy"
          sub="Simultaneous 5-axis CAM setup and validation"
          value={fmtC(prog5ax)}
          warn
        />
      )}
      <InvTotal
        label="Total Programming"
        value={fmtC(progTotal)}
        sub={`~${progHours} programmer hours`}
      />

      {/* Section 3: Cutting Tools */}
      <InvSection label="Cutting Tool Investment" />
      {uniqueDrillDiams > 0 && (
        <InvRow
          indent={1}
          label={`Drill sets (${uniqueDrillDiams} unique diameters)`}
          sub="3 drills per diameter: roughing, semi-finish, finish/reserve"
          value={fmtC(toolDrills)}
        />
      )}
      {pocketCount > 0 && (
        <InvRow
          indent={1}
          label={`End mills (${roughMills} roughing + ${finishMills} finishing)`}
          sub={`${pocketCount} pockets · 1 rougher/5 pockets, 1 finisher/3 pockets`}
          value={fmtC(toolEndmills)}
        />
      )}
      {toolChamfer > 0 && (
        <InvRow
          indent={1}
          label={`Chamfer mill (${chamferCount + countersinkCount} chamfers/countersinks)`}
          value={fmtC(toolChamfer)}
        />
      )}
      {uniqueThreadSizes > 0 && (
        <InvRow
          indent={1}
          label={`Tap sets (${uniqueThreadSizes} thread size${uniqueThreadSizes > 1 ? 's' : ''})`}
          sub={threads.map((t) => t.size).join(', ')}
          value={fmtC(toolTaps)}
        />
      )}
      {toolBoring > 0 && (
        <InvRow
          indent={1}
          label="Boring bar / precision reamer"
          sub="Required for hole tolerances ≤ 0.05 mm"
          value={fmtC(toolBoring)}
          warn
        />
      )}
      <InvTotal label="Total Cutting Tools" value={fmtC(toolTotal)} />

      {/* Section 4: Inspection */}
      <InvSection label="Inspection & Gauging" />
      <InvRow
        indent={1}
        label="CMM programming"
        sub={difficulty === 'very_hard' ? 'Complex part — extended CMM program' : 'Standard CMM program'}
        value={fmtC(cmmProg)}
      />
      <InvRow
        indent={1}
        label={`First article inspection (${totalFeats} features)`}
        sub={`~${Math.ceil(faiHours * 60)} min @ ${fmtC(INV_INSP_FAI_RATE)}/hr`}
        value={fmtC(faiCost)}
      />
      {needsGauge && (
        <InvRow
          indent={1}
          label={`Custom gauges (${criticalFeats} critical feature${criticalFeats > 1 ? 's' : ''})`}
          sub={[
            isTightTol ? 'Tight tolerance ≤ 0.05 mm' : '',
            surfaceRa != null && surfaceRa <= 0.8 ? `Fine Ra ${surfaceRa} μm` : '',
          ].filter(Boolean).join(' · ')}
          value={fmtC(gaugeNRE)}
          warn
        />
      )}
      {profNRE > 0 && (
        <InvRow
          indent={1}
          label={`Surface profilometer${surfaceRa != null ? ` (Ra ${surfaceRa} μm)` : ''}`}
          value={fmtC(profNRE)}
        />
      )}
      <InvTotal label="Total Inspection" value={fmtC(inspTotal)} />

      {/* NRE Summary recap */}
      <InvSection label="NRE Summary" />
      <InvRow label="Fixture & Work-Holding" value={fmtC(fixtureTotal)} />
      <InvRow label="CNC Programming"        value={fmtC(progTotal)} />
      <InvRow label="Cutting Tools"          value={fmtC(toolTotal)} />
      <InvRow label="Inspection & Gauging"   value={fmtC(inspTotal)} />
      <div className="flex items-baseline justify-between pt-3 mt-1 border-t-2 border-border">
        <span className="text-base font-bold text-foreground">Total NRE Investment</span>
        <span className="text-xl font-bold tabular-nums text-foreground">{fmtC(totalNRE)}</span>
      </div>

      {/* Amortization */}
      {lifetimeVol > 0 && (
        <>
          <InvSection label="Amortization" />
          <InvRow
            label="Lifetime volume"
            sub={`${(item.annualVolume ?? 0).toLocaleString('en-IN')} pcs/yr × ${productionLife} yr`}
            value={lifetimeVol.toLocaleString('en-IN') + ' pcs'}
          />
          {amortizedPerUnit != null && (
            <InvRow
              label="Amortized NRE / unit"
              value={fmtC(amortizedPerUnit, 2)}
            />
          )}
          {amortizedPct != null && (
            <InvRow
              label="NRE as % of part cost"
              sub={`Part cost: ${fmtC(cost!.totalCost, 2)}`}
              value={`${amortizedPct.toFixed(1)}%`}
            />
          )}
        </>
      )}

      <p className="text-[10px] text-muted-foreground/50 pt-4 leading-relaxed">
        NRE estimates based on industry benchmarks for {factory || 'India'} market.
        Fixture and tooling are one-time investments; programming and CMM costs
        recur on engineering change orders.
      </p>
    </div>
  );
}

// ── BlankStockSection ─────────────────────────────────────────────────────────

function BlankStockSection({ blank, currencySymbol }: { blank: BlankSpecDto; currencySymbol: string }) {
  const FORM_LABELS: Record<string, string> = {
    sheet: 'Sheet', round_bar: 'Round Bar', hex_bar: 'Hex Bar',
    rectangular_bar: 'Rect Bar', billet: 'Billet',
    extrusion: 'Extrusion', casting: 'Casting', granules: 'Granules',
  };
  const label = FORM_LABELS[blank.form] ?? blank.form;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium font-mono">{blank.sizeLabel}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/40 text-muted-foreground">{label}</span>
      </div>
      <Row label="Gross weight" value={`${blank.grossWeightKg.toFixed(3)} kg`} />
      <Row label="Net weight" value={`${blank.netWeightKg.toFixed(3)} kg`} />
      <div className="flex items-center gap-2 py-0.5">
        <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">Utilization</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${blank.utilizationPct >= 75 ? 'bg-emerald-500' : blank.utilizationPct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(100, blank.utilizationPct)}%` }}
            />
          </div>
          <span className="text-xs text-right tabular-nums">{blank.utilizationPct.toFixed(1)}%</span>
        </div>
      </div>
      {blank.wasteKg > 0 && (
        <Row label="Chipscrap" value={`${blank.wasteKg.toFixed(3)} kg · ${currencySymbol}${blank.wasteCost.toFixed(0)}`} />
      )}
    </div>
  );
}

// ── AnalysisTabsPanel (Right) ──────────────────────────────────────────────────

function AnalysisTabsPanel({
  projectId,
  item, fg, batchSize, productionLife, factory, selectedCNCFeatureKey, onCNCFeatureSelect,
  file3dUrl, activeTab, onTabChange, treeProcessNames, vendorHotspotContext,
  onSelectHighlight,
}: {
  projectId: string;
  item: BOMItem; fg: FeatureGraph | null;
  batchSize: number; productionLife: number; factory: string;
  selectedCNCFeatureKey?: string | null;
  onCNCFeatureSelect?: (key: string | null) => void;
  file3dUrl?: string | null;
  activeTab: RightTabKey;
  onTabChange: (tab: RightTabKey) => void;
  treeProcessNames: string[];
  vendorHotspotContext: { layer: HeatmapLayerType; riskLevel: string } | null;
  onSelectHighlight?: (node: FeatureNodeV2 | null) => void;
}) {
  const tab = activeTab;
  const setTab = onTabChange;
  const cls = fg?.classification;
  const cncSummary: Record<string, number> | null = (fg as any)?.cnc_features?.feature_summary ?? null;
  const lifetimeVol = (item.annualVolume ?? 0) * productionLife;
  // Same fix as SustainabilityTab — omitting location silently defaulted to
  // 'USA' (useCostSummary's own fallback), running a second, wasted full
  // cost computation on every load/Apply regardless of the real Digital
  // Factory. `factory` is already a real prop on this component.
  const { data: summaryForPartTab } = useCostSummary(item.id, batchSize, factory);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar — wraps to 2 rows so all tabs stay visible at any panel width */}
      <div className="flex flex-wrap border-b shrink-0 bg-muted/20">
        {RIGHT_TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-2.5 py-1.5 text-[11px] font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === key ? 'border-violet-500 text-violet-600 dark:text-violet-400 bg-background' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
            }`}>{label}</button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {tab === 'part_summary' && (
          <>
            {cls && (
              <Section title="Classification">
                <div className="flex items-center justify-between pb-1">
                  <code className="text-[11px] font-semibold font-mono tracking-tight">{familyLabel(cls.family)}</code>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${confidenceCls(cls.confidence ?? 0)}`}>
                    {cls.confidence != null ? `${Math.round(cls.confidence * 100)}%` : '—'}
                  </span>
                </div>
                {cncSummary ? (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {Object.entries(cncSummary)
                      .filter(([, count]) => count > 0)
                      .map(([type, count]) => (
                        <span key={type} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
                          {count} {type.replace(/_/g, ' ')}
                        </span>
                      ))}
                  </div>
                ) : cls.signals?.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {cls.signals.map((s, i) => (
                      <span key={i} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{s}</span>
                    ))}
                  </div>
                )}
                {cls.classificationSignals && (
                  <div className="mt-2 divide-y divide-border/30">
                    {(['flatness', 'hole_count', 'planar_face_fraction', 'cyl_axis_alignment', 'rotational_face_ratio'] as const)
                      .filter((k) => cls.classificationSignals![k] != null)
                      .map((k) => {
                        const val = cls.classificationSignals![k];
                        const display = k === 'planar_face_fraction' || k === 'cyl_axis_alignment' || k === 'rotational_face_ratio' || k === 'flatness'
                          ? `${(Number(val) * 100).toFixed(0)}%`
                          : String(val);
                        const label = k === 'flatness' ? 'Flatness' : k === 'hole_count' ? 'Hole Count' : k === 'planar_face_fraction' ? 'Planar Faces' : k === 'cyl_axis_alignment' ? 'Cyl Alignment' : 'Rot Ratio';
                        return (
                          <div key={k} className="flex items-baseline py-0.5 gap-2">
                            <span className="text-[9px] text-muted-foreground w-20 shrink-0">{label}</span>
                            <span className="text-[10px] font-mono tabular-nums">{display}</span>
                          </div>
                        );
                      })}
                    {cls.classificationReasons?.map((r, i) => (
                      <p key={i} className="text-[9px] text-muted-foreground pt-1 leading-relaxed">{r}</p>
                    ))}
                    {cls.classificationSignals.classification_version && (
                      <p className="text-[9px] text-muted-foreground/50 pt-0.5">v{cls.classificationSignals.classification_version}</p>
                    )}
                  </div>
                )}
              </Section>
            )}
            <Section title="Part Geometry">
              {(() => {
                const finishKg = item.weight ?? null;
                const roughKg = summaryForPartTab?.materialRemoval?.billetWeightKg ?? (() => {
                  if (finishKg == null) return null;
                  const fam: string = fg?.classification?.family ?? '';
                  if (fam === 'cnc_turned') return finishKg * 2.5;
                  if (fam === 'mill_turn')  return finishKg * 2.0;
                  if (fam === 'cnc_milled') return finishKg * 1.5;
                  if (fam === 'sheet_metal') return finishKg;
                  return finishKg * 1.1;
                })();
                return (
                  <>
                    <Row label="Rough Mass (kg)" value={roughKg != null ? fmt(roughKg, 3) : '—'} />
                    <Row label="Finish Mass (kg)" value={finishKg != null ? fmt(finishKg, 3) : '—'} />
                  </>
                );
              })()}
              <Row label="Length (mm)" value={item.maxLength != null ? fmt(item.maxLength, 1) : '—'} />
              <Row label="Width (mm)" value={item.maxWidth != null ? fmt(item.maxWidth, 1) : '—'} />
              <Row label="Height (mm)" value={item.maxHeight != null ? fmt(item.maxHeight, 1) : '—'} />
              <Row label="Surface Area (mm²)" value={item.surfaceArea != null ? fmtInt(item.surfaceArea) : '—'} />
              <Row label="Volume (mm³)" value={item.volume != null ? fmtInt(item.volume) : '—'} />
            </Section>
            <Section title="Factory / Production">
              <Row label="Primary" value={factory} />
              <Row label="Secondary" value="n/a" />
              <Row label="Toolshop" value="n/a" />
              <Row label="Annual Volume" value={fmtInt(item.annualVolume ?? 0)} />
              <Row label="Batch Size" value={fmtInt(batchSize)} />
              <Row label="Production Life" value={`${productionLife} yr`} />
              <Row label="Lifetime Volume" value={fmtInt(lifetimeVol)} />
            </Section>
          </>
        )}

        {tab === 'cost' && (
          <CostSummaryTab item={item} batchSize={batchSize} factory={factory} fg={fg} onSelectHighlight={onSelectHighlight} />
        )}

        {tab === 'validation' && item && (
          <ValidationTab fg={fg} item={item} file3dUrl={file3dUrl ?? null} />
        )}


        {tab === 'sustainability' && (
          <SustainabilityTab item={item} batchSize={batchSize} factory={factory} />
        )}

        {tab === 'detail' && (
          <PartDetailTab
            item={item}
            batchSize={batchSize}
            factory={factory}
            selectedCNCFeatureKey={selectedCNCFeatureKey ?? null}
            {...(onCNCFeatureSelect ? { onCNCFeatureSelect } : {})}
          />
        )}

        {tab === 'investment' && (
          <InvestmentTab
            item={item}
            fg={fg}
            batchSize={batchSize}
            productionLife={productionLife}
            factory={factory}
          />
        )}

        {tab === 'copilot' && (
          <CopilotPanel
            item={item}
            fg={fg}
            batchSize={batchSize}
            productionLife={productionLife}
            factory={factory}
            activeTab={tab}
          />
        )}

        {tab === 'vendor_network' && (
          <VendorNetworkPanel
            projectId={projectId}
            itemId={item.id}
            itemName={item.name ?? 'Part'}
            batchSize={batchSize}
            processNames={treeProcessNames}
            {...(item?.materialGrade ? { material: item.materialGrade } : {})}
            {...(vendorHotspotContext ? { hotspotContext: vendorHotspotContext } : {})}
          />
        )}

        {tab !== 'part_summary' && tab !== 'cost' && tab !== 'validation' && tab !== 'sustainability' && tab !== 'detail' && tab !== 'investment' && tab !== 'copilot' && tab !== 'vendor_network' && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground p-4">
            <AlertCircle className="h-6 w-6 opacity-30" />
            <p className="text-xs text-center">{RIGHT_TABS.find((t) => t.key === tab)?.label} coming in Phase 2.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ProcessTreePanel ───────────────────────────────────────────────────────────

function ProcessTreePanel({
  item, fg, tree, expanded, selectedId, onToggle, onSelect, factory, maximized, onMaximize,
}: {
  item: BOMItem; fg: FeatureGraph | null; tree: ProcessTreeNode;
  expanded: Set<string>; selectedId: string | null;
  onToggle: (id: string) => void; onSelect: (node: ProcessTreeNode) => void;
  factory: string; maximized: PanelId | null; onMaximize: (id: PanelId | null) => void;
}) {
  const family = resolveDisplayFamily(item, fg);
  const groupLabel = FAMILY_GROUP[family] ?? 'Manufacturing';
  const UNSPEC_MAT = new Set(['Unknown', 'Not specified', 'Not Specified', 'None', '']);
  const diMat = item.drawingIntelligence?.material;
  const material =
    item.materialGrade ??
    item.material ??
    (diMat && !UNSPEC_MAT.has(diMat.trim()) ? `${diMat} [DRAWING]` : null) ??
    '—';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PanelHeader title="Manufacturing Process" panelId="process" maximized={maximized} onMaximize={onMaximize}>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground overflow-hidden">
          <span className="hover:text-foreground cursor-pointer shrink-0">Edit ▾</span>
          <span className="hover:text-foreground cursor-pointer shrink-0">View ▾</span>
          <span className="text-border shrink-0">│</span>
          <span className="truncate">Primary: {groupLabel} │ Material: {material} ({factory})</span>
        </div>
      </PanelHeader>

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-xs border-collapse table-fixed">
          <colgroup>
            <col style={{ width: '20px' }} />
            <col />
            <col style={{ width: '112px' }} />
            <col style={{ width: '160px' }} />
          </colgroup>
          <thead className="sticky top-0 bg-muted/70 z-10">
            <tr>
              <th className="px-2 py-1.5 border-b" />
              <th className="text-left px-2 py-1.5 border-b font-semibold text-muted-foreground text-[11px]">Process Step</th>
              <th className="text-left px-2 py-1.5 border-b font-semibold text-muted-foreground text-[11px]">Digital Factory</th>
              <th className="text-left px-2 py-1.5 border-b font-semibold text-muted-foreground text-[11px]">Machine</th>
            </tr>
          </thead>
          <tbody>
            <TreeRow node={tree} depth={0} expanded={expanded} selectedId={selectedId}
              onToggle={onToggle} onSelect={onSelect} factory={factory} />
          </tbody>
        </table>
        {!fg && (
          <p className="text-xs text-muted-foreground text-center py-4 px-3">
            Run Auto-Fill to populate the manufacturing process tree.
          </p>
        )}
      </div>
    </div>
  );
}

// ── FeatureMetadata ────────────────────────────────────────────────────────────

interface FeatureMetadata {
  label: string;
  headline: string;
  process: string;
  dimensions: Array<{ label: string; value: string }>;
  location?: HoleGroupLocation;
  /** Per-instance occurrence data from Feature Graph v2. Takes precedence over location for display. */
  v2Feature?: FeatureNodeV2;
  whyItMatters: string;
  risks: string[];
  dfmWarnings: DFMWarning[];
}

function severityClass(s: DFMSeverity): string {
  return s === 'critical'
    ? 'bg-red-500/10 text-red-400'
    : s === 'warning'
    ? 'bg-yellow-500/10 text-yellow-400'
    : 'bg-blue-500/10 text-blue-400';
}

// Categories semantically linked to each feature type — used as fallback when
// the CAD engine hasn't populated featureRef on individual warnings.
const BEND_DFM_CATEGORIES = new Set(['sharp_corner', 'fillet', 'thin_wall']);
const HOLE_DFM_CATEGORIES = new Set(['deep_pocket', 'undercut']);

function matchWarnings(warnings: DFMWarning[], featureId: string | undefined, fallbackCategories: Set<string>): DFMWarning[] {
  const byRef = featureId ? warnings.filter((w) => w.featureRef === featureId) : [];
  if (byRef.length > 0) return byRef;
  // CAD engine didn't set featureRef — surface all category-relevant warnings
  return warnings.filter((w) => !w.featureRef && fallbackCategories.has(w.category));
}

function buildFeatureMetadata(
  holeGroup: HoleGroup | null,
  bend: BendFeature | null,
  dfmWarnings: DFMWarning[],
  v2Feature?: FeatureNodeV2,
): FeatureMetadata | null {
  if (holeGroup) {
    return {
      label: 'Hole Group',
      headline: `Ø${holeGroup.diameter_mm.toFixed(1)} mm × ${holeGroup.count}`,
      process: 'Laser Pierce',
      dimensions: [
        { label: 'Diameter', value: `${holeGroup.diameter_mm.toFixed(1)} mm` },
        { label: 'Count', value: String(holeGroup.count) },
      ],
      ...(holeGroup.location && { location: holeGroup.location }),
      ...(v2Feature && { v2Feature }),
      whyItMatters:
        `Each of the ${holeGroup.count} pierces adds laser pause time and heat input. ` +
        `At Ø${holeGroup.diameter_mm.toFixed(1)} mm, pierce tip wear and heat-affected zone ` +
        `size are the primary quality risks. Consolidating holes or adjusting spacing can ` +
        `reduce cycle time and improve edge quality.`,
      risks: ['Burr formation', 'Heat-affected zone', 'Tool wear'],
      dfmWarnings: matchWarnings(dfmWarnings, holeGroup.id, HOLE_DFM_CATEGORIES),
    };
  }

  if (bend) {
    const count = bend.recognition.count;
    const radius = bend.recognition.radius_mm ?? 0;
    return {
      label: 'Bend',
      headline: `R${radius.toFixed(1)} mm × ${count}`,
      process: 'Press Brake',
      dimensions: [
        { label: 'Bend Radius', value: `${radius.toFixed(1)} mm` },
        { label: 'Count', value: String(count) },
      ],
      ...(v2Feature && { v2Feature }),
      whyItMatters:
        `Press brake bends add cycle time proportional to count and require setup changeovers ` +
        `for each unique bend radius. At R${radius.toFixed(1)} mm, verify the inner radius is ` +
        `≥ material thickness to avoid cracking. Grouping bends of the same radius minimises ` +
        `die changes and reduces setup cost.`,
      risks: ['Cracking', 'Springback', 'Tool collision'],
      dfmWarnings: matchWarnings(dfmWarnings, bend.id, BEND_DFM_CATEGORIES),
    };
  }

  return null;
}

// ── FeatureDetailPanel ─────────────────────────────────────────────────────────

function FeatureDetailPanel({ metadata }: { metadata: FeatureMetadata | null }) {
  if (!metadata) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4 text-center">
        Click a feature in the tree to inspect it
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5 overflow-y-auto h-full">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{metadata.label}</p>
        <p className="text-base font-semibold">{metadata.headline}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{metadata.process}</p>
      </div>

      <section>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {metadata.dimensions.map(({ label, value }) => (
            <Fragment key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-xs font-medium tabular-nums">{value}</dd>
            </Fragment>
          ))}
        </dl>
      </section>

      {/* Feature Graph v2: per-instance occurrence data */}
      {metadata.v2Feature && (
        <section>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Occurrences</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <dt className="text-xs text-muted-foreground">Count</dt>
            <dd className="text-xs font-medium tabular-nums">
              {metadata.v2Feature.occurrences.length} instances · centroid data available
            </dd>
            {metadata.v2Feature.bbox_centered && (
              <>
                <dt className="text-xs text-muted-foreground">Spread X</dt>
                <dd className="text-xs font-medium tabular-nums">
                  {fmt(metadata.v2Feature.bbox_centered.x_min, 1)} → {fmt(metadata.v2Feature.bbox_centered.x_max, 1)} mm
                  <span className="text-muted-foreground ml-1">
                    ({fmt(metadata.v2Feature.bbox_centered.x_max - metadata.v2Feature.bbox_centered.x_min, 1)} mm range)
                  </span>
                </dd>
                <dt className="text-xs text-muted-foreground">Spread Y</dt>
                <dd className="text-xs font-medium tabular-nums">
                  {fmt(metadata.v2Feature.bbox_centered.y_min, 1)} → {fmt(metadata.v2Feature.bbox_centered.y_max, 1)} mm
                  <span className="text-muted-foreground ml-1">
                    ({fmt(metadata.v2Feature.bbox_centered.y_max - metadata.v2Feature.bbox_centered.y_min, 1)} mm range)
                  </span>
                </dd>
              </>
            )}
          </dl>
        </section>
      )}

      {/* Legacy location fallback — shown only when Feature Graph v2 is not yet available */}
      {!metadata.v2Feature && metadata.location && (
        <section>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Location</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <dt className="text-xs text-muted-foreground">Region</dt>
            <dd className="text-xs font-medium">{metadata.location.manufacturing_region}</dd>
            <dt className="text-xs text-muted-foreground">Face Type</dt>
            <dd className="text-xs font-medium capitalize">{metadata.location.face_type}</dd>
            <dt className="text-xs text-muted-foreground">Occurrences</dt>
            <dd className="text-xs font-medium tabular-nums">{metadata.dimensions.find(d => d.label === 'Count')?.value}</dd>
            <dt className="text-xs text-muted-foreground">Bounding Region</dt>
            <dd className="text-xs font-medium tabular-nums">
              X {metadata.location.bbox.x_min}–{metadata.location.bbox.x_max} mm
            </dd>
            <dt className="text-xs text-muted-foreground" />
            <dd className="text-xs font-medium tabular-nums">
              Y {metadata.location.bbox.y_min}–{metadata.location.bbox.y_max} mm
            </dd>
          </dl>
        </section>
      )}

      <section>
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Why This Matters</p>
        <p className="text-sm text-foreground/80 leading-relaxed">{metadata.whyItMatters}</p>
      </section>

      {metadata.risks.length > 0 && (
        <section>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Manufacturing Risks</p>
          <ul className="space-y-0.5">
            {metadata.risks.map((r) => (
              <li key={r} className="flex items-center gap-2 text-sm text-foreground/80">
                <span className="w-1 h-1 rounded-full bg-foreground/40 shrink-0" />
                {r}
              </li>
            ))}
          </ul>
        </section>
      )}

      {metadata.dfmWarnings.length > 0 && (
        <section>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Related DFM Issues</p>
          <div className="space-y-1.5">
            {metadata.dfmWarnings.map((w, i) => (
              <div key={i} className={`text-xs px-2 py-2 rounded space-y-0.5 ${severityClass(w.severity)}`}>
                <p className="font-medium capitalize">{w.category.replace(/_/g, ' ')}</p>
                <p className="opacity-90">{w.message}</p>
                {w.recommendation && <p className="opacity-70">→ {w.recommendation}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── GeometricCostDriversPanel ──────────────────────────────────────────────────

function GeometricCostDriversPanel({
  tree, summary, fg, selectedId, onSelect, maximized, onMaximize,
  selectedHoleGroup, selectedBend, dfmWarnings, item,
}: {
  tree: ProcessTreeNode;
  summary: FeatureGraphSummary;
  fg: FeatureGraph | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  maximized: PanelId | null;
  onMaximize: (id: PanelId | null) => void;
  selectedHoleGroup: HoleGroup | null;
  selectedBend: BendFeature | null;
  dfmWarnings: DFMWarning[];
  item: BOMItem;
}) {
  type GCDTab = 'geo' | 'cost' | 'props' | 'detail' | 'design';
  const [tab, setTab] = useState<GCDTab>('geo');
  const leaves = collectLeaves(tree);
  const selected = selectedId ? findNode(tree, selectedId) : null;
  const typedCostDrivers = fg?.summary?.costDrivers ?? [];
  const isFeatureSelected = !!(selectedHoleGroup || selectedBend);

  // Look up per-instance occurrence data from Feature Graph v2 for the selected feature.
  // Matched by diameter (holes) or radius (bends) — the same grouping key as the CAD engine.
  const selectedV2Feature = useMemo(() => {
    const v2Features = fg?.feature_graph_v2?.features;
    if (!v2Features) return undefined;
    if (selectedHoleGroup) {
      return v2Features.find((f) => f.feature_type === 'hole' && f.diameter_mm === selectedHoleGroup.diameter_mm);
    }
    if (selectedBend) {
      return v2Features.find((f) => f.feature_type === 'bend' && f.radius_mm === selectedBend.recognition.radius_mm);
    }
    return undefined;
  }, [fg, selectedHoleGroup, selectedBend]);

  const featureMetadata = useMemo(
    () => buildFeatureMetadata(selectedHoleGroup, selectedBend, dfmWarnings, selectedV2Feature),
    [selectedHoleGroup, selectedBend, dfmWarnings, selectedV2Feature],
  );

  const isCNCFeatureSelected = !!selectedId?.startsWith('cnc_');
  const isThreadFeatureSelected = !!selectedId?.startsWith('thread_di_');

  useEffect(() => {
    if (selectedHoleGroup || selectedBend) setTab('detail');
  }, [selectedHoleGroup, selectedBend]);

  useEffect(() => {
    if (isCNCFeatureSelected) setTab('detail');
  }, [isCNCFeatureSelected, selectedId]);

  useEffect(() => {
    if (isThreadFeatureSelected) setTab('detail');
  }, [isThreadFeatureSelected, selectedId]);

  return (
    <div className="flex flex-col h-full overflow-hidden border-l">
      <PanelHeader title="Geometric Cost Drivers" panelId="drivers" maximized={maximized} onMaximize={onMaximize} />

      {/* Tab bar */}
      <div className="flex flex-wrap border-b shrink-0 bg-muted/20">
        {([
          ['geo', 'Geometry'],
          ['cost', 'Cost Drivers'],
          ['props', 'Properties'],
          ['detail', (isFeatureSelected || isCNCFeatureSelected || isThreadFeatureSelected) ? '● Selected' : 'Selected'],
          ['design', 'Design / DFM'],
        ] as [GCDTab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-2.5 py-1.5 text-[11px] font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === key ? 'border-primary text-primary bg-background' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
            }`}>{label}</button>
        ))}
      </div>

      {/* Geometry tab */}
      {tab === 'geo' && (
        <div className="flex-1 overflow-y-auto divide-y divide-border/40">
          {summary.sheetThicknessMm > 0 && (
            <div className="flex items-baseline px-3 py-1.5 gap-2">
              <span className="text-[10px] text-muted-foreground flex-1 truncate">Sheet Thickness</span>
              <span className="text-xs font-medium tabular-nums">{fmt(summary.sheetThicknessMm, 1)} mm</span>
            </div>
          )}
          {summary.holeCount > 0 && (
            <>
              <div className="flex items-baseline px-3 py-1.5 gap-2">
                <span className="text-[10px] text-muted-foreground flex-1 truncate">Holes</span>
                <span className="text-xs font-medium tabular-nums">{fmtInt(summary.holeCount)}</span>
              </div>
              {(summary.holeGroups ?? []).map((g, i) => (
                <div key={i} className="flex items-baseline px-3 py-1 gap-2" style={{ paddingLeft: '28px' }}>
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">Ø{g.diameter_mm.toFixed(1)} mm</span>
                  <span className="text-xs font-medium tabular-nums">× {g.count}</span>
                </div>
              ))}
            </>
          )}
          {summary.bendCount > 0 && (
            <div className="flex items-baseline px-3 py-1.5 gap-2">
              <span className="text-[10px] text-muted-foreground flex-1 truncate">Bends</span>
              <span className="text-xs font-medium tabular-nums">{fmtInt(summary.bendCount)}</span>
            </div>
          )}
          {summary.cutLengthMm > 0 && (
            <div className="flex items-baseline px-3 py-1.5 gap-2">
              <span className="text-[10px] text-muted-foreground flex-1 truncate">Cut Length</span>
              <span className="text-xs font-medium tabular-nums">{fmt(summary.cutLengthMm, 0)} mm</span>
            </div>
          )}
          {summary.flatPatternAreaMm2 > 0 && (
            <div className="flex items-baseline px-3 py-1.5 gap-2">
              <span className="text-[10px] text-muted-foreground flex-1 truncate">Flat Pattern Area</span>
              <span className="text-xs font-medium tabular-nums">{fmt(summary.flatPatternAreaMm2, 0)} mm²</span>
            </div>
          )}
          {!summary.holeCount && !summary.bendCount && !summary.cutLengthMm && !summary.flatPatternAreaMm2 && !summary.sheetThicknessMm && (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
              <AlertCircle className="h-6 w-6 opacity-30" />
              <p className="text-[11px]">Run Auto-Fill to see geometry.</p>
            </div>
          )}
        </div>
      )}

      {/* Cost Drivers tab */}
      {tab === 'cost' && (
        <div className="flex-1 overflow-y-auto divide-y divide-border/40">
          {typedCostDrivers.length > 0 ? (
            typedCostDrivers.map((cd, i) => (
              <div key={i} className="flex items-baseline px-3 py-1.5 gap-2">
                <span className="text-[10px] text-muted-foreground flex-1 truncate">{cd.name}</span>
                <span className="text-xs font-medium tabular-nums">{fmt(cd.value, 0)} {cd.unit}</span>
              </div>
            ))
          ) : (
            <>
              {summary.pierceCount > 0 && (
                <div className="flex items-baseline px-3 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">Pierce Count</span>
                  <span className="text-xs font-medium tabular-nums">{fmtInt(summary.pierceCount)}</span>
                </div>
              )}
              {summary.bendCount > 0 && (
                <div className="flex items-baseline px-3 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">Bend Hits</span>
                  <span className="text-xs font-medium tabular-nums">{fmtInt(summary.bendCount)}</span>
                </div>
              )}
              {summary.cutLengthMm > 0 && (
                <div className="flex items-baseline px-3 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">Laser Cut Length</span>
                  <span className="text-xs font-medium tabular-nums">{fmt(summary.cutLengthMm, 0)} mm</span>
                </div>
              )}
              {summary.flatPatternAreaMm2 > 0 && (
                <div className="flex items-baseline px-3 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">Material Area</span>
                  <span className="text-xs font-medium tabular-nums">{fmt(summary.flatPatternAreaMm2, 0)} mm²</span>
                </div>
              )}
              {!summary.pierceCount && !summary.bendCount && !summary.cutLengthMm && !summary.flatPatternAreaMm2 && (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                  <AlertCircle className="h-6 w-6 opacity-30" />
                  <p className="text-[11px]">Run Auto-Fill to see cost drivers.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Properties tab — leaf list + inspector */}
      {tab === 'props' && (
        <div className="flex-1 overflow-hidden flex min-h-0">
          <div className="w-[45%] border-r overflow-y-auto shrink-0">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-muted/70 z-10">
                <tr>
                  <th className="w-5 px-1 py-1.5 border-b" />
                  <th className="text-left px-2 py-1.5 border-b font-semibold text-muted-foreground text-[11px]">Name</th>
                </tr>
              </thead>
              <tbody>
                {leaves.length === 0 ? (
                  <tr><td colSpan={2} className="px-2 py-3 text-center text-[11px] text-muted-foreground">Run Auto-Fill</td></tr>
                ) : (
                  leaves.map((leaf) => (
                    <tr key={leaf.id} onClick={() => onSelect(leaf.id)}
                      className={`border-b cursor-pointer transition-colors ${selectedId === leaf.id ? 'bg-primary/10' : 'hover:bg-primary/5'}`}>
                      <td className="px-1 py-1 text-emerald-500 text-[9px] text-center">●</td>
                      <td className="px-2 py-1 truncate text-[11px]">{leaf.label}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex-1 overflow-y-auto">
            {selected?.attrs ? (
              <div className="divide-y divide-border/40">
                <div className="flex items-baseline px-2 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground w-20 shrink-0">Name</span>
                  <span className="text-xs font-medium truncate">{selected.label}</span>
                </div>
                {selected.attrs.map((attr, i) => (
                  <div key={i} className="flex items-baseline px-2 py-1.5 gap-2">
                    <span className="text-[10px] text-muted-foreground w-36 shrink-0 truncate">{attr.name}</span>
                    <span className="text-xs font-medium truncate tabular-nums">{attr.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-[11px] text-muted-foreground px-2 text-center">
                {leaves.length > 0 ? 'Select a feature to view properties' : 'No feature data'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Selected feature detail */}
      {tab === 'detail' && (
        <div className="flex-1 overflow-y-auto min-h-0">
          {isThreadFeatureSelected && selectedId ? (
            <ThreadFeatureInspectorPanel selectedId={selectedId} item={item} />
          ) : isCNCFeatureSelected && fg && selectedId ? (
            <CNCFeatureInspectorPanel selectedId={selectedId} fg={fg} />
          ) : !featureMetadata && selected?.attrs?.length ? (
            <div className="p-2 space-y-0.5">
              <div className="px-2 py-1 text-xs font-medium text-foreground">{selected.label}</div>
              {selected.attrs.map((attr, i) => (
                <div key={i} className="flex items-baseline px-2 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground w-36 shrink-0 truncate">{attr.name}</span>
                  <span className="text-xs font-medium truncate tabular-nums">{attr.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <FeatureDetailPanel metadata={featureMetadata} />
          )}
        </div>
      )}

      {/* Design / DFM tab */}
      {tab === 'design' && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <DesignGuidanceTab fg={fg} />
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ManufacturingIntelligencePage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const bomId = params.bomId as string;
  const itemId = params.itemId as string;

  const { setOpen } = useSidebar();
  useEffect(() => {
    setOpen(false);
    return () => setOpen(true);
  }, [setOpen]);

  const queryClient = useQueryClient();
  const { data: item, isLoading } = useBOMItem(itemId);
  const { data: analysisVersionData } = useAnalysisVersion();
  const [file3dUrl, setFile3dUrl] = useState<string | null>(null);
  const [file3dUrlError, setFile3dUrlError] = useState<string | null>(null);
  const [file3dUrlRetryToken, setFile3dUrlRetryToken] = useState(0);
  const [file2dUrl, setFile2dUrl] = useState<string | null>(null);
  const [viewerTab, setViewerTab] = useState<'3d' | '2d'>('3d');
  const [maximized, setMaximized] = useState<PanelId | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    () => new Set(['root', 'grp_0', 'op_0', 'op_1', 'op_2', 'subop_0', 'subop_1', 'subop_2', 'op_threads', 'subop_threads']),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [batchSize, setBatchSize] = useState(250);
  const [productionLife, setProductionLife] = useState(5);
  const [processRouting, setProcessRouting] = useState<'auto' | 'manual'>('auto');
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  const [selectedManualRoute, setSelectedManualRoute] = useState<ManualRouteOption | null>(null);
  const applyRoute = useApplyRoute(item?.id);
  const [selectedAutoRouteId, setSelectedAutoRouteId] = useState<string | null>(null);
  const [operationVisual, setOperationVisual] = useState<OperationVisual>(null);
  const [vizLabel, setVizLabel] = useState<string | null>(null);
  // 'USA'/250 are only the pre-load defaults — resynced below from this
  // item's own saved scenario_overrides once it loads, and persisted there
  // on Apply, so a refresh no longer silently reverts Digital Factory/Batch
  // Size back to USA/250 (same override bag as Blank Thickness — see
  // migration 420 / costing/scenario-overrides.ts).
  const [factory, setFactory] = useState('USA');
  // Digital Factory / Batch Size staged drafts — see CostGuidePanel's "Apply
  // Scenario" banner. Lifted up here (not local to CostGuidePanel) so the
  // Workflow Builder can also see scenarioDirty and refuse to apply a route
  // against a scenario that isn't actually the one committed yet.
  const [factoryDraft, setFactoryDraft] = useState(factory);
  const [batchSizeDraft, setBatchSizeDraft] = useState(batchSize);
  const patchScenarioOverrides = usePatchScenarioOverrides();
  // Seed factory/batchSize (and their drafts) from the server's saved
  // scenario_overrides — but ONLY ONCE per item load, via the ref guard
  // below. Without the guard, this effect re-fires on EVERY refetch of
  // `item` — including ones triggered by completely unrelated actions
  // (material-grade save, blank-thickness override) — and each time it
  // would blindly overwrite the in-progress draft with whatever the server
  // still has from before this session's edits, silently discarding a
  // Batch Size / Digital Factory change the user typed but hadn't clicked
  // Apply on yet. Confirmed live: a batchSize=10000 draft was clobbered back
  // to the server's stale batchSize=250 this way, purely from an unrelated
  // material-grade "SET" refetching the item mid-session.
  const scenarioSeededForItemRef = useRef<string | null>(null);
  useEffect(() => {
    if (!item?.id || scenarioSeededForItemRef.current === item.id) return;
    scenarioSeededForItemRef.current = item.id;
    const savedLocation = item.scenarioOverrides?.location;
    if (typeof savedLocation === 'string' && savedLocation) {
      setFactory(savedLocation);
      setFactoryDraft(savedLocation);
    }
    const savedBatchSize = item.scenarioOverrides?.batchSize;
    if (typeof savedBatchSize === 'number' && savedBatchSize > 0) {
      setBatchSize(savedBatchSize);
      setBatchSizeDraft(savedBatchSize);
    }
  }, [item]);
  const scenarioDirty = factoryDraft !== factory || batchSizeDraft !== batchSize;
  // Awaitable so the single bottom "Apply" button (CostGuidePanel) can commit
  // Digital Factory/Batch Size + the staged Workflow Builder route together
  // and only THEN run its own material-grade-driven logic — there is no
  // longer a separate top "Apply Scenario" banner/button.
  const applyScenario = async () => {
    setFactory(factoryDraft);
    setBatchSize(batchSizeDraft);
    if (item?.id) {
      patchScenarioOverrides.mutate({ id: item.id, patch: { location: factoryDraft, batchSize: batchSizeDraft } });
    }
    // Workflow Builder's "Set Route" only stages selectedManualRoute — the
    // real apply-route/apply-custom-route call (creating process_cost_records)
    // happens HERE, bundled with whatever Digital Factory/Batch Size was just
    // committed above, using factoryDraft/batchSizeDraft directly rather than
    // the (not-yet-updated) factory/batchSize state.
    if (processRouting === 'manual' && selectedManualRoute && item?.id) {
      const route = selectedManualRoute;
      const applyMachineOverrides = () => {
        for (const ov of route.machineOverrides ?? []) applyManualMachineOverride.mutate(ov);
      };
      if (route.dynamicCuttingRouteId) {
        // apply-custom-route writes ONLY what's listed in `steps` — it never
        // implicitly includes baseCuttingRouteId's own cutting line. Without
        // this prepend, the cutting operation (e.g. Turret Punching) is
        // silently absent from every applied custom route — confirmed live:
        // the backend logged "wrote 3 ops: Press Brake, Deburring, Hole
        // Extrusion (Burring)" with the cutting op missing entirely.
        const steps: ApplyCustomRouteStep[] = [
          ...(route.dynamicCuttingStep ? [{ process: route.dynamicCuttingStep.process }] : []),
          ...(route.dynamicSteps ?? []).map((s): ApplyCustomRouteStep => s.isReal
            ? { process: s.process }
            : {
                process: s.process,
                machineClass: s.machineClass,
                ...(s.processGroup !== undefined ? { processGroup: s.processGroup } : {}),
                ...(s.processRoute !== undefined ? { processRoute: s.processRoute } : {}),
              }),
        ];
        try {
          await applyCustomRoute.mutateAsync({ baseCuttingRouteId: route.dynamicCuttingRouteId, steps, batchSize: batchSizeDraft, location: factoryDraft });
          applyMachineOverrides();
        } catch { /* errors surfaced by the mutation's own onError toast */ }
      } else {
        const applyId = KB_TO_APPLY_ROUTE[route.id];
        if (applyId) {
          try {
            await applyRoute.mutateAsync({ routeId: applyId, batchSize: batchSizeDraft, location: factoryDraft });
            applyMachineOverrides();
          } catch { /* errors surfaced by the mutation's own onError toast */ }
        }
      }
    }
  };
  const [refreshing, setRefreshing] = useState(false);
  // Applies the real machine picked per step in the Workflow Builder, after
  // applyRoute/applyCustomRoute create the process_cost_records rows — see
  // ManualRouteOption.machineOverrides / applyScenario above. Uses the DRAFT
  // location while scenarioDirty so this mutation's closure can't fire with a
  // stale committed location before setFactory's state update has propagated.
  const applyManualMachineOverride = useMachineOverride(item?.id, scenarioDirty ? factoryDraft : factory);
  const applyCustomRoute = useApplyCustomRoute(item?.id);

  // ── Right panel tab — lifted so the inspector bridge button can switch it ─────
  const [rightTab, setRightTab] = useState<RightTabKey>('copilot');

  // ── Vendor hotspot context — set when user jumps from inspector to Vendor tab ─
  const [vendorHotspotContext, setVendorHotspotContext] = useState<{
    layer: HeatmapLayerType; riskLevel: 'critical' | 'high' | 'medium' | 'low';
  } | null>(null);

  // ── Heatmap state ─────────────────────────────────────────────────────────────
  const [heatmapMode, setHeatmapMode] = useState(false);
  const [heatmapLayer, setHeatmapLayer] = useState<HeatmapLayerType>('manufacturing_risk');
  const [heatmapNorm, setHeatmapNorm] = useState<HeatmapNormalization>('relative');
  const [heatmapInspector, setHeatmapInspector] = useState<{
    worldPos: [number, number, number];
    riskValue: number;
    riskLevel: 'critical' | 'high' | 'medium' | 'low';
    contributors: Array<{
      featureId: string;
      occurrenceIndex: number;
      contribution: number;
      contributionPct: number;
      label: string;
      confidence: 'measured' | 'heuristic' | 'signal';
    }>;
    nearbyFeatures: Array<{ id: string; type: string; distanceMm: number; riskLevel: string }>;
    manufacturingImpact: Array<{ code: string; label: string; severity: 'critical' | 'high' | 'medium' | 'low' }>;
    recommendations: Array<{ label: string; priority: 'high' | 'medium' | 'low' }>;
  } | null>(null);

  // Clear inspector whenever the user switches layers — stale data from the previous layer is misleading
  useEffect(() => { setHeatmapInspector(null); }, [heatmapLayer]);

  // Scroll right panel to top when inspector is set so the user sees it immediately
  const rightPanelScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (heatmapInspector) rightPanelScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [heatmapInspector]);

  // All hooks must appear before any conditional returns
  const fg = useMemo(
    () => normalizeFeatureGraph(item ? ((item.featureGraph as FeatureGraph | undefined) ?? null) : null),
    [item],
  );
  const currentVersion = analysisVersionData?.version ?? 0;
  const isStale = fg != null && currentVersion > 0 && (fg.feature_graph_version ?? 0) < currentVersion;

  // Auto-select the recommended KB route when the detected part family changes
  useEffect(() => {
    const family = item ? resolveDisplayFamily(item, fg) : fg?.classification?.family;
    const routes = KB_ROUTE_ALTERNATIVES[family ?? ''] ?? [];
    const recommended = routes.find((r) => r.isRecommended) ?? routes[0] ?? null;
    setSelectedAutoRouteId(recommended?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fg?.classification?.family, item?.materialGrade, item?.material]);

  const summary = useMemo(
    () => fg?.summary ?? (item ? buildSummary(item, fg) : null),
    [fg, item],
  );
  const activeOverrideProcesses = useMemo(() => {
    if (processRouting === 'manual' && selectedManualRoute) return selectedManualRoute.processes;
    if (processRouting === 'auto') {
      const family = item ? resolveDisplayFamily(item, fg) : fg?.classification?.family;
      const autoRoutes = KB_ROUTE_ALTERNATIVES[family ?? ''] ?? [];
      if (autoRoutes.length > 0) {
        const picked = autoRoutes.find((r) => r.id === selectedAutoRouteId)
          ?? autoRoutes.find((r) => r.isRecommended)
          ?? autoRoutes[0];
        return picked?.processes;
      }
    }
    return undefined;
  }, [processRouting, selectedManualRoute, selectedAutoRouteId, fg, item]);

  // Real, backend-computed process lines (with per-feature cycle-time breakdown)
  // — reused by the Properties tree below instead of hardcoded per-feature rates.
  // React Query deduplicates this: free if the Cost tab has already loaded it.
  // Same fix as SustainabilityTab/AnalysisTabsPanel above — omitting location
  // silently defaulted to 'USA' (useCostSummary's own fallback), running a
  // third wasted full cost computation on every load/Apply regardless of the
  // real Digital Factory.
  const { data: costForHeatmap } = useCostSummary(item?.id ?? '', batchSize, factory);
  // costForHeatmap.processLines always reflects the cost engine's OWN default-
  // recommended route (e.g. Fiber Laser Cutting), never whatever route the
  // engineer actually applied (e.g. Waterjet Cutting) -- same root cause
  // already fixed for Direct Process Costs in CostSummaryTab (see
  // persistedAppliedRouteId there). This tree needs the identical substitution:
  // recover the real applied route from the stored process records' `notes`
  // field (applyRoute() stamps `auto_fill_from_route:${routeId}` on every row)
  // and swap in ITS processLines, so the process step tree and its feature
  // highlighting reflect what's actually applied, not the engine's unrelated
  // default pick. React Query dedupes both fetches against the Cost tab's own.
  const { data: comparisonForTree } = useRouteComparison(item?.id ?? '', batchSize, factory);
  const { data: procRecordsForTree } = useProcessCosts({ bomItemId: item?.id ?? '', isActive: true, enabled: !!item?.id });
  // processRouting/selectedManualRoute are pure client state — a page refresh
  // wipes them back to the useState defaults ('auto', null) even though the
  // real applied route is still sitting in process_cost_records, correctly
  // persisted. Restore them ONCE per item load from the real stored records'
  // `notes` tag (writeProcessLinesAsRecords stamps 'auto_fill_from_custom_
  // route:<id>' for a Workflow Builder dynamic apply — unambiguous, unlike
  // the plain 'auto_fill_from_route:<routeId>' tag also used by Auto mode's
  // own recommended pick, which this deliberately does NOT try to disambiguate
  // into Manual — guessing wrong there would misrepresent what the user chose).
  const routingRestoredForItemRef = useRef<string | null>(null);
  useEffect(() => {
    if (!item?.id || !procRecordsForTree || !comparisonForTree) return;
    if (routingRestoredForItemRef.current === item.id) return;
    routingRestoredForItemRef.current = item.id;

    const records = procRecordsForTree.records ?? [];
    const isDynamic = records.some((r: any) => /^auto_fill_from_custom_route:/.test(r.notes ?? ''));
    if (!isDynamic) return;

    const sorted = [...records].sort((a: any, b: any) => (a.opNbr || 0) - (b.opNbr || 0));
    const cuttingRow = sorted[0];
    const classToRouteId = cuttingMachineClassToRouteId(comparisonForTree.routes ?? []);
    const cuttingRouteId = classToRouteId[cuttingRow?.machineClass as string | undefined ?? ''];
    if (!cuttingRouteId) return; // can't identify the real cutting method — leave Auto rather than guess

    // process_cost_records.operation is the CATALOG's own operation name
    // (e.g. "Bend Brake", "Deburr") — different from the cost engine's own
    // process label ("Press Brake", "Deburring") for the exact same machine
    // class (see the identical duality handled correctly in the Workflow
    // Builder modal's own restore effect above). Blindly using r.operation
    // with isReal:true here sent applyCustomRoute a step whose `process`
    // matched nothing in its engine-keyed availableByName map AND carried no
    // machineClass (isReal:true steps only send `process`) — confirmed live:
    // "'Bend Brake' is not a real, geometry-computed operation for this
    // part... Geometry-computed operations available: ... Press Brake ...".
    // Resolve the real engine line by machineClass first, same as the modal.
    const cuttingClasses = cuttingMachineClassesFromRoutes(comparisonForTree.routes ?? []);
    const pageSharedLines = (comparisonForTree.routes?.[0]?.processLines ?? []).filter(
      (l) => !cuttingClasses.has(l.machineClass),
    );
    const dynamicSteps = sorted.slice(1)
      .filter((r: any) => r.machineClass && r.operation)
      .map((r: any) => {
        const real = pageSharedLines.find((l) => l.machineClass === r.machineClass)
          ?? pageSharedLines.find((l) => l.process === r.operation);
        return real
          ? { process: real.process, machineClass: real.machineClass, isReal: true }
          : {
              process: r.operation as string, machineClass: r.machineClass as string, isReal: false,
              ...(r.processGroup ? { processGroup: r.processGroup as string } : {}),
              ...(r.processRoute ? { processRoute: r.processRoute as string } : {}),
            };
      });

    setSelectedManualRoute({
      id: `custom-restored-${item.id}`,
      label: sorted.map((r: any) => r.operation).filter(Boolean).join(' + ') || 'Custom Workflow',
      complexityLevel: 'standard',
      isRecommended: false,
      processes: sorted.map((r: any) => r.operation).filter(Boolean),
      rationale: 'Custom workflow — restored from applied process costs after reload',
      dynamicCuttingRouteId: cuttingRouteId,
      // Same catalog-name-vs-engine-label duality as dynamicSteps above —
      // resolve the real engine process label for the cutting line too,
      // rather than sending the raw catalog operation string.
      ...(cuttingRow?.machineClass && cuttingRow?.operation
        ? {
            dynamicCuttingStep: {
              process: comparisonForTree.routes?.find((r) => r.routeId === cuttingRouteId)
                ?.processLines.find((l) => l.machineClass === cuttingRow.machineClass)?.process
                ?? cuttingRow.operation as string,
              machineClass: cuttingRow.machineClass as string,
            },
          }
        : {}),
      dynamicSteps,
    });
    setProcessRouting('manual');
  }, [item?.id, procRecordsForTree, comparisonForTree]);
  const persistedAppliedRouteIdForTree = useMemo(() => {
    const records = procRecordsForTree?.records ?? [];
    for (const rec of records) {
      const m = /^auto_fill_from_route:(.+)$/.exec((rec as any).notes ?? '');
      if (m) return m[1];
    }
    // Same gap as CostSummaryTab's persistedAppliedRouteId (see its own
    // comment) — a Workflow Builder custom apply stamps `auto_fill_from_
    // custom_route:<itemId>`, which never matches the regex above. Without
    // this, the Manufacturing Process tree fell back to showing the auto-
    // recommended route's lines (and a blank machine for any step, like
    // Turret Punching, that only exists in the real applied route).
    const isCustomApply = records.some((r: any) => /^auto_fill_from_custom_route:/.test(r.notes ?? ''));
    if (isCustomApply && comparisonForTree?.routes) {
      const sorted = [...records].sort((a: any, b: any) => (a.opNbr || 0) - (b.opNbr || 0));
      const classToRouteId = cuttingMachineClassToRouteId(comparisonForTree.routes);
      const cuttingClass = sorted[0]?.machineClass as string | undefined;
      if (cuttingClass && classToRouteId[cuttingClass]) return classToRouteId[cuttingClass];
    }
    return null;
  }, [procRecordsForTree, comparisonForTree]);
  const effectiveCostForHeatmap = useMemo(() => {
    if (!costForHeatmap || !persistedAppliedRouteIdForTree) return costForHeatmap;
    const appliedRoute = comparisonForTree?.routes.find((r) => r.routeId === persistedAppliedRouteIdForTree);
    return appliedRoute ? { ...costForHeatmap, processLines: appliedRoute.processLines } : costForHeatmap;
  }, [costForHeatmap, comparisonForTree, persistedAppliedRouteIdForTree]);
  // The substitution above only fixes MACHINE/rate lookups. The tree's actual
  // STEP NAMES (baseRecs inside buildProcessTree) come from fg.processRecommendations
  // — a CAD-classification default with zero awareness of Route Comparison/Apply
  // Route — so swapping processLines alone left every step labeled "Fiber Laser
  // Cutting" etc. even after applying Waterjet. Recover the applied route's own
  // process names, in order, and feed them through the SAME overrideProcesses
  // slot the Manual/Auto KB route mechanism already uses — an explicitly applied
  // route is the most authoritative signal available, so it takes priority over
  // both that mechanism and the fg default.
  const appliedRouteProcessNames = useMemo(() => {
    if (!persistedAppliedRouteIdForTree) return null;
    const appliedRoute = comparisonForTree?.routes.find((r) => r.routeId === persistedAppliedRouteIdForTree);
    return appliedRoute ? appliedRoute.processLines.map((l) => l.process) : null;
  }, [comparisonForTree, persistedAppliedRouteIdForTree]);
  const effectiveOverrideProcesses = appliedRouteProcessNames ?? activeOverrideProcesses;

  const tree = useMemo(
    () => (item && summary) ? buildProcessTree(item, fg, summary, factory, effectiveOverrideProcesses, effectiveCostForHeatmap) : null,
    [item, fg, summary, factory, effectiveOverrideProcesses, effectiveCostForHeatmap],
  );

  const treeProcessNames = useMemo(() => {
    if (!tree) return [];
    const collect = (nodes: ProcessTreeNode[]): string[] =>
      nodes.flatMap((n) => n.kind === 'operation' ? [n.label] : collect(n.children ?? []));
    const roots = Array.isArray(tree) ? tree : [tree];
    return [...new Set(collect(roots))];
  }, [tree]);

  const selectedHoleGroup = useMemo(() => {
    if (!selectedNodeId || !summary?.holeGroups?.length) return null;
    const exact = summary.holeGroups.find((g) => g.id === selectedNodeId);
    if (exact) return exact;
    // CAD engine omits id on holeGroups; node id is "hole_d{d}_c{n}" — parse diameter
    const m = selectedNodeId.match(/^hole_d([\d.]+)/);
    if (m) return summary.holeGroups.find((g) => g.diameter_mm === parseFloat(m[1]!)) ?? null;
    return null;
  }, [selectedNodeId, summary]);

  const selectedBend = useMemo(() => {
    if (!selectedNodeId) return null;
    const f = (fg?.features ?? []).find((f) => f.type === 'bend' && f.id === selectedNodeId);
    return f?.type === 'bend' ? f : null;
  }, [selectedNodeId, fg]);

  const [selectedCNCFeatureKey, setSelectedCNCFeatureKey] = useState<string | null>(null);

  const selectedCNCV2Feature = useMemo(() => {
    if (!selectedCNCFeatureKey || !fg) return null;
    const cncFeats: any[] = (fg as any)?.cnc_features?.features ?? [];
    const [type, diamStr] = selectedCNCFeatureKey.split(':');
    const diam = diamStr ? parseFloat(diamStr) : null;
    const matches = cncFeats.filter((f) => {
      if (f.type !== type) return false;
      if (diam != null) return Math.abs((f.params?.diameter_mm ?? 0) - diam) < 0.05;
      return true;
    });
    if (matches.length === 0) return null;
    return {
      id: `cnc_${selectedCNCFeatureKey}`,
      feature_type: type ?? 'unknown',
      occurrences: matches.map((f) => ({
        centroid: ((f.params?.centroid as [number, number, number]) ?? [0, 0, 0]),
        face_ids: (f.face_ids as number[]) ?? [],
      })),
    };
  }, [selectedCNCFeatureKey, fg]);

  // Set by the Analysis panel's cost-tab "Feature breakdown" rows (Bend R1mm x2,
  // Pierces x19, Cut path...) to highlight that exact feature in the 3D viewer.
  const [selectedDirectV2Feature, setSelectedDirectV2Feature] = useState<FeatureNodeV2 | null>(null);

  const selectedV2Feature = useMemo(() => {
    if (selectedDirectV2Feature) return selectedDirectV2Feature;
    if (selectedCNCV2Feature) return selectedCNCV2Feature;
    const v2Features = fg?.feature_graph_v2?.features;
    if (!v2Features) return null;
    if (selectedHoleGroup) {
      return v2Features.find((f) => f.feature_type === 'hole' && f.diameter_mm === selectedHoleGroup.diameter_mm) ?? null;
    }
    if (selectedBend) {
      return v2Features.find((f) => f.feature_type === 'bend' && f.radius_mm === selectedBend.recognition.radius_mm) ?? null;
    }
    return null;
  }, [fg, selectedHoleGroup, selectedBend, selectedCNCV2Feature, selectedDirectV2Feature]);

  const [selectedOccurrenceIndex, setSelectedOccurrenceIndex] = useState<number | null>(null);

  useEffect(() => {
    setSelectedOccurrenceIndex(null);
  }, [selectedV2Feature]);

  const faceMap = fg?.feature_graph_v2?.metadata?.face_map
    ?? (fg as any)?.cnc_features?.face_map
    ?? null;

  const { data: dfmScores } = useDFMScores(item?.id);
  const selectedFeatureScores = dfmScores?.features.find((f) => f.featureId === selectedV2Feature?.id)?.occurrences;

  // Heatmap weights — all derived from backend-computed values, no frontend cost constants.
  // costForHeatmap is declared above (reused by the Properties tree too; useCostSummary
  // is React Query deduplicated, so this is free once either place has loaded it).
  const pierceCount = Math.max(item?.pierceCount ?? fg?.summary?.pierceCount ?? 1, 1);
  const bendCount   = Math.max(item?.bendCount   ?? fg?.summary?.bendCount   ?? 1, 1);

  const costHeatmapWeights = useMemo((): CostHeatmapWeights => {
    const laserLine = costForHeatmap?.processLines.find((l) => l.process === 'Laser Cutting');
    const brakeLine = costForHeatmap?.processLines.find((l) => l.process === 'Press Brake');
    return {
      laserCostPerPierce: laserLine ? laserLine.totalCost / pierceCount : null,
      brakeCostPerBend:   brakeLine ? brakeLine.totalCost / bendCount   : null,
    };
  }, [costForHeatmap, pierceCount, bendCount]);

  const sustainabilityHeatmapWeights = useMemo((): SustainabilityHeatmapWeights => {
    const co2 = costForHeatmap?.sustainability?.processCo2Breakdown;
    const laserCo2 = co2?.find((p) => p.process === 'Laser Cutting');
    const brakeCo2 = co2?.find((p) => p.process === 'Press Brake');
    return {
      laserCo2PerPierce: laserCo2 ? laserCo2.co2Kg / pierceCount : null,
      brakeCo2PerBend:   brakeCo2 ? brakeCo2.co2Kg / bendCount   : null,
    };
  }, [costForHeatmap, pierceCount, bendCount]);

  const toleranceHeatmapWeights = useMemo((): ToleranceHeatmapWeights => ({
    tightestToleranceMm: item?.tightestToleranceMm ?? item?.drawingIntelligence?.tightest_tolerance_mm ?? null,
  }), [item?.tightestToleranceMm, item?.drawingIntelligence?.tightest_tolerance_mm]);

  const isInjectionMolded = fg?.classification?.family === 'injection_molded';
  const imFeatures = ((fg as any)?.imHeatmapFeatures ?? null) as IMHeatmapFeatures | null;

  const imSignals = useMemo((): IMHeatmapSignals | null => {
    if (!isInjectionMolded) return null;
    const wn = summary?.wallThicknessNominalMm ?? 2.0;
    return {
      wallThicknessNominalMm: wn,
      wallThicknessMaxMm: summary?.wallThicknessMaxMm ?? wn * 1.2,
      wallUniformityRatio: (summary as any)?.wallUniformityRatio ?? 0.15,
      undercutFaceCount: (summary as any)?.undercutFaceCount ?? 0,
      undraftedFaceCount: (summary as any)?.undraftedFaceCount ?? 0,
      blindFeatureCount: (summary as any)?.blindFeatureCount ?? 0,
      partingComplexity: (summary as any)?.partingComplexity ?? 0,
      avgDraftAngleDeg: (summary as any)?.avgDraftAngleDeg ?? 1.5,
      ribCount: summary?.ribCountProxy ?? 0,
      bboxMm: [
        (fg as any)?.bboxX ?? (fg as any)?.bounding_box?.x ?? 100,
        (fg as any)?.bboxY ?? (fg as any)?.bounding_box?.y ?? 80,
        (fg as any)?.bboxZ ?? (fg as any)?.bounding_box?.z ?? 20,
      ],
    };
  }, [isInjectionMolded, summary, fg]);

  const heatmapSources = useMemo((): HeatmapSource[] => {
    if (!heatmapMode || !fg?.feature_graph_v2) return [];
    // IM parts use localized per-feature source builders
    if (isInjectionMolded && imSignals) {
      return buildIMHeatmapSources(fg, imSignals, imFeatures, heatmapLayer);
    }
    const thk = item?.sheetThicknessMm ?? 1;
    switch (heatmapLayer) {
      case 'manufacturing_risk':
        if (!dfmScores?.features?.length) return [];
        return buildManufacturingRiskSources(dfmScores, fg);
      case 'cost_density':
        return buildCostDensitySources(fg, thk, costHeatmapWeights);
      case 'tolerance_risk':
        return buildToleranceSources(fg, toleranceHeatmapWeights);
      case 'sustainability':
        return buildSustainabilitySources(fg, sustainabilityHeatmapWeights);
      case 'thermal':
        return buildThermalSources(fg, thk);
      case 'tool_wear':
        return buildToolWearSources(fg, thk);
      default:
        return [];
    }
  }, [heatmapMode, heatmapLayer, dfmScores, fg, item?.sheetThicknessMm, costHeatmapWeights, toleranceHeatmapWeights, sustainabilityHeatmapWeights, isInjectionMolded, imSignals, imFeatures]);

  const handleHeatmapInspect = useCallback((
    worldPos: [number, number, number],
    _triangleIndex: number,
    riskValue: number,
  ) => {
    if (!heatmapSources.length) return;
    const [wx, wy, wz] = worldPos;

    const withContributions = heatmapSources.map((src) => {
      const dx = wx - src.centroid[0], dy = wy - src.centroid[1], dz = wz - src.centroid[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      const contribution = src.amplitude * Math.exp(-d2 / (2 * src.sigma * src.sigma));
      return { featureId: src.featureId ?? '', occurrenceIndex: src.occurrenceIndex ?? 0, contribution, reason: src.reason };
    });

    const map = new Map<string, (typeof withContributions)[0]>();
    for (const c of withContributions) {
      const key = `${c.featureId}:${c.occurrenceIndex}`;
      const existing = map.get(key);
      if (!existing || existing.contribution < c.contribution) map.set(key, c);
    }

    const sorted = Array.from(map.values())
      .filter((c) => c.contribution > 0.02)
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 5);

    const totalContribution = sorted.reduce((s, c) => s + c.contribution, 0) || 1;

    const contributors = sorted.map((c) => {
      const v2 = fg?.feature_graph_v2?.features.find((f) => f.id === c.featureId);
      const label = v2
        ? v2.feature_type === 'hole' ? `Ø${v2.diameter_mm}mm hole · occ ${c.occurrenceIndex + 1}`
          : v2.feature_type === 'bend' ? `R${v2.radius_mm}mm bend · occ ${c.occurrenceIndex + 1}`
          : `${v2.feature_type} · occ ${c.occurrenceIndex + 1}`
        : (c.reason ?? (c.featureId || 'Global signal'));

      // Confidence tier: measured = from real CAD geometry, heuristic = IM physics blob,
      // signal = global proxy with no spatial anchor
      const confidence: 'measured' | 'heuristic' | 'signal' =
        v2 ? 'measured'
        : c.reason ? 'heuristic'
        : 'signal';

      return {
        ...c,
        label,
        contributionPct: Math.round((c.contribution / totalContribution) * 100),
        confidence,
      };
    });

    // Non-risk layers — show layer-specific context, skip DFM processing
    if (heatmapLayer !== 'manufacturing_risk') {
      const level: 'critical' | 'high' | 'medium' | 'low' =
        riskValue > 0.75 ? 'critical' : riskValue > 0.50 ? 'high' : riskValue > 0.25 ? 'medium' : 'low';

      const impact: Array<{ code: string; label: string; severity: 'critical' | 'high' | 'medium' | 'low' }> = [];
      const recs: Array<{ label: string; priority: 'high' | 'medium' | 'low' }> = [];
      const seenTypes = new Set<string>();
      const thk = item?.sheetThicknessMm ?? 2;

      for (const c of contributors) {
        const v2 = fg?.feature_graph_v2?.features.find((f) => f.id === c.featureId);
        if (!v2 || seenTypes.has(v2.feature_type)) continue;
        seenTypes.add(v2.feature_type);

        if (heatmapLayer === 'cost_density') {
          if (v2.feature_type === 'hole') {
            const occ2 = v2.occurrences[c.occurrenceIndex];
            const ldRatio = occ2?.ld_ratio ?? 0;
            if (thk === 0) {
              impact.push({ code: 'DRILL_COST', label: ldRatio > 5 ? `Deep hole L/D ${ldRatio.toFixed(1)} — peck drilling required, higher cost` : ldRatio > 3 ? `Moderate depth L/D ${ldRatio.toFixed(1)} — standard drilling` : 'Shallow hole — standard drilling', severity: ldRatio > 5 ? 'high' : ldRatio > 3 ? 'medium' : 'low' });
              if (occ2?.tapped) impact.push({ code: 'TAP_COST', label: `Tapped${occ2.spec ? ` ${occ2.spec}` : ''} — tapping adds cycle time`, severity: 'medium' });
              if (ldRatio > 8) recs.push({ label: 'Consider gun-drilling or step-boring for very deep holes', priority: 'high' });
            } else {
              const pp = costHeatmapWeights.laserCostPerPierce;
              impact.push({ code: 'PIERCE', label: pp != null ? `Pierce: $${pp.toFixed(2)}/hole (laser)` : 'Laser pierce — run cost analysis for exact figure', severity: (pp ?? 0) > 5 ? 'high' : 'medium' });
              if ((item?.holeCount ?? 0) > 100) recs.push({ label: 'Consider gang punch tooling to reduce per-hole cost', priority: 'medium' });
              if (v2.diameter_mm != null && v2.diameter_mm < 2 * thk) recs.push({ label: `Small hole Ø${v2.diameter_mm}mm — increase to ≥ 2× thickness if tolerance allows`, priority: 'high' });
            }
          } else if (v2.feature_type === 'bend') {
            const pb = costHeatmapWeights.brakeCostPerBend;
            impact.push({ code: 'BEND', label: pb != null ? `Bend: $${pb.toFixed(2)}/bend (press brake)` : 'Press brake — run cost analysis for exact figure', severity: (pb ?? 0) > 10 ? 'high' : 'medium' });
            if ((item?.bendCount ?? 0) > 20) recs.push({ label: 'High bend count — review if bends can be eliminated', priority: 'medium' });
          }
        } else if (heatmapLayer === 'tolerance_risk') {
          const tol = toleranceHeatmapWeights.tightestToleranceMm;
          if (v2.feature_type === 'hole') {
            impact.push({ code: 'TOL', label: tol != null ? `Tightest tolerance: ±${tol}mm` : 'No drawing data — tolerance unknown', severity: (tol ?? 1) <= 0.05 ? 'critical' : (tol ?? 1) <= 0.1 ? 'high' : 'medium' });
            if (v2.diameter_mm != null && v2.diameter_mm < 4) recs.push({ label: `Ø${v2.diameter_mm}mm hole — verify with go/no-go gauge or CMM`, priority: 'high' });
            if ((tol ?? 1) <= 0.05) recs.push({ label: '±0.05mm or tighter — CMM inspection required', priority: 'high' });
          } else if (v2.feature_type === 'bend') {
            impact.push({ code: 'BEND_TOL', label: 'Bend angle tolerance — typically ±0.5° to ±1°', severity: 'low' });
            recs.push({ label: 'Use angle gauge for critical assembly bends', priority: 'low' });
          }
        } else if (heatmapLayer === 'sustainability') {
          if (v2.feature_type === 'hole') {
            const cp = sustainabilityHeatmapWeights.laserCo2PerPierce;
            impact.push({ code: 'CO2_PIERCE', label: cp != null ? `Laser pierce: ${(cp * 1000).toFixed(2)} g CO₂e/hole` : 'Run cost analysis for CO₂ data', severity: 'medium' });
            if ((item?.holeCount ?? 0) > 100) recs.push({ label: 'Reduce hole count or consolidate with punching to cut process CO₂', priority: 'medium' });
          } else if (v2.feature_type === 'bend') {
            const cb = sustainabilityHeatmapWeights.brakeCo2PerBend;
            impact.push({ code: 'CO2_BEND', label: cb != null ? `Press brake: ${(cb * 1000).toFixed(2)} g CO₂e/bend` : 'Run cost analysis for CO₂ data', severity: 'low' });
            recs.push({ label: 'Increase batch size to amortise press brake setup energy', priority: 'low' });
          }
        } else if (heatmapLayer === 'thermal') {
          if (v2.feature_type === 'hole') {
            const occ = v2.occurrences[c.occurrenceIndex];
            const density = occ?.local_feature_density ?? 0;
            impact.push({ code: 'THERMAL', label: density > 5 ? `Dense cluster — ${density} holes within 30mm radius` : 'Pierce heat accumulation area', severity: density > 8 ? 'high' : density > 4 ? 'medium' : 'low' });
            if (density > 5) recs.push({ label: 'Optimise pierce sequence to allow cooling between adjacent holes', priority: 'medium' });
            if (v2.diameter_mm != null && v2.diameter_mm < 2 * thk) recs.push({ label: `Small hole Ø${v2.diameter_mm}mm — higher laser dwell time, higher local heat`, priority: 'medium' });
          }
          impact.push({ code: 'NOTE', label: 'Estimated from feature density — not FEA simulation', severity: 'low' });
        } else if (heatmapLayer === 'tool_wear') {
          if (v2.feature_type === 'hole') {
            const occ = v2.occurrences[c.occurrenceIndex];
            const density = occ?.local_feature_density ?? 0;
            const ldRatio = occ?.ld_ratio ?? 0;
            if (thk === 0) {
              const wearSev = ldRatio > 8 ? 'critical' : ldRatio > 5 ? 'high' : ldRatio > 3 ? 'medium' : 'low';
              impact.push({ code: 'DRILL_WEAR', label: ldRatio > 8 ? `L/D ${ldRatio.toFixed(1)} — very deep, chip packing → drill breakage risk` : ldRatio > 5 ? `L/D ${ldRatio.toFixed(1)} — deep, peck drill required, faster drill wear` : ldRatio > 3 ? `L/D ${ldRatio.toFixed(1)} — moderate depth, standard wear` : 'Shallow hole — minimal wear', severity: wearSev });
              if (occ?.tapped) impact.push({ code: 'TAP_WEAR', label: `Tapped — tap wear is cumulative; inspect after every 200 parts`, severity: 'medium' });
              if (ldRatio > 8) recs.push({ label: 'Use peck cycle + high-pressure coolant; replace drill after 50 holes', priority: 'high' });
              else if (ldRatio > 5) recs.push({ label: 'Peck drilling recommended; check for chip build-up', priority: 'medium' });
              if (density > 5) recs.push({ label: 'Dense hole cluster — rotate tool more frequently in this zone', priority: 'medium' });
            } else {
              const isSmall = v2.diameter_mm != null && v2.diameter_mm < 2 * thk;
              impact.push({ code: 'WEAR', label: isSmall ? `Small hole Ø${v2.diameter_mm}mm — highest nozzle wear` : 'Pierce concentration — moderate wear', severity: isSmall ? 'high' : density > 5 ? 'high' : 'medium' });
              if (isSmall) recs.push({ label: `Increase Ø${v2.diameter_mm}mm to ≥ ${(2 * thk).toFixed(1)}mm where tolerance allows`, priority: 'high' });
              if (density > 5) recs.push({ label: 'Schedule nozzle inspection every 500 pierces in this zone', priority: 'medium' });
            }
          }
          impact.push({ code: 'NOTE', label: 'Estimated from geometry — not actual tool life data', severity: 'low' });
        }
      }

      setHeatmapInspector({ worldPos, riskValue, riskLevel: level, contributors, nearbyFeatures: [], manufacturingImpact: impact, recommendations: recs });
      return;
    }

    const nearbyFeatures: Array<{ id: string; type: string; distanceMm: number; riskLevel: string }> = [];
    for (const feat of dfmScores?.features ?? []) {
      const v2 = fg?.feature_graph_v2?.features.find((f) => f.id === feat.featureId);
      if (!v2) continue;
      for (const occ of feat.occurrences) {
        const c = v2.occurrences[occ.occurrenceIndex]?.centroid;
        if (!c) continue;
        const dx = wx - c[0], dy = wy - c[1], dz = wz - c[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 50) {
          nearbyFeatures.push({ id: feat.featureId, type: v2.feature_type, distanceMm: Math.round(dist), riskLevel: occ.riskLevel });
        }
      }
    }
    nearbyFeatures.sort((a, b) => a.distanceMm - b.distanceMm);

    const riskLevel: 'critical' | 'high' | 'medium' | 'low' =
      riskValue > 0.75 ? 'critical' : riskValue > 0.50 ? 'high' : riskValue > 0.25 ? 'medium' : 'low';

    const IMPACT_MAP: Record<string, { label: string; severity: 'critical' | 'high' | 'medium' | 'low' }> = {
      // Sheet metal
      EDGE_TEAR_CRITICAL:    { label: 'Edge tear / burr formation risk', severity: 'critical' },
      EDGE_TEAR_HIGH:        { label: 'Burr formation risk', severity: 'high' },
      BEND_PROXIMITY_HIGH:   { label: 'Hole distortion at bend line', severity: 'high' },
      BEND_PROXIMITY_WARNING:{ label: 'Potential hole distortion near bend', severity: 'medium' },
      CLUSTER_DENSE:         { label: 'Tool wear concentration', severity: 'high' },
      PUNCH_INTERFERENCE:    { label: 'Punch interference / web collapse risk', severity: 'high' },
      CRACK_RISK:            { label: 'Crack / fracture at bend', severity: 'critical' },
      FLANGE_TEAR:           { label: 'Flange edge tear risk', severity: 'high' },
      SPRINGBACK_COMPOUND:   { label: 'Springback / angular deviation', severity: 'medium' },
      BEND_HOLE_PROXIMITY:   { label: 'Hole elongation at bend', severity: 'high' },
      // CNC
      LD_CRITICAL:           { label: 'Very deep hole (L/D > 8) — chip evacuation critical', severity: 'critical' },
      LD_HIGH:               { label: 'Deep hole (L/D > 5) — peck drilling required', severity: 'high' },
      LD_MEDIUM:             { label: 'Moderate hole depth (L/D > 3)', severity: 'medium' },
      TAPPED:                { label: 'Tapped hole — tap breakage risk increases with L/D', severity: 'medium' },
      SMALL_BORE:            { label: 'Small diameter bore — fragile drill, slow feed required', severity: 'medium' },
    };

    const REC_MAP: Record<string, { label: string; priority: 'high' | 'medium' | 'low' }> = {
      // Sheet metal
      EDGE_TEAR_CRITICAL:    { label: 'Increase edge clearance to ≥ 1× sheet thickness', priority: 'high' },
      EDGE_TEAR_HIGH:        { label: 'Increase edge clearance to ≥ 1× sheet thickness', priority: 'medium' },
      BEND_PROXIMITY_HIGH:   { label: 'Move hole ≥ 2× material thickness from bend line', priority: 'high' },
      BEND_PROXIMITY_WARNING:{ label: 'Move hole ≥ 2× material thickness from bend line', priority: 'medium' },
      CLUSTER_DENSE:         { label: 'Reduce local feature density or use gang punch tooling', priority: 'medium' },
      PUNCH_INTERFERENCE:    { label: 'Increase hole spacing to ≥ 2× hole diameter', priority: 'high' },
      CRACK_RISK:            { label: 'Increase bend radius to ≥ 1× material thickness', priority: 'high' },
      FLANGE_TEAR:           { label: 'Increase flange height to ≥ 1× material thickness', priority: 'high' },
      SPRINGBACK_COMPOUND:   { label: 'Compensate for springback with overbend correction', priority: 'medium' },
      BEND_HOLE_PROXIMITY:   { label: 'Move hole ≥ 3× material thickness from bend line', priority: 'high' },
      // CNC
      LD_CRITICAL:           { label: 'Use peck drilling + high-pressure coolant; replace drill after 50 holes', priority: 'high' },
      LD_HIGH:               { label: 'Use peck drilling cycle; monitor chip evacuation', priority: 'high' },
      LD_MEDIUM:             { label: 'Standard drilling with coolant; verify chip clearance', priority: 'medium' },
      TAPPED:                { label: 'Use spiral-flute tap with CNC rigid tapping; inspect tap every 200 parts', priority: 'medium' },
      SMALL_BORE:            { label: 'Reduce feed rate; use centre-drill pilot; check runout', priority: 'medium' },
    };

    const impactSeen = new Map<string, { code: string; label: string; severity: 'critical' | 'high' | 'medium' | 'low' }>();
    const recSeen = new Map<string, { label: string; priority: 'high' | 'medium' | 'low' }>();

    for (const c of contributors) {
      const dfmFeat = dfmScores?.features.find((f) => f.featureId === c.featureId);
      const occ = dfmFeat?.occurrences[c.occurrenceIndex];
      if (!occ) continue;
      for (const rf of occ.riskFactors) {
        if (!impactSeen.has(rf.code)) {
          const mapped = IMPACT_MAP[rf.code] ?? { label: rf.label, severity: 'medium' as const };
          impactSeen.set(rf.code, { code: rf.code, ...mapped });
        }
        if (!recSeen.has(rf.code) && REC_MAP[rf.code]) recSeen.set(rf.code, REC_MAP[rf.code]!);
      }
    }

    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    const priorityOrder = { high: 0, medium: 1, low: 2 } as const;
    const manufacturingImpact = Array.from(impactSeen.values())
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
    const recommendations = Array.from(recSeen.values())
      .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    setHeatmapInspector({ worldPos, riskValue, riskLevel, contributors, nearbyFeatures: nearbyFeatures.slice(0, 6), manufacturingImpact, recommendations });
  }, [heatmapSources, fg, dfmScores, heatmapLayer, costHeatmapWeights, toleranceHeatmapWeights, sustainabilityHeatmapWeights, item?.holeCount, item?.bendCount, item?.sheetThicknessMm]);

  const [recalculating, setRecalculating] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);

  // NOTE: this page deliberately does NOT auto-capture a 3D thumbnail (unlike
  // process-planning page's handleScreenshotReady). Doing so requires passing
  // onScreenshotReady into ModelViewer, which flips on WebGL's
  // preserveDrawingBuffer for this page's viewer (see edrawings-viewer.tsx) —
  // that caused the live 3D viewer to render blank here. Until there's a
  // capture method that doesn't need persistent preserveDrawingBuffer, the
  // Excel cost report's part image only populates for parts that have been
  // opened on the process-planning page (where this already works safely).

  const handleDownloadCostReport = async () => {
    if (downloadingReport || !item?.id) return;
    setDownloadingReport(true);
    try {
      await downloadBomItemExcel(item.id, `${item.partNumber ?? item.name ?? 'cost-report'}-Cost-Report.xlsx`, { batchSize, location: factory });
    } catch (e) {
      console.error('Cost report download failed', e);
      toast.error('Failed to download cost report');
    } finally {
      setDownloadingReport(false);
    }
  };

  const handleRecalculateCost = async () => {
    if (recalculating) return;
    setRecalculating(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['bom-items', itemId, 'cost-summary'] });
      await queryClient.invalidateQueries({ queryKey: ['bom-items', itemId, 'route-comparison'] });
      toast.success('Cost recalculated');
    } finally {
      setRecalculating(false);
    }
  };

  const handleRefreshAnalysis = async () => {
    if (!item?.file3dPath || refreshing) return;
    setRefreshing(true);
    try {
      await apiClient.post(`/bom-items/${itemId}/reanalyze`, {}, { timeout: 150_000 });
      // Also re-run 2D drawing-intelligence extraction (title block, thread
      // callouts, etc. — cad-engine/drawing_analyzer.py) when a PDF drawing
      // exists, so one "Refresh Analysis" click refreshes everything this
      // part knows about itself, not just the 3D geometry. Vector-PDF only;
      // non-fatal — a drawing-parse failure must never block the geometry
      // refresh that already succeeded above.
      if (item.file2dPath?.toLowerCase().endsWith('.pdf')) {
        try {
          await apiClient.post(`/bom-items/${itemId}/analyze-drawing`, {}, { timeout: 60_000 });
          // P0.6: analyze-drawing rewrites bom_items.drawing_intelligence, which
          // gdt-analysis reads directly — without this, a re-parsed drawing's
          // new tolerance callouts/general-tolerance block kept showing the
          // PRE-reanalysis GD&T severity/inspection recommendation in the same
          // session (10-min staleTime, no window-focus refetch). Same defect
          // shape as the dfm-scores cache gap fixed in P0.5, just on this
          // endpoint's own dependency (drawing_intelligence, not featureGraph).
          queryClient.invalidateQueries({ queryKey: ['bom-items', itemId, 'gdt-analysis'] });
        } catch (e: unknown) {
          toast.error(`Drawing analysis failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['bom-items', 'detail', itemId] });
      queryClient.invalidateQueries({ queryKey: ['bom-items', itemId, 'dfm-scores'] });
      // Reanalyze rewrites featureGraph (geometry, bend lengths, etc.) but
      // cost-summary/route-comparison are SEPARATE queries computed from that
      // same featureGraph — without invalidating them too, every derived
      // number (machine selection, tonnage, cycle times, pricing) kept
      // showing the pre-reanalyze result until an unrelated full page reload
      // happened to refetch them. Matches the same invalidation pair already
      // used by handleApplyRoute/handleCostOverride elsewhere on this page.
      queryClient.invalidateQueries({ queryKey: ['bom-items', itemId, 'cost-summary'] });
      queryClient.invalidateQueries({ queryKey: ['bom-items', itemId, 'route-comparison'] });
      toast.success('Analysis refreshed');
    } catch (e: unknown) {
      toast.error(`Refresh failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!item?.file3dPath) return;
    let cancelled = false;
    setFile3dUrl(null);
    setFile3dUrlError(null);
    apiClient.get<{ url: string }>(`/bom-items/${itemId}/file-url/3d`)
      .then((r) => {
        if (cancelled) return;
        if (r?.url) setFile3dUrl(r.url);
        else setFile3dUrlError('No 3D model URL returned by server');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Previously this catch swallowed every failure (timeout, expired signed
        // URL, 404, auth error) leaving file3dUrl permanently null with no
        // feedback — the UI would show "Loading 3D model…" forever since that
        // placeholder has no error state of its own. Surface the failure so the
        // user gets a message + retry instead of an infinite silent hang.
        const message = e instanceof ApiError ? e.getUserMessage() : 'Failed to load 3D model URL';
        setFile3dUrlError(message);
      });
    return () => { cancelled = true; };
  }, [itemId, item?.file3dPath, file3dUrlRetryToken]);

  useEffect(() => {
    if (!item?.file2dPath) { setFile2dUrl(null); return; }
    let blobUrl: string | null = null;
    apiClient.get<{ url: string }>(`/bom-items/${itemId}/file-url/2d`)
      .then(async (r) => {
        if (!r?.url) return;
        // Fetch as blob to bypass Supabase X-Frame-Options header
        const resp = await fetch(r.url);
        const blob = await resp.blob();
        blobUrl = URL.createObjectURL(blob);
        setFile2dUrl(blobUrl);
      })
      .catch(() => {});
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [itemId, item?.file2dPath]);

  const toggleNode = (id: string) => setExpandedNodes((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleTreeSelect = useCallback((node: ProcessTreeNode) => {
    // A prior click on a Cost-tab "Feature breakdown" row (Cut path, Pierces...)
    // sets selectedDirectV2Feature, which wins top priority in the selectedV2Feature
    // memo — without clearing it here, it permanently masks every later Process
    // Tree selection (e.g. clicking a hole group would silently keep showing the
    // old cut-path highlight instead of that group's own occurrences).
    setSelectedDirectV2Feature(null);
    setSelectedNodeId(node.id);
    const v2Features = fg?.feature_graph_v2?.features ?? [];
    const fm = faceMap ?? [];
    if (node.kind === 'operation') {
      const visual = computeOperationVisual(node.label, v2Features, fm);
      setOperationVisual(visual);
      setVizLabel(visual ? getVizLabel(node) : null);
    } else if (node.kind === 'feature') {
      if (node.id.startsWith('cnc_')) {
        const groupLabel = node.label.replace(/\s+×\d+$/, '');
        const group = CNC_FEATURE_GROUPS.find((g) => g.label === groupLabel);
        const cncFeats: any[] = (fg as any)?.cnc_features?.features ?? [];
        if (group && cncFeats.length > 0) {
          const matching = cncFeats.filter((f: any) => group.types.includes(f.type));
          if (matching.length > 0) {
            const combined: FeatureNodeV2 = {
              id: node.id,
              feature_type: 'hole' as FeatureCategory,
              occurrences: matching.map((f: any) => ({
                centroid: (f.params?.centroid as [number, number, number]) ?? [0, 0, 0],
                face_ids: (f.face_ids as number[]) ?? [],
              })),
            };
            setOperationVisual({ highlight: combined, color: '#d97706' });
            setVizLabel(getVizLabel(node));
            return;
          }
        }
        setOperationVisual(null);
        setVizLabel(null);
      } else if (node.id === 'feat_im_undercut' || node.id === 'feat_im_undrafted') {
        // IM DFM highlighting — look up matching feature from feature_graph_v2
        const targetType = node.id === 'feat_im_undercut' ? 'im_undercut' : 'im_undrafted';
        const imFeature = v2Features.find((f) => f.feature_type === targetType);
        if (imFeature) {
          setOperationVisual({
            highlight: imFeature,
            color: node.id === 'feat_im_undercut' ? '#ef4444' : '#f97316',
          });
          setVizLabel(getVizLabel(node));
        } else {
          setOperationVisual(null);
          setVizLabel(null);
        }
      } else {
        const visual = computeFeatureNodeVisual(node, v2Features, fm);
        setOperationVisual(visual);
        setVizLabel(visual ? getVizLabel(node) : null);
      }
    } else {
      setOperationVisual(null);
      setVizLabel(null);
    }
  }, [fg, faceMap]);
  const maximize = (id: PanelId | null) => setMaximized((prev) => (prev === id ? null : id));

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen text-sm text-muted-foreground">Loading…</div>;
  }
  if (!item || !summary || !tree) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Part not found.</p>
        <button onClick={() => router.push(`/projects/${projectId}/bom/${bomId}`)} className="text-sm text-primary underline">Return to BOM</button>
      </div>
    );
  }

  const cls = fg?.classification;

  const sharedHeader = (
    <header className="flex items-center gap-2 px-3 py-1.5 border-b shrink-0 bg-muted/10">
      <button onClick={() => router.push(`/projects/${projectId}/bom/${bomId}`)} className="p-1.5 rounded hover:bg-muted transition-colors shrink-0" title="Back to BOM">
        <ArrowLeft className="h-4 w-4" />
      </button>

      {/* Part name + number */}
      <div className="flex items-baseline gap-2 min-w-0 shrink mr-2">
        <h1 className="text-sm font-semibold truncate shrink-0 max-w-[200px]">{item.name}</h1>
        {item.partNumber && (
          <span className="text-xs text-muted-foreground truncate">{item.partNumber}</span>
        )}
      </div>

      {cls && (
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border shrink-0 ${confidenceCls(cls.confidence ?? 0)}`}>
          {familyLabel(cls.family)}{cls.confidence != null ? ` · ${Math.round(cls.confidence * 100)}%` : ''}
        </span>
      )}

      <div className="w-px h-4 bg-border mx-0.5 shrink-0" />

      {/* Action buttons */}
      <button
        onClick={handleRefreshAnalysis}
        disabled={refreshing || !item?.file3dPath}
        className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border border-border hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
      >
        <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
        Refresh Analysis
        {isStale && !refreshing && <span className="text-amber-500 ml-0.5">⚠</span>}
      </button>
      <button
        onClick={handleRecalculateCost}
        disabled={recalculating}
        className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border border-border hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
      >
        <Calculator className={`h-3 w-3 ${recalculating ? 'animate-spin' : ''}`} />
        Recalculate Cost
      </button>
      <button disabled className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border border-border opacity-40 cursor-not-allowed shrink-0">
        <ShieldCheck className="h-3 w-3" />
        Re-run DFM
      </button>
      <button disabled className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border border-border opacity-40 cursor-not-allowed shrink-0">
        Compare Versions
      </button>
      <button
        onClick={handleDownloadCostReport}
        disabled={downloadingReport}
        title="Download Part Cost Report (.xlsx)"
        className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border border-border hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
      >
        {downloadingReport
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : <FileSpreadsheet className="h-3 w-3" />}
        Download Cost Report
      </button>

      <div className="w-px h-4 bg-border mx-0.5 shrink-0" />

      <button
        onClick={() => { setHeatmapMode((m) => !m); setHeatmapInspector(null); }}
        disabled={!fg?.feature_graph_v2}
        title={fg?.feature_graph_v2 ? 'Toggle heatmap overlay' : 'Upload and analyze a 3D model to enable heatmaps'}
        className={cn(
          'flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border transition-colors shrink-0',
          heatmapMode ? 'bg-blue-600 text-white border-blue-500' : 'border-border hover:bg-muted',
          !fg?.feature_graph_v2 && 'opacity-40 cursor-not-allowed',
        )}
      >
        <Flame className="h-3 w-3" />
        Heatmap
      </button>

      {heatmapMode && (
        <select
          value={heatmapLayer}
          onChange={(e) => { setHeatmapLayer(e.target.value as HeatmapLayerType); setHeatmapInspector(null); }}
          className="text-[10px] bg-background border border-border text-foreground rounded px-1.5 py-0.5 shrink-0"
        >
          <option value="manufacturing_risk">Manufacturing Risk</option>
          <option value="tool_wear">Tooling Stress</option>
          <option value="thermal">Heat Concentration</option>
          <option value="cost_density">Cost Density</option>
          <option value="tolerance_risk">Tolerance Sensitivity (Beta)</option>
          <option value="sustainability">Sustainability Impact (Beta)</option>
          {isInjectionMolded && <option value="sink_mark">Sink Mark Risk (IM)</option>}
        </select>
      )}
    </header>
  );

  const actionToolbar = null;

  const heatmapLegend = heatmapMode && heatmapSources.length > 0 ? (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b bg-slate-950/60 shrink-0">
      <div className="flex flex-col gap-0.5">
        <div className="h-2 w-36 rounded-sm" style={{ background: 'linear-gradient(to right, #22c55e, #eab308, #f97316, #ef4444)' }} />
        <div className="flex justify-between text-[9px] text-muted-foreground w-36">
          <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
        </div>
      </div>
      <div className="flex gap-1">
        {(['absolute', 'relative'] as const).map((mode) => (
          <button key={mode} onClick={() => setHeatmapNorm(mode)}
            className={cn('px-1.5 py-0.5 rounded border text-[9px] capitalize',
              heatmapNorm === mode ? 'bg-slate-600 text-white border-slate-500' : 'text-muted-foreground border-border hover:bg-muted')}>
            {mode}
          </button>
        ))}
      </div>
      <span className="text-[9px] text-muted-foreground">
        {isInjectionMolded
          ? (heatmapLayer === 'manufacturing_risk' ? 'Wall variation, rib/boss risk, draft defects & undercuts'
            : heatmapLayer === 'tool_wear' ? 'Core slenderness, side-action stress & injection pressure'
            : heatmapLayer === 'thermal' ? 'Heat concentration: boss bases, thick walls & rib junctions'
            : heatmapLayer === 'cost_density' ? 'Cooling time, tool complexity & material volume drivers'
            : heatmapLayer === 'tolerance_risk' ? 'Warpage, differential shrinkage & ejection distortion'
            : heatmapLayer === 'sink_mark' ? 'Sink mark probability: rib/wall ratio, boss diameter & thick zones'
            : 'Cooling energy, material volume & regrind complexity')
          : heatmapLayer === 'cost_density'
          ? (heatmapNorm === 'relative' ? 'Cost — scaled to highest zone' : 'Cost intensity (Low → High)')
          : heatmapLayer === 'tolerance_risk'
          ? (heatmapNorm === 'relative' ? 'Tolerance — scaled to tightest zone' : 'Tolerance sensitivity (Low → High)')
          : heatmapLayer === 'sustainability'
          ? (heatmapNorm === 'relative' ? 'CO₂ — scaled to highest zone' : 'CO₂ intensity (Low → High)')
          : heatmapLayer === 'thermal'
          ? (heatmapNorm === 'relative' ? 'Heat concentration — scaled to densest zone' : 'Heat concentration proxy (Low → High)')
          : heatmapLayer === 'tool_wear'
          ? (heatmapNorm === 'relative' ? 'Tooling stress — scaled to worst zone' : 'Tooling stress proxy (Low → High)')
          : (heatmapNorm === 'relative' ? 'Scaled to worst area' : 'Absolute risk (0–100)')}
      </span>
    </div>
  ) : null;

  const heatmapInspectorPanel = heatmapInspector && heatmapMode ? (
    <div className="border border-blue-800/60 rounded-md bg-slate-900 p-3 text-xs mb-3 shrink-0">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-slate-200 text-[11px]">Heatmap Inspector</span>
        <button onClick={() => setHeatmapInspector(null)} className="text-slate-500 hover:text-slate-300 text-[10px] leading-none">✕</button>
      </div>

      {/* Score bar */}
      <div className="mb-3">
        <div className="flex justify-between text-slate-400 mb-1 text-[10px]">
          <span>
            {isInjectionMolded
              ? (heatmapLayer === 'thermal' ? 'Heat concentration at location'
                : heatmapLayer === 'tool_wear' ? 'Tooling stress at location'
                : heatmapLayer === 'cost_density' ? 'Cost intensity at location'
                : heatmapLayer === 'tolerance_risk' ? 'Warpage / shrinkage risk at location'
                : heatmapLayer === 'sustainability' ? 'Cooling energy at location'
                : heatmapLayer === 'sink_mark' ? 'Sink mark probability at location'
                : 'Manufacturing risk at location')
              : heatmapLayer === 'cost_density' ? 'Cost intensity at location'
              : heatmapLayer === 'tolerance_risk' ? 'Tolerance sensitivity at location'
              : heatmapLayer === 'sustainability' ? 'CO₂ intensity at location'
              : heatmapLayer === 'thermal' ? 'Heat concentration at location'
              : heatmapLayer === 'tool_wear' ? 'Tooling stress at location'
              : 'Risk at location'}
          </span>
          <span className={cn('font-bold capitalize',
            heatmapInspector.riskLevel === 'critical' ? 'text-red-400' : heatmapInspector.riskLevel === 'high' ? 'text-orange-400'
            : heatmapInspector.riskLevel === 'medium' ? 'text-yellow-400' : 'text-green-400')}>
            {Math.round(heatmapInspector.riskValue * 100)} / 100 · {heatmapInspector.riskLevel}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
          <div className="h-full rounded-full" style={{
            width: `${heatmapInspector.riskValue * 100}%`,
            background: 'linear-gradient(to right, #22c55e, #eab308, #f97316, #ef4444)',
            backgroundSize: '400px 100%',
            backgroundPosition: `${-400 * (1 - heatmapInspector.riskValue)}px 0`,
          }} />
        </div>
      </div>

      {/* Dominant contributors */}
      {heatmapInspector.contributors.length > 0 && (
        <div className="mb-2">
          <div className="text-slate-400 text-[10px] mb-1 font-medium">Dominant Contributors</div>
          {heatmapInspector.contributors.map((c, i) => (
            <div key={i} className="flex items-start gap-1 text-slate-300 text-[10px] py-0.5">
              <span className="shrink-0 mt-0.5">•</span>
              <span className="flex-1 min-w-0 truncate">{c.label}</span>
              <span className="tabular-nums text-slate-400 shrink-0">{c.contributionPct}%</span>
              <span
                className="shrink-0 flex gap-px"
                title={c.confidence === 'measured' ? 'From CAD geometry' : c.confidence === 'heuristic' ? 'Physics estimate' : 'Global proxy'}
              >
                {([0, 1, 2] as const).map((j) => (
                  <span key={j} className={cn('text-[7px]',
                    c.confidence === 'measured' ? 'text-emerald-400'
                    : c.confidence === 'heuristic' && j < 2 ? 'text-yellow-400'
                    : c.confidence === 'signal' && j < 1 ? 'text-slate-500'
                    : 'text-slate-700')}>●</span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Manufacturing impact / Cost drivers */}
      {heatmapInspector.manufacturingImpact.length > 0 && (
        <div className="mb-2">
          <div className="text-slate-400 text-[10px] mb-1 font-medium">
            {heatmapLayer === 'cost_density' ? 'Cost Drivers'
              : heatmapLayer === 'tolerance_risk' ? 'Tolerance Impact'
              : heatmapLayer === 'sustainability' ? 'CO₂ Drivers'
              : heatmapLayer === 'thermal' ? 'Heat Notes'
              : heatmapLayer === 'tool_wear' ? 'Tooling Notes'
              : heatmapLayer === 'sink_mark' ? 'Sink Mark Analysis'
              : 'Manufacturing Impact'}
          </div>
          {heatmapInspector.manufacturingImpact.map((imp, i) => (
            <div key={i} className="flex items-start gap-1 text-[10px] py-0.5">
              <span className={cn('mt-0.5 shrink-0',
                imp.severity === 'critical' ? 'text-red-400' : imp.severity === 'high' ? 'text-orange-400'
                : imp.severity === 'medium' ? 'text-yellow-400' : 'text-green-400')}>▲</span>
              <span className="text-slate-300">{imp.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Recommendations */}
      {heatmapInspector.recommendations.length > 0 && (
        <div className="mb-2">
          <div className="text-slate-400 text-[10px] mb-1 font-medium">Recommendations</div>
          {heatmapInspector.recommendations.map((rec, i) => (
            <div key={i} className="flex items-start gap-1 text-[10px] py-0.5">
              <span className={cn('mt-0.5 shrink-0',
                rec.priority === 'high' ? 'text-blue-400' : rec.priority === 'medium' ? 'text-slate-400' : 'text-slate-600')}>→</span>
              <span className="text-slate-300">{rec.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Nearby features */}
      {heatmapInspector.nearbyFeatures.length > 0 && (
        <div className="mb-2">
          <div className="text-slate-400 text-[10px] mb-1 font-medium">Nearby Features</div>
          {heatmapInspector.nearbyFeatures.map((f, i) => (
            <div key={i} className="flex justify-between text-slate-300 text-[10px] py-0.5">
              <span>• {f.type} — {f.distanceMm}mm</span>
              <span className={cn('capitalize',
                f.riskLevel === 'critical' ? 'text-red-400' : f.riskLevel === 'high' ? 'text-orange-400'
                : f.riskLevel === 'medium' ? 'text-yellow-400' : 'text-green-400')}>
                {f.riskLevel}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Bridge to Vendor Network tab */}
      {treeProcessNames.length > 0 && (
        <button
          onClick={() => {
            setRightTab('vendor_network');
            setVendorHotspotContext({ layer: heatmapLayer, riskLevel: heatmapInspector.riskLevel });
            rightPanelScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="w-full mt-1 text-[9px] text-violet-400 hover:text-violet-300 border border-violet-800/50 hover:border-violet-600/60 rounded px-2 py-1 transition-colors text-left"
        >
          Find vendors for this risk → Vendor Network
        </button>
      )}
    </div>
  ) : null;

  // Shared by both panels' "click a detected feature to highlight it in the 3D
  // viewer" rows (Cost tab's Feature breakdown, and the Cost Guide's Detected
  // Geometry section) — one selection state, so highlighting from either panel
  // behaves identically.
  const onSelectHighlight = (node: FeatureNodeV2 | null) => {
    setSelectedNodeId(null);
    setSelectedDirectV2Feature(node);
    setSelectedOccurrenceIndex(null);
  };
  const costGuideProps = {
    item, fg, summary, batchSize, setBatchSize, productionLife, setProductionLife,
    processRouting, setProcessRouting, factory, setFactory,
    factoryDraft, setFactoryDraft, batchSizeDraft, setBatchSizeDraft,
    applyScenario,
    onManualClick: () => setRouteDialogOpen(true),
    selectedManualRoute, onSelectHighlight,
    dfmScores,
  };
  const analysisProps = {
    projectId,
    item, fg, batchSize, productionLife, factory,
    selectedCNCFeatureKey, onCNCFeatureSelect: setSelectedCNCFeatureKey,
    file3dUrl,
    activeTab: rightTab, onTabChange: setRightTab,
    treeProcessNames, vendorHotspotContext,
    onSelectHighlight,
  };
  const treeProps = { item, fg, tree, expanded: expandedNodes, selectedId: selectedNodeId, onToggle: toggleNode, onSelect: handleTreeSelect, factory, maximized, onMaximize: maximize };
  const driversProps = { tree, summary, fg, selectedId: selectedNodeId, onSelect: setSelectedNodeId, maximized, onMaximize: maximize, selectedHoleGroup, selectedBend, dfmWarnings: fg?.dfmWarnings ?? [], item };

  // ── Maximized view ──────────────────────────────────────────────────────────
  if (maximized) {
    const needsOuterHeader = maximized === 'left' || maximized === 'center' || maximized === 'right';
    const outerTitle: Partial<Record<PanelId, string>> = { left: 'Cost Guide', center: '3D Viewer', right: 'Analysis' };

    return (
      <div className="flex flex-col h-screen bg-background">
        {sharedHeader}
        {actionToolbar}
        {heatmapLegend}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {needsOuterHeader && (
            <PanelHeader title={outerTitle[maximized] ?? ''} panelId={maximized} maximized={maximized} onMaximize={maximize} />
          )}
          <div className="flex-1 overflow-hidden min-h-0 [&>div]:min-h-0 flex flex-col">
            {maximized === 'left' && <CostGuidePanel {...costGuideProps} />}
            {maximized === 'center' && (
              viewerTab === '2d' && file2dUrl
                ? <iframe key={file2dUrl} src={file2dUrl} className="w-full h-full border-0" title="2D Drawing" />
                : file3dUrl
                  ? <ModelViewer key={file3dUrl} fileUrl={file3dUrl} fileName={(item.file3dPath?.split('/').pop() ?? 'model').replace(/^\d+_/, '')} fileType={item.file3dPath?.split('.').pop() ?? 'stl'} bomItemId={item.id}
                      highlightOccurrences={operationVisual?.highlight ?? selectedV2Feature}
                      {...(operationVisual?.color ? { highlightColor: operationVisual.color } : {})}
                      selectedOccurrenceIndex={selectedOccurrenceIndex}
                      onOccurrenceSelect={setSelectedOccurrenceIndex}
                      faceMap={faceMap}
                      sheetThickness={item.sheetThicknessMm ?? 0}
                      {...(selectedFeatureScores !== undefined && !operationVisual ? { dfmOccurrenceScores: selectedFeatureScores } : {})}
                      heatmapActive={heatmapMode}
                      heatmapSources={heatmapSources}
                      heatmapNormalization={heatmapNorm}
                      onHeatmapInspect={handleHeatmapInspect}
                      nestQuantity={batchSize}
                      nestSheetWidthMm={costForHeatmap?.blankSpec?.sheetWidthMm}
                      nestSheetLengthMm={costForHeatmap?.blankSpec?.sheetLengthMm}
                      nestMaterialLabel={item.material ?? undefined}
                      nestGradeLabel={item.materialGrade ?? undefined}
                      flatPatternPartName={item.partName ?? item.name}
                      flatPatternOutlinePointsMm={item.featureGraph?.summary?.flatPatternOutlinePointsMm}
                      flatPatternHolesMm={item.featureGraph?.summary?.flatPatternHolesMm}
                      flatPatternOutlineSource={item.featureGraph?.summary?.flatPatternOutlineSource}
                      flatPatternBoundingLengthMm={item.featureGraph?.summary?.flatPatternBoundingLengthMm}
                      flatPatternBoundingWidthMm={item.featureGraph?.summary?.flatPatternBoundingWidthMm}
                      flatPatternCutLengthMm={item.cutLengthMm}
                      flatPatternBendCount={item.bendCount}
                      flatPatternHoleCount={item.holeCount}
                      flatPatternPierceCount={item.pierceCount}
                      flatPatternAreaMm2={item.flatPatternAreaMm2}
                    />
                  : <div className="flex flex-col items-center justify-center h-full gap-2 text-sm text-muted-foreground">
                      <span>{!item.file3dPath ? 'No 3D model' : file3dUrlError ? file3dUrlError : 'Loading…'}</span>
                      {item.file3dPath && file3dUrlError && (
                        <button
                          type="button"
                          onClick={() => { setFile3dUrlError(null); setFile3dUrlRetryToken((n) => n + 1); }}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Retry
                        </button>
                      )}
                    </div>
            )}
            {maximized === 'right' && <AnalysisTabsPanel {...analysisProps} />}
            {maximized === 'process' && <ProcessTreePanel {...treeProps} />}
            {maximized === 'drivers' && <GeometricCostDriversPanel {...driversProps} />}
          </div>
        </div>
        <RouteSelectionDialog
          open={routeDialogOpen}
          onClose={() => {
            setRouteDialogOpen(false);
            if (!selectedManualRoute) setProcessRouting('auto');
          }}
          onApplied={() => setRouteDialogOpen(false)}
          partFamily={fg?.classification?.family ?? null}
          currentRouteId={selectedManualRoute?.id ?? null}
          existingCuttingRouteId={selectedManualRoute?.dynamicCuttingRouteId ?? null}
          existingSteps={selectedManualRoute?.dynamicSteps}
          onSelectRoute={(route) => {
            // Staging only — nothing is written here. Apply Scenario performs
            // the real apply-route/apply-custom-route call (plus any pending
            // machine overrides) using whatever Digital Factory/Batch Size is
            // current at that moment. See the parent's applyScenario.
            setSelectedManualRoute(route);
            setProcessRouting('manual');
          }}
          cost={costForHeatmap ?? null}
          scoringCtx={summary && item ? { summary, item, batchSize: scenarioDirty ? batchSizeDraft : batchSize } : null}
          factory={scenarioDirty ? factoryDraft : factory}
          itemId={item?.id}
          batchSize={scenarioDirty ? batchSizeDraft : batchSize}
        />
      </div>
    );
  }

  // ── Default workbench layout ────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-background">
      {sharedHeader}
      {actionToolbar}
      {heatmapLegend}

      <div className="flex-1 overflow-hidden min-h-0">
        <PanelGroup id="mi-root" direction="horizontal" className="h-full">

          {/* LEFT: Cost Guide + 3D Viewer + Process Tree */}
          <Panel defaultSize={67} minSize={40} className="flex flex-col overflow-hidden">
            <PanelGroup id="mi-left-col" direction="vertical" className="h-full">

              {/* TOP ROW — 3D viewer + Cost Guide */}
              <Panel defaultSize={65} minSize={30}>
                <PanelGroup id="mi-top-row" direction="horizontal" className="h-full">

                  {/* Cost Guide */}
                  <Panel defaultSize={30} minSize={18} className="flex flex-col border-r overflow-hidden">
                    <PanelHeader title="Cost Guide" panelId="left" maximized={maximized} onMaximize={maximize} />
                    <div className="flex-1 overflow-hidden min-h-0">
                      <CostGuidePanel {...costGuideProps} />
                    </div>
                  </Panel>

                  <HResizeHandle />

                  {/* 3D / 2D Viewer */}
                  <Panel defaultSize={70} minSize={30} className="flex flex-col overflow-hidden">
                    <PanelHeader title="Viewer" panelId="center" maximized={maximized} onMaximize={maximize}>
                      <div className="flex items-center gap-2 min-w-0 w-full">
                        {/* filename — truncates if needed */}
                        <span className="text-[11px] text-muted-foreground truncate flex-1 min-w-0">
                          {viewerTab === '3d'
                            ? (vizLabel ? `Showing: ${vizLabel}` : (item.file3dPath?.split('/').pop() ?? '').replace(/^\d+_/, '').replace(/_/g, ' '))
                            : (item.file2dPath?.split('/').pop() ?? '').replace(/^\d+_/, '').replace(/_/g, ' ')}
                        </span>
                        {/* 3D / 2D tab pills — right-aligned, only shown when 2D drawing exists */}
                        {file2dUrl && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => setViewerTab('3d')}
                              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                                viewerTab === '3d'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                              }`}
                            >
                              3D
                            </button>
                            <button
                              type="button"
                              onClick={() => setViewerTab('2d')}
                              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                                viewerTab === '2d'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                              }`}
                            >
                              2D
                            </button>
                          </div>
                        )}
                      </div>
                    </PanelHeader>
                    <div className="flex-1 overflow-hidden min-h-0 bg-muted/10 [&>div]:min-h-0">
                      {viewerTab === '3d' ? (
                        file3dUrl ? (
                          <ModelViewer key={file3dUrl} fileUrl={file3dUrl}
                            fileName={(item.file3dPath?.split('/').pop() ?? 'model').replace(/^\d+_/, '')}
                            fileType={item.file3dPath?.split('.').pop() ?? 'stl'}
                            bomItemId={item.id}
                            highlightOccurrences={operationVisual?.highlight ?? selectedV2Feature}
                            {...(operationVisual?.color ? { highlightColor: operationVisual.color } : {})}
                            selectedOccurrenceIndex={selectedOccurrenceIndex}
                            onOccurrenceSelect={setSelectedOccurrenceIndex}
                            faceMap={faceMap}
                            sheetThickness={item.sheetThicknessMm ?? 0}
                            {...(selectedFeatureScores !== undefined && !operationVisual ? { dfmOccurrenceScores: selectedFeatureScores } : {})}
                            heatmapActive={heatmapMode}
                            heatmapSources={heatmapSources}
                            heatmapNormalization={heatmapNorm}
                            onHeatmapInspect={handleHeatmapInspect}
                            nestQuantity={batchSize}
                            nestSheetWidthMm={costForHeatmap?.blankSpec?.sheetWidthMm}
                            nestSheetLengthMm={costForHeatmap?.blankSpec?.sheetLengthMm}
                            nestMaterialLabel={item.material ?? undefined}
                            nestGradeLabel={item.materialGrade ?? undefined}
                            flatPatternPartName={item.partName ?? item.name}
                            flatPatternOutlinePointsMm={item.featureGraph?.summary?.flatPatternOutlinePointsMm}
                            flatPatternHolesMm={item.featureGraph?.summary?.flatPatternHolesMm}
                            flatPatternOutlineSource={item.featureGraph?.summary?.flatPatternOutlineSource}
                            flatPatternBoundingLengthMm={item.featureGraph?.summary?.flatPatternBoundingLengthMm}
                            flatPatternBoundingWidthMm={item.featureGraph?.summary?.flatPatternBoundingWidthMm}
                            flatPatternCutLengthMm={item.cutLengthMm}
                            flatPatternBendCount={item.bendCount}
                            flatPatternHoleCount={item.holeCount}
                            flatPatternPierceCount={item.pierceCount}
                            flatPatternAreaMm2={item.flatPatternAreaMm2}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                            <AlertCircle className="h-8 w-8 opacity-30" />
                            <span className="text-sm">
                              {!item.file3dPath
                                ? 'No 3D model attached'
                                : file3dUrlError
                                  ? file3dUrlError
                                  : 'Loading 3D model…'}
                            </span>
                            {item.file3dPath && file3dUrlError && (
                              <button
                                type="button"
                                onClick={() => { setFile3dUrlError(null); setFile3dUrlRetryToken((n) => n + 1); }}
                                className="text-xs font-medium text-primary hover:underline"
                              >
                                Retry
                              </button>
                            )}
                          </div>
                        )
                      ) : (
                        file2dUrl ? (
                          <iframe
                            key={file2dUrl}
                            src={file2dUrl}
                            className="w-full h-full border-0"
                            title="2D Drawing"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                            <AlertCircle className="h-8 w-8 opacity-30" />
                            <span className="text-sm">No 2D drawing attached</span>
                          </div>
                        )
                      )}
                    </div>
                  </Panel>

                </PanelGroup>
              </Panel>

              <VResizeHandle />

              {/* BOTTOM: Process Tree + Geometric Cost Drivers */}
              <Panel defaultSize={35} minSize={15} className="flex overflow-hidden border-t">
                <PanelGroup id="mi-bottom-row" direction="horizontal" className="h-full w-full">

                  <Panel defaultSize={55} minSize={25} className="flex flex-col overflow-hidden">
                    <ProcessTreePanel {...treeProps} />
                  </Panel>

                  <HResizeHandle />

                  <Panel defaultSize={45} minSize={18} className="flex flex-col overflow-hidden">
                    <GeometricCostDriversPanel {...driversProps} />
                  </Panel>

                </PanelGroup>
              </Panel>

            </PanelGroup>
          </Panel>

          <HResizeHandle />

          {/* RIGHT: Analysis — full height */}
          <Panel defaultSize={33} minSize={18} className="flex flex-col overflow-hidden border-l">
            <PanelHeader title="Analysis" panelId="right" maximized={maximized} onMaximize={maximize} />
            <div ref={rightPanelScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
              {heatmapInspectorPanel && <div className="p-2">{heatmapInspectorPanel}</div>}
              <AnalysisTabsPanel {...analysisProps} />
            </div>
          </Panel>

        </PanelGroup>
      </div>
      <RouteSelectionDialog
        open={routeDialogOpen}
        onClose={() => {
          setRouteDialogOpen(false);
          if (!selectedManualRoute) setProcessRouting('auto');
        }}
        onApplied={() => setRouteDialogOpen(false)}
        partFamily={fg?.classification?.family ?? null}
        currentRouteId={selectedManualRoute?.id ?? null}
        existingCuttingRouteId={selectedManualRoute?.dynamicCuttingRouteId ?? null}
        existingSteps={selectedManualRoute?.dynamicSteps}
        onSelectRoute={(route) => {
          // Staging only — nothing is written here. Apply Scenario performs
          // the real apply-route/apply-custom-route call (plus any pending
          // machine overrides) using whatever Digital Factory/Batch Size is
          // current at that moment. See the parent's applyScenario.
          setSelectedManualRoute(route);
          setProcessRouting('manual');
        }}
        cost={costForHeatmap ?? null}
        scoringCtx={summary && item ? { summary, item, batchSize: scenarioDirty ? batchSizeDraft : batchSize } : null}
        factory={scenarioDirty ? factoryDraft : factory}
        itemId={item?.id}
        batchSize={scenarioDirty ? batchSizeDraft : batchSize}
      />
    </div>
  );
}
