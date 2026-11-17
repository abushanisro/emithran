import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../common/database/database.service';
import type { DbClient } from '../../../../common/db/postgrest-client';
import { escapeLikePattern, quoteFilterValue } from '../../../../common/db/postgrest-filter';
import { CalculatorCatalogService } from '../../services/calculator-catalog.service';
import type { CostContext } from '../casting/casting-finishing';
import { lineToLocal } from '../casting/sand/sand-cost';
import { SandMachineService } from '../casting/sand/sand-machine.service';
import type { SandReference } from '../casting/sand/sand-reference';
import { readStagedReference } from '../casting/sand/sand-reference.service';
import { loadCompositesCalculatorSpec } from './calculators/composites-calculator-spec';
import {
  buildCompositesRoutes, chooseCompositesRoute, COMPOSITES_PROCESS_GROUP, COMPOSITES_ROUTE_CLASSES, COMPOSITES_ROUTES,
  type CompositeMaterial, type CompositePart, type CompositesRoute, type CompositesRouteGap, type CompositesRouteKey, type LaminateLevel,
} from './composites-route';

const SOURCE_VERSION = '2026-Composites';
/** The composites material properties the routes read (raw_material_properties, migration 855). */
const NUMBER_KEYS = [
  'cured_thickness', 'areal_weight', 'material_utilization', 'material_width', 'cure_hold_temperature', 'cure_dwell_time',
  'cure_temperature_ramp_up_rate', 'cure_temperature_ramp_down_rate', 'deformation_average_angle', 'deformation_warning_angle', 'deformation_limit_angle',
] as const;
const TEXT_KEYS = ['material_form', 'can_hlu', 'can_atl', 'can_afp'] as const;

/** The Cost Guide keys of a composite part. */
export const COMPOSITES_ROUTE_KEY = 'compositesRoute';
export const COMPOSITES_PLY_COUNT_KEY = 'compositesPlyCount';
export const COMPOSITES_CORE_KEY = 'compositesCore';
export const COMPOSITES_CORE_MATERIAL_KEY = 'compositesCoreMaterial';

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

/** The laminate as auto-fill promotes it (compositeLaminate, from cad-engine composites/feature_extractor.py). */
export interface CompositeLaminateSummary {
  toolAreaMm2?: number | null; bagAreaMm2?: number | null; outerAreaMm2?: number | null; trimLengthMm?: number | null; openingsAreaMm2?: number | null;
  footprintMm?: number[] | null; heightMm?: number | null; curvaturePerM?: number | null; holeCount?: number | null;
  levels?: Array<{ thicknessMm: number; regionAreaMm2: number; regionPerimeterMm: number; faceIds?: number[] }> | null;
}

/** The part as the routes take it, or what the measurements lack (a part analysed before them, or as another process). */
export function compositePart(m: CompositeLaminateSummary | null | undefined): { part: CompositePart | null; missing: string[] } {
  const again = 'the laminate measurements: press Refresh analysis so the part is measured as a composite laminate';
  if (!m) return { part: null, missing: [again] };
  const [tool, trim, outer] = [m.toolAreaMm2, m.trimLengthMm, m.outerAreaMm2].map(positive);
  const fp = Array.isArray(m.footprintMm) && m.footprintMm.length === 2 && m.footprintMm.every((x) => Number(x) > 0) ? [Number(m.footprintMm[0]), Number(m.footprintMm[1])] : null;
  const levels: LaminateLevel[] = (m.levels ?? []).filter((l) => Number(l.thicknessMm) > 0 && Number(l.regionAreaMm2) > 0)
    .map((l) => ({ thicknessMm: Number(l.thicknessMm), regionAreaMm2: Number(l.regionAreaMm2), regionPerimeterMm: Number(l.regionPerimeterMm) || 0, faceIds: l.faceIds ?? [] }));
  if (tool == null || trim == null || outer == null || fp == null || levels.length === 0) return { part: null, missing: [again] };
  return {
    part: {
      toolAreaMm2: tool, bagAreaMm2: positive(m.bagAreaMm2) ?? tool, levels, outerAreaMm2: outer, trimLengthMm: trim, openingsAreaMm2: num(m.openingsAreaMm2) ?? 0,
      footprintMm: [Math.max(fp[0]!, fp[1]!), Math.min(fp[0]!, fp[1]!)], heightMm: positive(m.heightMm) ?? 0, curvaturePerM: num(m.curvaturePerM) ?? 0,
      holeCount: num(m.holeCount) ?? 0,
    },
    missing: [],
  };
}

