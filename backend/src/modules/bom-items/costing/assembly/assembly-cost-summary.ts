// Cost Summary of an assembly's own work (assembly-route.ts), in the location's currency. Pure.
//
// The components are not in it: each child is costed on its own and the BOM roll-up adds it to the assembly once (bom-item-rollup.ts), so the
// summary holds only loading, joining and unloading, with the weld consumables on the weld lines. An assembly that could not be costed is
// one named, uncosted line saying why.
import { ASSEMBLY_PROCESS_GROUP, BOND_MATERIAL_CALC, CONSUMABLES_CALC } from './assembly-route';
import { runView } from '../casting/casting-calculator-seeds';
import { computeSustainability } from '../shared/core/cost-engine';

import type { AssemblyCostResult } from './assembly-cost.service';
import type { AssemblyBreakdown, CostSummaryDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';


const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function uncosted(reason: string): ProcessLineCost {
  return {
    process: ASSEMBLY_PROCESS_GROUP, processGroup: ASSEMBLY_PROCESS_GROUP, processRoute: ASSEMBLY_PROCESS_GROUP, operation: ASSEMBLY_PROCESS_GROUP,
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
    machineClass: 'assembly', machineName: null, commodityCode: null, labourRate: null,
    physicsGap: { gapType: 'unsupported_operation', process: ASSEMBLY_PROCESS_GROUP, machineClass: 'assembly', reason },
  };
}

export function buildAssemblyCostSummary(input: {
  assembly: AssemblyCostResult;
  batchSize: number;
  warnings: string[];
  ratesSource: string;
}): CostSummaryDto {
  const { route, components, joints } = input.assembly;
  const why = input.assembly.missing.join('; ') || 'no route could be built';
  const warnings = [...(input.assembly.note ? [input.assembly.note] : []), ...input.warnings, ...input.assembly.warnings];
  if (!route) warnings.push(`Assembly cannot be costed: ${why}`);
  if (route && !route.complete) warnings.push('The assembly route is incomplete: a step no machine can do, or a joint missing a measure, is shown as a named gap, and the total excludes it.');
  const processLines = route ? route.lines : [uncosted(`Assembly cannot be costed: ${why}`)];
  const totalProcessCost = processLines.reduce((s, l) => s + l.totalCost, 0);
  const calculatorRuns = Object.fromEntries(Object.entries(route?.runs ?? {}).map(([key, run]) => [
    key, key.endsWith(' consumables') ? runView(CONSUMABLES_CALC, 'Consumables Cost', run) : runView(BOND_MATERIAL_CALC, 'Material Mass', run),
  ]));
  const byJoint = new Map((route?.joints ?? []).map((j) => [j.jointId, j]));
  const assembly: AssemblyBreakdown = {
    route: route?.key ?? null, routeLabel: route?.label ?? null, complete: route?.complete ?? false,
    components: components.map((c) => ({ id: c.id, name: c.name, quantity: c.quantity, massKg: c.massKg, massSource: c.massSource, maxDimensionMm: c.maxDimensionMm, threadedHoles: c.threadedHoles.reduce((s, h) => s + h.occurrences, 0) })),
    joints: joints.map((j) => {
      const r = byJoint.get(j.id);
      return {
        id: j.id, process: j.process, routeProcess: r?.process ?? null, operation: j.operation, label: j.label, count: j.count, source: j.source, enabled: j.enabled,
        componentId: j.componentId, featureIds: j.featureIds, lengthMm: j.lengthMm, throatMm: j.throatMm, depthMm: j.depthMm, areaMm2: j.areaMm2,
        weldMaterial: j.weldMaterial, gas: j.gas, position: j.position, wireDiameterMm: j.wireDiameterMm, timeS: j.timeS, prep: j.prep, cleanUp: j.cleanUp,
        cycleSec: r?.cycleSec ?? null, consumablesCost: r ? r2(r.consumablesUsd) : null, reason: r?.reason ?? null,
      };
    }),
    consumablesCost: route ? r2(route.consumablesUsd) : 0,
    adhesiveKg: route?.adhesiveKg ?? 0,
    options: [
      ...input.assembly.routes.map((r) => ({ route: r.key, label: r.label, complete: r.complete, totalCost: r.totalUsd, reason: r.complete ? null : `${[...new Set(r.lines.filter((l) => l.physicsGap).map((l) => l.process))].join(', ')} not costed` })),
      ...input.assembly.gaps.map((g) => ({ route: g.key, label: g.label, complete: false, totalCost: null, reason: g.reason })),
    ],
  };
  return {
    materialCost: 0,
    materialGrade: 'Assembly',
    // An assembly of BOM children has no material of its own: each part's is in the roll-up.
    ...(input.assembly.materialOfParts ? { materialOfParts: true } : {}),
    grossWeightKg: 0,
    materialCostPerKg: 0,
    materialSource: 'db',
    processLines,
    totalProcessCost: r2(totalProcessCost),
    totalCost: r2(totalProcessCost),
    cycleTimes: { laserMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: r3(processLines.reduce((s, l) => s + l.cycleTimeMin, 0)) },
    batchSize: input.batchSize,
    family: 'assembly',
    sustainability: computeSustainability(null, 0, 0, 0, input.batchSize, processLines),
    warnings: warnings.filter(Boolean),
    ratesSource: input.ratesSource,
    ...(Object.keys(calculatorRuns).length ? { calculatorRuns } : {}),
    assembly,
  };
}
