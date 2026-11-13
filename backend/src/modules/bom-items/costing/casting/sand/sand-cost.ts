// What the cost summary needs of a sand casting, around the pure route (sand-route.ts): the scenario the user set, the part's measurements as the
// route takes them, the material row, and the route's costs in the location's currency. Pure.
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CoreRegion } from './sand-cores';
import { COAT_CHOICES, DRY_METHODS } from './sand-refractory';
import { MOULDING_PROCESSES, type SandPartInput, type SandRoute, type SandScenario } from './sand-route';
import type { SandMaterial } from './sand-steps';

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

/** The scenario keys of a sand casting (Cost Guide): all optional, nothing is assumed when one is unset. */
export const SAND_SCENARIO_KEYS = {
  mouldingProcess: 'sandMouldingProcess',
  coreProcess: 'sandCoreProcess',
  energyPrice: 'energyPriceUsdPerKwh',
  cavities: 'cavityCount',
  // The plant's hot box settings: the core box temperature, the binder's cure temperature and the depth of core cured before it is stripped.
  hotBoxCoreboxTemp: 'hotBoxCoreboxTempC',
  hotBoxCureTemp: 'hotBoxCureTempC',
  hotBoxCuredDepth: 'hotBoxCuredDepthMm',
  // The refractory coating (none unless chosen), how it is dried, the plant's drying time for a load, and the coating's price.
  refractoryCoat: 'sandRefractoryCoat',
  refractoryDryMethod: 'sandRefractoryDryMethod',
  refractoryDryMinutes: 'sandRefractoryDryMinutes',
  refractoryCoatPrice: 'refractoryCoatingUsdPerKg',
} as const;

/**
 * The scenario as the route takes it. The core-box tooling is amortised over annual volume x production life; with either missing there is
 * no lifetime volume (null), and the tooling is not costed rather than spread over a made-up volume.
 */
/** A location's electricity price as stored (location_electricity_prices, migration 1004): in its own currency, with its source. */
export interface LocationElectricity { pricePerKwh: number; currency: string; basis: string }

const p4 = (n: number) => String(Math.round(n * 10000) / 10000);

/**
 * The energy price the route charges: the Cost Guide's for this part, else the location's sourced electricity price converted to USD, else
 * none (energy is then not charged, and each line says so). Never assumed.
 */
function energyPrice(override: number | null, location: string | undefined, row: LocationElectricity | null | undefined, toUsd: (value: number, currency: string) => number | null, warnings: string[]): { usdPerKwh: number; source: string } | null {
  if (override != null) return { usdPerKwh: override, source: 'energy price set in the Cost Guide (USD/kWh)' };
  if (!row) return null;
  const usd = row.currency === 'USD' ? row.pricePerKwh : toUsd(row.pricePerKwh, row.currency);
  if (usd == null || !(usd > 0)) {
    warnings.push(`The ${location ?? 'location'} electricity price is in ${row.currency}, which has no exchange rate to USD: energy is not charged.`);
    return null;
  }
  const converted = row.currency === 'USD' ? '' : ` = ${p4(usd)} USD/kWh`;
  return { usdPerKwh: usd, source: `${location ?? 'location'} electricity price: ${p4(row.pricePerKwh)} ${row.currency}/kWh (${row.basis})${converted}` };
}

