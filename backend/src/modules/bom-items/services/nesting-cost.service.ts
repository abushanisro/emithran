import { Injectable, Logger } from '@nestjs/common';
import type { MHRRateInput } from '../costing/shared/core/cost-engine';
import { processChoiceConflict } from '../costing/shared/core/part-family-process-group';
import { SheetMetalLookupService } from '../costing/sheet-metal/lookup/sheet-metal-lookup.service';
import { EDGE_ALLOWANCE_MM, type NestingSheet, isTrueNestCostingCacheValid, trueNestInputFingerprint, computePartAllowanceMm, GROSS_USAGE_SPACING_PROCESS } from '../costing/sheet-metal/machine/sheet-metal-nesting.engine';
import { combineBlankNests, selectBestTrueNestCandidate } from '../costing/sheet-metal/machine/true-nest-costing.engine';
import type { FlatPatternBlank } from '../costing/sheet-metal/machine/flat-pattern-blanks';
import { chooseNestBlank, gridNest } from '../costing/sheet-metal/machine/nest-blank-source';
import type { TrueNestCandidate, TrueNestCostingSelection } from '../costing/sheet-metal/machine/true-nest-costing.engine';

/** Lookup tables read by the generic spec resolver (specLookupSeeds), not by a resolver of their own. */
const SPEC_RESOLVED_TABLES: ReadonlySet<string> = new Set(['tblRotarySurfaceGrinding', 'tblStraightBevelGearCutting', 'tblSpiralBevelGearCutting', 'tblShaping', 'tblChamfering', 'tblCornerRoundingMill', 'tblChemicalMilling', 'tblChemicalMillingEtchingRates']);
// Platform Architecture Remediation Phase 1 (engine registry unification,
// Rule 8) — getRouteComparison()'s Press Brake/Deburring/Hole Extrusion/
// Tapping lines now call the exact same registered engines
// computeCostSummary() uses, instead of hand-rolled arithmetic that omitted
// labor/inspection-sampling/yield-loss cost (see each engine file's own doc
// comment for the specific divergence this closes).
import type { CostSummaryDto, ProcessLineCost } from '../dto/cost-breakdown.dto';
import type { TrueNestResultDto } from '../dto/true-nest.dto';
import { CADAnalysisService } from './cad-analysis.service';

/** A quote with extra lines appended: process total, total, cycle time and completeness follow. */
function appendLines<T extends CostSummaryDto>(dto: T, lines: ProcessLineCost[]): T {
  if (lines.length === 0) return dto;
  const extra = lines.reduce((t, l) => t + l.totalCost, 0);
  const gaps = lines.filter((l) => l.physicsGap).map((l) => l.process);
  const incomplete = [...(dto.incompleteProcesses ?? []), ...gaps];
  return {
    ...dto,
    processLines: [...dto.processLines, ...lines],
    totalProcessCost: dto.totalProcessCost + extra,
    totalCost: dto.totalCost + extra,
    cycleTimes: { ...dto.cycleTimes, totalMin: dto.cycleTimes.totalMin + lines.reduce((t, l) => t + l.cycleTimeMin, 0) },
    ...(incomplete.length ? { incompleteProcesses: incomplete, costStatus: 'incomplete' as const } : {}),
    ...(gaps.length ? { uncostedOperations: [...new Set([...(dto.uncostedOperations ?? []), ...gaps])] } : {}),
  };
}

/** The money of a process line in another currency: every amount the line states, converted by one function. */
function convertLineMoney(l: ProcessLineCost, conv: (n: number) => number) {
  return {
    setupCost: conv(l.setupCost),
    runCost: conv(l.runCost),
    totalCost: conv(l.totalCost),
    hourlyRate: conv(l.hourlyRate),
    labourRate: l.labourRate != null ? conv(l.labourRate) : l.labourRate,
    ...(l.machineCostPerPart != null ? { machineCostPerPart: conv(l.machineCostPerPart) } : {}),
    ...(l.laborCostPerPart != null ? { laborCostPerPart: conv(l.laborCostPerPart) } : {}),
  };
}

import { BOMItemsService } from '../bom-items.service';




/** The feature_graph.summary key the true-shape nest of a part's own flat pattern is cached under. */
export const TRUE_NEST_CACHE_KEY = 'trueNestCostingCache';

