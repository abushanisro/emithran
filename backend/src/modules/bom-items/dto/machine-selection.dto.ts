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
  utilizationPct: number;        // capacity_utilization_rate 0-100
  scheduledLoadPct: number | null;
  availabilityStatus: AvailabilityStatus;
  nextAvailableAt: string | null;
  maintenanceWindowStart: string | null;
  maintenanceWindowEnd: string | null;
  capability: MachineCapability;
  capabilitySource: CapabilitySource;
  capabilityVersion: number | null;
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
