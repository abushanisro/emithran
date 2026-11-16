/**
 * The sustainability of a costed part from real factors: the grid of the part's location, the embodied carbon of its material class, and
 * each line's own machine power (mhr_records.machine_power_kw). Applied once to every cost summary (bom-item-costing.service.ts), after the
 * engine priced it: the engines keep the weights, scrap and waste they measured; the carbon, energy, score and advice are recomputed here.
 *
 * Pure: every factor comes in as data (sustainability-factors.constants.ts holds the published values with their sources).
 */
import type { ProcessCO2, ProcessLineCost, SustainabilitySummaryDto } from '../../../dto/cost-breakdown.dto';
import { DEFAULT_ENERGY_KWH_PER_HR, ENERGY_KWH_PER_HR } from './sustainability-factors.constants';

export interface SustainabilityFactors {
  /** The location's grid, kg CO2e per kWh consumed; null when the location has no published factor on file. */
  grid: { kgCo2ePerKwh: number; source: string } | null;
  /** The material class's embodied carbon (cradle-to-gate) and end-of-life recycling rate; null when the material is not classified. */
  material: { label: string; kgCo2ePerKg: number; /** End-of-life recycling rate, %; null when none is verified for the material. */ recyclingPct: number | null; source: string; lowerCarbonOption?: { label: string; kgCo2ePerKg: number } } | null;
  /** The line's own machine power, kW (mhr_records.machine_power_kw); null when not on file. */
  machinePowerKw: (line: Pick<ProcessLineCost, 'machineClass' | 'machineName'>) => number | null;
  /** How the stock is made, for the advice: a sheet is nested, a bar or billet is sized, a casting or moulding is near-net already. */
  stock: 'sheet' | 'bar_or_billet' | 'near_net' | null;
  batchSize: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function applySustainabilityFactors(
  measured: Pick<SustainabilitySummaryDto, 'netWeightKg' | 'scrapKg' | 'wasteCostInr' | 'materialUtilizationPct'>,
  processLines: readonly ProcessLineCost[],
  f: SustainabilityFactors,
): SustainabilitySummaryDto {
  const { netWeightKg, scrapKg, materialUtilizationPct } = measured;
  const grossWeightKg = r3(netWeightKg + scrapKg);
  const grid = f.grid?.kgCo2ePerKwh ?? 0;

  const materialCo2PerKg = f.material?.kgCo2ePerKg ?? 0;
  const materialCo2Kg = r3(grossWeightKg * materialCo2PerKg);

  const processCo2Breakdown: ProcessCO2[] = processLines.map((l) => {
    const machineKw = f.machinePowerKw(l);
    const classKw = ENERGY_KWH_PER_HR[l.machineClass];
    const kw = machineKw ?? classKw ?? DEFAULT_ENERGY_KWH_PER_HR;
    const energyKwh = r3((l.cycleTimeMin / 60) * kw);
    const energySource: ProcessCO2['energySource'] = machineKw != null ? 'machine' : classKw != null ? 'lookup' : 'default';
    return { process: l.process, machineClass: l.machineClass, energyKwh, co2Kg: r3(energyKwh * grid), energySource };
  });
  const totalProcessEnergyKwh = r3(processCo2Breakdown.reduce((s, p) => s + p.energyKwh, 0));
  const totalProcessCo2Kg = r3(processCo2Breakdown.reduce((s, p) => s + p.co2Kg, 0));
  const totalCo2Kg = r3(materialCo2Kg + totalProcessCo2Kg);
  const co2PerKgPart = r3(netWeightKg > 0 ? totalCo2Kg / netWeightKg : 0);
  const recyclabilityPct = f.material?.recyclingPct ?? 0; // not on file: no credit, and factorsSource says so

  const co2Contributors = [
    { label: 'Material Production', co2Kg: materialCo2Kg },
    ...processCo2Breakdown.map((p) => ({ label: p.process, co2Kg: p.co2Kg })),
  ]
    .sort((a, b) => b.co2Kg - a.co2Kg)
    .map((c) => ({ label: c.label, co2Kg: r3(c.co2Kg), pct: r2(totalCo2Kg > 0 ? (c.co2Kg / totalCo2Kg) * 100 : 0) }));

  // The score's scales are unchanged (the panel's 30/30/20/20): utilisation, carbon per kg of part, recycling, process energy.
  const matScore = (materialUtilizationPct / 100) * 30;
  const co2Score = Math.max(0, 30 - co2PerKgPart * 3);
  const recyclScore = (recyclabilityPct / 100) * 20;
  const energyScore = Math.max(0, 20 - totalProcessEnergyKwh * 4);
  const one = (n: number) => Math.round(n * 10) / 10;

  return {
    netWeightKg: r3(netWeightKg),
    scrapKg,
    wasteCostInr: measured.wasteCostInr,
    materialUtilizationPct,
    materialCo2Kg,
    materialCo2PerKg: r3(materialCo2PerKg),
    materialCo2Source: f.material ? 'lookup' : 'default',
    processCo2Breakdown,
    totalProcessEnergyKwh,
    totalProcessCo2Kg,
    totalCo2Kg,
    co2PerKgPart,
    co2Contributors,
    recyclabilityPct,
    sustainabilityScore: Math.round(Math.min(100, matScore + co2Score + recyclScore + energyScore)),
    scoreBreakdown: { materialEfficiency: one(matScore), carbonIntensity: one(co2Score), recyclability: one(recyclScore), processEnergy: one(energyScore) },
    opportunities: opportunities({ materialUtilizationPct, materialCo2Kg, totalCo2Kg, totalProcessEnergyKwh, processCo2Breakdown }, f),
    factorsSource: [
      f.grid ? `Grid: ${f.grid.kgCo2ePerKwh} kg CO2e/kWh (${f.grid.source})` : 'Grid: no published factor on file for this location, so process energy carries no CO2',
      f.material ? `Material: ${f.material.label} ${f.material.kgCo2ePerKg} kg CO2e/kg (${f.material.source})` : 'Material: no published embodied-carbon factor verified for this grade, so none is counted',
      ...(f.material && f.material.recyclingPct == null ? ['Recycling: no end-of-life rate verified for this material, so none is credited'] : []),
      'Process energy: each machine\'s own power (mhr_records.machine_power_kw) x its cycle time',
    ].join(' | '),
  };
}

function opportunities(
  s: { materialUtilizationPct: number; materialCo2Kg: number; totalCo2Kg: number; totalProcessEnergyKwh: number; processCo2Breakdown: ProcessCO2[] },
  f: SustainabilityFactors,
): string[] {
  const out: string[] = [];
  const scrapPct = (100 - s.materialUtilizationPct).toFixed(0);
  if (s.materialUtilizationPct < 90) {
    if (f.stock === 'sheet') out.push(`Improve the nesting layout: ${scrapPct}% of the sheet is scrap.`);
    else if (f.stock === 'bar_or_billet') out.push(`${scrapPct}% of the stock is machined away as chips: a stock size closer to the part, or a near-net blank (casting, forging, extrusion), removes less.`);
    else if (f.stock === 'near_net') out.push(`${scrapPct}% of the metal poured or moulded is not in the part: runners, gates and risers; they are usually remelted or reground.`);
  }
  if (s.totalCo2Kg > 0 && s.materialCo2Kg / s.totalCo2Kg > 0.6 && f.material?.lowerCarbonOption) {
    const o = f.material.lowerCarbonOption;
    out.push(`Material production is ${Math.round((s.materialCo2Kg / s.totalCo2Kg) * 100)}% of the CO2: ${o.label} is ${o.kgCo2ePerKg} kg CO2e/kg against ${f.material.kgCo2ePerKg}.`);
  }
  const top = [...s.processCo2Breakdown].sort((a, b) => b.co2Kg - a.co2Kg)[0];
  if (top && s.totalCo2Kg > 0 && top.co2Kg / s.totalCo2Kg > 0.3) {
    out.push(`${top.process} is ${Math.round((top.co2Kg / s.totalCo2Kg) * 100)}% of the CO2 (${top.energyKwh} kWh): its cycle time is the lever.`);
  }
  if (f.batchSize < 10) out.push(`Small batch (${f.batchSize} pcs): each setup's energy is spread over few parts; a larger batch lowers it per part.`);
  return out.length ? out : ['No significant improvement opportunities at the current parameters.'];
}