/**
 * A blank to nest that is not the part's own flat pattern (a hydroformed part's blank: its developed outline), with the summary key its nest
 * is cached under, so it never overwrites the flat pattern's (a part switched between processes keeps both).
 */
export interface NestBlankSource {
  outlinePointsMm: number[][];
  holesMm?: unknown;
  cacheKey: string;
}

/** Nesting of a sheet-metal part on its sheet: the sheet it is costed on, the true-shape nest and its cached result, and the gross material usage a calculator asks for. */
@Injectable()
export class NestingCostService {
  private readonly logger = new Logger(NestingCostService.name);

  constructor(
    private readonly items: BOMItemsService,
    private readonly smLookup: SheetMetalLookupService,
    private readonly cadAnalysisService: CADAnalysisService,
  ) { }

  /**
   * Real (true-shape) nest as the material-costing source of truth, when a
   * real flat-pattern outline exists for this part. Evaluates EVERY viable
   * standard sheet size (STANDARD_SHEETS, shared with sheet-metal-nesting.
   * engine.ts's rectangle-grid fallback) via cad-engine's real true-shape
   * nest, and selects the winner by lowest gross weight/part (laser_cutting_
   * costing_params.md §6a, via true-nest-costing.engine.ts) -- NEVER
   * pre-filtered by the rectangle-grid's own ranking, since a smaller sheet
   * can genuinely interlock an irregular part better than a larger one
   * packs its bounding rectangle.
   *
   * Deterministic by construction: on a cache miss, every candidate is
   * evaluated and the winner cached SYNCHRONOUSLY, before this method
   * returns -- there is no "return an interim answer, upgrade it later"
   * path. Costing is a financial calculation; the same inputs (geometry +
   * kerf + edge margin) always produce the same result whether this is the
   * very first request or the hundredth. A real cad-engine call is slow
   * (10-20s+ per candidate for small-part/large-sheet cases, up to 5
   * candidates), so this request legitimately blocks for that long on a
   * cache miss -- costing correctness matters more than this one request's
   * latency, and the result is cached for every request after it.
   *
   * Returns { selection: null, reason } (never a fabricated/estimated
   * result) when no real outline exists yet, or every candidate sheet
   * genuinely failed -- the caller falls back to rectangle-grid and
   * discloses this via nestingMethod/nestingFallbackReason, never silently.
   */
  /**
   * The flat-pattern holes as the nesting engine needs them.
   *
   * feature_graph.summary.flatPatternHolesMm is stored in camelCase
   * (`{cxMm, cyMm, diameterMm}`). Two call sites declared it as snake_case and
   * then "converted" it — `h.cx_mm -> cxMm` — which produced `undefined` for
   * every field on every hole. The declaration was a cast, so the compiler never
   * saw it. cad-engine then rejected the request with
   * `holes_mm.0.cx_mm: Field required` for each hole, true-shape nesting failed
   * for EVERY candidate sheet, and material cost silently fell back to
   * rectangle-grid nesting on any part that has holes.
   *
   * Both spellings are accepted because older feature graphs may genuinely carry
   * the snake_case form; a hole missing any real coordinate is dropped rather
   * than sent on as `undefined`, so the engine is never asked to nest a hole
   * this system cannot describe.
   */
  private toNestHoles(raw: unknown): Array<{ cxMm: number; cyMm: number; diameterMm: number }> {
    if (!Array.isArray(raw)) return [];
    return (raw as any[])
      .map((h) => ({
        cxMm: Number(h?.cxMm ?? h?.cx_mm),
        cyMm: Number(h?.cyMm ?? h?.cy_mm),
        diameterMm: Number(h?.diameterMm ?? h?.diameter_mm),
      }))
      .filter((h) => Number.isFinite(h.cxMm) && Number.isFinite(h.cyMm) && Number.isFinite(h.diameterMm));
  }

  /**
   * The stock sheet a part is nested on (material cost + Nest view): the
   * nominal sheet of the laser selected to cut it (machine library), else
   * the reference standard sheet (standardSheetWidth/Length). Null only when
   * neither is on file — a real data gap, reported by the caller.
   */
  async resolveNestingSheet(laserMachineName: string | null | undefined): Promise<(NestingSheet & { source: string; fromStandardSheet: boolean }) | null> {
    const machineSheet = await this.smLookup.getNominalSheetForMachine(laserMachineName);
    if (machineSheet) return { ...machineSheet, source: `Nominal sheet of "${laserMachineName}" (machine library)`, fromStandardSheet: false };
    const standard = await this.smLookup.getStandardSheet();
    return standard ? { ...standard, source: 'Standard sheet (standardSheetWidth/Length)', fromStandardSheet: true } : null;
  }

