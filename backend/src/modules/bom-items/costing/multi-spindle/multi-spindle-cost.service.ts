import { Injectable } from '@nestjs/common';

import { loadMultiSpindleCalculatorSpec } from './calculators/multi-spindle-calculator-spec';
import { quoteMultiSpindle, type MultiSpindleMaterial, type MultiSpindlePart, type MultiSpindleQuote } from './multi-spindle-quote';
import {
  MULTI_SPINDLE_MACHINE_CLASS, MULTI_SPINDLE_MACHINE_COLUMNS, MULTI_SPINDLE_PROCESS_GROUP, MULTI_SPINDLE_ROUTES,
  type MultiSpindleRouteKey, type SplitRule, type SplitRules,
} from './multi-spindle-route';
import { multiSpindleStockReference, selectBar, unitSystemFor, type BarForm, type SelectedBar } from './multi-spindle-stock';
import { DatabaseService } from '../../../../common/database/database.service';
import { CalculatorCatalogService } from '../../services/calculator-catalog.service';
import { SandMachineService } from '../casting/sand/sand-machine.service';
import { readStagedReference } from '../casting/sand/sand-reference.service';
import { MachiningLookupService } from '../machining/lookup/machining-lookup.service';
import {
  computeDrillCycle, computeTapCycle, computeTurningCostSummary, detectMaterialClass, type MachineClassId, type MachiningCostInput,
} from '../machining/process/cost-machining-engine';


import type { HoleGroupWork, ThreadGroupWork } from './multi-spindle-work';
import type { DbClient } from '../../../../common/db/postgrest-client';
import type { CostContext } from '../casting/casting-finishing';
import type { SandReference } from '../casting/sand/sand-reference';
import type { LiveToolHole } from '../machining/capability/live-tooling';
import type { MHRRateInput } from '../shared/core/cost-engine';

const SOURCE_VERSION = '2026-Multi-Spindle';

/** The Cost Guide key of a Multi-Spindle Machining part: the route set by hand (6, 8, twin). */
export const MULTI_SPINDLE_ROUTE_KEY = 'multiSpindleRoute';

/** The scenario stock forms a multi-spindle's bar feeder takes, as the bar's form. */
export const BAR_FORM_OF_STOCK: Readonly<Record<string, BarForm>> = { round_bar: 'round', hex_bar: 'hex', square_bar: 'square' };

/** A hole diameter of the hole groups and of the live-tool holes is the same hole within this (mm): both are the CAD engine's, rounded alike. */
const SAME_DIAMETER_MM = 0.05;

/** The part's size across its turning axis the bar is sized from: the turned diameter; for hex bar the across flats, for square bar the side (the box's sides across the axis). */
export function partOutsideMm(form: BarForm, turned: { diameterMm: number; lengthMm: number }, boxSidesMm: readonly number[]): number {
  if (form === 'round') return turned.diameterMm;
  const axis = boxSidesMm.reduce((best, d, i) => (Math.abs(d - turned.lengthMm) < Math.abs(boxSidesMm[best] - turned.lengthMm) ? i : best), 0);
  const across = boxSidesMm.filter((_, i) => i !== axis);
  return across.length ? (form === 'hex' ? Math.min(...across) : Math.max(...across)) : 0;
}

/**
 * The part's hole groups, each timed by the drilling calculator (computeDrillCycle, as the turning engine times them): its holes a live tool
 * drills (cross and off-axis, by diameter) apart from those drilled on the turning axis. The holes drilled are the groups', as the turning
 * engine's: the live-tool holes only say which slide drills them.
 */
export function timeHoleGroups(input: {
  groups: MachiningCostInput['holeGroups'];
  liveHoles: readonly LiveToolHole[];
  drill: (diameterMm: number, depthMm: number | null, holes: number, occurrences?: MachiningCostInput['holeGroups'][number]['occurrences']) => { sec: number | null; missing: string[] };
}): HoleGroupWork[] {
  const live = input.liveHoles.map((h) => ({ diameterMm: h.diameterMm, left: h.count }));
  const take = (diameterMm: number, count: number) => {
    let taken = 0;
    for (const h of live) {
      if (taken >= count || Math.abs(h.diameterMm - diameterMm) > SAME_DIAMETER_MM) continue;
      const n = Math.min(h.left, count - taken);
      h.left -= n;
      taken += n;
    }
    return taken;
  };
  const timed = (diameterMm: number, depthMm: number | null, endCount: number, liveCount: number, occurrences?: MachiningCostInput['holeGroups'][number]['occurrences']): HoleGroupWork => {
    const end = endCount > 0 ? input.drill(diameterMm, depthMm, endCount, liveCount === 0 ? occurrences : undefined) : { sec: 0, missing: [] };
    const tool = liveCount > 0 ? input.drill(diameterMm, depthMm, liveCount, endCount === 0 ? occurrences : undefined) : { sec: 0, missing: [] };
    return { diameterMm, depthMm, endCount, endSec: end.sec ?? 0, liveCount, liveSec: tool.sec ?? 0, missing: [...end.missing, ...tool.missing] };
  };
  return input.groups.filter((g) => g.diameter_mm > 0 && g.count > 0).map((g) => {
    const liveCount = take(g.diameter_mm, g.count);
    return timed(g.diameter_mm, g.depth_mm ?? null, g.count - liveCount, liveCount, g.occurrences);
  });
}

