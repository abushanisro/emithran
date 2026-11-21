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
import { loadRotoBlowCalculatorSpec } from './calculators/roto-blow-calculator-spec';
import {
  ROTO_BLOW_PROCESS_GROUP, ROTO_BLOW_ROUTE_CLASSES, ROTO_BLOW_ROUTES, buildRotoBlowRoutes, chooseRotoBlowRoute,
  type RotoBlowMaterial, type RotoBlowPart, type RotoBlowRoute, type RotoBlowRouteGap, type RotoBlowRouteKey,
} from './roto-blow-route';

const SOURCE_VERSION = '2026-RotoBlow';

/** The Cost Guide keys of a blow molded or rotomolded part. */
export const ROTO_BLOW_KEYS = {
  route: 'rotoBlowRoute', colored: 'rotoBlowColored', labels: 'rotoBlowLabels', inserts: 'rotoBlowInserts', ovenTime: 'rotoOvenTimeS',
} as const;

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};
type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

/** The shell as auto-fill promotes it (rotoBlowGeometry, from cad-engine roto_blow/feature_extractor.py). */
export interface RotoBlowGeometrySummary {
  extractionVersion?: string | null;
  envelopeMm?: { length?: number; width?: number; depth?: number } | null;
  partVolumeMm3?: number | null;
  surfaceAreaMm2?: number | null;
  wall?: { nominal_mm?: number | null; nominalMm?: number | null } | null;
  hollow?: boolean | null;
  inside?: { volume_mm3?: number; volumeMm3?: number } | null;
  partingLineMm?: number | null;
  perimeterMm?: number | null;
  spouts?: unknown;
  holes?: unknown;
  voids?: unknown;
}

/** The part as the routes take it, or what the measurements lack (a part analysed before them, or as another process). */
export function rotoBlowPart(g: RotoBlowGeometrySummary | null | undefined): { part: RotoBlowPart | null; missing: string[] } {
  const again = 'the shell measurements: press Refresh analysis so the part is measured as a blow or roto molded shell';
  if (!g?.extractionVersion) return { part: null, missing: [again] };
  const e = g.envelopeMm ?? {};
  const [length, width, depth] = [positive(e.length), positive(e.width), positive(e.depth)];
  const volume = positive(g.partVolumeMm3);
  if (length == null || width == null || depth == null || volume == null) return { part: null, missing: [again] };
  const wall = positive(g.wall?.nominal_mm ?? g.wall?.nominalMm) ?? 0;
  return {
    part: {
      envelope: { lengthMm: length, widthMm: width, depthMm: depth }, partVolumeMm3: volume, surfaceAreaMm2: positive(g.surfaceAreaMm2) ?? 0, wallMm: wall,
      hollow: g.hollow === true, insideVolumeMm3: positive(g.inside?.volume_mm3 ?? g.inside?.volumeMm3) ?? 0,
      partingLineMm: positive(g.partingLineMm), perimeterMm: positive(g.perimeterMm),
      spouts: arr(g.spouts).map((s) => ({ id: String(s.id), diameterMm: Number(s.diameter_mm ?? s.diameterMm), lengthMm: Number(s.length_mm ?? s.lengthMm ?? 0) })).filter((s) => s.diameterMm > 0),
      holes: arr(g.holes).map((h) => ({
        id: String(h.id), type: String(h.feature_type ?? h.featureType ?? 'SimpleHole'), variant: String(h.variant ?? 'through'),
        diameterMm: Number(h.diameter_mm ?? h.diameterMm), depthMm: Number(h.depth_mm ?? h.depthMm ?? 0),
      })).filter((h) => h.diameterMm > 0),
      voids: arr(g.voids).map((v) => ({
        id: String(v.id), type: String(v.feature_type ?? v.featureType ?? 'Void'), variant: String(v.variant ?? 'simple'),
        volumeMm3: Number(v.volume_mm3 ?? v.volumeMm3 ?? 0), depthMm: Number(v.depth_mm ?? v.depthMm ?? 0),
        equivalentDiameterMm: num(v.equivalent_diameter_mm ?? v.equivalentDiameterMm),
      })),
    },
    missing: [],
  };
}

