import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../common/database/database.service';
import type { DbClient } from '../../../../common/db/postgrest-client';
import { escapeLikePattern, quoteFilterValue } from '../../../../common/db/postgrest-filter';
import { CalculatorCatalogService } from '../../services/calculator-catalog.service';
import { CastingReferenceService } from '../casting/casting-reference.service';
import type { CostContext } from '../casting/casting-finishing';
import { lineToLocal } from '../casting/sand/sand-cost';
import { SandMachineService } from '../casting/sand/sand-machine.service';
import type { SandReference } from '../casting/sand/sand-reference';
import { readStagedReference } from '../casting/sand/sand-reference.service';
import type { SandMaterial } from '../casting/sand/sand-steps';
import { loadForgingCalculatorSpec } from './calculators/forging-calculator-spec';
import { buildForgingRoutes, chooseForgingRoute, FORGING_PROCESS_GROUP, FORGING_ROUTE_CLASSES, FORGING_ROUTES, type ForgingHole, type ForgingOverrides, type ForgingPart, type ForgingRoute, type ForgingRouteGap, type ForgingRouteKey } from './forging-route';

const SOURCE_VERSION = '2026-Forging';
/** The forging material's hot-working properties the route reads (raw_material_properties keys of the forging materials, migration 823). */
const PROPERTY_KEYS = ['round_bar_unit_cost', 'shear_strength', 'strength_coefficient', 'strain_rate_sensitivity', 'specific_heat_capacity', 'forging_temperature'] as const;
/** The Cost Guide keys: the part complexity score (1 to 12), and the forging route (a FORGING_ROUTES key; unset, the cheapest complete). */
export const FORGING_COMPLEXITY_KEY = 'forgingComplexity';
export const FORGING_ROUTE_KEY = 'forgingRoute';

/** The scenario keys of the forging settings an engineer sets over the engine's in the Cost Guide (lib/costing/forging-view.ts mirrors them). */
export const FORGING_OVERRIDE_KEYS = {
  barDiameterMm: 'forgingBarDiameterMm',
  heating: 'forgingHeating',
  hits: 'forgingHits',
  flashThicknessMm: 'forgingFlashThicknessMm',
  flashWidthMm: 'forgingFlashWidthMm',
} as const;

