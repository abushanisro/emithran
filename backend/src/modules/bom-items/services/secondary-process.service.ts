import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ExchangeRateService } from '../../../common/exchange-rate/exchange-rate.service';
import { isMachiningFamily } from '../../../domain/part-family';
import { getCurrencyForLocation } from '../../mhr/constants/mhr-calculation.constants';
import { MaterialResolutionService } from './material-resolution.service';
import {
  SECONDARY_PROCESSES,
  SECONDARY_SOURCE_VERSION,
  computeSecondaryProcesses,
  type SecondaryMachine,
  type SecondaryPartFacts,
  type SecondaryProcessResult,
  type SecondaryReference,
} from '../costing/secondary/secondary-process-engine';
import { surfaceCalloutOf } from '../costing/surface/surface-callout';
import { SURFACE_PROCESSES, SURFACE_TREATMENT_SOURCE_VERSION, computeSurfaceTreatments, matchSurfaceTreatmentCallout } from '../costing/surface/surface-treatment-engine';
import { HEAT_TREATMENT_PROCESSES, HEAT_TREATMENT_SOURCE_VERSION, computeHeatTreatments, caseDepthFromCallout, matchHeatTreatmentCallout } from '../costing/heat/heat-treatment-engine';
import {
  CHEMICAL_MILLING_PROCESSES, CHEMICAL_MILLING_SOURCE_VERSION, CHEMICAL_MILLING_TABLES, CHEMICAL_MILLING_VARIABLES,
  chemicalMillingCallout, computeChemicalMilling, type ChemMillPocket,
} from '../costing/chemical-milling/chemical-milling-engine';
import { detectMaterialClass } from '../costing/machining/process/cost-machining-engine';

export interface SecondaryProcessLine extends SecondaryProcessResult {
  /** The same line in the item's location currency, ready to save as a
   *  process cost record (machine = MHR, direct = labour, both per hour). */
  local: {
    currency: string;
    machineRate: number | null;
    laborRate: number | null;
    costPerPart: number | null;
  };
}

export interface SecondaryProcessesResponse {
  location: string;
  batchSize: number | null;
  materialCutCode: number | null;
  materialTypeName: string | null;
  lines: SecondaryProcessLine[];
  /** Surface treatments (memory/SurfaceTreatment, migrations 819/820). */
  surfaceLines: SecondaryProcessLine[];
  /** Heat treatments (memory/Heat treatment, migrations 823/826). */
  heatTreatmentLines: SecondaryProcessLine[];
  /** The heat-treatment process the drawing callout names, if any. */
  heatTreatmentCalloutProcess: string | null;
  /** Chemical milling (memory/Machining, migrations 738/838), when the drawing calls for it. */
  chemicalMillingLines: SecondaryProcessLine[];
  /** The drawing's chemical-milling callout text, if any. */
  chemicalMillingCallout: string | null;
  /** Missing reference data (migrations 817/818 not run), when detected. */
  dataWarnings: string[];
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

@Injectable()
export class SecondaryProcessService {
  private readonly references = new Map<string, SecondaryReference>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly exchangeRates: ExchangeRateService,
    private readonly materials: MaterialResolutionService,
  ) {}

  /** Variables, lookup tables and default machines of one staged folder
   *  (817 Secondary process, 819 SurfaceTreatment). */
  private async loadReference(version: string): Promise<SecondaryReference | null> {
    const cached = this.references.get(version);
    if (cached) return cached;
    const { data, error } = await this.supabase
      .getPrivilegedClient('reference-data: machining_reference_data, public-read')
      .from('machining_reference_data')
      .select('category, key, value, raw')
      .eq('source_version', version)
      .in('category', ['variable', 'lookup_table', 'process']);
    if (error || !data || data.length === 0) return null; // not cached: retried next request
    const variables = new Map<string, string>();
    const lookups = new Map<string, Array<Record<string, unknown>>>();
    const defaultMachine = new Map<string, string>();
    for (const r of data as Array<{ category: string; key: string; value: string | null; raw: any }>) {
      if (r.category === 'variable' && r.value != null) variables.set(r.key, r.value);
      else if (r.category === 'lookup_table' && Array.isArray(r.raw?.rows)) lookups.set(r.key, r.raw.rows);
      else if (r.category === 'process' && r.value) defaultMachine.set(r.key, r.value);
    }
    const ref = { variables, lookups, defaultMachine };
    this.references.set(version, ref);
    return ref;
  }

