// Capability-first, physics-scored machine selection.
//
// Pipeline per (location, machine class, requirement):
//   1. Fetch pool  — cache-first; one mhr_records query per location covers all classes
//   2. Enrich      — DB capability columns → seed-registry by name → class defaults
//   3. Filter      — process-specific physical eligibility (tonnage/thickness/envelope/…)
//   4. Score       — Fit / Utilization / CostScore / Availability, each ∈ [0,1]
//   5. Profiles    — balanced (cost engine default), cheapest, fastest
//   6. Fallback    — LOCATION_MHR_DEFAULTS class rate when nothing is capable
//
// No Euclidean distance anywhere — all fit ratios are normalized and dimensionless.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  LOCATION_MHR_DEFAULTS,
  MACHINE_REGISTRY,
  type MachineClass,
} from '../default-rates';
import {
  BED_MARGIN,
  ENVELOPE_MARGIN,
  TONNAGE_MARGIN,
  type LaserRequirement,
  type MachineRequirement,
} from './physics';
import {
  EMPTY_CAPABILITY,
  MACHINE_CLASS_DEFAULTS,
  lookupSeedCapability,
  type MachineCapability,
} from './seed-registry';
import {
  type AvailabilityStatus,
  type MachineCandidate,
  type MachineRecommendation,
  type MachineSelectionResult,
} from '../../dto/machine-selection.dto';
import { getCachedMachinePool, setCachedMachinePool } from './pool-cache';

// Fit floor: any physically capable machine keeps a meaningful score even when
// grossly oversized, so a huge-but-only-capable machine still gets recommended.
const FIT_FLOOR = 0.3;

// Specific-cutting-energy heuristic: 1 kW spindle ≈ 20 cm³/min steel-equivalent MRR.
const MRR_CM3_MIN_PER_KW = 20;

const CAPABILITY_COLUMNS =
  'max_x_mm, max_y_mm, max_z_mm, max_diameter_mm, max_length_mm, max_tonnage, ' +
  'max_thickness_mm, max_workpiece_weight_kg, power_kw, capability_source, ' +
  'max_thickness_ms_mm, max_thickness_ss_mm, max_thickness_al_mm, max_thickness_cu_mm, ' +
  'cuttable_materials, availability_status, next_available_at, scheduled_load_pct, ' +
  'maintenance_window_start, maintenance_window_end, capability_version';

const BASE_COLUMNS =
  'id, machine_name, commodity_code, process_group, machine_class, ' +
  'total_machine_hour_rate, manual_mhr_value, fully_burdened_local_per_hr, ' +
  'capacity_utilization_rate';

// ── Row classification (same guards as the legacy resolveMHRRates) ────────────

const ALL_CLASSES = Object.keys(MACHINE_REGISTRY) as MachineClass[];

const COMMODITY_TO_CLASS = new Map<string, MachineClass>();
for (const cls of ALL_CLASSES) {
  for (const code of MACHINE_REGISTRY[cls].commodityCodes) COMMODITY_TO_CLASS.set(code, cls);
}

