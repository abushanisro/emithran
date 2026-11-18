// 2-Model Machining with no blank model (user decision 2026-11-18): the blank is derived from the part itself. It is the part as cast,
// with the casting's machining allowance on the faces the casting cannot hold, priced by the casting engine (the part forced to that
// casting family). Its machining-after-casting lines are the part's machining: the features the casting cannot hold. Pure.
import type { CostSummaryResponseDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import type { MachiningAllowanceResult } from '../casting/machining-allowance';
import { routeToolingItems } from '../shared/route-tooling';
import type { SourceComponentCost } from './two-model-cost';

/** The derived blank is a sand casting (the casting family it prices as): one a machined part's analysis can price, with allowance data. */
export const BLANK_PROCESS = 'Sand Casting';
export const BLANK_FAMILY = 'sand_cast';

/** What the casting engine reports back when it prices a derived blank (computeCostSummary's derivedBlank option). */
export interface DerivedBlankOut {
  /** Machining allowance metal added to the casting (mm³), and the features that added none (and why). */
  allowanceVolumeMm3?: number;
  allowanceNotes?: string[];
  /** Faces of the features the casting holds as cast (machining need: as_primary): left as supplied. */
  asSuppliedFaceIds?: number[];
  /** How many feature instances that is. */
  asSuppliedFeatures?: number;
}

type Occurrence = { face_ids?: number[]; area_mm2?: number | null; diameter_mm?: number | null; depth_mm?: number | null };
type GraphFeature = { id?: string; diameter_mm?: number | null; occurrences?: Occurrence[] };

/**
 * The machining allowance metal of a casting: each machined feature's allowance (per face, mm) × its sides × the area it covers. The area is
 * the feature_graph_v2 occurrence's area_mm2 (planar faces, walls, curved surfaces, cutouts), or a hole's wall, π × d × depth. A feature with
 * no allowance (requires review) or no measured area adds nothing, and is named.
 */
export function allowanceVolume(allowance: MachiningAllowanceResult | null, fg: { feature_graph_v2?: { features?: GraphFeature[] } } | null | undefined): { volumeMm3: number; notes: string[] } {
  if (!allowance) return { volumeMm3: 0, notes: ['No machining allowance was resolved: the blank is the part as cast.'] };
  const byId = new Map((fg?.feature_graph_v2?.features ?? []).map((f) => [String(f.id ?? ''), f]));
  let volumeMm3 = 0;
  const notes: string[] = [];
  for (const a of allowance.features) {
    if (a.allowanceMm == null) { notes.push(`${a.label}: no allowance (needs review), none added.`); continue; }
    const f = a.featureId ? byId.get(a.featureId) : undefined;
    const o = f?.occurrences?.[a.occurrenceIndex];
    const d = o?.diameter_mm ?? f?.diameter_mm ?? null;
    const area = o?.area_mm2 != null && o.area_mm2 > 0 ? o.area_mm2
      : d != null && d > 0 && o?.depth_mm != null && o.depth_mm > 0 ? Math.PI * d * o.depth_mm
        : null;
    if (area == null) { notes.push(`${a.label}: its area is not measured, no allowance added.`); continue; }
    volumeMm3 += a.allowanceMm * (a.sides ?? 1) * area;
  }
  return { volumeMm3, notes };
}

/** The faces of the features the casting holds as cast (machining-need.ts verdict as_primary): the blank supplies them. */
export function asPrimaryFaceIds(need: { features: ReadonlyArray<{ verdict: string; faceIds: number[] }> } | null | undefined): { faceIds: number[]; count: number } {
  const held = (need?.features ?? []).filter((f) => f.verdict === 'as_primary');
  return { faceIds: [...new Set(held.flatMap((f) => f.faceIds))], count: held.length };
}

/** A machining-after-casting line (secondary-machining-cost.ts), as against the casting's own steps. */
export const isMachiningLine = (l: Pick<ProcessLineCost, 'processGroup'>) => l.processGroup === 'Machining';

/**
 * The derived blank as the part's source component, and the part's machining: the casting summary's material, casting steps and (fully
 * burdened) tooling per part are the source; its machining-after-casting lines are what the part machines. Money stays in the summary's
 * currency; the tooling (USD) is brought to it by usdToDisplayRate.
 */
export function deriveBlankSource(blank: CostSummaryResponseDto, input: { partName: string; blankProcess: string; fullyBurdened: boolean }): { source: SourceComponentCost; machiningLines: ProcessLineCost[] } {
  const machiningLines = blank.processLines.filter(isMachiningLine);
  const castingLines = blank.processLines.filter((l) => !isMachiningLine(l));
  const processCost = castingLines.reduce((s, l) => s + l.totalCost, 0);
  const toolingUsd = input.fullyBurdened
    ? routeToolingItems(blank).reduce((s, t) => s + (t.amortizationParts > 0 ? t.investmentUsd / t.amortizationParts : 0), 0)
    : 0;
  const toolingCost = toolingUsd * (blank.usdToDisplayRate ?? 1);
  const charged = blank.castingMetal?.chargedKg ?? blank.grossWeightKg;
  return {
    source: {
      itemId: '', name: `${input.partName} (derived ${input.blankProcess.toLowerCase()} blank)`,
      basis: input.fullyBurdened ? 'fully_burdened' : 'piece_part',
      materialCost: blank.materialCost, processCost, toolingCost, totalCost: blank.materialCost + processCost + toolingCost,
      massKg: charged > 0 ? charged : null,
    },
    machiningLines,
  };
}