  /**
   * Candidate stock sheets for the Nest view: the reference standard sheet
   * plus every distinct nominal sheet the machine library's fiber lasers cut
   * from — kept only when it fits the selected laser's bed (a sheet bigger
   * than the bed cannot be cut on it). The costed sheet is always included.
   */
  async resolveNestCandidateSheets(
    laser: MHRRateInput | undefined,
    costedSheet: (NestingSheet & { source: string }) | null,
  ): Promise<Array<NestingSheet & { source: string }>> {
    const [standard, library] = await Promise.all([
      this.smLookup.getStandardSheet(),
      this.smLookup.getLaserNominalSheetSizes(),
    ]);
    const cap = (laser?.selection?.balanced?.candidate as any)?.capability;
    const bedX = Number(cap?.maxXMm), bedY = Number(cap?.maxYMm);
    const fitsBed = (s: NestingSheet) => !(bedX > 0 && bedY > 0) ||
      (s.lengthMm <= bedX && s.widthMm <= bedY) || (s.lengthMm <= bedY && s.widthMm <= bedX);
    const out = new Map<string, NestingSheet & { source: string }>();
    const add = (s: NestingSheet | null, source: string) => {
      if (s && fitsBed(s)) out.set(`${s.widthMm}x${s.lengthMm}`, { ...s, source });
    };
    add(standard, 'Standard sheet (standardSheetWidth/Length)');
    for (const s of library) add(s, 'Laser nominal sheet (machine library)');
    if (costedSheet) out.set(`${costedSheet.widthMm}x${costedSheet.lengthMm}`, costedSheet);
    return [...out.values()];
  }

  async resolveTrueShapeNestCosting(
    itemId: string,
    summary: any,
    netWeightKg: number,
    densityKgM3: number,
    thicknessMm: number,
    kerfMm: number,
    edgeMarginMm: number,
    userId: string,
    accessToken: string,
    sheet: NestingSheet,
    // featureGraph.classification: when the chosen process and the geometry disagree, that is why there is no outline.
    classification?: { family?: string | null; geometricFamily?: string | null },
    /** A blank other than the part's flat pattern (a hydroform blank), nested and cached under its own key; the flat pattern when absent. */
    blank?: NestBlankSource,
  ): Promise<{ selection: TrueNestCostingSelection; reason?: undefined } | { selection: null; reason: string }> {
    // A part cut from several blanks (a multi-body file: a channel and its end plate) is nested blank by blank.
    const blanks: FlatPatternBlank[] | undefined = Array.isArray(summary?.flatPatternBlanks) ? summary.flatPatternBlanks : undefined;
    if (!blank && blanks && blanks.length > 1) {
      return this.resolveMultiBlankNestCosting(itemId, blanks, netWeightKg, densityKgM3, thicknessMm, kerfMm, edgeMarginMm, userId, accessToken, sheet, summary);
    }

    const outlinePointsMm = blank ? blank.outlinePointsMm : summary?.flatPatternOutlinePointsMm;
    if (!Array.isArray(outlinePointsMm) || outlinePointsMm.length < 3) {
      const conflict = processChoiceConflict(classification);
      return {
        selection: null,
        reason: blank
          ? 'the blank has no outline -- re-run Reanalyze'
          : conflict
            ? `no flat-pattern outline: ${conflict}`
            : "no real flat-pattern outline available for this part yet -- re-run Reanalyze",
      };
    }

    const holesForFingerprint = blank ? blank.holesMm : summary?.flatPatternHolesMm;
    const cacheKey = blank?.cacheKey ?? TRUE_NEST_CACHE_KEY;
    const inputFingerprint = trueNestInputFingerprint({
      outlinePointsMm, holesMm: holesForFingerprint, thicknessMm, densityKgM3, netWeightKg,
    });

    const cache = summary?.[cacheKey];
    if (isTrueNestCostingCacheValid(cache, kerfMm, edgeMarginMm, inputFingerprint, sheet)) {
      return {
        selection: {
          sheetWidthMm: cache.sheetWidthMm, sheetLengthMm: cache.sheetLengthMm,
          partsPerSheet: cache.partsPerSheet, sheetWeightKg: cache.sheetWeightKg,
          grossWeightPerPartKg: cache.grossWeightPerPartKg, utilisationPct: cache.utilizationPct,
        },
      };
    }

    // Two endpoints on the same page (cost-summary and route-comparison) both
    // resolve this, concurrently, and both miss the cache on the first request
    // after a Reanalyze. Without this they each walk all 5 STANDARD_SHEETS
    // against cad-engine's single-threaded /nest, so the work is done twice and
    // the two requests serialize behind each other -- 130-300s in total, which
    // is what the page was timing out on (confirmed in the cad-engine log:
    // every sheet size requested twice, back to back, 13-30s each).
    //
    // Keyed on the same identity that makes a cached result valid, so callers
    // only share a computation that would have produced the same answer. The
    // entry is removed on settle, so a later request with changed geometry (a
    // different fingerprint) never joins a stale flight.
    const flightKey = `${itemId}|${cacheKey}|${inputFingerprint}|${kerfMm}|${edgeMarginMm}|${sheet.widthMm}x${sheet.lengthMm}`;
    const inFlight = this.trueNestInFlight.get(flightKey);
    if (inFlight) return inFlight;

    const flight = this.computeTrueShapeNestCosting(
      itemId, netWeightKg, densityKgM3, thicknessMm, kerfMm, edgeMarginMm,
      userId, accessToken, outlinePointsMm, holesForFingerprint, inputFingerprint, sheet, cacheKey,
    ).finally(() => this.trueNestInFlight.delete(flightKey));
    this.trueNestInFlight.set(flightKey, flight);
    return flight;
  }

