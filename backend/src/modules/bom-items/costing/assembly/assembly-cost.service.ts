import { Injectable } from '@nestjs/common';

import { ASSEMBLY_JOINTS_KEY, componentOf, deriveJoints, mergeJoints, type AssemblyComponent, type AssemblyJoint } from './assembly-joints';
import {
  ASSEMBLY_ROUTE_CLASSES, ASSEMBLY_ROUTES, buildAssemblyRoutes, chooseAssemblyRoute,
  type AssemblyRoute, type AssemblyRouteGap, type AssemblyRouteKey,
} from './assembly-route';
import { loadAssemblyCalculatorSpec } from './calculators/assembly-calculator-spec';
import { DatabaseService } from '../../../../common/database/database.service';
import { CalculatorCatalogService } from '../../services/calculator-catalog.service';
import { lineToLocal } from '../casting/sand/sand-cost';
import { SandMachineService } from '../casting/sand/sand-machine.service';
import { readStagedReference } from '../casting/sand/sand-reference.service';

import type { DbClient } from '../../../../common/db/postgrest-client';
import type { BOMItemResponseDto } from '../../dto/bom-item-response.dto';
import type { CostContext } from '../casting/casting-finishing';
import type { SandReference } from '../casting/sand/sand-reference';


const SOURCE_VERSION = '2026-Assembly';

/** The Cost Guide key of the assembly route. */
export const ASSEMBLY_ROUTE_KEY = 'assemblyRoute';

export interface AssemblyCostRequest {
  client: DbClient;
  accessToken: string;
  location: string;
  /** The assembly's BOM row: its own size, when the BOM gives one, is what the finished assembly is unloaded by. */
  item: Pick<BOMItemResponseDto, 'id' | 'name' | 'maxLength' | 'maxWidth' | 'maxHeight' | 'weight' | 'volume' | 'materialGrade' | 'featureGraph'>;
  /** Its direct children in the BOM. */
  children: readonly BOMItemResponseDto[];
  /** A material's density (kg/m³), or null: a component with no weight is weighed by its volume at it. */
  densityOf?: (grade: string) => Promise<number | null>;
  /** A route to price instead of the chosen one (the route comparison prices each). */
  forceRoute?: string;
  overrides: Record<string, unknown> | null | undefined;
  batchSize: number;
  /** USD -> the location's currency. */
  usdToLocal: number;
  costContext: CostContext;
}

export interface AssemblyCostResult {
  /** Its components are its BOM children, so its material is theirs (each in the BOM roll-up); false when it is its own one component. */
  materialOfParts: boolean;
  /** The quoted route in the location's currency; null when none can be built (see `missing`). */
  route: AssemblyRoute | null;
  routes: AssemblyRoute[];
  gaps: AssemblyRouteGap[];
  components: AssemblyComponent[];
  joints: AssemblyJoint[];
  note: string | null;
  missing: string[];
  warnings: string[];
}

/** One route in the location's currency (it is built in USD, the units of HR Rates and the reference data). */
function routeToLocal(route: AssemblyRoute, usdToLocal: number): AssemblyRoute {
  if (usdToLocal === 1) return route;
  return {
    ...route,
    lines: route.lines.map((l) => lineToLocal(l, usdToLocal)),
    consumablesUsd: route.consumablesUsd * usdToLocal,
    joints: route.joints.map((j) => ({ ...j, consumablesUsd: j.consumablesUsd * usdToLocal })),
    totalUsd: route.totalUsd != null ? Math.round(route.totalUsd * usdToLocal * 100) / 100 : null,
  };
}

/**
 * BOM items as components: each one's quantity, size, threaded holes and mass (its weight, else its volume at its material's density, each
 * material's density read once). Shared with insert molding, whose inserts are the molded part's children.
 */
export async function componentsOf(
  parts: ReadonlyArray<Parameters<typeof componentOf>[0]>, densityOf?: (grade: string) => Promise<number | null>,
): Promise<AssemblyComponent[]> {
  const density = new Map<string, number | null>();
  for (const g of new Set(parts.filter((p) => !(Number(p.weight) > 0) && Number(p.volume) > 0 && p.materialGrade).map((p) => p.materialGrade!))) {
    density.set(g, densityOf ? await densityOf(g) : null);
  }
  return parts.map((p) => componentOf(p, p.materialGrade ? density.get(p.materialGrade) ?? null : null));
}