export interface RotoBlowCostRequest {
  client: DbClient;
  accessToken: string;
  location: string;
  grade: string | null;
  geometry: RotoBlowGeometrySummary | null | undefined;
  forceRoute?: string;
  overrides: Record<string, unknown> | null | undefined;
  batchSize: number;
  amortizationParts: number | null;
  /** USD -> the location's currency. */
  usdToLocal: number;
  costContext: CostContext;
}

export interface RotoBlowCostResult {
  /** The quoted route in the location's currency; null when none can be built (see `missing`). */
  route: RotoBlowRoute | null;
  routes: RotoBlowRoute[];
  gaps: RotoBlowRouteGap[];
  part: RotoBlowPart | null;
  note: string | null;
  missing: string[];
  warnings: string[];
}

/** One route in the location's currency (it is built in USD, the units of HR Rates and the reference data); its tooling stays in USD. */
function routeToLocal(route: RotoBlowRoute, usdToLocal: number): RotoBlowRoute {
  if (usdToLocal === 1) return route;
  return {
    ...route,
    lines: route.lines.map((l) => lineToLocal(l, usdToLocal)),
    material: { ...route.material, costUsd: route.material.costUsd * usdToLocal },
    totalUsd: route.totalUsd != null ? Math.round(route.totalUsd * usdToLocal * 100) / 100 : null,
  };
}

const flag = (v: unknown) => String(v ?? '').trim().toLowerCase() === 'true';

/**
 * Prices a blow molded or rotomolded part: loads the staged memory/Roto & blow molding reference, the calculators (from the database), the
 * machines of the location and the material, builds both routes (roto-blow-route.ts) and returns them in the location's currency.
 */
@Injectable()
export class RotoBlowCostService {
  constructor(
    private readonly database: DatabaseService,
    private readonly machines: SandMachineService,
    private readonly catalog: CalculatorCatalogService,
  ) {}

  private cached: SandReference | null = null;

  /** The staged memory/Roto & blow molding variables and lookup tables (read once; a read error is reported and not cached). */
  async reference(): Promise<{ reference: SandReference | null; missing: string[] }> {
    if (this.cached) return { reference: this.cached, missing: [] };
    const read = await readStagedReference(this.database, SOURCE_VERSION, ROTO_BLOW_PROCESS_GROUP, 863);
    if (read.reference) this.cached = read.reference;
    return read;
  }

  /**
   * The Roto & Blow Molding material whose name or grade equals `name`, case-insensitively: its density and price (raw_materials), and from
   * its properties (raw_material_properties, migration 855) whether it is blow molded or rotomolded and its melt properties. Null when it is
   * not one of the process group's.
   */
  async getMaterial(client: DbClient, name: string | null): Promise<RotoBlowMaterial | null> {
    const g = (name ?? '').trim();
    if (!g) return null;
    const { data, error } = await client.from('raw_materials')
      .select('id, name, grade, material_type, density_kg_m3, cost_usa')
      .eq('material_group', ROTO_BLOW_PROCESS_GROUP)
      .or(`name.ilike.${quoteFilterValue(escapeLikePattern(g))},grade.ilike.${quoteFilterValue(escapeLikePattern(g))}`)
      .limit(2);
    if (error || !data || data.length !== 1) return null;
    const row = data[0] as Obj;
    const { data: props } = await client.from('raw_material_properties').select('property_key, value_num, value_text').eq('raw_material_id', String(row.id));
    const p = new Map(((props ?? []) as Array<{ property_key: string; value_num: unknown; value_text: unknown }>).map((x) => [x.property_key, x]));
    const n = (key: string) => positive(p.get(key)?.value_num);
    return {
      id: String(row.id), name: String(row.name ?? row.grade ?? g), materialType: row.material_type ? String(row.material_type) : null,
      densityKgM3: positive(row.density_kg_m3), costPerKgUsd: positive(row.cost_usa),
      canBlowMold: flag(p.get('can_blow_mold')?.value_text), canRotoMold: flag(p.get('can_rotational_mold')?.value_text),
      melt: {
        meltingTempC: n('melting_temp'), moldTempC: n('mold_temp'), ejectTempC: n('eject_deflection_temp'),
        specificHeatJgC: n('specific_heat_of_melt'), conductivityWMC: n('thermal_conductivity_of_melt'), densityKgM3: n('density_of_melt'),
      },
    };
  }

