import { IsOptional, IsString, IsUUID } from 'class-validator';
import type { MachineClass } from '../costing/default-rates';
import type { MachineCapability } from '../costing/machine-selection/seed-registry';
import type { MachineRequirement } from '../costing/machine-selection/physics';

export type CapabilitySource = 'imported' | 'seed' | 'default_class';
export type AvailabilityStatus = 'available' | 'maintenance' | 'down' | 'retired' | 'commissioning';

export interface MachineCandidate {
  machineId: string | null;      // mhr_records.id; null for class-default fallback
  machineName: string | null;
  commodityCode: string | null;
  machineClass: MachineClass;
  hourlyRate: number;
  utilizationPct: number;        // capacity_utilization_rate 0-100 — a real value when utilizationKnown, otherwise a neutral ranking assumption
  utilizationKnown: boolean;     // false when capacity_utilization_rate wasn't on file and utilizationPct is a ranking-only placeholder
  scheduledLoadPct: number | null;
  availabilityStatus: AvailabilityStatus;
  nextAvailableAt: string | null;
  maintenanceWindowStart: string | null;
  maintenanceWindowEnd: string | null;
  capability: MachineCapability;
  capabilitySource: CapabilitySource;
  capabilityVersion: number | null;
  // mhr_records.operators — real per-machine operator headcount. null for the
  // class-default fallback candidate (no real machine) or when a real machine
  // row has never had this field set; callers must fall back to a generic
  // default (1) rather than treat null as zero operators.
  operators: number | null;
  // mhr_records.usd_lhr_total — this specific machine's own labor rate
  // (sourced from machine_library.json's labor_rate_usd_hr for benchmarked
  // rows). When present, takes precedence over the location+process_group
  // lhr_records/lhr_benchmark_rates lookup for this machine's operations —
  // an explicit, approved exception to that being the sole labor-rate source
  // (see bom-items.service.ts's buildOutput). null when no real machine or
  // the field was never set.
  laborRateUsdHr: number | null;
  // mhr_records.press_cycle_time_s / handling_time_const_s /
  // handling_time_mass_coeff_s_per_kg — Standard Press / Tandem Press's real
  // per-machine stroke-cycle-time and linear handling-time formula (Track B
  // Phase 2, migration 608). Unlike every other cutting-family process,
  // these two machine classes have no thickness/material lookup table — the
  // cycle time genuinely IS a fixed per-machine constant. null for every
  // other machine class, or a real press machine this data hasn't been
  // sourced for yet (see migration 608's own documented scope).
  pressCycleTimeS: number | null;
  handlingConstS: number | null;
  handlingMassCoeffSPerKg: number | null;
}

// Structured version of the material/thickness-vs-capacity check — lets the
// UI render a Material/Thickness/Capacity/Status table instead of parsing a
// flat "MS 1.5 mm ≤ 12 mm limit" string. materialGrade is the raw grade (e.g.
// "SECC"), not the classified family used for the limit lookup, so the UI
// shows what the user actually selected. null when this requirement kind has
// no single dominant dimensional check (e.g. generic/deburring).
export interface CapabilityCheck {
  parameter: string;              // e.g. 'Thickness', 'Tonnage'
  materialGrade: string | null;
  value: number;
  limit: number | null;
  unit: string;
  supported: boolean;
}

export interface MachineRecommendation {
  candidate: MachineCandidate;
  score: number;      // 0-1 composite for the profile
  reasons: string[];  // human-readable "why this machine"
  capabilityCheck?: CapabilityCheck | null;
}

export interface MachineSelectionResult {
  // Balanced is the default the cost engine prices with; cheapest/fastest are
  // surfaced so a cost engineer can flip profiles per line without an API call.
  balanced: MachineRecommendation;
  cheapest: MachineRecommendation;
  fastest: MachineRecommendation;
  alternatives: MachineCandidate[];   // up to 2, deduped against balanced pick
  confidence: number;                 // balanced Fit × 100
  requirement: MachineRequirement;
  allowOverride: true;
  overridden: boolean;                // true when a user override forced the pick
  availabilityWarning?: string;
}

export class MachineOverrideDto {
  @IsString()
  processKey!: string;               // machine class key, e.g. 'fiber_laser'

  @IsOptional()
  @IsUUID()
  mhrRecordId?: string | null;       // null/omitted = clear override, revert to auto

  // Digital Factory location the override applies to. Overrides are scoped per
  // location (migration 329) — an India machine pick must never leak into a USA
  // costing. Optional for backward compatibility; the service defaults it.
  @IsOptional()
  @IsString()
  location?: string;
}
