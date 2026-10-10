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

import { readAllRows, type RowPage } from '../../../../../../common/supabase/read-all-rows';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MACHINE_REGISTRY,
  type MachineClass,
} from '../../core/default-rates.constants';
import {
  BED_MARGIN,
  ENVELOPE_MARGIN,
  IM_TIEBAR_ADDEND_MM,
  TONNAGE_MARGIN,
  type LaserRequirement,
  type LaserMaterialFamily,
  type MachineRequirement,
  DEBURR_MACHINE_CLASSES,
  deburrCycleSec,
  deburrSecPerMm,
} from './physics';
import {
  EMPTY_CAPABILITY,
  MACHINE_CLASS_DEFAULTS,
  lookupSeedCapability,
  type MachineCapability,
} from './seed-registry';
import {
  type AvailabilityStatus,
  type CapabilityCheck,
  type MachineCandidate,
  type MachineRecommendation,
  type MachineScoreBreakdown,
  type MachineSelectionDecision,
  type MachineSelectionResult,
} from '../../../../dto/machine-selection.dto';
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
  'maintenance_window_start, maintenance_window_end, ' +
  'tie_bar_x_mm, tie_bar_y_mm, shot_capacity_grams, min_mold_height_mm, max_mold_height_mm';

const BASE_COLUMNS =
  'id, machine_name, commodity_code, process_group, machine_class, ' +
  'total_machine_hour_rate, manual_mhr_value, fully_burdened_local_per_hr, ' +
  'capacity_utilization_rate, operators, usd_lhr_total, ' +
  'press_cycle_time_s, handling_time_const_s, handling_time_mass_coeff_s_per_kg, setup_time_hr, ' +
  'cut_to_length_cycle_const_s, cut_to_length_cycle_mass_coeff_s_per_kg, cut_to_length_cut_speed_s, ' +
  'number_spindles, drum_index_time_s, transfer_time_s, stock_feed_time_s, speed_synchronization_time_s, ' +
  // The two components the canonical MHR is DEFINED as (migration 581:
  // MHR = Direct Overhead + Indirect Overhead). Carried so the benchmark
  // override guard can tell a real, self-consistent machine rate apart from
  // a mis-scaled import — see applyBenchmarkOverrideIfNeeded.
  'direct_overhead_rate, indirect_overhead_rate';

// ── Row classification (same guards as the legacy resolveMHRRates) ────────────

const ALL_CLASSES = Object.keys(MACHINE_REGISTRY) as MachineClass[];

// Real Machining machine_class values (memory/machining/machine/*.json,
// staged via migrations 692/693/737/738) use Digital-Factory-sourced
// snake_case station names ('3_axis_mill', '2_axis_lathe', ...) — a
// genuinely different vocabulary from this registry's canonical cnc_*
// buckets. Without this alias, classifyMachineRecord's Tier 0 (exact
// canonical match) and Tier 2 (keyword match) both silently miss every one
// of these real rows: Tier 0 fails because '3_axis_mill' isn't itself a
// MachineClass key, and Tier 2 fails because hasKeyword's substring match
// needs a literal space/hyphen ('3 Axis'/'3-axis') which an underscore
// never satisfies. Result before this fix: all 314 real Machining machines
// (old and new) were invisible to live quoting — they render correctly on
// the HR Rates page (which reads mhr_records directly) but classifyMachineRecord
// returned null for every one of them, so cost-machining-engine.ts always priced
// off the class-default/benchmark rate instead of real machine data.
//
// FIXED (Machining Engine Re-Architecture): these 7 real categories are now
// real MachineClass members in their own right (MACHINE_REGISTRY,
// default-rates.constants.ts), so Tier 0 below matches them directly —
// the alias that used to coarsen them down into a cnc_* bucket has been
// removed entirely, not just made dead code, since keeping it would have
// silently thrown away the exact granularity this fix restores.

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
  operators: number | string | null;
  usd_lhr_total: number | string | null;
  press_cycle_time_s?: number | string | null;
  handling_time_const_s?: number | string | null;
  handling_time_mass_coeff_s_per_kg?: number | string | null;
  cut_to_length_cycle_const_s?: number | string | null;
  cut_to_length_cycle_mass_coeff_s_per_kg?: number | string | null;
  cut_to_length_cut_speed_s?: number | string | null;
  number_spindles?: number | string | null;
  drum_index_time_s?: number | string | null;
  transfer_time_s?: number | string | null;
  stock_feed_time_s?: number | string | null;
  speed_synchronization_time_s?: number | string | null;
  setup_time_hr?: number | string | null;
  direct_overhead_rate?: number | string | null;
  indirect_overhead_rate?: number | string | null;
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
  // IM-specific columns — absent until migration 339 runs
  tie_bar_x_mm?: number | string | null;
  tie_bar_y_mm?: number | string | null;
  shot_capacity_grams?: number | string | null;
  min_mold_height_mm?: number | string | null;
  max_mold_height_mm?: number | string | null;
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// fully_burdened_local_per_hr is machine + labour combined (mhr.service.ts's
// calculateMHR: fullyBurdenedLocalPerHr = totalMachineHourRate + lhrPerHr) — never
// use it here. This rate becomes MachineCandidate.hourlyRate, which feeds
// eMithranTerms' mhrPerHr in cost-engine.ts, and that formula ALWAYS separately adds
// its own direct-labour term (dlrPerHr × cycleNDL × cycleTimeMin). Preferring the
// burdened figure double-counts labour: once inside the "machine" rate, once again
// as its own line item. total_machine_hour_rate / manual_mhr_value are pure machine
// cost — the only values this function may return.
function pickRate(row: RawMachineRow): number {
  const mhr = num(row.total_machine_hour_rate) ?? 0;
  const man = num(row.manual_mhr_value) ?? 0;
  return mhr > 0 ? mhr : man;
}

const ALL_CLASSES_SET = new Set<string>(ALL_CLASSES);

