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
import type { DomainCalculatorSpec } from '../shared/calculators/domain-calculator-spec';
import type { ReferenceCalculators } from '../shared/calculators/reference-calculator';
import { loadAdditiveCalculatorSpec } from './calculators/additive-calculator-spec';
import { loadRapidPrototypingCalculatorSpec } from './calculators/rapid-prototyping-calculator-spec';
import { ADDITIVE, domainMachineClasses, type AdditiveDomain } from './additive-domain';
import {
  BUILD_AXES, buildAdditiveRoutes, chooseAdditiveRoute,
  type AdditiveMaterial, type AdditivePart, type AdditiveRoute, type AdditiveRouteGap, type AdditiveRouteKey, type BuildAxis, type BuildCandidate,
} from './additive-route';
import { cleaningFeatures } from './feature-cleaning';

/** The Cost Guide keys of an additive part. */
export const ADDITIVE_ROUTE_KEY = 'additiveRoute';
export const ADDITIVE_BUILD_DIRECTION_KEY = 'additiveBuildDirection';

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

/** The build as auto-fill promotes it (additiveBuild, from cad-engine additive/feature_extractor.py). */
export interface AdditiveBuildSummary {
  extractionVersion?: string | null;
  /** The holes (feature_type, diameter_mm, depth_mm) and voids (additive/voids.py) cleaning clears; absent on an analysis before them. */
  holes?: unknown;
  voids?: unknown;
  axis?: string | null;
  partVolumeMm3?: number | null;
  surfaceAreaMm2?: number | null;
  candidates?: Record<string, {
    buildHeightMm?: number; footprintMm?: number[];
    byAngle?: Record<string, { overhangAreaMm2?: number; overhangProjectedAreaMm2?: number; supportVolumeMm3?: number; plateContactAreaMm2?: number; overhangRegions?: number }>;
  }> | null;
}

/** The part as the routes take it, or what the measurements lack (a part analysed before them, or as another process). */
export function additivePart(m: AdditiveBuildSummary | null | undefined): { part: AdditivePart | null; missing: string[] } {
  const again = 'the build measurements: press Refresh analysis so the part is measured for its build';
  if (!m) return { part: null, missing: [again] };
  const volume = positive(m.partVolumeMm3);
  const area = positive(m.surfaceAreaMm2);
  const axis = BUILD_AXES.find((a) => a === m.axis);
  const candidates: Partial<Record<BuildAxis, BuildCandidate>> = {};
  for (const a of BUILD_AXES) {
    const c = m.candidates?.[a];
    const fp = c?.footprintMm;
    if (!c || !(Number(c.buildHeightMm) > 0) || !Array.isArray(fp) || fp.length !== 2) continue;
    const byAngle: Record<string, BuildCandidate['byAngle'][string]> = {};
    for (const [k, v] of Object.entries(c.byAngle ?? {})) {
      byAngle[k] = {
        overhangAreaMm2: Number(v.overhangAreaMm2 ?? 0), overhangProjectedAreaMm2: Number(v.overhangProjectedAreaMm2 ?? 0),
        supportVolumeMm3: Number(v.supportVolumeMm3 ?? 0), plateContactAreaMm2: Number(v.plateContactAreaMm2 ?? 0), overhangRegions: Number(v.overhangRegions ?? 0),
      };
    }
    candidates[a] = { buildHeightMm: Number(c.buildHeightMm), footprintMm: [Number(fp[0]), Number(fp[1])], byAngle };
  }
  if (volume == null || area == null || !axis || Object.keys(candidates).length === 0) return { part: null, missing: [again] };
  return { part: { partVolumeMm3: volume, surfaceAreaMm2: area, measuredAxis: axis, candidates, cleaningFeatures: cleaningFeatures(m) }, missing: [] };
}