export interface CompositesCostRequest {
  client: DbClient;
  accessToken: string;
  location: string;
  grade: string | null;
  laminate: CompositeLaminateSummary | null | undefined;
  /** A route to price instead of the chosen one (the route comparison prices each). */
  forceRoute?: string;
  overrides: Record<string, unknown> | null | undefined;
  batchSize: number;
  /** USD -> the location's currency. */
  usdToLocal: number;
  costContext: CostContext;
}

export interface CompositesCostResult {
  /** The quoted route in the location's currency; null when none can be built (see `missing`). */
  route: CompositesRoute | null;
  routes: CompositesRoute[];
  gaps: CompositesRouteGap[];
  note: string | null;
  missing: string[];
  warnings: string[];
}

/** One route in the location's currency (it is built in USD, the units of HR Rates and the reference data). */
function routeToLocal(route: CompositesRoute, usdToLocal: number): CompositesRoute {
  if (usdToLocal === 1) return route;
  const k = (v: number) => Math.round(v * usdToLocal * 100) / 100;
  return {
    ...route,
    lines: route.lines.map((l) => lineToLocal(l, usdToLocal)),
    material: {
      ...route.material, plyCostUsd: route.material.plyCostUsd * usdToLocal, coreCostUsd: route.material.coreCostUsd * usdToLocal,
      costUsd: route.material.costUsd * usdToLocal, costPerKgUsd: route.material.costPerKgUsd != null ? route.material.costPerKgUsd * usdToLocal : null,
    },
    totalUsd: route.totalUsd != null ? k(route.totalUsd) : null,
  };
}

/**
 * Prices a laid-up composite part: loads the composites reference data, the calculators (from the database), the machines of the location,
 * the prepreg and the core, builds every layup route (composites-route.ts) and returns them in the location's currency.
 */
@Injectable()
export class CompositesCostService {
  constructor(
    private readonly database: DatabaseService,
    private readonly machines: SandMachineService,
    private readonly catalog: CalculatorCatalogService,
  ) {}

  private cached: SandReference | null = null;

  /** The staged memory/Composites variables and lookup tables (read once; a read error is reported and not cached). */
  async reference(): Promise<{ reference: SandReference | null; missing: string[] }> {
    if (this.cached) return { reference: this.cached, missing: [] };
    const read = await readStagedReference(this.database, SOURCE_VERSION, 'Composites', 823);
    if (read.reference) this.cached = read.reference;
    return read;
  }

  /** The composites material whose name or grade equals `name`, case-insensitively, with its properties; null when it is not one. */
  async getMaterial(client: DbClient, name: string | null): Promise<CompositeMaterial | null> {
    const g = (name ?? '').trim();
    if (!g) return null;
    const { data, error } = await client.from('raw_materials')
      .select('id, name, grade, material_type, cost_usa, cost_units')
      .eq('material_group', COMPOSITES_PROCESS_GROUP)
      .or(`name.ilike.${quoteFilterValue(escapeLikePattern(g))},grade.ilike.${quoteFilterValue(escapeLikePattern(g))}`)
      .limit(2);
    if (error || !data || data.length !== 1) return null;
    const row = data[0] as Record<string, any>;
    const { data: props, error: propsError } = await client.from('raw_material_properties')
      .select('property_key, value_num, value_text').eq('raw_material_id', row.id).in('property_key', [...NUMBER_KEYS, ...TEXT_KEYS]);
    if (propsError) return null;
    const rows = (props ?? []) as Array<{ property_key: string; value_num: unknown; value_text: unknown }>;
    const numbers = Object.fromEntries(rows.map((p) => [p.property_key, num(p.value_num)]));
    const texts = Object.fromEntries(rows.map((p) => [p.property_key, p.value_text == null ? null : String(p.value_text)]));
    // Prices of composites materials are per square metre (cost_units "Cost per Sq Meter", memory/Composites/materials.csv).
    const perM2 = /sq\.?\s*m/i.test(String(row.cost_units ?? '')) ? num(row.cost_usa) : null;
    const form = texts['material_form'];
    const yes = (v: string | null | undefined) => (v ?? '').trim().toLowerCase() === 'true';
    return {
      id: String(row.id), name: String(row.name ?? row.grade ?? ''), materialType: row.material_type ? String(row.material_type) : null,
      form: form === 'Ply' || form === 'Core' ? form : null,
      can: { hlu: yes(texts['can_hlu']), atl: yes(texts['can_atl']), afp: yes(texts['can_afp']) },
      columns: { cost_per_m2: perM2, ...Object.fromEntries(NUMBER_KEYS.map((k) => [k, numbers[k] ?? null])) },
    };
  }

