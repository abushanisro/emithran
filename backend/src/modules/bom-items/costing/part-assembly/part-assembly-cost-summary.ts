// A weldment's cost summary: the quoted route's lines (its welding, bevel cutting and finishing), the breakdown the Cost Guide shows
// (components, welds, routes) and the totals. What is costed is the welding only: each component's own cost is the BOM roll-up's. Pure.
import { PART_ASSEMBLY_PROCESS_GROUP } from './part-assembly-route';
import { computeSustainability } from '../shared/core/cost-engine';

import type { PartAssemblyCostResult } from './part-assembly-cost.service';
import type { CostSummaryDto, PartAssemblyBreakdown, ProcessLineCost } from '../../dto/cost-breakdown.dto';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function uncosted(reason: string): ProcessLineCost {
  return {
    process: PART_ASSEMBLY_PROCESS_GROUP, processGroup: PART_ASSEMBLY_PROCESS_GROUP, processRoute: PART_ASSEMBLY_PROCESS_GROUP, operation: PART_ASSEMBLY_PROCESS_GROUP,
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
    machineClass: 'part_assembly', machineName: null, commodityCode: null, labourRate: null,
    physicsGap: { gapType: 'unsupported_operation', process: PART_ASSEMBLY_PROCESS_GROUP, machineClass: 'part_assembly', reason },
  };
}

export function buildPartAssemblyCostSummary(input: {
  partAssembly: PartAssemblyCostResult;
  batchSize: number;
  warnings: string[];
  ratesSource: string;
}): CostSummaryDto {
  const pa = input.partAssembly;
  const { route } = pa;
  const why = pa.missing.join('; ') || 'no route could be built';
  const warnings = [...(pa.note ? [pa.note] : []), ...input.warnings, ...pa.warnings];
  if (!route) warnings.push(`Part Assembly cannot be costed: ${why}`);
  if (route && !route.complete) warnings.push('The weldment route is incomplete: a weld missing a measure, or a step no machine can do, is shown as a named gap, and the total excludes it.');
  if (route && pa.welds.some((w) => w.enabled && w.process === 'MIG Welding')) {
    warnings.push('MIG arc time is the wire\'s deposition at memory/Part Assembly\'s arcEfficency (0.5): the share of the wire it takes to end up in the weld.');
  }
  const processLines = route ? route.lines : [uncosted(`Part Assembly cannot be costed: ${why}`)];
  const totalProcessCost = processLines.reduce((s, l) => s + l.totalCost, 0);
  const byWeld = new Map((route?.welds ?? []).map((w) => [w.weldId, w]));
  const partAssembly: PartAssemblyBreakdown = {
    route: route?.key ?? null, routeLabel: route?.label ?? null, complete: route?.complete ?? false,
    components: pa.components.map((c) => ({ id: c.id, name: c.name, quantity: c.quantity, massKg: c.massKg, massSource: c.massSource, maxDimensionMm: c.maxDimensionMm })),
    weldmentMassKg: pa.weldment.massKg != null ? r3(pa.weldment.massKg) : null,
    thicknessMm: pa.thickness.mm, thicknessSource: pa.thickness.source,
    material: pa.material.name, cutCodeFamily: pa.material.cutCodeFamily,
    welds: pa.welds.map((w) => {
      const r = byWeld.get(w.id);
      return {
        id: w.id, process: w.process, routeProcess: r?.process ?? null, operation: w.operation, feature: w.feature, label: w.label, count: w.count,
        lengthMm: w.lengthMm, sizeMm: w.sizeMm, thicknessMm: w.thicknessMm, areaMm2: w.areaMm2, depthMm: w.depthMm,
        bevel: w.bevel, grind: w.grind, finishGrind: w.finishGrind, wireBrush: w.wireBrush, enabled: w.enabled,
        cycleSec: r?.cycleSec ?? null, wireKg: r?.wireKg ?? null, reason: r?.reason ?? null,
      };
    }),
    wireCost: route ? r2(route.wireUsd) : 0,
    options: [
      ...pa.routes.map((r) => ({ route: r.key, label: r.label, complete: r.complete, totalCost: r.totalUsd, reason: r.complete ? null : `${[...new Set(r.lines.filter((l) => l.physicsGap).map((l) => l.process))].join(', ')} not costed` })),
      ...pa.gaps.map((g) => ({ route: g.key, label: g.label, complete: false, totalCost: null, reason: g.reason })),
    ],
  };
  return {
    materialCost: 0,
    materialGrade: pa.material.name ?? 'Part Assembly',
    // A weldment of BOM children has no material of its own: each part's is in the roll-up.
    ...(pa.materialOfParts ? { materialOfParts: true } : {}),
    grossWeightKg: 0,
    materialCostPerKg: 0,
    materialSource: 'db',
    processLines,
    totalProcessCost: r2(totalProcessCost),
    totalCost: r2(totalProcessCost),
    cycleTimes: { laserMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: r3(processLines.reduce((s, l) => s + l.cycleTimeMin, 0)) },
    batchSize: input.batchSize,
    family: 'part_assembly',
    sustainability: computeSustainability(null, 0, 0, 0, input.batchSize, processLines),
    warnings: warnings.filter(Boolean),
    ratesSource: input.ratesSource,
    partAssembly,
  };
}
