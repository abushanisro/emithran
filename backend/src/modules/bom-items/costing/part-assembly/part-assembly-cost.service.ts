import { Injectable } from '@nestjs/common';

import { loadPartAssemblyCalculatorSpec } from './calculators/part-assembly-calculator-spec';
import {
  PART_ASSEMBLY_PROCESS_GROUP, PART_ASSEMBLY_ROUTE_CLASSES, PART_ASSEMBLY_ROUTES, buildPartAssemblyRoutes, choosePartAssemblyRoute, laserFamilyOf,
  type PartAssemblyRoute, type PartAssemblyRouteGap, type PartAssemblyRouteKey,
} from './part-assembly-route';
import { PART_ASSEMBLY_WELDS_KEY, weldTable, type PartAssemblyWeld } from './part-assembly-welds';
import { DatabaseService } from '../../../../common/database/database.service';
import { escapeLikePattern, quoteFilterValue } from '../../../../common/db/postgrest-filter';
import { CalculatorCatalogService } from '../../services/calculator-catalog.service';
import { componentsOf, finishedAssembly } from '../assembly/assembly-cost.service';
import { lineToLocal } from '../casting/sand/sand-cost';
import { SandMachineService } from '../casting/sand/sand-machine.service';
import { readStagedReference } from '../casting/sand/sand-reference.service';
import { preferredCutCode } from '../shared/core/cut-code';

import type { DbClient } from '../../../../common/db/postgrest-client';
import type { BOMItemResponseDto } from '../../dto/bom-item-response.dto';
import type { AssemblyComponent } from '../assembly/assembly-joints';
import type { CostContext } from '../casting/casting-finishing';
import type { SandReference } from '../casting/sand/sand-reference';

const SOURCE_VERSION = '2026-PartAssembly';

/** The Cost Guide key of the Part Assembly route. */
export const PART_ASSEMBLY_ROUTE_KEY = 'partAssemblyRoute';

export interface PartAssemblyCostRequest {
  client: DbClient;
  accessToken: string;
  location: string;
  /** The weldment's BOM row: its material and plate thickness when its parts give none, its own mass when it has no parts. */
  item: Pick<BOMItemResponseDto, 'id' | 'name' | 'maxLength' | 'maxWidth' | 'maxHeight' | 'weight' | 'volume' | 'materialGrade' | 'featureGraph' | 'sheetThicknessMm'>;
  /** Its direct children in the BOM: the components welded together. */
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

export interface PartAssemblyCostResult {
  /** Its components are its BOM children, so its material is theirs (each in the BOM roll-up); false when it is its own one component. */
  materialOfParts: boolean;
  /** The quoted route in the location's currency; null when none can be built (see `missing`). */
  route: PartAssemblyRoute | null;
  routes: PartAssemblyRoute[];
  gaps: PartAssemblyRouteGap[];
  components: AssemblyComponent[];
  welds: PartAssemblyWeld[];
  weldment: { massKg: number | null };
  thickness: { mm: number | null; source: string };
  material: { name: string | null; cutCodeFamily: string | null };
  note: string | null;
  missing: string[];
  warnings: string[];
}

/** One route in the location's currency (it is built in USD, the units of HR Rates and the reference data). */
function routeToLocal(route: PartAssemblyRoute, usdToLocal: number): PartAssemblyRoute {
  if (usdToLocal === 1) return route;
  return {
    ...route,
    lines: route.lines.map((l) => lineToLocal(l, usdToLocal)),
    wireUsd: route.wireUsd * usdToLocal,
    totalUsd: route.totalUsd != null ? Math.round(route.totalUsd * usdToLocal * 100) / 100 : null,
  };
}

/**
 * The plate thickness a weld that states none is made at: the components' sheet thickness when they all give the same one, else the
 * weldment's own; with where it came from. Components of different gauges leave it to each weld.
 */
export function weldmentThickness(item: { sheetThicknessMm?: number | undefined }, children: readonly { name: string; sheetThicknessMm?: number | undefined }[]): { mm: number | null; source: string } {
  const gauges = [...new Set(children.map((c) => c.sheetThicknessMm).filter((t): t is number => t != null && t > 0))];
  if (gauges.length === 1) return { mm: gauges[0], source: `the components' sheet thickness, ${gauges[0]} mm` };
  if (gauges.length > 1) return { mm: null, source: `the components are ${gauges.sort((a, b) => a - b).join(', ')} mm: set each weld's thickness` };
  if (item.sheetThicknessMm != null && item.sheetThicknessMm > 0) return { mm: item.sheetThicknessMm, source: `the weldment's sheet thickness, ${item.sheetThicknessMm} mm` };
  return { mm: null, source: 'no sheet thickness on the weldment or its parts: set each weld\'s thickness' };
}

/** The weldment's material: its own, else its components' when they all share one. */
export function weldmentMaterial(item: { materialGrade?: string | undefined }, components: readonly AssemblyComponent[]): string | null {
  if (item.materialGrade?.trim()) return item.materialGrade.trim();
  const materials = [...new Set(components.map((c) => c.material?.trim()).filter((m): m is string => !!m))];
  return materials.length === 1 ? materials[0] : null;
}

/**
 * Prices a weldment's welding: loads the Part Assembly reference data, the calculators (from the database) and the machines of the
 * location, reads its components and weld table, builds every route (part-assembly-route.ts) and returns them in the location's currency.
 */
@Injectable()
export class PartAssemblyCostService {
  constructor(
    private readonly database: DatabaseService,
    private readonly machines: SandMachineService,
    private readonly catalog: CalculatorCatalogService,
  ) {}