/** The forging overrides of a part's scenario: only a usable value counts (a positive size, a whole number of blows, a heating the engine has). */
export function forgingOverridesOf(o: Record<string, unknown>): ForgingOverrides {
  const positive = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const hits = positive(o[FORGING_OVERRIDE_KEYS.hits]);
  const heating = o[FORGING_OVERRIDE_KEYS.heating];
  return {
    barDiameterMm: positive(o[FORGING_OVERRIDE_KEYS.barDiameterMm]),
    heating: heating === 'induction' || heating === 'furnace' ? heating : null,
    hits: hits != null && Number.isInteger(hits) ? hits : null,
    flashThicknessMm: positive(o[FORGING_OVERRIDE_KEYS.flashThicknessMm]),
    flashWidthMm: positive(o[FORGING_OVERRIDE_KEYS.flashWidthMm]),
  };
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

export interface ForgingCostRequest {
  client: DbClient;
  accessToken: string;
  location: string;
  grade: string | null;
  /** The forging measurements (cad-engine forging/feature_extractor.py, via auto-fill's forging* summary keys) and the part volume. */
  measurements: {
    volumeMm3: number | null; projectedAreaMm2: number | null; partingPerimeterMm: number | null;
    dieDepthMm: number | null; planLengthMm: number | null; planWidthMm: number | null; holes: readonly ForgingHole[];
  };
  /** Price the part on this route (the route comparison prices each); else the Cost Guide's, else the cheapest complete. */
  forceRoute?: string;
  overrides: Record<string, unknown> | null | undefined;
  batchSize: number;
  annualVolume: number | null;
  productionLifeYears: number | null;
  /** USD -> the location's currency. */
  usdToLocal: number;
  costContext: CostContext;
}

export interface ForgingCostResult {
  /** The quoted route in the location's currency; null when none can be built (see `missing`). */
  route: ForgingRoute | null;
  /** Every route built, in the location's currency, and the routes that are not routes for the part, with why. */
  routes: ForgingRoute[];
  gaps: ForgingRouteGap[];
  /** How the route was chosen and what the others came to. */
  note: string | null;
  missing: string[];
  warnings: string[];
}

/** The part as the route takes it, or what the measurements lack (a part analysed before the forging measurements, or as another process). */
export function forgingPart(m: ForgingCostRequest['measurements']): { part: ForgingPart | null; missing: string[] } {
  const missing = [
    ...(positive(m.volumeMm3) == null ? ['the part volume'] : []),
    ...(positive(m.projectedAreaMm2) == null || positive(m.partingPerimeterMm) == null
      ? ['the outline along the die direction (projected area and parting line): press Refresh analysis so the part is measured as a forging'] : []),
  ];
  return missing.length ? { part: null, missing } : {
    part: {
      volumeMm3: m.volumeMm3!, projectedAreaMm2: m.projectedAreaMm2!, partingPerimeterMm: m.partingPerimeterMm!,
      dieDepthMm: positive(m.dieDepthMm), planLengthMm: positive(m.planLengthMm), planWidthMm: positive(m.planWidthMm), holes: m.holes,
    },
    missing: [],
  };
}

/** One route in the location's currency (it is built in USD, the units of HR Rates and the reference data). The dies stay in USD, as every tool investment of a summary is. */
function routeToLocal(route: ForgingRoute, usdToLocal: number): ForgingRoute {
  if (usdToLocal === 1) return route;
  const k = (v: number) => Math.round(v * usdToLocal * 100) / 100;
  return {
    ...route,
    lines: route.lines.map((l) => lineToLocal(l, usdToLocal)),
    material: { ...route.material, costUsd: route.material.costUsd * usdToLocal, costPerKgUsd: route.material.costPerKgUsd * usdToLocal },
    totalUsd: route.totalUsd != null ? k(route.totalUsd) : null,
  };
}

/**
 * Prices a closed-die hot forging: loads the forging reference data, the calculators (from the database), the machines of the location, the
 * material and the tool shop rate, builds the route (forging-route.ts) and returns it in the location's currency.
 */
@Injectable()
export class ForgingCostService {
  constructor(
    private readonly database: DatabaseService,
    private readonly machines: SandMachineService,
    private readonly catalog: CalculatorCatalogService,
    private readonly castingReference: CastingReferenceService,
  ) {}

  private cached: SandReference | null = null;

  /** The staged memory/Forging variables and lookup tables (read once; a read error is reported and not cached). */
  async reference(): Promise<{ reference: SandReference | null; missing: string[] }> {
    if (this.cached) return { reference: this.cached, missing: [] };
    const read = await readStagedReference(this.database, SOURCE_VERSION, 'Forging', 823);
    if (read.reference) this.cached = read.reference;
    return read;
  }

  /** The forging material whose name or grade equals the BOM item's material grade, case-insensitively; null when the grade is not one. */
  async getMaterial(client: DbClient, grade: string | null): Promise<SandMaterial | null> {
    const g = (grade ?? '').trim();
    if (!g) return null;
    const { data, error } = await client.from('raw_materials')
      .select('id, name, grade, material_type, density_kg_m3, cut_code')
      .eq('material_group', FORGING_PROCESS_GROUP)
      .or(`name.ilike.${quoteFilterValue(escapeLikePattern(g))},grade.ilike.${quoteFilterValue(escapeLikePattern(g))}`)
      .limit(2);
    if (error || !data || data.length !== 1) return null;
    const row = data[0] as Record<string, any>;
    const { data: props, error: propsError } = await client.from('raw_material_properties')
      .select('property_key, value_num').eq('raw_material_id', row.id).in('property_key', [...PROPERTY_KEYS]);
    if (propsError) return null;
    const properties = Object.fromEntries(((props ?? []) as Array<{ property_key: string; value_num: unknown }>).map((p) => [p.property_key, num(p.value_num)]));
    return {
      id: String(row.id), name: String(row.name ?? row.grade ?? ''), materialType: row.material_type ? String(row.material_type) : null,
      columns: { density_kg_m3: num(row.density_kg_m3), cut_code: num(row.cut_code), ...Object.fromEntries(PROPERTY_KEYS.map((k) => [k, properties[k] ?? null])) },
    };
  }

  async price(req: ForgingCostRequest): Promise<ForgingCostResult> {
    const warnings: string[] = [];
    const none = (...missing: string[]): ForgingCostResult => ({ route: null, routes: [], gaps: [], note: null, missing, warnings });
    const { part, missing: partMissing } = forgingPart(req.measurements);
    if (!part) return none(...partMissing);
    const [{ reference, missing: refMissing }, calculators, machines, material, tooling] = await Promise.all([
      this.reference(),
      this.catalog.loadForgingCalculators(req.accessToken),
      this.machines.getMachinesByClass(req.client, FORGING_ROUTE_CLASSES, req.location),
      this.getMaterial(req.client, req.grade),
      this.castingReference.getDieToolingReference(),
    ]);
    if (!reference) return none(...refMissing);
    if (!material) return none(`"${req.grade ?? '(no material)'}" is not a forging material in Raw Materials (material group ${FORGING_PROCESS_GROUP}): choose one in Material Grade`);
    const spec = loadForgingCalculatorSpec();
    const absent = spec.calculators.filter((c) => !calculators[c.name]).map((c) => c.name);
    if (absent.length) return none(`the forging calculators are not in the database (run migration 1053): ${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ', ...' : ''}`);
    if (!Object.values(machines).some((m) => m.length > 0)) return none(`HR Rates has no forging machines for ${req.location}`);
    if (req.location !== 'USA') warnings.push(`The forging bar prices are the reference's USA prices (round_bar_unit_cost): it holds none for ${req.location}.`);

    const o = req.overrides ?? {};
    const complexity = num(o[FORGING_COMPLEXITY_KEY]);
    const lifetime = req.annualVolume != null && req.productionLifeYears != null && req.annualVolume > 0 && req.productionLifeYears > 0 ? req.annualVolume * req.productionLifeYears : null;
    const machiningRate = tooling.reference?.toolShop.machiningUsdPerHr;
    const keyOf = (v: unknown): ForgingRouteKey | null => FORGING_ROUTES.find((r) => r.key === v)?.key ?? null;
    const chosen = keyOf(req.forceRoute) ?? keyOf(o[FORGING_ROUTE_KEY]);
    const { routes, gaps, missing } = buildForgingRoutes({
      ref: reference, spec, calculators, material, part, machinesByClass: machines, costContext: req.costContext,
      toolShopMachiningUsdPerHr: machiningRate != null && Number.isFinite(machiningRate) ? machiningRate : null,
      scenario: {
        batchSize: req.batchSize, lifetimeVolume: lifetime,
        complexity: complexity != null && Number.isInteger(complexity) && complexity >= 1 && complexity <= 12 ? complexity : null,
        route: chosen,
        overrides: forgingOverridesOf(o),
      },
    });
    if (missing.length) return none(...missing);
    const { route, note } = chooseForgingRoute(routes, gaps, chosen);
    if (!route) return { ...none(...gaps.map((g) => `${g.label}: ${g.reason}`)), gaps };
    const local = routes.map((r) => routeToLocal(r, req.usdToLocal));
    return { route: local[routes.indexOf(route)]!, routes: local, gaps, note, missing: [], warnings: [...warnings, ...route.warnings] };
  }
}
