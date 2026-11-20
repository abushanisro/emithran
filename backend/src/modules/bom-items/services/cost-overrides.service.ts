import { Injectable, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';

/** Lookup tables read by the generic spec resolver (specLookupSeeds), not by a resolver of their own. */
const SPEC_RESOLVED_TABLES: ReadonlySet<string> = new Set(['tblRotarySurfaceGrinding', 'tblStraightBevelGearCutting', 'tblSpiralBevelGearCutting', 'tblShaping', 'tblChamfering', 'tblCornerRoundingMill', 'tblChemicalMilling', 'tblChemicalMillingEtchingRates']);
import { MACHINE_REGISTRY } from '../costing/shared/core/default-rates.constants';
// Platform Architecture Remediation Phase 1 (engine registry unification,
// Rule 8) — getRouteComparison()'s Press Brake/Deburring/Hole Extrusion/
// Tapping lines now call the exact same registered engines
// computeCostSummary() uses, instead of hand-rolled arithmetic that omitted
// labor/inspection-sampling/yield-loss cost (see each engine file's own doc
// comment for the specific divergence this closes).
import type { CostSummaryDto, ProcessLineCost } from '../dto/cost-breakdown.dto';
import { RateResolutionService } from './rate-resolution.service';

/** A quote with extra lines appended: process total, total, cycle time and completeness follow. */
function appendLines<T extends CostSummaryDto>(dto: T, lines: ProcessLineCost[]): T {
  if (lines.length === 0) return dto;
  const extra = lines.reduce((t, l) => t + l.totalCost, 0);
  const gaps = lines.filter((l) => l.physicsGap).map((l) => l.process);
  const incomplete = [...(dto.incompleteProcesses ?? []), ...gaps];
  return {
    ...dto,
    processLines: [...dto.processLines, ...lines],
    totalProcessCost: dto.totalProcessCost + extra,
    totalCost: dto.totalCost + extra,
    cycleTimes: { ...dto.cycleTimes, totalMin: dto.cycleTimes.totalMin + lines.reduce((t, l) => t + l.cycleTimeMin, 0) },
    ...(incomplete.length ? { incompleteProcesses: incomplete, costStatus: 'incomplete' as const } : {}),
    ...(gaps.length ? { uncostedOperations: [...new Set([...(dto.uncostedOperations ?? []), ...gaps])] } : {}),
  };
}

/** The money of a process line in another currency: every amount the line states, converted by one function. */
function convertLineMoney(l: ProcessLineCost, conv: (n: number) => number) {
  return {
    setupCost: conv(l.setupCost),
    runCost: conv(l.runCost),
    totalCost: conv(l.totalCost),
    hourlyRate: conv(l.hourlyRate),
    labourRate: l.labourRate != null ? conv(l.labourRate) : l.labourRate,
    ...(l.machineCostPerPart != null ? { machineCostPerPart: conv(l.machineCostPerPart) } : {}),
    ...(l.laborCostPerPart != null ? { laborCostPerPart: conv(l.laborCostPerPart) } : {}),
  };
}

import { BOMItemsService } from '../bom-items.service';
import { r2 } from '../costing/shared/core/engine-kernel';




/** The engineer's overrides on a part's cost: the machine chosen for a process and the cost entered for a line, saved on the item and applied to a summary. */
@Injectable()
export class CostOverridesService {
  constructor(
    private readonly items: BOMItemsService,
    private readonly databaseService: DatabaseService,
    private readonly rateResolutionService: RateResolutionService,
  ) { }

  // Delegates to RateResolutionService — see that class for the real
  // implementation and doc comment. Kept as a same-named private wrapper so
  // every existing call site in this file is unaffected by the extraction.
  async fetchMachineOverrides(
    bomItemId: string,
    accessToken: string,
    location: string,
  ) {
    return this.rateResolutionService.fetchMachineOverrides(bomItemId, accessToken, location);
  }

  async setMachineOverride(
    bomItemId: string,
    userId: string,
    accessToken: string,
    processKey: string,
    mhrRecordId: string | null,
    location: string,
  ): Promise<{ processKey: string; mhrRecordId: string | null; location: string }> {
    // findOne enforces the caller can access this BOM item
    await this.items.findOne(bomItemId, userId, accessToken);
    const client = this.databaseService.getClient(accessToken);

    if (mhrRecordId === null) {
      const { error } = await client
        .from('bom_item_machine_overrides')
        .delete()
        .eq('bom_item_id', bomItemId)
        .eq('process_key', processKey)
        .eq('location', location);
      if (error) throw new InternalServerErrorException(`Failed to clear machine override: ${error.message}`);
      return { processKey, mhrRecordId: null, location };
    }

    // Validate the machine exists before persisting — a stale id would silently
    // revert to auto-selection later, which reads as data loss to the user
    const { data: machine, error: mhrError } = await client
      .from('mhr_records')
      .select('id, location, machine_class')
      .eq('id', mhrRecordId)
      .maybeSingle();
    if (mhrError || !machine) throw new BadRequestException(`MHR record ${mhrRecordId} not found`);

    // A pick is for a machine class: one of the engine-selected classes (MACHINE_REGISTRY), or a class the
    // secondary engines cost (surface, heat, inspection ...), whose machine is then the picked one. Either
    // way the machine must be a machine of that class.
    const pickedClass = (machine as { machine_class?: string | null }).machine_class;
    if (!(processKey in MACHINE_REGISTRY) && pickedClass !== processKey) {
      throw new BadRequestException(
        `Unknown process key: ${processKey}` + (pickedClass ? ` (the machine is a ${pickedClass})` : ''),
      );
    }

    // A machine belongs to exactly one location; forcing it into another
    // location's costing applies the wrong currency AND the wrong shop rate.
    const machineLocation = (machine as { location?: string | null }).location;
    if (machineLocation && machineLocation !== location) {
      throw new BadRequestException(
        `Machine ${mhrRecordId} belongs to ${machineLocation} — it cannot be forced into a ${location} costing. ` +
        `Switch the Digital Factory to ${machineLocation} or pick a ${location} machine.`,
      );
    }

    const { error } = await client
      .from('bom_item_machine_overrides')
      .upsert(
        {
          bom_item_id: bomItemId,
          process_key: processKey,
          location,
          mhr_record_id: mhrRecordId,
          overridden_by: userId,
          overridden_at: new Date().toISOString(),
        },
        { onConflict: 'bom_item_id,process_key,location' },
      );
    if (error) throw new InternalServerErrorException(`Failed to save machine override: ${error.message}`);
    return { processKey, mhrRecordId, location };
  }

  // Delegates to RateResolutionService — see that class for the real
  // implementation and doc comment. Kept as a same-named private wrapper so
  // every existing call site in this file is unaffected by the extraction.
  async fetchCostOverrides(
    bomItemId: string,
    accessToken: string,
    location: string,
  ) {
    return this.rateResolutionService.fetchCostOverrides(bomItemId, accessToken, location);
  }

  // Applied after the family-specific engine + attachMachineSelections, so it
  // sees the final process line set for whichever route was actually costed.
  //
  // Material rate is applied as a SCALE FACTOR on the engine's own computed
  // materialCost (override / originalRatePerKg), not reconstructed from
  // scratch — the CNC engine folds a billet-overhead multiplier into
  // materialCost that this method must not have to know about or duplicate.
  // Scaling proportionally reproduces "the engine had run with this rate" for
  // any formula that is linear in cost-per-kg, which weight × rate always is.
  //
  // Process line rate/cycle time ARE reconstructed directly (runCost =
  // rate/60 × cycleMin, setupCost untouched) — this is the exact formula the
  // UI's inline editor already uses, not a new one.
  applyCostOverrides(result: CostSummaryDto, overrides: Map<string, number>): void {
    if (overrides.size === 0) return;

    const matRateOv = overrides.get('mat_rate');
    if (matRateOv != null && result.materialCostPerKg > 0) {
      const scale = matRateOv / result.materialCostPerKg;
      result.materialCost = r2(result.materialCost * scale);
      result.materialCostPerKg = matRateOv;
      result.materialSource = 'db'; // user-confirmed rate — no longer a default estimate
    }

    for (const line of result.processLines) {
      const rateOv = overrides.get(`${line.process}::rate`);
      const cycleOv = overrides.get(`${line.process}::cycleMin`);
      if (rateOv == null && cycleOv == null) continue;
      line.hourlyRate = rateOv ?? line.hourlyRate;
      line.cycleTimeMin = cycleOv ?? line.cycleTimeMin;
      line.runCost = r2((line.hourlyRate / 60) * line.cycleTimeMin);
      line.totalCost = r2(line.setupCost + line.runCost);
    }

    result.totalProcessCost = r2(result.processLines.reduce((s, l) => s + l.totalCost, 0));
    result.totalCost = r2(result.materialCost + result.totalProcessCost);
  }

  async setCostOverride(
    bomItemId: string,
    userId: string,
    accessToken: string,
    fieldKey: string,
    value: number | null,
    location: string,
  ): Promise<{ fieldKey: string; value: number | null; location: string }> {
    // findOne enforces the caller can access this BOM item
    await this.items.findOne(bomItemId, userId, accessToken);
    const client = this.databaseService.getClient(accessToken);

    if (value === null) {
      const { error } = await client
        .from('bom_item_cost_overrides')
        .delete()
        .eq('bom_item_id', bomItemId)
        .eq('field_key', fieldKey)
        .eq('location', location);
      if (error) throw new InternalServerErrorException(`Failed to clear cost override: ${error.message}`);
      return { fieldKey, value: null, location };
    }

    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(`Cost override value must be a positive number: ${value}`);
    }

    const { error } = await client
      .from('bom_item_cost_overrides')
      .upsert(
        {
          bom_item_id: bomItemId,
          location,
          field_key: fieldKey,
          value,
          overridden_by: userId,
          overridden_at: new Date().toISOString(),
        },
        { onConflict: 'bom_item_id,location,field_key' },
      );
    if (error) throw new InternalServerErrorException(`Failed to save cost override: ${error.message}`);
    return { fieldKey, value, location };
  }

}
