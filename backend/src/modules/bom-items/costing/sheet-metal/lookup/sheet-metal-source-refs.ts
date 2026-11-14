import type { CalculationTraceStep, LookupResolution, SheetMetalSourceTable, SourceRef } from '../../../dto/cost-breakdown.dto';
import type { MaterialSourceColumns } from '../../../services/material-resolution.service';
import type { InspectionPlan } from '../../shared/process/inspection-engine';
import type { TurretPunchMachineParams } from '../../shared/core/manufacturing-process.types';

/**
 * Where each sheet-metal calculator input was read (SourceRef), built at the point the engine seeds the calculator: the row of the
 * sm_lookup_* table or machine-library table the value came from, the sheet-metal variable, or the raw_materials record. The calculator
 * dialog's eye opens exactly that table with that row outlined. A value with no single source row (an interpolated stroke time, a value
 * read from a staged export no endpoint serves) gets no ref: nothing is invented to point at. CAD-measured inputs are not listed here:
 * their ref comes from their evidence key (sourceRefOfSeed).
 */

/** The reference-data domain of sm_reference_data (processes/reference-domains.ts): its variables are listed by GET /processes/variables. */
export const SHEET_METAL_DOMAIN = 'sheet_metal';

type RowKeys = Record<string, string | number>;

export const smTableRef = (table: SheetMetalSourceTable, column: string, row: RowKeys | null): SourceRef => ({ kind: 'smTable', table, column, row });

/** A numeric sheet-metal variable (sm_reference_data category 'variable', SheetMetalLookupService.getNumericVariables). */
export const smVariableRef = (name: string): SourceRef => ({ kind: 'variable', domain: SHEET_METAL_DOMAIN, name });

/** The raw_materials record the quote priced from, and the column each property was read from (resolveMaterialForFamily). */
export interface MaterialRecord {
  id: string;
  name: string;
  columns: MaterialSourceColumns;
}

/** The material record's column holding `property`; undefined when no record matched or the record does not hold it. */
export function materialRef(record: MaterialRecord | null | undefined, property: keyof MaterialSourceColumns): SourceRef | undefined {
  const column = record?.columns[property];
  return record && column ? { kind: 'material', materialId: record.id, materialName: record.name, column } : undefined;
}

/** Drops the fields with no ref, so a seedRefs map only names real sources. */
function defined(refs: Record<string, SourceRef | undefined>): Record<string, SourceRef> {
  return Object.fromEntries(Object.entries(refs).filter((e): e is [string, SourceRef] => e[1] !== undefined));
}

/** Calculator fields read from the material record (field -> property): each with its record column, when the record holds it. */
export function materialSeedRefs(
  record: MaterialRecord | null | undefined,
  fields: Record<string, keyof MaterialSourceColumns>,
): Record<string, SourceRef> {
  return defined(Object.fromEntries(Object.entries(fields).map(([field, property]) => [field, materialRef(record, property)])));
}

/** Laser Cutting: Cutting Speed and Piercing Time Per Start, both from the one sm_lookup_laser_cut row getLaserParams matched. */
export function laserCutSeedRefs(params: { dataFound: boolean; row?: RowKeys } | null | undefined): Record<string, SourceRef> {
  if (!params?.dataFound || !params.row) return {};
  return {
    'Cutting Speed': smTableRef('sm_lookup_laser_cut', 'cutting_speed_m_per_min', params.row),
    'Piercing Time Per Start': smTableRef('sm_lookup_laser_cut', 'pierce_time_min', params.row),
  };
}

/**
 * Press brake Time Per Stroke: the sm_lookup_manual_stroke row it was read from. None when the value is the machine's own bend cycle time
 * (machine library, no endpoint serves it) or was interpolated/extrapolated between rows (no single row holds it).
 */
export function manualStrokeRef(stroke: { dataFound: boolean; fromMachineSpec?: boolean; resolution: LookupResolution }): SourceRef | undefined {
  const cols = stroke.resolution.matchedRow?.columns;
  if (!stroke.dataFound || stroke.fromMachineSpec || !cols) return undefined;
  if ('interpolated_between_thickness_mm' in cols || 'extrapolated_from_thickness_mm' in cols) return undefined;
  return smTableRef('sm_lookup_manual_stroke', 'stroke_time_sec', { thickness_mm: cols.thickness_mm!, tonnage: cols.tonnage!, complexity: cols.complexity! });
}

/** Press Brake (Bending) calculator inputs read from a table or record. */
export function pressBrakeSeedRefs(input: {
  stroke: Parameters<typeof manualStrokeRef>[0];
  handling: { dataFound: boolean; row?: RowKeys };
  toolSetup: { dataFound: boolean; row?: RowKeys };
  material: MaterialRecord | null | undefined;
  /** True when UTS is the material record's own value; an approved-family default is not read from the record. */
  utsFromRecord: boolean;
}): Record<string, SourceRef> {
  return defined({
    'Time Per Stroke': manualStrokeRef(input.stroke),
    'Sheet Loading Time': input.handling.dataFound && input.handling.row ? smTableRef('sm_lookup_handling_time', 'handling_min', input.handling.row) : undefined,
    'Tool Loading Time': input.toolSetup.dataFound && input.toolSetup.row ? smTableRef('sm_lookup_tool_setup', 'loading_time_min', input.toolSetup.row) : undefined,
    UTS: input.utsFromRecord ? materialRef(input.material, 'utsMpa') : undefined,
  });
}