  async price(req: RotoBlowCostRequest): Promise<RotoBlowCostResult> {
    const warnings: string[] = [];
    const none = (part: RotoBlowPart | null, ...missing: string[]): RotoBlowCostResult => ({ route: null, routes: [], gaps: [], part, note: null, missing, warnings });
    const { part, missing: partMissing } = rotoBlowPart(req.geometry);
    if (!part) return none(null, ...partMissing);
    const o = req.overrides ?? {};
    const [{ reference, missing: refMissing }, calculators, machines, material] = await Promise.all([
      this.reference(),
      this.catalog.loadRotoBlowCalculators(req.accessToken),
      this.machines.getMachinesByClass(req.client, ROTO_BLOW_ROUTE_CLASSES, req.location),
      this.getMaterial(req.client, req.grade),
    ]);
    if (!reference) return none(part, ...refMissing);
    if (!material) return none(part, `"${req.grade ?? '(no material)'}" is not a Roto & Blow Molding material in Raw Materials (material group ${ROTO_BLOW_PROCESS_GROUP}): choose a resin in Material Grade`);
    const spec = loadRotoBlowCalculatorSpec();
    const absent = spec.calculators.filter((c) => !calculators[c.name]).map((c) => c.name);
    if (absent.length) return none(part, `the Roto & Blow Molding calculators are not in the database (run migration 1108): ${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ', ...' : ''}`);
    if (!Object.values(machines).some((m) => m.length > 0)) return none(part, `HR Rates has no Roto & Blow Molding machines for ${req.location}`);
    if (req.location !== 'USA') warnings.push(`The material price is the reference's USA price (cost_usa): it holds none for ${req.location}.`);

    const keyOf = (v: unknown): RotoBlowRouteKey | null => ROTO_BLOW_ROUTES.find((r) => r.key === v)?.key ?? null;
    const chosen = keyOf(req.forceRoute) ?? keyOf(o[ROTO_BLOW_KEYS.route]);
    const labels = num(o[ROTO_BLOW_KEYS.labels]);
    const { routes, gaps, missing } = buildRotoBlowRoutes({
      ref: reference, spec, calculators, material, part, machinesByClass: machines, costContext: req.costContext,
      scenario: {
        batchSize: req.batchSize, route: chosen, colored: o[ROTO_BLOW_KEYS.colored] === true || o[ROTO_BLOW_KEYS.colored] === 'true',
        labels: labels != null && labels >= 0 ? Math.floor(labels) : null, inserts: Math.max(0, Math.floor(num(o[ROTO_BLOW_KEYS.inserts]) ?? 0)),
        ovenTimeS: positive(o[ROTO_BLOW_KEYS.ovenTime]), amortizationParts: req.amortizationParts,
      },
    });
    if (missing.length) return none(part, ...missing);
    const { route, note } = chooseRotoBlowRoute(routes, gaps, chosen);
    if (!route) return { ...none(part, ...gaps.map((g) => `${g.label}: ${g.reason}`)), gaps };
    const local = routes.map((r) => routeToLocal(r, req.usdToLocal));
    return { route: local[routes.indexOf(route)]!, routes: local, gaps, part, note, missing: [], warnings: [...warnings, ...route.warnings] };
  }
}
