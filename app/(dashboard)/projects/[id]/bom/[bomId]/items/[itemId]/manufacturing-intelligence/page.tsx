'use client';

import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
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
import { MachineSpecPanel } from '@/components/features/manufacturing-intelligence/MachineSpecPanel';
import { RouteCompareList } from '@/components/features/workflow/RouteCompareList';
import { RouteStepEditor } from '@/components/features/workflow/RouteStepEditor';
import type { AddOperationOption } from '@/components/features/workflow/AddOperationPicker';
import { adaptRoutesToTree, RouteTreeValidationError, type RouteNode } from '@/lib/routing/route-tree';
import { selectTopRoutes, type RouteSortMode } from '@/lib/routing/route-sort';
import type { WorkflowRouteStep } from '@/lib/routing/route-step';
import { sequenceProcessRows } from '@/lib/routing/process-sequence';
import {
  resolveStoredProcessLines,
  selectProcessTotal,
  type StoredProcessRow,
} from '@/lib/costing/stored-process-lines';
import { resolveLineSetup, roundSetupMinutes } from '@/lib/costing/process-line-setup';
import { deriveMaterialUsage } from '@/lib/costing/material-usage';
import { toast } from 'sonner';
import { ModelViewer } from '@/components/ui/model-viewer';
import { useBOMItem, useAnalysisVersion, useDFMScores, useMaterialIntelligence, useMaterialDensity, useUpdateBOMItem, usePatchScenarioOverrides, useCostSummary, useRouteComparison, useGdtAnalysis, useCostOverride, useApplyRoute, useApplyCustomRoute, useMachineOverride, costSummaryQueryKey, costSummaryUrl, type BlankSpecDto, type InjectionMoldingBreakdown, type ProcessLineCost, type ApplyCustomRouteStep } from '@/lib/api/hooks/useBOMItems';
import { useMHRRecords, useMHRRecord } from '@/lib/api/hooks/useMHR';
import { mhrCategoryOf } from '@/lib/utils/mhrCategoryOf';
import { groupFeaturesByType, featureSelectionKey, resolveFeatureSelection, findFeatureByFaceId } from '@/lib/features/machining-feature-tree';
import { sheetMetalOperationNodes, type OperationTreeNode } from '@/lib/features/sheet-metal-operation-nodes';
import { gdtCalloutNodes } from '@/lib/features/gdt-callout-nodes';
import { effectiveProcessGroupOf } from '@/lib/processCatalog/hr-rates-process-selection';
import { useFactoryCurrency, useFactories, useCurrencies, useFxRate, useRefreshFxRate, useFxRateOnDemand, type FxRateType } from '@/lib/api/hooks/useFx';
import { useProcessCalculatorMappings } from '@/lib/api/hooks/useProcessCalculatorMappings';
import { useSmLookupTables, type ReferenceTable } from '@/lib/api/hooks/useProcesses';
import { resolveMhrUsdRate } from '@/lib/api/mhr';
import type { GdtSeverity, CostSummaryDto, RouteComparisonDto, RouteResultDto, ResolvedCostingInputs } from '@/lib/api/hooks/useBOMItems';
import { useRawMaterials } from '@/lib/api/hooks/useRawMaterials';
import { useDebounce } from '@/lib/hooks/useDebounce';
import type { RawMaterial } from '@/lib/api/hooks/useRawMaterials';
import { useCreateRawMaterialCost, useRawMaterialCosts } from '@/lib/api/hooks/useRawMaterialCosts';
import { getThreadIntelligence } from '@/lib/manufacturing-kb/thread-standards';
import { SecondaryProcessesPanel, type SecondaryHighlight } from '@/components/features/manufacturing-intelligence/SecondaryProcessesPanel';
import { useSecondaryProcesses, useNre, type SecondaryProcessLine } from '@/lib/api/hooks/useSecondaryProcesses';
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
import { isBend, isBlankProfile, isExtrudedHole, isPlainHole, type FeatureGraphEntryLike } from '@/lib/features/feature-graph';
import type { FeatureGraph, FeatureGraphSummary, DFMWarning, DFMSeverity, ValidationResult, ManufacturingFeature, HoleGroup, HoleGroupLocation, BendFeature, FeatureNodeV2, FaceMapEntry, DFMScoresResponse } from '@/lib/types/manufacturing';
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
  // A real, already-valid apply-route.dto.ts routeId (e.g. one of the 3 real
  // Injection Molding tonnage tiers) to apply directly via the plain
  // applyRoute mutation — for a family whose real routes are already
  // complete, self-contained multi-line quotes (no separate cutting +
  // additional-steps composition the way Sheet Metal's dynamic path needs).
  // Distinct from dynamicCuttingRouteId (Sheet Metal's composed-route
  // identity) — this is the real id itself, sourced straight from the backend's own
  // route-comparison result, never a second hand-kept mapping table.
  directApplyRouteId?: string;
}

interface ProcessTreeNode {
  id: string;
  kind: 'part' | 'group' | 'operation' | 'feature';
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
  // Set on CNC canonical-operation feature nodes (built from real
  // feature_graph_v2 entries carrying a backend-attached canonical_operation —
  // see canonical-operation.ts) so a click can highlight the exact matching
  // feature_graph_v2 entry by id instead of re-deriving a match by label/diameter.
  v2FeatureId?: string;
  // Machining catalog-type nodes: the exact feature_graph_v2 ids they group.
  v2FeatureIds?: string[];
  // A process that acts on the whole part surface (cleaning, NDT, packaging).
  wholePart?: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────────

// SUB_OP ("As Cut"/"As Processed"/"As Inspected"...), MACHINING_PROCESS_TO_
// FEATURE_KEYS, SURFACE_TREATMENT_KB and INSPECTION_KB were here: hand-written
// step names, coating sequences, inspection methods and machines ("Inspection
// Bench", "Powder Coat Booth", "Calipers / height gauge") shown in the process
// tree as if they were this part's data. Deleted 2026-09-27 - every node under
// an operation now comes from that operation's own cost line (featureBreakdown
// + its featureIds) or from real CAD/drawing extraction, and a step with
// neither says so instead of showing a stand-in.

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
  fg: { classification?: { family?: string | null } } | null,
): string {
  // '' = the CAD engine did not classify this part. Never defaulted to
  // 'milled': that showed every unanalysed/unclassified part as Machining.
  const family = fg?.classification?.family ?? '';
  if (family !== 'sheet_metal') return family;
  return isSheetFormableMaterial(`${item.materialGrade ?? ''} ${item.material ?? ''}`)
    ? family
    : 'milled';
}

