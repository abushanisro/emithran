import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import type { LookupResolution } from '../dto/cost-breakdown.dto';
import type { MHRRateInput } from '../costing/shared/core/cost-engine';
import { roundUpToStandardTonnageClass } from '../costing/sheet-metal/lookup/sheet-metal-lookup.service';

/** Lookup tables read by the generic spec resolver (specLookupSeeds), not by a resolver of their own. */
const SPEC_RESOLVED_TABLES: ReadonlySet<string> = new Set(['tblRotarySurfaceGrinding', 'tblStraightBevelGearCutting', 'tblSpiralBevelGearCutting', 'tblShaping', 'tblChamfering', 'tblCornerRoundingMill', 'tblChemicalMilling', 'tblChemicalMillingEtchingRates']);
import type { MachineClass } from '../costing/shared/core/default-rates.constants';
// Platform Architecture Remediation Phase 1 (engine registry unification,
// Rule 8) — getRouteComparison()'s Press Brake/Deburring/Hole Extrusion/
// Tapping lines now call the exact same registered engines
// computeCostSummary() uses, instead of hand-rolled arithmetic that omitted
// labor/inspection-sampling/yield-loss cost (see each engine file's own doc
// comment for the specific divergence this closes).
import type { CostSummaryDto, ProcessLineCost } from '../dto/cost-breakdown.dto';
import type { MachineRequirement } from '../costing/shared/capability/machine-selection/physics';
import { RateSnapshot } from '../../../common/exchange-rate/exchange-rate.service';
import { RateResolutionService } from './rate-resolution.service';
import { cachedRead } from '../costing/shared/core/request-cache';

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


