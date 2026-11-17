import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../../../common/db/postgrest-client';
import { escapeLikePattern, quoteFilterValue } from '../../../../../common/db/postgrest-filter';
import { CalculatorCatalogService } from '../../../services/calculator-catalog.service';
import { loadLocationElectricity } from '../../shared/location-electricity';
import type { CostContext } from '../casting-finishing';
import { energyPrice, lineToLocal } from '../sand/sand-cost';
import { SandMachineService } from '../sand/sand-machine.service';
import type { SandReference } from '../sand/sand-reference';
import type { SandMaterial } from '../sand/sand-steps';
import { loadInvestmentCastingCalculatorSpec } from './calculators/investment-casting-calculator-spec';
import { INVESTMENT_PROCESS_GROUP, INVESTMENT_ROUTE_CLASSES } from './investment-reference';
import { InvestmentReferenceService } from './investment-reference.service';
import { buildInvestmentRoute, type InvestmentPart, type InvestmentRoute } from './investment-route';

/** The alloy's physical properties the route reads (raw_material_properties keys of the investment casting alloys). */
const PROPERTY_KEYS = ['heat_of_fusion', 'specific_heat_rt', 'liquidus_temp', 'pour_temp'] as const;
/** The Cost Guide keys of an investment casting, shared with the other casting routes: all optional. */
const SCENARIO_KEYS = { energyPrice: 'energyPriceUsdPerKwh', cavities: 'cavityCount' } as const;

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

export interface InvestmentCostRequest {
  client: DbClient;
  accessToken: string;
  location: string;
  grade: string | null;
  /** The part as the cad-engine measured it. */
  measurements: { volumeMm3: number | null; surfaceAreaMm2: number | null; bboxMm: readonly number[]; wallMaxMm: number | null; wallNominalMm: number | null; slides: number };
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

export interface InvestmentCostResult {
  /** The route in the location's currency; null when it cannot be built (see `missing`). */
  route: InvestmentRoute | null;
  missing: string[];
  warnings: string[];
}

/** The part as the route takes it, or what the measurements lack. */
export function investmentPart(m: InvestmentCostRequest['measurements']): { part: InvestmentPart | null; missing: string[] } {
  const missing: string[] = [];
  if (!(m.volumeMm3 != null && m.volumeMm3 > 0)) missing.push('the part volume');
  if (!(m.surfaceAreaMm2 != null && m.surfaceAreaMm2 > 0)) missing.push('the part surface area');
  const box = [...m.bboxMm].filter((v) => v > 0).sort((a, b) => b - a);
  if (box.length < 3) missing.push('the part size');
  if (missing.length) return { part: null, missing };
  return {
    missing: [],
    part: { volumeMm3: m.volumeMm3!, surfaceAreaMm2: m.surfaceAreaMm2!, dimsMm: [box[0]!, box[1]!, box[2]!], wallMm: positive(m.wallMaxMm) ?? positive(m.wallNominalMm), slides: m.slides },
  };
}

/**
 * The alloy's price for the location in USD per kg: India's from the staged India price list of the investment casting alloys, else the USA
 * price, said to be that when the location is not the USA.
 */
export function alloyPrice(ref: SandReference, material: SandMaterial, location: string): { usdPerKg: number | null; source: string; warning: string | null } {
  const usa = material.columns['cost_usa'] ?? null;
  if (location === 'USA') return { usdPerKg: usa, source: 'cost_usa (USA price)', warning: null };
  if (location === 'India') {
    const row = ref.table('raw_material_cost_master').find((r) => String(r['Material Name']).toLowerCase() === material.name.toLowerCase());
    const india = positive(row?.['Unit Cost (USD/kg)']);
    if (india != null) return { usdPerKg: india, source: 'India price (raw_material_cost_master)', warning: null };
  }
  return { usdPerKg: usa, source: 'cost_usa (USA price)', warning: `${material.name} has no ${location} price in the investment casting data: the metal is priced at its USA price.` };
}

/** One route in the location's currency (it is built in USD, the units of HR Rates and the reference data). The wax pattern die stays in USD, as every tool investment of a summary is. */
function routeToLocal(route: InvestmentRoute, usdToLocal: number): InvestmentRoute {
  if (usdToLocal === 1) return route;
  const k = (v: number) => Math.round(v * usdToLocal * 100) / 100;
  return {
    ...route,
    lines: route.lines.map((l) => lineToLocal(l, usdToLocal)),
    material: { ...route.material, costUsd: route.material.costUsd != null ? k(route.material.costUsd) : null },
    totalUsd: route.totalUsd != null ? k(route.totalUsd) : null,
  };
}

/**
 * Prices an investment casting: loads the reference data, the calculators (from the database), the machines of the location and the alloy,
 * builds the route (investment-route.ts) and returns it in the location's currency.
 */
@Injectable()
export class InvestmentCostService {
  constructor(
    private readonly reference: InvestmentReferenceService,
    private readonly machines: SandMachineService,
    private readonly catalog: CalculatorCatalogService,
  ) {}

