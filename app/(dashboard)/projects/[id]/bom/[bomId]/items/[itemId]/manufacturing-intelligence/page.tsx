'use client';

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import {
  ArrowLeft, Cpu, Maximize2, Minimize2, ChevronDown, ChevronRight,
  AlertCircle, GripVertical, GripHorizontal, RefreshCw, AlertTriangle,
  Calculator, ShieldCheck, GitCompare, Flame, Crosshair,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { HeatmapSource, HeatmapLayerType, HeatmapNormalization } from '@/components/ui/model-viewer';
import { buildManufacturingRiskSources } from '@/lib/heatmap/sources';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ModelViewer } from '@/components/ui/model-viewer';
import { useBOMItem, useAnalysisVersion, useDFMScores, useMaterialIntelligence, useUpdateBOMItem, useCostSummary, useRouteComparison, useGdtAnalysis } from '@/lib/api/hooks/useBOMItems';
import type { MaterialCandidate, GdtSeverity } from '@/lib/api/hooks/useBOMItems';
import { getThreadIntelligence } from '@/lib/manufacturing-kb/thread-standards';
import { suggestMaterialCandidates, type MaterialSuggestion } from '@/lib/manufacturing-kb/material-candidates';
import type { ClearanceHole } from '@/lib/api/vave';
import { apiClient } from '@/lib/api/client';
import type { BOMItem } from '@/lib/api/hooks/useBOMItems';
import type { FeatureGraph, FeatureGraphSummary, DFMWarning, DFMSeverity, ValidationResult, ManufacturingFeature, HoleGroup, HoleGroupLocation, BendFeature, FeatureNodeV2, FaceMapEntry } from '@/lib/types/manufacturing';

// ── Types ──────────────────────────────────────────────────────────────────────

type PanelId = 'left' | 'center' | 'right' | 'process' | 'drivers';