// CATEGORY-level label (the umbrella domain a CAD family belongs to — matches
// process_taxonomy.process_group, migration 733). 'Plastic Molding' covers
// all 4 real sibling processes (Injection/Compression/Reaction Injection/
// Structural Foam Molding) — deliberately different from familyLabel()'s
// 'Injection Moulded' below, which names the SPECIFIC process. Both are
// correct at their own grain; do not "fix" one to match the other.
const FAMILY_GROUP: Record<string, string> = {
  sheet_metal: 'Sheet Metal',
  milled: 'Machining',
  turned: 'Turning',
  plastic_molded: 'Plastic Molding',
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

// KB_ROUTE_ALTERNATIVES was here: a hardcoded per-family route table (three
// sheet-metal routes, with Fiber Laser flagged isRecommended for every part)
// that seeded both the Auto route selection and the process tree's step list.
// Deleted 2026-09-07 — the backend route comparison is the only thing that
// ranks routes, and it does so from real rates and real capability across all
// registered engines. Its process names are also the canonical ones the cost
// lines carry, which this table's were not. See activeOverrideProcesses.


const RIGHT_TABS = [
  { key: 'copilot',       label: '✦ Copilot'   },
  { key: 'cost',          label: 'Cost'         },
  { key: 'validation',    label: 'Validation'   },
  { key: 'part_summary',  label: 'Part Info'    },
  { key: 'sustainability', label: 'Sustain'     },
  { key: 'detail',        label: 'Detail'       },
  { key: 'investment',    label: 'Invest'       },
  { key: 'secondary',     label: 'Secondary'    },
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
// Display-only Material/Grade split for the Material Database table.
// Root-caused live (2026-09-17): the "Generic ..." Digital Factory material
// family (memory/database/Raw_Material_Database_june.json, 509 real rows)
// was seeded with material_grade = NULL for every row — the full real name
// (e.g. "Generic Aluminum - Honeycomb (Expanded 1)") lives in the `material`
// column alone. This never touches m.material/m.materialGrade themselves
// (search, alias matching, and apply-to-BOM below all keep using the real,
// unmodified pair) — it only decides how these two columns present an
// already-real name when materialGrade is genuinely absent.
// Verified directly against all 509 real rows: 220 use ", " as a real
// Material/Grade separator, 23 use " - ". The remaining ~266 (including
// "Generic Aluminum Bronze" — a real, distinct alloy family, not "Aluminum"
// with grade "Bronze" — and single-product names like "Generic Accura 60")
// have no real separator; inventing one for those would fabricate a grade
// that doesn't exist in the source data, so they correctly keep showing
// the full name in Material with Grade as "—", same as before this split.
function splitMaterialDisplay(
  material: string,
  materialGrade?: string | null,
): { material: string; grade: string | null } {
  if (materialGrade) return { material, grade: materialGrade };
  const commaIdx = material.indexOf(',');
  if (commaIdx > 0) {
    return { material: material.slice(0, commaIdx).trim(), grade: material.slice(commaIdx + 1).trim() || null };
  }
  const dashMatch = material.match(/^(.+?)\s+-\s+(.+)$/);
  if (dashMatch) {
    // Both groups are mandatory (non-optional) in the regex above, so they
    // are always present whenever dashMatch itself is truthy.
    return { material: dashMatch[1]!.trim(), grade: dashMatch[2]!.trim() || null };
  }
  return { material, grade: null };
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
// Process › Category › Operation for a saved process row, read only from the
// database: the HR Rates machine the line is linked to (the machine that
// actually does the work) first, then the row's own saved catalog values
// (process_group, category, and process_route — which for Machining is the
// machine category). A level with no real value is omitted, never guessed.
function ProcessHierarchyLabel({ proc }: {
  proc: { processGroup?: string | null; category?: string | null; processRoute?: string | null; operation?: string | null; mhrId?: string | null; machineId?: string | null };
}) {
  const mhrId = proc.mhrId || proc.machineId || '';
  const { data: machine } = useMHRRecord(mhrId, { enabled: !!mhrId });
  const derivedGroup = machine ? effectiveProcessGroupOf(machine as any) : '-';
  const derivedCategory = machine ? mhrCategoryOf(machine as any) : '-';
  const group = (derivedGroup !== '-' ? derivedGroup : '') || proc.processGroup || '';
  const category = (derivedCategory !== '-' ? derivedCategory : '') || proc.category || proc.processRoute || '';
  const operation = proc.operation || '';
  const levels = [group, category, operation].filter(Boolean);
  if (levels.length === 0) return <>Process</>;
  return (
    <>
      {levels.map((lvl, i) => {
        const isLast = i === levels.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && <span className="text-muted-foreground/50 mx-1">›</span>}
            <span className={isLast ? 'text-foreground' : 'text-muted-foreground'}>{lvl}</span>
          </Fragment>
        );
      })}
    </>
  );
}
// Maps one FeatureBreakdown row to the 3D-viewer highlight it represents, so
// clicking "Bend R1mm x2" shows exactly those 2 bends (not every bend in the
// part), "Pierces x19"/pierce cleanup shows all pierced holes, and cut-path/
// edge-length rows (no discrete feature — the cut path runs around the whole
// part) show the full model outline via the face map. Returns null when there's
// nothing to highlight (feature graph not loaded, or an unrecognized type),
// which the caller uses to disable the row rather than showing a dead click.
function resolveFeatureOpHighlight(
  op: { name: string; featureType: string; featureIds?: string[] | undefined },
  v2Features: FeatureNodeV2[],
  faceMap: FaceMapEntry[],
): FeatureNodeV2 | null {
  if (op.featureType === 'bend') {
    const bendFeatures = v2Features.filter(isBend);
    const m = op.name.match(/R([\d.]+)mm/);
    if (m) {
      const bucket = parseFloat(m[1]!);
      const matched = bendFeatures.filter((f) => Math.round((f.radius_mm ?? 0) * 2) / 2 === bucket);
      if (matched.length) return mergeFeaturesToHL(`fb_bend_r${bucket}`, matched);
    }
    return mergeFeaturesToHL('fb_bend_all', bendFeatures);
  }
  if (op.featureType === 'pierce' || op.featureType === 'deburr_pierce') {
    return mergeFeaturesToHL('fb_holes', v2Features.filter(isPlainHole));
  }
  if (op.featureType === 'pem_insertion') {
    // buildPemFeatureBreakdown (bom-items.service.ts) names each row
    // "<part spec> x<count> (ØXmm, Ys/insertion)" — extract the diameter and
    // match holes at that diameter (0.3mm tolerance, same as the backend's
    // own sm_lookup_pem_hardware match tolerance in getPemMatches), same
    // bucket-matching pattern as bend/radius above. The feature graph has no
    // separate "this hole is a PEM insertion point" tag, so diameter is the
    // real, available signal — not a guess.
    const holeFeatures = v2Features.filter(isPlainHole);
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
  // Machining: the backend names the exact feature_graph_v2 entries each
  // operation machines (FeatureOp.featureIds, from the sequencer), so the
  // highlight is exactly those occurrences — never every feature of a type,
  // and never a diameter parsed back out of the display label.
  if (op.featureIds?.length) {
    const ids = new Set(op.featureIds);
    const matched = v2Features.filter((f) => ids.has(f.id));
    if (matched.length) return mergeFeaturesToHL(`fb_${op.featureIds.join('_')}`, matched);
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
  items: Array<{ name: string; timeSec: number; featureType: string; count: number; featureIds?: string[] | undefined }> | undefined;
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
// SPECIFIC-process label (the CAD family's own detected process, one level
// finer than FAMILY_GROUP's category above — 'Injection Moulded' here is
// deliberately narrower than FAMILY_GROUP.plastic_molded's 'Plastic
// Molding' category; the CAD classifier itself has no sub-classification
// among Injection/Compression/RIM/Structural Foam Molding yet, so this
// always reads 'Injection Moulded' for the plastic_molded family today).
function familyLabel(f: string): string {
  const m: Record<string, string> = {
    sheet_metal: 'Sheet Metal', milled: 'Milled', turned: 'Turned',
    mill_turn: 'Mill-Turn', plastic_molded: 'Injection Moulded',
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
    const cuttingProcessName = processName ?? '—';
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
        { name: 'Process', value: typeLabel ?? processName ?? '—' },
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


// tappingCandidateCount was here — a Ø<=6mm-holes-in-thin-sheet heuristic that
// claimed to be the "single source of truth for does this part need X", shared
// by autoCompleteRoute and the Workflow Builder's step visibility. It was
// neither single nor a source of truth: the backend gates Tapping on real
// thread features (threads.length, off drawingIntelligence.threads), and a
// small hole is not a tapped hole. Both of its consumers are gone. The
// authoritative gate lives in the canonical composer, backend-side.

// ── buildProcessTree ───────────────────────────────────────────────────────────

function buildProcessTree(
  item: BOMItem,
  fg: FeatureGraph | null,
  summary: FeatureGraphSummary,
  factory: string,
  overrideProcesses?: string[],
  cost?: CostSummaryDto | null,
  materialDensityGcm3?: number | null,
  procRecords?: Array<{ opNbr?: number; category?: string; operation?: string; processGroup?: string; machineName?: string; isActive?: boolean }> | null,
  secondaryLines?: SecondaryProcessLine[] | null,
): ProcessTreeNode {
  const family = resolveDisplayFamily(item, fg);
  const groupLabel = FAMILY_GROUP[family] ?? 'Unclassified';
  // The process list is the APPLIED (or explicitly chosen) route, else the
  // cad-engine's own recommendations. Nothing is added to either.
  //
  // autoCompleteRoute used to augment whichever list arrived here, inventing
  // steps that were never applied and never recommended: an unconditional
  // "Fiber Laser Cutting" whenever no cutting process was present — a routing
  // decision the backend's route comparison exists to make — plus unconditional
  // Deburring and Inspection, and a Tapping step gated on its own heuristic
  // ("small holes in thin sheet") rather than on real thread features. That gate
  // disagreed with the backend, which requires threads.length > 0: confirmed
  // live, a part with NO thread features showed "Tapping / As Tapped / Potential
  // tapping features" in this tree while the costed route correctly had no
  // tapping at all. Two definitions of the same route, and this one was not the
  // one being quoted.
  // Real, confirmed live gap (2026-09-11): an injection-molded part with real,
  // manually-added Direct Process Costs (Mold Setup/Injection/Packing/Cooling/
  // Ejection/Inspections — all real cost.processLines) still showed a
  // completely empty Process Step tree (only the top-level part row, zero
  // operation children) — because fg?.processRecommendations is a Sheet-Metal-
  // shaped, cad-engine-computed recommendation list that is never populated
  // for this family, and no route had been explicitly applied/recommended
  // (overrideProcesses unset) even though real costed process lines already
  // existed. The exact same "cost lines as a real, already-computed process
  // list" fallback already exists elsewhere on this page (the Part/Complexity
  // summary card's routeFromCost) — reused here rather than reinvented, so the
  // tree reflects what was actually costed instead of showing nothing.
  const overrideRecs = overrideProcesses?.map((p) => ({ process: p, estimated_time_sec: null as number | null }));
  const fgRecs = fg?.processRecommendations;
  // Real, confirmed live gap (2026-09-11): once no route was ever "applied"
  // (only individual rows added via Add Process), this used to fall straight
  // through to `costRecs` below — the cost ENGINE's own hypothetical
  // recompute of every step it would run (including steps like "Material
  // Drying"/"Weight Check" that the user never actually added), each
  // re-matched to whichever machine the engine's OWN default selection
  // picked. That is a second, independent representation of "what this
  // part's process is" — confirmed live, it disagreed with Direct Process
  // Costs both on WHICH steps exist and on WHICH machine runs each one
  // (tree: "Arburg Allrounder 420 C..."; Direct Process Costs, from the
  // same item's real stored rows: "Netstal Synergy 1200"). Direct Process
  // Costs already settled this exact question for engine vs. stored data
  // (see the "engine rows shown only when no stored records exist" comment
  // at this file's DIRECT PROCESS COSTS section) — the tree must agree with
  // it, not maintain its own separate answer. `procRecords` (real
  // process_cost_records rows for this item) now takes priority over the
  // engine's own costRecs fallback whenever real stored rows exist.
  const storedRecs = procRecords?.length
    ? [...procRecords]
        .filter((r) => r.isActive !== false)
        .sort((a, b) => (a.opNbr ?? 0) - (b.opNbr ?? 0))
        .map((r) => ({
          process: r.category || r.operation || r.processGroup || 'Process',
          estimated_time_sec: null as number | null,
        }))
    : null;
  // Real machine actually recorded on the stored row for a given process
  // label — kept separate from `recs` itself (whose candidates come from
  // three structurally different sources with no common "machine" field)
  // so any path through the fallback chain below can still show the real
  // selected machine for a step that has one, instead of falling through to
  // the engine's own (possibly different) default-machine recompute.
  const storedMachineByProcess = new Map<string, string>();
  for (const r of procRecords ?? []) {
    if (r.isActive === false) continue;
    const label = r.category || r.operation || r.processGroup;
    if (label && r.machineName) storedMachineByProcess.set(label, r.machineName);
  }
  const costRecs = cost?.processLines?.length
    ? cost.processLines.map((l) => ({ process: l.process, estimated_time_sec: l.cycleTimeMin * 60 }))
    : null;
  // `?? []` alone would stop here the moment fgRecs is a real EMPTY array
  // (not null/undefined) — `??` only falls through on nullish, not on falsy
  // length — so each candidate is explicitly checked for real content before
  // falling through to the next.
  const recs = (overrideRecs && overrideRecs.length > 0 ? overrideRecs : null)
    ?? (storedRecs && storedRecs.length > 0 ? storedRecs : null)
    ?? (fgRecs && fgRecs.length > 0 ? fgRecs : null)
    ?? costRecs
    ?? [];

  // Machined families: every operation's features come from the backend's own
  // per-line featureIds (the operation sequencer). A line that reports none
  // yet (the turned path; Tapping) gets the part's unattributed features under
  // the part's first operation - the line that bills its machining - never a
  // frontend process-name-to-feature table. Which operation counts as
  // machining is decided by the part family, not by the step name containing
  // "Milling"/"Machining": that substring test skipped real steps such as
  // "4 Axis Mill", which is why they showed no features at all.
  const isMachiningFamily = family !== '' && family !== 'sheet_metal' && family !== 'plastic_molded';
  const v2All = fg?.feature_graph_v2?.features ?? [];
  const v2ById = new Map(v2All.map((f) => [f.id, f]));
  const lineForRec = (process: string) => cost?.processLines?.find((l) => l.process === process);
  const claimedIds = new Set(
    recs.flatMap((r) => (lineForRec(r.process)?.featureBreakdown ?? []).flatMap((b) => b.featureIds ?? [])),
  );

  const featureLeaf = (idPrefix: string, f: FeatureNodeV2, machine: string): ProcessTreeNode => {
    const occ = f.occurrences.length;
    const dia = f.diameter_mm != null ? ` Ø${f.diameter_mm.toFixed(1)}` : '';
    const variant = f.variant ? ` (${f.variant})` : '';
    return {
      id: `${idPrefix}_${f.id}`,
      kind: 'feature',
      label: `${f.canonical_operation ?? String(f.feature_type)}${variant}${dia} ×${occ}`,
      factory, machine,
      v2FeatureIds: [f.id],
      attrs: [
        { name: 'Feature', value: String(f.feature_type) },
        ...(f.variant ? [{ name: 'Variant', value: f.variant }] : []),
        ...(f.canonical_operation ? [{ name: 'Operation', value: f.canonical_operation }] : []),
        { name: 'Occurrences', value: String(occ) },
        ...(f.diameter_mm != null ? [{ name: 'Diameter', value: `${f.diameter_mm.toFixed(1)} mm` }] : []),
      ],
    };
  };
  // Type group ("SimpleHole ×12") -> one row per real feature_graph_v2 entry.
  const typeGroupNodes = (idPrefix: string, features: FeatureNodeV2[], machine: string): ProcessTreeNode[] =>
    groupFeaturesByType(features).map((g) => {
      const members = g.variants.flatMap((v) => v.features);
      return {
        id: `${idPrefix}_${g.type}`,
        kind: 'feature' as const,
        label: `${g.type} ×${g.occurrenceCount}`,
        factory, machine,
        v2FeatureIds: members.map((f) => f.id),
        attrs: [
          { name: 'Count', value: String(g.occurrenceCount) },
          ...g.variants.map((v) => ({ name: v.variant, value: `×${v.occurrenceCount}` })),
        ],
        children: members.map((f) => featureLeaf(`${idPrefix}_${g.type}`, f, machine)),
      };
    });

  const operations: ProcessTreeNode[] = recs.map((rec, opIdx) => {
    const isSheetMetal = family === 'sheet_metal';
    const isCutting = rec.process.includes('Laser') || rec.process.includes('Cutting');
    const isBending = rec.process.includes('Press Brake') || rec.process.includes('Bending');
    // Moulded-part geometry is PART-level: it belongs to the part's first
    // resolved operation, whatever the engineer named or however many steps
    // they added (exact-name gates on "Injection"/"Molding" silently dropped it).
    const isFirstOpForMolded = family === 'plastic_molded' && opIdx === 0;

    // Only the real machine: the stored row's own machine, else the live cost
    // line's DB-resolved machine, else '—'. Matched by exact process name.
    const matchedCostLine = lineForRec(rec.process);
    const machine = storedMachineByProcess.get(rec.process) ?? matchedCostLine?.machineName ?? '—';
    const breakdown = matchedCostLine?.featureBreakdown ?? [];
    const featureNodes: ProcessTreeNode[] = [];

    // Sheet metal: the catalog operations this step performs on the part's own
    // CAD features ("Punching // SimpleHole Ø4.0 ×14"), resolved by the backend.
    if (isSheetMetal && matchedCostLine?.catalogOperations?.length) {
      const withMachine = (n: OperationTreeNode): ProcessTreeNode =>
        ({ ...n, factory, machine, ...(n.children ? { children: n.children.map(withMachine) } : {}) });
      featureNodes.push(...sheetMetalOperationNodes(`catop_${opIdx}`, matchedCostLine.catalogOperations).map(withMachine));
    }

    // GD&T callouts this line covers (Inspection; family-agnostic — the
    // backend resolver serves both sheet-metal and machining parts alike).
    // Click-to-highlight the toleranced face uses the same v2FeatureIds
    // mechanism as every other node; a callout with no real face link (no
    // AP242 link on this part, or a drawing-sourced callout, which never has
    // one) renders the same way, just without a highlight on click.
    if (matchedCostLine?.gdtCallouts?.length) {
      featureNodes.push(...gdtCalloutNodes(`gdt_${opIdx}`, matchedCostLine.gdtCallouts).map((n) => ({ ...n, factory, machine })));
    }

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
              { name: 'Process',         value: rec.process },
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
                { name: 'Process',         value: rec.process },
                { name: 'Est. Cycle Time', value: formatEstCycleTime(realPierceCycleTimeSec(count, cost), true) },
              ],
            });
          });
        } else if (summary.holeCount > 0) {
          holeNodes.push({
            id: 'feat_holes', kind: 'feature', label: `Holes (${summary.holeCount})`, factory, machine,
            attrs: [{ name: 'Count', value: String(summary.holeCount) }, { name: 'Process', value: rec.process }],
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
    } else if (isMachiningFamily) {
      if (breakdown.some((b) => (b.featureIds ?? []).length > 0)) {
        // Real per-operation breakdown ("Spot Drill ×8", "Pocket Mill ×2", ...),
        // each row carrying the exact feature ids it machines and its real time.
        breakdown.forEach((b, i) => {
          const feats = (b.featureIds ?? []).map((id) => v2ById.get(id)).filter((f): f is FeatureNodeV2 => f != null);
          featureNodes.push({
            id: `machining_line_${opIdx}_${i}`,
            kind: 'feature',
            label: b.name,
            factory, machine,
            ...(feats.length > 0 ? { v2FeatureIds: feats.map((f) => f.id) } : {}),
            attrs: [
              { name: 'Count', value: String(b.count) },
              { name: 'Time', value: formatEstCycleTime(b.timeSec) },
            ],
            ...(feats.length > 0 ? { children: typeGroupNodes(`machining_type_${opIdx}_${i}`, feats, machine) } : {}),
          });
        });
      } else if (opIdx === 0) {
        const unclaimed = v2All.filter((f) => !claimedIds.has(f.id));
        featureNodes.push(...typeGroupNodes(`machining_type_${opIdx}`, unclaimed, machine));
      }
    } else if (isFirstOpForMolded) {
      const wall = summary.wallThicknessNominalMm ?? null;
      const wallMin = summary.wallThicknessMinMm;
      const wallMax = summary.wallThicknessMaxMm;
      const bossCount = summary.holeOrBossCount ?? 0;
      const ribCount = (summary as any).ribCount ?? (summary as any).ribCountProxy ?? 0;
      const volMm3 = (item.volume as number | null | undefined) ?? 0;
      // Real density for this item's own grade (useMaterialDensity); '—' until resolved.
      const densityGcm3 = materialDensityGcm3 ?? null;
      const massG = volMm3 > 0 && densityGcm3 != null ? Math.round((volMm3 / 1e3) * densityGcm3 * 10) / 10 : 0;
      const undercutCount = (summary as any).undercutFaceCount ?? 0;
      const undraftedCount = (summary as any).undraftedFaceCount ?? 0;
      const avgDraftDeg = (summary as any).avgDraftAngleDeg ?? null;
      const partingComplexity = (summary as any).partingComplexity ?? null;

      featureNodes.push({
        id: 'feat_im_part', kind: 'feature', label: 'Moulded Part',
        factory, machine,
        attrs: [
          { name: 'Volume',    value: volMm3 > 0 ? `${fmtInt(volMm3)} mm³` : '—' },
          { name: 'Est. mass', value: massG > 0 ? `${massG} g (net part)` : '—' },
          ...(wall != null ? [{ name: 'Wall nom.', value: `${fmt(wall, 1)} mm` }] : []),
          ...(wallMin != null && wallMax != null
            ? [{ name: 'Wall range', value: `${fmt(wallMin, 1)} – ${fmt(wallMax, 1)} mm` }]
            : []),
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
            // Classification rule (cad-engine/injection_molding/feature_extractor.py's
            // UNDERCUT_NEG_DOT_THRESHOLD), not a per-part measurement — every face
            // counted above already exceeds this by construction.
            { name: 'Classification', value: 'Back-angle >5° opposing pull direction' },
            { name: 'Action', value: 'Click to highlight in 3D viewer' },
          ],
        });
      }
      if (undraftedCount > 0) {
        featureNodes.push({
          id: 'feat_im_undrafted', kind: 'feature', label: `Undrafted Faces (${undraftedCount})`,
          factory, machine,
          attrs: [
            // Classification rule (UNDRAFTED_ABS_DOT_THRESHOLD), not a per-part
            // measurement — paired with the part's own real average draft angle
            // below when the CAD engine resolved one (avg_draft_angle_deg).
            { name: 'Classification', value: 'Draft angle <0.3°' },
            ...(avgDraftDeg != null ? [{ name: 'Part avg. draft angle', value: `${fmt(avgDraftDeg, 2)}°` }] : []),
            { name: 'Action', value: 'Click to highlight in 3D viewer' },
          ],
        });
      }
    }

    // A secondary process (CMM, cleaning, NDT, packaging): what it acts on, from
    // the secondary-process engine's own result for this step.
    const secondary = featureNodes.length === 0
      ? secondaryLines?.find((l) => l.process === rec.process && l.status === 'costed')
      : undefined;
    if (secondary) {
      const feats = secondary.featureIds.map((id) => v2ById.get(id)).filter((f): f is FeatureNodeV2 => f != null);
      if (feats.length > 0) featureNodes.push(...typeGroupNodes(`secfeat_${opIdx}`, feats, machine));
      else if (secondary.highlight === 'whole_part') {
        featureNodes.push({
          id: `secondary_part_${opIdx}`, kind: 'feature', label: 'Whole part surface', factory, machine, wholePart: true,
          attrs: secondary.trace.map((t) => ({ name: t.label, value: `${t.value}${t.unit ? ` ${t.unit}` : ''}` })),
        });
      }
    }

    // Any step not covered above: its own cost line's feature breakdown, as is.
    if (featureNodes.length === 0 && breakdown.length > 0) {
      breakdown.forEach((b, i) => {
        const ids = (b.featureIds ?? []).filter((id) => v2ById.has(id));
        featureNodes.push({
          id: `line_${opIdx}_${i}`,
          kind: 'feature',
          label: b.name,
          factory, machine,
          ...(ids.length > 0 ? { v2FeatureIds: ids } : {}),
          attrs: [
            { name: 'Count', value: String(b.count) },
            { name: 'Time', value: formatEstCycleTime(b.timeSec) },
          ],
        });
      });
    }
    // Nothing real to show: say so, rather than a stand-in step name.
    if (featureNodes.length === 0) {
      featureNodes.push({
        id: `nodata_${opIdx}`,
        kind: 'feature',
        label: 'No feature data',
        factory, machine,
        attrs: [{
          name: 'Reason',
          value: matchedCostLine
            ? 'The cost engine reports no per-feature breakdown for this step.'
            : 'No live cost line for this step yet - nothing to break down.',
        }],
      });
    }

    return { id: `op_${opIdx}`, kind: 'operation', label: rec.process, factory, machine, children: featureNodes };
  });

  // Inject Threaded Features from drawing intelligence for CNC families.
  //
  // FIXED: this used to always create a brand-new top-level "Threaded
  // Features" operation node with a hardcoded `machine: 'Tapping Machine'` —
  // a fabricated label, never the real resolved machine every other node in
  // this tree uses (realMachineName, off cost.processLines). Whenever a real
  // "Tapping" operation already exists (the normal case — Tapping is
  // costed/applied like any other step), that operation's own row already
  // shows the correct real machine (e.g. "Haas DS-30 with BAR3010SS
  // Feeder"); injecting a sibling with a different, fake machine name for
  // the same physical operation broke the Process → Machine → Operation
  // hierarchy the rest of the tree follows. Thread Features now nests
  // UNDER the real Tapping operation and inherits its real machine.
  const diThreadSpecs = isMachiningFamily
    ? ((item.drawingIntelligence as any)?.threads as Array<{ size: string; pitch: number; count: number }> | undefined)
    : undefined;
  if (diThreadSpecs && diThreadSpecs.length > 0) {
    const tappingOp = operations.find((op) => op.label === 'Tapping');
    // '—' matches this tree's own convention elsewhere for "no machine
    // resolved yet" (see `machine` above) — never a fabricated name.
    const tappingMachine: string = tappingOp?.machine ?? '—';
    const threadChildren: ProcessTreeNode[] = diThreadSpecs.map((t, i) => ({
      id: `thread_di_${i}`,
      kind: 'feature' as const,
      label: `${t.size} ×${t.count}`,
      factory,
      machine: tappingMachine,
      source: 'drawing_intelligence',
      attrs: [
        { name: 'Specification', value: `${t.size} × ${t.pitch}` },
        { name: 'Count',         value: String(t.count) },
      ],
    }));
    const threadSubOp: ProcessTreeNode = {
      id: 'thread_features',
      kind: 'feature',
      label: 'Drawing thread callouts',
      children: threadChildren,
    };
    if (tappingOp) {
      tappingOp.children = [...(tappingOp.children ?? []), threadSubOp];
    } else {
      // No real Tapping process step exists on this part yet (e.g. not
      // costed/applied) — keep the finding visible as its own disclosed
      // top-level node rather than silently dropping it, but with an
      // honest '—' machine instead of a fabricated one.
      const deburrIdx = operations.findIndex((op) => op.label === 'Deburring');
      operations.splice(deburrIdx >= 0 ? deburrIdx : operations.length, 0, {
        id: 'op_threads',
        kind: 'operation',
        label: 'Threaded Features',
        factory,
        machine: '—',
        children: [threadSubOp],
      });
    }
  }

  // Processes the live engine computed for THIS route but that could never be
  // applied/persisted — physicsGap set (findRouteDataGaps rejects the WHOLE
  // apply-route request whenever any line has one, see engine-kernel.ts).
  // `recs` above deliberately never includes these once real stored rows
  // exist (storedRecs wins, per the comment on that fallback chain above), so
  // without this the tree would say nothing happened here at all — the same
  // gap the Direct Process Costs list had before its own unresolved row was
  // added. Append-only: never reads or mutates `recs`, so none of the real
  // fixes already documented on this function are at risk.
  const gapProcessLines = (cost?.processLines ?? []).filter(
    (l) => l.physicsGap && !operations.some((op) => op.label === l.process),
  );
  for (const l of gapProcessLines) {
    const gap = l.physicsGap!;
    const reasonText = gap.gapType === 'missing_lookup' ? gap.requiredAction : gap.reason;
    operations.push({
      id: `op_gap_${l.process}`,
      kind: 'operation',
      label: `${l.process} — unresolved`,
      factory,
      machine: 'Not applied',
      attrs: [{ name: 'Reason', value: reasonText }],
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
  return { id, feature_type: 'Blank', occurrences: [{ centroid: [0, 0, 0] as [number, number, number], face_ids: faceMap.map((e) => e.face_id) }] };
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
    return merge('op-cutting', v2Features.filter((f) => isPlainHole(f) || isBlankProfile(f)), '#3b82f6');
  if (l.includes('press brake') || l.includes('bending'))
    return merge('op-bending', v2Features.filter(isBend), '#eab308');
  if (l.includes('tapping'))
    return merge('op-tapping',
      v2Features.filter((f) => isPlainHole(f) && (f.diameter_mm ?? 99) <= 6.0), '#a855f7');
  if (l.includes('deburr')) {
    // Phase 2: replace with true edge highlight (EdgeHighlight component exists in EDrawingsViewer)
    return merge('op-deburr',
      v2Features.filter((f) => isPlainHole(f) || isBend(f)), '#06b6d4');
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
  // Real, confirmed live gap (2026-09-11): this section only ever matched
  // 'injection mould(ing)'/'injection mold(ing)' — the OLD coarse single-
  // recommendation label. The real per-step operations now populating the
  // tree (cost-injection-molding-engine.ts's own makeLine labels: 'Mold
  // Setup', 'Injection', 'Packing/Holding', 'Cooling', 'Ejection', 'Weight
  // Check') don't contain that substring, so clicking any of them produced
  // no highlight at all — confirmed live, the exact "no process-level
  // highlight" gap reported alongside the missing feature nodes. Each real
  // step gets the whole-part tint (none of these individual steps has its
  // own distinct face-level geometry beyond the undercut/undraft/parting
  // detail already handled by computeFeatureNodeVisual's feat_im_* nodes).
  if (l.includes('material drying') || l.includes('drying'))
    return null; // Pre-process — no part geometry involved yet
  if (l === 'mold setup' || l === 'mould setup') {
    const hl = buildFullModelHL('op-mold-setup', faceMap);
    return hl ? { highlight: hl, color: '#94a3b8' } : null; // slate — tooling/machine setup
  }
  if (l.includes('injection mould') || l.includes('injection mold') || l === 'injection') {
    const hl = buildFullModelHL('op-injection', faceMap);
    return hl ? { highlight: hl, color: '#f97316' } : null; // orange — molten cavity fill
  }
  if (l.includes('packing') || l.includes('holding')) {
    const hl = buildFullModelHL('op-packing', faceMap);
    return hl ? { highlight: hl, color: '#fb923c' } : null; // amber-orange — pack/hold pressure
  }
  if (l === 'cooling') {
    const hl = buildFullModelHL('op-cooling', faceMap);
    return hl ? { highlight: hl, color: '#38bdf8' } : null; // sky blue — cooling
  }
  if (l === 'ejection') {
    const hl = buildFullModelHL('op-ejection', faceMap);
    return hl ? { highlight: hl, color: '#94a3b8' } : null; // slate — part release
  }
  if (l.includes('weight check')) {
    const hl = buildFullModelHL('op-weight-check', faceMap);
    return hl ? { highlight: hl, color: '#e2e8f0' } : null; // light — quality overlay
  }
  if (l.includes('gate trimming') || l.includes('degating') || l.includes('deflashing')) {
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
  const merge = (id: string, feats: FeatureNodeV2[], color: string): OperationVisual => {
    const hl = mergeFeaturesToHL(id, feats);
    return hl ? { highlight: hl, color } : null;
  };
  // Real canonical-operation CNC feature nodes (v2feat_*, built from
  // feature_graph_v2 entries the backend already classified) — match by the
  // exact feature id tagged at build time, never by re-deriving from label.
  if (node.v2FeatureId != null) {
    const exact = v2Features.find((f) => f.id === node.v2FeatureId);
    return exact ? merge(`hl-${node.v2FeatureId}`, [exact], '#f97316') : null;
  }
  if (node.v2FeatureIds?.length) {
    const ids = new Set(node.v2FeatureIds);
    return merge(`hl-${node.id}`, v2Features.filter((f) => ids.has(f.id)), '#d97706');
  }
  if (node.wholePart) {
    const hl = buildFullModelHL(`hl-${node.id}`, faceMap);
    return hl ? { highlight: hl, color: '#22d3ee' } : null;
  }
  // ── Injection molding feature nodes ──
  if (node.id === 'feat_im_part') {
    const hl = buildFullModelHL('hl-im-part', faceMap);
    return hl ? { highlight: hl, color: '#f97316' } : null; // orange — molded geometry
  }
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
      (f) => isPlainHole(f) && f.diameter_mm != null && Math.round(f.diameter_mm * 10) / 10 === targetD,
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
    const cutFeatures = v2Features.filter((f) => isPlainHole(f) || isBlankProfile(f));
    const holeHl = mergeFeaturesToHL('hl-flat-pattern', cutFeatures);
    if (holeHl) return { highlight: holeHl, color: '#38bdf8' }; // sky blue — unfolded blank
    const hl = buildFullModelHL('hl-flat-pattern', faceMap);
    return hl ? { highlight: hl, color: '#38bdf8' } : null;
  }
  return null;
}

function getVizLabel(node: ProcessTreeNode): string | null {
  const l = node.label.toLowerCase();
  if (node.id === 'feat_im_part') return 'Moulded part — full cavity geometry';
  if (node.id.startsWith('secondary_') || node.id.startsWith('secfeat_')) {
    return `${node.label} — ${node.wholePart ? 'whole part surface' : 'measured features'}`;
  }
  if (node.kind === 'operation') {
    if (l.includes('laser') || l.includes('cutting')) return 'Pierce holes';
    if (l.includes('press brake') || l.includes('bending')) return 'Bend lines';
    if (l.includes('tapping')) return 'Tapped holes';
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


// ── CostSummaryTab — eMithran-style with inline editing ─────────────────────

function CostSummaryTab({
  item, batchSize, appliedRouteId, factory = 'USA', fg, onSelectHighlight,
}: {
  item: BOMItem; batchSize: number | undefined; appliedRouteId?: string | null; factory?: string;
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

  // Still used by "Reset all overrides" below, which clears any override already
  // stored for this item.
  const costOverride = useCostOverride(item.id, factory);

  // The inline rate/cycle-time override editors lived on the engine-derived
  // "not saved" process rows, which no longer exist — the Cost Guide lists the
  // applied route only. Their write path (useCostOverride) is removed with them.
  // Reading persisted overrides is unaffected: procOverrides/matRateOverride
  // below still apply any override already stored for this item.

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

  // Per machining calculator, the inputs the engine gave it on this part (its
  // line's trace): values, sources and lookup rows. Opening that calculator in
  // the process dialog shows exactly these instead of blank fields.
  const engineCalculators = useMemo(() => {
    const out: Record<string, { calculatorId: string; inputs: Record<string, number | string>; provenance: Record<string, string>; lookupMatches: Record<string, { table: string; row: Record<string, string | number> }> }> = {};
    for (const line of eff?.lines ?? []) {
      if (!line.calculatorId || !line.calculationTrace?.length || out[line.calculatorId]) continue;
      const inputs = line.calculationTrace.filter((st) => st.kind === 'input' && st.value != null);
      out[line.calculatorId] = {
        calculatorId: line.calculatorId,
        inputs: Object.fromEntries(inputs.map((st) => [st.fieldName, st.value as number | string])),
        provenance: Object.fromEntries(inputs.filter((st) => st.source).map((st) => [st.fieldName, st.source as string])),
        lookupMatches: line.lookupMatches ?? {},
      };
    }
    return out;
  }, [eff]);

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

  // `opNbrIfNew` is used ONLY when this line has no saved record yet and the
  // dialog is about to create one. It used to be a render index turned into
  // (index + 1) * 10, which meant the op number a new record was created with
  // depended on where the row happened to be drawn — see the same defect on
  // the display side in lib/routing/process-sequence.ts. Callers now pass the
  // real next free op number, the same "last saved op_nbr + 10" convention the
  // Add Process button already uses.

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
            category: data.category,
            processRoute: data.processRoute,
            operation: data.operation,
            location: data.location || undefined,
            mhrId: data.mhrId || undefined,
            benchmarkMhrId: data.benchmarkMhrId || undefined,
            // `?? null`, not `|| undefined`: undefined is dropped from the JSON
            // and the backend only touches a field whose key is present, so a
            // stale labour FK would survive a save that no longer uses one.
            lhrId: data.lhrId ?? null,
            benchmarkLhrId: data.benchmarkLhrId ?? null,
            directRate: toNativeLocal(data.directRate || data.laborRate || 0),
            indirectRate: data.indirectRate || 0,
            fringeRate: data.fringeRate || 0,
            machineRate: toNativeLocal(data.machineRate || 0),
            machineValue: toNativeLocal(data.machineValue || 0),
            laborRate: toNativeLocal(data.laborRate || 0),
            // No `|| 8`. Edit Process Cost sends the selected machine's real
            // shifts_per_day x hours_per_shift, or nothing when that machine has
            // no shift pattern on file. Defaulting wrote a fabricated 8 on every
            // line — and nothing reads this column anyway (the engine declares
            // the field but no calculation uses it).
            shiftPatternHoursPerDay: data.shiftPatternHoursPerDay,
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
          category: data.category,
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
          // Same as the update path above — no fabricated default.
          shiftPatternHoursPerDay: data.shiftPatternHoursPerDay,
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

  // Whether this part's scenario has actually been applied — stated by the
  // backend (scenarioReady false carries 'materialRecord' in missingInputs), not
  // re-derived here. Nothing costed and no operation sequence is shown until it
  // is true; a route preview used to be drawn from the comparison engine in the
  // meantime, which put an operation list and a total cycle time on screen for a
  // scenario that had never been applied.
  const isScenarioReady = cost.scenarioReady !== false;

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
  // ── Stored process records ────────────────────────────────────────────────
  // The costing inputs THIS view is being priced at. `cost.batchSize` is the
  // backend's resolved effective batch (request -> scenario override ->
  // canonical default), which is also the number printed in the header and in
  // each row's "Setup (... ÷ N)" label — so the arithmetic below and the label
  // above it can no longer describe different batches. Falls back to the
  // requested prop only before the first cost-summary response lands.
  const effBatchSize = cost.batchSize;
  const effectiveCostingInputs = { batchSize: effBatchSize, location: factory };

  // One resolution for BOTH the grand total and the per-row display. These used
  // to be two hand-synchronised copies of the same arithmetic, kept in step only
  // by a comment warning that letting them drift would stop the row percentages
  // summing to 100%. See lib/costing/stored-process-lines.ts.
  const storedProcessLines = resolveStoredProcessLines(
    sortedStoredProcs as StoredProcessRow[],
    eff.lines,
    effectiveCostingInputs,
  );
  const storedLineById = new Map<string, (typeof storedProcessLines)[number]>(
    storedProcessLines.map((l) => [String(l.row.id), l]),
  );
  const hasStoredProcs = sortedStoredProcs.length > 0;
  // Process costs are only valid when a material is present — every process parameter
  // (laser speed, press brake tonnage, cycle time derating) was computed from that
  // material. If the material record is deleted, stored process costs are stale and
  // must not contribute to the total until material is re-applied.
  // Process costs are only valid when a committed material record exists — machine
  // selection, laser speed, press-brake tonnage, and LHR derating all depend on
  // material family and thickness. Without a raw-material record there is no basis
  // for any dollar figure, so the total process contribution is $0.
  //
  // The one addition to that rule: a saved row is a SNAPSHOT of what an operation
  // cost under the inputs in force when the route was applied. When those inputs
  // no longer match the scenario being viewed, the snapshot answers a different
  // question, so the freshly computed engine result wins instead of being
  // silently overridden by it.
  const processTotal = selectProcessTotal({
    hasStoredMaterial: hasStoredMat,
    storedLines: storedProcessLines,
    engineTotalProcess: eff.totalProcess,
  });
  // Units differ by source and must be converted accordingly: stored records are
  // persisted in USD, while the engine result is already in factory currency.
  const totalProcessCombined = processTotal.source === 'stored'
    ? processTotal.total * fromUsd
    : processTotal.total;
  // When no material record exists, use $0 for the material component — do not silently
  // include the engine's estimate while "No raw materials added yet" is displayed.
  const matComponent = hasStoredMat ? storedMatTotal : 0;
  const grandTotal = matComponent + totalProcessCombined + packagingTotal + procuredTotal + toolingTotal;


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
          batchSize={effBatchSize}
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

      {/* Scenario not applied — no operation list, no cycle times, no totals.
          The backend states this on the response (scenarioReady false, with
          'materialRecord' in missingInputs) and this is the one place that
          decides what to show for it.

          Two blocks used to render here instead: a route preview and a
          cycle-times-only list, both drawn from live engine output with a dash
          in the cost column. They were real calculations, but they presented an
          operation sequence and a total cycle time for a scenario nobody had
          applied — indistinguishable, on screen, from a costed routing whose
          numbers had merely failed to load. The second of the two is now
          unreachable in any case: scenarioReady is false exactly when no
          material record is committed, which is the same condition it tested. */}
      {!isScenarioReady && !hasStoredProcs && (
        <div className="pl-2 pb-2">
          <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            Press <strong>Refresh Analysis</strong> first, then set a material
            grade, Digital Factory and batch size and press <strong>Apply</strong>.
            Operations and costs are computed from the applied scenario against
            the refreshed geometry — never before it.
          </div>
        </div>
      )}

      {/* Material applied, route not. The engine can price this part, but no
          route has been applied, so nothing here is costed — see
          selectProcessTotal, which returns no process total for this state. */}
      {hasStoredMat && !hasStoredProcs && !isLoadingProcRecords && (
        <div className="pl-2 pb-2">
          <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            No process route applied yet. Press <strong>Refresh Analysis</strong>
            to re-read the drawing, then <strong>Apply</strong> to compute and save
            the route for this scenario. Process cost is taken from the applied
            route, never from an unapplied estimate.
          </div>
        </div>
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
          are merged into one array by sequenceProcessRows (lib/routing/
          process-sequence.ts), which orders them from the real persisted
          op_nbr and the real engine processLines order — so the sequence is
          right regardless of which lines happen to be saved, AND regardless
          of which machine class produced them. */}
      {(() => {
        // Gated on !isLoadingProcRecords — otherwise, on first paint (before
        // the stored-records query resolves), sortedStoredProcs is
        // momentarily empty and every real engine line would flash as
        // "missing"/"Result Unavailable" for an instant before correcting
        // itself once the real stored rows arrive — reads as "it worked,
        // then reverted to the old data" even though nothing was ever wrong.
        // The Cost Guide lists the APPLIED route and nothing else.
        //
        // Engine lines with no saved counterpart used to be listed here too, as
        // amber "not saved" rows, each carrying a cost. That put operations
        // nobody had applied into the quote — confirmed live: $0.14 of them
        // inside a $0.19 total, on a part whose route had never been applied.
        // Operations come from the applied scenario or they do not appear;
        // when none is applied the prompt above says so. `sequenceProcessRows`
        // still takes the engine lines, which it uses only to ORDER the saved
        // rows into real manufacturing sequence.
        const missingLines: never[] = [];

        // Real sequence, from the two orderings that are already real: each
        // saved row keeps the op_nbr writeProcessLinesAsRecords gave it, and
        // each unsaved line is anchored by the engine's own processLines
        // order. See lib/routing/process-sequence.ts for why the hardcoded
        // machine-class rank table this replaces put a Laser Punch / Plasma /
        // Shear / press-family cutting operation last, behind inspection.
        type Row = { key: string; kind: 'stored'; proc: any; opNbr: number | null };
        const rows: Row[] = sequenceProcessRows(
          sortedStoredProcs as any[],
          missingLines as any[],
          eff?.lines ?? [],
        ).filter((r) => r.kind === 'stored')
          .map((r): Row => ({ key: `stored:${String(r.item.id)}`, kind: 'stored', proc: r.item, opNbr: r.opNbr }));


        return rows.map((row) => {
          // The saved row's REAL op number, never a render-position relabel —
          // the previous (rowIdx + 1) * 10 printed 40 next to an operation
          // stored as op 10, so the Cost tab and the Process tree disagreed
          // about the same route. An unsaved line genuinely has no op number
          // yet; it is already labelled "not saved"/"Result Unavailable".
          const opNbr = row.opNbr === null ? '' : String(row.opNbr);


        const proc = row.proc;
        // Live engine data for this row's machine class — feature breakdown
        // (cut path, pierces, bends...) and the ⭐/alternatives/"Why" picker are
        // computed from current geometry + MHR data regardless of whether this
        // operation has a saved row, so a saved row can show the exact same
        // rich view as a not-yet-saved one, just persisting picks to ITS OWN
        // record instead of the class-wide machine-override preference.
        //
        // Resolved ONCE, up with the grand total, by
        // lib/costing/stored-process-lines.ts — this row and that total are now
        // literally the same numbers rather than two copies of one formula.
        const resolved = storedLineById.get(String(proc.id));
        const matchedEngineLine = resolved?.matchedEngineLine ?? undefined;
        const ms = matchedEngineLine?.machineSelection;

        // Still needed on its own: the Cycle Time calculator popup below opens
        // seeded with the live geometry-derived value (see its use), not the
        // stored one. Why live wins is documented in stored-process-lines.ts.
        const liveCycleSec = matchedEngineLine ? matchedEngineLine.cycleTimeMin * 60 : null;
        const liveCandidate = resolved?.liveCandidate ?? null;
        const machineRate  = resolved?.machineRate ?? 0;
        const liveMachineName = resolved?.liveMachineName ?? null;
        const laborRate    = resolved?.laborRate ?? 0;
        const setupMin     = resolved?.setupMin ?? 0;
        const setupManning = resolved?.setupManning ?? 1;
        // The CURRENT effective batch, not the one frozen into the saved row.
        // This is the denominator printed in the Setup line below, and it is now
        // the same one the arithmetic actually divides by — the two used to
        // disagree whenever Batch Size had changed since the route was applied.
        const batch        = resolved?.batchSize ?? effBatchSize;
        const cycleSec     = resolved?.cycleSec ?? 0;
        const heads        = resolved?.heads ?? 1;
        const ppc          = resolved?.partsPerCycle ?? 1;
        const scrap        = resolved?.scrap ?? 0;
        const setupPerPart = resolved?.setupPerPart ?? 0;
        const cyclePerPart = resolved?.cyclePerPart ?? 0;
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
                    <span className="text-sm text-foreground min-w-0">
                      {/* Full Process › Category › Operation chain, matching the
                          edit dialog's three pickers — never collapsed to one
                          level (a manually-added line leaves operation blank, an
                          engine line may leave category blank; showing only one
                          level hid which of the three it was). */}
                      {isExpanded ? '▾' : '▸'} <ProcessHierarchyLabel proc={proc} />
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
                          // A machining line was computed BY a database calculator:
                          // open that calculator with the engine's own inputs, their
                          // sources, and the lookup rows they came from.
                          ...(matchedEngineLine?.calculatorId && engineCalculators[matchedEngineLine.calculatorId]
                            ? { engineCalculator: engineCalculators[matchedEngineLine.calculatorId] }
                            : {}),
                          // Every other machining line's calculator too, so picking a
                          // different calculator in the dropdown opens it with the
                          // inputs the engine used for that line.
                          engineCalculators,
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
                {/* Why this cycle time: every input with its source (CAD /
                    lookup table / machine record / disclosed assumption) and
                    each formula, straight from the engine line that computed it. */}
                {matchedEngineLine && <CalculationTracePanel line={matchedEngineLine} />}
                {(heads > 1 || ppc > 1) && (
                  <div className="flex items-baseline justify-between gap-2 min-w-0">
                    <span className="text-xs text-muted-foreground truncate min-w-0">Heads × Parts/Cycle</span>
                    <span className="text-xs tabular-nums text-foreground shrink-0">{heads} × {ppc}</span>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-2 min-w-0 border-t border-border/20 pt-1">
                  <span className="text-xs text-muted-foreground truncate min-w-0">
                    Setup ({setupMin.toFixed(1)} min{setupManning > 1 ? ` × ${String(setupManning)} op` : ''} ÷ {batch})
                    {/* Where the setup time came from — a class default must never
                        read as if it were this machine's own measured setup.
                        Sourced from the live engine line, which discloses the tier
                        it resolved (see resolveSetupMinutes on the backend). */}
                    {matchedEngineLine?.setupTimeSource === 'machine' && (
                      <span className="ml-1 text-[10px] text-emerald-500/80">· machine spec</span>
                    )}
                    {matchedEngineLine?.setupTimeSource === 'operation_lookup' && (
                      <span className="ml-1 text-[10px] text-muted-foreground/70">· per-operation</span>
                    )}
                    {matchedEngineLine?.setupTimeSource === 'none' && (
                      <span className="ml-1 text-[10px] text-amber-500/90" title="No real setup_time_hr on file for this machine and no per-operation row — setup is not costed.">
                        · setup not costed
                      </span>
                    )}
                  </span>
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

                {/* Real clamp/shot tonnage math for this machine — same
                    formula and per-polymer-family clamp-factor table
                    (resolveMaterialClampFactor, machine-selector-im.ts)
                    evaluateIMCandidate uses to score/accept machines during
                    route comparison, now also shown for the actual applied
                    quote instead of only in the Process tab's route-compare
                    cards. cost.injectionMolding only exists on an
                    injection-molded quote — its own presence is the gate, no
                    separate family check needed. Scoped to the real IM
                    machine-class rows (Mold Setup/Injection/Packing/Cooling/
                    Ejection) — an Inspection or manual-rate row has no clamp
                    tonnage to show. */}
                {cost.injectionMolding && IM_MACHINE_CLASSES.has(proc.machineClass ?? '') && (
                  <div className="border-t border-border/20 pt-1.5 space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      Tonnage / Clamp Force
                    </p>
                    {cost.injectionMolding.clampRequiredT != null ? (
                      <div className="flex items-baseline justify-between gap-2 min-w-0">
                        <span className="text-xs text-muted-foreground truncate min-w-0">
                          Required{cost.injectionMolding.flowClass && cost.injectionMolding.cavityPressureMpa != null
                            ? ` (${fmt(cost.injectionMolding.projectedAreaCm2, 0)} cm² × ${cost.injectionMolding.cavityCount} cav × ${fmt(cost.injectionMolding.cavityPressureMpa, 1)} MPa, ${cost.injectionMolding.flowClass} flow)`
                            : ''}
                        </span>
                        <span className="text-xs tabular-nums text-foreground shrink-0">
                          {fmt(cost.injectionMolding.clampRequiredT, 0)}T
                        </span>
                      </div>
                    ) : null}
                    {cost.injectionMolding.clampTrace && (
                      <p className={cn('text-[11px] leading-snug', cost.injectionMolding.clampRequiredT != null ? 'text-muted-foreground/70' : 'italic text-muted-foreground/60')}>
                        {cost.injectionMolding.clampTrace}
                      </p>
                    )}
                    {cost.injectionMolding.clampMachineT != null && (
                      <div className="flex items-baseline justify-between gap-2 min-w-0">
                        <span className="text-xs text-muted-foreground truncate min-w-0">Machine capacity</span>
                        <span className="text-xs tabular-nums text-foreground shrink-0">
                          {fmt(cost.injectionMolding.clampMachineT, 0)}T
                        </span>
                      </div>
                    )}
                    {cost.injectionMolding.clampUtilPct != null && (
                      <div className="flex items-baseline justify-between gap-2 min-w-0">
                        <span className="text-xs text-muted-foreground truncate min-w-0">Clamp utilization</span>
                        <span className={cn(
                          'text-xs tabular-nums shrink-0',
                          cost.injectionMolding.clampUtilPct > 100 ? 'text-red-500 font-medium' : 'text-foreground',
                        )}>
                          {fmt(cost.injectionMolding.clampUtilPct, 0)}%
                          {cost.injectionMolding.clampUtilPct > 100 ? ' — over capacity' : ''}
                        </span>
                      </div>
                    )}
                    {cost.injectionMolding.shotRequiredG != null && cost.injectionMolding.shotMachineG != null && (
                      <div className="flex items-baseline justify-between gap-2 min-w-0">
                        <span className="text-xs text-muted-foreground truncate min-w-0">Shot required / machine</span>
                        <span className="text-xs tabular-nums text-foreground shrink-0">
                          {fmt(cost.injectionMolding.shotRequiredG, 0)}g / {fmt(cost.injectionMolding.shotMachineG, 0)}g
                          {cost.injectionMolding.shotUtilPct != null ? ` (${fmt(cost.injectionMolding.shotUtilPct, 0)}%)` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Full real machine specification behind this line — every
                    staged field for the machine actually costed, not a curated
                    subset. Reuses the same reference-detail endpoint and
                    labeller the MHR admin form uses, so a new field in the
                    machine library appears here with no code change. Fetches
                    only when opened. */}
                <div className="border-t border-border/20 pt-1.5">
                  <MachineSpecPanel
                    mhrId={proc.mhrId ?? liveCandidate?.machineId ?? null}
                    machineName={proc.machineName ?? liveMachineName}
                    alreadyShown={{
                      // Already displayed on this row, immediately above.
                      setupTimeHr: setupMin,
                      numberOfOperators: setupManning,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        );
        });
      })()}

      {/* Processes the live engine computed for this route but could never
          persist — physicsGap set (findRouteDataGaps/engine-kernel.ts blocks
          the WHOLE apply-route request whenever any line has one, "No records
          were written"). Disclosure only: NOT the removed "missing" row kind
          from above (that one carried a real, non-zero cost for an unsaved
          line into the total — the exact bug documented on this block's
          predecessor). A physicsGap line's cost is genuinely 0 by
          construction, and this block never feeds totalProcessCombined/
          grandTotal, so it can't resurrect that bug — it only makes visible
          what the footer "Partial total — ... unresolved" line already says
          in words, as an actual row instead of only a sentence. */}
      {(() => {
        const gapLines = (eff?.lines ?? []).filter((l) => !!l.physicsGap);
        if (gapLines.length === 0) return null;
        return (
          <div className="pl-2 pb-2 space-y-1.5">
            {gapLines.map((l, i) => {
              const gap = l.physicsGap as NonNullable<typeof l.physicsGap>;
              const reasonText = gap.gapType === 'missing_lookup' ? gap.requiredAction : gap.reason;
              const nearestRows = gap.gapType === 'missing_lookup' ? gap.lookupResolution?.nearestRows : undefined;
              return (
                <div
                  key={`gap:${l.process}:${i}`}
                  className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-destructive">{l.process} — unresolved</span>
                    <span className="text-muted-foreground shrink-0">not applied · $0</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">{reasonText}</div>
                  {nearestRows && nearestRows.length > 0 && (
                    <div className="mt-1 text-muted-foreground">
                      Nearest real rows on file:{' '}
                      {nearestRows.map((row, ri: number) => (
                        <span key={ri}>
                          {ri > 0 ? ' | ' : ''}
                          {Object.entries(row.columns).map(([col, val]) => `${col}=${val}`).join(', ')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
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
        liveProcessLines={cost?.processLines}
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
  item: BOMItem; batchSize: number | undefined;
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
  // types that carry real OCC face_ids in feature_graph_v2 are clickable:
  // plain holes, bends, extruded-collar holes (geo_v40+). Internal profiles have no per-wire face_id
  // plumbing yet (_face_breakdown only accumulates aggregate length/count, not
  // per-wire face identity) — that row stays plain text until that OCC-side work
  // is done, disclosed rather than silently faked.
  const v2Features = fg?.feature_graph_v2?.features ?? [];
  const highlightFor = (key: string, match: (f: FeatureGraphEntryLike) => boolean): FeatureNodeV2 | null =>
    onSelectHighlight ? mergeFeaturesToHL(`detected_${key}`, v2Features.filter(match)) : null;
  const bendHL = highlightFor('bend', isBend);
  const holeHL = highlightFor('hole', isPlainHole);
  const extrusionHL = highlightFor('extruded', isExtrudedHole);
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

              {/* Clamp tonnage / shot capacity — real per-part sizing math for
                  injection-molding tonnage-tier routes only (evaluateIMCandidate,
                  machine-selector-im.ts). Required = projected area × cavities ×
                  material clamp factor × 1.15 safety margin, checked against this
                  tier's real (or, absent a DB machine, synthetic) machine rating —
                  never a fixed number per route, it changes with the part. */}
              {!incapable && route.injectionMolding && (
                <div className="px-3 py-2 border-t border-border/30 grid grid-cols-2 gap-2 bg-background">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Clamp Tonnage</p>
                    <p className="text-xs font-medium tabular-nums text-foreground">
                      {route.injectionMolding.clampRequiredT != null
                        ? `${fmt(route.injectionMolding.clampRequiredT, 0)}T req / ${fmt(route.injectionMolding.clampMachineT ?? 0, 0)}T machine`
                        : `${fmt(route.injectionMolding.clampMachineT ?? 0, 0)}T machine`}
                    </p>
                    {route.injectionMolding.clampUtilPct != null && (
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {fmt(route.injectionMolding.clampUtilPct, 0)}% utilization
                        {route.injectionMolding.machineDataSource === 'synthetic' ? ' · class estimate' : ''}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Shot / Cavities</p>
                    <p className="text-xs font-medium tabular-nums text-foreground">
                      {route.injectionMolding.shotRequiredG != null && route.injectionMolding.shotMachineG != null
                        ? `${fmt(route.injectionMolding.shotRequiredG, 0)}g / ${fmt(route.injectionMolding.shotMachineG, 0)}g`
                        : '—'}
                      {' · '}{route.injectionMolding.cavityCount}-cavity
                    </p>
                    {route.injectionMolding.shotUtilPct != null && (
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {fmt(route.injectionMolding.shotUtilPct, 0)}% shot util · {route.injectionMolding.gateType} gate
                      </p>
                    )}
                  </div>
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
                        applyRoute.mutate({ routeId: route.routeId, batchSize: comparison.resolvedInputs.batchSize, location: factory });
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
                    <span className={line.rateSource === 'mhr_database' ? 'text-emerald-600' : line.rateSource === 'no_db_rate' ? 'text-red-600' : 'text-muted-foreground'}>
                      {line.rateSource === 'mhr_database' ? 'HR Rates machine'
                        : line.rateSource === 'no_db_rate' ? 'no machine in HR Rates'
                        : line.rateSource === 'tooling_amortization' ? 'tooling'
                        : 'allowance'}
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
  item, summary,
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

  const hasGdtFcf = gdt?.source !== undefined && gdt.source !== 'no_data' && (gdt.features?.length ?? 0) > 0;

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

// `value` is null while a scenario input has not been resolved yet — the field
// shows an em dash rather than a number this component invented.
// Shown where a panel needs a definite quantity (an RFQ volume, the Copilot's
// scenario context) that has not been resolved yet. Deliberately a wait rather
// than a stand-in number: these surfaces send figures outward, and a fabricated
// batch size would leave the building.
function ScenarioInputsPending() {
  return (
    <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground p-4">
      <AlertCircle className="h-6 w-6 opacity-30" />
      <p className="text-xs text-center">Resolving scenario inputs...</p>
    </div>
  );
}

function InputRow({ label, value, onChange, onBlur }: { label: string; value: number | null; onChange: (v: number) => void; onBlur?: () => void }) {
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
          value={value ?? ''}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          onBlur={() => { onBlur?.(); setIsEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') { if (priorValue !== null) onChange(priorValue); setIsEditing(false); }
          }}
          className="text-xs font-medium text-right w-20 shrink-0 border border-border rounded px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500 tabular-nums"
        />
      ) : (
        <button
          // Editable even when unset: for a user-supplied input like Annual
          // Volume, "—" is exactly the state the user needs to click to fix.
          // Disabling it here would have made an unresolved volume permanent.
          onClick={() => { setPriorValue(value); setIsEditing(true); }}
          title="Click to edit"
          className="flex items-center gap-1 w-20 shrink-0 justify-end px-1.5 py-0.5 rounded border border-transparent hover:border-border group"
        >
          <Edit className="h-3 w-3 text-muted-foreground group-hover:text-foreground shrink-0" />
          <span className="text-xs font-medium tabular-nums">{value === null ? '—' : value.toLocaleString()}</span>
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
          {node.factory ?? factory}
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

// The 4 real Plastic Molding machine_class slugs (migration 633/645/734) —
// used to scope the Tonnage/Clamp Force panel to rows actually costed on one
// of these real machines, never on an Inspection/manual-rate row.
const IM_MACHINE_CLASSES = new Set(['injection_molding', 'compression_molding', 'reaction_injection_molding', 'structural_foam_molding']);

// The 3 real Injection Molding route ids apply-route.dto.ts's VALID_ROUTE_IDS
// actually accepts (backend/src/modules/bom-items/dto/apply-route.dto.ts) —
// one real registered engine (injection_molding machine class), 3 real
// tonnage tiers. Kept in sync by inspection, same as REAL_PROCESS_ORDER above;
// a 4th tier or a validated compression/RIM/structural-foam apply path needs
// this list updated alongside that DTO array, never independently guessed.
const IM_DIRECT_APPLY_ROUTE_IDS = new Set(['im-small-50t', 'im-standard-200t', 'im-large-500t']);


// ── Dynamic route step model (sheet_metal only — real, DB-driven, no
// hardcoded option lists) ────────────────────────────────────────────────────
// The shape itself now lives in lib/routing/route-step.ts alongside
// computeChainTotals, so the editor's totals arithmetic is a pure, directly
// testable function instead of JSX-embedded math. See WorkflowRouteStep's own
// doc comments for the provenance rules on each field.
type DynamicRouteStep = WorkflowRouteStep;

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
  open, onClose, onApplied, partFamily, currentRouteId, onSelectRoute, factory = 'USA',
  itemId, batchSize, existingCuttingRouteId, existingSteps,
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
  factory?: string;
  itemId?: string;
  batchSize: number | undefined;
  // Exact identity of the currently-applied dynamic route (see
  // ManualRouteOption.dynamicCuttingRouteId/dynamicSteps) — when present and
  // still a valid real route, reopening this dialog to edit restores exactly
  // what's applied instead of resetting to the CAD-optimal default (which is
  // only right the FIRST time a part gets a manual route, not on every re-edit).
  existingCuttingRouteId?: string | null;
  existingSteps?: ManualRouteOption['dynamicSteps'];
}) {
  const isSheetMetal = partFamily === 'sheet_metal';
  // Plastic-molded parts: the backend's getRouteComparison() computes real, priced IM routes
  // for this exact item (3 real tonnage-tier presses using the real
  // injection_molding machine class, plus Compression/Reaction Injection/
  // Structural Foam Molding for cost comparison — see bom-items.service.ts's
  // imRoutes assembly) through the SAME endpoint useRouteComparison already
  // calls — this was a frontend wiring gap, not a missing backend capability.
  const isIM = partFamily === 'plastic_molded';
  // Machined parts: getRouteComparison() prices one complete route per real
  // catalog machine class (3 Axis Mill, 2 Axis Lathe, ... -- the registered
  // milling/turning engines), each already a full multi-line quote, exactly
  // like the plastic-molding routes. Both use the same complete-route pane.
  const isMachining = partFamily === 'milled' || partFamily === 'turned' || partFamily === 'mill_turn';
  const isCompleteRouteFamily = isIM || isMachining;

  // ── Universal real machine/rate resolution — ONE fetch each, no fixed
  // per-class array. The old array existed because React hooks can't be
  // called in a variable-length loop — but mhrApi.getAll/getBenchmarkRates
  // both treat machineClass as optional (lib/api/mhr.ts), returning every
  // class for the location when omitted. Filtering client-side per row
  // removes that ceiling structurally, which is what actually made dynamic
  // (any number of, any class) steps possible.
  // Real HR Rates machines only (memory/-backed, migration 805). A class with
  // no machine at this location resolves to null — never a benchmark row.
  // Same fetch size as ProcessCostDialog, so a real machine is never missing
  // because the list was cut short.
  const allMhr = useMHRRecords({ location: factory, limit: 10000 }, { enabled: open });
  const resolveForClass = (cls: string): { id: string; machineName: string; rate: number } | null => {
    const own = (allMhr.data?.records ?? []).filter((r) => r.machineClass === cls);
    if (own.length === 0) return null;
    const cheapest = [...own].sort((a, b) => resolveMhrUsdRate(a) - resolveMhrUsdRate(b))[0]!;
    return { id: cheapest.id, machineName: cheapest.machineName, rate: resolveMhrUsdRate(cheapest) };
  };

  // ═══ Dynamic path (sheet_metal): real, comparison-driven steps ═══════════
  // "Add Step" can only ever offer operations from this real, already-
  // engine-computed set — never an unconstrained browse of the whole DB
  // catalog. Every route the engine returns shares identical non-cutting
  // lines (see getRouteComparison's "shared process lines" — gated purely by
  // this part's real geometry, not by cutting method), so any one route's
  // full line set (minus its own cutting line) is the real universe of
  // addable operations; cutting itself gets exactly 3 real alternatives.
  const comparison = useRouteComparison((isSheetMetal || isCompleteRouteFamily) ? itemId : undefined, batchSize, factory);
  // Real 'forming' routes (Standard/Tandem/Progressive-Die Press, Roll
  // Bending — see RouteResultDto.processFamily) have NO Press Brake/
  // Deburring/Inspection lines of their own (they're complete single-
  // process alternatives). Every computation below this point assumes a
  // shared cut+bend+deburr+inspect chain across all candidate routes —
  // leaving forming routes mixed in made cuttingMachineClassesFromRoutes'
  // "shared across every route" check fail for press_brake/deburring/
  // inspection entirely (since forming routes never have them), silently
  // emptying sharedLines and wrongly flagging real shared operations as
  // "missing" for cutting routes that DO have them. Filtered once, here, at
  // the source — every downstream use (sharedLines, cuttingLineByRouteId,
  // the route-tree adapter, the restore/seeding effect) inherits the fix.
  // Unfiltered — feeds the route TREE only (real forming routes shown as
  // real, visible, non-selectable rows, matching route5.png's reference
  // structure). Every other computation below stays on the cutting-only
  // realRoutes, since forming routes have no shared Press Brake/Deburring/
  // Inspection lines and would break that "shared across every route" logic.
  const allRoutesForTree = comparison.data?.routes ?? [];
  const realRoutes = allRoutesForTree.filter((r) => r.processFamily === 'cutting');
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
  // Ordering is a real user choice now (cost / cycle time / CAD-optimal-first)
  // rather than whatever order the API happened to return — see
  // lib/routing/route-sort.ts for why 'recommended' pins exactly one route
  // instead of inventing a score for the other twelve.
  const [sortMode, setSortMode] = useState<RouteSortMode>('recommended');
  const wasOpenRef = useRef(false);

  // Multi-route tree (reference USA Digital Factory style: one real row per
  // registered-engine route — cutting AND forming, matching route5.png's reference structure
  // where Prog Die/Tandem Die are real, visible rows too, not hidden).
  // adaptRoutesToTree validates allRoutesForTree's shape at this boundary
  // (RouteTreeValidationError) — a malformed route fails loudly to an empty
  // tree + console error instead of crashing the dialog.
  const routeTree = useMemo<RouteNode[]>(() => {
    try {
      // Forming routes are real, priced, and worth comparing here, so they stay
      // visible with their full chain — but this builder STAGES a route through
      // applyCustomRoute, whose contract accepts only a cutting route as its
      // base (ApplyCustomRouteDto.baseCuttingRouteId is @IsIn(
      // VALID_BASE_CUTTING_ROUTE_IDS) = getCuttingRouteIds() only). They are
      // applied from the Route Comparison card's own Set Route instead, which
      // goes through plain applyRoute — whose VALID_ROUTE_IDS does include
      // getFormingRouteIds().
      //
      // Root-caused 2026-09-04: the tree marked every route selectable, so
      // picking a forming route and pressing "Set Route" ran
      // handleSetRouteDynamic, found no cutting line for it in
      // cuttingLineByRouteId, and returned early — an enabled button that
      // silently did nothing, with no message and no state change. Marking the
      // real constraint on the node (the exact purpose of RouteNode.selectable /
      // selectionNote) states it up front instead.
      return adaptRoutesToTree(allRoutesForTree).map((node) => {
        if (node.processFamily === 'forming') {
          return {
            ...node,
            selectable: false,
            selectionNote: 'Compare only here — apply this route from the Route Comparison card. The Workflow Builder stages cutting routes, which it can then edit step by step.',
          };
        }
        // Real, confirmed gap (2026-09-11): getRouteComparison() pushes
        // Compression/Reaction Injection/Structural Foam Molding into the
        // same array as the 3 real injection tonnage tiers purely so cost
        // comparison (badges) considers them — apply-route.dto.ts's
        // VALID_ROUTE_IDS deliberately excludes all 3 (see that array's own
        // comment: "never meant to be auto-applied, since none of the 3 ids
        // are registered apply targets"), and no real material/process
        // compatibility check exists yet (compression/RIM molding needs a
        // thermoset resin; this part's actual material has not been verified
        // against that real 35/38-material compatibility set). Shown for
        // honest cost comparison, not offered as a switchable route here —
        // same disclosed-constraint pattern as the forming-route branch above.
        if (isMachining) {
          const dto = allRoutesForTree.find((r) => r.routeId === node.id);
          if (dto && !dto.isFeasible) {
            return {
              ...node,
              selectable: false,
              selectionNote: dto.warnings?.[0] ?? 'This machine cannot produce the part (capability check failed).',
            };
          }
          return node;
        }
        if (isIM && !IM_DIRECT_APPLY_ROUTE_IDS.has(node.id)) {
          return {
            ...node,
            selectable: false,
            selectionNote: 'Different manufacturing process — shown for cost comparison only. Material/process compatibility has not been verified for this part; consult engineering before switching processes.',
          };
        }
        return node;
      });
    } catch (err) {
      if (err instanceof RouteTreeValidationError) {
        console.error('[RouteSelectionDialog] adaptRoutesToTree rejected the real route-comparison result', err.issues);
      } else {
        console.error('[RouteSelectionDialog] adaptRoutesToTree failed', err);
      }
      return [];
    }
  }, [allRoutesForTree, isIM, isMachining]);
  // The selected route as the comparison list itself models it, plus the raw
  // DTO behind it — the editor needs route-level material cost and the display
  // currency, which are real fields on RouteResultDto that the tree adapter's
  // (deliberately narrow, validated) RouteNode shape does not carry.
  const selectedRouteNode = routeTree.find((n) => n.id === cuttingRouteId) ?? null;
  const selectedRouteDto = allRoutesForTree.find((r) => r.routeId === cuttingRouteId) ?? null;
  // Route totals/rates are already in the factory's local currency — the old
  // RouteTree hardcoded '$' over them, mislabelling every non-USD factory.
  const currencySymbol = comparison.data?.currencySymbol ?? '';

  // Root-caused (2026-09-04): clicking a different route row only ever set
  // cuttingRouteId — additionalSteps stayed whatever was seeded/restored for
  // the PREVIOUS session's route (sometimes genuinely empty, e.g. a route
  // applied before this real geometry existed), so the top summary panel
  // showed "missing operations" for Press Brake/Deburring/Inspection even
  // though the SAME route's own read-only expanded chain (built straight
  // from route.processLines) already had them. sharedLines is identical
  // real content regardless of which cutting route is selected (same part
  // geometry — see the comment on its own declaration above), so a manual
  // route switch always reseeding from it is a real, honest "start this
  // route's editable chain from what it actually has", not data loss.
  function selectCuttingRoute(routeId: string) {
    // Re-clicking the row you're already on (e.g. just to collapse/expand
    // it) must NOT wipe steps you've manually added/reordered/removed —
    // only a genuine switch to a DIFFERENT cutting route reseeds.
    if (routeId !== cuttingRouteId) {
      setAdditionalSteps(sharedLines.map((l, i) => ({
        key: `${l.process}-${i}`, process: l.process, machineClass: l.machineClass,
        machineName: l.machineName ?? null,
        hourlyRate: l.hourlyRate, cycleTimeMin: l.cycleTimeMin, totalCost: l.totalCost, isReal: true,
      })));
    }
    setCuttingRouteId(routeId);
  }

  // The backend's own recommendation — selectRecommendedRoute: the cheapest
  // candidate that is both physically capable and fully costed, from real
  // rates, real machine capability and real cycle times.
  //
  // This was computeRouteScore's winner: a frontend weighted score over
  // hand-authored bases (85/70/...) and hardcoded volume breakpoints
  // (< 5,000 / > 50,000 pcs) that exist nowhere in the reference data. It
  // decided which cutting route the Workflow Builder pre-selected, and a user
  // who applied that pre-selection without changing it applied a route chosen
  // by those literals. Two recommenders for one decision, and this was the one
  // the user saw first.
  // The backend recommendation (selectRecommendedRoute, bom-items.service.ts's
  // attachToRoutes) is restricted to processFamily === 'cutting' by explicit
  // product decision: a FORMING route (Roll Bending / Standard / Tandem /
  // Progressive Die Press) produces the finished part in one operation with no
  // separate Press Brake step, so it has no cut → bend → finish chain for this
  // cutting-only Workflow Builder to stage and edit — it stays visible, priced,
  // and manually selectable via the Route Comparison card, just never the
  // automatic pick. recommendedCuttingId is therefore already a cutting route
  // whenever a candidate qualifies (never forming), which is also why
  // topRouteIds below is computed over `realRoutes` (cutting-only), not the
  // combined cutting+forming set.
  const recommendedCuttingId = comparison.data?.recommendedRouteId ?? null;
  // Up to the top 3 real cutting routes for this part, same ranking as
  // recommendedCuttingId's single winner (selectTopRoutes uses the identical
  // eligibility gate/tie-break as the backend's own selectRecommendedRoute), so
  // the comparison list always surfaces the real best few candidates instead of
  // pinning only one — topRouteIds[0] always equals recommendedCuttingId
  // whenever a candidate qualifies.
  const topRouteIds = selectTopRoutes(realRoutes, 3).map((r) => r.routeId);
  // Defensive real-data consistency check, not a second recommendation: the
  // backend already guarantees recommendedCuttingId is a cutting route, so
  // this only protects against a route id the backend named that this
  // cutting-only view somehow doesn't have a line for (e.g. a stale cache).
  const recommendedCuttingRouteId =
    recommendedCuttingId && cuttingLineByRouteId.has(recommendedCuttingId)
      ? recommendedCuttingId
      : null;
  // (The selected route's own label is no longer re-derived here — the editor
  // pane titles itself from the very RouteNode the comparison list selected,
  // so the two can no longer drift apart.)
  // Surfaced only as an honest "previously applied X" note when it differs
  // from the CAD-optimal pick above — the dialog's default no longer follows
  // it (see the seeding effect below), but silently discarding it would hide
  // a real change from the user.
  const previouslyAppliedRouteLabel = (currentRouteId && currentRouteId !== recommendedCuttingId)
    ? realRoutes.find((r) => r.routeId === currentRouteId)?.routeLabel ?? null
    : null;

  // ── "Add operation" — the full real catalog (process_calculator_mappings),
  // same source and derivation pattern as ProcessCostDialog's own hierarchical
  // picker, so any real, active catalog operation can be added, not just ones
  // this part's geometry already triggered. An operation added this way that
  // ISN'T also a real engine-computed line for this part gets a real machine
  // rate (resolveForClass) but an honest null cost / 0 cycle time — see
  // WorkflowRouteStep.isReal.
  //
  // Presented as ONE searchable list keeping Group › Route as visible section
  // headings (AddOperationPicker), replacing the three chained native selects
  // this used to need: the hierarchy is real and worth showing, but it was
  // being used as a mandatory drill-down rather than as orientation, so
  // adding one known operation cost four interactions and offered no search.
  const { data: allMappingsData } = useProcessCalculatorMappings({ limit: 1000 }, { enabled: open && isSheetMetal });
  const addOperationOptions: AddOperationOption[] = (allMappingsData?.mappings ?? [])
    .filter((m) => m.isActive)
    // Already in the chain, under either naming system (catalog operation
    // names differ from the engine's own process labels for the same class).
    .filter((m) => !(additionalSteps ?? []).some((s) => s.process === m.operation || s.machineClass === m.machineClass))
    // The cutting operation is the route selection itself (pinned, chosen in
    // the comparison list) — offering it again as an addable extra step would
    // contradict that and let one route carry two cutting operations.
    .filter((m) => !(cuttingRouteId && m.machineClass && cuttingLineByRouteId.get(cuttingRouteId)?.machineClass === m.machineClass))
    .map((m) => ({
      operation: m.operation,
      processGroup: m.processGroup,
      processRoute: m.processRoute,
      machineClass: m.machineClass ?? null,
    }));
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
            machineName: real.machineName ?? null,
            hourlyRate: real.hourlyRate, cycleTimeMin: real.cycleTimeMin, totalCost: real.totalCost, isReal: true,
          };
        }
        const resolved = resolveForClass(s.machineClass);
        return {
          key: `${s.process}-${i}`, process: s.process, machineClass: s.machineClass,
          machineName: resolved?.machineName ?? null,
          hourlyRate: resolved?.rate ?? 0, cycleTimeMin: 0, totalCost: null, isReal: false,
          ...(s.processGroup !== undefined ? { processGroup: s.processGroup } : {}),
          ...(s.processRoute !== undefined ? { processRoute: s.processRoute } : {}),
        };
      }));
      return;
    }

    // No existing dynamic route to restore — default to recommendedCuttingRouteId,
    // the real backend recommendation (always a cutting route, by the
    // processFamily==='cutting' gate in attachToRoutes). realRoutes[0] only
    // applies in the genuine edge case where no cutting route qualifies at all
    // (every one infeasible or data-incomplete for this part) — real backend
    // data, just an arbitrary UI focus with nothing left to rank.
    setCuttingRouteId(recommendedCuttingRouteId ?? realRoutes[0]!.routeId);
    setAdditionalSteps(sharedLines.map((l, i) => ({
      key: `${l.process}-${i}`, process: l.process, machineClass: l.machineClass,
      machineName: l.machineName ?? null,
      hourlyRate: l.hourlyRate, cycleTimeMin: l.cycleTimeMin, totalCost: l.totalCost, isReal: true,
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
      machineName: l.machineName ?? null,
      hourlyRate: l.hourlyRate, cycleTimeMin: l.cycleTimeMin, totalCost: l.totalCost, isReal: true,
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
  // Adds the operation picked in AddOperationPicker. If it matches a real,
  // engine-computed line for this part (isReal: true), reuse its real
  // cycleTimeMin/hourlyRate/totalCost verbatim. Otherwise it's a real catalog
  // operation with no geometric trigger here yet — real machine class + real
  // machine rate (resolveForClass), but an honest 0 cycle time and null cost,
  // never fabricated (see applyCustomRoute server-side).
  function addStepFromCatalog(mapping: AddOperationOption) {
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
        machineName: real.machineName ?? null,
        hourlyRate: real.hourlyRate, cycleTimeMin: real.cycleTimeMin, totalCost: real.totalCost, isReal: true,
      }]);
    } else if (mapping.machineClass) {
      const resolved = resolveForClass(mapping.machineClass);
      setAdditionalSteps((prev) => [...(prev ?? []), {
        key, process: mapping.operation, machineClass: mapping.machineClass!,
        machineName: resolved?.machineName ?? null,
        hourlyRate: resolved?.rate ?? 0, cycleTimeMin: 0, totalCost: null, isReal: false,
        processGroup: mapping.processGroup, processRoute: mapping.processRoute,
      }]);
    }
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

  // ═══ Dynamic path: the route-defining first operation, as an editor step ═══
  // Shown pinned at the head of the chain rather than as a separate read-only
  // list above it, so each operation appears exactly once. It carries the same
  // real engine numbers as every other step (ProcessLineCost), including the
  // machine the engine ACTUALLY selected — the retired flow diagram labelled
  // this node with resolveForClass()'s independent "cheapest machine of this
  // class" pick while printing the engine's numbers beside it, which is the
  // same display divergence WorkflowRouteStep.machineName was introduced to
  // stop in the step table.
  const dynamicCuttingStep: DynamicRouteStep | null = (() => {
    const cl = cuttingRouteId ? cuttingLineByRouteId.get(cuttingRouteId) : undefined;
    if (!cl) return null;
    return {
      key: `cutting:${cl.machineClass}`,
      process: cl.process,
      machineClass: cl.machineClass,
      machineName: cl.machineName ?? null,
      hourlyRate: cl.hourlyRate,
      cycleTimeMin: cl.cycleTimeMin,
      totalCost: cl.totalCost,
      isReal: true,
    };
  })();

  // ═══ IM path (plastic_molded): pick one of the real, priced routes
  // getRouteComparison() already computed — no per-step composition, since
  // each real IM route (a real registered engine: Injection Molding at 3
  // tonnage tiers, or Compression/Reaction Injection/Structural Foam
  // Molding) is already a complete, self-contained multi-line quote (Mold
  // Setup/Injection/Packing/Cooling/Ejection/Inspections all included). ═══
  // A complete route can be set when apply-route accepts it: for plastic,
  // one of the 3 injection tonnage tiers; for machining, any feasible
  // catalog-machine route (apply-route.dto.ts validates against the same
  // registered milling/turning engines the comparison priced).
  const isCompleteRouteApplicable = (routeId: string | null): boolean => {
    if (!routeId) return false;
    if (isIM) return IM_DIRECT_APPLY_ROUTE_IDS.has(routeId);
    if (isMachining) return allRoutesForTree.some((r) => r.routeId === routeId && r.isFeasible);
    return false;
  };

  function handleApplyCompleteRoute() {
    const selected = allRoutesForTree.find((r) => r.routeId === cuttingRouteId);
    if (!selected || !isCompleteRouteApplicable(selected.routeId)) return;
    const route: ManualRouteOption = {
      id: `custom-${Date.now()}`,
      label: selected.routeLabel,
      complexityLevel: 'standard',
      isRecommended: false,
      processes: selected.processLines.map((l) => l.process),
      rationale: `${selected.routeLabel} route — selected in Workflow Builder`,
      directApplyRouteId: selected.routeId,
    };
    onSelectRoute(route);
    onApplied();
  }

  const canSetDynamicRoute = !!cuttingRouteId && !!additionalSteps && !!dynamicCuttingStep;
  const canSetCompleteRoute = isCompleteRouteApplicable(cuttingRouteId);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      {/* Wide enough to hold the comparison list and the step editor side by
          side. NN/g's data-table research is explicit that the "view or edit a
          single record" task wants the record visible ALONGSIDE the rows you
          are comparing it against, not stacked behind an accordion inside one
          of them — a 672px column could never do both at once. */}
      <DialogContent
        className="w-[95vw] max-w-[1120px] p-0 gap-0 overflow-hidden flex flex-col"
        style={{ height: 'min(88vh, 780px)' }}
      >

        <DialogHeader className="px-5 py-3 border-b shrink-0 space-y-1 text-left sm:text-left">
          <DialogTitle className="text-base leading-none">Workflow Builder</DialogTitle>
          <p className="text-xs text-muted-foreground leading-snug">
            {isSheetMetal
              ? 'Compare every route priced for this part, then adjust the chosen route’s operations.'
              : isIM
                ? 'Compare every real molding route priced for this part, then set one as the applied route.'
                : isMachining
                  ? 'Compare every machine route priced for this part, then set one as the applied route.'
                  : 'No priced routes are available for this part family yet.'}
          </p>
        </DialogHeader>

        {isSheetMetal ? (
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(320px,400px)_1fr] divide-y md:divide-y-0 md:divide-x divide-border/60">
            <RouteCompareList
              nodes={routeTree}
              selectedId={cuttingRouteId}
              onSelect={(node) => selectCuttingRoute(node.id)}
              recommendedIds={topRouteIds}
              sortMode={sortMode}
              onSortModeChange={setSortMode}
              currencySymbol={currencySymbol}
              isLoading={comparison.isLoading}
              errorMessage={comparison.error instanceof Error ? comparison.error.message : null}
            />
            <RouteStepEditor
              route={selectedRouteNode}
              cuttingStep={dynamicCuttingStep}
              steps={additionalSteps ?? []}
              onMoveStep={moveStep}
              onRemoveStep={removeStep}
              onAddOperation={addStepFromCatalog}
              addOperationOptions={addOperationOptions}
              stepOrderWarnings={stepOrderWarnings}
              missingSteps={missingRealSteps}
              onAddMissingStep={(m) => {
                const line = missingRealSteps.find((l) => l.machineClass === m.machineClass);
                if (line) addMissingStep(line);
              }}
              materialCost={selectedRouteDto?.materialCost ?? null}
              currencySymbol={currencySymbol}
              // Compared against the exact same default the seeding effect above
              // computed, so the two can never disagree.
              provenanceLabel={cuttingRouteId
                ? (cuttingRouteId === (recommendedCuttingRouteId ?? realRoutes[0]?.routeId) ? 'CAD-optimal' : 'Custom')
                : null}
              previouslyAppliedLabel={previouslyAppliedRouteLabel}
            />
          </div>
        ) : isCompleteRouteFamily ? (
          /* Complete-route path (plastic_molded, milled/turned/mill_turn): a
             real, priced route list — no per-step composition pane, since
             each real route here is already a complete quote (see
             handleApplyCompleteRoute). The right pane is a read-only view of
             the selected route's real processLines, not an editor. */
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(320px,400px)_1fr] divide-y md:divide-y-0 md:divide-x divide-border/60">
            <RouteCompareList
              nodes={routeTree}
              selectedId={cuttingRouteId}
              onSelect={(node) => setCuttingRouteId(node.id)}
              recommendedIds={[]}
              sortMode={sortMode}
              onSortModeChange={setSortMode}
              currencySymbol={currencySymbol}
              isLoading={comparison.isLoading}
              errorMessage={comparison.error instanceof Error ? comparison.error.message : null}
              cuttingGroupMeta={isIM ? {
                title: 'Molding process',
                description: 'Real, priced alternatives for this part. Only the injection tonnage tiers can be set here — Compression/Reaction Injection/Structural Foam Molding are shown for cost comparison only (see the note on each row).',
              } : {
                title: 'Machine',
                description: 'One real, priced route per catalog machine for this part. Machines that cannot produce it stay listed with the reason.',
              }}
            />
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {!selectedRouteDto ? (
                <p className="text-xs text-muted-foreground">Select a route on the left to see its full operation chain.</p>
              ) : (
                <>
                  <h4 className="text-sm font-semibold mb-2">{selectedRouteDto.routeLabel}</h4>
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        <th className="px-2 py-1.5 text-left">Operation</th>
                        <th className="px-2 py-1.5 text-left">Machine</th>
                        <th className="px-2 py-1.5 text-right">Cycle</th>
                        <th className="px-2 py-1.5 text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRouteDto.processLines.map((line, i) => (
                        <tr key={`${line.process}-${String(i)}`} className="border-b border-border/40">
                          <td className="px-2 py-1.5">{line.process}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{line.machineName ?? '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{formatEstCycleTime(line.cycleTimeMin * 60)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{currencySymbol}{line.totalCost.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!isCompleteRouteApplicable(selectedRouteDto.routeId) && (
                    <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
                      This process cannot be set from here — see the note on its row in the list.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <p className="text-xs text-muted-foreground">
              No priced routes are available for this part family yet.
            </p>
          </div>
        )}

        {/* Footer. The staging rule used to be an easily-missed right-aligned
            grey sentence next to the button it qualifies; it is the single
            most consequential thing in this dialog (this button writes
            nothing), so it now reads as a leading statement. */}
        <DialogFooter className="px-5 py-3 border-t shrink-0 gap-3 flex-col items-stretch sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[56ch] text-left text-[11px] leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">Nothing is written yet.</span>{' '}
            Set Route stages this as the manual route — apply it with the Cost Guide’s Apply button,
            together with any Digital Factory or Batch Size change.
          </p>
          <div className="flex shrink-0 justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => { if (isSheetMetal) handleSetRouteDynamic(); else if (isCompleteRouteFamily) handleApplyCompleteRoute(); }}
              disabled={isSheetMetal ? !canSetDynamicRoute : !canSetCompleteRoute}
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

  // Search is ranked SERVER-side (GET /raw-materials?search=) by the same
  // deterministic material ranker the costing resolver uses: exact name >
  // registered alias > designation ("6061" as a whole token) > cross-standard
  // (ASTM/DIN/EN/JIS) > typed prefix, in both aluminum/aluminium spellings.
  // This dialog used to filter client-side with a hand-synced copy of the
  // spelling logic and NO ranking, so the grade the user meant could sit
  // anywhere in an alphabetical list -- and could differ from the row costing
  // actually picked. One ranker, one answer.
  const { debouncedValue: debouncedSearch } = useDebounce(search.trim(), 250);
  const isSearching = debouncedSearch.length > 0;

  // Full catalog (cached): the un-searched browse view and the source of the
  // Group filter list (which must not shrink to the current search's groups).
  const { data: catalog, isLoading: catalogLoading } = useRawMaterials(open ? { limit: 1000 } : undefined);
  const { data: searchData, isFetching: searchFetching } = useRawMaterials(
    isSearching ? { search: debouncedSearch, limit: 1000 } : undefined,
    { enabled: open && isSearching, keepPrevious: true },
  );
  const isLoading = isSearching ? searchFetching && !searchData : catalogLoading;
  const materials: RawMaterial[] = isSearching ? (searchData?.items ?? []) : (catalog?.items ?? []);

  const groups = Array.from(new Set((catalog?.items ?? []).map((m) => m.materialGroup).filter(Boolean))).sort();

  const filtered = materials.filter((m) => !groupFilter || m.materialGroup === groupFilter);

  const MATCH_TIER_LABEL: Record<string, string> = {
    exact: 'Exact',
    alias: 'Alias',
    designation: 'Grade match',
    standard: 'Standard match',
    partial: 'Partial',
    descriptive: 'Related',
    substring: 'Contains',
  };

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
                    const disp = splitMaterialDisplay(m.material, m.materialGrade);
                    return (
                      <tr
                        key={m.id}
                        onClick={() => setSelected(m)}
                        title={isSearching ? m.matchReason : undefined}
                        className={cn(
                          'border-b cursor-pointer transition-colors text-xs',
                          isActive
                            ? 'bg-violet-500/10 border-violet-500/20'
                            : 'hover:bg-muted/30',
                        )}
                      >
                        <td className="px-2.5 py-1.5 text-muted-foreground text-[10px]">{m.materialGroup ?? '—'}</td>
                        <td className="px-2.5 py-1.5 font-medium">
                          {disp.material}
                          {isSearching && m.matchTier && (
                            <span className="ml-1.5 text-[9px] font-normal border border-border rounded px-1 py-0.5 text-muted-foreground align-middle">
                              {MATCH_TIER_LABEL[m.matchTier] ?? m.matchTier}
                            </span>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">{disp.grade ?? '—'}</td>
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
  factoryDraft, setFactoryDraft, batchSizeDraft, setBatchSizeDraft, effectiveBatchSize,
  batchSizeAuto, setBatchSizeAuto, resolvedInputs,
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
  batchSize: number | undefined;
  productionLife: number | null; setProductionLife: (v: number) => void;
  processRouting: 'auto' | 'manual'; setProcessRouting: (v: 'auto' | 'manual') => void;
  factory: string;
  // Digital Factory + Batch Size drive live server recompute (useCostSummary/
  // useRouteComparison/useCostOverride etc. all key off the committed factory/
  // batchSize above) — staged as drafts (owned by the parent, not here, so the
  // Workflow Builder can also see scenarioDirty) so picking a new factory or
  // typing a new batch size doesn't refetch the whole scenario on every change.
  // Only committing both together via "Apply Scenario" updates factory/batchSize.
  factoryDraft: string; setFactoryDraft: (v: string) => void;
  // null = no explicit override; the resolver's own value (derived from annual
  // volume, or the canonical default) is what prices the part.
  batchSizeDraft: number | null; setBatchSizeDraft: (v: number | null) => void;
  // What the engine actually priced against, already resolved server-side --
  // shown in the Batch Size field whenever there is no explicit override.
  effectiveBatchSize: number | null;
  // true once the user has cleared the Batch Size field, asking for the
  // annual-volume derivation back. See the parent state for why this is not
  // just `batchSizeDraft === null`.
  batchSizeAuto: boolean; setBatchSizeAuto: (v: boolean) => void;
  // The resolver echo the parent already picked (item-first for freshness --
  // see its definition). Used for the costing-input rows so they do not wait on
  // this panel's own ~13s cost-summary query.
  resolvedInputs: ResolvedCostingInputs | null;
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
  // `null` = no annual volume on file, which is a real state after migration
  // 705 — not 0, which would read as "this part makes nothing this year".
  const [annualVolumeDraft, setAnnualVolumeDraft] = useState<number | null>(item.annualVolume);
  // Awaitable on purpose. bom_items.annual_volume is authoritative (no scenario
  // override key, by design), and the SERVER derives batch size from it, so
  // apply-route must not be allowed to re-resolve the scenario while this write
  // is still in flight -- it would price the part against the previous volume.
  // Was a fire-and-forget `.mutate()` reachable only from the field's onBlur.
  const commitAnnualVolume = async () => {
    // Only a real, positive figure is written. Clearing the field leaves the
    // volume unresolved rather than committing a 0 nobody meant.
    if (annualVolumeDraft !== null && annualVolumeDraft > 0 && annualVolumeDraft !== item.annualVolume) {
      await updateBOMItem.mutateAsync({ id: item.id, data: { annualVolume: annualVolumeDraft } });
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
        queryKey: costSummaryQueryKey(item.id, batchSize, loc),
        queryFn: () => apiClient.get<CostSummaryDto>(
          costSummaryUrl(item.id, batchSize, loc),
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
        costSummaryQueryKey(item.id, batchSize, loc),
      );
      const freshSummaryForProcess = liveSummary ?? (loc !== factory ? await fetchFreshCostSummary(loc) : cgpCostSummary);
      const lines = freshSummaryForProcess?.processLines ?? [];
      if (!lines.length) return;
      // The batch these very lines were amortised over. Read off the summary
      // being written, never from this component's request state: setupTimeMins
      // below INVERTS the engine's own division, so using any other number
      // silently back-derives a setup time the engine never computed and
      // persists it onto the row.
      const summaryBatchSize = freshSummaryForProcess?.resolvedInputs.batchSize
        ?? freshSummaryForProcess?.batchSize;
      if (summaryBatchSize === undefined) return;
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
        // A genuine physics gap (physicsGap present — see cost-breakdown.dto.ts's
        // doc comment) leaves cycleTimeMin at a real, unresolved 0, never a
        // guessed number. CreateProcessCostDto requires cycleTime >= 1 (a
        // process cannot take zero time), so persisting this row would mean
        // either failing validation (the "Time must be 1 or greater" 400 this
        // was silently retrying on every Apply) or fabricating a fake cycle
        // time to satisfy it — both wrong. Skip the line instead; the gap is
        // already surfaced to the user via the cost.warnings banner above.
        if (cycleTimeSec < 1) continue;
        // The engine's exact, un-amortised setup minutes and real crew size,
        // read straight off the line. This path PERSISTS them, so the previous
        // reverse-derivation from the rounded amortised setupCost did real
        // damage: at batch 100,000 a genuine 4.8-minute laser setup and a
        // 5.0-minute PEM setup were both written as 0.0, which is what put
        // "Setup (0.0 min / 100000) $0.00" on every row of the Cost Guide.
        // The backend's own apply-route writer has read line.setupTimeMin /
        // line.operators directly since the machine-spec work; this brings the
        // auto-fill path onto the same contract. See process-line-setup.ts.
        const lineSetup = resolveLineSetup(line, summaryBatchSize);
        const setupTimeMins = roundSetupMinutes(lineSetup.setupTimeMin);
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
          // ROOT CAUSE (confirmed live, 2026-09-18): `operation` is the field
          // engine-generated lines identify themselves through (see this
          // DTO's own doc comment: "engine-generated lines... NULL [category],
          // identify themselves through `operation`"). line.operation is a
          // real identity, but it's resolved PURELY by machine class
          // (processIdentityByMachineClass, one entry per class) — every
          // real, distinct line on the same machine (e.g. a 2-Axis Bar Feed
          // Lathe's "Rough Turning"/"Finish Turning"/"Boring/Drilling") shares
          // the identical class-level identity string. Saving that instead
          // of line.process (the engine's own distinct per-line name)
          // collapsed all three into one repeated label in the Manufacturing
          // Process tree ("2 Axis Bar Feed Lathe with Sub Spindle" x3).
          // line.process is always real and always distinct; prefer it.
          // (`|| ''` only satisfies exactOptionalPropertyTypes' string
          // requirement -- line.process is a required field on
          // ProcessLineCost and always populated by makeLine(), so this
          // fallback is never actually reached.)
          operation: line.process || line.operation || '',
          // The machine's own HR Rates group (what the Process picker lists),
          // else the catalog identity. Neither = left empty: the dialog then
          // reads it off the linked machine. Never guessed from the class.
          ...((line.machineSelection?.balanced?.candidate?.processGroup ?? line.processGroup)
            ? { processGroup: (line.machineSelection?.balanced?.candidate?.processGroup ?? line.processGroup)! }
            : {}),
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
          setupManning: lineSetup.setupManning,
          batchSize: summaryBatchSize,
          heads: 1,
          partsPerCycle: 1,
          scrap: 0,
          // Deliberately omitted rather than set to a literal 8. This payload is
          // assembled from a resolved machine, and the real hours/day for it is
          // shifts_per_day x hours_per_shift on its own mhr_records row — not a
          // constant. The column is disclosure only (the cost engine declares
          // shiftPatternHoursPerDay but no calculation reads it), so leaving it
          // unset is honest where a hardcoded 8 was not.
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
        costSummaryQueryKey(item.id, batchSize, loc),
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
      // Look up material -- exact name first (already-loaded caches), then the
      // server's RANKED search for a loose grade ("6061", "IS2062 E250 CRCA").
      // The ranker is the same deterministic one the costing engine resolves
      // material with (exact > alias > designation > cross-standard > prefix,
      // base grade over suffix variants), and it flags `matchIsBest` on a row
      // ONLY when the term is unambiguous -- so this record and the engine
      // agree on one row, and a bare family name ("ALUMINUM") selects nothing
      // instead of whichever row sorted first. The old client-side token
      // scoring broke ties by list order and only ran for multi-word grades.
      const exactMatchMat = (m: RawMaterial) =>
        materialLabel(m.material, m.materialGrade) === grade ||
        m.materialGrade === grade ||
        m.material === grade;

      let mat: RawMaterial | undefined =
        allMatsData?.items?.find(exactMatchMat) ??
        dbMaterialsForValidation?.items?.find(exactMatchMat);

      if (!mat) {
        try {
          const resp = await apiClient.get<{ items: RawMaterial[] }>('/raw-materials', { params: { search: grade, limit: 10 } });
          mat = resp?.items?.find(exactMatchMat) ?? resp?.items?.find((m) => m.matchIsBest);
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
        costSummaryQueryKey(item.id, batchSize, loc),
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
      // Real sheet nesting, else the real machining stock the blank optimizer
      // selected (stock volume x density -- the same figure the engine prices
      // material on), else a disclosed net/(1-10%) estimate used only when
      // neither exists yet (cost summary still loading, or density unresolved).
      // See deriveMaterialUsage: the estimate must never override a real
      // stock weight, which was the bug for machined parts.
      const { grossUsage, netUsage, scrapPct: scrap } = deriveMaterialUsage({
        blankSpec: freshSummary?.blankSpec,
        isSheetMetal: isSheetMetalPart,
        engineGrossKg,
        engineNetKg,
        itemVolumeMm3: item.volume,
        densityKgM3: density,
        cadWeightKg: cadWeight,
      });

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
  // default route. Called by the bottom "Apply" button's own material-grade
  // branch (which has already called
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
    const routingMode = processRouting;
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

      // ── Automatic routing: re-evaluate the candidate routes ────────────────
      // The defect this closes: automatic routing never consulted the route
      // comparison at all. It re-applied whatever route id was already stamped
      // on the persisted records, and when there was none it copied a fixed
      // default line set — so the backend could cost fifteen candidate routes,
      // rank them, and have that result reach nothing. A cheaper applicable
      // route could not win no matter what the real data said.
      //
      // The comparison is fetched with the SAME resolved costing inputs the
      // Cost Guide is showing (no batchSize stated — the server resolves it
      // from the committed scenario, which applyScenario has just written), so
      // annual volume, batch size and production life reach this decision
      // through the one canonical resolver rather than a second copy.
      //
      // Manual routing deliberately does NOT come through here: a route the
      // user chose is re-applied as-is, never replaced by the recommendation.
      let routeIdToApply: string | null = existingRouteId;
      if (routingMode === 'auto') {
        try {
          const comparison = await queryClient.fetchQuery({
            queryKey: ['bom-items', item.id, 'route-comparison', undefined, loc],
            queryFn: () => apiClient.get<RouteComparisonDto>(
              `/bom-items/${item.id}/route-comparison?location=${encodeURIComponent(loc)}`,
              { timeout: 180000 },
            ),
            staleTime: 0,
          });
          // null means no candidate was both capable and fully costed. Keep
          // whatever is already applied rather than inventing a choice.
          routeIdToApply = comparison.recommendedRouteId ?? existingRouteId;
        } catch (e) {
          // A failed comparison must not silently downgrade to the fixed
          // default line set — that is the very behaviour being removed.
          console.error('[reapplyExistingOrDefaultRoute] route comparison failed:', e);
          if (existingRouteId) {
            toast.error('Could not re-evaluate routes — the currently applied route was kept.');
          }
        }
      }

      if (routeIdToApply) {
        // applyRoute's backend endpoint deletes ALL active rows and inserts the
        // new set in one request (writeProcessLinesAsRecords) — atomic from the
        // client's point of view, no separate deactivation step needed here.
        // It also persists the exact setupTimeMin/operators and the real
        // machine_class and route id, which the default-create path below
        // cannot, so this is the branch that produces a reproducible route.
        try {
          // No batchSize stated on purpose. applyScenario has already written
          // the committed batch to scenario_overrides, and the server resolves
          // from there — so this re-apply cannot rewrite the records at the
          // batch that was current when this closure was created. That stale
          // capture was the reason changing Batch Size and pressing Apply left
          // Auto-routed rows amortised over the OLD batch.
          await applyRoute.mutateAsync({ routeId: routeIdToApply, location: loc });
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
        // Annual volume first, and awaited: the batch size the route is applied
        // at is derived from it server-side, so committing it after (or racing)
        // applyScenario would apply the route at the OLD volume. No-ops when the
        // field is unchanged. Reaching Apply without blurring the field is the
        // normal case -- clicking the button is what blurs it -- so this cannot
        // rely on onBlur having already fired and settled.
        await commitAnnualVolume();
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

        // Single commit point for Material Grade — every picker interaction above
        // (typing, dropdown pick, Browse dialog, drawing suggestion) only stages
        // matInputValue; nothing writes materialGrade to the server until here.
        // materialSource: 'manual' is real provenance (migration 081): it's what
        // lets the backend's costing precedence (bom-items.service.ts) trust this
        // explicit selection is exactly that — explicit, not a guess.
        const pendingGrade = matInputValue.trim();
        if (pendingGrade && pendingGrade !== item.materialGrade) {
          try {
            await updateBOMItem.mutateAsync({ id: item.id, data: { materialGrade: pendingGrade, materialSource: 'manual' } });
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
      if (batchSizeDraft !== null) appliedParts.push(`Batch: ${batchSizeDraft.toLocaleString()}`);
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
                    // Enter only closes the dropdown — matInputValue is already staged
                    // live via onChange above. The one and only place this gets
                    // committed to the server is the main "Apply" scenario flow
                    // (runApplyScenario), so a typed grade never silently prices the
                    // part before the engineer has confirmed the whole scenario.
                    if (e.key === 'Enter' && matInputValue.trim()) {
                      setMatDropOpen(false);
                    }
                    if (e.key === 'Escape') setMatDropOpen(false);
                  }}
                  placeholder="Search raw materials database…"
                  title="Select a material grade from the raw materials database"
                  className="w-full text-xs border border-border rounded px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500 pl-8 pr-24"
                />
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
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
                            // Stage only — committed by the main Apply flow, same as typing.
                            setMatInputValue(grade);
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

              {/* Currently-costed confirmation — the grade the ENGINE actually
                  resolved and priced with, echoed on the cost-summary response.
                  Root cause fixed 2026-09-18/19: costing now ONLY ever prices
                  against the engineer's own explicit Material Grade selection
                  (item.materialGrade) — drawing/CAD-extracted text is never
                  read into the costing precedence at all (bom-items.service.ts),
                  so this value and the stored column can no longer diverge the
                  way they used to (a CAD-import-written generic grade like
                  "Generic CuZn39Pb3" silently beating a real drawing/selection). */}
              {cgpCostSummary?.materialGrade && (
                <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 mb-1.5 px-0.5">
                  <span>✓</span>
                  <span>Currently costed as <strong>{cgpCostSummary.materialGrade}</strong></span>
                </div>
              )}

              {/* Drawing / CAD suggestion — shown only when it is NOT already the
                  grade being costed. Never applied immediately: this only stages
                  matInputValue (same as typing/picking above) — the single commit
                  point for Material Grade is the main "Apply" scenario flow. */}
              {hasDrawingMaterial && drawingMaterial !== (cgpCostSummary?.materialGrade ?? item.materialGrade) && (
                <div className="flex items-center gap-1.5 mb-1.5 pb-1.5 border-b border-border/30">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium truncate block">{drawingMaterial}</span>
                    <span className="text-[9px] text-muted-foreground/60 leading-tight">From drawing title block</span>
                  </div>
                  <span className="text-[9px] font-semibold text-blue-400 border border-blue-500/40 rounded px-1 py-px leading-none shrink-0">DRAWING</span>
                  <button
                    onClick={() => setMatInputValue(drawingMaterial!)}
                    className="text-[9px] font-medium text-violet-400 hover:text-violet-300 shrink-0"
                    title="Stage this grade — commit it with the main Apply button below"
                  >Use</button>
                </div>
              )}
            </Section>

            {/* Sheet-metal-only: "thickness" is a sheet-metal concept (the flat
                stock is defined by its thickness). A turned/milled part's real
                stock is a bar/billet, shown by the family-aware "Blank Stock"
                section below instead — showing this block for those parts
                rendered as permanently empty noise (CAD Thickness "—",
                Effective Thickness "0 mm"), never real stock information. */}
            {(fg?.classification?.family === 'sheet_metal' || (summary?.sheetThicknessMm ?? 0) > 0) && (
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
            )}

            {cgpCostSummary?.blankSpec && (
              <Section title="Blank Stock">
                <BlankStockSection
                  blank={cgpCostSummary.blankSpec}
                  currencySymbol={cgpCostSummary.currencySymbol ?? '₹'}
                  stockFormOverride={(item.scenarioOverrides?.['stockForm'] as string | undefined) ?? null}
                  onStockFormChange={(v) => patchScenarioOverrides.mutate({ id: item.id, patch: { stockForm: v } })}
                />
              </Section>
            )}

            {(cgpCostSummary?.injectionMolding?.cavityLayouts?.length ?? 0) > 0 && (
              <Section title="Mold Cavities">
                <MoldCavitiesSection
                  im={cgpCostSummary!.injectionMolding!}
                  override={(item.scenarioOverrides?.['cavityCount'] as number | undefined) ?? null}
                  onChange={(v) => patchScenarioOverrides.mutate({ id: item.id, patch: { cavityCount: v } })}
                />
              </Section>
            )}

            <Section title="Volume and Batch Size">
              <InputRow label="Annual Volume" value={annualVolumeDraft} onChange={setAnnualVolumeDraft} onBlur={commitAnnualVolume} />
              {/* Shows the batch size the engine actually priced against -- which
                  is ceil(annualVolume / BATCHES_PER_YEAR) when nothing overrides
                  it -- so editing Annual Volume visibly moves this field instead
                  of leaving a stale number behind. Typing here creates a real
                  override; clearing it (0 or empty) removes the override and
                  hands the field back to the derivation. */}
              <InputRow
                label="Batch Size"
                // On a pending auto request show the figure it will resolve to
                // (the server's derivedBatchSize), not a dash -- the point of the
                // click is to see annual volume take effect.
                value={batchSizeDraft ?? (batchSizeAuto
                  ? (resolvedInputs?.derivedBatchSize ?? null)
                  : effectiveBatchSize)}
                onChange={(v) => {
                  if (v >= 1) { setBatchSizeDraft(v); setBatchSizeAuto(false); }
                  else { setBatchSizeDraft(null); setBatchSizeAuto(true); }
                }}
              />
              {/* A saved batch-size override outranks the annual-volume
                  derivation (resolveCostingInputs: request > scenario_override >
                  derived > default). Without this line the field just shows a
                  number that contradicts the Annual Volume above it, with no way
                  to tell that an override is the reason -- which is exactly what
                  happened after annual volume was edited to 15,000 and Batch Size
                  stayed at a saved 125,000.
                  The implied figure comes from the server (resolvedInputs
                  .derivedBatchSize); this component must not divide by the
                  batches-per-year policy itself. */}
              {(() => {
                const ri = resolvedInputs;
                const implied = ri?.derivedBatchSize ?? null;
                const overriding =
                  batchSizeDraft === null
                  && !batchSizeAuto
                  && implied !== null
                  && (ri?.provenance?.batchSize === 'scenario_override' || ri?.provenance?.batchSize === 'request')
                  && ri?.batchSize !== implied;
                if (!overriding) return null;
                return (
                  <div className="flex items-center justify-between gap-2 pl-1 pb-0.5">
                    <span className="text-[10px] leading-tight text-amber-600 dark:text-amber-500">
                      Saved override — annual volume implies {implied.toLocaleString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setBatchSizeDraft(null); setBatchSizeAuto(true); }}
                      className="text-[10px] shrink-0 underline text-muted-foreground hover:text-foreground"
                    >
                      Use annual volume
                    </button>
                  </div>
                );
              })()}
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
              {/* Was `batchSizeDraft` alone, which read "--" whenever the user had
                  not typed an override even though the engine had a real derived
                  batch size -- the "apply is not taking annual volume" symptom. */}
              <li>
                Batch size:{' '}
                <span className="text-foreground font-medium">
                  {(batchSizeDraft ?? effectiveBatchSize)?.toLocaleString() ?? '—'}
                </span>
                {/* Label comes from the server's own provenance, never from
                    re-deriving the rule here -- BATCHES_PER_YEAR lives in
                    costing-inputs.ts and must not be duplicated in a component. */}
                {batchSizeDraft === null && resolvedInputs?.provenance?.batchSize === 'derived' && (
                  <span className="text-muted-foreground"> (derived from annual volume)</span>
                )}
                {batchSizeAuto && resolvedInputs?.provenance?.batchSize !== 'derived' && (
                  <span className="text-muted-foreground"> (will re-derive from annual volume)</span>
                )}
              </li>
              {/* Annual Volume and Production Life both reach the engine (batch-size
                  derivation and tooling amortisation), so the confirmation has to
                  name them -- otherwise an applied scenario silently depends on two
                  inputs the dialog never mentioned. */}
              <li>Annual volume: <span className="text-foreground font-medium">{annualVolumeDraft?.toLocaleString() ?? 'Not on file'}</span></li>
              <li>Production life: <span className="text-foreground font-medium">{productionLife ?? '—'} yr</span></li>
              {matInputValue.trim() && (
                <li>Material: <span className="text-foreground font-medium">{matInputValue.trim()}</span></li>
              )}
              {/* Blank Stock (round bar/hex bar/rectangular bar/billet, or the
                  Stock Form override) directly drives material cost — was
                  visible in the left "Blank Stock" panel but never confirmed
                  here, so Apply silently committed a stock decision the user
                  never saw restated. Mirrors the panel's own numbers so this
                  dialog can't drift from what's actually about to be locked in. */}
              {cgpCostSummary?.blankSpec && (
                <li>
                  Blank stock:{' '}
                  <span className="text-foreground font-medium">
                    {cgpCostSummary.blankSpec.sizeLabel} ({BLANK_STOCK_FORM_LABELS[cgpCostSummary.blankSpec.form] ?? cgpCostSummary.blankSpec.form})
                  </span>
                  <span className="text-muted-foreground">
                    {' '}· {cgpCostSummary.blankSpec.grossWeightKg.toFixed(3)} kg gross / {cgpCostSummary.blankSpec.netWeightKg.toFixed(3)} kg net · {cgpCostSummary.blankSpec.utilizationPct.toFixed(1)}% utilization
                  </span>
                  {(item.scenarioOverrides?.['stockForm'] as string | undefined) && (
                    <span className="text-muted-foreground"> (Stock Form override)</span>
                  )}
                </li>
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
          // Stage only — committed by the main Apply flow, same as typing/picking above.
          setMatInputValue(grade);
          setMatPickerOpen(false);
        }}
      />
    </div>
  );
}

// ── SustainabilityTab ─────────────────────────────────────────────────────────

function SustainabilityTab({ item, batchSize, factory }: { item: BOMItem; batchSize: number | undefined; factory: string }) {
  // Was omitting location entirely — useCostSummary defaults to 'USA' when
  // no location is passed, so this tab silently ran a full second cost
  // computation for USA on every load/Apply regardless of the actual
  // Digital Factory, doubling backend costing work for no reason (its own
  // numbers were never even shown — CostSummaryTab right next to it already
  // fetches the real, factory-scoped cost correctly).
  const { data: cost, isLoading } = useCostSummary(item.id, batchSize, factory);
  // The scenario's real production life, not a hardcoded horizon: the program
  // row below used to be labelled and computed as a flat 5 years regardless of
  // what the part was actually being costed over.
  const programYears = cost?.resolvedInputs.productionLifeYears ?? null;

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
          {programYears !== null && (
            <Row
              label={`${programYears}-Year Program`}
              value={`${Math.round(s.totalCo2Kg * (item.annualVolume ?? 0) * programYears).toLocaleString('en-IN')} kg CO₂e`}
            />
          )}
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

// ── MachiningFeatureTreePanel ────────────────────────────────────────────────────────────

// Detail for a machining catalog-type node in the process tree: exactly the
// feature_graph_v2 entries that node groups (ProcessTreeNode.v2FeatureIds).
function MachiningFeatureInspectorPanel({ featureIds, fg }: { featureIds: string[]; fg: FeatureGraph }) {
  const ids = new Set(featureIds);
  const matching = (fg.feature_graph_v2?.features ?? []).filter((f) => ids.has(f.id));
  if (matching.length === 0) return null;
  const groups = groupFeaturesByType(matching);
  const total = groups.reduce((s, g) => s + g.occurrenceCount, 0);

  const diamCounts = new Map<string, number>();
  for (const f of matching) {
    if (f.diameter_mm == null) continue;
    const key = `Ø${f.diameter_mm.toFixed(1)}`;
    diamCounts.set(key, (diamCounts.get(key) ?? 0) + f.occurrences.length);
  }
  const diamEntries = [...diamCounts.entries()].sort(([a], [b]) => parseFloat(a.slice(1)) - parseFloat(b.slice(1)));
  const maxDiamCount = Math.max(...diamEntries.map(([, c]) => c), 1);
  // Catalog operations the backend attached to these entries
  // (canonical-operation.ts, verified against the operations catalog).
  const catalogOperations = [...new Set(matching.map((f) => f.canonical_operation).filter((o): o is string => !!o))];

  return (
    <div className="divide-y divide-border/50">
      <div className="px-3 py-3 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Feature Information</div>
          <div className="text-base font-semibold text-foreground leading-tight">{groups.map((g) => g.type).join(', ')}</div>
          <div className="mt-1 flex flex-col gap-0.5">
            {groups.flatMap((g) => g.variants.map((v) => (
              <div key={`${g.type}:${v.variant}`} className="text-[10px] text-muted-foreground">
                {g.type} · {v.variant} ×{v.occurrenceCount}
              </div>
            )))}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">Count</div>
          <div className="text-3xl font-bold text-foreground tabular-nums leading-none">{total}</div>
        </div>
      </div>

      {diamEntries.length > 0 && (
        <div className="px-3 py-3">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-2">Diameter</div>
          <div className="flex flex-col gap-2">
            {diamEntries.map(([d, count]) => (
              <div key={d} className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-cyan-400 w-10 shrink-0">{d}</span>
                <div className="flex-1 h-[3px] bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-amber-400/70 rounded-full" style={{ width: `${(count / maxDiamCount) * 100}%` }} />
                </div>
                <span className="text-[11px] text-muted-foreground tabular-nums w-6 text-right">×{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-3 py-2.5 flex items-baseline gap-2">
        <span className="text-[10px] text-muted-foreground w-28 shrink-0">Operation</span>
        <span className="text-[11px] font-medium text-foreground">
          {catalogOperations.length > 0 ? catalogOperations.join(', ') : '—'}
        </span>
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

      <div className="px-3 py-2.5 flex items-baseline gap-2">
        <span className="text-[10px] text-muted-foreground w-28 shrink-0">Source</span>
        <span className="text-[11px] text-muted-foreground">Drawing Intelligence</span>
      </div>
    </div>
  );
}

function MachiningFeatureTreePanel({
  machiningFeatures,
  v2Features,
  selectedKey,
  onSelect,
}: {
  machiningFeatures: any;
  v2Features: FeatureNodeV2[];
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setExpanded((p) => ({ ...p, [k]: !p[k] }));
  // A selection made elsewhere (a face clicked in 3D) opens its type and
  // variant so the selected occurrence row is visible.
  useEffect(() => {
    if (!selectedKey?.startsWith('v2:occ:')) return;
    const id = selectedKey.slice('v2:occ:'.length, selectedKey.lastIndexOf('#'));
    const f = v2Features.find((x) => x.id === id);
    if (!f) return;
    const type = String(f.feature_type);
    setExpanded((p) => ({
      ...p,
      [featureSelectionKey.type(type)]: true,
      [featureSelectionKey.variant(type, f.variant ?? 'default')]: true,
    }));
  }, [selectedKey, v2Features]);
  const pick = (k: string) => onSelect?.(selectedKey === k ? null : k);

  const groups = groupFeaturesByType(v2Features);
  const total = groups.reduce((s, g) => s + g.occurrenceCount, 0);
  // Faces no detected feature explains (cad-engine face-coverage accounting).
  // Shown only when the engine reports it — never inferred here.
  const unclaimed: number[] | undefined = Array.isArray(machiningFeatures?.unclaimed_face_ids)
    ? machiningFeatures.unclaimed_face_ids.map((u: any) => (typeof u === 'number' ? u : u?.face_id)).filter((n: any) => typeof n === 'number')
    : undefined;

  const familyTitle =
    machiningFeatures?.family === 'mill_turn' ? 'Mill-Turn'
    : machiningFeatures?.family === 'turned' ? 'Turned'
    : machiningFeatures?.family === 'milled' ? 'Milled'
    : 'Machining';

  const rowCls = (selected: boolean) => cn(
    'flex items-center gap-1 w-full text-left rounded px-1 -mx-1 transition-colors',
    selected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted/40',
  );
  const Chevron = ({ open }: { open: boolean }) => open
    ? <ChevronDown className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
    : <ChevronRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />;

  return (
    <Section title={`${familyTitle} Features`}>
      {groups.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">No machining features detected.</p>
      ) : (
        <div className="space-y-0.5">
          <button type="button" onClick={() => pick(featureSelectionKey.all)} className={rowCls(selectedKey === featureSelectionKey.all)}>
            <span className="text-[10px] font-medium text-foreground flex-1">All features</span>
            <span className="text-[10px] tabular-nums text-muted-foreground">{total}</span>
          </button>
          {unclaimed && (
            <button
              type="button"
              disabled={unclaimed.length === 0}
              onClick={() => pick(featureSelectionKey.unclaimed)}
              className={rowCls(selectedKey === featureSelectionKey.unclaimed)}
              title="B-Rep faces no detected feature accounts for"
            >
              <span className="text-[10px] text-muted-foreground flex-1">Unexplained faces</span>
              <span className="text-[10px] tabular-nums text-muted-foreground">{unclaimed.length}</span>
            </button>
          )}
          {groups.map((g) => {
            const typeKey = featureSelectionKey.type(g.type);
            const typeOpen = !!expanded[typeKey];
            return (
              <div key={g.type} className="-mx-3 border-t first:border-t-0 px-3">
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => toggle(typeKey)} className="py-1" aria-label={typeOpen ? 'Collapse' : 'Expand'}>
                    <Chevron open={typeOpen} />
                  </button>
                  <button type="button" onClick={() => pick(typeKey)} className={cn(rowCls(selectedKey === typeKey), 'py-1')}>
                    <span className="text-[10px] font-medium text-foreground flex-1">{g.type}</span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">{g.occurrenceCount}</span>
                  </button>
                </div>
                {typeOpen && (
                  <div className="pl-4 pb-1 space-y-0.5">
                    {g.variants.map((v) => {
                      const variantKey = featureSelectionKey.variant(g.type, v.variant);
                      const variantOpen = !!expanded[variantKey];
                      return (
                        <div key={v.variant}>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => toggle(variantKey)} aria-label={variantOpen ? 'Collapse' : 'Expand'}>
                              <Chevron open={variantOpen} />
                            </button>
                            <button type="button" onClick={() => pick(variantKey)} className={rowCls(selectedKey === variantKey)}>
                              <span className="text-[10px] text-muted-foreground flex-1">{v.variant}</span>
                              <span className="text-[10px] tabular-nums">×{v.occurrenceCount}</span>
                            </button>
                          </div>
                          {variantOpen && (
                            <div className="pl-5 space-y-0.5">
                              {v.features.flatMap((f) => f.occurrences.map((occ, i) => {
                                const occKey = featureSelectionKey.occurrence(f.id, i);
                                const facts = [
                                  f.diameter_mm != null ? `Ø${f.diameter_mm.toFixed(1)}` : null,
                                  occ.depth_mm != null ? `depth ${occ.depth_mm.toFixed(1)}` : null,
                                  occ.spec ?? null,
                                ].filter(Boolean).join(' · ');
                                return (
                                  <button key={occKey} type="button" onClick={() => pick(occKey)} className={rowCls(selectedKey === occKey)}>
                                    <span className="text-[9px] font-mono text-muted-foreground/80 flex-1 truncate">
                                      #{i + 1}{facts ? ` ${facts}` : ''}
                                    </span>
                                    {f.canonical_operation && (
                                      <span className="text-[9px] text-muted-foreground/60 truncate max-w-[45%]" title={f.canonical_operation}>
                                        {f.canonical_operation}
                                      </span>
                                    )}
                                  </button>
                                );
                              }))}
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
        </div>
      )}
    </Section>
  );
}

// ── PartDetailTab ─────────────────────────────────────────────────────────────

// deriveComplexity was here: a Low/Medium/High label from the stored
// difficultyLevel (hole + 2 x bend + pocket counts against 5/15/30) or, when
// absent, bends x 2 + holes / 20 + threads x 5 against 10/30. Invented weights
// and thresholds; the real drivers are listed instead.

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
  item, batchSize, factory = 'USA', selectedMachiningFeatureKey, onMachiningFeatureSelect,
}: {
  item: BOMItem;
  batchSize: number | undefined;
  factory?: string;
  selectedMachiningFeatureKey?: string | null;
  onMachiningFeatureSelect?: (key: string | null) => void;
}) {
  const { data: cost } = useCostSummary(item.id, batchSize, factory);
  const fg = item.featureGraph;
  const di = item.drawingIntelligence;

  const readiness = deriveReadiness(item);
  const flags = buildRiskFlags(item);

  const holeCount = item.holeCount ?? fg?.summary?.holeCount ?? 0;
  const bendCount = item.bendCount ?? fg?.summary?.bendCount ?? 0;
  const threads = di?.threads ?? [];
  const threadTotal = threads.reduce((s, t) => s + t.count, 0);
  const machiningFeatures: any = (fg as any)?.machining_features ?? null;

  const family = item.familyClassification ?? fg?.classification?.family ?? '';
  const isIM = family === 'plastic_molded';
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
          <span className="text-[11px] text-muted-foreground">
            {complexityDrivers.length > 0 ? complexityDrivers.join(', ') : '—'}
          </span>
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

      {machiningFeatures ? (
        <MachiningFeatureTreePanel
          machiningFeatures={machiningFeatures}
          v2Features={fg?.feature_graph_v2?.features ?? []}
          selectedKey={selectedMachiningFeatureKey ?? null}
          {...(onMachiningFeatureSelect ? { onSelect: onMachiningFeatureSelect } : {})}
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
    const machiningVariants: Record<string, number> = (fg as any)?.machining_features?.variant_summary ?? {};
    const ops: string[] = [];
    if ((machiningVariants['PocketV2:default'] ?? 0) > 0) ops.push('Milling');
    if ((summary.holeCount ?? 0) > 0)  ops.push('Drilling');
    if ((machiningVariants['SimpleHole:threaded'] ?? 0) > 0) ops.push('Tapping');
    return ops;
  })();
  const routeSummary = featureOps.length > 0 ? featureOps.join(' → ') : null;
  const surfaceFinishStr = item.surfaceFinishRa != null ? `Ra ${item.surfaceFinishRa} µm` : null;

  const checks = (fg?.validationResults ?? []) as ValidationResult[];
  const score = fg?.manufacturabilityScore;

  const severityIcon = (passed: boolean, severity: string) => {
    if (passed)                  return <span className="text-emerald-400 text-sm leading-none">✓</span>;
    if (severity === 'critical') return <span className="text-red-500 text-sm leading-none">✗</span>;
    return                              <span className="text-amber-400 text-sm leading-none">!</span>;
  };

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

// ── InvestmentTab ──────────────────────────────────────────────────────────────
// One-time investment from reference data only (GET /bom-items/:id/nre,
// services/nre.service.ts): NC programming, fixture build and CMM programming,
// each with its source, and every item the reference cannot price listed as
// such. The INR fixture/programming/tooling/gauge tables that used to live here
// ("industry benchmarks") had no source and are gone.

function InvestmentTab({
  item, batchSize, productionLife, factory,
}: {
  item: BOMItem; fg: FeatureGraph | null;
  batchSize: number | undefined; productionLife: number | null; factory: string;
}) {
  const { data: cost } = useCostSummary(item.id, batchSize, factory);
  const { data: nre, isLoading, error } = useNre(item.id, batchSize, factory, productionLife);

  if (isLoading || !cost) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground p-4">
        <Loader2 className="h-5 w-5 animate-spin opacity-40" />
        <p className="text-xs text-center">Loading {factory} investment…</p>
      </div>
    );
  }
  if (error || !nre) {
    return <p className="p-4 text-xs text-red-500">Could not load investment: {String((error as any)?.message ?? 'unknown error')}</p>;
  }
  const symbol = cost.currencySymbol ?? cost.currency ?? '';
  const rate = cost.usdToDisplayRate ?? null;
  const money = (usd: number | null, dec = 0) =>
    usd == null || rate == null ? '—'
      : `${symbol}${(usd * rate).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;

  return (
    <div className="px-4 pb-6">
      <div className="flex items-start justify-between pt-3 pb-2 border-b-2 border-border">
        <div>
          <p className="text-sm font-bold text-foreground">One-time investment (NRE)</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            From reference data only{nre.gaps > 0 ? ` · ${nre.gaps} item${nre.gaps > 1 ? 's' : ''} not priced (no source)` : ''}
          </p>
        </div>
        <p className="text-2xl font-bold tabular-nums leading-tight text-foreground shrink-0 ml-4">{money(nre.totalUsd)}</p>
      </div>
      {nre.items.map((i) => (
        <div key={i.item} className="py-2 border-b border-border/20">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-foreground">{i.item}</span>
            <span className={cn('text-sm tabular-nums shrink-0', i.status === 'gap' && 'text-amber-500')}>
              {i.status === 'gap' ? 'not priced' : money(i.usd)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{i.detail}</div>
          <div className="text-[10px] text-muted-foreground/70 mt-0.5">Source: {i.source}</div>
        </div>
      ))}
      <div className="pt-4 pb-1">
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Amortization</span>
      </div>
      <p className="text-xs text-muted-foreground">{nre.amortization.reason}</p>
      {nre.amortization.perUnitUsd != null && (
        <div className="flex items-baseline justify-between py-2">
          <span className="text-sm text-foreground">NRE per unit</span>
          <span className="text-sm tabular-nums">{money(nre.amortization.perUnitUsd, 2)}</span>
        </div>
      )}
    </div>
  );
}

// ── BlankStockSection ─────────────────────────────────────────────────────────

// Stock forms BlankOptimizerService can actually source from real
// stock_profiles data (migration 350) — kept in sync by hand with
// StockForm in blank-optimizer.service.ts. 'Plate'/'Square Bar'/'Round
// Tube' (shown in the reference USA Digital Factory tool this mirrors) are
// deliberately NOT offered here: 'plate' has a schema column but zero real
// seeded sizes, 'square_bar' isn't a distinct real form (a rectangular_bar
// row with size_a == size_b already covers it), and 'round_tube' needs a
// bore dimension nothing in stock_profiles or CAD extraction provides today
// — offering them would either silently no-op or require fabricating stock
// sizes that don't exist in the real reference data.
const MACHINING_STOCK_FORM_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'round_bar', label: 'Round Bar' },
  { value: 'hex_bar', label: 'Hex Bar' },
  { value: 'rectangular_bar', label: 'Rectangular Bar' },
  { value: 'billet', label: 'Billet' },
];

// Module-level (not BlankStockSection-local) so the Apply-scenario
// confirmation dialog can label a blank's form the same way the Blank
// Stock panel itself does, without a second, divergent label map.
const BLANK_STOCK_FORM_LABELS: Record<string, string> = {
  sheet: 'Sheet', round_bar: 'Round Bar', hex_bar: 'Hex Bar',
  rectangular_bar: 'Rect Bar', billet: 'Billet',
  extrusion: 'Extrusion', casting: 'Casting', granules: 'Granules',
};

// Cavities per mold (injection molding): the reference mold layouts
// (layoutNumCav) are the only choices, from the cost summary itself; unset =
// the reference defaultNumCavities. The engine checks the choice against the
// press (clamp, shot) and says so on the molding line when it does not fit.
function MoldCavitiesSection({
  im, override, onChange,
}: {
  im: InjectionMoldingBreakdown;
  override: number | null;
  onChange: (v: number | null) => void;
}) {
  const layouts = im.cavityLayouts ?? [];
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 py-0.5">
        <span className="text-xs text-muted-foreground w-20 shrink-0">Cavities</span>
        <select
          className="flex-1 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
          value={override ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">Reference default{im.defaultCavityCount != null ? ` (${im.defaultCavityCount})` : ''}</option>
          {layouts.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <Row label="Costed at" value={`${im.cavityCount} cavit${im.cavityCount === 1 ? 'y' : 'ies'} · ${im.cavityConstrainedBy === 'user' ? 'set here' : im.cavityConstrainedBy === 'default' ? 'reference default' : 'not verified (see molding line)'}`} />
    </div>
  );
}

function BlankStockSection({
  blank, currencySymbol, stockFormOverride, onStockFormChange,
}: {
  blank: BlankSpecDto;
  currencySymbol: string;
  stockFormOverride: string | null;
  onStockFormChange: (v: string | null) => void;
}) {
  const label = BLANK_STOCK_FORM_LABELS[blank.form] ?? blank.form;
  // The dropdown only applies to machining stock forms — a sheet-metal
  // ('sheet') or injection-molding ('granules') blank has no bar/billet
  // choice to make, so showing it there would be a dead control.
  const isMachiningForm = MACHINING_STOCK_FORM_OPTIONS.some((o) => o.value === blank.form);
  return (
    <div className="space-y-1">
      {isMachiningForm && (
        <div className="flex items-center gap-2 py-0.5">
          <span className="text-xs text-muted-foreground w-20 shrink-0">Stock Form</span>
          <select
            className="flex-1 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
            value={stockFormOverride ?? ''}
            onChange={(e) => onStockFormChange(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">Let eMithran Decide</option>
            {MACHINING_STOCK_FORM_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}
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
      {blank.stockFormOverrideNote && (
        <p className="text-[10px] text-amber-600 dark:text-amber-500 leading-tight pt-0.5">{blank.stockFormOverrideNote}</p>
      )}
    </div>
  );
}

// ── AnalysisTabsPanel (Right) ──────────────────────────────────────────────────

function AnalysisTabsPanel({
  projectId,
  item, fg, batchSize, productionLife, factory, selectedMachiningFeatureKey, onMachiningFeatureSelect,
  file3dUrl, activeTab, onTabChange, treeProcessNames, vendorHotspotContext,
  onSelectHighlight, onSecondaryHighlight,
}: {
  projectId: string;
  item: BOMItem; fg: FeatureGraph | null;
  batchSize: number | undefined; productionLife: number | null; factory: string;
  selectedMachiningFeatureKey?: string | null;
  onMachiningFeatureSelect?: (key: string | null) => void;
  file3dUrl?: string | null;
  activeTab: RightTabKey;
  onTabChange: (tab: RightTabKey) => void;
  treeProcessNames: string[];
  vendorHotspotContext: { layer: HeatmapLayerType; riskLevel: string } | null;
  onSelectHighlight?: (node: FeatureNodeV2 | null) => void;
  onSecondaryHighlight?: (h: SecondaryHighlight | null) => void;
}) {
  const tab = activeTab;
  const setTab = onTabChange;
  const cls = fg?.classification;
  const machiningSummary: Record<string, number> | null = (fg as any)?.machining_features?.feature_summary ?? null;
  // See the same derivation in the Investment panel above: null, not 0, when
  // volume or production life is unresolved.
  const lifetimeVol = productionLife === null || item.annualVolume == null
    ? null : item.annualVolume * productionLife;
  // Same fix as SustainabilityTab — omitting location silently defaulted to
  // 'USA' (useCostSummary's own fallback), running a second, wasted full
  // cost computation on every load/Apply regardless of the real Digital
  // Factory. `factory` is already a real prop on this component.
  const { data: summaryForPartTab } = useCostSummary(item.id, batchSize, factory);
  // What this part is actually being priced at, read back from the engine.
  // Panels below that need a definite quantity (an RFQ volume, the Copilot's
  // context) get these rather than a number this component chose.
  const effBatchSize = batchSize ?? summaryForPartTab?.resolvedInputs.batchSize ?? null;
  const effProductionLife = productionLife ?? summaryForPartTab?.resolvedInputs.productionLifeYears ?? null;

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
                {machiningSummary ? (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {Object.entries(machiningSummary)
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
                  if (fam === 'turned') return finishKg * 2.5;
                  if (fam === 'mill_turn')  return finishKg * 2.0;
                  if (fam === 'milled') return finishKg * 1.5;
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
              <Row label="Annual Volume" value={item.annualVolume == null ? 'Not on file' : fmtInt(item.annualVolume)} />
              {/* The values this part is actually being costed at, from the
                  engine's own echo — not this component's request state, which
                  is legitimately unset for any input the user has not chosen. */}
              <Row label="Batch Size" value={effBatchSize === null ? '—' : fmtInt(effBatchSize)} />
              <Row label="Production Life" value={effProductionLife === null ? '—' : `${effProductionLife} yr`} />
              <Row label="Lifetime Volume" value={lifetimeVol === null ? 'Not on file' : fmtInt(lifetimeVol)} />
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
            selectedMachiningFeatureKey={selectedMachiningFeatureKey ?? null}
            {...(onMachiningFeatureSelect ? { onMachiningFeatureSelect } : {})}
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

        {tab === 'secondary' && (
          <SecondaryProcessesPanel
            itemId={item.id}
            batchSize={batchSize}
            location={factory}
            onHighlight={(h) => onSecondaryHighlight?.(h)}
          />
        )}

        {tab === 'copilot' && (
          effBatchSize === null || effProductionLife === null ? (
            <ScenarioInputsPending />
          ) : (
            <CopilotPanel
              item={item}
              fg={fg}
              batchSize={effBatchSize}
              productionLife={effProductionLife}
              factory={factory}
              activeTab={tab}
            />
          )
        )}

        {tab === 'vendor_network' && (
          effBatchSize === null ? <ScenarioInputsPending /> :
          <VendorNetworkPanel
            projectId={projectId}
            itemId={item.id}
            itemName={item.name ?? 'Part'}
            batchSize={effBatchSize}
            processNames={treeProcessNames}
            {...(item?.materialGrade ? { material: item.materialGrade } : {})}
            {...(vendorHotspotContext ? { hotspotContext: vendorHotspotContext } : {})}
          />
        )}

        {tab !== 'part_summary' && tab !== 'cost' && tab !== 'validation' && tab !== 'sustainability' && tab !== 'detail' && tab !== 'investment' && tab !== 'secondary' && tab !== 'copilot' && tab !== 'vendor_network' && (
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
  const groupLabel = FAMILY_GROUP[family] ?? 'Unclassified';
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
  const family = item.familyClassification ?? fg?.classification?.family ?? '';
  const isIM = family === 'plastic_molded';
  // Same real field derivation already proven working elsewhere on this page
  // (the Part/Complexity summary card, ~line 7430) — reused here for the
  // Geometry tab, not reinvented. Injection-molded parts have none of the
  // Sheet Metal fields that tab otherwise renders (sheetThicknessMm/
  // holeCount/bendCount/cutLengthMm/flatPatternAreaMm2 are all real null/0
  // for this family — confirmed live, 2026-09-10), so the tab rendered
  // empty for an IM part even though the CAD engine already computes real
  // IM feature data.
  const imGeo = useMemo(() => {
    const imS = (fg?.summary as any) ?? {};
    const wallNominalMm: number | null = imS.wallThicknessNominalMm || null;
    const wallMinMm: number | null = imS.wallThicknessMinMm || null;
    const wallMaxMm: number | null = imS.wallThicknessMaxMm || null;
    const ribCount: number = imS.ribCount ?? imS.ribCountProxy ?? 0;
    const throughHoleCount: number = imS.throughHoleCount ?? 0;
    const blindFeatureCount: number = imS.blindFeatureCount ?? 0;
    const undercutFaceCount: number = imS.undercutFaceCount ?? 0;
    const undraftedFaceCount: number = imS.undraftedFaceCount ?? 0;
    const insertCandidateCount: number = imS.insertCandidateCount ?? 0;
    const partingComplexity: number | null = imS.partingComplexity ?? null;
    const avgDraftDeg: number | null = imS.avgDraftAngleDeg ?? null;
    const hasData =
      !!wallNominalMm || ribCount > 0 || throughHoleCount > 0 || blindFeatureCount > 0 ||
      undercutFaceCount > 0 || undraftedFaceCount > 0 || insertCandidateCount > 0 || partingComplexity != null;
    return {
      wallNominalMm, wallMinMm, wallMaxMm, ribCount, throughHoleCount, blindFeatureCount,
      undercutFaceCount, undraftedFaceCount, insertCandidateCount, partingComplexity, avgDraftDeg, hasData,
    };
  }, [fg?.summary]);
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
      return v2Features.find((f) => isPlainHole(f) && f.diameter_mm === selectedHoleGroup.diameter_mm);
    }
    if (selectedBend) {
      return v2Features.find((f) => isBend(f) && f.radius_mm === selectedBend.recognition.radius_mm);
    }
    return undefined;
  }, [fg, selectedHoleGroup, selectedBend]);

  const featureMetadata = useMemo(
    () => buildFeatureMetadata(selectedHoleGroup, selectedBend, dfmWarnings, selectedV2Feature),
    [selectedHoleGroup, selectedBend, dfmWarnings, selectedV2Feature],
  );

  const isMachiningFeatureSelected = !!selectedId?.startsWith('machining_');
  const isThreadFeatureSelected = !!selectedId?.startsWith('thread_di_');

  useEffect(() => {
    if (selectedHoleGroup || selectedBend) setTab('detail');
  }, [selectedHoleGroup, selectedBend]);

  useEffect(() => {
    if (isMachiningFeatureSelected) setTab('detail');
  }, [isMachiningFeatureSelected, selectedId]);

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
          ['detail', (isFeatureSelected || isMachiningFeatureSelected || isThreadFeatureSelected) ? '● Selected' : 'Selected'],
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
          {isIM && imGeo.hasData && (
            <>
              {imGeo.wallNominalMm != null && (
                <div className="flex items-baseline px-3 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">Wall Thickness (nominal)</span>
                  <span className="text-xs font-medium tabular-nums">{fmt(imGeo.wallNominalMm, 2)} mm</span>
                </div>
              )}
              {imGeo.wallMinMm != null && imGeo.wallMaxMm != null && (
                <div className="flex items-baseline px-3 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">Wall Thickness (min – max)</span>
                  <span className="text-xs font-medium tabular-nums">{fmt(imGeo.wallMinMm, 2)} – {fmt(imGeo.wallMaxMm, 2)} mm</span>
                </div>
              )}
              {imGeo.throughHoleCount > 0 && (
                <div className="flex items-baseline px-3 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">Through Holes</span>
                  <span className="text-xs font-medium tabular-nums">{fmtInt(imGeo.throughHoleCount)}</span>
                </div>
              )}
              {imGeo.blindFeatureCount > 0 && (
                <div className="flex items-baseline px-3 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">Bosses / Blind Holes</span>
                  <span className="text-xs font-medium tabular-nums">{fmtInt(imGeo.blindFeatureCount)}</span>
                </div>
              )}
              {imGeo.ribCount > 0 && (
                <div className="flex items-baseline px-3 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">Ribs</span>
                  <span className="text-xs font-medium tabular-nums">{fmtInt(imGeo.ribCount)}</span>
                </div>
              )}
              {imGeo.undercutFaceCount > 0 && (
                <div className="flex items-baseline px-3 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">Undercuts</span>
                  <span className="text-xs font-medium tabular-nums">{fmtInt(imGeo.undercutFaceCount)}</span>
                </div>
              )}
              {imGeo.undraftedFaceCount > 0 && (
                <div className="flex items-baseline px-3 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">Undrafted Faces</span>
                  <span className="text-xs font-medium tabular-nums">{fmtInt(imGeo.undraftedFaceCount)}</span>
                </div>
              )}
              {imGeo.avgDraftDeg != null && (
                <div className="flex items-baseline px-3 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">Avg. Draft Angle</span>
                  <span className="text-xs font-medium tabular-nums">{fmt(imGeo.avgDraftDeg, 1)}°</span>
                </div>
              )}
              {imGeo.insertCandidateCount > 0 && (
                <div className="flex items-baseline px-3 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">Insert Candidates</span>
                  <span className="text-xs font-medium tabular-nums">{fmtInt(imGeo.insertCandidateCount)}</span>
                </div>
              )}
              {imGeo.partingComplexity != null && (
                <div className="flex items-baseline px-3 py-1.5 gap-2">
                  <span className="text-[10px] text-muted-foreground flex-1 truncate">Parting Complexity</span>
                  <span className="text-xs font-medium tabular-nums">{Math.round(imGeo.partingComplexity * 100)}%</span>
                </div>
              )}
            </>
          )}
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
          {!isIM && !summary.holeCount && !summary.bendCount && !summary.cutLengthMm && !summary.flatPatternAreaMm2 && !summary.sheetThicknessMm && (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
              <AlertCircle className="h-6 w-6 opacity-30" />
              <p className="text-[11px]">Run Auto-Fill to see geometry.</p>
            </div>
          )}
          {isIM && !imGeo.hasData && (
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
          ) : isMachiningFeatureSelected && fg && selectedId ? (
            <MachiningFeatureInspectorPanel featureIds={selected?.v2FeatureIds ?? []} fg={fg} />
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
    () => new Set(['root', 'grp_0', 'op_0', 'op_1', 'op_2', 'op_threads', 'thread_features']),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // The batch size to REQUEST. `undefined` is the normal state and means "do not
  // state one — price against the batch size already persisted on this item's
  // scenario". It becomes a number only when the user commits a different batch
  // via Apply, and even then the same value is written to scenario_overrides, so
  // the persisted scenario stays the source of truth.
  //
  // This used to be useState(250): a second costing default, in the UI, that
  // outranked the item's own saved scenario on every first load (an explicit
  // request beats a stored override in the resolver) — so a part saved at
  // 100,000 opened priced at a batch nobody had chosen. The single canonical
  // default now lives in COSTING_INPUT_DEFAULTS on the server.
  const [batchSize, setBatchSize] = useState<number | undefined>(undefined);
  // null until resolved from the scenario or the server's echo — never a
  // literal typed into this component. See the seeding effect below.
  const [productionLife, setProductionLife] = useState<number | null>(null);
  // Persisted alongside location/batchSize in scenario_overrides, not local-only
  // state. Automatic routing re-evaluates the candidate routes on every Apply;
  // manual routing does not. If the mode were forgotten on reload it would
  // silently default back to 'auto', and the next Apply would replace a route
  // the user had deliberately chosen — so the mode has to survive with the
  // scenario it belongs to.
  const [processRouting, setProcessRouting] = useState<'auto' | 'manual'>('auto');
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  const [selectedManualRoute, setSelectedManualRoute] = useState<ManualRouteOption | null>(null);
  const applyRoute = useApplyRoute(item?.id);
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
  const [batchSizeDraft, setBatchSizeDraft] = useState<number | null>(null);
  // Tri-state, because "no override typed this session" and "the user asked for
  // automatic" are different intents and must not be collapsed:
  //   batchSizeDraft = number -> explicit override, persist it
  //   batchSizeAuto  = true   -> user CLEARED the field, so remove any persisted
  //                              override and let annual volume drive it
  //   neither                 -> untouched; leave whatever is persisted alone
  // Without the middle state, clearing the field could not undo an override, and
  // treating "untouched" as "auto" would silently discard a deliberate override
  // set in an earlier session.
  const [batchSizeAuto, setBatchSizeAuto] = useState(false);
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
    // batchSizeDraft is deliberately NOT seeded from the saved override.
    //
    // Under this page's contract the draft means exactly one thing: "the user
    // explicitly set a batch size in THIS session". Seeding it from storage
    // conflates that with "a batch size is saved", and everything downstream
    // reads it as an explicit choice:
    //   - apply sends it as a request param, re-persisting it every time, so an
    //     override written once could never be escaped;
    //   - the "saved override is suppressing your annual volume" disclosure is
    //     gated on `batchSizeDraft === null` and so never appeared -- observed
    //     live with annual volume 15,000 and a saved 125,000, where the server
    //     was correctly reporting derivedBatchSize 3,750 the whole time.
    //
    // Nothing is lost by not seeding: the saved override still wins server-side
    // (resolveCostingInputs: scenario_override outranks derived) and the field
    // renders it through effectiveBatchSize. The difference is that the page no
    // longer claims the user typed it.
    const savedProductionLife = item.scenarioOverrides?.productionLifeYears;
    if (typeof savedProductionLife === 'number' && savedProductionLife > 0) {
      setProductionLife(savedProductionLife);
    }
    const savedRouting = item.scenarioOverrides?.processRouting;
    if (savedRouting === 'auto' || savedRouting === 'manual') {
      setProcessRouting(savedRouting);
    }
  }, [item]);

  // The values this page is ACTUALLY being priced at, straight from the engine
  // that priced it. Shares its cache entry with the identical call inside the
  // panels below (React Query deduplicates by key), so this costs no extra
  // request. Reading the answer back rather than predicting it is what keeps a
  // second default from creeping in for inputs the user has never set.
  const { data: pageCostSummary } = useCostSummary(item?.id, batchSize, factory);
  // The item fetch already carries the same resolver's answer and returns in
  // milliseconds; cost-summary is a documented 14-40s call on a nesting cache
  // miss. Seeding from the costing response alone left a new item showing a
  // dash for Batch Size and Production Life until that call returned — the
  // inputs were resolved, just not reachable yet. The costing echo still wins
  // once present, because it reflects any request-level override applied to
  // this particular view.
  // Input echo comes from the ITEM first, deliberately -- this is a freshness
  // choice, not a correctness one. Both sides call the same resolveCostingInputs
  // over the same persisted state, so they agree once both are fresh, and the
  // same annual-volume write invalidates both. The difference is cost:
  // /bom-items/:id answers in ~0.7s while /cost-summary takes ~13s on this part
  // (measured, same server, back to back). Reading the cost summary first meant
  // that after editing Annual Volume the derived Batch Size kept showing the
  // PREVIOUS volume's figure for the entire recompute -- reported as "batch size
  // is not changing instantly", with the server having had the right answer all
  // along.
  //
  // Only the input echo moves. Money still comes from the cost summary, and the
  // explicit-request case is unaffected because local `batchSize` state (below)
  // still outranks both sources.
  const resolvedInputs = item?.resolvedCostingInputs ?? pageCostSummary?.resolvedInputs ?? null;
  const effectiveBatchSize = batchSize ?? resolvedInputs?.batchSize ?? null;
  // Production Life has no separate draft state — the field below IS the draft,
  // and what is committed is whatever the saved scenario carries (or, for a
  // scenario that has never set one, the value the engine resolved).
  const savedProductionLife = item?.scenarioOverrides?.productionLifeYears;
  const committedProductionLife =
    (typeof savedProductionLife === 'number' && savedProductionLife > 0 ? savedProductionLife : null)
    ?? resolvedInputs?.productionLifeYears
    ?? null;

  // Seed the drafts from the server's echo for any input the saved scenario did
  // not carry, so the fields show the figure the quote was actually computed at
  // instead of a blank the user has to guess at. Runs at most once per input.
  useEffect(() => {
    if (!resolvedInputs) return;
    // batchSizeDraft is deliberately NOT seeded here. It means one thing only:
    // "the user has explicitly overridden the batch size" (null = no override,
    // use whatever the resolver derives). Seeding it from resolvedInputs.batchSize
    // -- which this effect used to do via `prev ?? ...` -- reintroduced exactly
    // the committed-copy-in-React-state that costing-inputs.ts was built to
    // remove, and broke annual-volume-driven batch sizing:
    //
    //   1. page loads with annual volume X  -> draft pinned to ceil(X / 4)
    //   2. user edits annual volume to Y    -> server re-derives ceil(Y / 4),
    //                                          but `prev` is now non-null so the
    //                                          draft keeps the stale ceil(X / 4)
    //   3. Apply sends that stale number as an explicit batchSize request param,
    //      which persists into scenario_overrides
    //   4. scenario_override outranks the derived tier in resolveCostingInputs,
    //      so annual volume can never move batch size again
    //
    // The Batch Size field instead displays `batchSizeDraft ?? effectiveBatchSize`,
    // so it still shows a real number without pretending the user typed it.
    setProductionLife((prev) => prev ?? resolvedInputs.productionLifeYears);
  }, [resolvedInputs]);

  // Draft differs from what is committed. Compared against the EFFECTIVE value,
  // not the raw request state — otherwise an input the user never touched (whose
  // request value is legitimately undefined) would read as a permanent unapplied
  // change and leave the Apply banner showing forever.
  const scenarioDirty =
    factoryDraft !== factory
    || (batchSizeDraft !== null && batchSizeDraft !== effectiveBatchSize)
    || batchSizeAuto
    // Production Life now reaches the costing engine (tooling amortisation), so
    // an edit to it is an unapplied scenario change like any other rather than
    // a display-only tweak.
    || (productionLife !== null && productionLife !== committedProductionLife);

  // Awaitable so the single bottom "Apply" button (CostGuidePanel) can commit
  // Digital Factory/Batch Size + the staged Workflow Builder route together
  // and only THEN run its own material-grade-driven logic — there is no
  // longer a separate top "Apply Scenario" banner/button.
  const applyScenario = async () => {
    setFactory(factoryDraft);
    // Only an explicit override becomes a request param. On an auto request the
    // committed copy is dropped so effectiveBatchSize falls through to the
    // server-resolved (derived) value instead of pinning the old number.
    if (batchSizeDraft !== null) setBatchSize(batchSizeDraft);
    else if (batchSizeAuto) setBatchSize(undefined);
    // The auto request is consumed by this apply. It has to be cleared, or
    // scenarioDirty (which counts batchSizeAuto) would stay true forever and
    // leave the unapplied-changes state showing after a successful apply.
    setBatchSizeAuto(false);
    if (item?.id) {
      // productionLifeYears rides in the same override bag as location/batchSize
      // — merge_scenario_overrides has no key whitelist, so it needs no schema
      // change — and is read back by resolveCostingInputs on the server. Before
      // this it was UI-only state that reached no calculation at all.
      patchScenarioOverrides.mutate({
        id: item.id,
        patch: {
          location: factoryDraft,
          processRouting,
          // null removes the override: resolveScenarioBatchSize treats any
          // non-numeric / sub-1 value as absent, so the derived
          // ceil(annualVolume / BATCHES_PER_YEAR) tier takes over again.
          ...(batchSizeDraft !== null ? { batchSize: batchSizeDraft } : batchSizeAuto ? { batchSize: null } : {}),
          ...(productionLife !== null ? { productionLifeYears: productionLife } : {}),
        },
      });
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
          await applyCustomRoute.mutateAsync({ baseCuttingRouteId: route.dynamicCuttingRouteId, steps, ...(batchSizeDraft !== null ? { batchSize: batchSizeDraft } : {}), location: factoryDraft });
          applyMachineOverrides();
        } catch { /* errors surfaced by the mutation's own onError toast */ }
      } else if (route.directApplyRouteId) {
        try {
          await applyRoute.mutateAsync({ routeId: route.directApplyRouteId, ...(batchSizeDraft !== null ? { batchSize: batchSizeDraft } : {}), location: factoryDraft });
          applyMachineOverrides();
        } catch { /* errors surfaced by the mutation's own onError toast */ }
      } else {
        // A selectedManualRoute with neither dynamicCuttingRouteId nor
        // directApplyRouteId has no real apply target. Say so, rather than
        // leave the Process Routing panel showing a route nothing wrote.
        toast.error(`"${route.label}" cannot be applied — no real route target was resolved for it. Reopen Workflow Builder and pick a route again.`);
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

  const summary = useMemo(
    () => fg?.summary ?? (item ? buildSummary(item, fg) : null),
    [fg, item],
  );

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
    // A dynamic/custom route (the 'auto_fill_from_custom_route:' tag gating
    // this whole effect) is only ever assembled from cutting-family routes
    // (see the Workflow Builder modal's own realRoutes filter) — filtering
    // here the same way avoids the identical bug that filter fixed: mixing
    // in forming routes (Standard/Tandem/Progressive-Die Press, Roll
    // Bending — no Press Brake/Deburring/Inspection lines of their own)
    // breaks cuttingMachineClassesFromRoutes' "shared across every route"
    // check for those real shared lines entirely.
    const cuttingRoutesForTree = (comparisonForTree.routes ?? []).filter((r) => r.processFamily === 'cutting');
    const classToRouteId = cuttingMachineClassToRouteId(cuttingRoutesForTree);
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
    const cuttingClasses = cuttingMachineClassesFromRoutes(cuttingRoutesForTree);
    const pageSharedLines = (cuttingRoutesForTree[0]?.processLines ?? []).filter(
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
      // A custom apply is only ever cutting-family (see the identical filter
      // + comment above) — same fix, same reason.
      const classToRouteId = cuttingMachineClassToRouteId(comparisonForTree.routes.filter((r) => r.processFamily === 'cutting'));
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
  // The route to show when NOTHING has been applied yet.
  //
  // This used to come from KB_ROUTE_ALTERNATIVES, a hardcoded three-entry table
  // in this file that declared Fiber Laser `isRecommended: true` for every sheet
  // metal part ever costed — a routing recommendation the backend's route
  // comparison exists to make, from real rates, real machine capability and real
  // cycle times, across ten registered cutting engines rather than three. Two
  // independent things were wrong with it:
  //
  //   it recommended     the same route for every part regardless of material,
  //                      thickness, features or volume.
  //   it spoke a         its process names were "Fiber Laser Cutting" and "CNC
  //   different language Press Brake"; the engines emit "Laser Cutting" and
  //                      "Press Brake". buildProcessTree matches a step to its
  //                      real machine by exact process name, so under the KB
  //                      names that lookup could never hit and every step in the
  //                      tree rendered its machine as "—".
  //
  // Now: an explicit manual choice wins (the engineer said so), else the
  // backend's own recommendedRouteId. If the backend recommends nothing —
  // genuinely no route with complete data — this returns undefined and the tree
  // falls through to the cad-engine's own recommendations. Nothing is invented
  // at either step.
  const activeOverrideProcesses = useMemo(() => {
    if (processRouting === 'manual' && selectedManualRoute) return selectedManualRoute.processes;
    if (processRouting !== 'auto') return undefined;
    const routes = comparisonForTree?.routes ?? [];
    const recommended = routes.find((r) => r.routeId === comparisonForTree?.recommendedRouteId);
    return recommended ? recommended.processLines.map((l) => l.process) : undefined;
  }, [processRouting, selectedManualRoute, comparisonForTree]);

  const effectiveOverrideProcesses = appliedRouteProcessNames ?? activeOverrideProcesses;

  // Real density for this item's own material grade — replaces a flat PA66
  // default that was applied to every molded part's mass estimate
  // regardless of actual material (bug found 2026-09-03).
  const { data: materialDensityResult } = useMaterialDensity(item?.materialGrade || item?.material || undefined);
  const materialDensityGcm3 = materialDensityResult?.density_g_cm3 ?? null;

  // Same query (and cache entry) the Secondary tab reads.
  const { data: secondaryForTree } = useSecondaryProcesses(item?.id, batchSize, factory);

  const tree = useMemo(
    () => (item && summary) ? buildProcessTree(item, fg, summary, factory, effectiveOverrideProcesses, effectiveCostForHeatmap, materialDensityGcm3, procRecordsForTree?.records ?? null, secondaryForTree ? [...secondaryForTree.lines, ...secondaryForTree.surfaceLines, ...secondaryForTree.heatTreatmentLines, ...secondaryForTree.chemicalMillingLines] : null) : null,
    [item, fg, summary, factory, effectiveOverrideProcesses, effectiveCostForHeatmap, materialDensityGcm3, procRecordsForTree, secondaryForTree],
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

  const [selectedMachiningFeatureKey, setSelectedMachiningFeatureKey] = useState<string | null>(null);

  // Exact faces for the selected feature-tree row (type, variant, one
  // occurrence, all, or unexplained faces) — resolved by feature_graph_v2 id.
  const selectedMachiningV2Feature = useMemo(() => {
    if (!selectedMachiningFeatureKey || !fg) return null;
    const unclaimedRaw = (fg as any)?.machining_features?.unclaimed_face_ids;
    const unclaimed: number[] | null = Array.isArray(unclaimedRaw)
      ? unclaimedRaw.map((u: any) => (typeof u === 'number' ? u : u?.face_id)).filter((n: any) => typeof n === 'number')
      : null;
    return resolveFeatureSelection(selectedMachiningFeatureKey, fg.feature_graph_v2?.features ?? [], unclaimed);
  }, [selectedMachiningFeatureKey, fg]);

  // Set by the Analysis panel's cost-tab "Feature breakdown" rows (Bend R1mm x2,
  // Pierces x19, Cut path...) to highlight that exact feature in the 3D viewer.
  const [selectedDirectV2Feature, setSelectedDirectV2Feature] = useState<FeatureNodeV2 | null>(null);

  const selectedV2Feature = useMemo(() => {
    if (selectedDirectV2Feature) return selectedDirectV2Feature;
    if (selectedMachiningV2Feature) return selectedMachiningV2Feature;
    const v2Features = fg?.feature_graph_v2?.features;
    if (!v2Features) return null;
    if (selectedHoleGroup) {
      return v2Features.find((f) => isPlainHole(f) && f.diameter_mm === selectedHoleGroup.diameter_mm) ?? null;
    }
    if (selectedBend) {
      return v2Features.find((f) => isBend(f) && f.radius_mm === selectedBend.recognition.radius_mm) ?? null;
    }
    return null;
  }, [fg, selectedHoleGroup, selectedBend, selectedMachiningV2Feature, selectedDirectV2Feature]);

  const [selectedOccurrenceIndex, setSelectedOccurrenceIndex] = useState<number | null>(null);

  useEffect(() => {
    setSelectedOccurrenceIndex(null);
  }, [selectedV2Feature]);

  const faceMap = fg?.feature_graph_v2?.metadata?.face_map
    ?? (fg as any)?.machining_features?.face_map
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

  const isInjectionMolded = fg?.classification?.family === 'plastic_molded';
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

  // Click on a machined part in 3D -> select the feature occurrence that owns
  // the picked B-Rep face (face_map), which highlights it and selects its row
  // in the feature tree. Faces no feature owns select nothing.
  const handleBrepFacePick = useCallback((faceId: number) => {
    if (!(fg as any)?.machining_features) return;
    const hit = findFeatureByFaceId(faceId, fg?.feature_graph_v2?.features ?? []);
    if (!hit) return;
    setSelectedDirectV2Feature(null);
    setSelectedMachiningFeatureKey(featureSelectionKey.occurrence(hit.feature.id, hit.occurrenceIndex));
  }, [fg]);

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
        ? isPlainHole(v2) ? `Ø${v2.diameter_mm}mm hole · occ ${c.occurrenceIndex + 1}`
          : isBend(v2) ? `R${v2.radius_mm}mm bend · occ ${c.occurrenceIndex + 1}`
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
          if (isPlainHole(v2)) {
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
          } else if (isBend(v2)) {
            const pb = costHeatmapWeights.brakeCostPerBend;
            impact.push({ code: 'BEND', label: pb != null ? `Bend: $${pb.toFixed(2)}/bend (press brake)` : 'Press brake — run cost analysis for exact figure', severity: (pb ?? 0) > 10 ? 'high' : 'medium' });
            if ((item?.bendCount ?? 0) > 20) recs.push({ label: 'High bend count — review if bends can be eliminated', priority: 'medium' });
          }
        } else if (heatmapLayer === 'tolerance_risk') {
          const tol = toleranceHeatmapWeights.tightestToleranceMm;
          if (isPlainHole(v2)) {
            impact.push({ code: 'TOL', label: tol != null ? `Tightest tolerance: ±${tol}mm` : 'No drawing data — tolerance unknown', severity: (tol ?? 1) <= 0.05 ? 'critical' : (tol ?? 1) <= 0.1 ? 'high' : 'medium' });
            if (v2.diameter_mm != null && v2.diameter_mm < 4) recs.push({ label: `Ø${v2.diameter_mm}mm hole — verify with go/no-go gauge or CMM`, priority: 'high' });
            if ((tol ?? 1) <= 0.05) recs.push({ label: '±0.05mm or tighter — CMM inspection required', priority: 'high' });
          } else if (isBend(v2)) {
            impact.push({ code: 'BEND_TOL', label: 'Bend angle tolerance — typically ±0.5° to ±1°', severity: 'low' });
            recs.push({ label: 'Use angle gauge for critical assembly bends', priority: 'low' });
          }
        } else if (heatmapLayer === 'sustainability') {
          if (isPlainHole(v2)) {
            const cp = sustainabilityHeatmapWeights.laserCo2PerPierce;
            impact.push({ code: 'CO2_PIERCE', label: cp != null ? `Laser pierce: ${(cp * 1000).toFixed(2)} g CO₂e/hole` : 'Run cost analysis for CO₂ data', severity: 'medium' });
            if ((item?.holeCount ?? 0) > 100) recs.push({ label: 'Reduce hole count or consolidate with punching to cut process CO₂', priority: 'medium' });
          } else if (isBend(v2)) {
            const cb = sustainabilityHeatmapWeights.brakeCo2PerBend;
            impact.push({ code: 'CO2_BEND', label: cb != null ? `Press brake: ${(cb * 1000).toFixed(2)} g CO₂e/bend` : 'Run cost analysis for CO₂ data', severity: 'low' });
            recs.push({ label: 'Increase batch size to amortise press brake setup energy', priority: 'low' });
          }
        } else if (heatmapLayer === 'thermal') {
          if (isPlainHole(v2)) {
            const occ = v2.occurrences[c.occurrenceIndex];
            const density = occ?.local_feature_density ?? 0;
            impact.push({ code: 'THERMAL', label: density > 5 ? `Dense cluster — ${density} holes within 30mm radius` : 'Pierce heat accumulation area', severity: density > 8 ? 'high' : density > 4 ? 'medium' : 'low' });
            if (density > 5) recs.push({ label: 'Optimise pierce sequence to allow cooling between adjacent holes', priority: 'medium' });
            if (v2.diameter_mm != null && v2.diameter_mm < 2 * thk) recs.push({ label: `Small hole Ø${v2.diameter_mm}mm — higher laser dwell time, higher local heat`, priority: 'medium' });
          }
          impact.push({ code: 'NOTE', label: 'Estimated from feature density — not FEA simulation', severity: 'low' });
        } else if (heatmapLayer === 'tool_wear') {
          if (isPlainHole(v2)) {
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
      TAPPED:                { label: 'Use spiral-flute tap with rigid tapping; inspect tap every 200 parts', priority: 'medium' },
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
      await downloadBomItemExcel(item.id, `${item.partNumber ?? item.name ?? 'cost-report'}-Cost-Report.xlsx`, { ...(batchSize !== undefined ? { batchSize } : {}), location: factory });
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
      // retry: false — a re-analysis is a long, non-idempotent job; when the
      // CAD engine is down the server now answers 503 with the reason, and
      // retrying would only repeat the whole attempt before showing it.
      await apiClient.post(`/bom-items/${itemId}/reanalyze`, {}, { timeout: 150_000, retry: false });
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
      if (node.id === 'feat_im_undercut' || node.id === 'feat_im_undrafted') {
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
    factoryDraft, setFactoryDraft, batchSizeDraft, setBatchSizeDraft, effectiveBatchSize,
    batchSizeAuto, setBatchSizeAuto, resolvedInputs,
    applyScenario,
    onManualClick: () => setRouteDialogOpen(true),
    selectedManualRoute, onSelectHighlight,
    dfmScores,
  };
  const analysisProps = {
    projectId,
    item, fg, batchSize, productionLife, factory,
    selectedMachiningFeatureKey, onMachiningFeatureSelect: setSelectedMachiningFeatureKey,
    file3dUrl,
    activeTab: rightTab, onTabChange: setRightTab,
    treeProcessNames, vendorHotspotContext,
    onSelectHighlight,
    onSecondaryHighlight: (h: SecondaryHighlight | null) => {
      if (!h) {
        setSelectedNodeId(null);
        setOperationVisual(null);
        setVizLabel(null);
        return;
      }
      handleTreeSelect({ id: h.key, kind: 'feature', label: h.label, v2FeatureIds: h.featureIds, wholePart: h.wholePart });
    },
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
                      {...((fg as any)?.machining_features ? { onBrepFacePick: handleBrepFacePick } : {})}
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
          factory={scenarioDirty ? factoryDraft : factory}
          itemId={item?.id}
          // REQUEST batch size, not the display one. displayBatchSize falls back
          // to effectiveBatchSize (the value the server already resolved), so
          // passing it here gave the modal a different query key from every
          // other consumer on the page: the parent hooks fetch
          // ?location=USA while the modal fetched
          // ?location=USA&batchSize=250 for the identical question. Both are
          // cost-summary/route-comparison calls that take 12-17s on a real
          // part, so each interaction paid for two full recomputes.
          //
          // While a draft is pending the modal SHOULD price the draft, hence
          // the scenarioDirty branch; once applied it shares the parent key
          // exactly and React Query serves one fetch to everyone.
          batchSize={scenarioDirty ? (batchSizeDraft ?? undefined) : batchSize}
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
                            {...((fg as any)?.machining_features ? { onBrepFacePick: handleBrepFacePick } : {})}
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
        factory={scenarioDirty ? factoryDraft : factory}
        itemId={item?.id}
        // Same request-vs-display distinction as the other render site above.
        batchSize={scenarioDirty ? (batchSizeDraft ?? undefined) : batchSize}
      />
    </div>
  );
}
