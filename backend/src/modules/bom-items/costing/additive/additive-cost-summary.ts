// Cost Summary of a part built layer by layer (Additive Manufacturing or Rapid Prototyping), from its route (additive-route.ts) in the
// location's currency. Pure. A route that could not be built is one named, uncosted line saying what kept it from being built; never priced
// as another process.
import type { CostSummaryDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import { runView } from '../casting/casting-calculator-seeds';
import { computeSustainability } from '../shared/core/cost-engine';
import type { AdditiveDomain } from './additive-domain';
import type { AdditiveRoute, AdditiveRouteGap } from './additive-route';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The sentence a summary that could not be costed starts its warning with (the route comparison reads it). */
export const notCostedPrefix = (domain: AdditiveDomain) => `${domain.processGroup} cannot be costed`;

function uncosted(domain: AdditiveDomain, reason: string): ProcessLineCost {
  const group = domain.processGroup;
  return {
    process: group, processGroup: group, processRoute: group, operation: group,
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
    machineClass: domain.key, machineName: null, commodityCode: null, labourRate: null,
    physicsGap: { gapType: 'unsupported_operation', process: group, machineClass: domain.key, reason },
  };
}

/** The calculator that priced a route's material. */
function materialCalculator(domain: AdditiveDomain, route: AdditiveRoute['key']): string {
  return route === 'metal_sintering' ? domain.calc.metalMaterial! : route === 'laser_sintering' ? domain.calc.polymerMaterial : domain.calc.resinMaterial;
}

export function buildAdditiveCostSummary(input: {
  /** The quoted route and every route, in the location's currency. */
  additive: { domain: AdditiveDomain; route: AdditiveRoute | null; routes: AdditiveRoute[]; gaps: AdditiveRouteGap[]; note: string | null; missing: string[]; warnings: string[] };
  materialGrade: string | null;
  materialCostPerKg: number;
  materialSource: 'db' | 'default';
  batchSize: number;
  warnings: string[];
  ratesSource: string;
}): CostSummaryDto {
  const { route, domain } = input.additive;
  const why = input.additive.missing.join('; ') || 'no build route could be built';
  const warnings = [...(input.additive.note ? [input.additive.note] : []), ...input.warnings, ...input.additive.warnings];
  if (!route) warnings.push(`${notCostedPrefix(domain)}: ${why}`);
  const processLines = route ? route.lines : [uncosted(domain, `${notCostedPrefix(domain)}: ${why}`)];
  if (route && !route.complete) warnings.push(`The ${domain.processGroup} route is incomplete: a step no machine can do is shown as a named gap, and the total excludes it.`);
  const materialCost = route?.material.costUsd ?? 0;
  const totalProcessCost = processLines.reduce((s, l) => s + l.totalCost, 0);
  const massKg = route?.material.massKg ?? 0;
  const perKg = massKg > 0 ? materialCost / massKg : input.materialCostPerKg;
  const run = route?.material.runs.material;
  const calculatorRuns: Record<string, ReturnType<typeof runView>> = route && run ? { [`${domain.name} material`]: runView(materialCalculator(domain, route.key), 'Material Cost', run) } : {};
  const c = route?.build.candidate;
  const at = route ? c!.byAngle[String(Math.round(route.build.selfSupportingDeg))] : undefined;
  return {
    materialCost: r2(materialCost),
    materialGrade: input.materialGrade ?? 'Unknown',
    grossWeightKg: r3(massKg),
    materialCostPerKg: perKg,
    materialSource: input.materialSource,
    processLines,
    totalProcessCost: r2(totalProcessCost),
    totalCost: r2(materialCost + totalProcessCost),
    cycleTimes: { laserMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: r3(processLines.reduce((s, l) => s + l.cycleTimeMin, 0)) },
    batchSize: input.batchSize,
    family: 'additive',
    sustainability: computeSustainability(input.materialGrade, perKg, massKg, massKg, input.batchSize, processLines),
    warnings: warnings.filter(Boolean),
    ratesSource: input.ratesSource,
    ...(Object.keys(calculatorRuns).length ? { calculatorRuns } : {}),
    // The material Apply records: the part's mass and what is bought for it (supports, powder lost and spent), not a stock allowance.
    ...(route ? { castingMetal: { partKg: route.material.partKg, chargedKg: Math.max(route.material.massKg, route.material.partKg) } } : {}),
    ...(route && c && at ? {
      additive: {
        processGroup: domain.processGroup,
        route: route.key, routeLabel: route.label,
        buildDirection: route.build.axis, buildDirectionSource: route.build.source, selfSupportingDeg: route.build.selfSupportingDeg,
        buildHeightMm: r2(c.buildHeightMm), footprintMm: [r2(c.footprintMm[0]), r2(c.footprintMm[1])],
        overhangAreaMm2: r2(at.overhangAreaMm2), supportVolumeMm3: route.material.supportVolumeMm3, plateContactAreaMm2: r2(at.plateContactAreaMm2),
        partsPerBuild: route.partsPerBuild, layers: route.layers, materialMassKg: route.material.massKg, complete: route.complete,
        cleaning: route.cleaned.map((f) => ({ id: f.id, type: f.type, label: f.label, measure: f.measure, size: f.size, depthMm: f.depthMm, timeSec: f.timeSec })),
        options: [
          ...input.additive.routes.map((r) => ({ route: r.key, label: r.label, complete: r.complete, totalCost: r.totalUsd, reason: r.complete ? null : `${r.lines.filter((l) => l.physicsGap).map((l) => l.process).join(', ') || 'the material'} not costed` })),
          ...input.additive.gaps.map((g) => ({ route: g.key, label: g.label, complete: false, totalCost: null, reason: g.reason })),
        ],
      },
    } : {}),
  };
}