interface ManualRouteOption {
  id: string;
  label: string;
  complexityLevel: 'simple' | 'standard' | 'complex';
  isRecommended: boolean;
  processes: string[];
  rationale: string;
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
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MACHINE_FOR: Record<string, string> = {
  'Fiber Laser Cutting': 'Fiber Laser 6kW',
  'Sheet Metal Laser Cutting': 'Fiber Laser 6kW',
  'CNC Press Brake': 'CNC Press Brake 100T',
  'Sheet Metal Bending': 'CNC Press Brake 100T',
  'Injection Moulding': 'Injection Molder 1,000kN Clamp Force',
  'Injection Molding': 'Injection Molder 1,000kN Clamp Force',
  'CNC Milling': 'CNC Milling Center',
  'CNC Machining': 'CNC Milling Center',
  'CNC Turning': 'CNC Lathe',
  'Die Casting': 'Die Casting Machine',
  'Deburring': 'Deburring Station',
  'Drilling': 'CNC Drilling Machine',
  'Inspection': 'CMM',
  'Tapping': 'CNC Tapping Machine',
  'Surface Treatment': 'Surface Treatment Line',
};

const SUB_OP: Record<string, string> = {
  'Fiber Laser Cutting': 'As Cut',
  'Sheet Metal Laser Cutting': 'As Cut',
  'CNC Press Brake': 'As Bent',
  'Sheet Metal Bending': 'As Bent',
  'Injection Moulding': 'As Moulded',
  'Injection Molding': 'As Moulded',
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
};

// Default treatment sequence for carbon steels (CRCA, MS, IS2062, DC01)
const CARBON_STEEL_TREATMENT_KEY = 'Zinc + Powder Coat';

// ── Inspection KB ──────────────────────────────────────────────────────────────
// Composable inspection templates. Phase 2: driven by drawing quality requirements.

const INSPECTION_KB: Record<string, KBFeature> = {
  dimensional: {
    label: 'Dimensional Inspection',
    machine: 'CMM',
    attrs: [
      { name: 'Scope',  value: 'Critical holes + bends' },
      { name: 'Method', value: 'CMM / Go-NoGo gauge' },
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
    const costAdj = volume < 5_000 ? 5 : volume > 50_000 ? -10 : 0;
    const leadAdj = isThick ? -5 : 0;
    const qualAdj = isHeatSensitive ? -4 : 0;
    const costScore = clamp(85 + costAdj, 0, 100);
    const leadTimeScore = clamp(90 + leadAdj, 0, 100);
    const qualityScore = clamp(92 + qualAdj, 0, 100);
    const flexScore = 95;
    const toolingScore = 100;
    const totalScore = Math.round(costScore * 0.35 + leadTimeScore * 0.20 + qualityScore * 0.20 + flexScore * 0.15 + toolingScore * 0.10);

    const scoreFactors: string[] = [];
    if (volume > 0 && volume < 5_000) scoreFactors.push(`Low production volume (${volume.toLocaleString()} pcs) favors laser — no tooling amortization`);
    if (volume > 50_000) scoreFactors.push(`High production volume (${volume.toLocaleString()} pcs) penalizes laser cost score`);
    if (uniqueDiameters > 5) scoreFactors.push(`${uniqueDiameters} unique hole diameters — no die investment; laser unaffected`);
    if (isHeatSensitive) scoreFactors.push(`Heat-sensitive material reduces laser quality score by 4 pts`);
    if (isThick) scoreFactors.push(`Thick sheet (${thickness}mm) reduces laser lead time score by 5 pts`);

    const reasons: string[] = [];
    if (uniqueDiameters > 0) reasons.push(`${uniqueDiameters} unique hole diameter${uniqueDiameters > 1 ? 's' : ''} — no die investment needed`);
    if (holeCount > 50) reasons.push(`${holeCount} holes cut at high pierce speed`);
    if (volume > 0 && volume < 10_000) reasons.push(`Volume ${volume.toLocaleString()} pcs — no tooling amortization required`);
    if (batchSize > 0 && batchSize < 100) reasons.push(`Batch of ${batchSize} pcs — instant changeover, no setup cost`);
    reasons.push('No hard tooling — any profile change is a program edit');
    return { costScore, leadTimeScore, qualityScore, flexScore, toolingScore, totalScore, confidence, scoreFactors, reasons };
  }

  if (routeId === 'sm-turret') {
    const costAdj = (volume > 50_000 ? 12 : volume < 5_000 ? -10 : 0) - Math.min(20, uniqueDiameters * 2);
    const leadAdj = (thickness < 1.5 ? 5 : 0) - Math.min(20, uniqueDiameters * 2);
    const flexAdj = -Math.min(30, uniqueDiameters * 3);
    const toolAdj = -Math.min(30, uniqueDiameters * 3);
    const costScore = clamp(70 + costAdj, 0, 100);
    const leadTimeScore = clamp(75 + leadAdj, 0, 100);
    const qualityScore = 80;
    const flexScore = clamp(65 + flexAdj, 0, 100);
    const toolingScore = clamp(40 + toolAdj, 0, 100);
    const totalScore = Math.round(costScore * 0.35 + leadTimeScore * 0.20 + qualityScore * 0.20 + flexScore * 0.15 + toolingScore * 0.10);

    const scoreFactors: string[] = [];
    if (volume > 50_000) scoreFactors.push(`High production volume (${volume.toLocaleString()} pcs) boosts turret cost score — tooling amortized`);
    if (volume < 5_000 && volume > 0) scoreFactors.push(`Low production volume penalizes turret — tooling cost not amortized`);
    if (uniqueDiameters > 5) scoreFactors.push(`${uniqueDiameters} unique hole diameters penalize turret flex/tooling/lead time scores`);
    if (thickness < 1.5 && thickness > 0) scoreFactors.push(`Thin sheet (${thickness}mm) favors turret — high strokes/min`);

    const reasons: string[] = [];
    if (volume > 50_000) reasons.push(`Volume ${volume.toLocaleString()} pcs — tooling cost fully amortized`);
    if (uniqueDiameters > 5) reasons.push(`${uniqueDiameters} unique diameters require ${uniqueDiameters} punch-die sets — tooling budget needed`);
    if (uniqueDiameters <= 3 && holeCount > 100) reasons.push(`Simple hole set (${uniqueDiameters} sizes) at ${holeCount} hits — turret excels here`);
    if (thickness < 1.5 && thickness > 0) reasons.push(`Thin sheet ${thickness}mm — high strokes/min lowers cycle time`);
    return { costScore, leadTimeScore, qualityScore, flexScore, toolingScore, totalScore, confidence, scoreFactors, reasons };
  }

  if (routeId === 'sm-waterjet') {
    const qualAdj = isHeatSensitive ? 8 : 0;
    const leadAdj = isThick ? 8 : 0;
    const costScore = 45;
    const leadTimeScore = clamp(50 + leadAdj, 0, 100);
    const qualityScore = clamp(88 + qualAdj, 0, 100);
    const flexScore = 70;
    const toolingScore = 100;
    const totalScore = Math.round(costScore * 0.35 + leadTimeScore * 0.20 + qualityScore * 0.20 + flexScore * 0.15 + toolingScore * 0.10);

    const scoreFactors: string[] = [];
    if (isHeatSensitive) scoreFactors.push(`Heat-sensitive material boosts waterjet quality score by 8 pts — no HAZ`);
    if (isThick) scoreFactors.push(`Thick sheet (${thickness}mm) boosts waterjet lead time score by 8 pts`);
    if (!isHeatSensitive && !isThick) scoreFactors.push(`Standard material and thickness — waterjet cost disadvantage not offset`);

    const reasons: string[] = [];
    if (isHeatSensitive) reasons.push('No heat-affected zone — preserves material properties');
    if (isThick) reasons.push(`Thick section ${thickness}mm — laser edge quality degrades above 8 mm`);
    if (!isHeatSensitive && !isThick) reasons.push('Consider laser for lower cost and faster cycle time on this material');
    reasons.push('No hard tooling — any shape cuts without dies');
    return { costScore, leadTimeScore, qualityScore, flexScore, toolingScore, totalScore, confidence, scoreFactors, reasons };
  }

  return { costScore: 75, leadTimeScore: 75, qualityScore: 80, flexScore: 75, toolingScore: 75, totalScore: 76, confidence: 50, scoreFactors: [], reasons: [] };
}

const RIGHT_TABS = [
  { key: 'validation', label: 'Validation' },
  { key: 'part_summary', label: 'Part Summary' },
  { key: 'design', label: 'Design Guidance' },
  { key: 'sustainability', label: 'Sustainability' },
  { key: 'cost', label: 'Cost Summary' },
  { key: 'detail', label: 'Part Detail' },
] as const;
type RightTabKey = (typeof RIGHT_TABS)[number]['key'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null, d = 1): string {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
}
function fmtInt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-IN');
}
function familyLabel(f: string): string {
  const m: Record<string, string> = {
    sheet_metal: 'Sheet Metal', cnc_milled: 'CNC Milled', cnc_turned: 'CNC Turned',
    injection_molded: 'Injection Moulded', casting: 'Casting', forging: 'Forging',
    weldment: 'Weldment', additive: 'Additive',
  };
  return m[f] ?? f;
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

// ── featureToTreeNode ──────────────────────────────────────────────────────────

function featureToTreeNode(f: ManufacturingFeature, factory: string, machine: string): ProcessTreeNode {
  if (f.type === 'flat_pattern') {
    const r = f.recognition;
    return {
      id: f.id, kind: 'feature', label: 'Flat Pattern', factory, machine,
      attrs: [
        { name: 'Area', value: `${fmtInt(r.area_mm2)} mm²` },
        ...(r.cut_length_mm > 0 ? [{ name: 'Cut Length', value: `${fmt(r.cut_length_mm, 0)} mm` }] : []),
        ...(r.pierce_count > 0 ? [{ name: 'Pierce Count', value: String(r.pierce_count) }] : []),
        { name: 'Sheet Thickness', value: `${fmt(r.sheet_thickness_mm, 1)} mm` },
        ...(r.est_laser_time_sec > 0 ? [{ name: 'Est. Laser Time', value: `${r.est_laser_time_sec} sec` }] : []),
      ],
    };
  }
  if (f.type === 'hole') {
    const r = f.recognition;
    const dLabel = r.diameter_mm != null ? `Ø${r.diameter_mm.toFixed(1)}` : 'Ø?';
    return {
      id: f.id, kind: 'feature', label: `${dLabel} × ${r.count}`, factory, machine,
      attrs: [
        { name: 'Diameter', value: r.diameter_mm != null ? `${r.diameter_mm.toFixed(1)} mm` : '—' },
        { name: 'Count', value: String(r.count) },
        { name: 'Process', value: 'Laser Pierce' },
        { name: 'Est. Cycle Time', value: `${(r.count * 2.5).toFixed(0)} sec` },
      ],
    };
  }
  if (f.type === 'bend') {
    const r = f.recognition;
    return {
      id: f.id, kind: 'feature',
      label: r.radius_mm != null ? `R${r.radius_mm.toFixed(1)} × ${r.count}` : `Bends × ${r.count}`,
      factory, machine,
      attrs: [
        ...(r.radius_mm != null ? [{ name: 'Radius', value: `${r.radius_mm.toFixed(1)} mm` }] : []),
        { name: 'Count', value: String(r.count) },
        { name: 'PB Hits', value: String(r.count) },
        { name: 'Est. Cycle Time', value: `${r.count * 42} sec` },
      ],
    };
  }
  // exhaustive guard — f is `never` here; cast to access id/type at runtime
  const fallback = f as { id: string; type: string };
  return { id: fallback.id, kind: 'feature', label: String(fallback.type), factory, machine };
}

// ── autoCompleteRoute ──────────────────────────────────────────────────────────

function autoCompleteRoute(
  recs: Array<{ process: string; estimated_time_sec?: number | null }>,
  family: string,
  summary: FeatureGraphSummary,
  ctx: { materialGrade?: string | null; material?: string | null } = {},
): Array<{ process: string; estimated_time_sec?: number | null }> {
  const processes = new Set(recs.map((r) => r.process));
  const completed = [...recs];

  if (family === 'sheet_metal') {
    const hasCutting = [...processes].some((p) =>
      p.includes('Laser') || p.includes('Punch') || p.includes('Waterjet') || p.includes('Cutting'),
    );
    if (!hasCutting) completed.unshift({ process: 'Fiber Laser Cutting' });

    const hasBending = [...processes].some((p) => p.includes('Press Brake') || p.includes('Bending'));
    if (summary.bendCount > 0 && !hasBending) {
      const cutIdx = completed.findIndex((r) =>
        r.process.includes('Laser') || r.process.includes('Punch') || r.process.includes('Waterjet'),
      );
      completed.splice(cutIdx >= 0 ? cutIdx + 1 : completed.length, 0, { process: 'CNC Press Brake' });
    }

    if (!completed.some((r) => r.process === 'Deburring')) completed.push({ process: 'Deburring' });

    // Tapping: pilot-hole diameter filter — Ø ≤ 6mm covers M2–M6 pilot sizes
    const tappingCandidateCount = (summary.holeGroups ?? [])
      .filter((g) => g.diameter_mm <= 6.0)
      .reduce((sum, g) => sum + g.count, 0);
    if (
      tappingCandidateCount > 0 &&
      summary.sheetThicknessMm > 0 &&
      summary.sheetThicknessMm < 3 &&
      !completed.some((r) => r.process === 'Tapping')
    ) {
      const deburrIdx = completed.findIndex((r) => r.process === 'Deburring');
      completed.splice(deburrIdx >= 0 ? deburrIdx : completed.length, 0, { process: 'Tapping' });
    }

    // Surface Treatment: carbon/mild steels that corrode, OR unknown material (most sheet metal is coated)
    const RUSTY_MATERIALS = ['CRCA', 'MS', 'IS2062', 'DC01'];
    const mat = `${ctx.materialGrade ?? ''} ${ctx.material ?? ''}`.toUpperCase().trim();
    const isRustyMetal = RUSTY_MATERIALS.some((m) => mat.includes(m));
    const materialUnknown = mat.length === 0;
    if (
      (isRustyMetal || materialUnknown) &&
      !completed.some((r) => r.process === 'Surface Treatment')
    ) {
      completed.push({ process: 'Surface Treatment' });
    }

    // Inspection: always present for sheet metal (Apriori "Quality" step)
    if (!completed.some((r) => r.process === 'Inspection')) {
      completed.push({ process: 'Inspection' });
    }
  } else if (family === 'cnc_turned') {
    if (!processes.has('CNC Turning') && !processes.has('CNC Machining')) {
      completed.unshift({ process: 'CNC Turning' });
    }
    if (!processes.has('Deburring')) completed.push({ process: 'Deburring' });
  } else if (family === 'cnc_milled') {
    if (!processes.has('CNC Milling') && !processes.has('CNC Machining')) {
      completed.unshift({ process: 'CNC Milling' });
    }
    if (!processes.has('Deburring')) completed.push({ process: 'Deburring' });
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
): ProcessTreeNode {
  const family = fg?.classification?.family ?? 'cnc_milled';
  const groupLabel = FAMILY_GROUP[family] ?? 'Manufacturing';
  const baseRecs = overrideProcesses?.map((p) => ({ process: p, estimated_time_sec: null as number | null }))
    ?? fg?.processRecommendations
    ?? [];
  const recs = autoCompleteRoute(baseRecs, family, summary, {
    materialGrade: item.materialGrade ?? null,
    material: item.material ?? null,
  });

  const operations: ProcessTreeNode[] = recs.map((rec, opIdx) => {
    const machine = MACHINE_FOR[rec.process] ?? '—';
    const subLabel = SUB_OP[rec.process] ?? 'As Processed';
    const featureNodes: ProcessTreeNode[] = [];

    const isSheetMetal = family === 'sheet_metal';
    const isCutting = rec.process.includes('Laser') || rec.process.includes('Cutting');
    const isBending = rec.process.includes('Press Brake') || rec.process.includes('Bending');
    const isMilling = rec.process.includes('Milling') || rec.process.includes('Machining');
    const isMolding = rec.process.includes('Moulding') || rec.process.includes('Molding');

    if (isSheetMetal && isCutting) {
      const flatFeat = (fg?.features ?? []).find((f) => f.type === 'flat_pattern') ?? null;
      const holeFeats = (fg?.features ?? []).filter((f) => f.type === 'hole');

      if (flatFeat) {
        featureNodes.push(featureToTreeNode(flatFeat, factory, machine));
      } else if (summary.flatPatternAreaMm2 > 0) {
        const cutTimeSec = summary.cutLengthMm > 0
          ? Math.round((summary.cutLengthMm / 4000) * 60 + (summary.pierceCount ?? 0) * 2.0)
          : null;
        featureNodes.push({
          id: 'feat_flat', kind: 'feature', label: 'Flat Pattern', factory, machine,
          attrs: [
            { name: 'Area', value: `${fmtInt(summary.flatPatternAreaMm2)} mm²` },
            ...(summary.cutLengthMm > 0 ? [{ name: 'Cut Length', value: `${fmt(summary.cutLengthMm, 0)} mm` }] : []),
            ...(summary.pierceCount > 0 ? [{ name: 'Pierce Count', value: String(summary.pierceCount) }] : []),
            ...(cutTimeSec != null ? [{ name: 'Est. Laser Time', value: `${cutTimeSec} sec` }] : []),
          ],
        });
      }

      const holeGroups = summary.holeGroups ?? [];
      if (holeGroups.length > 0) {
        // PRIMARY: pre-grouped from CAD engine — diameter guaranteed correct
        holeGroups.forEach((g) => {
          featureNodes.push({
            id: g.id ?? `hole_d${g.diameter_mm.toFixed(1)}_c${g.count}`, kind: 'feature',
            label: `Ø${g.diameter_mm.toFixed(1)} × ${g.count}`,
            factory, machine,
            attrs: [
              { name: 'Diameter',        value: `${g.diameter_mm.toFixed(1)} mm` },
              { name: 'Count',           value: String(g.count) },
              { name: 'Process',         value: 'Laser Pierce' },
              { name: 'Est. Cycle Time', value: `${(g.count * 2.5).toFixed(0)} sec` },
            ],
          });
        });
      } else if (holeFeats.length > 0) {
        // SECONDARY: stored HoleFeature objects (may have null diameter on old DB entries)
        holeFeats.forEach((f) => featureNodes.push(featureToTreeNode(f, factory, machine)));
      } else {
        // TERTIARY: flat diameter list → group on the fly
        const diameters = summary.holeDiameters ?? [];
        if (diameters.length > 0) {
          const diaGroups: Record<string, number> = {};
          for (const d of diameters) { const k = d.toFixed(1); diaGroups[k] = (diaGroups[k] ?? 0) + 1; }
          Object.entries(diaGroups).forEach(([d, count], i) => {
            featureNodes.push({
              id: `feat_hole_d${i}`, kind: 'feature', label: `Ø${d} × ${count}`, factory, machine,
              attrs: [
                { name: 'Diameter',        value: `${d} mm` },
                { name: 'Count',           value: String(count) },
                { name: 'Process',         value: 'Laser Pierce' },
                { name: 'Est. Cycle Time', value: `${(count * 2.5).toFixed(0)} sec` },
              ],
            });
          });
        } else if (summary.holeCount > 0) {
          featureNodes.push({
            id: 'feat_holes', kind: 'feature', label: `Holes (${summary.holeCount})`, factory, machine,
            attrs: [{ name: 'Count', value: String(summary.holeCount) }, { name: 'Process', value: 'Laser' }],
          });
        }
      }

    } else if (isSheetMetal && isBending && summary.bendCount > 0) {
      const bendFeats = (fg?.features ?? []).filter((f) => f.type === 'bend');
      if (bendFeats.length > 0) {
        bendFeats.forEach((f) => featureNodes.push(featureToTreeNode(f, factory, machine)));
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
                { name: 'Est. Cycle Time', value: `${count * 42} sec` },
              ],
            });
          });
        } else {
          featureNodes.push({
            id: 'feat_bends', kind: 'feature', label: `Bends × ${summary.bendCount}`, factory, machine,
            attrs: [
              { name: 'Count', value: String(summary.bendCount) },
              { name: 'PB Hits', value: String(summary.bendCount) },
              { name: 'Est. Cycle Time', value: `${summary.bendCount * 42} sec` },
            ],
          });
        }
      }
    } else if (isMilling && summary.holeCount > 0) {
      featureNodes.push({
        id: 'feat_holes_m', kind: 'feature', label: `Holes (${summary.holeCount})`, factory, machine,
        attrs: [{ name: 'Count', value: String(summary.holeCount) }, { name: 'Process', value: 'Drilling' }],
      });
    } else if (isMolding) {
      const realFeats = fg?.features ?? [];
      if (realFeats.length > 0) {
        realFeats.slice(0, 12).forEach((f) => {
          featureNodes.push(featureToTreeNode(f, factory, machine));
        });
      } else {
        featureNodes.push({
          id: 'feat_mold', kind: 'feature', label: 'Moulded Part', factory, machine,
          attrs: [
            { name: 'Family', value: 'Injection Moulding' },
            { name: 'Volume', value: item.volume != null ? `${fmtInt(item.volume)} mm³` : '—' },
          ],
        });
      }
    }

    // ── Secondary operation feature nodes (KB-backed) ─────────────────────────

    const isTapping = rec.process === 'Tapping';
    const isSurfaceTreatment = rec.process === 'Surface Treatment';
    const isInspection = rec.process === 'Inspection';

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
      const matStr = `${item.materialGrade ?? ''} ${item.material ?? ''}`.toUpperCase().trim();
      const materialUnknownHere = matStr.length === 0;
      const coatingKey = item.coating && SURFACE_TREATMENT_KB[item.coating]
        ? item.coating
        : CARBON_STEEL_TREATMENT_KEY;
      const steps = SURFACE_TREATMENT_KB[coatingKey] ?? [];
      steps.forEach((step, i) => {
        const attrs = materialUnknownHere && i === 0
          ? [...step.attrs, { name: 'Note', value: 'Material unknown — verify treatment type from drawing' }]
          : step.attrs;
        featureNodes.push({ id: `feat_surface_${i}`, kind: 'feature', label: step.label, factory, machine: step.machine ?? machine, attrs });
      });
    }

    if (isInspection) {
      const matStr = `${item.materialGrade ?? ''} ${item.material ?? ''}`.toUpperCase();
      const RUSTY = ['CRCA', 'MS', 'IS2062', 'DC01'];
      const hasCoating = RUSTY.some((m) => matStr.includes(m)) || matStr.trim().length === 0;
      const templates: KBFeature[] = [
        INSPECTION_KB.dimensional!,
        INSPECTION_KB.visual!,
        ...(hasCoating ? [INSPECTION_KB.coating_thickness!] : []),
      ];
      templates.forEach((tmpl, i) => {
        featureNodes.push({ id: `feat_insp_${i}`, kind: 'feature', label: tmpl.label, factory, machine: tmpl.machine ?? machine, attrs: tmpl.attrs });
      });
    }

    const subOp: ProcessTreeNode = {
      id: `subop_${opIdx}`, kind: 'sub_op', label: subLabel,
      ...(featureNodes.length > 0 ? { children: featureNodes } : {}),
    };
    return { id: `op_${opIdx}`, kind: 'operation', label: rec.process, factory, machine, children: [subOp] };
  });

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
    return merge('op-cutting', v2Features.filter((f) => f.feature_type === 'hole'), '#3b82f6');
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
    // Phase 2 (Coating Thickness): expose VertexHighlight via ModelViewer.samplePoints prop
    // to render 5 measurement point markers across the coated surface.
    const hl = buildFullModelHL('hl-inspect-surface', faceMap);
    return hl ? { highlight: hl, color: '#e2e8f0' } : null;
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
  if (node.kind === 'operation') {
    if (l.includes('laser') || l.includes('cutting')) return 'Pierce holes';
    if (l.includes('press brake') || l.includes('bending')) return 'Bend lines';
    if (l.includes('tapping')) return 'Candidate tapped holes (Ø ≤ 6 mm)';
    if (l.includes('deburr')) return 'All cut edges — holes & bends';
    if (l.includes('surface treatment') || l.includes('coating')) return 'Full exterior surface';
    if (l.includes('inspection')) return 'Holes & bends (geometric features)';
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
    <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-muted/30 shrink-0 min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">{title}</span>
      <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
      <button
        onClick={() => onMaximize(isMax ? null : panelId)}
        className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
        title={isMax ? 'Restore' : 'Maximize'}
      >
        {isMax ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
      </button>
    </div>
  );
}