export function sandScenario(input: {
  overrides: Record<string, unknown> | null | undefined;
  batchSize: number;
  annualVolume: number | null;
  productionLifeYears: number | null;
  /** The Digital Factory location and its electricity price (null when the location has none). */
  location?: string;
  locationElectricity?: LocationElectricity | null;
  /** Converts an amount in a currency to USD with the app's exchange rates; null when there is no rate. */
  toUsd?: (value: number, currency: string) => number | null;
}): { scenario: Omit<SandScenario, 'lifetimeVolume'> & { lifetimeVolume: number | null }; warnings: string[] } {
  const o = input.overrides ?? {};
  const processName = typeof o[SAND_SCENARIO_KEYS.mouldingProcess] === 'string' ? (o[SAND_SCENARIO_KEYS.mouldingProcess] as string) : null;
  const mouldingClass = MOULDING_PROCESSES.find((p) => p.process === processName)?.machineClass ?? null;
  const cavity = num(o[SAND_SCENARIO_KEYS.cavities]);
  const lifetime = input.annualVolume != null && input.productionLifeYears != null && input.annualVolume > 0 && input.productionLifeYears > 0 ? input.annualVolume * input.productionLifeYears : null;
  const warnings: string[] = [];
  if (processName && !mouldingClass) warnings.push(`The chosen moulding process "${processName}" is not a sand moulding process: the cheapest is used.`);
  return {
    warnings,
    scenario: {
      batchSize: input.batchSize,
      cavities: cavity != null && Number.isInteger(cavity) && cavity > 0 ? cavity : null,
      mouldingClass,
      chosenCoreProcess: typeof o[SAND_SCENARIO_KEYS.coreProcess] === 'string' ? (o[SAND_SCENARIO_KEYS.coreProcess] as string) : null,
      ...(() => {
        const e = energyPrice(positive(o[SAND_SCENARIO_KEYS.energyPrice]), input.location, input.locationElectricity, input.toUsd ?? (() => null), warnings);
        return { energyPricePerKwh: e?.usdPerKwh ?? null, energyPriceSource: e?.source ?? null };
      })(),
      hotBox: {
        coreboxTempC: positive(o[SAND_SCENARIO_KEYS.hotBoxCoreboxTemp]),
        cureTempC: positive(o[SAND_SCENARIO_KEYS.hotBoxCureTemp]),
        curedDepthMm: positive(o[SAND_SCENARIO_KEYS.hotBoxCuredDepth]),
      },
      refractory: {
        coat: COAT_CHOICES.find((c) => c === o[SAND_SCENARIO_KEYS.refractoryCoat]) ?? null,
        dryMethod: DRY_METHODS.find((m) => m === o[SAND_SCENARIO_KEYS.refractoryDryMethod]) ?? null,
        dryMinutes: positive(o[SAND_SCENARIO_KEYS.refractoryDryMinutes]),
        pricePerKg: positive(o[SAND_SCENARIO_KEYS.refractoryCoatPrice]),
      },
      lifetimeVolume: lifetime,
    },
  };
}

/** The measurements of the casting as the summary has them (cad-engine casting extractor, via auto-fill's casting* keys). */
export interface SandMeasurements {
  volumeMm3: number | null;
  surfaceAreaMm2: number | null;
  /** The bounding box of the part, any order (mm). */
  bboxMm: readonly number[];
  footprintMm: readonly [number, number] | null;
  /** The part's extent along the draw direction (mm). */
  drawDepthMm: number | null;
  wallNominalMm: number | null;
  partingPerimeterMm: number | null;
  /** The cores the extractor measured: volume and box; null when the analysis predates it. */
  rawCores: unknown;
  /** The casting's height above the parting plane (mm), where the analysis measured it. */
  abovePartingMm?: number | null;
}

/**
 * The part as the route takes it: length and width across the draw direction and the height along it when the casting extractor measured them,
 * otherwise the box sorted by size (said to be an estimate). Cores null (analysis predates them) are not guessed: no core is costed, and it is said.
 */