  /**
   * True-shape nest costing of a part cut from several blanks: each blank is nested on the sheet on its own (the nester
   * places copies of one shape) and combineBlankNests sums their material. Same cache, flight sharing and persistence
   * as the one-blank path; the fingerprint covers every blank.
   */
  private async resolveMultiBlankNestCosting(
    itemId: string,
    blanks: FlatPatternBlank[],
    netWeightKg: number,
    densityKgM3: number,
    thicknessMm: number,
    kerfMm: number,
    edgeMarginMm: number,
    userId: string,
    accessToken: string,
    sheet: NestingSheet,
    summary: any,
  ): Promise<{ selection: TrueNestCostingSelection; reason?: undefined } | { selection: null; reason: string }> {
    const missing = blanks.map((b, i) => (b.outlinePointsMm && b.outlinePointsMm.length >= 3 ? null : i + 1)).filter((i): i is number => i !== null);
    if (missing.length > 0) {
      return { selection: null, reason: `this part is cut from ${blanks.length} blanks and blank ${missing.join(', ')} has no flat-pattern outline -- re-run Reanalyze` };
    }
    const inputFingerprint = blanks
      .map((b) => trueNestInputFingerprint({ outlinePointsMm: b.outlinePointsMm!, holesMm: b.holesMm, thicknessMm, densityKgM3, netWeightKg }))
      .join('+');
    const cache = summary?.trueNestCostingCache;
    if (isTrueNestCostingCacheValid(cache, kerfMm, edgeMarginMm, inputFingerprint, sheet)) {
      return {
        selection: {
          sheetWidthMm: cache.sheetWidthMm, sheetLengthMm: cache.sheetLengthMm,
          partsPerSheet: cache.partsPerSheet, sheetWeightKg: cache.sheetWeightKg,
          grossWeightPerPartKg: cache.grossWeightPerPartKg, utilisationPct: cache.utilizationPct,
        },
      };
    }
    const flightKey = `${itemId}|${inputFingerprint}|${kerfMm}|${edgeMarginMm}|${sheet.widthMm}x${sheet.lengthMm}`;
    const inFlight = this.trueNestInFlight.get(flightKey);
    if (inFlight) return inFlight;

    const flight = (async (): Promise<{ selection: TrueNestCostingSelection; reason?: undefined } | { selection: null; reason: string }> => {
      const perBlank: number[] = [];
      for (const [i, b] of blanks.entries()) {
        const { result, reason } = await this.cadAnalysisService.computeTrueNest({
          outlinePointsMm: b.outlinePointsMm!, holesMm: this.toNestHoles(b.holesMm),
          sheetWidthMm: sheet.widthMm, sheetLengthMm: sheet.lengthMm, quantity: 1, kerfMm, edgeMarginMm,
        });
        if (!result || result.partsPerSheet <= 0) {
          return { selection: null, reason: `true-shape nest failed for blank ${i + 1} of ${blanks.length} on the ${sheet.widthMm}x${sheet.lengthMm}mm sheet -- ${reason}` };
        }
        perBlank.push(result.partsPerSheet);
      }
      const sheetWeightKg = (sheet.widthMm * sheet.lengthMm * thicknessMm / 1e9) * densityKgM3;
      const best = combineBlankNests({ sheetWidthMm: sheet.widthMm, sheetLengthMm: sheet.lengthMm, sheetWeightKg }, perBlank, netWeightKg);
      if (!best) {
        return { selection: null, reason: `a set of this part's ${blanks.length} blanks needs more than one ${sheet.widthMm}x${sheet.lengthMm}mm sheet` };
      }
      await this.persistTrueNestCostingCache(itemId, best, kerfMm, edgeMarginMm, inputFingerprint, userId, accessToken, TRUE_NEST_CACHE_KEY);
      this.logger.log(
        `[true-nest-costing] ${blanks.length} blanks on ${best.sheetWidthMm}x${best.sheetLengthMm}mm: ${perBlank.join('+')} per sheet, ` +
        `${best.partsPerSheet} sets/sheet, ${best.utilisationPct}% utilization for item ${itemId}`,
      );
      return { selection: best };
    })().finally(() => this.trueNestInFlight.delete(flightKey));
    this.trueNestInFlight.set(flightKey, flight);
    return flight;
  }