  /** The machining reference rows chemical milling reads (variables, three
   *  lookup tables, the stations' default machines), not the whole 2026-03 set. */
  private async loadChemicalMillingReference(): Promise<SecondaryReference | null> {
    const key = `chem:${CHEMICAL_MILLING_SOURCE_VERSION}`;
    const cached = this.references.get(key);
    if (cached) return cached;
    const keys = [...CHEMICAL_MILLING_VARIABLES, ...CHEMICAL_MILLING_TABLES, ...CHEMICAL_MILLING_PROCESSES.map((p) => p.process)];
    const { data, error } = await this.supabase
      .getPrivilegedClient('reference-data: machining_reference_data, public-read')
      .from('machining_reference_data')
      .select('category, key, value, raw')
      .eq('source_version', CHEMICAL_MILLING_SOURCE_VERSION)
      .in('category', ['variable', 'lookup_table', 'process'])
      .in('key', keys);
    if (error || !data || data.length === 0) return null;
    const variables = new Map<string, string>();
    const lookups = new Map<string, Array<Record<string, unknown>>>();
    const defaultMachine = new Map<string, string>();
    for (const r of data as Array<{ category: string; key: string; value: string | null; raw: any }>) {
      if (r.category === 'variable' && r.value != null) variables.set(r.key, r.value);
      // Staged either as a bare row array (tblMaskingMaterials) or { rows }.
      else if (r.category === 'lookup_table') {
        const rows = Array.isArray(r.raw) ? r.raw : Array.isArray(r.raw?.rows) ? r.raw.rows : null;
        if (rows) lookups.set(r.key, rows);
      } else if (r.category === 'process' && r.value) defaultMachine.set(r.key, r.value);
    }
    const ref = { variables, lookups, defaultMachine };
    this.references.set(key, ref);
    return ref;
  }

  /** CAD pockets (machining_features PocketV2), grouped by size. */
  private chemicalMillingPockets(fg: any): ChemMillPocket[] {
    const features = Array.isArray(fg?.machining_features?.features) ? fg.machining_features.features : [];
    const groups = new Map<string, ChemMillPocket>();
    for (const f of features) {
      if (f?.type !== 'PocketV2') continue;
      const l = num(f.params?.length_mm), w = num(f.params?.width_mm), d = num(f.params?.depth_mm);
      if (!(l! > 0) || !(w! > 0) || !(d! > 0)) continue;
      const k = `${l}x${w}x${d}`;
      const g = groups.get(k) ?? { id: String(f.id ?? k), lengthMm: l!, widthMm: w!, depthMm: d!, count: 0 };
      g.count += 1;
      groups.set(k, g);
    }
    return [...groups.values()];
  }

  /** The location's real machines for these classes (migrations 806/818/820). */
  private async loadMachines(location: string, classes: string[], accessToken: string): Promise<SecondaryMachine[]> {
    const { data, error } = await this.supabase
      .getClient(accessToken)
      .from('mhr_records')
      .select('id, machine_name, machine_class, mhr_usd_per_hour, usd_lhr_total, operators, labor_time_standard, setup_time_hr, good_part_yield, max_x_mm, max_y_mm, max_z_mm, max_length_mm, max_workpiece_weight_kg, specs')
      .eq('location', location)
      .in('machine_class', classes);
    if (error || !data) return [];
    return (data as any[])
      .map((r): SecondaryMachine | null => {
        const mhr = num(r.mhr_usd_per_hour);
        const lhr = num(r.usd_lhr_total);
        const operators = num(r.operators);
        const laborTimeStandard = num(r.labor_time_standard);
        const setupHr = num(r.setup_time_hr);
        // A machine missing a rate, crew, labour standard or setup time cannot
        // be costed; it is left out rather than filled with a stand-in.
        if (mhr == null || lhr == null || operators == null || laborTimeStandard == null || setupHr == null) return null;
        return {
          id: r.id, name: r.machine_name, machineClass: r.machine_class,
          mhrUsd: mhr, lhrUsd: lhr, operators,
          laborTimeStandard, setupHr,
          // 0 = not on file; the engine then applies no yield loss and says so.
          goodPartYield: num(r.good_part_yield) ?? 0,
          maxXmm: num(r.max_x_mm), maxYmm: num(r.max_y_mm), maxZmm: num(r.max_z_mm),
          maxLengthMm: num(r.max_length_mm), maxWorkpieceKg: num(r.max_workpiece_weight_kg),
          specs: (r.specs ?? {}) as Record<string, unknown>,
        };
      })
      .filter((m): m is SecondaryMachine => m != null);
  }

