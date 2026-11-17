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
import type { SandMaterial } from '../casting/sand/sand-steps';
import { loadPowderMetalCalculatorSpec } from './calculators/powder-metal-calculator-spec';
import {
  buildPowderMetalRoute, POWDER_METAL_PROCESS_GROUP, POWDER_METAL_ROUTE_CLASSES,
  type PowderMetalHole, type PowderMetalPart, type PowderMetalRoute,
} from './powder-metal-route';

const SOURCE_VERSION = '2026-PowderMetal';
/** The powder properties the route reads (raw_material_properties keys of the powders, migration 863). */
const PROPERTY_KEYS = ['green_density', 'apparent_density', 'min_green_density', 'max_green_density', 'compaction_curve_coef_a', 'compaction_curve_coef_b', 'compaction_curve_coef_c'] as const;
/** The Cost Guide key: the green density the part is pressed to (kg/m³); unset, the powder's own. */
export const POWDER_METAL_GREEN_DENSITY_KEY = 'powderMetalGreenDensity';

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

export interface PowderMetalCostRequest {
  client: DbClient;
  accessToken: string;
  location: string;
  grade: string | null;
  /** The part along its press direction: the die-direction measurements (cad-engine forging/feature_extractor.py, via auto-fill) and its volume. */
  measurements: {
    volumeMm3: number | null; projectedAreaMm2: number | null; dieDepthMm: number | null;
    planLengthMm: number | null; planWidthMm: number | null; holes: readonly PowderMetalHole[];
  };
  overrides: Record<string, unknown> | null | undefined;
  batchSize: number;
  /** USD -> the location's currency. */
  usdToLocal: number;
  costContext: CostContext;
}

export interface PowderMetalCostResult {
  /** The route in the location's currency; null when it cannot be built (see `missing`). */
  route: PowderMetalRoute | null;
  missing: string[];
  warnings: string[];
}

/** The part as the route takes it, or what the measurements lack (a part analysed before the measurements, or as another process). */
export function powderMetalPart(m: PowderMetalCostRequest['measurements']): { part: PowderMetalPart | null; missing: string[] } {
  const [volume, area, height, length, width] = [m.volumeMm3, m.projectedAreaMm2, m.dieDepthMm, m.planLengthMm, m.planWidthMm].map(positive);
  const missing = [
    ...(volume == null ? ['the part volume'] : []),
    ...(area == null || height == null || length == null || width == null
      ? ['the outline, height and plan along the press direction: press Refresh analysis so the part is measured for pressing'] : []),
  ];
  return missing.length ? { part: null, missing } : {
    part: { volumeMm3: volume!, projectedAreaMm2: area!, heightMm: height!, planLengthMm: Math.max(length!, width!), planWidthMm: Math.min(length!, width!), holes: m.holes },
    missing: [],
  };
}

/** The route in the location's currency (it is built in USD, the units of HR Rates and the reference data). */
function routeToLocal(route: PowderMetalRoute, usdToLocal: number): PowderMetalRoute {
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
 * Prices a pressed and sintered powder metal part: loads the powder metal reference data, the calculators (from the database), the machines
 * of the location and the powder, builds the route (powder-metal-route.ts) and returns it in the location's currency.
 */
@Injectable()
export class PowderMetalCostService {
  constructor(
    private readonly database: DatabaseService,
    private readonly machines: SandMachineService,
    private readonly catalog: CalculatorCatalogService,
  ) {}

  private cached: SandReference | null = null;

  private async reference(): Promise<{ reference: SandReference | null; missing: string[] }> {
    if (this.cached) return { reference: this.cached, missing: [] };
    const read = await readStagedReference(this.database, SOURCE_VERSION, 'Powder metal', 863);
    if (read.reference) this.cached = read.reference;
    return read;
  }

  /** The powder whose name or grade equals the BOM item's material grade, case-insensitively; null when the grade is not one. */
  async getMaterial(client: DbClient, grade: string | null): Promise<SandMaterial | null> {
    const g = (grade ?? '').trim();
    if (!g) return null;
    const { data, error } = await client.from('raw_materials')
      .select('id, name, grade, material_type, cut_code, cost_usa')
      .eq('material_group', POWDER_METAL_PROCESS_GROUP)
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
      columns: { unit_cost_usd_per_kg: num(row.cost_usa), cut_code: num(row.cut_code), ...Object.fromEntries(PROPERTY_KEYS.map((k) => [k, properties[k] ?? null])) },
    };
  }

  async price(req: PowderMetalCostRequest): Promise<PowderMetalCostResult> {
    const warnings: string[] = [];
    const none = (...missing: string[]): PowderMetalCostResult => ({ route: null, missing, warnings });
    const { part, missing: partMissing } = powderMetalPart(req.measurements);
    if (!part) return none(...partMissing);
    const [{ reference, missing: refMissing }, calculators, machines, material] = await Promise.all([
      this.reference(),
      this.catalog.loadPowderMetalCalculators(req.accessToken),
      this.machines.getMachinesByClass(req.client, POWDER_METAL_ROUTE_CLASSES, req.location),
      this.getMaterial(req.client, req.grade),
    ]);
    if (!reference) return none(...refMissing);
    if (!material) return none(`"${req.grade ?? '(no material)'}" is not a powder in Raw Materials (material group ${POWDER_METAL_PROCESS_GROUP}): choose one in Material Grade`);
    const spec = loadPowderMetalCalculatorSpec();
    const absent = spec.calculators.filter((c) => !calculators[c.name]).map((c) => c.name);
    if (absent.length) return none(`the powder metal calculators are not in the database (run migration 1060): ${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ', ...' : ''}`);
    if (!Object.values(machines).some((m) => m.length > 0)) return none(`HR Rates has no powder metal machines for ${req.location}`);
    if (req.location !== 'USA') warnings.push(`The powder prices are the reference's USA prices (cost_usa): it holds none for ${req.location}.`);

    const { route, missing } = buildPowderMetalRoute({
      ref: reference, spec, calculators, material, part, machinesByClass: machines, costContext: req.costContext,
      scenario: { batchSize: req.batchSize, greenDensityKgM3: positive(req.overrides?.[POWDER_METAL_GREEN_DENSITY_KEY]) },
    });
    if (!route) return none(...missing);
    return { route: routeToLocal(route, req.usdToLocal), missing: [], warnings: [...warnings, ...route.warnings] };
  }
}
