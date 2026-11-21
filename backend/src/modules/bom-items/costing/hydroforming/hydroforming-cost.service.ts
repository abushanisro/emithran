import { Injectable } from '@nestjs/common';

import { loadHydroformingCalculatorSpec } from './calculators/hydroforming-calculator-spec';
import { hydroformPart, type HydroformGeometrySummary, type HydroformPart } from './hydroforming-part';
import {
  blankAddendum, buildHydroformingRoutes, chooseHydroformingRoute, hydroformingRule, HYDROFORMING_CLASS, HYDROFORMING_KEYS, HYDROFORMING_PROCESS_GROUP,
  HYDROFORMING_ROUTE_CLASSES, HYDROFORMING_ROUTES, sheetMeasure, type HydroformingMaterial, type HydroformingNest, type HydroformingRoute, type HydroformingRouteKey,
  type HydroformingRule,
} from './hydroforming-route';

import { DatabaseService } from '../../../../common/database/database.service';
import { CalculatorCatalogService } from '../../services/calculator-catalog.service';
import { NestingCostService } from '../../services/nesting-cost.service';
import { CastingReferenceService } from '../casting/casting-reference.service';
import { lineToLocal } from '../casting/sand/sand-cost';
import { SandMachineService } from '../casting/sand/sand-machine.service';
import { readStagedReference } from '../casting/sand/sand-reference.service';

import type { HydroformGraphFeature } from './hydroforming-features';
import type { DbClient } from '../../../../common/db/postgrest-client';
import type { CostContext } from '../casting/casting-finishing';
import type { SandReference } from '../casting/sand/sand-reference';

const SOURCE_VERSION = '2026-Hydroform';
/** The summary key the true-shape nest of a hydroform blank is cached under (its own: the flat pattern's nest is trueNestCostingCache). */
export const HYDROFORM_NEST_CACHE_KEY = 'hydroformNestCostingCache';

export interface HydroformingCostRequest {
  client: DbClient;
  accessToken: string;
  itemId: string;
  userId: string;
  location: string;
  material: HydroformingMaterial;
  thicknessMm: number;
  geometry: HydroformGeometrySummary | null | undefined;
  /** The part's volume (mm³): how much of it is the sheet measured (sheetMeasure). */
  partVolumeMm3?: number | null;
  /** The part's feature graph features (feature_graph_v2.features): what each step's catalog rows name and highlight. */
  graphFeatures?: readonly HydroformGraphFeature[];
  /** The part's feature_graph.summary: where the blank's nest is cached. */
  summary: Record<string, unknown>;
  forceRoute?: string;
  overrides: Record<string, unknown> | null | undefined;
  batchSize: number;
  amortizationParts: number | null;
  /** USD -> the location's currency. */
  usdToLocal: number;
  costContext: CostContext;
}

export interface HydroformingCostResult {
  /** The quoted route in the location's currency; null when none can be built (see `missing`). */
  route: HydroformingRoute | null;
  routes: HydroformingRoute[];
  rule: HydroformingRule | null;
  part: HydroformPart | null;
  nest: HydroformingNest | null;
  note: string | null;
  missing: string[];
  warnings: string[];
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** One route in the location's currency (it is built in USD, the units of HR Rates and the reference data); its tooling stays in USD. */
function routeToLocal(route: HydroformingRoute, usdToLocal: number): HydroformingRoute {
  if (usdToLocal === 1) return route;
  return {
    ...route,
    lines: route.lines.map((l) => lineToLocal(l, usdToLocal)),
    material: { ...route.material, costUsd: route.material.costUsd * usdToLocal },
    totalUsd: route.totalUsd != null ? r2(route.totalUsd * usdToLocal) : null,
  };
}

/**
 * The blanks a sheet holds when they are nested as rectangles (each the blank's length and width), in the better orientation: the fallback
 * when the true-shape nest cannot run (no outline, or the nester unavailable), disclosed.
 */
export function rectangleNest(sheet: { lengthMm: number; widthMm: number }, blank: { lengthMm: number; widthMm: number }, kerfMm: number, edgeMm: number): number {
  const fit = (room: number, size: number) => Math.max(0, Math.floor((room - 2 * edgeMm + kerfMm) / (size + kerfMm)));
  return Math.max(
    fit(sheet.lengthMm, blank.lengthMm) * fit(sheet.widthMm, blank.widthMm),
    fit(sheet.lengthMm, blank.widthMm) * fit(sheet.widthMm, blank.lengthMm),
  );
}

/**
 * Prices a hydroformed sheet-metal part: loads the staged memory/Sheetmetal Hydroforming reference, the calculators (from the database), the
 * machines of the location and the tool shop, nests the blank on the standard sheet, builds both routes (hydroforming-route.ts) and returns
 * them in the location's currency.
 */
@Injectable()
export class HydroformingCostService {
  constructor(
    private readonly database: DatabaseService,
    private readonly machines: SandMachineService,
    private readonly catalog: CalculatorCatalogService,
    private readonly castingReference: CastingReferenceService,
    private readonly nesting: NestingCostService,
  ) {}