interface RawMachineRow {
  id: string;
  machine_name: string | null;
  commodity_code: string | null;
  process_group: string | null;
  machine_class: string | null;
  total_machine_hour_rate: number | string | null;
  manual_mhr_value: number | string | null;
  fully_burdened_local_per_hr: number | string | null;
  capacity_utilization_rate: number | string | null;
  // Capability columns — absent until migration 324 runs
  max_x_mm?: number | string | null;
  max_y_mm?: number | string | null;
  max_z_mm?: number | string | null;
  max_diameter_mm?: number | string | null;
  max_length_mm?: number | string | null;
  max_tonnage?: number | string | null;
  max_thickness_mm?: number | string | null;
  max_workpiece_weight_kg?: number | string | null;
  power_kw?: number | string | null;
  capability_source?: string | null;
  max_thickness_ms_mm?: number | string | null;
  max_thickness_ss_mm?: number | string | null;
  max_thickness_al_mm?: number | string | null;
  max_thickness_cu_mm?: number | string | null;
  cuttable_materials?: string[] | null;
  availability_status?: string | null;
  next_available_at?: string | null;
  scheduled_load_pct?: number | string | null;
  maintenance_window_start?: string | null;
  maintenance_window_end?: string | null;
  capability_version?: number | null;
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickRate(row: RawMachineRow): number {
  const fb = num(row.fully_burdened_local_per_hr) ?? 0;
  const mhr = num(row.total_machine_hour_rate) ?? 0;
  const man = num(row.manual_mhr_value) ?? 0;
  return fb > 0 ? fb : mhr > 0 ? mhr : man;
}

export function classifyMachineRecord(row: RawMachineRow): MachineClass | null {
  // Tier 1 — exact commodity code
  if (row.commodity_code && COMMODITY_TO_CLASS.has(row.commodity_code)) {
    return COMMODITY_TO_CLASS.get(row.commodity_code)!;
  }

  const mcLower = (row.machine_class ?? '').toLowerCase();
  const pgLower = (row.process_group ?? '').toLowerCase();
  const mnLower = (row.machine_name ?? '').toLowerCase();
  const allText = mcLower + ' ' + pgLower + ' ' + mnLower;
  const isLatheRecord = /lathe|turning|sliding.head|sub.?spindle/i.test(allText);
  // Gantry CNC routers (Thermwood, Multicam, "Router 3axis/5axis") are commonly
  // labelled with an axis count that collides with our '3AX'/'4AX'/'5AX' keywords
  // (e.g. machine_class "Router 5axis" contains the substring "5ax"). A router is
  // a distinct machine type from a box-way/BT-taper machining center or a lathe —
  // it lacks the rigidity for precision metal work — so it must never satisfy a
  // cnc_* class regardless of axis-count text matching.
  const isRouterRecord = /\brouter\b/i.test(allText);

  // Tier 2 — machine_class keyword (most specific text field)
  for (const cls of ALL_CLASSES) {
    const isMachiningClass = cls.startsWith('cnc_');
    const isVMCClass = cls === 'cnc_3ax_vmc' || cls === 'cnc_4ax_vmc' || cls === 'cnc_5ax_mc';
    if (isVMCClass && isLatheRecord) continue;
    if (isMachiningClass && isRouterRecord) continue;
    if (MACHINE_REGISTRY[cls].machineClassKeywords.some((kw) => mcLower.includes(kw.toLowerCase()))) {
      return cls;
    }
  }

  // Tier 3 — process_group keyword, but only when the machine NAME also matches,
  // so "Default Deslag" (process_group=Laser) can't classify as a fiber laser.
  for (const cls of ALL_CLASSES) {
    const isMachiningClass = cls.startsWith('cnc_');
    const isVMCClass = cls === 'cnc_3ax_vmc' || cls === 'cnc_4ax_vmc' || cls === 'cnc_5ax_mc';
    if (isVMCClass && isLatheRecord) continue;
    if (isMachiningClass && isRouterRecord) continue;
    const entry = MACHINE_REGISTRY[cls];
    const pgMatch = entry.processGroupKeywords.some((kw) => pgLower.includes(kw.toLowerCase()));
    const nameMatch = entry.machineClassKeywords.some((kw) => mnLower.includes(kw.toLowerCase()));
    if (pgMatch && nameMatch) return cls;
  }

  return null;
}

// ── Capability hydration: DB → seed registry → class defaults ─────────────────

function hydrateCapability(row: RawMachineRow, cls: MachineClass): {
  capability: MachineCapability;
  source: 'imported' | 'seed' | 'default_class';
} {
  const db: MachineCapability = {
    maxXMm: num(row.max_x_mm),
    maxYMm: num(row.max_y_mm),
    maxZMm: num(row.max_z_mm),
    maxDiameterMm: num(row.max_diameter_mm),
    maxLengthMm: num(row.max_length_mm),
    maxTonnage: num(row.max_tonnage),
    maxThicknessMm: num(row.max_thickness_mm),
    maxWorkpieceWeightKg: num(row.max_workpiece_weight_kg),
    powerKw: num(row.power_kw),
    maxThicknessMsMm: num(row.max_thickness_ms_mm),
    maxThicknessSsMm: num(row.max_thickness_ss_mm),
    maxThicknessAlMm: num(row.max_thickness_al_mm),
    maxThicknessCuMm: num(row.max_thickness_cu_mm),
    cuttableMaterials: row.cuttable_materials ?? null,
  };

  const hasDbCapability = Object.entries(db).some(([k, v]) => k !== 'cuttableMaterials' && v != null);
  if (hasDbCapability) {
    return { capability: db, source: (row.capability_source as 'imported' | 'seed') ?? 'imported' };
  }

  const seed = lookupSeedCapability(row.machine_name);
  if (seed) return { capability: { ...EMPTY_CAPABILITY, ...seed }, source: 'seed' };

  return {
    capability: { ...EMPTY_CAPABILITY, ...MACHINE_CLASS_DEFAULTS[cls] },
    source: 'default_class',
  };
}

// ── Pool fetch ────────────────────────────────────────────────────────────────

export async function fetchMachinePool(
  client: SupabaseClient,
  location: string,
): Promise<MachineCandidate[]> {
  const cached = getCachedMachinePool(location);
  if (cached) return cached;

  const query = (columns: string) =>
    client.from('mhr_records').select(columns).eq('location', location).limit(2000);

  let { data, error } = await query(`${BASE_COLUMNS}, ${CAPABILITY_COLUMNS}`);
  if (error && /column|schema cache/i.test(error.message)) {
    // Migration 324 not applied yet — base columns only; seed registry covers capability
    ({ data, error } = await query(BASE_COLUMNS));
  }
  if (error || !data) return [];

  const candidates: MachineCandidate[] = [];
  for (const raw of data as unknown as RawMachineRow[]) {
    const cls = classifyMachineRecord(raw);
    if (!cls) continue;
    const rate = pickRate(raw);
    if (rate <= 0) continue;

    const { capability, source } = hydrateCapability(raw, cls);
    candidates.push({
      machineId: raw.id,
      machineName: raw.machine_name,
      commodityCode: raw.commodity_code,
      machineClass: cls,
      hourlyRate: rate,
      utilizationPct: num(raw.capacity_utilization_rate) ?? 85,
      scheduledLoadPct: num(raw.scheduled_load_pct),
      availabilityStatus: (raw.availability_status as AvailabilityStatus) ?? 'available',
      nextAvailableAt: raw.next_available_at ?? null,
      maintenanceWindowStart: raw.maintenance_window_start ?? null,
      maintenanceWindowEnd: raw.maintenance_window_end ?? null,
      capability,
      capabilitySource: source,
      capabilityVersion: raw.capability_version ?? null,
    });
  }

  setCachedMachinePool(location, candidates);
  return candidates;
}

// ── Eligibility ───────────────────────────────────────────────────────────────

function laserThicknessLimit(cap: MachineCapability, req: LaserRequirement): number | null {
  switch (req.materialFamily) {
    case 'MS': return cap.maxThicknessMsMm ?? cap.maxThicknessMm;
    case 'SS': return cap.maxThicknessSsMm ?? cap.maxThicknessMm;
    case 'AL': return cap.maxThicknessAlMm ?? cap.maxThicknessMm;
    case 'CU': return cap.maxThicknessCuMm ?? cap.maxThicknessMm;
    default:   return cap.maxThicknessMm ?? cap.maxThicknessMsMm;
  }
}

// Flat stock can be rotated 90° on the bed — accept either orientation.
function fitsBed(cap: MachineCapability, lengthMm: number, widthMm: number): boolean {
  const x = cap.maxXMm;
  const y = cap.maxYMm;
  if (x == null || y == null) return true; // no bed spec on file — don't reject
  const l = lengthMm * BED_MARGIN;
  const w = widthMm * BED_MARGIN;
  return (x >= l && y >= w) || (x >= w && y >= l);
}

export function isCapable(candidate: MachineCandidate, req: MachineRequirement): boolean {
  const cap = candidate.capability;

  if (candidate.availabilityStatus === 'down' || candidate.availabilityStatus === 'retired') {
    return false;
  }

  switch (req.kind) {
    case 'press_brake': {
      if (cap.maxTonnage != null && cap.maxTonnage < req.tonnage * TONNAGE_MARGIN) return false;
      if (cap.maxLengthMm != null && cap.maxLengthMm < req.bendLengthMm * BED_MARGIN) return false;
      if (cap.maxThicknessMm != null && cap.maxThicknessMm < req.thicknessMm) return false;
      return true;
    }
    case 'laser': {
      const limit = laserThicknessLimit(cap, req);
      if (limit != null && limit < req.thicknessMm) return false;
      if (
        cap.cuttableMaterials?.length &&
        req.materialGrade &&
        !cap.cuttableMaterials.some((m) => m.toLowerCase() === req.materialGrade!.toLowerCase())
      ) {
        return false;
      }
      return fitsBed(cap, req.bedLengthMm, req.bedWidthMm);
    }
    case 'vmc': {
      if (cap.maxXMm != null && cap.maxXMm < req.xMm * ENVELOPE_MARGIN) return false;
      if (cap.maxYMm != null && cap.maxYMm < req.yMm * ENVELOPE_MARGIN) return false;
      if (cap.maxZMm != null && cap.maxZMm < req.zMm * ENVELOPE_MARGIN) return false;
      if (cap.maxWorkpieceWeightKg != null && cap.maxWorkpieceWeightKg < req.weightKg) return false;
      if (cap.powerKw != null && cap.powerKw * MRR_CM3_MIN_PER_KW < req.mrrCm3PerMin) return false;
      return true;
    }
    case 'lathe': {
      if (cap.maxDiameterMm != null && cap.maxDiameterMm < req.diameterMm * ENVELOPE_MARGIN) return false;
      if (cap.maxLengthMm != null && cap.maxLengthMm < req.lengthMm * ENVELOPE_MARGIN) return false;
      return true;
    }
    case 'generic':
      return true;
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function clamp01(n: number): number { return Math.min(1, Math.max(0, n)); }

function ratio(need: number, have: number | null): number | null {
  if (have == null || have <= 0) return null;
  return clamp01(need / have);
}

// Normalized fit: how tightly the part fills the machine's capability envelope.
// 1.0 = perfectly sized machine; FIT_FLOOR = capable but grossly oversized.
export function fitScore(candidate: MachineCandidate, req: MachineRequirement): number {
  const cap = candidate.capability;
  const parts: number[] = [];

  switch (req.kind) {
    case 'press_brake': {
      const t = ratio(req.tonnage * TONNAGE_MARGIN, cap.maxTonnage);
      const l = ratio(req.bendLengthMm * BED_MARGIN, cap.maxLengthMm);
      if (t != null) parts.push(t);
      if (l != null) parts.push(l);
      break;
    }
    case 'laser': {
      const x = ratio(req.bedLengthMm * BED_MARGIN, cap.maxXMm);
      const y = ratio(req.bedWidthMm * BED_MARGIN, cap.maxYMm);
      const thk = ratio(req.thicknessMm, laserThicknessLimit(cap, req));
      if (x != null) parts.push(x);
      if (y != null) parts.push(y);
      if (thk != null) parts.push(thk);
      break;
    }
    case 'vmc': {
      const x = ratio(req.xMm * ENVELOPE_MARGIN, cap.maxXMm);
      const y = ratio(req.yMm * ENVELOPE_MARGIN, cap.maxYMm);
      const z = ratio(req.zMm * ENVELOPE_MARGIN, cap.maxZMm);
      if (x != null) parts.push(x);
      if (y != null) parts.push(y);
      if (z != null) parts.push(z);
      break;
    }
    case 'lathe': {
      const d = ratio(req.diameterMm * ENVELOPE_MARGIN, cap.maxDiameterMm);
      const l = ratio(req.lengthMm * ENVELOPE_MARGIN, cap.maxLengthMm);
      if (d != null) parts.push(d);
      if (l != null) parts.push(l);
      break;
    }
    case 'generic':
      return 0.7;
  }

  if (parts.length === 0) return 0.5; // no spec on file — neutral fit
  const avg = parts.reduce((s, p) => s + p, 0) / parts.length;
  return Math.max(FIT_FLOOR, avg);
}

function utilizationScore(candidate: MachineCandidate): number {
  // Reward machines closest to the 75% target load
  return clamp01(1 - Math.abs(0.75 - candidate.utilizationPct / 100));
}

function availabilityScore(candidate: MachineCandidate, now: Date): number {
  if (candidate.availabilityStatus === 'commissioning') return 0.5;
  if (isInMaintenanceWindow(candidate, now)) return 0;
  if ((candidate.scheduledLoadPct ?? 0) >= 80) return 0.7;
  return 1.0;
}

function isInMaintenanceWindow(candidate: MachineCandidate, now: Date): boolean {
  if (candidate.availabilityStatus === 'maintenance') return true;
  if (candidate.maintenanceWindowStart && candidate.maintenanceWindowEnd) {
    const start = new Date(candidate.maintenanceWindowStart);
    const end = new Date(candidate.maintenanceWindowEnd);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return now >= start && now <= end;
    }
  }
  return false;
}

// ── Reasons (explanation engine) ──────────────────────────────────────────────

function buildReasons(candidate: MachineCandidate, req: MachineRequirement): string[] {
  const cap = candidate.capability;
  const reasons: string[] = [];
  const r0 = (n: number) => Math.round(n * 10) / 10;

  switch (req.kind) {
    case 'press_brake':
      reasons.push(`Requires ${r0(req.tonnage * TONNAGE_MARGIN)} t (incl. 15% margin)` +
        (cap.maxTonnage != null ? ` ≤ ${r0(cap.maxTonnage)} t machine capacity` : ''));
      if (cap.maxLengthMm != null) reasons.push(`Bend ${r0(req.bendLengthMm)} mm ≤ ${r0(cap.maxLengthMm)} mm bed`);
      break;
    case 'laser': {
      const limit = laserThicknessLimit(cap, req);
      if (limit != null) reasons.push(`${req.materialFamily} ${r0(req.thicknessMm)} mm ≤ ${r0(limit)} mm limit`);
      if (cap.maxXMm != null && cap.maxYMm != null) {
        reasons.push(`Part ${r0(req.bedLengthMm)}×${r0(req.bedWidthMm)} mm fits ${r0(cap.maxXMm)}×${r0(cap.maxYMm)} mm bed`);
      }
      break;
    }
    case 'vmc':
      if (cap.maxXMm != null && cap.maxYMm != null && cap.maxZMm != null) {
        reasons.push(`Part ${r0(req.xMm)}×${r0(req.yMm)}×${r0(req.zMm)} mm fits ` +
          `${r0(cap.maxXMm)}×${r0(cap.maxYMm)}×${r0(cap.maxZMm)} mm envelope (×1.2 margin)`);
      }
      if (cap.maxWorkpieceWeightKg != null) reasons.push(`${r0(req.weightKg)} kg ≤ ${r0(cap.maxWorkpieceWeightKg)} kg table load`);
      break;
    case 'lathe':
      if (cap.maxDiameterMm != null) reasons.push(`Ø${r0(req.diameterMm)} mm ≤ Ø${r0(cap.maxDiameterMm)} mm swing (×1.2 margin)`);
      if (cap.maxLengthMm != null) reasons.push(`Length ${r0(req.lengthMm)} mm ≤ ${r0(cap.maxLengthMm)} mm between centres`);
      break;
    case 'generic':
      reasons.push('No dimensional constraints for this process');
      break;
  }

  reasons.push(`Utilization ${r0(candidate.utilizationPct)}%`);
  if (candidate.capabilitySource === 'seed') reasons.push('Capability from model seed data — verify against machine plate');
  if (candidate.capabilitySource === 'default_class') reasons.push('No capability on file — conservative class defaults applied');
  return reasons;
}

// ── Selection ─────────────────────────────────────────────────────────────────

interface ProfileWeights { fit: number; util: number; cost: number; avail: number }

const PROFILES: Record<'balanced' | 'cheapest' | 'fastest', ProfileWeights> = {
  balanced: { fit: 0.5, util: 0.3, cost: 0.2, avail: 0 },
  cheapest: { fit: 0.2, util: 0.1, cost: 0.7, avail: 0 },
  fastest:  { fit: 0.2, util: 0.5, cost: 0.2, avail: 0.1 },
};

function makeDefaultCandidate(location: string, cls: MachineClass): MachineCandidate {
  const locationMHR = (LOCATION_MHR_DEFAULTS as Record<string, Partial<Record<MachineClass, number>>>)[location];
  return {
    machineId: null,
    machineName: null,
    commodityCode: null,
    machineClass: cls,
    hourlyRate: locationMHR?.[cls] ?? MACHINE_REGISTRY[cls].defaultRate,
    utilizationPct: 75,
    scheduledLoadPct: null,
    availabilityStatus: 'available',
    nextAvailableAt: null,
    maintenanceWindowStart: null,
    maintenanceWindowEnd: null,
    capability: { ...EMPTY_CAPABILITY, ...MACHINE_CLASS_DEFAULTS[cls] },
    capabilitySource: 'default_class',
    capabilityVersion: null,
  };
}

export interface SelectMachineInput {
  pool: MachineCandidate[];          // full location pool (all classes)
  location: string;
  machineClass: MachineClass;
  requirement: MachineRequirement;
  overrideMachineId?: string | null; // user override — short-circuits scoring
  now?: Date;
}

export function selectMachine(input: SelectMachineInput): MachineSelectionResult {
  const { pool, location, machineClass, requirement } = input;
  const now = input.now ?? new Date();

  const classPool = pool.filter((c) => c.machineClass === machineClass);
  const eligible = classPool.filter((c) => isCapable(c, requirement));

  // No capable machine — fall through to location class-default rate
  if (eligible.length === 0 && !input.overrideMachineId) {
    const fallback = makeDefaultCandidate(location, machineClass);
    const rec: MachineRecommendation = {
      candidate: fallback,
      score: 0.4,
      reasons: [
        classPool.length === 0
          ? 'No machine of this class in DB — using class default rate'
          : 'No capable machine in DB — using class default rate',
      ],
    };
    return {
      balanced: rec, cheapest: rec, fastest: rec,
      alternatives: [],
      confidence: 40,
      requirement,
      allowOverride: true,
      overridden: false,
    };
  }

  const minRate = Math.min(...eligible.map((c) => c.hourlyRate));

  const scored = eligible.map((candidate) => {
    const fit = fitScore(candidate, requirement);
    const util = utilizationScore(candidate);
    const cost = minRate > 0 ? clamp01(minRate / candidate.hourlyRate) : 0;
    const avail = availabilityScore(candidate, now);
    return { candidate, fit, util, cost, avail };
  });

  const rank = (weights: ProfileWeights) =>
    [...scored].sort((a, b) => {
      const sa = a.fit * weights.fit + a.util * weights.util + a.cost * weights.cost + a.avail * weights.avail;
      const sb = b.fit * weights.fit + b.util * weights.util + b.cost * weights.cost + b.avail * weights.avail;
      return sb - sa || a.candidate.hourlyRate - b.candidate.hourlyRate;
    });

  const toRecommendation = (
    s: (typeof scored)[number],
    weights: ProfileWeights,
  ): MachineRecommendation => ({
    candidate: s.candidate,
    score: Math.round((s.fit * weights.fit + s.util * weights.util + s.cost * weights.cost + s.avail * weights.avail) * 1000) / 1000,
    reasons: buildReasons(s.candidate, requirement),
  });

  // User override: force the pick, even outside the capability filter (their judgment)
  let overridden = false;
  let balancedRec: MachineRecommendation;
  const balancedRanked = rank(PROFILES.balanced);
  const cheapestRanked = rank(PROFILES.cheapest);
  const fastestRanked = rank(PROFILES.fastest);

  if (input.overrideMachineId) {
    const forced = classPool.find((c) => c.machineId === input.overrideMachineId)
      ?? pool.find((c) => c.machineId === input.overrideMachineId);
    if (forced) {
      overridden = true;
      const fit = fitScore(forced, requirement);
      balancedRec = {
        candidate: forced,
        score: Math.round(fit * 1000) / 1000,
        reasons: ['Manually selected by cost engineer', ...buildReasons(forced, requirement)],
      };
      if (!isCapable(forced, requirement)) {
        balancedRec.reasons.unshift('⚠ Outside computed capability for this part — verify feasibility');
      }
    } else {
      balancedRec = toRecommendation(balancedRanked[0], PROFILES.balanced);
    }
  } else {
    balancedRec = toRecommendation(balancedRanked[0], PROFILES.balanced);
  }

  const cheapestRec = toRecommendation(cheapestRanked[0], PROFILES.cheapest);
  const fastestRec = toRecommendation(fastestRanked[0], PROFILES.fastest);

  // Alternatives: top cheapest + top fastest, deduped against the balanced pick
  const alternatives: MachineCandidate[] = [];
  for (const rec of [cheapestRec, fastestRec]) {
    if (
      rec.candidate.machineId !== balancedRec.candidate.machineId &&
      !alternatives.some((a) => a.machineId === rec.candidate.machineId)
    ) {
      alternatives.push(rec.candidate);
    }
  }
  // Fill from balanced ranking if still short
  for (const s of balancedRanked.slice(1)) {
    if (alternatives.length >= 2) break;
    if (
      s.candidate.machineId !== balancedRec.candidate.machineId &&
      !alternatives.some((a) => a.machineId === s.candidate.machineId)
    ) {
      alternatives.push(s.candidate);
    }
  }

  const balancedFit = fitScore(balancedRec.candidate, requirement);
  const confidence = balancedRec.candidate.capabilitySource === 'default_class'
    ? 40
    : Math.round(balancedFit * 100);

  let availabilityWarning: string | undefined;
  const picked = balancedRec.candidate;
  if (isInMaintenanceWindow(picked, now)) {
    availabilityWarning = picked.nextAvailableAt
      ? `Under maintenance until ${picked.nextAvailableAt.slice(0, 10)}`
      : 'Under maintenance';
  } else if ((picked.scheduledLoadPct ?? 0) >= 90) {
    availabilityWarning = `Heavily booked (${Math.round(picked.scheduledLoadPct!)}% scheduled load)`;
  }

  return {
    balanced: balancedRec,
    cheapest: cheapestRec,
    fastest: fastestRec,
    alternatives: alternatives.slice(0, 2),
    confidence,
    requirement,
    allowOverride: true,
    overridden,
    availabilityWarning,
  };
}