export interface AdditiveCostRequest {
  /** Additive Manufacturing or Rapid Prototyping (additive-domain.ts); Additive Manufacturing when not given. */
  domain?: AdditiveDomain;
  client: DbClient;
  accessToken: string;
  location: string;
  grade: string | null;
  build: AdditiveBuildSummary | null | undefined;
  /** A route to price instead of the chosen one (the route comparison prices each). */
  forceRoute?: string;
  overrides: Record<string, unknown> | null | undefined;
  batchSize: number;
  /** USD -> the location's currency. */
  usdToLocal: number;
  costContext: CostContext;
}

export interface AdditiveCostResult {
  domain: AdditiveDomain;
  /** The quoted route in the location's currency; null when none can be built (see `missing`). */
  route: AdditiveRoute | null;
  routes: AdditiveRoute[];
  gaps: AdditiveRouteGap[];
  note: string | null;
  missing: string[];
  warnings: string[];
}

/** One route in the location's currency (it is built in USD, the units of HR Rates and the reference data). */
function routeToLocal(route: AdditiveRoute, usdToLocal: number): AdditiveRoute {
  if (usdToLocal === 1) return route;
  return {
    ...route,
    lines: route.lines.map((l) => lineToLocal(l, usdToLocal)),
    material: { ...route.material, costUsd: route.material.costUsd * usdToLocal },
    totalUsd: route.totalUsd != null ? Math.round(route.totalUsd * usdToLocal * 100) / 100 : null,
  };
}

/** Each domain's calculator spec and its database calculators. */
const SPEC: Readonly<Record<AdditiveDomain['key'], () => DomainCalculatorSpec>> = {
  additive: loadAdditiveCalculatorSpec,
  rapid_prototyping: loadRapidPrototypingCalculatorSpec,
};

/**
 * Prices a part built layer by layer in its domain (Additive Manufacturing or Rapid Prototyping): loads the domain's reference data, its
 * calculators (from the database), the machines of the location and the material, builds every route (additive-route.ts) and returns them
 * in the location's currency.
 */
@Injectable()
export class AdditiveCostService {
  constructor(
    private readonly database: DatabaseService,
    private readonly machines: SandMachineService,
    private readonly catalog: CalculatorCatalogService,
  ) {}

  private readonly cached = new Map<string, SandReference>();

  /** The domain's staged variables and lookup tables (read once; a read error is reported and not cached). */
  async reference(domain: AdditiveDomain = ADDITIVE): Promise<{ reference: SandReference | null; missing: string[] }> {
    const hit = this.cached.get(domain.key);
    if (hit) return { reference: hit, missing: [] };
    const read = await readStagedReference(this.database, domain.reference.sourceVersion, domain.reference.label, domain.reference.stagedBy);
    if (read.reference) this.cached.set(domain.key, read.reference);
    return read;
  }

  private calculators(domain: AdditiveDomain, accessToken: string): Promise<ReferenceCalculators> {
    return domain.key === 'rapid_prototyping' ? this.catalog.loadRapidPrototypingCalculators(accessToken) : this.catalog.loadAdditiveCalculators(accessToken);
  }

  /**
   * The domain's material whose name or grade equals `name`, case-insensitively, with its build process: Additive Manufacturing's from its
   * staged additive_tblMaterialBuild row (with the powder's tapped density and recycling), Rapid Prototyping's from the material's own
   * `process` property (migration 855, memory/Rapid prototyping/Raw Materials Process). Null when it is not one of the domain's.
   */
  async getMaterial(client: DbClient, ref: SandReference, name: string | null, domain: AdditiveDomain = ADDITIVE): Promise<AdditiveMaterial | null> {
    const g = (name ?? '').trim();
    if (!g) return null;
    const { data, error } = await client.from('raw_materials')
      .select('id, name, grade, material_type, density_kg_m3, cost_usa')
      .eq('material_group', domain.materialGroup)
      .or(`name.ilike.${quoteFilterValue(escapeLikePattern(g))},grade.ilike.${quoteFilterValue(escapeLikePattern(g))}`)
      .limit(2);
    if (error || !data || data.length !== 1) return null;
    const row = data[0] as Record<string, unknown>;
    const grade = String(row.grade ?? row.name ?? '');
    const base = {
      id: String(row.id), name: String(row.name ?? grade), grade, materialType: row.material_type ? String(row.material_type) : null,
      densityKgM3: positive(row.density_kg_m3), costPerKgUsd: positive(row.cost_usa),
    };
    if (!domain.powderLookups) {
      const { data: props } = await client.from('raw_material_properties').select('value_text').eq('raw_material_id', base.id).eq('property_key', 'process').limit(1);
      const process = (props?.[0] as { value_text?: unknown } | undefined)?.value_text;
      return { ...base, process: process ? String(process) : null, tappedDensityKgM3: null, maxPowderCycles: null, recycleFraction: null };
    }
    const build = ref.table('additive_tblMaterialBuild').find((r) => r['Grade'] === grade);
    return {
      ...base, process: build?.['Process'] ? String(build['Process']) : null,
      tappedDensityKgM3: positive(build?.['Tapped Density (kg / m^3)']), maxPowderCycles: num(build?.['Max Powder Cycles']), recycleFraction: num(build?.['Recycle Percentage']),
    };
  }