  private cached: SandReference | null = null;
  private cachedOperations: string[] | null = null;

  /**
   * Memory's catalog of the Offline Blank and the Hydroform (process_taxonomy_operations, staged from memory/Sheetmetal Hydroforming/
   * operations): the operation each step performs on each feature. Kept once read; a failed or empty read is not kept (the rows are then
   * not shown, and costing is unchanged).
   */
  private async operationCatalog(client: DbClient): Promise<string[]> {
    if (this.cachedOperations) return this.cachedOperations;
    const { data, error } = await client.from('process_taxonomy')
      .select('process_name, process_taxonomy_operations(raw_compound_string)')
      .eq('process_group', HYDROFORMING_PROCESS_GROUP).in('process_name', ['Offline Blank', 'Hydroform']);
    if (error) return [];
    const rows = data as { process_taxonomy_operations?: { raw_compound_string?: string | null }[] | null }[];
    const raw = rows.flatMap((r) => (r.process_taxonomy_operations ?? []).map((o) => o.raw_compound_string ?? '').filter(Boolean));
    if (raw.length) this.cachedOperations = raw;
    return raw;
  }

  /** The staged memory/Sheetmetal Hydroforming variables and lookup tables (read once; a read error is reported and not cached). */
  async reference(): Promise<{ reference: SandReference | null; missing: string[] }> {
    if (this.cached) return { reference: this.cached, missing: [] };
    const read = await readStagedReference(this.database, SOURCE_VERSION, HYDROFORMING_PROCESS_GROUP, 823);
    if (read.reference) this.cached = read.reference;
    return read;
  }

  /**
   * The blank nested on memory's standard sheet (standardSheetLength x standardSheetWidth), true-shape as defaultUtilizationMethod TRUE_PART
   * asks: blanks defaultSheetStockPartSpacing apart and defaultEdgeMarginWidthMultiplier x t from the edge; the addendum grows each outline,
   * which is the spacing and the margin grown by it. A rectangular nest when the true-shape one cannot run, said.
   */
  private async nest(req: HydroformingCostRequest, ref: SandReference, part: HydroformPart): Promise<HydroformingNest | null> {
    const density = req.material.densityKgM3;
    const length = ref.number('standardSheetLength');
    const width = ref.number('standardSheetWidth');
    if (density == null || !(density > 0) || length == null || width == null) return null;
    const addendum = blankAddendum(ref, part).mm;
    const spacing = ref.number('defaultSheetStockPartSpacing') ?? 0;
    const edge = (ref.number('defaultEdgeMarginWidthMultiplier') ?? 0) * req.thicknessMm;
    const kerfMm = spacing + 2 * addendum;
    const edgeMarginMm = edge + addendum;
    const sheet = { lengthMm: length, widthMm: width };
    // The setup the Nest view starts from (the same the quote nests with), and the stock sheets it ranks beside memory's.
    const sheetSource = `memory/Sheetmetal Hydroforming standard sheet (standardSheetLength ${length} x standardSheetWidth ${width} mm)`;
    const candidateSheets = await this.nesting.resolveNestCandidateSheets(undefined, { widthMm: width, lengthMm: length, source: sheetSource }).catch(() => []);
    const kerfSource = `defaultSheetStockPartSpacing ${spacing} mm${addendum > 0 ? ` + 2 x the blank's ${addendum} mm addendum` : ''}`;
    const setup = { kerfMm, kerfSource, edgeMarginMm, sheetSource, ...(candidateSheets.length ? { candidateSheets } : {}) };
    const sheetKg = (length * width * req.thicknessMm * density) / 1e9;
    const partKg = (part.developedAreaMm2 * req.thicknessMm * density) / 1e9;
    let note: string;
    if (part.blank.outlinePointsMm) {
      const nested = await this.nesting.resolveTrueShapeNestCosting(
        req.itemId, req.summary, partKg, density, req.thicknessMm, kerfMm, edgeMarginMm, req.userId, req.accessToken, sheet, undefined,
        { outlinePointsMm: part.blank.outlinePointsMm, cacheKey: HYDROFORM_NEST_CACHE_KEY },
      ).catch((e: unknown) => ({ selection: null, reason: e instanceof Error ? e.message : String(e) }));
      if (nested.selection) {
        const s = nested.selection;
        return {
          grossKgPerPart: s.grossWeightPerPartKg, partsPerSheet: s.partsPerSheet, utilizationPct: s.utilisationPct,
          sheetLengthMm: s.sheetLengthMm, sheetWidthMm: s.sheetWidthMm, method: 'true_shape', note: null, ...setup,
        };
      }
      note = `The blank is nested as a rectangle: the true-shape nest did not run (${nested.reason}).`;
    } else {
      note = 'The blank is nested as a rectangle: its outline was not measured.';
    }
    const blank = { lengthMm: Math.max(part.blank.lengthMm, part.blank.widthMm), widthMm: Math.min(part.blank.lengthMm, part.blank.widthMm) };
    const perSheet = rectangleNest(sheet, blank, kerfMm, edgeMarginMm);
    if (perSheet < 1) return { grossKgPerPart: sheetKg, partsPerSheet: 1, utilizationPct: r2((100 * partKg) / sheetKg), sheetLengthMm: length, sheetWidthMm: width, method: 'rectangle', ...setup, note: `The blank does not fit the ${length} x ${width} mm sheet: it is costed as one blank a sheet.` };
    return {
      grossKgPerPart: sheetKg / perSheet, partsPerSheet: perSheet, utilizationPct: r2((100 * partKg * perSheet) / sheetKg),
      sheetLengthMm: length, sheetWidthMm: width, method: 'rectangle', note, ...setup,
    };
  }