  /** Stores the selected true-shape nest on the item (under `cacheKey`), so every later request with the same inputs gets the same answer. */
  private async persistTrueNestCostingCache(
    itemId: string,
    best: TrueNestCostingSelection,
    kerfMm: number,
    edgeMarginMm: number,
    inputFingerprint: string,
    userId: string,
    accessToken: string,
    cacheKey: string,
  ): Promise<void> {
    const fresh = await this.items.findOne(itemId, userId, accessToken);
    const freshFg = (fresh.featureGraph as any) ?? {};
    const freshSummary = freshFg.summary ?? {};
    await this.items.update(itemId, {
      featureGraph: {
        ...freshFg,
        summary: {
          ...freshSummary,
          [cacheKey]: {
            sheetWidthMm: best.sheetWidthMm, sheetLengthMm: best.sheetLengthMm,
            kerfMm, edgeMarginMm,
            partsPerSheet: best.partsPerSheet, utilizationPct: best.utilisationPct,
            sheetWeightKg: best.sheetWeightKg, grossWeightPerPartKg: best.grossWeightPerPartKg,
            cachedAt: new Date().toISOString(),
            inputFingerprint,
          },
        },
      },
    }, userId, accessToken);
  }

  /** In-flight true-shape nest resolutions, shared by concurrent callers. */
  private readonly trueNestInFlight = new Map<
    string,
    Promise<{ selection: TrueNestCostingSelection; reason?: undefined } | { selection: null; reason: string }>
  >();

