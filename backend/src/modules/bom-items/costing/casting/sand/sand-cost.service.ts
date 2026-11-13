import { sandFeaturesFromCastingResult, type SandFeature } from './sand-catalog-operations';
import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../../../common/db/postgrest-client';
import { escapeLikePattern, quoteFilterValue } from '../../../../../common/db/postgrest-filter';
import { CalculatorCatalogService } from '../../../services/calculator-catalog.service';
import type { CostContext } from '../casting-finishing';
import { loadSandCastingCalculatorSpec } from './calculators/sand-casting-calculator-spec';
import { measurementsFromCastingResult } from '../../../../sand-casting/casting-measurements';
import { evaluateSandDfm, type DfmResult } from '../../../../sand-casting/sand-dfm';
import { SandCastingService } from '../../../../sand-casting/sand-casting.service';
import { SAND_MATERIAL_COLUMNS, sandMaterialFromRow, sandPart, sandRouteToLocal, sandScenario, type LocationElectricity, type SandMeasurements } from './sand-cost';
import { SandMachineService } from './sand-machine.service';
import { SandReferenceService } from './sand-reference.service';
import { SAND_CASTING_SOURCE_VERSION } from './sand-reference';
import { REFRACTORY_CLASSES } from './sand-refractory';
import { overridesMap } from './sand-variable-overrides';
import { SandVariableOverridesService } from './sand-variable-overrides.service';
import { buildSandRoute, MOULDING_PROCESSES, type SandRoute } from './sand-route';
import type { SandMaterial } from './sand-steps';
import { CORE_PROCESSES } from './sand-cores';

const SAND_MATERIAL_GROUP = 'Sand Casting';
/** Every machine class the route can use. */
const ROUTE_CLASSES = [
  ...REFRACTORY_CLASSES,
  ...MOULDING_PROCESSES.map((p) => p.machineClass),
  ...CORE_PROCESSES.map((p) => p.machineClass),
  'sand_casting_melting', 'sand_casting_pour', 'sand_casting_cooling', 'sand_casting_shakeout', 'sand_casting_degating',
  'sand_casting_cleaning', 'sand_casting_finishing', 'sand_casting_visual_inspection',
];

export interface SandDfmView {
  status: 'ok' | 'no_analysis' | 'unavailable';
  result: DfmResult | null;
  /** Why there is no result, or what limits it. */
  reasons: string[];
}

export interface SandCostRequest {
  client: DbClient;
  accessToken: string;
  location: string;
  grade: string | null;
  /** The cad-engine's casting measurements: used when the BOM item has no casting analysis (or it cannot be used). */
  measurements: SandMeasurements;
  /** The BOM item and its current 3D file path: a casting analysis of that file, when there is one, measures the part instead. */
  bomItemId: string;
  sourcePath: string | null;
  overrides: Record<string, unknown> | null | undefined;
  batchSize: number;
  annualVolume: number | null;
  productionLifeYears: number | null;
  /** USD -> the location's currency. */
  usdToLocal: number;
  /** An amount in a currency -> USD with the app's exchange rates; null when there is no rate (prices the location's electricity). */
  toUsd: (value: number, currency: string) => number | null;
  costContext: CostContext;
}