  async price(req: HydroformingCostRequest): Promise<HydroformingCostResult> {
    const warnings: string[] = [];
    const none = (part: HydroformPart | null, ...missing: string[]): HydroformingCostResult => ({ route: null, routes: [], rule: null, part, nest: null, note: null, missing, warnings });
    const { part, missing: partMissing } = hydroformPart(req.geometry);
    if (!part) return none(null, ...partMissing);
    for (const what of part.unmeasured) warnings.push(`The cad-engine could not measure ${what}.`);
    // A part that is not one sheet (a machined block) is not hydroformed: said before its blank is nested.
    const sheet = sheetMeasure(part, req.thicknessMm, req.partVolumeMm3);
    if (sheet?.refuse) return none(part, sheet.refuse);
    if (sheet?.warn) warnings.push(sheet.warn);
    const o = req.overrides ?? {};
    const [{ reference, missing: refMissing }, calculators, machines, toolShop, operations] = await Promise.all([
      this.reference(),
      this.catalog.loadHydroformingCalculators(req.accessToken),
      this.machines.getMachinesByClass(req.client, HYDROFORMING_ROUTE_CLASSES, req.location),
      this.castingReference.getToolShop(),
      this.operationCatalog(req.client),
    ]);
    if (!reference) return none(part, ...refMissing);
    const spec = loadHydroformingCalculatorSpec();
    const absent = spec.calculators.filter((c) => !(c.name in calculators)).map((c) => c.name);
    if (absent.length) return none(part, `the hydroforming calculators are not in the database (run migration 1110): ${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ', ...' : ''}`);
    if (!Object.values(machines).some((m) => m.length > 0)) return none(part, `HR Rates has no ${HYDROFORMING_PROCESS_GROUP} machines for ${req.location}`);
    if (!toolShop.shop) warnings.push(`The hydroform tool is not costed: ${toolShop.missing.join('; ')}.`);
    const proxied = (machines[HYDROFORMING_CLASS.press] ?? []).some((m) => typeof m.specs.rate_basis === 'string' && m.specs.rate_basis.includes('Netherlands'));
    if (proxied) warnings.push(`The hydroform presses' rates in ${req.location} are the Netherlands export's overheads (no export lists the USA), with the USA 3 - Metal labour (migration 1109).`);

    const nest = await this.nest(req, reference, part);
    const keyOf = (v: unknown): HydroformingRouteKey | null => HYDROFORMING_ROUTES.find((r) => r.key === v)?.key ?? null;
    const chosen = keyOf(req.forceRoute) ?? keyOf(o[HYDROFORMING_KEYS.route]);
    const tray = num(o[HYDROFORMING_KEYS.partsPerTray]);
    const intensifier = o[HYDROFORMING_KEYS.intensifier] === true || o[HYDROFORMING_KEYS.intensifier] === 'true';
    const { routes, missing } = buildHydroformingRoutes({
      ref: reference, spec, calculators, material: req.material, part, thicknessMm: req.thicknessMm, machinesByClass: machines, costContext: req.costContext,
      nest, toolShop: toolShop.shop, catalog: operations, graphFeatures: req.graphFeatures ?? [],
      scenario: {
        batchSize: req.batchSize, route: chosen, partsPerTray: tray != null && tray >= 1 ? Math.floor(tray) : null, intensifier,
        amortizationParts: req.amortizationParts,
      },
    });
    if (missing.length) return { ...none(part, ...missing), nest };
    const rule = hydroformingRule(reference, part);
    const { route, note } = chooseHydroformingRoute(routes, rule, chosen);
    if (!route) return { ...none(part, 'no hydroforming route could be built'), rule, nest };
    if (!intensifier) warnings.push('The intensifier (intensifierPercentageMultiplier of the tool) is not included: the data does not say when a tool needs one; include it in the Cost Guide.');
    warnings.push('Not modelled (disclosed): stepped draws (depthOfStepLimit), a blank holder for long skirts (skirtLengthLimit), and trimming after forming for tight tolerances (toleranceLooseThreshold*).');
    const local = routes.map((r) => routeToLocal(r, req.usdToLocal));
    return { route: local[routes.indexOf(route)], routes: local, rule, part, nest, note, missing: [], warnings: [...warnings, ...route.warnings] };
  }
}