  /** The expensive half of resolveTrueShapeNestCosting — see its doc comment. */
  private async computeTrueShapeNestCosting(
    itemId: string,
    netWeightKg: number,
    densityKgM3: number,
    thicknessMm: number,
    kerfMm: number,
    edgeMarginMm: number,
    userId: string,
    accessToken: string,
    outlinePointsMm: number[][],
    rawHolesMm: unknown,
    inputFingerprint: string,
    sheet: NestingSheet,
    cacheKey: string,
  ): Promise<{ selection: TrueNestCostingSelection; reason?: undefined } | { selection: null; reason: string }> {
    const holesMm = this.toNestHoles(rawHolesMm);

    // Evaluate EVERY viable candidate sheet -- sequentially (cad-engine's
    // /nest endpoint is not thread-pool-wrapped, see cad-engine/main.py, so
    // concurrent calls would serialize on its single event loop anyway) and
    // synchronously (this request blocks until the full comparison is done
    // -- see this method's own doc comment for why that's correct here).
    const candidates: TrueNestCandidate[] = [];
    const perCandidateReasons: string[] = [];
    for (const { widthMm: w, lengthMm: l } of [sheet]) {
      const { result, reason } = await this.cadAnalysisService.computeTrueNest({
        outlinePointsMm, holesMm, sheetWidthMm: w, sheetLengthMm: l,
        quantity: 1, // partsPerSheet/utilization are quantity-independent -- see nesting.py
        kerfMm, edgeMarginMm,
      });
      if (result && result.partsPerSheet > 0) {
        const sheetWeightKg = (w * l * thicknessMm / 1e9) * densityKgM3;
        candidates.push({ sheetWidthMm: w, sheetLengthMm: l, partsPerSheet: result.partsPerSheet, sheetWeightKg });
      } else {
        perCandidateReasons.push(`${w}x${l}mm: ${reason}`);
      }
    }

    const best = selectBestTrueNestCandidate(candidates, netWeightKg);
    if (!best) {
      return {
        selection: null,
        reason: `true-shape nest failed on the ${sheet.widthMm}x${sheet.lengthMm}mm sheet -- ${perCandidateReasons.join('; ')}`,
      };
    }

    // Persist BEFORE returning -- this is what makes the result
    // deterministic for every subsequent request, not just an optimization.
    await this.persistTrueNestCostingCache(itemId, best, kerfMm, edgeMarginMm, inputFingerprint, userId, accessToken, cacheKey);
    this.logger.log(
      `[true-nest-costing] selected ${best.sheetWidthMm}x${best.sheetLengthMm}mm: ${best.partsPerSheet} parts/sheet, ` +
      `${best.utilisationPct}% utilization for item ${itemId}`,
    );
    return { selection: best };
  }

  // The single exact wording surfaced to the user (RawMaterialDialog's
  // "Gross Usage" calculator panel) whenever true-shape nesting genuinely
  // can't run -- never a rectangle-grid number or a scrap%-derived guess
  // dressed up as this calculator's own result. getCostSummary()'s separate,
  // pre-existing rectangle-grid fallback (nestingMethod:
  // 'rectangle_grid_fallback') is untouched and remains its own, differently
  // labeled path -- this calculator represents the true-shape half only.
  static readonly GROSS_USAGE_GAP_REASON =
    'Unable to calculate true-shape gross usage — verified flat pattern required';
  static readonly NO_SHEET_GAP =
    'No stock sheet on file — the selected laser has no nominal sheet size in the machine library and ' +
    'standardSheetWidth/standardSheetLength are missing from sm_reference_data.';
  static readonly PART_TOO_LARGE_FOR_SHEET =
    'The flat pattern does not fit the stock sheet in either orientation: material is costed as one part per whole sheet, not a nest.';
  static readonly PART_SPACING_GAP =
    `Nesting part spacing not staged: tblPartSpacing (migration 518) has no ${GROSS_USAGE_SPACING_PROCESS} row`;