/** Inspection calculator check times -> the inspection_operation_defaults feature each is read for. */
const INSPECTION_FEATURE_BY_FIELD = {
  'Visual Pass Base': 'visual_base',
  'Hole Check Time': 'hole',
  'Bend Check Time': 'bend',
  'Thread Gauge Time': 'thread',
  'Thickness Check Time': 'thickness',
  'Dimension Check Time': 'dimension',
} as const;

/** Inspection: each check time from the inspection_operation_defaults row (feature + method) the plan read it from. */
export function inspectionSeedRefs(plan: Pick<InspectionPlan, 'sourceRows'>): Record<string, SourceRef> {
  return defined(Object.fromEntries(Object.entries(INSPECTION_FEATURE_BY_FIELD).map(([field, feature]) => {
    const row = plan.sourceRows[feature];
    return [field, row ? smTableRef('inspection_operation_defaults', 'cycle_time_sec', { feature: row.feature, method: row.method }) : undefined];
  })));
}

/** Turret Punching: the machine's row of the Turret Press machine table, and the Lookup Table 1 row its stroke rate factor came from. */
export function turretSeedRefs(machineName: string | null | undefined, params: TurretPunchMachineParams): Record<string, SourceRef> {
  const machine = machineName ? { machine_name: machineName } : null;
  return defined({
    'Punch Rate (hits/min)': machine ? smTableRef('turret_machines', 'punch_rate_cycles_min', machine) : undefined,
    'Tool Change Time (s)': machine ? smTableRef('turret_machines', 'tool_change_time_s', machine) : undefined,
    'Nibble Speed (mm/min)': machine ? smTableRef('turret_machines', 'nibble_speed_mm_per_min', machine) : undefined,
    'Stroke Rate Factor': params.strokeRateFactorRow
      ? smTableRef('stroke_rate_factor', params.strokeRateFactorRow.column, { tonnage_t: params.strokeRateFactorRow.tonnageT })
      : undefined,
  });
}

/**
 * Waterjet Cutting: the machine's nozzle delay, the two sheet-metal variables, and the cutting speed — not a table value but the
 * sm_lookup_waterjet_cut speed scaled by the machine's mixing tube against the reference machine's, so it is shown as that calculation.
 */
export function waterjetSeedRefs(input: {
  machineName: string;
  referenceMachineName: string;
  cutRow: RowKeys | undefined;
  tableSpeedMmPerMin: number;
  machineTubeMm: number;
  referenceTubeMm: number;
  speedFactor: number;
  material: string;
  thicknessMm: number;
}): Record<string, SourceRef> {
  const steps: CalculationTraceStep[] = [
    {
      fieldName: 'Table Cutting Speed', displayLabel: 'Table Cutting Speed', kind: 'input', value: input.tableSpeedMmPerMin, unit: 'mm/min',
      source: `sm_lookup_waterjet_cut — ${input.material}, ${input.thicknessMm}mm sheet`,
      ...(input.cutRow ? { ref: smTableRef('sm_lookup_waterjet_cut', 'cutting_speed_mm_per_min', input.cutRow) } : {}),
    },
    {
      fieldName: 'Mixing Tube', displayLabel: 'Mixing Tube', kind: 'input', value: input.machineTubeMm, unit: 'mm',
      source: `${input.machineName} — mixing_tube_diameter_mm (machine library)`,
      ref: smTableRef('waterjet_machines', 'mixing_tube_diameter_mm', { machine_name: input.machineName }),
    },
    {
      fieldName: 'Reference Mixing Tube', displayLabel: 'Reference Mixing Tube', kind: 'input', value: input.referenceTubeMm, unit: 'mm',
      source: `${input.referenceMachineName} — mixing_tube_diameter_mm (machine library, the cut-speed table's reference machine)`,
      ref: smTableRef('waterjet_machines', 'mixing_tube_diameter_mm', { machine_name: input.referenceMachineName }),
    },
    { fieldName: 'Speed Factor', displayLabel: 'Speed Factor', kind: 'calculated', value: input.speedFactor, formula: '{Mixing Tube} / {Reference Mixing Tube}' },
    {
      fieldName: 'Cutting Speed', displayLabel: 'Cutting Speed', kind: 'calculated', value: input.tableSpeedMmPerMin * input.speedFactor,
      unit: 'mm/min', formula: '{Table Cutting Speed} * {Speed Factor}',
    },
  ];
  return {
    'Cutting Speed': { kind: 'calculation', name: `Waterjet cutting speed for ${input.machineName}`, evidence: null, steps },
    'Lead In Per Start': smVariableRef('standardWaterjetCutLeadInAmount'),
    'Cut Time Adjustment Factor': smVariableRef('waterjetCutTimeAdjustmentFactor'),
    'Pierce Delay Per Start': smTableRef('waterjet_machines', 'nozzle_delay_s', { machine_name: input.machineName }),
  };
}

/**
 * Deburring's time per mm: a Deslag machine's perimeter allowance, its row of the Deslag machine table. A Manual Deburr rate is computed
 * from the machining deburring table and a pass count, not read from one row: no ref.
 */
export function deburrTimeRef(candidate: { machineClass: string; machineName: string | null }): SourceRef | undefined {
  if (candidate.machineClass === 'manual_deburr' || !candidate.machineName) return undefined;
  return smTableRef('deslag_allowance', 'perimeter_allowance_s_per_mm', { machine_name: candidate.machineName });
}