  /** The investment casting alloy whose name or grade equals the BOM item's material grade, case-insensitively; null when the grade is not one. */
  async getMaterial(client: DbClient, grade: string | null): Promise<SandMaterial | null> {
    const g = (grade ?? '').trim();
    if (!g) return null;
    const { data, error } = await client.from('raw_materials')
      .select('id, name, grade, material_type, density_kg_m3, cost_usa')
      .eq('material_group', INVESTMENT_PROCESS_GROUP)
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
      columns: { density_kg_m3: num(row.density_kg_m3), cost_usa: num(row.cost_usa), ...Object.fromEntries(PROPERTY_KEYS.map((k) => [k, properties[k] ?? null])) },
    };
  }

  async price(req: InvestmentCostRequest): Promise<InvestmentCostResult> {
    const warnings: string[] = [];
    const none = (...missing: string[]): InvestmentCostResult => ({ route: null, missing, warnings });
    const { part, missing: partMissing } = investmentPart(req.measurements);
    if (!part) return none(...partMissing);
    const [{ reference, missing: refMissing }, calculators, machines, alloy, electricity] = await Promise.all([
      this.reference.get(),
      this.catalog.loadInvestmentCastingCalculators(req.accessToken),
      this.machines.getMachinesByClass(req.client, INVESTMENT_ROUTE_CLASSES, req.location),
      this.getMaterial(req.client, req.grade),
      loadLocationElectricity(req.client, req.location),
    ]);
    if (!reference) return none(...refMissing);
    if (!alloy) return none(`"${req.grade ?? '(no material)'}" is not an investment casting alloy in Raw Materials (material group ${INVESTMENT_PROCESS_GROUP}): choose one in Material Grade`);
    const spec = loadInvestmentCastingCalculatorSpec();
    const absent = spec.calculators.filter((c) => !calculators[c.name]).map((c) => c.name);
    if (absent.length) return none(`the investment casting calculators are not in the database (run migration 1046): ${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ', ...' : ''}`);
    if (!Object.values(machines).some((m) => m.length > 0)) return none(`HR Rates has no investment casting machines for ${req.location}`);

    const price = alloyPrice(reference, alloy, req.location);
    if (price.warning) warnings.push(price.warning);
    const o = req.overrides ?? {};
    const energy = energyPrice(positive(o[SCENARIO_KEYS.energyPrice]), req.location, electricity, req.toUsd, warnings);
    const cavities = num(o[SCENARIO_KEYS.cavities]);
    const lifetime = req.annualVolume != null && req.productionLifeYears != null && req.annualVolume > 0 && req.productionLifeYears > 0 ? req.annualVolume * req.productionLifeYears : null;
    const { route, missing } = buildInvestmentRoute({
      ref: reference, spec, calculators, part, machinesByClass: machines, costContext: req.costContext,
      material: { ...alloy, columns: { ...alloy.columns, price_usd_per_kg: price.usdPerKg } }, priceSource: price.source,
      scenario: {
        batchSize: req.batchSize, cavities: cavities != null && Number.isInteger(cavities) && cavities > 0 ? cavities : null,
        energyPricePerKwh: energy?.usdPerKwh ?? null, energyPriceSource: energy?.source ?? null, lifetimeVolume: lifetime,
      },
    });
    if (!route) return none(...missing);
    return { route: routeToLocal(route, req.usdToLocal), missing: [], warnings: [...warnings, ...route.warnings] };
  }
}