export interface SandCostResult {
  /** Where the measurements came from: the casting worker's analysis of the exact solid, or the cad-engine's. */
  measuredBy: 'casting analysis' | 'cad-engine';
  /** The route in the location's currency; null when it cannot be built (see `missing`). */
  route: SandRoute | null;
  missing: string[];
  warnings: string[];
  /** The casting analysis's features with the core that forms each, when it measured the part; else absent (the cad-engine's features carry no core links). */
  analysisFeatures?: SandFeature[];
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
    private readonly analyses: SandCastingService,
  ) {}

  /** The location's sourced electricity price (location_electricity_prices, migration 1004); null when it has none or it cannot be read. */
  async electricityOf(client: DbClient, location: string): Promise<LocationElectricity | null> {
    const { data, error } = await client.from('location_electricity_prices').select('price_per_kwh, currency, basis').eq('location', location).maybeSingle();
    if (error || !data) return null;
    const row = data as { price_per_kwh: number | string; currency: string; basis: string };
    return { pricePerKwh: Number(row.price_per_kwh), currency: row.currency, basis: row.basis };
  }

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

  /**
   * The design-for-casting checks of the item's casting analysis (sand-dfm.ts), against the part's sand material type. Without an analysis of the
   * current file there is nothing to judge: that is said, never shown as a pass.
   */
  async dfm(req: { bomItemId: string; sourcePath: string | null; grade: string | null; client: DbClient; accessToken: string }): Promise<SandDfmView> {
    const analysis = await this.analyses.latestResult(req.bomItemId, req.sourcePath, req.accessToken);
    if (!analysis) return { status: 'no_analysis', result: null, reasons: ['There is no casting analysis of the current file: request one.'] };
    const { reference, missing } = await this.reference.get();
    if (!reference) return { status: 'unavailable', result: null, reasons: missing };
    const material = await this.getMaterial(req.client, req.grade);
    const out = evaluateSandDfm(analysis.result, material?.materialType ?? null, {
      severity: reference.table('manufacturabilitySeverity'),
      adviceRules: reference.table('adviceRules'),
      version: SAND_CASTING_SOURCE_VERSION,
    });
    if ('reason' in out) return { status: 'unavailable', result: null, reasons: [out.reason] };
    const reasons = material ? [] : [`"${req.grade ?? '(no material)'}" is not a sand-casting material in Raw Materials: rules that depend on the material are not evaluated`];
    return { status: 'ok', result: out, reasons };
  }

  async price(req: SandCostRequest): Promise<SandCostResult> {
    const warnings: string[] = [];
    let measuredBy: SandCostResult['measuredBy'] = 'cad-engine';
    let analysisFeatures: SandFeature[] | undefined;
    const none = (...missing: string[]): SandCostResult => ({ measuredBy, route: null, missing, warnings, ...(analysisFeatures ? { analysisFeatures } : {}) });
    // The casting analysis (the C++ worker, on the exact solid) measures the part when there is one for the current file; otherwise the cad-engine does.
    let measurements = req.measurements;
    const analysis = await this.analyses.latestResult(req.bomItemId, req.sourcePath, req.accessToken);
    if (analysis) {
      const fromAnalysis = measurementsFromCastingResult(analysis.result);
      if (fromAnalysis.measurements) {
        measurements = fromAnalysis.measurements;
        measuredBy = 'casting analysis';
        analysisFeatures = sandFeaturesFromCastingResult(analysis.result) ?? undefined;
        warnings.push(`Measured by the casting analysis (worker ${analysis.workerVersion}) on the exact solid.`);
      } else {
        warnings.push(`The casting analysis could not be used (${fromAnalysis.missing.join('; ')}): the cad-engine's measurements are used.`);
      }
    }
    if (measuredBy === 'cad-engine') warnings.push('Measured by the cad-engine; request a casting analysis for the exact cores, parting line and wall.');
    const { part, warnings: partWarnings, missing: partMissing } = sandPart(measurements);
    warnings.push(...partWarnings);
    if (!part) return none(...partMissing);
    const [{ reference, missing: refMissing }, calculators, machines, material] = await Promise.all([
      this.reference.get(),
      this.catalog.loadSandCastingCalculators(req.accessToken),
      this.machines.getMachinesByClass(req.client, ROUTE_CLASSES, req.location),
      this.getMaterial(req.client, req.grade),
    ]);
    if (!reference) return none(...refMissing);
    // The part's own values for plant variables, laid over the shared reference for this one calculation.
    const partOverrides = overridesMap(await SandVariableOverridesService.rows(req.client, req.bomItemId));
    const ref = reference.withOverrides(partOverrides);
    if (partOverrides.size > 0) {
      warnings.push(`Calculated with ${partOverrides.size} plant variable${partOverrides.size === 1 ? '' : 's'} set for this part: ${[...partOverrides.keys()].join(', ')}.`);
    }
    if (!material) return none(`"${req.grade ?? '(no material)'}" is not a sand-casting material in Raw Materials (material group ${SAND_MATERIAL_GROUP})`);
    const spec = loadSandCastingCalculatorSpec();
    const absent = spec.calculators.filter((c) => !calculators[c.name]).map((c) => c.name);
    if (absent.length) return none(`the sand calculators are not in the database (run migration 956): ${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ', ...' : ''}`);
    const { scenario, warnings: scenarioWarnings } = sandScenario({
      overrides: req.overrides, batchSize: req.batchSize, annualVolume: req.annualVolume, productionLifeYears: req.productionLifeYears,
      location: req.location, locationElectricity: await this.electricityOf(req.client, req.location), toUsd: req.toUsd,
    });
    warnings.push(...scenarioWarnings);
    const { route, missing } = buildSandRoute({ ref, spec, calculators, material, part, machinesByClass: machines, scenario, costContext: req.costContext });
    if (!route) return none(...missing);
    return { measuredBy, route: sandRouteToLocal(route, req.usdToLocal), missing: [], warnings: [...warnings, ...route.warnings], ...(analysisFeatures ? { analysisFeatures } : {}) };
  }
}