// ── Section ────────────────────────────────────────────────────────────────────

function CostSummaryTab({ item, batchSize }: { item: BOMItem; batchSize: number }) {
  const { data: cost, isLoading } = useCostSummary(item.id, batchSize);

  if (isLoading) {
    return <div className="p-3 text-xs text-muted-foreground animate-pulse">Calculating…</div>;
  }
  if (!cost) {
    return <div className="p-3 text-xs text-muted-foreground">Run Auto-Fill to generate cost estimate.</div>;
  }
  if (cost.family !== 'sheet_metal') {
    return (
      <Section title="Cost Summary">
        <p className="text-[11px] text-muted-foreground py-1">
          Cost engine: sheet metal only in Phase 1. CNC machining support coming next.
        </p>
      </Section>
    );
  }

  return (
    <div>
      <Section title="Cost Breakdown">
        <div className="flex items-baseline justify-between py-0.5">
          <div className="min-w-0">
            <span className="text-xs font-medium">Material</span>
            <span className="ml-1.5 text-[10px] text-muted-foreground">{cost.materialGrade} · {fmt(cost.grossWeightKg, 3)} kg</span>
            {cost.materialSource === 'default' && (
              <span className="ml-1 text-[9px] text-amber-500 border border-amber-500/30 rounded px-0.5">est.</span>
            )}
          </div>
          <span className="text-xs font-medium tabular-nums shrink-0">₹{fmt(cost.materialCost, 2)}</span>
        </div>
        {cost.processLines.map((line) => (
          <div key={line.process} className="flex items-baseline justify-between py-0.5">
            <div className="min-w-0">
              <span className="text-xs">{line.process}</span>
              {line.rateSource === 'mhr_database' ? (
                <span className="ml-1 text-[9px] text-emerald-600 border border-emerald-500/30 rounded px-0.5" title={line.machineName ?? undefined}>MHR DB</span>
              ) : (
                <span className="ml-1 text-[9px] text-amber-500 border border-amber-500/30 rounded px-0.5">est.</span>
              )}
              {line.machineName && (
                <span className="ml-1 text-[9px] text-muted-foreground/50 truncate max-w-[120px] inline-block align-bottom">{line.machineName}</span>
              )}
              {line.cycleTimeMin > 0 && (
                <span className="ml-1.5 text-[10px] text-muted-foreground">{fmt(line.cycleTimeMin, 1)} min</span>
              )}
            </div>
            <span className="text-xs tabular-nums shrink-0">₹{fmt(line.totalCost, 2)}</span>
          </div>
        ))}
        <div className="flex items-baseline justify-between pt-1.5 mt-1 border-t border-border/40">
          <span className="text-xs font-semibold">Total (1 pc, batch {cost.batchSize})</span>
          <span className="text-xs font-semibold tabular-nums">₹{fmt(cost.totalCost, 2)}</span>
        </div>
      </Section>

      <Section title="Setup / Run Split" defaultOpen={false}>
        {cost.processLines.map((line) => (
          <div key={line.process} className="py-0.5">
            <div className="flex justify-between text-[11px] font-medium">{line.process}</div>
            <div className="flex justify-between text-[10px] text-muted-foreground pl-2">
              <span>Rate</span><span>₹{fmt(line.hourlyRate, 0)}/hr</span>
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground pl-2">
              <span>Setup (÷{cost.batchSize})</span><span>₹{fmt(line.setupCost, 2)}</span>
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground pl-2">
              <span>Run</span><span>₹{fmt(line.runCost, 2)}</span>
            </div>
          </div>
        ))}
      </Section>

      {cost.warnings.length > 0 && (
        <div className="px-3 py-2 space-y-0.5">
          {cost.warnings.map((w, i) => (
            <p key={i} className="text-[9px] text-amber-500/80 leading-tight">⚠ {w}</p>
          ))}
        </div>
      )}
      <div className="px-3 py-1">
        <p className="text-[9px] text-muted-foreground/40">{cost.ratesSource}</p>
      </div>
    </div>
  );
}