/**
 * The part's threads, each size timed by the tapping calculator (computeTapCycle, as the turning engine taps them): those off the turning
 * centreline (liveCount, feature-holes.ts) with a live tool, the others from an end slide.
 */
export function timeThreadGroups(input: {
  threads: MachiningCostInput['threads'];
  tap: (thread: MachiningCostInput['threads'][number], count: number) => { sec: number | null; missing: string[] };
}): ThreadGroupWork[] {
  return input.threads.filter((t) => t.count > 0).map((t) => {
    const liveCount = Math.min(t.count, Math.max(0, t.liveCount ?? 0));
    const endCount = t.count - liveCount;
    const end = endCount > 0 ? input.tap(t, endCount) : { sec: 0, missing: [] };
    const tool = liveCount > 0 ? input.tap(t, liveCount) : { sec: 0, missing: [] };
    return { size: t.size, endCount, endSec: end.sec ?? 0, liveCount, liveSec: tool.sec ?? 0, missing: [...end.missing, ...tool.missing] };
  });
}

export interface MultiSpindleCostRequest {
  client: DbClient;
  accessToken: string;
  location: string;
  /** The turning engine's input for the part (the machining branch's); this service sets its bar. */
  turning: Omit<MachiningCostInput, 'mhrRate' | 'tappingRate'>;
  /** The rates the operation times are run with (the machine's own rates price the route; these only time the operations). */
  turningRate: MHRRateInput;
  tappingRate: MHRRateInput;
  /** The holes a live tool drills (live-tooling.ts liveToolHoles). */
  liveHoles: readonly LiveToolHole[];
  form: BarForm;
  material: MultiSpindleMaterial;
  /** A route to price instead of the chosen one (the route comparison prices each). */
  forceRoute?: string;
  overrides: Record<string, unknown> | null | undefined;
  batchSize: number;
  /** USD -> the location's currency. */
  usdToLocal: number;
  costContext: CostContext;
}

export interface MultiSpindleCostResult {
  /** The routes and the quoted one, in the location's currency; null when the part cannot be priced (see `missing`). */
  quote: MultiSpindleQuote | null;
  bar: SelectedBar | null;
  part: MultiSpindlePart | null;
  missing: string[];
  warnings: string[];
}

/**
 * Prices a Multi-Spindle Machining part: loads the staged bar stock data, the calculators (from the database), the location's multi-spindles
 * and the op-splitting rules, picks the bar, times the operations with the turning engine on it and prices every route (multi-spindle-quote.ts).
 */
@Injectable()
export class MultiSpindleCostService {
  constructor(
    private readonly database: DatabaseService,
    private readonly machines: SandMachineService,
    private readonly catalog: CalculatorCatalogService,
    private readonly lookup: MachiningLookupService,
  ) {}

  private cached: SandReference | null = null;
  private rules: SplitRules | null = null;

  /** The staged memory/Multi-Spindle Maching variables and lookup tables (read once; a read error is reported and not cached). */
  async reference(): Promise<{ reference: SandReference | null; missing: string[] }> {
    if (this.cached) return { reference: this.cached, missing: [] };
    const read = await readStagedReference(this.database, SOURCE_VERSION, MULTI_SPINDLE_PROCESS_GROUP, 787);
    if (read.reference) this.cached = read.reference;
    return read;
  }

  /** The tblMultiSpindleOpSplitting rules for the routes' spindle counts (read once). */
  async splitRules(): Promise<SplitRules> {
    if (this.rules) return this.rules;
    const pairs = [['Ring', 'Rough Turning'], ['SimpleHole', 'Drilling']] as const;
    const counts = [...new Set(MULTI_SPINDLE_ROUTES.map((r) => r.spindles))];
    const found = await Promise.all(pairs.flatMap(([feature, operation]) => counts.map(async (spindles) => {
      const s = await this.lookup.getMultiSpindleOpSplit(feature, operation, spindles);
      const rule: SplitRule | null = s.dataFound && s.thresholdRatio != null ? { passes: s.numberOfOperations, threshold: s.thresholdRatio } : null;
      return [`${feature}|${operation}|${spindles}`, rule] as const;
    })));
    const byKey = new Map<string, SplitRule | null>(found);
    const rules: SplitRules = (feature, operation, spindles) => byKey.get(`${feature}|${operation}|${spindles}`) ?? null;
    this.rules = rules;
    return rules;
  }