/** The machine and labour rates a part is costed at: the rate of every machine class at the location, the inspection rates, and what is said when one is missing. */
@Injectable()
export class MachineRateService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly rateResolutionService: RateResolutionService,
  ) { }

  // sm_lookup_manual_stroke's rows are stroke times for a real MACHINE's
  // tonnage class (10/20/30.../2000T — how fast THAT press's ram cycles),
  // not for whatever minimum force this one bend happens to need. Two
  // distinct cases, two distinct rounding rules:
  //   1. A real machine IS selected — use its own real tonnage capacity
  //      (`MachineSelectionResult.balanced.candidate.capability.maxTonnage`,
  //      sourced from mhr_records.max_tonnage or parsed from the machine's
  //      own name, e.g. "Bend Brake-800kN" -> ~81.6t). That precise number
  //      rarely lands on one of the table's round classes even though the
  //      machine conventionally IS that class ("800kN" -> real "80T" press
  //      brake) — SheetMetalLookupService.getManualStrokeTime rounds this to
  //      the NEAREST class (tight 10% tolerance) to correct for the naming
  //      convention, never substituting a meaningfully different machine.
  //   2. No real machine is selected (ENABLE_PHYSICS_MACHINE_SELECTION off,
  //      or no candidate matched) — only a required-force ESTIMATE exists
  //      (often under 10T for light/thin parts; confirmed live: no real
  //      commercial press brake is even rated below ~30-40T, so this can
  //      never match a row on its own). Round UP to the smallest real class
  //      that can actually do the job here, before handing it to
  //      getManualStrokeTime — a shop always sizes UP to an adequate
  //      machine, never picks an undersized one, so this is the physically
  //      correct rounding direction for an estimate (the opposite direction
  //      from case 1's naming-convention correction).
  resolveStrokeLookupTonnage(requiredTonnageEstimate: number, mhrRate?: MHRRateInput): number {
    const candidate = mhrRate?.selection?.balanced?.candidate as any;
    const selectedTonnage = candidate?.capability?.maxTonnage;
    // Case 1 requires a REAL tonnage — mhr_records.max_tonnage or a real
    // seed-registry OEM pattern match (capabilitySource 'imported'/'seed'),
    // never MACHINE_CLASS_DEFAULTS' generic per-class floor (capabilitySource
    // 'default_class', selector.ts). That default exists so the UI can show
    // an honest "no capability on file — conservative class defaults applied"
    // reason — using it here would silently treat a fleet-wide guess as if
    // it were this specific machine's real rated capacity. When the only
    // number on file is that default, this is exactly case 2: no real
    // machine capability is known, so round the part's own required-force
    // estimate up to the smallest adequate class instead.
    const isRealCapability = candidate?.capabilitySource !== 'default_class';
    if (isRealCapability && typeof selectedTonnage === 'number' && Number.isFinite(selectedTonnage) && selectedTonnage > 0) {
      return selectedTonnage;
    }
    return roundUpToStandardTonnageClass(requiredTonnageEstimate);
  }

  // Builds the real, disclosed provenance string for a stroke-time seed
  // value — plainly states when SheetMetalLookupService.getManualStrokeTime
  // resolved it by INTERPOLATING between two real seeded thickness rows at
  // this exact tonnage/complexity, and/or when it ROUNDED the queried
  // tonnage to the nearest standard press-brake class — never presented as
  // if it were an exact hit either way; deriveConfidence/
  // deriveResolutionStatus's own marker scan reads these exact disclosures
  // to correctly grade the result 'derived'/'nearest_match' rather than
  // 'verified'/'resolved'.
  describeStrokeTimeProvenance(
    thicknessMm: number, complexity: string, resolution: LookupResolution, roundedFromTonnage?: number | null,
  ): string {
    const queriedTonnage = resolution.queryParams.find((p) => p.column === 'tonnage')?.value;
    const tonnageNote = roundedFromTonnage
      ? `tonnage ${queriedTonnage}T (rounded from the real ${roundedFromTonnage}T value used for this lookup to the nearest standard press-brake class)`
      : `tonnage ${queriedTonnage}T`;
    const base = `sm_lookup_manual_stroke — thickness ${thicknessMm}mm, ${tonnageNote}, ${complexity} complexity`;
    if (resolution.policy === 'INTERPOLATE' && resolution.matchedRow) {
      const extrapolatedFrom = resolution.matchedRow.columns['extrapolated_from_thickness_mm'];
      if (extrapolatedFrom) {
        return `${base} — ${thicknessMm}mm is outside the real seeded thickness range at this tonnage; ` +
          `extrapolated from the two nearest real ${extrapolatedFrom}mm rows on file, not a verified or bracketed-interpolated value`;
      }
      const between = resolution.matchedRow.columns['interpolated_between_thickness_mm'];
      return `${base} — no exact row at ${thicknessMm}mm; interpolated between real ${between}mm rows on file at this tonnage`;
    }
    return base;
  }

  // Delegates to RateResolutionService — see that class for the real
  // implementation and doc comment. Kept as a same-named private wrapper so
  // every `Awaited<ReturnType<typeof this.resolveMHRRates>>` type reference in
  // this file is unaffected by the extraction.
  async resolveMHRRates(
    accessToken: string,
    location: string,
    physics: {
      requirements: Partial<Record<MachineClass, MachineRequirement>>;
      overrides: Map<string, string>;
    } | undefined,
    fxRates: RateSnapshot,
  ) {
    const rates = await this.rateResolutionService.resolveMHRRates(accessToken, location, physics, fxRates);
    // The machining inspection station's reference record states its setup hours, and states 0: carried on the rate
    // so a recorded zero setup is priced as zero and not reported as a missing setup time.
    return { ...rates, machiningInspection: await this.withReferenceSetup(rates.machiningInspection, accessToken) };
  }

  // Delegates to RateResolutionService — see that class for the real
  // implementation and doc comment. Kept as a same-named private wrapper so
  // every existing call site in this file is unaffected by the extraction.
  async resolveCmmSpecificRate(
    accessToken: string,
    location: string,
    rates: RateSnapshot,
    warnings: string[],
  ) {
    return this.rateResolutionService.resolveCmmSpecificRate(accessToken, location, rates, warnings);
  }

  // Delegates to RateResolutionService — see that class for the real
  // implementation and doc comment. Kept as a same-named private wrapper so
  // every existing call site in this file is unaffected by the extraction.
  async resolveGenericInspectionRate(
    accessToken: string,
    location: string,
    rates: RateSnapshot,
    warnings: string[],
  ) {
    return this.rateResolutionService.resolveGenericInspectionRate(accessToken, location, rates, warnings);
  }

  // Delegates to RateResolutionService — see that class for the real
  // implementation and doc comment. Kept as a same-named private wrapper so
  // every existing call site in this file is unaffected by the extraction.
  async resolveProcessIdentities(accessToken: string, machineClasses?: string[], family?: string) {
    return this.rateResolutionService.resolveProcessIdentities(accessToken, machineClasses, family);
  }

  /**
   * A machine's setup hours as recorded in its memory/Machining reference
   * record (machining_reference_data, keyed by the HR Rates row
   * benchmark_source_key): time.setupTimeHr, where 0 is a recorded zero. null
   * when the row has no reference record or the record has no setup time.
   */
  async machiningReferenceSetupHr(machine: MHRRateInput, accessToken: string): Promise<number | null> {
    const id = (machine.selection?.balanced?.candidate as { machineId?: string } | undefined)?.machineId ?? machine.mhrRecordId ?? null;
    if (!id) return null;
    const { data: row } = await cachedRead(`mhr:benchmark-key:${id}`, async () =>
      await this.databaseService.getUserClient(accessToken).from('mhr_records').select('benchmark_source_key').eq('id', id).maybeSingle());
    const key = (row as { benchmark_source_key?: string | null } | null)?.benchmark_source_key;
    if (!key) return null;
    const { data } = await cachedRead(`machining-reference-machine:${key}`, async () =>
      await this.databaseService.getPrivilegedClient('reference-data: machining_reference_data, public-read')
        .from('machining_reference_data').select('raw')
        .eq('category', 'machine').eq('key', key).limit(1));
    // The machine tool records write time.setupTimeHr; the station records (inspection, manual deburr) time.setup_time_hr.
    const time = (data?.[0] as { raw?: { time?: { setupTimeHr?: unknown; setup_time_hr?: unknown } } } | undefined)?.raw?.time;
    const v = time?.setupTimeHr ?? time?.setup_time_hr;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  /** The rate with its reference setup hours attached (MHRRateInput.referenceSetupTimeHr), so a recorded zero setup is priced as zero and not reported as missing. */
  private async withReferenceSetup(rate: MHRRateInput, accessToken: string): Promise<MHRRateInput> {
    return { ...rate, referenceSetupTimeHr: await this.machiningReferenceSetupHr(rate, accessToken) };
  }

  // Rigid tapping runs on the machining centre that milled/turned the part when
  // the location has no dedicated tapping machine on file — price it at that
  // machine's real rate instead of a ghost "Class default (tapping)" figure.
  inheritCncTappingRate(tapping: MHRRateInput, primary: MHRRateInput): MHRRateInput {
    if (tapping.source === 'mhr_database') return tapping;
    return {
      rate: primary.rate,
      source: primary.source,
      machineClass: tapping.machineClass,
      hostMachineClass: primary.machineClass,
      machineName: primary.machineName,
      commodityCode: primary.commodityCode,
      // The operator is the machining centre's own — carry its real labour
      // rate, or tapping labour would silently be uncosted.
      labourRate: primary.labourRate ?? null,
      labourRateSource: primary.labourRateSource ?? 'no_lhr_rate',
      operators: primary.operators ?? null,
    };
  }


  // Names every line whose machine has no real HR Rates row for this location.
  // Machine rates come only from memory/-backed mhr_records rows (migration
  // 805), so there is nothing to compare a real rate against and nothing
  // substituted for a missing one — a missing machine is reported, not priced.
  appendRateWarnings(
    result: { processLines: ProcessLineCost[]; warnings: string[] },
    location: string,
  ): void {
    const noMachine = new Set<string>();
    for (const line of result.processLines) {
      // A line whose gap is explained (physicsGap: e.g. the material cannot be molded, so no press can be sized) is not a missing machine.
      if (line.rateSource === 'no_db_rate' && !line.physicsGap) noMachine.add(line.machineClass.replace(/_/g, ' '));
    }
    if (noMachine.size > 0) {
      result.warnings.push(
        `No suitable machine in HR Rates for ${location} for: ${[...noMachine].join(', ')} — these operations carry no machine cost. ` +
        `Either no machine of that class is on file (add it to memory/ and seed it), or none passes the capability check for this part ` +
        `(see the machine selection reasons).`,
      );
    }
  }

}