  private cached: SandReference | null = null;

  /** The staged memory/Part Assembly variables and lookup tables (read once; a read error is reported and not cached). */
  async reference(): Promise<{ reference: SandReference | null; missing: string[] }> {
    if (this.cached) return { reference: this.cached, missing: [] };
    const read = await readStagedReference(this.database, SOURCE_VERSION, PART_ASSEMBLY_PROCESS_GROUP, 823);
    if (read.reference) this.cached = read.reference;
    return read;
  }

  /** The cut code of a material (raw_materials, by name or grade; preferredCutCode across the groups listing it), or null. */
  private async cutCodeOf(client: DbClient, material: string | null): Promise<number | null> {
    const g = material?.trim();
    if (!g) return null;
    const { data, error } = await client.from('raw_materials')
      .select('cut_code, material_group')
      .or(`name.ilike.${quoteFilterValue(escapeLikePattern(g))},grade.ilike.${quoteFilterValue(escapeLikePattern(g))}`)
      .not('cut_code', 'is', null)
      .limit(100);
    if (error) return null;
    return preferredCutCode(data.map((r) => ({
      cutCode: r.cut_code == null ? null : Number(r.cut_code), group: r.material_group == null ? null : String(r.material_group),
    })));
  }

  async price(req: PartAssemblyCostRequest): Promise<PartAssemblyCostResult> {
    const o = req.overrides ?? {};
    // A part set to Part Assembly with no parts under it in the BOM is the one component: it is loaded and its welds made.
    const self = req.children.length === 0;
    const parts = self ? [{ ...req.item, quantity: 1 }] : req.children;
    const components = await componentsOf(parts, req.densityOf);
    const { welds, ignored } = weldTable(o[PART_ASSEMBLY_WELDS_KEY]);
    const thickness = weldmentThickness(req.item, self ? [] : req.children);
    const materialName = weldmentMaterial(req.item, components);
    const weldment = { massKg: finishedAssembly(req.item, components).massKg };
    const warnings = [...ignored, ...(self ? [`${req.item.name} has no parts under it in the BOM: it is costed as the one component, loaded and welded; its material is not priced here.`] : [])];
    const [{ reference, missing: refMissing }, calculators, machines, cutCode] = await Promise.all([
      this.reference(),
      this.catalog.loadPartAssemblyCalculators(req.accessToken),
      this.machines.getMachinesByClass(req.client, PART_ASSEMBLY_ROUTE_CLASSES, req.location),
      this.cutCodeOf(req.client, materialName),
    ]);
    const material = {
      name: materialName,
      cutCodeFamily: reference ? laserFamilyOf(reference, cutCode) : null,
    };
    const none = (...missing: string[]): PartAssemblyCostResult => ({ materialOfParts: !self, route: null, routes: [], gaps: [], components, welds, weldment, thickness, material, note: null, missing, warnings });
    if (!reference) return none(...refMissing);
    const spec = loadPartAssemblyCalculatorSpec();
    const absent = spec.calculators.filter((c) => !Object.hasOwn(calculators, c.name)).map((c) => c.name);
    if (absent.length) return none(`the Part Assembly calculators are not in the database (run migration 1100): ${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ', ...' : ''}`);
    if (!Object.values(machines).some((m) => m.length > 0)) return none(`HR Rates has no Part Assembly machines for ${req.location}`);

    const keyOf = (v: unknown): PartAssemblyRouteKey | null => PART_ASSEMBLY_ROUTES.find((r) => r.key === v)?.key ?? null;
    const chosen = keyOf(req.forceRoute) ?? keyOf(o[PART_ASSEMBLY_ROUTE_KEY]);
    const { routes, gaps, missing } = buildPartAssemblyRoutes({
      ref: reference, spec, calculators, components, welds, weldment, thickness, material,
      machinesByClass: machines, batchSize: req.batchSize, costContext: req.costContext,
    });
    if (missing.length) return none(...missing);
    const { route, note } = choosePartAssemblyRoute(routes, gaps, chosen);
    if (!route) return { ...none(...gaps.map((g) => `${g.label}: ${g.reason}`)), gaps };
    const local = routes.map((r) => routeToLocal(r, req.usdToLocal));
    return { materialOfParts: !self, route: local[routes.indexOf(route)], routes: local, gaps, components, welds, weldment, thickness, material, note, missing: [], warnings: [...warnings, ...route.warnings] };
  }
}