  /**
   * "Sheet Metal - Gross Material Usage (Nesting)" calculator's physics_key
   * implementation -- called from both evaluateCalculatorFields() (the
   * cost-engine/getCostSummary path, via resolvePhysicsQuantity) and
   * CalculatorsServiceV2.execute() (the interactive "Calculate" button in
   * RawMaterialDialog). Both paths share this single implementation so they
   * can never drift. Inputs are the calculator's own editable field_names
   * (Thickness, Shear Strength, Net Weight Per Part, Material Density, Edge
   * Allowance, Batch Quantity) -- the real flat-pattern outline is NOT one
   * of them (see the calculator's own field-verification notes): it's read
   * here directly off the bound BOM item's stored CAD summary, since a
   * polygon outline isn't a value a calculator form can hold as a scalar.
   */
  async resolveGrossUsageForCalculator(
    inputValues: Record<string, any>,
    ctx: { itemId?: string; userId: string; accessToken: string },
  ): Promise<Record<string, any>> {
    const GAP_REASON = NestingCostService.GROSS_USAGE_GAP_REASON;
    if (!ctx.itemId) return { _gapReason: GAP_REASON };

    const thicknessMm = Number(inputValues['Thickness'] ?? 0);
    // 'Shear Strength' is no longer consumed here — nesting spacing now uses
    // a fixed laser-based default (closeout Plan Phase 3, see
    // computePartAllowanceMm's own doc comment) instead of the old shear-
    // strength-scaled formula. Flagged, not silently dropped: this input
    // field is still configured on the Gross Usage calculator and now has
    // no real consumer — see feedback_calculator_input_honesty.
    const netWeightKg = Number(inputValues['Net Weight Per Part'] ?? 0);
    const densityKgM3 = Number(inputValues['Material Density'] ?? 0);
    const edgeMarginMm = inputValues['Edge Allowance'] != null ? Number(inputValues['Edge Allowance']) : EDGE_ALLOWANCE_MM;
    const batchQuantity = inputValues['Batch Quantity'] != null ? Number(inputValues['Batch Quantity']) : undefined;
    if (thicknessMm <= 0 || netWeightKg <= 0 || densityKgM3 <= 0) {
      return { _gapReason: GAP_REASON };
    }

    const item = await this.items.findOne(ctx.itemId, ctx.userId, ctx.accessToken);
    const summary = ((item.featureGraph as any)?.summary) ?? {};

    const kerfMm = computePartAllowanceMm(await this.smLookup.getPartSpacingTable(), thicknessMm);
    if (kerfMm == null) return { _gapReason: GAP_REASON, _internalReason: NestingCostService.PART_SPACING_GAP };
    // The sheet: handed in by the cost engine (the selected laser's sheet);
    // opened interactively, the sheet this part was last costed on; else the
    // standard sheet.
    const cached = summary?.trueNestCostingCache;
    const sheet: NestingSheet | null =
      Number(inputValues['Sheet Width']) > 0 && Number(inputValues['Sheet Length']) > 0
        ? { widthMm: Number(inputValues['Sheet Width']), lengthMm: Number(inputValues['Sheet Length']) }
        : cached?.sheetWidthMm > 0 && cached?.sheetLengthMm > 0
          ? { widthMm: cached.sheetWidthMm, lengthMm: cached.sheetLengthMm }
          : await this.resolveNestingSheet(null);
    if (!sheet) return { _gapReason: GAP_REASON, _internalReason: NestingCostService.NO_SHEET_GAP };
    const trueShape = await this.resolveTrueShapeNestCosting(
      ctx.itemId, summary, netWeightKg, densityKgM3, thicknessMm,
      kerfMm, edgeMarginMm, ctx.userId, ctx.accessToken, sheet, (item.featureGraph as any)?.classification,
    );
    if (!trueShape.selection) {
      return { _gapReason: GAP_REASON, _internalReason: trueShape.reason };
    }

    const best = trueShape.selection;
    const scrapWeightPerPartKg = Math.max(0, best.grossWeightPerPartKg - netWeightKg);
    const result: Record<string, any> = {
      'Nest Method': 'True Shape',
      'Part To Part Allowance': Math.round(kerfMm * 100) / 100,
      'Selected Sheet Width': best.sheetWidthMm,
      'Selected Sheet Length': best.sheetLengthMm,
      'Parts Per Sheet': best.partsPerSheet,
      'Sheet Weight': Math.round(best.sheetWeightKg * 1000) / 1000,
      'Gross Weight Per Part': Math.round(best.grossWeightPerPartKg * 1000) / 1000,
      'Scrap Weight Per Part': Math.round(scrapWeightPerPartKg * 1000) / 1000,
      'Utilisation': best.utilisationPct,
    };
    if (typeof batchQuantity === 'number' && batchQuantity > 0) {
      const sheetsRequired = Math.ceil(batchQuantity / best.partsPerSheet);
      result['Sheets Required'] = sheetsRequired;
      result['Planned Parts'] = best.partsPerSheet * sheetsRequired;
      result['Excess Positions'] = best.partsPerSheet * sheetsRequired - batchQuantity;
      result['Actual Batch Gross Material'] = Math.round(sheetsRequired * best.sheetWeightKg * 1000) / 1000;
    }
    return result;
  }