// Plain substring matching lets a short/generic keyword match INSIDE an
// unrelated word — e.g. press_brake's keyword 'Press' matches inside
// "compression_molding" (com-PRESS-ion), so a rubber compression press was
// getting classified (and then recommended, as the cheapest "capable" match)
// as a press brake for sheet-metal bending. Requiring a boundary before the
// keyword fixes that (no boundary between 'm' and 'p' in "co[m][p]ression")
// while still allowing an intentional prefix match like '3AX' inside
// "3axis" (boundary before '3', keyword doesn't need to end the word) — only
// anchoring the END too would break that case, so this checks the start only.
function hasKeyword(haystack: string, keyword: string): boolean {
  const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}`, 'i').test(haystack);
}

export function classifyMachineRecord(row: RawMachineRow): MachineClass | null {
  // Tier 0 — machine_class already holds a canonical value (migrations 369/371
  // normalized this column to the exact MachineClass vocabulary) — trust it
  // directly instead of re-deriving classification via fuzzy keyword matching
  // against machine_name. Without this, a correctly-tagged real machine whose
  // human-readable name doesn't happen to contain a marketing keyword (e.g.
  // "Salvagnini L3-40 3KW Fiber" has machine_class='fiber_laser' but its name
  // contains no word "Laser") was silently invisible to the pool — it never
  // matched Tier 2 (machine_class keyword search expects e.g. "Fiber Laser"
  // with a space, not the DB's underscored 'fiber_laser') or Tier 3 (needs the
  // NAME to also contain a keyword) — so every process line for that class
  // fell back to the generic class-default/benchmark rate instead of the
  // real machine actually on file.
  //
  // REVERTED (Machining Engine Re-Architecture audit): a same-day attempt to
  // trust ANY non-empty machine_class directly here (removing the
  // ALL_CLASSES_SET.has(rawClass) gate, reasoning it only served as a
  // pool-inclusion gate) was wrong and reverted — real mhr_records rows
  // legitimately carry MESSY, non-canonical text directly in machine_class
  // (e.g. "Milling_Center 3axis", "Bend Press Brake"), and this gate is
  // what tells Tier 0 "this value is already a clean, canonical slug, trust
  // it" apart from "this value needs Tier 2/3 keyword classification like
  // any messy machine_name would" — caught by machine-selection.spec.ts's
  // own real-messy-machine_class regression tests before this shipped.
  // MACHINE_REGISTRY's Tier-0 gate closing off an unregistered-but-clean
  // real class remains a known, narrower gap than originally scoped — not
  // fixed here; needs a real signal to distinguish "clean slug" from "messy
  // free text" that this column alone doesn't reliably provide.
  const rawClass = (row.machine_class ?? '').trim().toLowerCase();
  if (rawClass && ALL_CLASSES_SET.has(rawClass)) {
    return rawClass as MachineClass;
  }

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

  // Real granular primary Machining classes (Machining Engine Re-Architecture)
  // — replaces the old cls.startsWith('cnc_')/cnc_3ax_vmc-etc. checks below,
  // which named the 6 now-deleted coarse buckets directly.
  const isMillingClass = (cls: string) => cls === '3_axis_mill' || cls === '4_axis_mill' || cls === '5_axis_mill';
  const isTurningClass = (cls: string) =>
    cls === '2_axis_lathe' || cls === '3_axis_lathe' ||
    cls === '2_axis_bar_feed_lathe_with_sub_spindle' || cls === '3_axis_bar_feed_lathe_with_sub_spindle';

  // Tier 2 — machine_class keyword (most specific text field)
  for (const cls of ALL_CLASSES) {
    const isMachiningClass = isMillingClass(cls) || isTurningClass(cls);
    const isVMCClass = isMillingClass(cls);
    if (isVMCClass && isLatheRecord) continue;
    if (isMachiningClass && isRouterRecord) continue;
    if (MACHINE_REGISTRY[cls].machineClassKeywords.some((kw) => hasKeyword(mcLower, kw))) {
      return cls;
    }
  }

  // Tier 3 — process_group keyword, but only when the machine NAME also matches,
  // so "Default Deslag" (process_group=Laser) can't classify as a fiber laser.
  for (const cls of ALL_CLASSES) {
    const isMachiningClass = isMillingClass(cls) || isTurningClass(cls);
    const isVMCClass = isMillingClass(cls);
    if (isVMCClass && isLatheRecord) continue;
    if (isMachiningClass && isRouterRecord) continue;
    const entry = MACHINE_REGISTRY[cls];
    const pgMatch = entry.processGroupKeywords.some((kw) => hasKeyword(pgLower, kw));
    const nameMatch = entry.machineClassKeywords.some((kw) => hasKeyword(mnLower, kw));
    if (pgMatch && nameMatch) return cls;
  }

  return null;
}

// ── Capability hydration: DB → seed registry → class defaults ─────────────────

const MOLDING_PRESS_CLASSES: ReadonlySet<string> = new Set([
  'injection_molding', 'structural_foam_molding', 'reaction_injection_molding', 'compression_molding',
]);

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
    tieBarXMm: num(row.tie_bar_x_mm),
    tieBarYMm: num(row.tie_bar_y_mm),
    shotCapacityGrams: num(row.shot_capacity_grams),
    minMoldHeightMm: num(row.min_mold_height_mm),
    maxMoldHeightMm: num(row.max_mold_height_mm),
  };

  const hasDbCapability = Object.entries(db).some(([k, v]) => k !== 'cuttableMaterials' && v != null);
  if (hasDbCapability) {
    return { capability: db, source: (row.capability_source as 'imported' | 'seed') ?? 'imported' };
  }

  // Molding presses: capability only from their own staged record (migration
  // 633). No capability is guessed from a machine name or class default; an
  // empty record surfaces as missing machine data.
  if (MOLDING_PRESS_CLASSES.has(cls)) return { capability: db, source: 'default_class' };

  const seed = lookupSeedCapability(row.machine_name);
  if (seed) return { capability: { ...EMPTY_CAPABILITY, ...seed }, source: 'seed' };

  // Tonnage-class machines (press brake, turret punch) commonly have their real
  // capacity stated plainly in the name itself (e.g. "Bend Brake-1500kN",
  // "Press 50T") — the seed registry above only recognises specific named
  // models plus one generic "press brake|bending" pattern, which a common
  // synonym like "Bend Brake" never matches. Without this, such a machine
  // silently inherits the flat MACHINE_CLASS_DEFAULTS tonnage (60t) even when
  // its own name says 1500kN (~153t) or 2500kN (~255t), making a genuinely
  // capable real machine look incapable of jobs well within its real range.
  if (cls === 'press_brake' || cls === 'turret_punch') {
    const tonnage = parseTonnageFromName(row.machine_name);
    if (tonnage != null) {
      return {
        capability: { ...EMPTY_CAPABILITY, ...MACHINE_CLASS_DEFAULTS[cls], maxTonnage: tonnage },
        source: 'seed',
      };
    }
  }

  // Laser power is deliberately NOT parsed from the machine name here (unlike
  // press_brake/turret_punch's tonnage-from-name fallback above). A name like
  // "Salvagnini L3-30 2KW Fiber" states its real power plainly, and it WOULD
  // parse correctly — but "correctly parseable this time" isn't the same
  // guarantee a real, verified mhr_records.power_kw value carries, and this
  // exact regex previously also silently mislabeled a bare guess as
  // capability_source='seed' (implying real provenance it didn't have).
  // When power_kw genuinely isn't on file for a real laser, the caller must
  // see that as a real gap (MISSING_MACHINE_DATA) and resolve it with a
  // verified capability record, never a number lifted from a string at
  // calculation time. The regex this used to run (name.match(/(\d+...)\s*
  // k\s*w\b/i)) is deliberately not defined here anymore — if a one-time
  // migration/backfill script ever needs it to help IDENTIFY candidate
  // values for a human to verify against real OEM specs, write it there,
  // not as a live resolution path in this file.

  return {
    capability: { ...EMPTY_CAPABILITY, ...MACHINE_CLASS_DEFAULTS[cls] },
    source: 'default_class',
  };
}

// 1 kN ≈ 0.10197 tonnes-force (divide by standard gravity 9.80665 m/s²).
function parseTonnageFromName(name: string | null | undefined): number | null {
  if (!name) return null;
  const kn = name.match(/(\d+(?:\.\d+)?)\s*k\s*n\b/i);
  if (kn?.[1]) return Math.round((parseFloat(kn[1]) / 9.80665) * 10) / 10;
  const tons = name.match(/(\d+(?:\.\d+)?)\s*(?:tonnes?|tons?|t)\b/i);
  if (tons?.[1]) return parseFloat(tons[1]);
  return null;
}

// ── Pool fetch ────────────────────────────────────────────────────────────────

export async function fetchMachinePool(
  client: SupabaseClient,
  location: string,
): Promise<MachineCandidate[]> {
  const cached = getCachedMachinePool(location);
  if (cached) return cached;

  // Every machine at the location, read in pages: one request is capped at
  // 1000 rows, which dropped every machine past the first 1000 (all USA
  // injection presses) and left their processes with no machine to select.
  const query = (columns: string) =>
    readAllRows<Record<string, unknown>>((from, to) =>
      client.from('mhr_records').select(columns).eq('location', location).order('id').range(from, to) as unknown as PromiseLike<RowPage<Record<string, unknown>>>);

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
      processGroup: raw.process_group || raw.commodity_code || null,
      machineClass: cls,
      hourlyRate: rate,
      // 85 here is a ranking-only placeholder, not a claimed real utilization
      // — utilizationKnown below is what buildCandidateReasons checks before
      // disclosing a number as if it were measured.
      utilizationPct: num(raw.capacity_utilization_rate) ?? 85,
      utilizationKnown: num(raw.capacity_utilization_rate) != null,
      scheduledLoadPct: num(raw.scheduled_load_pct),
      availabilityStatus: (raw.availability_status as AvailabilityStatus) ?? 'available',
      nextAvailableAt: raw.next_available_at ?? null,
      maintenanceWindowStart: raw.maintenance_window_start ?? null,
      maintenanceWindowEnd: raw.maintenance_window_end ?? null,
      capability,
      capabilitySource: source,
      // mhr_records.capability_version was dropped (write-only metadata,
      // never branched on) — always null now. Kept as a field on
      // MachineCandidate since bom_item_machine_selection_snapshots still
      // records it as a real audit-trail column.
      capabilityVersion: null,
      operators: num(raw.operators),
      laborRateUsdHr: num(raw.usd_lhr_total),
      pressCycleTimeS: num(raw.press_cycle_time_s),
      handlingConstS: num(raw.handling_time_const_s),
      handlingMassCoeffSPerKg: num(raw.handling_time_mass_coeff_s_per_kg),
      cutToLengthCycleConstS: num(raw.cut_to_length_cycle_const_s),
      cutToLengthCycleMassCoeffSPerKg: num(raw.cut_to_length_cycle_mass_coeff_s_per_kg),
      cutToLengthCutSpeedS: num(raw.cut_to_length_cut_speed_s),
      numberSpindles: num(raw.number_spindles),
      drumIndexTimeS: num(raw.drum_index_time_s),
      transferTimeS: num(raw.transfer_time_s),
      stockFeedTimeS: num(raw.stock_feed_time_s),
      speedSynchronizationTimeS: num(raw.speed_synchronization_time_s),
      setupTimeHr: num(raw.setup_time_hr),
      directOverheadRate: num(raw.direct_overhead_rate),
      indirectOverheadRate: num(raw.indirect_overhead_rate),
    });
  }

  setCachedMachinePool(location, candidates);
  return candidates;
}

// ── Eligibility ───────────────────────────────────────────────────────────────

// P0.6 documented data gap (not fabricated -- see CLAUDE.md's "do not guess a
// threshold to make a check pass" rule): a `null` return here means "no limit
// on file". P0.7 changed isCapable's laser case to treat that as NOT
// CAPABLE (fail-closed) rather than ungated -- a machine with zero real
// thickness data used to show as capable of any thickness, which is a worse
// failure mode than "no capable machine" (selectMachine degrades gracefully
// to a benchmark rate or an honest $0 with a stated reason, it never blocks
// the quote). USA has 3 real fiber_laser mhr_records rows with NO thickness
// data at all today ("Fiber Laser 4kW (3000×1500mm)", "Salvagnini L3-30
// Fiber", "Salvagnini L3-40 3KW Fiber") -- these now correctly show as not
// capable on thickness rather than falsely capable. Real spec data for the
// two Salvagnini machines DOES exist in the already-staged reference library
// (sm_reference_data, category 'Fiber Laser Cutting Machine', keys
// "Salvagnini L3-30 2kW Fiber"/"Salvagnini L3-40 3kW Fiber") -- but it's
// shaped as five generic max_thickness_1_mm..max_thickness_5_mm tiers with no
// legend anywhere in that category mapping tier->material family (unlike
// Turret Press's plainly-named max_thickness_steel_mm/stainless_steel_mm/
// aluminum_mm/copper_mm columns). Guessing MS/SS/AL/CU/brass order onto tiers
// 1-5 without a confirmed mapping risks a WRONG, confidently-labeled
// 'imported' capability -- worse than today's honest "no data" gap. Needs the
// real tier legend sourced before this can be backfilled; do not infer it
// from column position alone.
// Shared per-material-family thickness lookup — the same MS/SS/AL/CU capability
// columns back laser, shear (real machine_library.json "Shearing Machine" data
// is max_thickness_steel_mm/_stainless_steel_mm/_aluminum_mm/_copper_mm, the
// exact same fields), and plasma cut/punch. One lookup, not one per class.
export function materialThicknessLimit(cap: MachineCapability, materialFamily: LaserMaterialFamily): number | null {
  switch (materialFamily) {
    case 'MS': return cap.maxThicknessMsMm ?? cap.maxThicknessMm;
    case 'SS': return cap.maxThicknessSsMm ?? cap.maxThicknessMm;
    case 'AL': return cap.maxThicknessAlMm ?? cap.maxThicknessMm;
    case 'CU': return cap.maxThicknessCuMm ?? cap.maxThicknessMm;
    default:   return cap.maxThicknessMm ?? cap.maxThicknessMsMm;
  }
}

export function laserThicknessLimit(cap: MachineCapability, req: LaserRequirement): number | null {
  return materialThicknessLimit(cap, req.materialFamily);
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

// True only when NOT ONE real candidate in the class has resolvable
// thickness data for this requirement's material family — a systemic gap,
// not a per-machine one. See isCapable's laser case for why this
// distinction matters.
function classHasRealLaserThicknessData(classPool: MachineCandidate[], req: LaserRequirement): boolean {
  return classPool.some((c) => laserThicknessLimit(c.capability, req) != null);
}

// Class-wide data facts the laser gate needs. A per-machine gap (one machine
// missing data the rest of its class has) fails closed; a class-wide gap
// (no machine in the class has it) fails open, so real machines stay
// selectable at low confidence instead of all being replaced by "no machine".
interface LaserClassOpts {
  allowUnknownLaserThickness?: boolean;
  allowUnknownLaserBed?: boolean;
}

function laserClassOpts(classPool: MachineCandidate[], req: LaserRequirement): LaserClassOpts {
  return {
    allowUnknownLaserThickness: !classHasRealLaserThicknessData(classPool, req),
    allowUnknownLaserBed: !classPool.some((c) => c.capability.maxXMm != null && c.capability.maxYMm != null),
  };
}

// Laser bed fit. Unlike fitsBed (turret/waterjet), an unknown bed is NOT a
// pass when the class has real bed data: the part may not fit.
function fitsLaserBed(cap: MachineCapability, req: LaserRequirement, opts?: LaserClassOpts): boolean {
  if (cap.maxXMm == null || cap.maxYMm == null) return !!opts?.allowUnknownLaserBed;
  return fitsBed(cap, req.bedLengthMm, req.bedWidthMm);
}

// Laser source power vs the laser cut table's minimum for this material and
// thickness. undefined = no power requirement known (material not in table).
function laserPowerOk(cap: MachineCapability, req: LaserRequirement): boolean | undefined {
  if (!req.power) return undefined;
  if (req.power.requiredW == null) return false; // thicker than any laser in the table cuts
  return cap.powerKw != null && cap.powerKw * 1000 >= req.power.requiredW;
}

// Root-caused live 2026-08-31: EVERY real USA fiber_laser/co2_laser machine
// (~50 rows) has max_thickness_ms/ss/al/cu_mm completely NULL (exhaustively
// searched memory/sheetmetal/ for a tier legend to backfill it — genuinely
// doesn't exist anywhere). P0.7's fail-closed check (below) was written
// assuming this was a per-machine gap (a few machines missing data among
// many that had it) — CLAUDE.md itself still says "3 of 7". In reality it's
// a systemic, class-wide gap: fail-closed against a 0%-covered class means
// NO real laser machine can ever be selected, silently replacing a $40-90/hr
// real machine with the synthetic no-machine fallback (no rate, no power) —
// a worse outcome than the false-positive risk fail-closed was meant to
// prevent. Fix: fail-open ONLY when literally no real machine anywhere in
// the class has resolvable thickness data (classHasRealThicknessData below,
// computed once per selectMachine() call from the real pool) — a genuine
// per-machine gap among machines that mostly DO have data still fail-closes
// exactly as before, unchanged.
export function isCapable(
  candidate: MachineCandidate,
  req: MachineRequirement,
  opts?: LaserClassOpts,
): boolean {
  const cap = candidate.capability;

  if (candidate.availabilityStatus === 'down' || candidate.availabilityStatus === 'retired') {
    return false;
  }

  switch (req.kind) {
    case 'press_brake': {
      // req.tonnage is already the Recommended Force (theoretical × 1.25).
      if (cap.maxTonnage != null && cap.maxTonnage < req.tonnage) return false;
      if (cap.maxLengthMm != null && cap.maxLengthMm < req.bendLengthMm * BED_MARGIN) return false;
      if (cap.maxThicknessMm != null && cap.maxThicknessMm < req.thicknessMm) return false;
      return true;
    }
    case 'hole_forming': {
      if (cap.maxTonnage != null && cap.maxTonnage < req.tonnage * TONNAGE_MARGIN) return false;
      return true;
    }
    case 'laser': {
      // Fail-closed (P0.7): a null limit means no thickness capability data
      // exists for this machine/material at all — see laserThicknessLimit's
      // doc comment. Treating that as "ungated" let a machine with zero real
      // spec data show as capable of any thickness, which is a worse failure
      // mode than surfacing "no capable machine" (selectMachine already
      // degrades gracefully to a location benchmark rate or an honest $0 with
      // a stated reason — see selectMachine's own comment — so rejecting here
      // never crashes the quote, it just stops silently guessing). EXCEPT:
      // when opts.allowUnknownLaserThickness is true (the whole class has
      // zero real data, see doc comment above), a null limit no longer
      // rejects — real machines stay selectable, at low confidence, rather
      // than universally replaced by the synthetic no-machine fallback.
      // When the laser cut table knows this material, the machine's source
      // power decides whether it can cut this thickness (a real per-material
      // thickness limit, if the machine has one, still applies on top).
      const limit = laserThicknessLimit(cap, req);
      const powerOk = laserPowerOk(cap, req);
      if (powerOk === false) return false;
      if (limit == null) {
        if (powerOk === undefined && !opts?.allowUnknownLaserThickness) return false;
      } else if (limit < req.thicknessMm) {
        return false;
      }
      if (
        cap.cuttableMaterials?.length &&
        req.materialGrade &&
        !cap.cuttableMaterials.some((m) => m.toLowerCase() === req.materialGrade!.toLowerCase())
      ) {
        return false;
      }
      return fitsLaserBed(cap, req, opts);
    }
    case 'turret_punch': {
      if (cap.maxTonnage != null && cap.maxTonnage < req.tonnage * TONNAGE_MARGIN) return false;
      if (cap.maxThicknessMm != null && cap.maxThicknessMm < req.thicknessMm) return false;
      return fitsBed(cap, req.bedLengthMm, req.bedWidthMm);
    }
    case 'waterjet': {
      if (cap.maxThicknessMm != null && cap.maxThicknessMm < req.thicknessMm) return false;
      return fitsBed(cap, req.bedLengthMm, req.bedWidthMm);
    }
    case 'shear': {
      const limit = materialThicknessLimit(cap, req.materialFamily);
      if (limit != null && limit < req.thicknessMm) return false;
      if (cap.maxLengthMm != null && cap.maxLengthMm < req.cutLengthMm * BED_MARGIN) return false;
      return true;
    }
    case 'plasma_cut':
      return fitsBed(cap, req.bedLengthMm, req.bedWidthMm);
    case 'laser_punch': {
      if (cap.maxTonnage != null && cap.maxTonnage < req.tonnage * TONNAGE_MARGIN) return false;
      const limit = materialThicknessLimit(cap, req.materialFamily);
      if (limit != null && limit < req.thicknessMm) return false;
      return fitsBed(cap, req.bedLengthMm, req.bedWidthMm);
    }
    case 'press_forming': {
      if (cap.maxTonnage != null && cap.maxTonnage < req.tonnage * TONNAGE_MARGIN) return false;
      const limit = materialThicknessLimit(cap, req.materialFamily);
      if (limit != null && limit < req.thicknessMm) return false;
      return fitsBed(cap, req.bedLengthMm, req.bedWidthMm);
    }
    case 'roll_bending': {
      if (cap.maxThicknessMsMm != null && cap.maxThicknessMsMm < req.thicknessMm) return false;
      if (cap.maxLengthMm != null && cap.maxLengthMm < req.rollLengthMm * BED_MARGIN) return false;
      return true;
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
    case 'injection_molding': {
      // Reference clamp force already carries clampForceSafetyFactor: no TONNAGE_MARGIN on top.
      if (req.clampTonnageRequired == null) return false;
      // No tonnage on file = not shown capable (never passed unchecked).
      if (cap.maxTonnage == null || cap.maxTonnage < req.clampTonnageRequired) return false;
      // Tie-bar spacing: additive formula, allow 90° rotation
      if (cap.tieBarXMm != null && cap.tieBarYMm != null && req.partLengthMm > 0 && req.partWidthMm > 0) {
        const reqL = req.partLengthMm + IM_TIEBAR_ADDEND_MM;
        const reqW = req.partWidthMm  + IM_TIEBAR_ADDEND_MM;
        const fitsNormal  = reqL <= cap.tieBarXMm && reqW <= cap.tieBarYMm;
        const fitsRotated = reqL <= cap.tieBarYMm && reqW <= cap.tieBarXMm;
        if (!fitsNormal && !fitsRotated) return false;
      }
      return true;
    }
    case 'deburr':
      // Capable when this machine's own time per mm of burr edge is on file.
      return deburrCycleSec(candidate, req) != null;
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
      const t = ratio(req.tonnage, cap.maxTonnage);
      const l = ratio(req.bendLengthMm * BED_MARGIN, cap.maxLengthMm);
      if (t != null) parts.push(t);
      if (l != null) parts.push(l);
      break;
    }
    case 'hole_forming': {
      const t = ratio(req.tonnage * TONNAGE_MARGIN, cap.maxTonnage);
      if (t != null) parts.push(t);
      break;
    }
    case 'laser': {
      const x = ratio(req.bedLengthMm * BED_MARGIN, cap.maxXMm);
      const y = ratio(req.bedWidthMm * BED_MARGIN, cap.maxYMm);
      const thk = ratio(req.thicknessMm, laserThicknessLimit(cap, req));
      const pwr = req.power?.requiredW != null ? ratio(req.power.requiredW, cap.powerKw != null ? cap.powerKw * 1000 : null) : null;
      if (x != null) parts.push(x);
      if (y != null) parts.push(y);
      if (thk != null) parts.push(thk);
      if (pwr != null) parts.push(pwr);
      break;
    }
    case 'turret_punch': {
      const t = ratio(req.tonnage * TONNAGE_MARGIN, cap.maxTonnage);
      const x = ratio(req.bedLengthMm * BED_MARGIN, cap.maxXMm);
      const y = ratio(req.bedWidthMm * BED_MARGIN, cap.maxYMm);
      const thk = ratio(req.thicknessMm, cap.maxThicknessMm);
      if (t != null) parts.push(t);
      if (x != null) parts.push(x);
      if (y != null) parts.push(y);
      if (thk != null) parts.push(thk);
      break;
    }
    case 'waterjet': {
      const x = ratio(req.bedLengthMm * BED_MARGIN, cap.maxXMm);
      const y = ratio(req.bedWidthMm * BED_MARGIN, cap.maxYMm);
      const thk = ratio(req.thicknessMm, cap.maxThicknessMm);
      if (x != null) parts.push(x);
      if (y != null) parts.push(y);
      if (thk != null) parts.push(thk);
      break;
    }
    case 'shear': {
      const thk = ratio(req.thicknessMm, materialThicknessLimit(cap, req.materialFamily));
      const len = ratio(req.cutLengthMm * BED_MARGIN, cap.maxLengthMm);
      if (thk != null) parts.push(thk);
      if (len != null) parts.push(len);
      break;
    }
    case 'plasma_cut': {
      const x = ratio(req.bedLengthMm * BED_MARGIN, cap.maxXMm);
      const y = ratio(req.bedWidthMm * BED_MARGIN, cap.maxYMm);
      if (x != null) parts.push(x);
      if (y != null) parts.push(y);
      break;
    }
    case 'laser_punch': {
      const t = ratio(req.tonnage * TONNAGE_MARGIN, cap.maxTonnage);
      const thk = ratio(req.thicknessMm, materialThicknessLimit(cap, req.materialFamily));
      const x = ratio(req.bedLengthMm * BED_MARGIN, cap.maxXMm);
      const y = ratio(req.bedWidthMm * BED_MARGIN, cap.maxYMm);
      if (t != null) parts.push(t);
      if (thk != null) parts.push(thk);
      if (x != null) parts.push(x);
      if (y != null) parts.push(y);
      break;
    }
    case 'press_forming': {
      const t = ratio(req.tonnage * TONNAGE_MARGIN, cap.maxTonnage);
      const thk = ratio(req.thicknessMm, materialThicknessLimit(cap, req.materialFamily));
      const x = ratio(req.bedLengthMm * BED_MARGIN, cap.maxXMm);
      const y = ratio(req.bedWidthMm * BED_MARGIN, cap.maxYMm);
      if (t != null) parts.push(t);
      if (thk != null) parts.push(thk);
      if (x != null) parts.push(x);
      if (y != null) parts.push(y);
      break;
    }
    case 'roll_bending': {
      const thk = ratio(req.thicknessMm, cap.maxThicknessMsMm);
      const len = ratio(req.rollLengthMm * BED_MARGIN, cap.maxLengthMm);
      if (thk != null) parts.push(thk);
      if (len != null) parts.push(len);
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
    case 'injection_molding': {
      const t = req.clampTonnageRequired == null ? null : ratio(req.clampTonnageRequired, cap.maxTonnage);
      if (t != null) parts.push(t);
      break;
    }
    case 'deburr':
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

function buildReasons(
  candidate: MachineCandidate,
  req: MachineRequirement,
  opts?: LaserClassOpts,
): string[] {
  const cap = candidate.capability;
  const reasons: string[] = [];
  const r0 = (n: number) => Math.round(n * 10) / 10;

  switch (req.kind) {
    case 'press_brake':
      reasons.push(`Requires ${r0(req.tonnage)} t (recommended force = theoretical × 1.25)` +
        (cap.maxTonnage != null ? ` ≤ ${r0(cap.maxTonnage)} t machine capacity` : ''));
      if (cap.maxLengthMm != null) reasons.push(`Bend ${r0(req.bendLengthMm)} mm ≤ ${r0(cap.maxLengthMm)} mm bend length`);
      break;
    case 'hole_forming':
      reasons.push(`Requires ${r0(req.tonnage * TONNAGE_MARGIN)} t (incl. 15% margin) for Ø${r0(req.holeDiameterMm)} mm hole extrusion` +
        (cap.maxTonnage != null ? ` ≤ ${r0(cap.maxTonnage)} t machine capacity` : ''));
      break;
    case 'laser': {
      // Material/thickness-vs-capacity is surfaced structurally via
      // buildCapabilityCheck() below (Material/Thickness/Capacity/Status),
      // not repeated here as flat text.
      if (req.power?.requiredW != null) {
        reasons.push(`${req.power.material} ${r0(req.thicknessMm)} mm needs ≥ ${r0(req.power.requiredW / 1000)} kW (laser cut table, ${r0(req.power.tableThicknessMm!)} mm row)` +
          (cap.powerKw != null ? ` ≤ ${r0(cap.powerKw)} kW machine` : ' — machine power not on file'));
      }
      if (cap.maxXMm != null && cap.maxYMm != null) {
        reasons.push(`Part ${r0(req.bedLengthMm)}×${r0(req.bedWidthMm)} mm fits ${r0(cap.maxXMm)}×${r0(cap.maxYMm)} mm bed`);
      } else if (opts?.allowUnknownLaserBed) {
        reasons.push('No bed size on file for any machine in this class — part fit assumed, not verified');
      }
      if (!req.power && opts?.allowUnknownLaserThickness && laserThicknessLimit(cap, req) == null) {
        reasons.push('No real thickness data on file for any machine in this class — capability assumed, not verified');
      }
      break;
    }
    case 'turret_punch':
      reasons.push(`Requires ${r0(req.tonnage * TONNAGE_MARGIN)} t (incl. 15% margin)` +
        (cap.maxTonnage != null ? ` ≤ ${r0(cap.maxTonnage)} t machine capacity` : ''));
      if (cap.maxXMm != null && cap.maxYMm != null) {
        reasons.push(`Part ${r0(req.bedLengthMm)}×${r0(req.bedWidthMm)} mm fits ${r0(cap.maxXMm)}×${r0(cap.maxYMm)} mm bed`);
      }
      break;
    case 'waterjet':
      if (cap.maxThicknessMm != null) reasons.push(`Thickness ${r0(req.thicknessMm)} mm ≤ ${r0(cap.maxThicknessMm)} mm machine limit`);
      if (cap.maxXMm != null && cap.maxYMm != null) {
        reasons.push(`Part ${r0(req.bedLengthMm)}×${r0(req.bedWidthMm)} mm fits ${r0(cap.maxXMm)}×${r0(cap.maxYMm)} mm bed`);
      }
      break;
    case 'shear': {
      const limit = materialThicknessLimit(cap, req.materialFamily);
      if (limit != null) reasons.push(`Thickness ${r0(req.thicknessMm)} mm (${req.materialFamily}) ≤ ${r0(limit)} mm machine limit`);
      if (cap.maxLengthMm != null) reasons.push(`Cut length ${r0(req.cutLengthMm)} mm ≤ ${r0(cap.maxLengthMm)} mm shear bed`);
      break;
    }
    case 'plasma_cut':
      if (cap.maxXMm != null && cap.maxYMm != null) {
        reasons.push(`Part ${r0(req.bedLengthMm)}×${r0(req.bedWidthMm)} mm fits ${r0(cap.maxXMm)}×${r0(cap.maxYMm)} mm bed`);
      }
      reasons.push('Thickness feasibility not gated here — see the real per-part cutting-rate table used at costing time');
      break;
    case 'laser_punch': {
      reasons.push(`Requires ${r0(req.tonnage * TONNAGE_MARGIN)} t (incl. 15% margin)` +
        (cap.maxTonnage != null ? ` ≤ ${r0(cap.maxTonnage)} t machine capacity` : ''));
      const limit = materialThicknessLimit(cap, req.materialFamily);
      if (limit != null) reasons.push(`Thickness ${r0(req.thicknessMm)} mm (${req.materialFamily}) ≤ ${r0(limit)} mm machine limit`);
      if (cap.maxXMm != null && cap.maxYMm != null) {
        reasons.push(`Part ${r0(req.bedLengthMm)}×${r0(req.bedWidthMm)} mm fits ${r0(cap.maxXMm)}×${r0(cap.maxYMm)} mm bed`);
      }
      break;
    }
    case 'press_forming': {
      reasons.push(`Requires ${r0(req.tonnage * TONNAGE_MARGIN)} t (incl. 15% margin, blanking-force estimate)` +
        (cap.maxTonnage != null ? ` ≤ ${r0(cap.maxTonnage)} t machine capacity` : ''));
      const limit = materialThicknessLimit(cap, req.materialFamily);
      if (limit != null) reasons.push(`Thickness ${r0(req.thicknessMm)} mm (${req.materialFamily}) ≤ ${r0(limit)} mm machine limit`);
      if (cap.maxXMm != null && cap.maxYMm != null) {
        reasons.push(`Part ${r0(req.bedLengthMm)}×${r0(req.bedWidthMm)} mm fits ${r0(cap.maxXMm)}×${r0(cap.maxYMm)} mm bed`);
      }
      break;
    }
    case 'roll_bending': {
      if (cap.maxThicknessMsMm != null) reasons.push(`Thickness ${r0(req.thicknessMm)} mm (mild steel) ≤ ${r0(cap.maxThicknessMsMm)} mm machine limit`);
      if (cap.maxLengthMm != null) reasons.push(`Roll length ${r0(req.rollLengthMm)} mm ≤ ${r0(cap.maxLengthMm)} mm roll capacity`);
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
    case 'injection_molding':
      reasons.push(req.clampTonnageRequired == null
        ? (req.clampNotDerivableReason ?? 'Clamp force not derivable.')
        : `Requires ${r0(req.clampTonnageRequired)} t clamp force (reference model, incl. clampForceSafetyFactor)` +
          (cap.maxTonnage != null ? ` ≤ ${r0(cap.maxTonnage)} t machine capacity` : ''));
      if (req.shotWeightG != null && req.shotWeightG > 0) {
        // Informational until mhr_records carries shot capacity (barrel size) —
        // the gate switches on the day that column exists.
        reasons.push(`Shot weight ${r0(req.shotWeightG)} g incl. runner — verify against barrel capacity`);
      }
      if (req.partLengthMm > 0 && req.partWidthMm > 0) {
        const reqL = req.partLengthMm + IM_TIEBAR_ADDEND_MM;
        const reqW = req.partWidthMm  + IM_TIEBAR_ADDEND_MM;
        reasons.push(
          cap.tieBarXMm != null && cap.tieBarYMm != null
            ? `Tie-bar: requires ${reqL.toFixed(0)}×${reqW.toFixed(0)} mm (incl. +45mm allowance), machine has ${cap.tieBarXMm}×${cap.tieBarYMm} mm`
            : `Part footprint ${r0(req.partLengthMm)}×${r0(req.partWidthMm)} mm — tie-bar spec not on file`,
        );
      }
      break;
    case 'deburr': {
      const rate = deburrSecPerMm(candidate, req);
      const sec = deburrCycleSec(candidate, req);
      if (rate && sec != null) {
        reasons.push(`${r0(req.burrEdgeLengthMm)} mm burr edge × ${rate.secPerMm.toPrecision(3)} s/mm (${rate.source}) = ${r0(sec)} s`);
        reasons.push(`$${(candidate.hourlyRate * sec / 3600).toFixed(3)} per part at $${candidate.hourlyRate.toFixed(2)}/hr`);
      } else {
        reasons.push('No deburr time rate on file for this machine');
      }
      break;
    }
    case 'generic':
      reasons.push('No dimensional constraints for this process');
      break;
  }

  reasons.push(
    candidate.utilizationKnown
      ? `Utilization ${r0(candidate.utilizationPct)}%`
      : 'Utilization not on file — ranked at a neutral default',
  );
  if (candidate.capabilitySource === 'seed') reasons.push('Capability from model seed data — verify against machine plate');
  if (candidate.capabilitySource === 'default_class') reasons.push('No capability on file — conservative class defaults applied');
  return reasons;
}

// Structured material/thickness-vs-capacity check for the UI (Material/
// Thickness/Machine Capacity/Status), replacing the flat "MS 1.5 mm ≤ 12 mm
// limit" text for the one requirement kind where a single dominant
// material-dependent dimensional check exists. Other kinds return null —
// extend here if the same structured view is wanted for tonnage/diameter/etc.
function buildCapabilityCheck(
  candidate: MachineCandidate,
  req: MachineRequirement,
  opts?: LaserClassOpts,
): CapabilityCheck | null {
  if (req.kind === 'shear') {
    const limit = materialThicknessLimit(candidate.capability, req.materialFamily);
    return {
      parameter: 'Thickness',
      materialGrade: req.materialGrade,
      value: req.thicknessMm,
      limit,
      unit: 'mm',
      // Shear has no confirmed systemic zero-data gap (unlike laser's P0.7
      // fail-closed case) — a null limit is ungated, matching isCapable's
      // shear case above, not a separate fail-closed policy invented here.
      supported: limit != null ? limit >= req.thicknessMm : true,
    };
  }
  if (req.kind !== 'laser') return null;
  // Laser cut table knows this material: the check is source power.
  if (req.power?.requiredW != null) {
    const kw = candidate.capability.powerKw;
    return {
      parameter: `Laser power for ${req.thicknessMm} mm`,
      materialGrade: req.materialGrade,
      value: req.power.requiredW / 1000,
      limit: kw,
      unit: 'kW',
      supported: laserPowerOk(candidate.capability, req) === true,
    };
  }
  const limit = laserThicknessLimit(candidate.capability, req);
  return {
    parameter: 'Thickness',
    materialGrade: req.materialGrade,
    value: req.thicknessMm,
    limit,
    unit: 'mm',
    // Mirrors isCapable's laser case (P0.7, fail-closed) — a null limit is
    // "no data on file", not "supported", so this flag never disagrees with
    // the actual eligibility gate. EXCEPT when allowUnknownLaserThickness
    // is true (systemic class-wide gap, not a per-machine one — see
    // isCapable's doc comment) — supported reflects the same fail-open
    // eligibility decision actually used to select this candidate.
    supported: limit != null ? limit >= req.thicknessMm : !!opts?.allowUnknownLaserThickness,
  };
}

// Explain one SPECIFIC machine (by ID) against a requirement, independent of
// whether it's currently top-ranked. Needed because a saved process row's
// machine can drift out of "balanced/cheapest/fastest" over time (utilization/
// cost scores shift) without the saved pick itself becoming invalid — showing
// nothing (or worse, another candidate's reasoning) under that row would be
// either unhelpful or actively misleading. Searches the FULL class pool, not
// just eligible candidates, so a since-changed-out-of-spec machine still gets
// an honest (flagged) explanation rather than silently vanishing.
export function explainCandidate(
  pool: MachineCandidate[],
  machineClass: MachineClass,
  requirement: MachineRequirement,
  machineId: string,
): { candidate: MachineCandidate; reasons: string[]; capabilityCheck: CapabilityCheck | null } | null {
  const candidate = pool.find((c) => c.machineClass === machineClass && c.machineId === machineId);
  if (!candidate) return null;
  const opts = requirement.kind === 'laser'
    ? laserClassOpts(pool.filter((c) => c.machineClass === machineClass), requirement)
    : undefined;
  const reasons = buildReasons(candidate, requirement, opts);
  if (!isCapable(candidate, requirement, opts)) {
    reasons.unshift('⚠ Outside computed capability for this part — verify feasibility');
  }
  return { candidate, reasons, capabilityCheck: buildCapabilityCheck(candidate, requirement, opts) };
}

// ── Selection ─────────────────────────────────────────────────────────────────

interface ProfileWeights { fit: number; util: number; cost: number; avail: number }

const PROFILES: Record<'balanced' | 'cheapest' | 'fastest', ProfileWeights> = {
  balanced: { fit: 0.5, util: 0.3, cost: 0.2, avail: 0 },
  cheapest: { fit: 0.2, util: 0.1, cost: 0.7, avail: 0 },
  fastest:  { fit: 0.2, util: 0.5, cost: 0.2, avail: 0.1 },
};

// The "no machine" result: what selectMachine returns when this location has no
// real, capable machine of the class. It is an explicit absence, not a stand-in
// machine — no rate (0 → 'no_db_rate', not costed), no capability, no
// utilization. Nothing here may be read as a property of a real machine.
function makeNoMachineCandidate(cls: MachineClass): MachineCandidate {
  return {
    machineId: null,
    machineName: null,
    commodityCode: null,
    processGroup: null,
    machineClass: cls,
    hourlyRate: 0,
    utilizationPct: 0,
    utilizationKnown: false,
    scheduledLoadPct: null,
    availabilityStatus: 'available',
    nextAvailableAt: null,
    maintenanceWindowStart: null,
    maintenanceWindowEnd: null,
    capability: { ...EMPTY_CAPABILITY },
    capabilitySource: 'default_class',
    capabilityVersion: null,
    operators: null,
    laborRateUsdHr: null,
    pressCycleTimeS: null,
    handlingConstS: null,
    handlingMassCoeffSPerKg: null,
    cutToLengthCycleConstS: null,
    cutToLengthCycleMassCoeffSPerKg: null,
    cutToLengthCutSpeedS: null,
    numberSpindles: null,
    drumIndexTimeS: null,
    transferTimeS: null,
    stockFeedTimeS: null,
    speedSynchronizationTimeS: null,
    setupTimeHr: null,
    directOverheadRate: null,
    indirectOverheadRate: null,
  };
}

interface SelectMachineInput {
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

  // A deburr line draws from both deburr machine families (Deslag + Manual
  // Deburr); every other line from its own class only.
  const lineClasses: readonly string[] = requirement.kind === 'deburr' ? DEBURR_MACHINE_CLASSES : [machineClass];
  const classPool = pool.filter((c) => lineClasses.includes(c.machineClass));
  const laserOpts = requirement.kind === 'laser'
    ? laserClassOpts(classPool, requirement)
    : undefined;
  const eligible = classPool.filter((c) => isCapable(c, requirement, laserOpts));

  // No capable machine. Reported as an absence — never priced from anywhere else.
  if (eligible.length === 0 && !input.overrideMachineId) {
    const reason = classPool.length === 0
      ? `No machine of this class in HR Rates for ${location} — not costed; add it to memory/ and seed it`
      : `No machine of this class in HR Rates for ${location} can do this part — not costed`;
    const rec: MachineRecommendation = {
      candidate: makeNoMachineCandidate(machineClass),
      score: 0,
      reasons: [reason],
    };
    return {
      balanced: rec, cheapest: rec, fastest: rec,
      alternatives: [],
      confidence: 0,
      requirement,
      allowOverride: true,
      overridden: false,
    };
  }

  // Cost basis: the hourly rate, except where machines of one line run at
  // different speeds (deburr) — there it is cost per part, rate × time.
  const costBasis = (c: MachineCandidate) =>
    requirement.kind === 'deburr' ? c.hourlyRate * (deburrCycleSec(c, requirement) ?? Infinity) : c.hourlyRate;
  const minRate = Math.min(...eligible.map(costBasis));

  const scored = eligible.map((candidate) => {
    const fit = fitScore(candidate, requirement);
    const util = utilizationScore(candidate);
    const cost = minRate > 0 ? clamp01(minRate / costBasis(candidate)) : 0;
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
    reasons: buildReasons(s.candidate, requirement, laserOpts),
    capabilityCheck: buildCapabilityCheck(s.candidate, requirement, laserOpts),
  });

  // User override: force the pick, even outside the capability filter (their judgment)
  let overridden = false;
  let balancedRec: MachineRecommendation;
  // Deburr machines differ in speed, so the recommendation is the lowest cost
  // per part (rate × time), not the utilization-weighted balance.
  const balancedRanked = requirement.kind === 'deburr'
    ? [...scored].sort((a, b) => costBasis(a.candidate) - costBasis(b.candidate))
    : rank(PROFILES.balanced);
  const cheapestRanked = rank(PROFILES.cheapest);
  const fastestRanked = rank(PROFILES.fastest);

  if (input.overrideMachineId) {
    // classPool is already scoped to machineClass === machineClass — the
    // whole-pool fallback below exists so an override ID always resolves to
    // SOMETHING (never silently drops the override), but it means the found
    // machine can be from a completely different class (e.g. a 'cleaning'
    // ultrasonic tank overridden onto a 'deburring' line) — confirmed live
    // this session. That must never pass through silently: it's flagged
    // below exactly like the existing capability-mismatch warning, not
    // treated as an equally-valid pick just because an ID matched.
    const forced = classPool.find((c) => c.machineId === input.overrideMachineId)
      ?? pool.find((c) => c.machineId === input.overrideMachineId);
    if (forced) {
      overridden = true;
      const fit = fitScore(forced, requirement);
      balancedRec = {
        candidate: forced,
        score: Math.round(fit * 1000) / 1000,
        reasons: ['Manually selected by cost engineer', ...buildReasons(forced, requirement, laserOpts)],
        capabilityCheck: buildCapabilityCheck(forced, requirement, laserOpts),
      };
      if (forced.machineClass !== machineClass) {
        balancedRec.reasons.unshift(
          `⚠ Manually overridden with a machine from a different class ('${forced.machineClass}', ` +
          `not '${machineClass}') — verify this is intentional before quoting`,
        );
      }
      if (!isCapable(forced, requirement, laserOpts)) {
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
  // A line drawing on several machine families (deburr: Deslag + Manual
  // Deburr) always offers the best machine of every family, so each stays
  // selectable even when it ranks below the top two.
  alternatives.splice(2);
  if (lineClasses.length > 1) {
    for (const cls of lineClasses) {
      const shown = [balancedRec.candidate, ...alternatives].some((c) => c.machineClass === cls);
      const best = balancedRanked.find((s) => s.candidate.machineClass === cls);
      if (!shown && best) alternatives.push(best.candidate);
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

  const W = PROFILES.balanced;
  const composite = (s: (typeof scored)[number]) => s.fit * W.fit + s.util * W.util + s.cost * W.cost + s.avail * W.avail;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const ranking: MachineScoreBreakdown[] = balancedRanked.map((s) => ({
    machineId: s.candidate.machineId,
    machineName: s.candidate.machineName,
    hourlyRate: s.candidate.hourlyRate,
    fit: r3(s.fit), util: r3(s.util), cost: r3(s.cost), avail: r3(s.avail),
    score: r3(composite(s)),
  }));
  const rejected = classPool
    .filter((c) => !eligible.includes(c))
    .map((c) => ({ machineId: c.machineId, machineName: c.machineName, reasons: buildReasons(c, requirement, laserOpts) }));
  let decision: MachineSelectionDecision;
  if (overridden) {
    decision = { winnerId: balancedRec.candidate.machineId, runnerUpId: null, decidingFactor: 'override' };
  } else if (balancedRanked.length < 2) {
    decision = { winnerId: balancedRec.candidate.machineId, runnerUpId: null, decidingFactor: 'only_capable' };
  } else {
    const [a, b] = balancedRanked as [(typeof scored)[number], (typeof scored)[number]];
    const deltas = (['fit', 'util', 'cost', 'avail'] as const)
      .map((k) => ({ k, d: (a[k] - b[k]) * W[k] }))
      .sort((x, y) => y.d - x.d);
    decision = {
      winnerId: a.candidate.machineId,
      runnerUpId: b.candidate.machineId,
      decidingFactor: deltas[0]!.d > 1e-9 ? deltas[0]!.k : 'tie_rate',
    };
  }

  return {
    balanced: balancedRec,
    cheapest: cheapestRec,
    fastest: fastestRec,
    alternatives,
    confidence,
    requirement,
    allowOverride: true,
    overridden,
    availabilityWarning,
    ranking,
    rejected,
    profileWeights: PROFILES,
    decision,
  };
}