  async price(req: MultiSpindleCostRequest): Promise<MultiSpindleCostResult> {
    const none = (bar: SelectedBar | null, part: MultiSpindlePart | null, ...missing: string[]): MultiSpindleCostResult => ({ quote: null, bar, part, missing, warnings: [] });
    const turned = req.turning.turnedGeometry;
    if (!turned) return none(null, null, 'the part\'s turned diameter and length (press Refresh analysis so the part is measured)');
    const part: MultiSpindlePart = {
      lengthMm: turned.lengthMm, volumeMm3: req.turning.volume, turnedDiameterMm: turned.diameterMm, turnedLengthMm: turned.lengthMm,
    };
    const [{ reference, missing: refMissing }, calculators, byClass, rules] = await Promise.all([
      this.reference(),
      this.catalog.loadMultiSpindleCalculators(req.accessToken),
      this.machines.getMachinesByClass(req.client, [MULTI_SPINDLE_MACHINE_CLASS], req.location, MULTI_SPINDLE_MACHINE_COLUMNS),
      this.splitRules(),
    ]);
    if (!reference) return none(null, part, ...refMissing);
    const { reference: stockRef, missing: stockMissing } = multiSpindleStockReference(reference);
    if (!stockRef) return none(null, part, ...stockMissing);
    const spec = loadMultiSpindleCalculatorSpec();
    const absent = spec.calculators.filter((c) => !calculators[c.name]).map((c) => c.name);
    if (absent.length) return none(null, part, `the Multi-Spindle Machining calculators are not in the database (run migration 1095): ${absent.join(', ')}`);
    const machines = byClass[MULTI_SPINDLE_MACHINE_CLASS] ?? [];
    if (machines.length === 0) return none(null, part, `HR Rates has no multi-spindle machines (class ${MULTI_SPINDLE_MACHINE_CLASS}) for ${req.location}`);

    const outsideMm = partOutsideMm(req.form, turned, [req.turning.maxLength, req.turning.maxWidth, req.turning.maxHeight]);
    const bar = selectBar({ outsideMm, form: req.form, lengthMm: part.lengthMm }, stockRef, unitSystemFor(req.location));
    if ('missing' in bar) return none(null, part, bar.missing);

    // The operation times: the turning engine on this bar, raw (the station plan replaces its split, the cycle calculator its index line).
    const engine = computeTurningCostSummary({
      ...req.turning,
      mhrRate: { ...req.turningRate, numberSpindles: null },
      tappingRate: req.tappingRate,
      roughTurningOpSplit: null,
      blankResult: {
        form: `${bar.form}_bar`, sizeLabel: bar.sizeLabel, billetVolMm3: bar.sectionAreaMm2 * (part.lengthMm + bar.facingStockMm),
        utilizationPct: null, barDiameterMm: bar.circumscribedMm,
      },
    }, MULTI_SPINDLE_MACHINE_CLASS as MachineClassId);
    const holes = timeHoleGroups({
      groups: req.turning.holeGroups, liveHoles: req.liveHoles,
      drill: (d, depth, n, occurrences) => computeDrillCycle(d, req.turning.materialGrade, depth, req.turning.drillingTable, req.turning.machiningCalculators, n, occurrences),
    });
    const matClass = detectMaterialClass(req.turning.materialGrade);
    const threads = timeThreadGroups({
      threads: req.turning.threads,
      tap: (t, count) => computeTapCycle({ ...t, count }, matClass, req.turning.tappingTable, req.turning.machiningCalculators),
    });

    const keyOf = (v: unknown): MultiSpindleRouteKey | null => MULTI_SPINDLE_ROUTES.find((r) => r.key === v)?.key ?? null;
    const quote = quoteMultiSpindle({
      ref: reference, spec, calculators, machines, rules, bar, part, material: req.material,
      engine: { lines: engine.processLines, holes, threads }, chosen: keyOf(req.forceRoute) ?? keyOf(req.overrides?.[MULTI_SPINDLE_ROUTE_KEY]),
      batchSize: req.batchSize, costContext: req.costContext, usdToLocal: req.usdToLocal,
    });
    return { quote, bar, part, missing: [], warnings: [...new Set([...engine.warnings, ...quote.warnings])] };
  }
}