function RouteComparisonCard({ item, batchSize }: { item: BOMItem; batchSize: number }) {
  const { data: comparison, isLoading } = useRouteComparison(item.id, batchSize);

  if (isLoading) return (
    <div className="p-3 text-xs text-muted-foreground animate-pulse">Comparing routes…</div>
  );
  if (!comparison?.routes?.length) return null;

  return (
    <Section title={<><GitCompare className="h-3 w-3 inline mr-1" />Route Comparison</>} defaultOpen>
      <div className="space-y-2 pt-1">
        {comparison.routes.map((route) => (
          <div
            key={route.routeId}
            className={`border rounded-md p-2 space-y-1 ${route.capability?.overallCapable === false ? "border-red-200/60 bg-red-50/20" : "border-border/50"}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold">{route.routeLabel}</span>
              <div className="flex gap-1">
                {route.badges.lowestCost && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">Lowest Cost</span>
                )}
                {route.badges.fastest && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">Fastest</span>
                )}
                {route.badges.bestQuality && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">Best Quality</span>
                )}
              </div>
            </div>
            {route.capability && !route.capability.overallCapable && (
              <div className="flex items-start gap-1 py-0.5">
                <AlertTriangle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  {route.capability.warnings.map((w, i) => (
                    <p key={i} className="text-[9px] text-red-500 leading-tight">{w}</p>
                  ))}
                </div>
              </div>
            )}
            {route.capability?.overallCapable && route.capability.confidence === "low" && route.capability.warnings[0] && (
              <p className="text-[9px] text-muted-foreground/50">{route.capability.warnings[0]}</p>
            )}
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Total (1 pc, batch {comparison.batchSize})</span>
              <span className={`font-semibold tabular-nums ${route.capability?.overallCapable === false ? "text-muted-foreground/50 line-through" : ""}`}>₹{fmt(route.totalCost, 2)}</span>
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Cycle time</span>
              <span className="tabular-nums">{fmt(route.cycleTimes.totalMin, 1)} min</span>
            </div>
            {route.abrasiveCost > 0 && (
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Abrasive</span>
                <span className="tabular-nums">₹{fmt(route.abrasiveCost, 2)}</span>
              </div>
            )}
            {route.warnings.map((w, i) => (
              <p key={i} className="text-[9px] text-amber-500/80">⚠ {w}</p>
            ))}
          </div>
        ))}
        {comparison.comparisonWarnings.map((w, i) => (
          <p key={i} className="text-[9px] text-amber-500/80 mt-1">⚠ {w}</p>
        ))}
      </div>
    </Section>
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

function GdtAnalysisCard({ item }: { item: BOMItem }) {
  const { data: gdt, isLoading } = useGdtAnalysis(item.id);

  if (isLoading) return (
    <div className="p-3 text-xs text-muted-foreground animate-pulse">Analysing GD&T…</div>
  );

  const title = <><Crosshair className="h-3 w-3 inline mr-1" />GD&amp;T Impact</>;

  if (!gdt || gdt.source === "no_data") {
    const generalTolerance = gdt?.generalTolerance ?? null;
    const tightestToleranceMm = item.tightestToleranceMm ?? null;
    const rawNotes: string = (item.drawingIntelligence as any)?.drawing_notes ?? "";

    const noteLines = rawNotes
      .split(/\d+\)/)
      .map((s) => s.trim())
      .filter(Boolean);

    const hasSignals = generalTolerance || tightestToleranceMm !== null || noteLines.length > 0;

    if (!hasSignals) return (
      <Section title={title} defaultOpen={false}>
        <p className="text-[10px] text-muted-foreground py-1">
          No drawing intelligence available — upload a 2D drawing to enable analysis.
        </p>
      </Section>
    );

    const assessment: string[] = [];
    if (tightestToleranceMm !== null && tightestToleranceMm <= 0.1) {
      assessment.push("Tight dimensional control expected");
      assessment.push("Height gauge inspection likely required");
    }
    if (rawNotes.toUpperCase().includes("BEND")) {
      assessment.push("Press-brake setup verification recommended");
    }
    if (rawNotes.toUpperCase().includes("CRITICAL")) {
      assessment.push("Review critical dimensions manually");
    }
    if (assessment.length > 0) {
      assessment.push("Additional inspection may be required");
    }

    return (
      <Section title={title} defaultOpen>
        <div className="space-y-2 pt-1">
          <p className="text-[9px] text-muted-foreground/70 italic">
            No explicit GD&amp;T feature control frames detected.
          </p>

          <div className="border border-border/50 rounded-md p-2 space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              Drawing Controls
            </p>
            {generalTolerance && (
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">General Tolerance</span>
                <span className="font-medium tabular-nums">{generalTolerance}</span>
              </div>
            )}
            {tightestToleranceMm !== null && (
              <div className="flex justify-between text-[10px]">
                <span className="text-muted-foreground">Tightest Dimension</span>
                <span className="font-medium tabular-nums">±{tightestToleranceMm} mm</span>
              </div>
            )}
            {noteLines.length > 0 && (
              <div className="pt-0.5">
                <p className="text-[9px] text-muted-foreground mb-0.5">Drawing Notes</p>
                {noteLines.map((n, i) => (
                  <p key={i} className="text-[9px] text-muted-foreground/80">• {n}</p>
                ))}
              </div>
            )}
          </div>

          {assessment.length > 0 && (
            <div className="border border-border/50 rounded-md p-2 space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Engineering Assessment
              </p>
              {assessment.map((a, i) => (
                <p key={i} className="text-[9px] text-muted-foreground/80">• {a}</p>
              ))}
            </div>
          )}

          <p className="text-[8px] text-muted-foreground/40 pt-0.5">
            Source: Drawing Notes &amp; General Tolerances
          </p>
        </div>
      </Section>
    );
  }

  return (
    <Section title={title} defaultOpen>
      <div className="space-y-2 pt-1">
        {gdt.features.map((f, i) => (
          <div key={i} className={`border rounded-md p-2 space-y-1 ${SEVERITY_BG[f.severity]}`}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold capitalize">
                {f.type} ⌀{f.toleranceMm}
              </span>
              <span className={`text-[9px] font-semibold uppercase tracking-wide ${SEVERITY_COLOR[f.severity]}`}>
                {f.severity}
              </span>
            </div>
            {f.datum && (
              <p className="text-[9px] text-muted-foreground">Datum: {f.datum}</p>
            )}
            <p className="text-[9px] text-muted-foreground">
              {f.inspectionMethod.replace("_", " ")} · {f.inspectionTimeMin} min · {f.costImpactRange}
            </p>
            {f.manufacturingActions.length > 0 && (
              <ul className="space-y-0.5 pl-2">
                {f.manufacturingActions.map((a, j) => (
                  <li key={j} className="text-[9px] text-muted-foreground/80 list-disc list-inside">{a}</li>
                ))}
              </ul>
            )}
            {f.confidence !== null && f.confidence < 0.6 && (
              <p className="text-[9px] text-amber-500/80">
                ⚠ Low extraction confidence ({Math.round((f.confidence ?? 0) * 100)}%)
              </p>
            )}
          </div>
        ))}
        {gdt.generalTolerance && (
          <p className="text-[9px] text-muted-foreground">General: {gdt.generalTolerance}</p>
        )}
        <div className="flex justify-between text-[10px] pt-1 border-t border-border/40">
          <span className="text-muted-foreground">Overall</span>
          <span className={`font-semibold ${SEVERITY_COLOR[gdt.overallSeverity ?? "low"]}`}>
            {(gdt.overallSeverity ?? "—").toUpperCase()} · max {gdt.maxCostImpactRange} · {gdt.totalInspectionTimeMin} min
          </span>
        </div>
        {gdt.recommendedInspectionMethod && (
          <p className="text-[9px] text-muted-foreground">
            Recommended: {gdt.recommendedInspectionMethod.replace("_", " ")} inspection
          </p>
        )}
        {gdt.analysisConfidence > 0 && (
          <p className="text-[9px] text-muted-foreground/60">
            GD&amp;T extraction confidence: {Math.round(gdt.analysisConfidence * 100)}%
          </p>
        )}
      </div>
    </Section>
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

function InputRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="text-xs font-medium text-right w-20 shrink-0 border border-border rounded px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500 tabular-nums"
      />
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
        onClick={() => { if (hasChildren) onToggle(node.id); onSelect(node); }}
        className={`border-b border-border/30 cursor-pointer transition-colors text-xs ${isSelected ? 'bg-primary/10' : 'hover:bg-primary/5'}`}
      >
        <td className="px-2 py-1 w-5 text-center shrink-0">
          <span className="text-emerald-500 text-[9px]">●</span>
        </td>
        <td className="py-1 pr-2 max-w-0">
          <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 14}px` }}>
            {hasChildren
              ? <span className="shrink-0 text-muted-foreground">{isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</span>
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

// ── RouteSelectionDialog ────────────────────────────────────────────────────────

function RouteSelectionDialog({
  open, onClose, partFamily, currentRouteId, onSelectRoute,
}: {
  open: boolean;
  onClose: () => void;
  partFamily: string | null;
  currentRouteId: string | null;
  onSelectRoute: (route: ManualRouteOption) => void;
}) {
  const routes = KB_ROUTE_ALTERNATIVES[partFamily ?? '']
    ?? KB_ROUTE_ALTERNATIVES.sheet_metal
    ?? [];

  const [pendingId, setPendingId] = useState<string | null>(
    currentRouteId ?? routes.find((r) => r.isRecommended)?.id ?? routes[0]?.id ?? null,
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Select Process Route</DialogTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            Choose a manufacturing route — process tree will update immediately
          </p>
        </DialogHeader>

        <div className="space-y-2 my-1">
          {routes.map((route) => (
            <button
              key={route.id}
              onClick={() => setPendingId(route.id)}
              className={cn(
                'w-full text-left border rounded-lg p-3 transition-colors',
                pendingId === route.id
                  ? 'border-violet-500 bg-violet-50/5 ring-1 ring-violet-500/30'
                  : 'border-border hover:bg-muted/50',
              )}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-sm">{route.label}</span>
                <div className="flex items-center gap-1.5">
                  {route.isRecommended && (
                    <Badge className="text-[10px] h-4 px-1.5 bg-blue-600/20 text-blue-400 border border-blue-500/30">
                      Recommended
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5 capitalize">
                    {route.complexityLevel}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-wrap mb-1.5">
                {route.processes.map((p, i) => (
                  <Fragment key={p}>
                    <span className="text-xs text-muted-foreground">{p}</span>
                    {i < route.processes.length - 1 && (
                      <span className="text-[10px] text-muted-foreground/40">→</span>
                    )}
                  </Fragment>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground/70 italic">{route.rationale}</p>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!pendingId}
            onClick={() => {
              const selected = routes.find((r) => r.id === pendingId);
              if (selected) { onSelectRoute(selected); onClose(); }
            }}
          >
            Apply Route
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── CostGuidePanel (Left) ──────────────────────────────────────────────────────

function CostGuidePanel({
  item, fg, summary, batchSize, setBatchSize, productionLife, setProductionLife,
  processRouting, setProcessRouting, factory, setFactory,
  onManualClick, selectedManualRoute,
  selectedAutoRouteId, setSelectedAutoRouteId,
}: {
  item: BOMItem; fg: FeatureGraph | null; summary: FeatureGraphSummary | null;
  batchSize: number; setBatchSize: (v: number) => void;
  productionLife: number; setProductionLife: (v: number) => void;
  processRouting: 'auto' | 'manual'; setProcessRouting: (v: 'auto' | 'manual') => void;
  factory: string; setFactory: (v: string) => void;
  onManualClick: () => void;
  selectedManualRoute: ManualRouteOption | null;
  selectedAutoRouteId: string | null;
  setSelectedAutoRouteId: (id: string) => void;
}) {
  type LeftTab = 'scenario' | 'geo' | 'machine';
  const [tab, setTab] = useState<LeftTab>('scenario');
  const [productLine, setProductLine] = useState('');
  const [expandedMaterialId, setExpandedMaterialId] = useState<string | null>(null);
  const { data: materialCandidates, isLoading: matLoading } = useMaterialIntelligence(item.id);
  const updateBOMItem = useUpdateBOMItem();

  const UNSPECIFIED_MATERIALS = new Set(['Unknown', 'Not specified', 'Not Specified', 'None', '']);
  const drawingMaterial = item.drawingIntelligence?.material;
  const hasDrawingMaterial = !!drawingMaterial && !UNSPECIFIED_MATERIALS.has(drawingMaterial.trim());
  const isSheetMetalCAD =
    fg?.classification?.family === 'sheet_metal' || (summary?.sheetThicknessMm ?? 0) > 0;
  const cadThicknessMm = summary?.sheetThicknessMm ?? 0;
  const recs = fg?.processRecommendations ?? [];
  const autoRoutes = KB_ROUTE_ALTERNATIVES[fg?.classification?.family ?? ''] ?? [];
  const scoringCtx: RouteScoringContext | null = summary ? { summary, item, batchSize } : null;
  const routeScores: Record<string, RouteScore> = scoringCtx
    ? Object.fromEntries(autoRoutes.map((r) => [r.id, computeRouteScore(r.id, scoringCtx)]))
    : {};
  const recommendedRouteId: string | null = autoRoutes.length > 0 && Object.keys(routeScores).length > 0
    ? autoRoutes.reduce((best, r) =>
        (routeScores[r.id]?.totalScore ?? 0) > (routeScores[best.id]?.totalScore ?? 0) ? r : best
      ).id
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b shrink-0 overflow-x-auto">
        {([['scenario', 'Production Scenario'], ['geo', 'Drawing Intelligence'], ['machine', 'Process & Machine']] as [LeftTab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-2 py-1.5 text-[10px] font-medium border-b-2 whitespace-nowrap transition-colors shrink-0 ${
              tab === key ? 'border-violet-500 text-violet-700' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>{label}</button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'scenario' && (
          <>
            <Section title="Digital Factory">
              <select
                value={factory}
                onChange={(e) => setFactory(e.target.value)}
                className="w-full text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option>Mithran India</option>
                <option>Mithran Global</option>
              </select>
            </Section>

            <Section title="Process Routing">
              {/* ── Auto routing ── */}
              <label className="flex items-start gap-2 py-0.5 cursor-pointer">
                <input
                  type="radio" name="proc_routing"
                  checked={processRouting === 'auto'}
                  onChange={() => setProcessRouting('auto')}
                  className="accent-violet-600 mt-0.5 shrink-0"
                />
                <span className="text-xs leading-tight font-medium">Auto (process-computed)</span>
              </label>

              {processRouting === 'auto' && autoRoutes.length > 0 && (
                <div className="ml-4 mt-1 space-y-0.5">
                  {autoRoutes.map((route) => {
                    const isSelected = selectedAutoRouteId === route.id;
                    return (
                      <label key={route.id} className={cn(
                        'flex items-start gap-2 py-1 px-1.5 rounded cursor-pointer transition-colors',
                        isSelected ? 'bg-violet-500/10' : 'hover:bg-muted/50',
                      )}>
                        <input type="radio" name="auto_route" checked={isSelected}
                          onChange={() => setSelectedAutoRouteId(route.id)}
                          className="accent-violet-600 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-xs leading-tight">{route.label}</span>
                            {route.id === recommendedRouteId && (
                              <span className="text-[9px] font-semibold text-blue-400 border border-blue-500/40 rounded px-1 py-px leading-none">REC</span>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5 leading-tight">
                            {route.processes.join(' → ')}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* ── Manual routing ── */}
              <label className="flex items-start gap-2 py-0.5 mt-1 cursor-pointer">
                <input
                  type="radio" name="proc_routing"
                  checked={processRouting === 'manual'}
                  onChange={() => {
                    setProcessRouting('manual');
                    onManualClick();
                  }}
                  className="accent-violet-600 mt-0.5 shrink-0"
                />
                <span className="text-xs leading-tight font-medium">Manual routing</span>
              </label>
              {processRouting === 'manual' && selectedManualRoute && (
                <button
                  onClick={onManualClick}
                  className="ml-4 mt-0.5 text-[11px] text-violet-400 hover:text-violet-300 underline text-left"
                >
                  {selectedManualRoute.label} ↗
                </button>
              )}
            </Section>

            <Section title="Likely Materials">
              {item.materialGrade ? (
                <div className="flex items-center gap-1.5 mb-1.5 pb-1.5 border-b border-border/30">
                  <span className="text-xs font-medium truncate flex-1">{item.materialGrade}</span>
                  <span className="text-[9px] font-semibold text-emerald-400 border border-emerald-500/40 rounded px-1 py-px leading-none shrink-0">SET</span>
                </div>
              ) : hasDrawingMaterial ? (
                <div className="flex items-center gap-1.5 mb-1.5 pb-1.5 border-b border-border/30">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium truncate block">{drawingMaterial}</span>
                    <span className="text-[9px] text-muted-foreground/60 leading-tight">From drawing title block</span>
                  </div>
                  <span className="text-[9px] font-semibold text-blue-400 border border-blue-500/40 rounded px-1 py-px leading-none shrink-0">DRAWING</span>
                  <button
                    onClick={() => updateBOMItem.mutate({ id: item.id, data: { materialGrade: drawingMaterial! } })}
                    className="text-[9px] font-medium text-violet-400 hover:text-violet-300 shrink-0"
                  >Apply</button>
                </div>
              ) : isSheetMetalCAD && cadThicknessMm > 0 ? (
                <div className="mb-1.5 pb-1.5 border-b border-border/30">
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium truncate block">IS2062 E250 CRCA</span>
                      <span className="text-[9px] text-muted-foreground/60 leading-tight">
                        {cadThicknessMm}mm sheet — standard for laser cutting
                      </span>
                    </div>
                    <span className="text-[9px] font-semibold text-cyan-400 border border-cyan-500/40 rounded px-1 py-px leading-none shrink-0">CAD</span>
                    <button
                      onClick={() => updateBOMItem.mutate({ id: item.id, data: { materialGrade: 'IS2062 E250 CRCA' } })}
                      className="text-[9px] font-medium text-violet-400 hover:text-violet-300 shrink-0"
                    >Apply</button>
                  </div>
                </div>
              ) : null}
              {matLoading ? (
                <div className="space-y-1.5 py-1">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-7 bg-muted/40 rounded animate-pulse" />
                  ))}
                </div>
              ) : (materialCandidates ?? []).length === 0 ? (
                <p className="text-[10px] text-muted-foreground/50 py-1">No material candidates found</p>
              ) : (
                <div className="space-y-0.5">
                  {(materialCandidates ?? []).map((cand: MaterialCandidate, idx) => {
                    const candId = `${cand.material}-${idx}`;
                    const isExpanded = expandedMaterialId === candId;
                    const isHeat = ['stainless', 'ss304', 'ss316', 'inconel', 'titanium'].some((k) =>
                      cand.material.toLowerCase().includes(k),
                    );
                    return (
                      <div key={candId} className="rounded border border-border/20 overflow-hidden">
                        <button
                          onClick={() => setExpandedMaterialId(isExpanded ? null : candId)}
                          className="w-full flex items-center gap-2 px-1.5 py-1 hover:bg-muted/40 transition-colors text-left"
                        >
                          <span className="text-[10px] text-muted-foreground/40 w-3 shrink-0">{idx + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="text-xs leading-tight font-medium truncate">{cand.material}</span>
                              {isHeat && (
                                <span className="text-[8px] text-amber-400 border border-amber-500/30 rounded px-0.5 leading-none shrink-0">HAZ</span>
                              )}
                            </div>
                            {cand.materialGrade && (
                              <p className="text-[9px] text-muted-foreground/50 leading-tight truncate">{cand.materialGrade}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <div className="w-12 bg-muted/40 rounded-full h-[3px]">
                              <div
                                className={cn('h-[3px] rounded-full', cand.confidence >= 80 ? 'bg-emerald-500/70' : cand.confidence >= 60 ? 'bg-yellow-500/70' : 'bg-muted-foreground/30')}
                                style={{ width: `${cand.confidence}%` }}
                              />
                            </div>
                            <span className={cn(
                              'text-[10px] font-semibold tabular-nums w-6 text-right',
                              cand.confidence >= 80 ? 'text-emerald-400' : cand.confidence >= 60 ? 'text-yellow-400' : 'text-muted-foreground/50',
                            )}>{cand.confidence}%</span>
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="px-2 pb-2 space-y-1.5 border-t border-border/20 pt-1.5">
                            {cand.reasons.length > 0 && (
                              <div className="space-y-0.5">
                                {cand.reasons.map((r, i) => (
                                  <p key={i} className="text-[9px] text-emerald-400/80 flex items-start gap-1 leading-tight">
                                    <span className="shrink-0">✓</span><span>{r}</span>
                                  </p>
                                ))}
                              </div>
                            )}
                            {cand.processCompatibility.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-0.5">
                                {cand.processCompatibility.map((p) => (
                                  <span key={p.process} className="text-[8px] border border-border/40 rounded px-1 py-px text-muted-foreground/60 leading-none">
                                    {p.process}
                                  </span>
                                ))}
                              </div>
                            )}
                            <button
                              onClick={() => {
                                updateBOMItem.mutate({ id: item.id, data: { materialGrade: cand.materialGrade ?? cand.material } });
                                setExpandedMaterialId(null);
                              }}
                              className="w-full text-[10px] font-medium text-violet-400 border border-violet-500/30 rounded px-2 py-1 hover:bg-violet-500/10 transition-colors mt-0.5"
                            >
                              Apply {cand.materialGrade ?? cand.material}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section title="Volume and Batch Size">
              <Row label="Annual Volume" value={fmtInt(item.annualVolume ?? 0)} />
              <InputRow label="Batch Size" value={batchSize} onChange={setBatchSize} />
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

        {tab === 'machine' && (
          recs.length > 0 ? (
            <Section title="Process & Machine Options">
              {recs.map((r, i) => (
                <div key={i} className="py-1.5 border-b last:border-b-0">
                  <p className="text-xs font-medium">{r.process}</p>
                  <p className="text-[11px] text-muted-foreground">{MACHINE_FOR[r.process] ?? '—'}</p>
                  {r.estimated_time_sec != null && (
                    <p className="text-[11px] text-muted-foreground tabular-nums">Est. {fmt(r.estimated_time_sec / 60, 1)} min</p>
                  )}
                </div>
              ))}
            </Section>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 px-4 gap-2 text-muted-foreground">
              <AlertCircle className="h-8 w-8 opacity-30" />
              <p className="text-xs text-center">Run Auto-Fill to generate process options.</p>
            </div>
          )
        )}

      </div>

      {/* Action buttons */}
      <div className="border-t px-3 py-2 flex gap-1.5 shrink-0">
        <button onClick={() => toast.success('Settings applied')}
          className="flex-1 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded px-2 py-1 font-medium transition-colors">Apply</button>
        <button className="text-xs border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">Copy</button>
        <button className="text-xs border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">New</button>
      </div>
    </div>
  );
}

// ── ValidationTab ─────────────────────────────────────────────────────────────

function ValidationTab({ fg }: { fg: FeatureGraph | null }) {
  const checks = (fg?.validationResults ?? []) as ValidationResult[];
  const score = fg?.manufacturabilityScore;
  const difficulty = fg?.difficultyLevel;

  const severityIcon = (passed: boolean, severity: string) => {
    if (passed) return <span className="text-emerald-600 font-bold text-sm">✅</span>;
    if (severity === 'critical') return <span className="text-red-600 font-bold text-sm">❌</span>;
    return <span className="text-amber-500 font-bold text-sm">⚠️</span>;
  };

  const difficultyColor = (d?: string) => {
    if (d === 'easy') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    if (d === 'medium') return 'text-amber-700 bg-amber-50 border-amber-200';
    if (d === 'hard') return 'text-orange-700 bg-orange-50 border-orange-200';
    if (d === 'very_hard') return 'text-red-700 bg-red-50 border-red-200';
    return 'text-muted-foreground bg-muted border-border';
  };

  if (!fg) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground p-4">
        <AlertCircle className="h-6 w-6 opacity-30" />
        <p className="text-xs text-center">Run Auto-Fill to generate validation results.</p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {/* Score + Difficulty */}
      <div className="flex items-center gap-2 flex-wrap">
        {score != null && (
          <span className={`text-xs font-semibold px-2 py-1 rounded border ${score >= 80 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : score >= 60 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-red-700 bg-red-50 border-red-200'}`}>
            Score: {score}/100
          </span>
        )}
        {difficulty && (
          <span className={`text-xs font-semibold px-2 py-1 rounded border uppercase ${difficultyColor(difficulty)}`}>
            {difficulty.replace('_', ' ')}
          </span>
        )}
      </div>
      {/* Checklist */}
      {checks.length === 0 ? (
        <p className="text-xs text-muted-foreground">No validation checks available for this part.</p>
      ) : (
        <div className="divide-y divide-border/40 border rounded">
          {checks.map((c) => (
            <div key={c.id} className="px-2 py-1.5 flex items-start gap-2">
              <span className="shrink-0 mt-0.5">{severityIcon(c.passed, c.severity)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-xs font-medium">{c.check}</span>
                  {c.threshold && <span className="text-[10px] text-muted-foreground">{c.threshold}</span>}
                  {c.actualValue && <span className="text-[10px] font-mono text-foreground/70">{c.actualValue}</span>}
                </div>
                {c.recommendation && !c.passed && (
                  <p className="text-[10px] text-amber-700 mt-0.5">{c.recommendation}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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
  const gdtCallouts = di.gdt_callouts ?? [];

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

      <Section title={`GD&T${gdtCallouts.length > 0 ? ` (${gdtCallouts.length})` : ''}`}>
        {gdtCallouts.length === 0 ? (
          <p className="text-[10px] text-muted-foreground py-0.5">None detected</p>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-[10px] text-muted-foreground">
                <th className="text-left font-medium pb-0.5">Type</th>
                <th className="text-right font-medium pb-0.5">Tol.</th>
                <th className="text-right font-medium pb-0.5">Datum</th>
              </tr>
            </thead>
            <tbody>
              {gdtCallouts.map((g, i) => (
                <tr key={i} className="border-t border-border/40">
                  <td className="py-0.5 font-medium">{g.type}</td>
                  <td className="py-0.5 text-right tabular-nums text-muted-foreground">Ø{g.tolerance}</td>
                  <td className="py-0.5 text-right font-mono text-[10px]">{g.datum || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

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

// ── AnalysisTabsPanel (Right) ──────────────────────────────────────────────────

function AnalysisTabsPanel({
  item, fg, batchSize, productionLife, factory,
}: {
  item: BOMItem; fg: FeatureGraph | null;
  batchSize: number; productionLife: number; factory: string;
}) {
  const [tab, setTab] = useState<RightTabKey>('part_summary');
  const cls = fg?.classification;
  const lifetimeVol = (item.annualVolume ?? 0) * productionLife;

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b shrink-0 overflow-x-auto">
        {RIGHT_TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-2 py-1.5 text-[10px] font-medium border-b-2 whitespace-nowrap transition-colors shrink-0 ${
              tab === key ? 'border-violet-500 text-violet-700' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>{label}</button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'part_summary' && (
          <>
            {cls && (
              <Section title="Classification">
                <div className="flex items-center justify-between py-0.5">
                  <span className="text-xs font-semibold">{familyLabel(cls.family)}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${confidenceCls(cls.confidence)}`}>
                    {Math.round(cls.confidence * 100)}%
                  </span>
                </div>
                {cls.signals?.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {cls.signals.map((s, i) => (
                      <span key={i} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{s}</span>
                    ))}
                  </div>
                )}
              </Section>
            )}
            <Section title="Part Geometry">
              <Row label="Rough Mass (kg)" value={item.weight != null ? fmt(item.weight * 1.05, 3) : '—'} />
              <Row label="Finish Mass (kg)" value={item.weight != null ? fmt(item.weight, 3) : '—'} />
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
          <>
            <CostSummaryTab item={item} batchSize={batchSize} />
            <RouteComparisonCard item={item} batchSize={batchSize} />
            <GdtAnalysisCard item={item} />
          </>
        )}

        {tab === 'validation' && (
          <ValidationTab fg={fg} />
        )}

        {tab === 'design' && (
          <DesignGuidanceTab fg={fg} />
        )}

        {tab !== 'part_summary' && tab !== 'cost' && tab !== 'validation' && tab !== 'design' && (
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
  const family = fg?.classification?.family ?? 'cnc_milled';
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

      <div className="flex-1 overflow-auto">
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
  selectedHoleGroup, selectedBend, dfmWarnings,
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
}) {
  type GCDTab = 'geo' | 'cost' | 'props' | 'detail';
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

  useEffect(() => {
    if (selectedHoleGroup || selectedBend) setTab('detail');
  }, [selectedHoleGroup, selectedBend]);

  return (
    <div className="flex flex-col h-full overflow-hidden border-l">
      <PanelHeader title="Geometric Cost Drivers" panelId="drivers" maximized={maximized} onMaximize={onMaximize} />

      {/* Tab bar */}
      <div className="flex border-b shrink-0 overflow-x-auto">
        {([
          ['geo', 'Geometry'],
          ['cost', 'Cost Drivers'],
          ['props', 'Properties'],
          ['detail', isFeatureSelected ? '● Selected' : 'Selected'],
        ] as [GCDTab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-[10px] font-medium border-b-2 whitespace-nowrap transition-colors shrink-0 ${
              tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
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
                    <span className="text-[10px] text-muted-foreground w-20 shrink-0 truncate">{attr.name}</span>
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
        <div className="flex-1 overflow-hidden min-h-0">
          <FeatureDetailPanel metadata={featureMetadata} />
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

  const queryClient = useQueryClient();
  const { data: item, isLoading } = useBOMItem(itemId);
  const { data: analysisVersionData } = useAnalysisVersion();
  const [file3dUrl, setFile3dUrl] = useState<string | null>(null);
  const [maximized, setMaximized] = useState<PanelId | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    () => new Set(['root', 'grp_0', 'op_0', 'op_1', 'op_2', 'subop_0', 'subop_1', 'subop_2']),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [batchSize, setBatchSize] = useState(250);
  const [productionLife, setProductionLife] = useState(5);
  const [processRouting, setProcessRouting] = useState<'auto' | 'manual'>('auto');
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  const [selectedManualRoute, setSelectedManualRoute] = useState<ManualRouteOption | null>(null);
  const [selectedAutoRouteId, setSelectedAutoRouteId] = useState<string | null>(null);
  const [operationVisual, setOperationVisual] = useState<OperationVisual>(null);
  const [vizLabel, setVizLabel] = useState<string | null>(null);
  const [factory, setFactory] = useState('Mithran India');
  const [refreshing, setRefreshing] = useState(false);

  // ── Heatmap state ─────────────────────────────────────────────────────────────
  const [heatmapMode, setHeatmapMode] = useState(false);
  const [heatmapLayer, setHeatmapLayer] = useState<HeatmapLayerType>('manufacturing_risk');
  const [heatmapNorm, setHeatmapNorm] = useState<HeatmapNormalization>('relative');
  const [heatmapInspector, setHeatmapInspector] = useState<{
    worldPos: [number, number, number];
    riskValue: number;
    riskLevel: 'critical' | 'high' | 'medium' | 'low';
    contributors: Array<{ featureId: string; occurrenceIndex: number; contribution: number; label: string }>;
    nearbyFeatures: Array<{ id: string; type: string; distanceMm: number; riskLevel: string }>;
    manufacturingImpact: Array<{ code: string; label: string; severity: 'critical' | 'high' | 'medium' | 'low' }>;
    recommendations: Array<{ label: string; priority: 'high' | 'medium' | 'low' }>;
  } | null>(null);

  // All hooks must appear before any conditional returns
  const fg = useMemo(
    () => normalizeFeatureGraph(item ? ((item.featureGraph as FeatureGraph | undefined) ?? null) : null),
    [item],
  );
  const currentVersion = analysisVersionData?.version ?? 0;
  const isStale = fg != null && currentVersion > 0 && (fg.feature_graph_version ?? 0) < currentVersion;

  // Auto-select the recommended KB route when the detected part family changes
  useEffect(() => {
    const family = fg?.classification?.family;
    const routes = KB_ROUTE_ALTERNATIVES[family ?? ''] ?? [];
    const recommended = routes.find((r) => r.isRecommended) ?? routes[0] ?? null;
    setSelectedAutoRouteId(recommended?.id ?? null);
  }, [fg?.classification?.family]);

  const summary = useMemo(
    () => fg?.summary ?? (item ? buildSummary(item, fg) : null),
    [fg, item],
  );
  const activeOverrideProcesses = useMemo(() => {
    if (processRouting === 'manual' && selectedManualRoute) return selectedManualRoute.processes;
    if (processRouting === 'auto') {
      const family = fg?.classification?.family;
      const autoRoutes = KB_ROUTE_ALTERNATIVES[family ?? ''] ?? [];
      if (autoRoutes.length > 0) {
        const picked = autoRoutes.find((r) => r.id === selectedAutoRouteId)
          ?? autoRoutes.find((r) => r.isRecommended)
          ?? autoRoutes[0];
        return picked?.processes;
      }
    }
    return undefined;
  }, [processRouting, selectedManualRoute, selectedAutoRouteId, fg?.classification?.family]);

  const tree = useMemo(
    () => (item && summary) ? buildProcessTree(item, fg, summary, factory, activeOverrideProcesses) : null,
    [item, fg, summary, factory, activeOverrideProcesses],
  );

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

  const selectedV2Feature = useMemo(() => {
    const v2Features = fg?.feature_graph_v2?.features;
    if (!v2Features) return null;
    if (selectedHoleGroup) {
      return v2Features.find((f) => f.feature_type === 'hole' && f.diameter_mm === selectedHoleGroup.diameter_mm) ?? null;
    }
    if (selectedBend) {
      return v2Features.find((f) => f.feature_type === 'bend' && f.radius_mm === selectedBend.recognition.radius_mm) ?? null;
    }
    return null;
  }, [fg, selectedHoleGroup, selectedBend]);

  const [selectedOccurrenceIndex, setSelectedOccurrenceIndex] = useState<number | null>(null);

  useEffect(() => {
    setSelectedOccurrenceIndex(null);
  }, [selectedV2Feature]);

  const faceMap = fg?.feature_graph_v2?.metadata?.face_map ?? null;

  const { data: dfmScores } = useDFMScores(item?.id);
  const selectedFeatureScores = dfmScores?.features.find((f) => f.featureId === selectedV2Feature?.id)?.occurrences;

  const heatmapSources = useMemo((): HeatmapSource[] => {
    if (!heatmapMode || !dfmScores?.features?.length || !fg?.feature_graph_v2) return [];
    switch (heatmapLayer) {
      case 'manufacturing_risk':
        return buildManufacturingRiskSources(dfmScores, fg, item?.sheetThicknessMm ?? 1);
      default:
        return [];
    }
  }, [heatmapMode, heatmapLayer, dfmScores, fg, item?.sheetThicknessMm]);

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
      return { featureId: src.featureId ?? '', occurrenceIndex: src.occurrenceIndex ?? 0, contribution };
    });

    const map = new Map<string, (typeof withContributions)[0]>();
    for (const c of withContributions) {
      const key = `${c.featureId}:${c.occurrenceIndex}`;
      const existing = map.get(key);
      if (!existing || existing.contribution < c.contribution) map.set(key, c);
    }

    const contributors = Array.from(map.values())
      .filter((c) => c.contribution > 0.02)
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 5)
      .map((c) => {
        const v2 = fg?.feature_graph_v2?.features.find((f) => f.id === c.featureId);
        const label = v2
          ? `${v2.feature_type === 'hole' ? `Ø${v2.diameter_mm}mm hole` : `R${v2.radius_mm}mm bend`} · occ ${c.occurrenceIndex + 1}`
          : c.featureId;
        return { ...c, label };
      });

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
    };

    const REC_MAP: Record<string, { label: string; priority: 'high' | 'medium' | 'low' }> = {
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
  }, [heatmapSources, fg, dfmScores]);

  const handleRefreshAnalysis = async () => {
    if (!item?.file3dPath || refreshing) return;
    setRefreshing(true);
    try {
      await apiClient.post(`/bom-items/${itemId}/reanalyze`, {});
      queryClient.invalidateQueries({ queryKey: ['bom-items', 'detail', itemId] });
      queryClient.invalidateQueries({ queryKey: ['bom-items', itemId, 'dfm-scores'] });
      toast.success('Analysis refreshed');
    } catch (e: unknown) {
      toast.error(`Refresh failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!item?.file3dPath) return;
    apiClient.get<{ url: string }>(`/bom-items/${itemId}/file-url/3d`)
      .then((r) => { if (r?.url) setFile3dUrl(r.url); })
      .catch(() => {});
  }, [itemId, item?.file3dPath]);

  const toggleNode = (id: string) => setExpandedNodes((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleTreeSelect = useCallback((node: ProcessTreeNode) => {
    setSelectedNodeId(node.id);
    const v2Features = fg?.feature_graph_v2?.features ?? [];
    const fm = fg?.feature_graph_v2?.metadata?.face_map ?? [];
    if (node.kind === 'operation') {
      const visual = computeOperationVisual(node.label, v2Features, fm);
      setOperationVisual(visual);
      setVizLabel(visual ? getVizLabel(node) : null);
    } else if (node.kind === 'feature') {
      const visual = computeFeatureNodeVisual(node, v2Features, fm);
      setOperationVisual(visual);
      setVizLabel(visual ? getVizLabel(node) : null);
    } else {
      setOperationVisual(null);
      setVizLabel(null);
    }
  }, [fg]);
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
    <header className="flex items-center gap-3 px-4 py-2 border-b shrink-0">
      <button onClick={() => router.push(`/projects/${projectId}/bom/${bomId}`)} className="p-1.5 rounded hover:bg-muted transition-colors" title="Back to BOM">
        <ArrowLeft className="h-4 w-4" />
      </button>
      <Cpu className="h-4 w-4 text-violet-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <h1 className="text-sm font-semibold truncate">{item.name}</h1>
        {item.partNumber && <p className="text-xs text-muted-foreground">{item.partNumber}</p>}
      </div>
      {cls && (
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border shrink-0 ${confidenceCls(cls.confidence)}`}>
          {familyLabel(cls.family)} · {Math.round(cls.confidence * 100)}%
        </span>
      )}
    </header>
  );

  const actionToolbar = (
    <div className="flex items-center gap-1 px-4 py-1.5 border-b bg-muted/20 shrink-0">
      <button
        onClick={handleRefreshAnalysis}
        disabled={refreshing || !item?.file3dPath}
        className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border border-border hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
        Refresh Analysis
        {isStale && !refreshing && <AlertTriangle className="h-3 w-3 text-amber-500 ml-0.5" />}
      </button>
      <button disabled className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border border-border opacity-40 cursor-not-allowed">
        <Calculator className="h-3 w-3" />
        Recalculate Cost
      </button>
      <button disabled className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border border-border opacity-40 cursor-not-allowed">
        <ShieldCheck className="h-3 w-3" />
        Re-run DFM
      </button>
      <button disabled className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border border-border opacity-40 cursor-not-allowed">
        <GitCompare className="h-3 w-3" />
        Compare Versions
      </button>

      <div className="w-px h-4 bg-border mx-1" />

      <button
        onClick={() => { setHeatmapMode((m) => !m); setHeatmapInspector(null); }}
        disabled={!dfmScores?.features?.length}
        title={dfmScores?.features?.length ? 'Toggle manufacturing risk heatmap' : 'Run DFM analysis first'}
        className={cn(
          'flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border transition-colors',
          heatmapMode ? 'bg-blue-600 text-white border-blue-500' : 'border-border hover:bg-muted',
          !dfmScores?.features?.length && 'opacity-40 cursor-not-allowed',
        )}
      >
        <Flame className="h-3 w-3" />
        Heatmap
      </button>

      {heatmapMode && (
        <select
          value={heatmapLayer}
          onChange={(e) => setHeatmapLayer(e.target.value as HeatmapLayerType)}
          className="text-[10px] bg-background border border-border text-foreground rounded px-1.5 py-0.5 ml-0.5"
        >
          <option value="manufacturing_risk">Manufacturing Risk</option>
          <option value="tool_wear" disabled>Tool Wear (soon)</option>
          <option value="thermal" disabled>Thermal Distortion (soon)</option>
          <option value="cost_density" disabled>Cost Density (soon)</option>
          <option value="tolerance_risk" disabled>Tolerance Sensitivity (soon)</option>
          <option value="sustainability" disabled>Sustainability Impact (soon)</option>
        </select>
      )}
    </div>
  );

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
        {heatmapNorm === 'relative' ? 'Scaled to worst area' : 'Absolute risk (0–100)'}
      </span>
    </div>
  ) : null;

  const heatmapInspectorPanel = heatmapInspector && heatmapMode ? (
    <div className="border border-blue-800/60 rounded-md bg-slate-900 p-3 text-xs mb-3 shrink-0">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-slate-200 text-[11px]">Heatmap Inspector</span>
        <button onClick={() => setHeatmapInspector(null)} className="text-slate-500 hover:text-slate-300 text-[10px] leading-none">✕</button>
      </div>

      {/* Risk score bar */}
      <div className="mb-3">
        <div className="flex justify-between text-slate-400 mb-1 text-[10px]">
          <span>Risk at location</span>
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
            <div key={i} className="flex justify-between text-slate-300 text-[10px] py-0.5">
              <span>• {c.label}</span>
              <span className="text-slate-500">{Math.round(c.contribution * 100)}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Manufacturing impact */}
      {heatmapInspector.manufacturingImpact.length > 0 && (
        <div className="mb-2">
          <div className="text-slate-400 text-[10px] mb-1 font-medium">Manufacturing Impact</div>
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
        <div>
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
    </div>
  ) : null;

  const costGuideProps = {
    item, fg, summary, batchSize, setBatchSize, productionLife, setProductionLife,
    processRouting, setProcessRouting, factory, setFactory,
    onManualClick: () => setRouteDialogOpen(true),
    selectedManualRoute,
    selectedAutoRouteId,
    setSelectedAutoRouteId,
  };
  const analysisProps = { item, fg, batchSize, productionLife, factory };
  const treeProps = { item, fg, tree, expanded: expandedNodes, selectedId: selectedNodeId, onToggle: toggleNode, onSelect: handleTreeSelect, factory, maximized, onMaximize: maximize };
  const driversProps = { tree, summary, fg, selectedId: selectedNodeId, onSelect: setSelectedNodeId, maximized, onMaximize: maximize, selectedHoleGroup, selectedBend, dfmWarnings: fg?.dfmWarnings ?? [] };

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
            {maximized === 'center' && vizLabel && (
              <div className="px-3 py-1 text-xs text-muted-foreground border-b border-border/40 bg-muted/20 truncate shrink-0">
                Showing: {vizLabel}
              </div>
            )}
            {maximized === 'center' && (
              file3dUrl
                ? <ModelViewer key={file3dUrl} fileUrl={file3dUrl} fileName={item.file3dPath?.split('/').pop() ?? 'model'} fileType={item.file3dPath?.split('.').pop() ?? 'stl'} bomItemId={item.id}
                    highlightOccurrences={operationVisual?.highlight ?? selectedV2Feature}
                    {...(operationVisual?.color ? { highlightColor: operationVisual.color } : {})}
                    selectedOccurrenceIndex={selectedOccurrenceIndex}
                    onOccurrenceSelect={setSelectedOccurrenceIndex}
                    faceMap={faceMap}
                    sheetThickness={item.sheetThicknessMm ?? 0}
                    {...(selectedFeatureScores !== undefined ? { dfmOccurrenceScores: selectedFeatureScores } : {})}
                    heatmapSources={heatmapSources}
                    heatmapNormalization={heatmapNorm}
                    onHeatmapInspect={handleHeatmapInspect}
                  />
                : <div className="flex items-center justify-center h-full text-sm text-muted-foreground">{item.file3dPath ? 'Loading…' : 'No 3D model'}</div>
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
          partFamily={fg?.classification?.family ?? null}
          currentRouteId={selectedManualRoute?.id ?? null}
          onSelectRoute={(route) => {
            setSelectedManualRoute(route);
            setProcessRouting('manual');
          }}
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
        <PanelGroup direction="vertical" className="h-full">

          {/* TOP ROW */}
          <Panel defaultSize={62} minSize={28}>
            <PanelGroup direction="horizontal" className="h-full">

              {/* LEFT: Cost Guide */}
              <Panel defaultSize={22} minSize={12} className="flex flex-col border-r overflow-hidden">
                <PanelHeader title="Cost Guide" panelId="left" maximized={maximized} onMaximize={maximize} />
                <div className="flex-1 overflow-hidden min-h-0">
                  <CostGuidePanel {...costGuideProps} />
                </div>
              </Panel>

              <HResizeHandle />

              {/* CENTER: 3D Viewer */}
              <Panel defaultSize={48} minSize={20} className="flex flex-col overflow-hidden">
                <PanelHeader title="3D Viewer" panelId="center" maximized={maximized} onMaximize={maximize} />
                {vizLabel && (
                  <div className="px-3 py-1 text-xs text-muted-foreground border-b border-border/40 bg-muted/20 truncate">
                    Showing: {vizLabel}
                  </div>
                )}
                <div className="flex-1 overflow-hidden min-h-0 bg-muted/10 [&>div]:min-h-0">
                  {file3dUrl ? (
                    <ModelViewer key={file3dUrl} fileUrl={file3dUrl}
                      fileName={item.file3dPath?.split('/').pop() ?? 'model'}
                      fileType={item.file3dPath?.split('.').pop() ?? 'stl'}
                      bomItemId={item.id}
                      highlightOccurrences={operationVisual?.highlight ?? selectedV2Feature}
                    {...(operationVisual?.color ? { highlightColor: operationVisual.color } : {})}
                      selectedOccurrenceIndex={selectedOccurrenceIndex}
                      onOccurrenceSelect={setSelectedOccurrenceIndex}
                      faceMap={faceMap}
                      sheetThickness={item.sheetThicknessMm ?? 0}
                      {...(selectedFeatureScores !== undefined ? { dfmOccurrenceScores: selectedFeatureScores } : {})}
                      heatmapSources={heatmapSources}
                      heatmapNormalization={heatmapNorm}
                      onHeatmapInspect={handleHeatmapInspect}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                      <AlertCircle className="h-8 w-8 opacity-30" />
                      <span className="text-sm">{item.file3dPath ? 'Loading 3D model…' : 'No 3D model attached'}</span>
                    </div>
                  )}
                </div>
              </Panel>

              <HResizeHandle />

              {/* RIGHT: Analysis Tabs */}
              <Panel defaultSize={30} minSize={15} className="flex flex-col border-l overflow-hidden">
                <PanelHeader title="Analysis" panelId="right" maximized={maximized} onMaximize={maximize} />
                <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
                  {heatmapInspectorPanel && <div className="p-2">{heatmapInspectorPanel}</div>}
                  <AnalysisTabsPanel {...analysisProps} />
                </div>
              </Panel>

            </PanelGroup>
          </Panel>

          <VResizeHandle />

          {/* BOTTOM: Process Tree + Cost Drivers */}
          <Panel defaultSize={38} minSize={15} className="flex overflow-hidden border-t">
            <PanelGroup direction="horizontal" className="h-full w-full">

              <Panel defaultSize={65} minSize={30} className="flex flex-col overflow-hidden">
                <ProcessTreePanel {...treeProps} />
              </Panel>

              <HResizeHandle />

              <Panel defaultSize={35} minSize={18} className="flex flex-col overflow-hidden">
                <GeometricCostDriversPanel {...driversProps} />
              </Panel>

            </PanelGroup>
          </Panel>

        </PanelGroup>
      </div>
      <RouteSelectionDialog
        open={routeDialogOpen}
        onClose={() => {
          setRouteDialogOpen(false);
          if (!selectedManualRoute) setProcessRouting('auto');
        }}
        partFamily={fg?.classification?.family ?? null}
        currentRouteId={selectedManualRoute?.id ?? null}
        onSelectRoute={(route) => {
          setSelectedManualRoute(route);
          setProcessRouting('manual');
        }}
      />
    </div>
  );
}