  /**
   * The drawing's surface-treatment callout, costed by the reference engine:
   * the callout is matched to a SurfaceTreatment process and that process's
   * line is returned. `process` null = the callout names no reference process.
   */
  async surfaceTreatmentForCallout(input: Parameters<SecondaryProcessService['compute']>[0] & { callout: string }): Promise<{ process: string | null; line: SecondaryProcessLine | null }> {
    const process = matchSurfaceTreatmentCallout(input.callout);
    if (!process) return { process: null, line: null };
    const all = await this.compute(input);
    return { process, line: all.surfaceLines.find((l) => l.process === process) ?? null };
  }

  async compute(input: {
    item: {
      materialGrade?: string | null;
      material?: string | null;
      maxLength?: number | null; maxWidth?: number | null; maxHeight?: number | null;
      surfaceArea?: number | null; weight?: number | null;
      sheetThicknessMm?: number | null;
      volume?: number | null;
      heatTreatment?: string | null;
      featureGraph?: any;
      drawingIntelligence?: any;
      coating?: string | null;
    };
    location: string;
    batchSize: number | null;
    accessToken: string;
  }): Promise<SecondaryProcessesResponse> {
    const { item, location, batchSize, accessToken } = input;
    const dataWarnings: string[] = [];
    const ref = await this.loadReference(SECONDARY_SOURCE_VERSION);
    if (!ref) dataWarnings.push('Secondary process reference data is not staged: run migration 817.');
    const surfaceRef = await this.loadReference(SURFACE_TREATMENT_SOURCE_VERSION);
    if (!surfaceRef) dataWarnings.push('Surface treatment reference data is not staged: run migration 819.');
    const machines = await this.loadMachines(location, SECONDARY_PROCESSES.map((p) => p.machineClass), accessToken);
    if (machines.length === 0) dataWarnings.push(`No secondary process machines on file for ${location} (migrations 806/818 seed USA only).`);
    const surfaceMachines = await this.loadMachines(location, SURFACE_PROCESSES.map((p) => p.machineClass), accessToken);
    if (surfaceMachines.length === 0) dataWarnings.push(`No surface treatment machines on file for ${location} (migration 820 seeds USA only).`);
    const heatRef = await this.loadReference(HEAT_TREATMENT_SOURCE_VERSION);
    if (!heatRef) dataWarnings.push('Heat treatment reference data is not staged: run migration 823.');
    const heatMachines = await this.loadMachines(location, HEAT_TREATMENT_PROCESSES.map((p) => p.machineClass), accessToken);
    if (heatMachines.length === 0) dataWarnings.push(`No heat treatment machines on file for ${location} (migration 826 seeds USA only).`);

    const fg = item.featureGraph ?? {};
    const family: string = fg?.classification?.family ?? 'unknown';
    const grade = item.materialGrade ?? item.material ?? null;
    const { cutCode, materialGroup } = grade
      ? await this.materials.resolveCutCode(accessToken, grade, family)
      : { cutCode: null, materialGroup: null };
    const dims = [item.maxLength, item.maxWidth, item.maxHeight].map((v) => num(v));
    const wall = num(fg?.summary?.wallThicknessNominalMm) ?? (family === 'sheet_metal' ? num(item.sheetThicknessMm ?? fg?.summary?.sheetThicknessMm) : null);

    const part: SecondaryPartFacts = {
      bboxMm: dims.every((d) => d != null && d > 0) ? { length: dims[0]!, width: dims[1]!, height: dims[2]! } : null,
      surfaceAreaMm2: num(item.surfaceArea),
      weightKg: num(item.weight) && num(item.weight)! > 0 ? num(item.weight) : null,
      wallThicknessMm: wall,
      materialCutCode: cutCode,
      materialTypeName: materialGroup,
      isMachined: family === 'unknown' ? null : isMachiningFamily(family),
      surfaceCallout: surfaceCalloutOf(item),
      features: (fg?.feature_graph_v2?.features ?? []).filter((f: any) => f?.id && f?.feature_type && Array.isArray(f?.occurrences)),
      batchSize,
    };

    const unstaged = (list: ReadonlyArray<{ process: string; machineClass: string }>, migration: string): SecondaryProcessResult[] =>
      list.map((p) => ({
        ...p, status: 'gap' as const, reason: `Reference data not staged (migration ${migration}).`, machine: null,
        cycleTimeSec: null, setupMin: null, materialUsdPerPart: 0, costPerPartUsd: null,
        highlight: 'none' as const, featureIds: [], trace: [], warnings: [],
      }));
    const results = ref ? computeSecondaryProcesses(part, ref, machines) : unstaged(SECONDARY_PROCESSES, '817');
    const surfaceResults = surfaceRef ? computeSurfaceTreatments(part, surfaceRef, surfaceMachines) : unstaged(SURFACE_PROCESSES, '819');
    const heatFacts = { ...part, caseDepthMm: caseDepthFromCallout(item.heatTreatment), volumeMm3: num(item.volume) };
    const heatResults = heatRef ? computeHeatTreatments(heatFacts, heatRef, heatMachines) : unstaged(HEAT_TREATMENT_PROCESSES, '823');

    const chemCallout = chemicalMillingCallout(item.drawingIntelligence);
    let chemResults: SecondaryProcessResult[];
    if (!chemCallout) {
      chemResults = computeChemicalMilling({ ...part, materialClass: detectMaterialClass(grade), pockets: [] }, null, { variables: new Map(), lookups: new Map(), defaultMachine: new Map() }, []);
    } else {
      const chemRef = await this.loadChemicalMillingReference();
      if (!chemRef) dataWarnings.push('Chemical milling reference data is not staged (migrations 639 / 743 / 748).');
      const chemMachines = await this.loadMachines(location, CHEMICAL_MILLING_PROCESSES.map((p) => p.machineClass), accessToken);
      if (chemMachines.length === 0) dataWarnings.push(`No chemical milling machines on file for ${location} (migrations 738 / 838).`);
      chemResults = chemRef
        ? computeChemicalMilling({ ...part, materialClass: detectMaterialClass(grade), pockets: this.chemicalMillingPockets(fg) }, chemCallout, chemRef, chemMachines)
        : unstaged(CHEMICAL_MILLING_PROCESSES, '639 / 743 / 748');
    }

    const { currency } = getCurrencyForLocation(location);
    const fx = await this.exchangeRates.getSnapshot(accessToken);
    const usdToLocal = fx.convertStrict('USD', currency);
    const toLocal = (v: number | null | undefined) => (v == null ? null : Number((v * usdToLocal).toFixed(4)));

    const withLocal = (r: SecondaryProcessResult): SecondaryProcessLine => ({
      ...r,
      local: {
        currency,
        machineRate: toLocal(r.machine?.mhrUsd),
        laborRate: toLocal(r.machine?.lhrUsd),
        costPerPart: toLocal(r.costPerPartUsd),
      },
    });
    return {
      location,
      batchSize,
      materialCutCode: cutCode,
      materialTypeName: materialGroup,
      dataWarnings,
      surfaceLines: surfaceResults.map(withLocal),
      heatTreatmentLines: heatResults.map(withLocal),
      heatTreatmentCalloutProcess: matchHeatTreatmentCallout(item.heatTreatment),
      chemicalMillingLines: chemResults.map(withLocal),
      chemicalMillingCallout: chemCallout,
      lines: results.map((r) => ({
        ...r,
        local: {
          currency,
          machineRate: toLocal(r.machine?.mhrUsd),
          laborRate: toLocal(r.machine?.lhrUsd),
          costPerPart: toLocal(r.costPerPartUsd),
        },
      })),
    };
  }
}
