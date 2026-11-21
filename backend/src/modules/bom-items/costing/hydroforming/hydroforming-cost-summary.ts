// Cost Summary of a hydroformed part, from its route (hydroforming-route.ts) in the location's currency. Pure. A part that could not be priced
// is one named, uncosted line saying why; never priced as plain sheet metal in its place.
import { HYDRO_CALC, HYDROFORMING_PROCESS_GROUP } from './hydroforming-route';
import { runView } from '../casting/casting-calculator-seeds';
import { computeSustainability } from '../shared/core/cost-engine';

import type { HydroformingCostResult } from './hydroforming-cost.service';
import type { CostSummaryDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';


const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The sentence a summary that could not be costed starts its warning with (the route comparison reads it). */
export const HYDROFORMING_NOT_COSTED = `${HYDROFORMING_PROCESS_GROUP} cannot be costed`;

function uncosted(reason: string): ProcessLineCost {
  return {
    process: 'Hydroform', processGroup: HYDROFORMING_PROCESS_GROUP, processRoute: 'Hydroform', operation: 'Hydroform',
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
    machineClass: 'hydroform', machineName: null, commodityCode: null, labourRate: null,
    physicsGap: { gapType: 'unsupported_operation', process: 'Hydroform', machineClass: 'hydroform', reason },
  };
}

export function buildHydroformingCostSummary(input: {
  hydroforming: HydroformingCostResult;
  materialGrade: string | null;
  materialCostPerKg: number;
  materialSource: 'db' | 'default';
  batchSize: number;
  warnings: string[];
  ratesSource: string;
  /** The Cost Guide's parts per tray (null: the data's default) and intensifier, for the section. */
  scenario: { partsPerTray: number | null; intensifier: boolean };
}): CostSummaryDto {
  const { route, part, rule, nest } = input.hydroforming;
  const why = input.hydroforming.missing.join('; ') || 'no route could be built';
  const warnings = [...(input.hydroforming.note ? [input.hydroforming.note] : []), ...input.warnings, ...input.hydroforming.warnings];
  if (!route) warnings.push(`${HYDROFORMING_NOT_COSTED}: ${why}`);
  const processLines = route ? route.lines : [uncosted(`${HYDROFORMING_NOT_COSTED}: ${why}`)];
  if (route && !route.complete) warnings.push(`The ${HYDROFORMING_PROCESS_GROUP} route is incomplete: a step no machine can do is shown as a named gap, and the total excludes it.`);
  const materialCost = route?.material.costUsd ?? 0;
  const totalProcessCost = processLines.reduce((s, l) => s + l.totalCost, 0);
  const grossKg = route?.material.grossKg ?? 0;
  const partKg = route?.material.partKg ?? 0;
  const perKg = grossKg > 0 ? materialCost / grossKg : input.materialCostPerKg;
  const calculatorRuns: Record<string, ReturnType<typeof runView>> = {};
  if (route?.material.run) calculatorRuns['Hydroforming material'] = runView(HYDRO_CALC.material, 'Material Cost', route.material.run);
  if (route?.material.blankRun) calculatorRuns['Hydroforming blank'] = runView(HYDRO_CALC.blankSize, 'Blank Mass', route.material.blankRun);
  return {
    materialCost: r2(materialCost),
    materialGrade: input.materialGrade ?? 'Unknown',
    grossWeightKg: r3(grossKg),
    materialCostPerKg: perKg,
    // The route priced the material from the part's own raw_materials row (the resolution's row, its price per kg).
    materialSource: route ? 'db' : input.materialSource,
    processLines,
    totalProcessCost: r2(totalProcessCost),
    totalCost: r2(materialCost + totalProcessCost),
    cycleTimes: { laserMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: r3(processLines.reduce((s, l) => s + l.cycleTimeMin, 0)) },
    batchSize: input.batchSize,
    family: 'sheet_metal',
    sustainability: computeSustainability(input.materialGrade, perKg, partKg, grossKg, input.batchSize, processLines),
    warnings: warnings.filter(Boolean),
    ratesSource: input.ratesSource,
    ...(Object.keys(calculatorRuns).length ? { calculatorRuns } : {}),
    // The sheet the blank is nested on: what Apply's material record holds (gross: the sheet over its blanks; net: the part).
    ...(route && nest ? {
      blankSpec: {
        form: 'sheet' as const,
        sizeLabel: `${r2(route.material.blankAreaMm2)} mm² blank on ${nest.sheetLengthMm} x ${nest.sheetWidthMm} mm sheet`,
        grossWeightKg: r3(grossKg), netWeightKg: r3(partKg), utilizationPct: r2(nest.utilizationPct),
        wasteKg: r3(Math.max(0, grossKg - partKg)), wasteCost: r2(Math.max(0, grossKg - partKg) * perKg),
        sheetLengthMm: nest.sheetLengthMm, sheetWidthMm: nest.sheetWidthMm, partsPerSheet: nest.partsPerSheet,
        // The Nest view starts from the quote's own setup and ranks these sheets.
        ...(nest.kerfMm != null ? { kerfMm: nest.kerfMm } : {}), ...(nest.kerfSource ? { kerfSource: nest.kerfSource } : {}), ...(nest.edgeMarginMm != null ? { edgeMarginMm: nest.edgeMarginMm } : {}),
        ...(nest.sheetSource ? { sheetSource: nest.sheetSource } : {}), ...(nest.candidateSheets?.length ? { candidateSheets: nest.candidateSheets } : {}),
      },
    } : {}),
    // The hydroform tool and the blanking die (USD): listed in the Cost Guide's tooling and written on Apply, not in the piece cost.
    ...(route?.tooling.length ? {
      hydroformingTooling: route.tooling.map((t) => ({
        key: t.key, description: t.description, detail: t.detail, costUsd: t.investmentUsd, toolCostUsd: t.costUsd, perPartUsd: t.perPartUsd, amortizationParts: t.amortizationParts,
      })),
    } : {}),
    ...(route && part && rule ? {
      hydroforming: {
        route: route.key, routeLabel: route.label,
        rule: { route: rule.route, ratio: r3(rule.ratio), depthMm: r2(rule.depthMm), widthMm: r2(rule.widthMm), threshold: rule.threshold, basis: rule.basis },
        draws: route.draws, drawRatiosPct: route.drawRatiosPct,
        blank: { method: part.blank.method, areaMm2: r2(route.material.blankAreaMm2), addendumMm: route.material.addendumMm, massKg: r3(route.material.blankKg) },
        nest: nest ? { method: nest.method, partsPerSheet: nest.partsPerSheet, utilizationPct: r2(nest.utilizationPct), sheetLengthMm: nest.sheetLengthMm, sheetWidthMm: nest.sheetWidthMm } : null,
        press: route.press,
        partsPerTray: route.key === 'fluid-cell' ? { value: route.partsPerTray, requested: input.scenario.partsPerTray, max: route.partsThatFit } : null,
        handAdjustingLengthMm: r2(route.handAdjustingLengthMm), throwPadAreaMm2: r2(route.throwPadAreaMm2), cappingTools: route.cappingTools,
        holes: { pierced: part.holes.length, inFormedWalls: part.holes.filter((h) => !h.inFlat).length },
        intensifier: input.scenario.intensifier,
        complete: route.complete,
        options: input.hydroforming.routes.map((r) => ({
          route: r.key, label: r.label, complete: r.complete, totalCost: r.totalUsd,
          reason: r.complete ? null : r.lines.filter((l) => l.physicsGap).map((l) => `${l.process}: ${(l.physicsGap as { reason?: string }).reason ?? 'not costed'}`).join('; ') || null,
        })),
      },
    } : {}),
  };
}