  async price(req: CompositesCostRequest): Promise<CompositesCostResult> {
    const warnings: string[] = [];
    const none = (...missing: string[]): CompositesCostResult => ({ route: null, routes: [], gaps: [], note: null, missing, warnings });
    const { part, missing: partMissing } = compositePart(req.laminate);
    if (!part) return none(...partMissing);
    const o = req.overrides ?? {};
    const [{ reference, missing: refMissing }, calculators, machines, material] = await Promise.all([
      this.reference(),
      this.catalog.loadCompositesCalculators(req.accessToken),
      this.machines.getMachinesByClass(req.client, COMPOSITES_ROUTE_CLASSES, req.location),
      this.getMaterial(req.client, req.grade),
    ]);
    if (!reference) return none(...refMissing);
    if (!material) return none(`"${req.grade ?? '(no material)'}" is not a composites material in Raw Materials (material group ${COMPOSITES_PROCESS_GROUP}): choose a prepreg in Material Grade`);
    const coreName = (typeof o[COMPOSITES_CORE_MATERIAL_KEY] === 'string' && (o[COMPOSITES_CORE_MATERIAL_KEY] as string).trim()) || reference.text('defaultCoreMaterial');
    const coreMaterial = await this.getMaterial(req.client, coreName);
    const spec = loadCompositesCalculatorSpec();
    const absent = spec.calculators.filter((c) => !calculators[c.name]).map((c) => c.name);
    if (absent.length) return none(`the composites calculators are not in the database (run migration 1065): ${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ', ...' : ''}`);
    if (!Object.values(machines).some((m) => m.length > 0)) return none(`HR Rates has no composites machines for ${req.location}`);
    if (req.location !== 'USA') warnings.push(`The prepreg and core prices are the reference's USA prices (cost_usa): it holds none for ${req.location}.`);

    const keyOf = (v: unknown): CompositesRouteKey | null => COMPOSITES_ROUTES.find((r) => r.key === v)?.key ?? null;
    const chosen = keyOf(req.forceRoute) ?? keyOf(o[COMPOSITES_ROUTE_KEY]);
    const core = o[COMPOSITES_CORE_KEY] === 'none' ? 'none' : 'auto';
    const { routes, gaps, missing } = buildCompositesRoutes({
      ref: reference, spec, calculators, material, coreMaterial: coreMaterial?.form === 'Core' ? coreMaterial : null, part,
      machinesByClass: machines, costContext: req.costContext,
      scenario: { batchSize: req.batchSize, route: chosen, overrides: { plyCount: positive(o[COMPOSITES_PLY_COUNT_KEY]), core } },
    });
    if (missing.length) return none(...missing);
    const { route, note } = chooseCompositesRoute(routes, gaps, chosen);
    if (!route) return { ...none(...gaps.map((g) => `${g.label}: ${g.reason}`)), gaps };
    const local = routes.map((r) => routeToLocal(r, req.usdToLocal));
    return { route: local[routes.indexOf(route)]!, routes: local, gaps, note, missing: [], warnings: [...warnings, ...route.warnings] };
  }
}