  /**
   * True (real polygon) 2D nesting placement -- visualization only, NOT a
   * material-cost source (see true-nest.dto.ts's own header comment).
   * Deliberately a separate, on-demand endpoint from getCostSummary above
   * (which is already a synchronous 14-40s-observed path with no job-queue
   * safety net) -- called only when the Nest view is actually opened, never
   * on page load or bundled into costing.
   *
   * Real flat-pattern outline/hole geometry comes from item.featureGraph.summary
   * (the exact same object populated by auto-fill.service.ts's
   * flatPatternOutlinePointsMm/flatPatternHolesMm/flatPatternOutlineSource --
   * see that file for how cad-engine's wire-walk result lands here). Returns
   * { result: null, reason } (never a fabricated layout) when that geometry
   * isn't available for this part, or cad-engine couldn't compute a nest for
   * it -- `reason` is always a specific, truthful diagnostic, never a
   * generic placeholder, so the controller can surface exactly which stage
   * of the pipeline (missing outline vs. cad-engine's own nest failure)
   * declined rather than collapsing both into one message.
   */
  async getTrueNest(
    id: string,
    userId: string,
    accessToken: string,
    quantity: number,
    sheetWidthMm: number,
    sheetLengthMm: number,
    kerfMm?: number,
    edgeMarginMm?: number,
    // Which blank to nest when the part is cut from several (one per solid body); 0 for an ordinary part.
    blankIndex = 0,
  ): Promise<{ result: TrueNestResultDto | null; reason: string }> {
    const item = await this.items.findOne(id, userId, accessToken);
    const fg = item.featureGraph as any;
    const summary = fg?.summary ?? {};

    // Why the analysis has no outline, said with whatever is nested instead. When the user's chosen process and the geometry disagree, that is
    // the reason (a machined part has no flat pattern).
    const conflict = processChoiceConflict(fg?.classification);
    const whyNoOutline = conflict
      ? `No flat pattern for this part: ${conflict}`
      : summary.flatPatternOutlineSource === 'unavailable'
        ? "The flat pattern's outline could not be built on the last analysis (the unfold's boundary did not close or did not reconcile)."
        : 'No flat-pattern outline is stored for this part.';
    const hf = (item.scenarioOverrides as Record<string, unknown> | null | undefined)?.processGroup === 'Sheet Metal - Hydroforming'
      ? summary.hydroformGeometry?.blank : null;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const blanks: FlatPatternBlank[] | undefined = Array.isArray(summary.flatPatternBlanks) && summary.flatPatternBlanks.length > 1
      ? summary.flatPatternBlanks : undefined;
    const choice = chooseNestBlank({
      blanks, blankIndex,
      flatOutline: summary.flatPatternOutlinePointsMm, flatHoles: this.toNestHoles(summary.flatPatternHolesMm),
      flatRect: { lengthMm: num(summary.flatPatternBoundingLengthMm), widthMm: num(summary.flatPatternBoundingWidthMm) },
      hydroformBlank: hf ? { outline: hf.outline_points_mm ?? null, lengthMm: num(hf.length_mm), widthMm: num(hf.width_mm) } : null,
      partSizesMm: [num(item.maxLength), num(item.maxWidth), num(item.maxHeight)],
      whyNoOutline,
    });
    if (!choice) return { result: null, reason: `${whyNoOutline} The part has no measured size either, so there is nothing to nest: press Refresh analysis.` };

    const { outlinePointsMm, holesMm } = choice;
    const { result: cadResult, reason: cadReason } = await this.cadAnalysisService.computeTrueNest({
      outlinePointsMm,
      holesMm,
      sheetWidthMm,
      sheetLengthMm,
      quantity,
      kerfMm,
      edgeMarginMm,
    });
    const common = { holesMm, outlineSource: choice.source, blankIndex: choice.blankIndex, blankCount: choice.blankCount };
    if (!cadResult) {
      // The view still shows a nest: the blank on a grid of its rectangle, and why.
      const grid = gridNest(outlinePointsMm, sheetWidthMm, sheetLengthMm, kerfMm ?? 0, edgeMarginMm ?? 0, quantity);
      return {
        result: {
          ...common, holesMm: [], outlinePointsMm: grid.outlinePointsMm, sheetWidthMm, sheetLengthMm, partsPerSheet: grid.partsPerSheet,
          placements: grid.placements, utilizationPct: grid.utilizationPct, sheetsRequired: grid.sheetsRequired, capped: grid.capped,
          placementSource: 'rectangle_grid',
          outlineNote: [choice.note, `The cad-engine could not nest it (${cadReason}), so it is placed on a grid of its rectangle.`].filter(Boolean).join(' '),
        },
        reason: '',
      };
    }

    return {
      result: {
        ...common,
        outlinePointsMm,
        sheetWidthMm: cadResult.sheetWidthMm,
        sheetLengthMm: cadResult.sheetLengthMm,
        partsPerSheet: cadResult.partsPerSheet,
        placements: cadResult.placements,
        utilizationPct: cadResult.utilizationPct,
        sheetsRequired: cadResult.sheetsRequired,
        capped: cadResult.capped,
        outlineNote: choice.note,
        placementSource: 'cad_engine',
      },
      reason: '',
    };
  }

}