  async price(req: AdditiveCostRequest): Promise<AdditiveCostResult> {
    const domain = req.domain ?? ADDITIVE;
    const warnings: string[] = [];
    const none = (...missing: string[]): AdditiveCostResult => ({ domain, route: null, routes: [], gaps: [], note: null, missing, warnings });
    const { part, missing: partMissing } = additivePart(req.build);
    if (!part) return none(...partMissing);
    const o = req.overrides ?? {};
    const [{ reference, missing: refMissing }, calculators, machines] = await Promise.all([
      this.reference(domain),
      this.calculators(domain, req.accessToken),
      this.machines.getMachinesByClass(req.client, domainMachineClasses(domain), req.location),
    ]);
    if (!reference) return none(...refMissing);
    const material = await this.getMaterial(req.client, reference, req.grade, domain);
    if (!material) return none(`"${req.grade ?? '(no material)'}" is not a ${domain.processGroup} material in Raw Materials (material group ${domain.materialGroup}): choose a powder, resin or jetting material in Material Grade`);
    if (!material.process && !domain.defaultMaterial?.matches(material)) {
      return none(`${material.name}: its build process is not recorded (${domain.powderLookups ? 'additive_tblMaterialBuild, migration 1072' : 'its process property, migration 855'})`);
    }
    const spec = SPEC[domain.key]();
    const absent = spec.calculators.filter((c) => !calculators[c.name]).map((c) => c.name);
    if (absent.length) return none(`the ${domain.processGroup} calculators are not in the database (run migration ${domain.calculatorsMigration}): ${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ', ...' : ''}`);
    if (!Object.values(machines).some((m) => m.length > 0)) return none(`HR Rates has no ${domain.processGroup} machines for ${req.location}`);
    if (req.location !== 'USA') warnings.push(`The material price is the reference's USA price (cost_usa): it holds none for ${req.location}.`);

    const keyOf = (v: unknown): AdditiveRouteKey | null => domain.routes.find((r) => r.key === v)?.key ?? null;
    const chosen = keyOf(req.forceRoute) ?? keyOf(o[ADDITIVE_ROUTE_KEY]);
    const axis = BUILD_AXES.find((a) => a === o[ADDITIVE_BUILD_DIRECTION_KEY]) ?? null;
    const { routes, gaps, missing } = buildAdditiveRoutes({
      domain, ref: reference, spec, calculators, material, part, machinesByClass: machines, costContext: req.costContext,
      scenario: { batchSize: req.batchSize, route: chosen, buildAxis: axis },
    });
    if (missing.length) return none(...missing);
    const { route, note } = chooseAdditiveRoute(domain, routes, gaps, chosen);
    if (!route) return { ...none(...gaps.map((g) => `${g.label}: ${g.reason}`)), gaps };
    const local = routes.map((r) => routeToLocal(r, req.usdToLocal));
    return { domain, route: local[routes.indexOf(route)]!, routes: local, gaps, note, missing: [], warnings: [...warnings, ...route.warnings] };
  }
}