export function sandPart(m: SandMeasurements): { part: SandPartInput | null; warnings: string[]; missing: string[] } {
  const missing: string[] = [];
  if (!(m.volumeMm3 != null && m.volumeMm3 > 0)) missing.push('the part volume');
  if (!(m.surfaceAreaMm2 != null && m.surfaceAreaMm2 > 0)) missing.push('the part surface area');
  const box = [...m.bboxMm].filter((v) => v > 0).sort((a, b) => b - a);
  const measured = m.footprintMm != null && m.drawDepthMm != null && m.drawDepthMm > 0;
  if (!measured && box.length < 3) missing.push('the part size');
  if (missing.length) return { part: null, warnings: [], missing };
  const warnings: string[] = [];
  const dims: [number, number, number] = measured ? [m.footprintMm![0], m.footprintMm![1], m.drawDepthMm!] : [box[0]!, box[1]!, box[2]!];
  if (!measured) warnings.push('Casting geometry along the draw direction not measured: the bounding box sorted by size is used (re-run the analysis).');
  let cores: CoreRegion[] = [];
  if (Array.isArray(m.rawCores)) {
    cores = m.rawCores.flatMap((c: any) => {
      const volume = num(c?.volume_mm3);
      const size = Array.isArray(c?.box_mm) ? c.box_mm.map(Number).filter((v: number) => Number.isFinite(v)).sort((a: number, b: number) => b - a) : [];
      return volume != null && size.length === 3 ? [{ volumeMm3: volume, areaMm2: positive(c?.area_mm2), sizeMm: [size[0], size[1], size[2]] as const }] : [];
    });
  } else warnings.push('Cores not measured (the analysis predates it): no core is costed. Re-run the analysis.');
  return {
    warnings,
    missing: [],
    part: { volumeMm3: m.volumeMm3!, surfaceAreaMm2: m.surfaceAreaMm2!, dimsMm: dims, wallNominalMm: m.wallNominalMm, partingLineMm: m.partingPerimeterMm, abovePartingMm: m.abovePartingMm ?? null, cores },
  };
}

/** The raw_materials row of a sand material as the route reads it (columns by their raw_materials names). */
export const SAND_MATERIAL_COLUMNS = [
  'density_kg_m3', 'heat_of_fusion_j_kg', 'specific_heat_rt_j_kg_k', 'specific_heat_solidus_j_kg_k', 'injection_temp_c', 'liquidus_temp_c', 'cut_code', 'cost_usa',
] as const;

export function sandMaterialFromRow(row: Record<string, any>): SandMaterial {
  return {
    name: String(row.name ?? row.grade ?? ''), // migration 865: name was material_grade, grade was material
    materialType: row.material_type ? String(row.material_type) : null,
    columns: Object.fromEntries(SAND_MATERIAL_COLUMNS.map((k) => [k, num(row[k])])),
  };
}

/** One route cost in the location's currency (the route is built in USD, the units of HR Rates and the sand reference data). */
export function sandRouteToLocal(route: SandRoute, usdToLocal: number): SandRoute {
  if (usdToLocal === 1) return route;
  const k = (v: number) => Math.round(v * usdToLocal * 100) / 100;
  const line = (l: ProcessLineCost): ProcessLineCost => ({
    ...l,
    setupCost: k(l.setupCost), runCost: k(l.runCost), totalCost: k(l.totalCost),
    hourlyRate: Math.round(l.hourlyRate * usdToLocal * 100) / 100,
    labourRate: l.labourRate != null ? Math.round(l.labourRate * usdToLocal * 100) / 100 : l.labourRate,
    ...(l.machineChoice ? { machineChoice: { ...l.machineChoice, candidates: l.machineChoice.candidates.map((x) => ({ ...x, perPartCost: x.perPartCost != null ? Math.round(x.perPartCost * usdToLocal * 10000) / 10000 : null })) } } : {}),
  });
  return {
    ...route,
    lines: route.lines.map(line),
    material: { ...route.material, costUsd: route.material.costUsd != null ? k(route.material.costUsd) : null },
    tooling: { perPartUsd: Math.round(route.tooling.perPartUsd * usdToLocal * 10000) / 10000, items: route.tooling.items.map((t) => ({ ...t, toolingCostUsd: k(t.toolingCostUsd), perPartUsd: Math.round(t.perPartUsd * usdToLocal * 10000) / 10000 })) },
    totalUsd: route.totalUsd != null ? k(route.totalUsd) : null,
  };
}
