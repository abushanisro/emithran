import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../../../common/db/postgrest-client';
import { escapeLikePattern, quoteFilterValue } from '../../../../../common/db/postgrest-filter';
import { CalculatorCatalogService } from '../../../services/calculator-catalog.service';
import type { CostContext } from '../casting-finishing';
import { loadSandCastingCalculatorSpec } from './calculators/sand-casting-calculator-spec';
import { SAND_MATERIAL_COLUMNS, sandMaterialFromRow, sandPart, sandRouteToLocal, sandScenario, type SandMeasurements } from './sand-cost';
import { SandMachineService } from './sand-machine.service';
import { SandReferenceService } from './sand-reference.service';
import { buildSandRoute, MOULDING_PROCESSES, type SandRoute } from './sand-route';
import type { SandMaterial } from './sand-steps';
import { CORE_PROCESSES } from './sand-cores';

const SAND_MATERIAL_GROUP = 'Sand Casting';
/** Every machine class the route can use. */
const ROUTE_CLASSES = [
  ...MOULDING_PROCESSES.map((p) => p.machineClass),
  ...CORE_PROCESSES.map((p) => p.machineClass),
  'sand_casting_melting', 'sand_casting_pour', 'sand_casting_cooling', 'sand_casting_shakeout', 'sand_casting_degating',
  'sand_casting_cleaning', 'sand_casting_finishing', 'sand_casting_visual_inspection',
];

export interface SandCostRequest {
  client: DbClient;
  accessToken: string;
  location: string;
  grade: string | null;
  measurements: SandMeasurements;
  overrides: Record<string, unknown> | null | undefined;
  batchSize: number;
  annualVolume: number | null;
  productionLifeYears: number | null;
  /** USD -> the location's currency. */
  usdToLocal: number;
  costContext: CostContext;
}

export interface SandCostResult {
  /** The route in the location's currency; null when it cannot be built (see `missing`). */
  route: SandRoute | null;
  missing: string[];
  warnings: string[];
}

/**
 * Prices a sand casting: loads the reference data, the calculators (from the database), the machines of the location and the material, builds the
 * route (sand-route.ts) and returns it in the location's currency. Nothing is read twice in a request (the loaders are cached per request).
 */
@Injectable()
export class SandCostService {
  constructor(
    private readonly reference: SandReferenceService,
    private readonly machines: SandMachineService,
    private readonly catalog: CalculatorCatalogService,
  ) {}

  /** The sand material whose name or grade equals the BOM item's material grade, case-insensitively; null when the grade is not a sand material. */
  async getMaterial(client: DbClient, grade: string | null): Promise<SandMaterial | null> {
    const g = (grade ?? '').trim();
    if (!g) return null;
    const { data, error } = await client
      .from('raw_materials')
      .select(['name', 'grade', 'material_type', ...SAND_MATERIAL_COLUMNS].join(', '))
      .eq('material_group', SAND_MATERIAL_GROUP)
      .or(`name.ilike.${quoteFilterValue(escapeLikePattern(g))},grade.ilike.${quoteFilterValue(escapeLikePattern(g))}`)
      .limit(2);
    if (error || !data || data.length !== 1) return null;
    return sandMaterialFromRow(data[0] as Record<string, any>);
  }

  async price(req: SandCostRequest): Promise<SandCostResult> {
    const warnings: string[] = [];
    const none = (...missing: string[]): SandCostResult => ({ route: null, missing, warnings });
    const { part, warnings: partWarnings, missing: partMissing } = sandPart(req.measurements);
    warnings.push(...partWarnings);
    if (!part) return none(...partMissing);
    const [{ reference, missing: refMissing }, calculators, machines, material] = await Promise.all([
      this.reference.get(),
      this.catalog.loadSandCastingCalculators(req.accessToken),
      this.machines.getMachinesByClass(req.client, ROUTE_CLASSES, req.location),
      this.getMaterial(req.client, req.grade),
    ]);
    if (!reference) return none(...refMissing);
    if (!material) return none(`"${req.grade ?? '(no material)'}" is not a sand-casting material in Raw Materials (material group ${SAND_MATERIAL_GROUP})`);
    const spec = loadSandCastingCalculatorSpec();
    const absent = spec.calculators.filter((c) => !calculators[c.name]).map((c) => c.name);
    if (absent.length) return none(`the sand calculators are not in the database (run migration 956): ${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ', ...' : ''}`);
    const { scenario, warnings: scenarioWarnings } = sandScenario({ overrides: req.overrides, batchSize: req.batchSize, annualVolume: req.annualVolume, productionLifeYears: req.productionLifeYears });
    warnings.push(...scenarioWarnings);
    const { route, missing } = buildSandRoute({ ref: reference, spec, calculators, material, part, machinesByClass: machines, scenario, costContext: req.costContext });
    if (!route) return none(...missing);
    return { route: sandRouteToLocal(route, req.usdToLocal), missing: [], warnings: [...warnings, ...route.warnings] };
  }
}