/** The finished assembly's mass (its components') and size (its own, from the BOM, else its largest component's), with where they came from. */
export function finishedAssembly(item: AssemblyCostRequest['item'], components: readonly AssemblyComponent[]): { massKg: number | null; maxDimensionMm: number | null; sizeSource: string } {
  const massKg = components.every((c) => c.massKg != null) ? components.reduce((s, c) => s + c.massKg! * c.quantity, 0) : null;
  const own = [item.maxLength, item.maxWidth, item.maxHeight].map(Number).filter((d) => Number.isFinite(d) && d > 0);
  if (own.length) return { massKg, maxDimensionMm: Math.max(...own), sizeSource: `its size in the BOM, ${Math.max(...own)} mm` };
  const largest = Math.max(0, ...components.map((c) => c.maxDimensionMm ?? 0));
  return { massKg, maxDimensionMm: largest > 0 ? largest : null, sizeSource: `no size of its own in the BOM: its largest component's, ${largest} mm` };
}

/**
 * Prices an assembly's own work: loads the assembly reference data, the calculators (from the database) and the machines of the location,
 * reads its components and joints (assembly-joints.ts), builds every route (assembly-route.ts) and returns them in the location's currency.
 */
@Injectable()
export class AssemblyCostService {
  constructor(
    private readonly database: DatabaseService,
    private readonly machines: SandMachineService,
    private readonly catalog: CalculatorCatalogService,
  ) {}

  private cached: SandReference | null = null;

  /** The staged memory/Assembly variables and lookup tables (read once; a read error is reported and not cached). */
  async reference(): Promise<{ reference: SandReference | null; missing: string[] }> {
    if (this.cached) return { reference: this.cached, missing: [] };
    const read = await readStagedReference(this.database, SOURCE_VERSION, 'Assembly', 823);
    if (read.reference) this.cached = read.reference;
    return read;
  }

  async price(req: AssemblyCostRequest): Promise<AssemblyCostResult> {
    const o = req.overrides ?? {};
    // A part set to Assembly with no parts under it in the BOM is the one component: it is loaded, and its own threaded holes are screwed.
    const self = req.children.length === 0;
    const parts = self ? [{ ...req.item, quantity: 1 }] : req.children;
    const components = await componentsOf(parts, req.densityOf);
    const { joints, ignored } = mergeJoints(deriveJoints(components), o[ASSEMBLY_JOINTS_KEY]);
    const warnings = [...ignored, ...(self ? [`${req.item.name} has no parts under it in the BOM: it is costed as the one component, loaded and screwed into its own threaded holes.`] : [])];
    const none = (...missing: string[]): AssemblyCostResult => ({ materialOfParts: !self, route: null, routes: [], gaps: [], components, joints, note: null, missing, warnings });
    const [{ reference, missing: refMissing }, calculators, machines] = await Promise.all([
      this.reference(),
      this.catalog.loadAssemblyCalculators(req.accessToken),
      this.machines.getMachinesByClass(req.client, ASSEMBLY_ROUTE_CLASSES, req.location),
    ]);
    if (!reference) return none(...refMissing);
    const spec = loadAssemblyCalculatorSpec();
    const absent = spec.calculators.filter((c) => !calculators[c.name]).map((c) => c.name);
    if (absent.length) return none(`the assembly calculators are not in the database (run migration 1078): ${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ', ...' : ''}`);
    if (!Object.values(machines).some((m) => m.length > 0)) return none(`HR Rates has no assembly machines for ${req.location}`);

    const keyOf = (v: unknown): AssemblyRouteKey | null => ASSEMBLY_ROUTES.find((r) => r.key === v)?.key ?? null;
    const chosen = keyOf(req.forceRoute) ?? keyOf(o[ASSEMBLY_ROUTE_KEY]);
    const { routes, gaps, missing } = buildAssemblyRoutes({
      ref: reference, spec, calculators, components, joints, assembly: finishedAssembly(req.item, components), selfId: self ? req.item.id : null,
      machinesByClass: machines, batchSize: req.batchSize, costContext: req.costContext,
    });
    if (missing.length) return none(...missing);
    const { route, note } = chooseAssemblyRoute(routes, gaps, chosen);
    if (!route) return { ...none(...gaps.map((g) => `${g.label}: ${g.reason}`)), gaps };
    const local = routes.map((r) => routeToLocal(r, req.usdToLocal));
    return { materialOfParts: !self, route: local[routes.indexOf(route)], routes: local, gaps, components, joints, note, missing: [], warnings: [...warnings, ...route.warnings] };
  }
}
