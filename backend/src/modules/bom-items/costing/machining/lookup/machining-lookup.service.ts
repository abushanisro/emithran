import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../../../common/supabase/supabase.service';
import type { MaterialClass } from '../process/cost-machining-engine';
import type { DrillingTable } from './drilling-table';
import type { HobbingReference, KeywayBroachReference, RotaryBroachReference, SurfaceGrindingParams } from '../calculators/machining-lookup-seeds';
import type { GearQualityRow } from '../operation/gear-routing';
import {
  MACHINING_MATERIAL_HARDNESS_HB,
  nearestByHardness,
  nearestByDiameterThenHardness,
  nearestByDiameterKey,
} from './machining-material-hardness';
import { MACHINING_REFERENCE_SOURCE_VERSION } from './machining-lookup-tables';
import { SETUP_AXIS_VARIABLE_KEYS, resolveSetupAxisRule, type SetupAxisRule } from '../setup-axis-rule';
import {
  CAPABILITY_GTOL_TABLE,
  CAPABILITY_RULES_SOURCE_VERSION,
  CAPABILITY_VARIABLE_KEYS,
  resolveMachiningCapabilityRules,
  type MachiningCapabilityRules,
} from '../capability-rules';

// The real hardness-bridge constants/matchers this service uses live in
// machining-material-hardness.ts — a plain, framework-free module (no
// NestJS @Injectable, no SupabaseService) so operation-sequencer.ts and
// cost-machining-engine.ts (pure, no-DB-calls sync engines) can import the same
// real logic directly without depending on this injectable service class.
// Re-exported here for any existing caller of this file expecting them
// from this module.
export { MACHINING_MATERIAL_HARDNESS_HB, nearestByHardness, nearestByDiameterThenHardness };

export interface DrillingPhysicsParams {
  cuttingSpeedMPerMin: number;
  feedMmPerRev: number;
  dataFound: boolean;
}

export interface CounterboreParams {
  cuttingSpeedMPerMin: number;
  feedMmPerRev: number;
  depthMaxMm: number | null;
  dataFound: boolean;
}

export interface ReamParams {
  cuttingSpeedMPerMin: number;
  feedMm: number;
  dataFound: boolean;
}

export interface EdgeToolParams {
  linearSpeedMmPerSec: number;
  dataFound: boolean;
  /** The material cut code of the row the speed came from. */
  materialCutCode?: string;
}

export interface CylindricalGrindingParams {
  wheelSpeedMS: number;
  workSpeedMMin: number;
  roughInfeedMm: number;
  finishInfeedMm: number;
  roughAxialFeedRevMm: number;
  finishAxialFeedRevMm: number;
  dataFound: boolean;
  materialCutCode?: string;
  /** The staged table and row the values came from (the trace's lookup match). */
  match?: { table: GrindingTable; row: Record<string, string | number> };
}

/**
 * The two reference grinding tables: the same columns, different values
 * (a bore is ground with a smaller infeed and slower feed than an OD).
 * tblCylindricalGrinding is staged with snake_case columns (migration 744),
 * tblInternalGrinding with the source headers (migration 809).
 */
export type GrindingTable = 'tblCylindricalGrinding' | 'tblInternalGrinding';
const GRINDING_COLUMNS: Record<GrindingTable, {
  code: string; wheelSpeed: string; workSpeed: string; roughInfeed: string; finishInfeed: string; roughAxialFeed: string; finishAxialFeed: string;
}> = {
  tblCylindricalGrinding: {
    code: 'material_cut_code_name', wheelSpeed: 'wheel_speed_m_s', workSpeed: 'work_speed_m_min',
    roughInfeed: 'rough_infeed_mm', finishInfeed: 'finish_infeed_mm',
    roughAxialFeed: 'rough_axial_feed_rev_1', finishAxialFeed: 'finish_axial_feed_rev_1',
  },
  tblInternalGrinding: {
    code: 'Material Cut Code Name', wheelSpeed: 'Wheel Speed (m / s)', workSpeed: 'Work Speed (m / min)',
    roughInfeed: 'Rough Infeed (mm)', finishInfeed: 'Finish Infeed (mm)',
    roughAxialFeed: 'Rough Axial Feed (rev^-1)', finishAxialFeed: 'Finish Axial Feed (rev^-1)',
  },
};

export interface WireEdmParams {
  roughFeedRateMmPerMin: number;
  finishFeedRateMmPerMin: number;
  dataFound: boolean;
  materialCutCode?: string;
}

export interface TurningParams {
  roughCutDepthMm: number;
  roughCuttingSpeedMPerMin: number;
  roughFeedMmPerRev: number;
  finishCutDepthMm: number;
  finishCuttingSpeedMPerMin: number;
  finishFeedMmPerRev: number;
  dataFound: boolean;
  materialCutCode?: string;
}

@Injectable()
export class MachiningLookupService {
  constructor(private readonly supabase: SupabaseService) {}

  // In-process cache: these 4 tables are large (up to ~380KB) whole-file
  // JSONB blobs staged once per table, not per-row — never change within a
  // running process, so fetched at most once per table per process
  // lifetime, matching loadCalculatorCatalog's own cachedRead discipline
  // elsewhere in this module (just a plain Map here since there's no
  // per-request invalidation need for static reference data).
  private tableCache = new Map<string, any>();

  private async loadTable(key: string): Promise<any[] | null> {
    if (this.tableCache.has(key)) return this.tableCache.get(key) as any[] | null;
    const db = this.supabase.getPrivilegedClient('reference-data: machining lookup tables, global shared');
    const { data, error } = await db
      .from('machining_reference_data')
      .select('raw')
      .eq('category', 'lookup_table')
      .eq('source_version', MACHINING_REFERENCE_SOURCE_VERSION)
      .eq('key', key)
      .maybeSingle();
    // A read error (network, timeout) is not cached: the next request reads
    // again. Only a genuinely absent row is remembered as null.
    if (error) return null;
    if (!data?.raw) {
      this.tableCache.set(key, null);
      return null;
    }
    const raw = data.raw as any;
    const rows: any[] | null = Array.isArray(raw) ? raw : Array.isArray(raw.rows) ? raw.rows : null;
    this.tableCache.set(key, rows);
    return rows;
  }

  // Some real tables (deep_bore_drill_lookup.json/deep_bore_trepan_lookup.json)
  // stage their whole source-file OBJECT as `raw` (materials array nested
  // inside, not a bare/​.rows top-level array) — loadTable's array-only
  // contract would coerce these to null. Returns the raw object as-is; same
  // cache map, keyed separately from array reads by construction (no table
  // key is ever fetched through both loaders).
  private async loadObjectTable(key: string): Promise<any | null> {
    if (this.tableCache.has(key)) return this.tableCache.get(key);
    const db = this.supabase.getPrivilegedClient('reference-data: machining lookup tables, global shared');
    const { data, error } = await db
      .from('machining_reference_data')
      .select('raw')
      .eq('category', 'lookup_table')
      .eq('source_version', MACHINING_REFERENCE_SOURCE_VERSION)
      .eq('key', key)
      .maybeSingle();
    if (error) return null; // transient read failure: not cached, retried next request
    const raw = data?.raw && typeof data.raw === 'object' && !Array.isArray(data.raw) ? data.raw : null;
    this.tableCache.set(key, raw);
    return raw;
  }

  // ── Straight drilling (tblDrilling — whole source object staged as `raw`:
  // a materials array plus table-level construction/depth-by-diameter maps).
  // Returned whole; the per-hole match (resolveDrillingParams, drilling-table.ts)
  // runs in the pure cost engine, once per real hole diameter on the part.
  async getDrillingTable(): Promise<DrillingTable | null> {
    return this.loadObjectTable('tblDrilling');
  }

  // ── Operation size ranges (tblOperationSizeRanges): per-operation L/D and
  // diameter limits — drives deep-hole routing (deep-hole-routing.ts).
  private setupAxisRule: { rule: SetupAxisRule | null; missing: string[] } | null = null;

  /** The reference setup-axis rule (machining variables, migration 639). A
   *  read error is not cached; a genuinely missing variable is named. */
  async getSetupAxisRule(): Promise<{ rule: SetupAxisRule | null; missing: string[] }> {
    if (this.setupAxisRule) return this.setupAxisRule;
    const { data, error } = await this.supabase
      .getPrivilegedClient('reference-data: machining lookup tables, global shared')
      .from('machining_reference_data')
      .select('key, value')
      .eq('category', 'variable')
      .eq('source_version', MACHINING_REFERENCE_SOURCE_VERSION)
      .in('key', [...SETUP_AXIS_VARIABLE_KEYS]);
    if (error) return { rule: null, missing: [...SETUP_AXIS_VARIABLE_KEYS] };
    this.setupAxisRule = resolveSetupAxisRule(data ?? []);
    return this.setupAxisRule;
  }

  private capabilityRules: { rules: MachiningCapabilityRules | null; missing: string[] } | null = null;

  /** Finishing-process capability thresholds (capability-rules.ts): machining
   *  variables plus tblGtolProcessCapabilities. A read error is not cached. */
  async getCapabilityRules(): Promise<{ rules: MachiningCapabilityRules | null; missing: string[] }> {
    if (this.capabilityRules) return this.capabilityRules;
    const { data, error } = await this.supabase
      .getPrivilegedClient('reference-data: machining lookup tables, global shared')
      .from('machining_reference_data')
      .select('key, value')
      .eq('category', 'variable')
      .eq('source_version', CAPABILITY_RULES_SOURCE_VERSION)
      .in('key', [...CAPABILITY_VARIABLE_KEYS]);
    const gtol = await this.loadTable(CAPABILITY_GTOL_TABLE);
    if (error || gtol == null) {
      return { rules: null, missing: [error ? `variables (${error.message})` : `${CAPABILITY_GTOL_TABLE} (not staged)`] };
    }
    this.capabilityRules = resolveMachiningCapabilityRules(data ?? [], gtol);
    return this.capabilityRules;
  }

  async getOperationSizeRanges(): Promise<any[] | null> {
    return this.loadTable('tblOperationSizeRanges');
  }

  // ── Part load / unload / reorientation by equipment, weight and size (componentLoadTime).
  async getComponentLoadTime(): Promise<any[] | null> {
    return this.loadTable('componentLoadTime');
  }

  // ── Workholder install/remove times (tblInstallingTurningWorkholders).
  async getWorkholderTable(): Promise<any[] | null> {
    return this.loadTable('tblInstallingTurningWorkholders');
  }

  // ── Part-off (tblVirtualPartoffInsertCutData, 181 real rows). Returned
  // whole; the insert is chosen per part in the pure engine (resolvePartoffParams).
  async getPartoffTable(): Promise<any[] | null> {
    return this.loadTable('tblVirtualPartoffInsertCutData');
  }

  // ── Counterboring (tblCounterboring_lookup_table.json, 364 real rows) ────
  async getCounterboreParams(diameterMm: number, materialClass: MaterialClass): Promise<CounterboreParams> {
    const noData: CounterboreParams = { cuttingSpeedMPerMin: 0, feedMmPerRev: 0, depthMaxMm: null, dataFound: false };
    const rows = await this.loadTable('tblCounterboring');
    if (!rows?.length) return noData;
    const targetHb = MACHINING_MATERIAL_HARDNESS_HB[materialClass];
    const row = nearestByDiameterThenHardness(rows, diameterMm, targetHb);
    if (!row || typeof row.cutting_speed_m_min !== 'number' || typeof row.feed_mm_rev !== 'number') return noData;
    return {
      cuttingSpeedMPerMin: row.cutting_speed_m_min,
      feedMmPerRev: row.feed_mm_rev,
      depthMaxMm: typeof row.depth_max_mm === 'number' ? row.depth_max_mm : null,
      dataFound: true,
    };
  }

  // Raw rows, for callers that need to resolve MULTIPLE real diameters in
  // one request (e.g. operation-sequencer.ts matching each real counterbore
  // occurrence on the part, which can have different real diameters) —
  // fetched once here (this table is cached after the first call, see
  // loadTable), matched per-occurrence with the exported nearestByDiameterThenHardness
  // in that pure, no-DB-calls sync function rather than one DB round trip
  // per occurrence.
  async getCounterboreTable(): Promise<any[] | null> {
    return this.loadTable('tblCounterboring');
  }

  // ── Reaming (tblReaming.json, 316 real rows, bare top-level array,
  // CamelCase field names — a genuinely different real source-file shape
  // from tblCounterboring, not a typo) ──────────────────────────────────
  async getReamParams(diameterMm: number, materialClass: MaterialClass): Promise<ReamParams> {
    const noData: ReamParams = { cuttingSpeedMPerMin: 0, feedMm: 0, dataFound: false };
    const rows = await this.loadTable('tblReaming');
    if (!rows?.length) return noData;
    const targetHb = MACHINING_MATERIAL_HARDNESS_HB[materialClass];
    const row = nearestByDiameterThenHardness(rows, diameterMm, targetHb);
    if (!row || typeof row.CuttingSpeedMPerMin !== 'number' || typeof row.FeedMm !== 'number') return noData;
    return {
      cuttingSpeedMPerMin: row.CuttingSpeedMPerMin,
      feedMm: row.FeedMm,
      dataFound: true,
    };
  }

  // Raw rows — cost-machining-engine.ts resolves the real diameter to ream AFTER
  // choosing the smallest real hole group (see computeReamCycleSec's own
  // doc comment), so it needs the table, not a single pre-resolved rate.
  async getReamTable(): Promise<any[] | null> {
    return this.loadTable('tblReaming');
  }

  // ── Hobbing — tblHobbing (809), tblAnsiHobbing (740), variables
  // defaultNumStarts (639). Null when neither table is staged.
  async getHobbingReference(): Promise<HobbingReference | null> {
    const [hobRows, ansiRows] = await Promise.all([this.loadTable('tblHobbing'), this.loadTable('tblAnsiHobbing')]);
    if (!hobRows?.length && !ansiRows?.length) return null;
    const { data } = await this.supabase
      .getPrivilegedClient('reference-data: machining lookup tables, global shared')
      .from('machining_reference_data')
      .select('value')
      .eq('category', 'variable')
      .eq('source_version', MACHINING_REFERENCE_SOURCE_VERSION)
      .eq('key', 'defaultNumStarts')
      .maybeSingle();
    const starts = Number((data as any)?.value);
    return { hobRows: hobRows ?? [], ansiRows: ansiRows ?? [], defaultNumStarts: Number.isFinite(starts) && starts > 0 ? starts : null };
  }

  // ── Gear routing and shaving — tblGearQuality (739, staged under
  // "qualities"), tblShaving (810), variables gearQualityDefaultAgmaNewStd and
  // maxShavingWorkpieceSpeed (639).
  async getGearReference(): Promise<{ qualityRows: GearQualityRow[]; defaultQuality: string | null; shaving: { rows: any[]; maxWorkpieceRpm: number | null } }> {
    const [quality, shavingRows] = await Promise.all([this.loadObjectTable('tblGearQuality'), this.loadTable('tblShaving')]);
    const { data } = await this.supabase
      .getPrivilegedClient('reference-data: machining lookup tables, global shared')
      .from('machining_reference_data')
      .select('key, value')
      .eq('category', 'variable')
      .eq('source_version', MACHINING_REFERENCE_SOURCE_VERSION)
      .in('key', ['gearQualityDefaultAgmaNewStd', 'maxShavingWorkpieceSpeed']);
    const v = (k: string) => (data ?? []).find((r: any) => r.key === k)?.value ?? null;
    const rpm = Number(v('maxShavingWorkpieceSpeed'));
    return {
      qualityRows: Array.isArray(quality?.qualities) ? quality.qualities : [],
      defaultQuality: v('gearQualityDefaultAgmaNewStd'),
      shaving: { rows: shavingRows ?? [], maxWorkpieceRpm: Number.isFinite(rpm) && rpm > 0 ? rpm : null },
    };
  }

  // ── Rotary broaching — tblRotaryBroaching (750) and the rotary-broach
  // variables (639): feed adjustment and the hex / square pilot-hole ratios.
  async getRotaryBroachReference(): Promise<RotaryBroachReference | null> {
    const rows = await this.loadTable('tblRotaryBroaching');
    if (!rows?.length) return null;
    const keys = ['rotaryBroachFeedAdjustment', 'pilotRotaryBroachHoleDiamPercentIncreaseHex', 'pilotRotaryBroachHoleDiamPercentIncreaseSquare', 'pilotRotaryBroachHoleLengthPercentIncrease'];
    const { data } = await this.supabase
      .getPrivilegedClient('reference-data: machining lookup tables, global shared')
      .from('machining_reference_data')
      .select('key, value')
      .eq('category', 'variable')
      .eq('source_version', MACHINING_REFERENCE_SOURCE_VERSION)
      .in('key', keys);
    const v = (k: string) => {
      const n = Number((data ?? []).find((r: any) => r.key === k)?.value);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const hex = v('pilotRotaryBroachHoleDiamPercentIncreaseHex');
    const square = v('pilotRotaryBroachHoleDiamPercentIncreaseSquare');
    return {
      rows,
      feedAdjustment: v('rotaryBroachFeedAdjustment'),
      pilotDiameterRatio: { ...(hex != null ? { 6: hex } : {}), ...(square != null ? { 4: square } : {}) },
      pilotLengthRatio: v('pilotRotaryBroachHoleLengthPercentIncrease'),
    };
  }

  // ── Tapping (tblTapping, migration 809) — raw rows; the calculator's
  // cutting speed is chosen per thread by material hardness and pitch
  // (machining-lookup-seeds.ts resolveTappingRow).
  async getTappingTable(): Promise<any[] | null> {
    return this.loadTable('tblTapping');
  }

  // ── Chamfering (tblChamfering_lookup_table.json, 92 real rows) ──────────
  // No diameter axis in the real source data (chamfer tools are rated by
  // linear edge speed, not a bore diameter) — hardness-only match.
  async getChamferParams(materialClass: MaterialClass): Promise<EdgeToolParams> {
    const noData: EdgeToolParams = { linearSpeedMmPerSec: 0, dataFound: false };
    const rows = await this.loadTable('tblChamfering');
    if (!rows?.length) return noData;
    const row = nearestByHardness(rows, MACHINING_MATERIAL_HARDNESS_HB[materialClass]);
    if (!row || typeof row.linear_speed_mm_s !== 'number') return noData;
    return { linearSpeedMmPerSec: row.linear_speed_mm_s, dataFound: true, materialCutCode: row.material_cut_code_name };
  }

  // ── Deburring (tblDeburring_lookup_table.json, 1182 real rows) ──────────
  async getDeburrParams(materialClass: MaterialClass): Promise<EdgeToolParams> {
    const noData: EdgeToolParams = { linearSpeedMmPerSec: 0, dataFound: false };
    const rows = await this.loadTable('tblDeburring');
    if (!rows?.length) return noData;
    const row = nearestByHardness(rows, MACHINING_MATERIAL_HARDNESS_HB[materialClass]);
    if (!row || typeof row.linear_speed_mm_s !== 'number') return noData;
    return { linearSpeedMmPerSec: row.linear_speed_mm_s, dataFound: true, materialCutCode: row.material_cut_code_name };
  }

  // ── Corner Rounding Mill (tblCornerRoundingMill.json, 91 real rows) —
  // same real hardness-only shape as tblChamfering/tblDeburring above (no
  // diameter axis; a fillet/corner-round pass is rated by real linear edge
  // speed) — just real PascalCase field names (Hardness/LinearSpeedMmPerS)
  // from this source file instead of the snake_case the other two use, a
  // real source-file difference, not a typo. Was staged (migration 743)
  // but never queried by any engine code — operation-sequencer.ts's
  // Filleting/Groove Milling cases used a flat "count * 8 sec" placeholder
  // with no real rate table behind it at all.
  async getRoundingParams(materialClass: MaterialClass): Promise<EdgeToolParams> {
    const noData: EdgeToolParams = { linearSpeedMmPerSec: 0, dataFound: false };
    const rows = await this.loadTable('tblCornerRoundingMill');
    if (!rows?.length) return noData;
    const row = nearestByHardness(rows, MACHINING_MATERIAL_HARDNESS_HB[materialClass]) as any;
    if (!row || typeof row.LinearSpeedMmPerS !== 'number') return noData;
    return { linearSpeedMmPerSec: row.LinearSpeedMmPerS, dataFound: true };
  }

  // ── Gun Drilling (tblGunDrilling.json, 270 real rows, flat per-(material,
  // diameter) rows with real "Diameter (mm)"/"Hardness"/"Cutting Speed (m /
  // min)"/"Feed (mm / rev)" column names transcribed verbatim from the
  // source spreadsheet — real gun_drill machine fleet is 3-50mm diameter,
  // see deep-hole-routing.ts) ────────────────────────────────────────────
  async getGunDrillingParams(diameterMm: number, materialClass: MaterialClass): Promise<DrillingPhysicsParams> {
    const noData: DrillingPhysicsParams = { cuttingSpeedMPerMin: 0, feedMmPerRev: 0, dataFound: false };
    const rows = await this.loadTable('tblGunDrilling');
    if (!rows?.length) return noData;
    const targetHb = MACHINING_MATERIAL_HARDNESS_HB[materialClass];
    const row = nearestByDiameterThenHardness(rows, diameterMm, targetHb);
    const speed = row?.['Cutting Speed (m / min)'];
    const feed = row?.['Feed (mm / rev)'];
    if (!row || typeof speed !== 'number' || typeof feed !== 'number') return noData;
    return { cuttingSpeedMPerMin: speed, feedMmPerRev: feed, dataFound: true };
  }

  // Raw rows — a part can have multiple real deep-hole occurrences at
  // different diameters (see deep-hole-routing.ts), matched per-occurrence
  // in the pure, no-DB-calls cost engine rather than one DB round trip each.
  async getGunDrillingTable(): Promise<any[] | null> {
    return this.loadTable('tblGunDrilling');
  }

  // ── Deep Bore Machine (deep_bore_drill_lookup.json — the whole source
  // object staged as `raw`; a `materials` array keyed by material_cut_code
  // + real hardness, each with ONE per-material cutting_speed_m_min and a
  // real feed_mm_rev_by_diameter map nested by diameter — a genuinely
  // different real shape from tblGunDrilling's flat per-diameter rows, not
  // a typo. Real deep_bore_machine fleet is 50-600mm diameter; the drill
  // (not trepan) tooling table is used uniformly here — a disclosed
  // simplification, not a fabrication: this iteration doesn't model the
  // real drill-vs-trepan tooling choice large-diameter shops actually make.
  async getDeepBoreParams(diameterMm: number, materialClass: MaterialClass): Promise<DrillingPhysicsParams> {
    const noData: DrillingPhysicsParams = { cuttingSpeedMPerMin: 0, feedMmPerRev: 0, dataFound: false };
    const materials = await this.getDeepBoreMaterials();
    if (!materials?.length) return noData;
    const targetHb = MACHINING_MATERIAL_HARDNESS_HB[materialClass];
    const row = nearestByHardness(materials, targetHb);
    const speed = row?.cutting_speed_m_min;
    const feed = nearestByDiameterKey(row?.feed_mm_rev_by_diameter, diameterMm);
    if (!row || typeof speed !== 'number' || feed == null) return noData;
    return { cuttingSpeedMPerMin: speed, feedMmPerRev: feed, dataFound: true };
  }

  // Raw materials array — same multi-occurrence rationale as getGunDrillingTable.
  async getDeepBoreMaterials(): Promise<any[] | null> {
    const table = await this.loadObjectTable('deep_bore_drill_lookup');
    const materials = table?.materials;
    return Array.isArray(materials) ? materials : null;
  }

  // ── Cylindrical / Internal Grinding (tblCylindricalGrinding /
  // tblInternalGrinding, 72 rows each) — neither table has a hardness
  // column (keyed only by material cut code, per the table's own
  // data-quality note), so the normal nearestByHardness bridge can't apply
  // directly. 2-hop bridge instead: resolve the nearest material_cut_code for
  // this material class's hardness from tblGeneralTurning (which carries
  // hardness on the SAME code numbering — code "1.0" = hardness 125 in both
  // tblDrilling and tblGeneralTurning), then look up that exact code in the
  // grinding table. Codes are compared as numbers: 809 staged "1.0" as 1
  // (all 72 codes stay distinct as numbers).
  getCylindricalGrindingParams(materialClass: MaterialClass): Promise<CylindricalGrindingParams> {
    return this.getGrindingParams(materialClass, 'tblCylindricalGrinding');
  }

  getInternalGrindingParams(materialClass: MaterialClass): Promise<CylindricalGrindingParams> {
    return this.getGrindingParams(materialClass, 'tblInternalGrinding');
  }

  // ── Reciprocating Surface Grinding (tblReciprocatingSurfaceGrinding,
  // migration 749, 72 rows) — same material-code bridge as the grinding
  // tables above (no hardness column). The crossfeed per stroke is the
  // table's AbsoluteCrossfeedMm, capped at MaxFractionalCrossfeed of the
  // wheel width; the wheel is the table's own ToolSeries, whose width
  // tblGrinding gives (migration 809).
  async getSurfaceGrindingParams(materialClass: MaterialClass): Promise<SurfaceGrindingParams | null> {
    const turningTable = await this.loadObjectTable('tblGeneralTurning');
    const turningMaterials: any[] | undefined = turningTable?.materials;
    if (!Array.isArray(turningMaterials) || turningMaterials.length === 0) return null;
    const code = nearestByHardness(turningMaterials, MACHINING_MATERIAL_HARDNESS_HB[materialClass])?.material_cut_code;
    if (!code) return null;
    const rows = await this.loadTable('tblReciprocatingSurfaceGrinding');
    const row = rows?.find((r: any) => r.MaterialCutCodeName != null && Number(r.MaterialCutCodeName) === Number(code));
    if (!row) return null;
    const grinding = await this.loadObjectTable('tblGrinding');
    const wheelRows: any[] = (grinding?.materials?.rows ?? []).filter((r: any) => r.tool_series === row.ToolSeries);
    const widths = [...new Set(wheelRows.map((r) => r.wheel_width_mm).filter((w) => typeof w === 'number' && w > 0))];
    const wheelWidthMm = widths.length === 1 ? widths[0] as number : null;
    const nums = [row.TableSpeedMPerMin, row.RoughDownfeedMm, row.FinishDownfeedMm, row.AbsoluteCrossfeedMm, row.MaxFractionalCrossfeed];
    if (nums.some((v) => typeof v !== 'number' || !(v > 0))) return null;
    return {
      materialCutCode: String(row.MaterialCutCodeName),
      toolSeries: row.ToolSeries,
      tableSpeedMPerMin: row.TableSpeedMPerMin,
      roughDownfeedMm: row.RoughDownfeedMm,
      finishDownfeedMm: row.FinishDownfeedMm,
      absoluteCrossfeedMm: row.AbsoluteCrossfeedMm,
      maxFractionalCrossfeed: row.MaxFractionalCrossfeed,
      wheelWidthMm,
    };
  }

  private async getGrindingParams(materialClass: MaterialClass, table: GrindingTable): Promise<CylindricalGrindingParams> {
    const noData: CylindricalGrindingParams = {
      wheelSpeedMS: 0, workSpeedMMin: 0, roughInfeedMm: 0, finishInfeedMm: 0,
      roughAxialFeedRevMm: 0, finishAxialFeedRevMm: 0, dataFound: false,
    };
    const turningTable = await this.loadObjectTable('tblGeneralTurning');
    const turningMaterials: any[] | undefined = turningTable?.materials;
    if (!Array.isArray(turningMaterials) || turningMaterials.length === 0) return noData;
    const targetHb = MACHINING_MATERIAL_HARDNESS_HB[materialClass];
    const code = nearestByHardness(turningMaterials, targetHb)?.material_cut_code;
    if (!code) return noData;

    const grindingRows = await this.loadTable(table);
    if (!grindingRows?.length) return noData;
    const c = GRINDING_COLUMNS[table];
    const row = grindingRows.find((r: any) => r[c.code] != null && Number(r[c.code]) === Number(code));
    if (!row) return noData;
    const values = {
      wheelSpeedMS: row[c.wheelSpeed], workSpeedMMin: row[c.workSpeed],
      roughInfeedMm: row[c.roughInfeed], finishInfeedMm: row[c.finishInfeed],
      roughAxialFeedRevMm: row[c.roughAxialFeed], finishAxialFeedRevMm: row[c.finishAxialFeed],
    };
    if (Object.values(values).some((v) => typeof v !== 'number')) return noData;
    return { ...values, dataFound: true, materialCutCode: code, match: { table, row: { [c.code]: row[c.code] } } };
  }

  // ── Jig Boring (reuses tblBoringV2_lookup_table.json's real "Finish
  // Boring" rows, 1274 real rows total — Sandvik CoroBore tooling data
  // with a real hardness column, so the normal nearestByDiameterThenHardness
  // bridge applies directly, no 2-hop resolution needed). Real Jig Boring
  // achieves its tighter tolerance via real repeat passes over this same
  // real finish-boring physics (capability-rules.ts jigBoringRepetitions), not a separate
  // cutting-speed table — none exists in the reference corpus. Filtered
  // to 'Finish Boring' here so the pure cost engine's matcher never
  // accidentally resolves a Rough/Semi-Finish row (materially different
  // real cutting speeds) for what must be a precision pass.
  async getFinishBoringTable(): Promise<any[] | null> {
    const rows = await this.loadTable('tblBoringV2');
    if (!rows?.length) return null;
    const finishRows = rows.filter((r: any) => r.cut_type === 'Finish Boring');
    return finishRows.length > 0 ? finishRows : null;
  }

  // ── Keyway Broaching — the reference keyway broach tables (migration
  // 811: tblPullTypeKeywayBroach, tblShimTypeKeywayBroach) and the two
  // positioning-time variables (migration 639). The broach is chosen per
  // keyway in the pure engine (machining-lookup-seeds.ts resolveKeywayBroach).
  // Null when neither table is staged.
  async getKeywayBroachReference(): Promise<KeywayBroachReference | null> {
    const [pullRows, shimRows] = await Promise.all([
      this.loadTable('tblPullTypeKeywayBroach'),
      this.loadTable('tblShimTypeKeywayBroach'),
    ]);
    if (!pullRows?.length && !shimRows?.length) return null;
    const { data } = await this.supabase
      .getPrivilegedClient('reference-data: machining lookup tables, global shared')
      .from('machining_reference_data')
      .select('key, value')
      .eq('category', 'variable')
      .eq('source_version', MACHINING_REFERENCE_SOURCE_VERSION)
      .in('key', ['singlePassKeywayBroachingPositioningTime', 'multipassKeywayBroachingPositioningTime']);
    const variable = (key: string) => {
      const v = Number((data ?? []).find((r: any) => r.key === key)?.value);
      return Number.isFinite(v) && v >= 0 ? v : null;
    };
    return {
      pullRows: pullRows ?? [],
      shimRows: shimRows ?? [],
      singlePassPositioningS: variable('singlePassKeywayBroachingPositioningTime'),
      multipassPositioningS: variable('multipassKeywayBroachingPositioningTime'),
    };
  }

  // ── Wire EDM (tblWireEDMing.json, 73 real rows) — this table has NO
  // hardness column of its own (confirmed directly), keyed only by the
  // same real material_cut_code numbering tblGeneralTurning/tblDrilling
  // use. Real 2-hop bridge, identical in structure to
  // getCylindricalGrindingParams above: resolve the nearest real
  // material_cut_code for this material class's hardness from
  // tblGeneralTurning, then EXACT-match that code here (all 37 of this
  // table's real codes are a genuine subset of tblGeneralTurning's 91,
  // verified directly — every resolvable code has a real row here, not a
  // guess). The table's own real `_status` field discloses it is a PARTIAL
  // transcription — several real material codes carry a real
  // FeedRateMmPerMin of exactly 0 (data not yet transcribed for that code,
  // not a real zero cutting speed) — treated as "no data" (dataFound:
  // false), never divided into a cycle time.
  async getWireEdmParams(materialClass: MaterialClass): Promise<WireEdmParams> {
    const noData: WireEdmParams = { roughFeedRateMmPerMin: 0, finishFeedRateMmPerMin: 0, dataFound: false };
    const turningTable = await this.loadObjectTable('tblGeneralTurning');
    const turningMaterials: any[] | undefined = turningTable?.materials;
    if (!Array.isArray(turningMaterials) || turningMaterials.length === 0) return noData;
    const targetHb = MACHINING_MATERIAL_HARDNESS_HB[materialClass];
    const code = nearestByHardness(turningMaterials, targetHb)?.material_cut_code;
    if (!code) return noData;

    const edmRows = await this.loadTable('tblWireEDMing');
    if (!edmRows?.length) return noData;
    const codeRows = edmRows.filter((r: any) => r.MaterialCutCodeName === code);
    const roughRow = codeRows.find((r: any) => r.CutType === 'Roughing');
    const finishRow = codeRows.find((r: any) => r.CutType === 'Finishing');
    const roughFeed = roughRow?.FeedRateMmPerMin;
    const finishFeed = finishRow?.FeedRateMmPerMin;
    if (typeof roughFeed !== 'number' || roughFeed <= 0 || typeof finishFeed !== 'number' || finishFeed <= 0) {
      return noData;
    }
    return { roughFeedRateMmPerMin: roughFeed, finishFeedRateMmPerMin: finishFeed, dataFound: true, materialCutCode: code };
  }

  // ── General Turning depth-of-cut (tblGeneralTurning / general_turning_
  // lookup.json, 91 real materials) — this table carries its own real
  // hardness column directly (unlike tblCylindricalGrinding), so a single
  // nearestByHardness bridge resolves the row -- no 2-hop needed. Each real
  // material row's own `operations.medium_rough_turning`/`finish_turning`
  // sub-objects give real per-pass cut_depth_mm/cutting_speed_m_min/
  // feed_rate_mm_rev -- replaces the previous flat, uncited TURNING_MRR
  // table + fixed x1.2 fudge factor with a genuine rough/finish pass model
  // (real max roughing depth -> real pass count, same "L/F x N" physics
  // the reference methodology for this domain describes).
  async getTurningParams(materialClass: MaterialClass): Promise<TurningParams> {
    const noData: TurningParams = {
      roughCutDepthMm: 0, roughCuttingSpeedMPerMin: 0, roughFeedMmPerRev: 0,
      finishCutDepthMm: 0, finishCuttingSpeedMPerMin: 0, finishFeedMmPerRev: 0,
      dataFound: false,
    };
    const turningTable = await this.loadObjectTable('tblGeneralTurning');
    const turningMaterials: any[] | undefined = turningTable?.materials;
    if (!Array.isArray(turningMaterials) || turningMaterials.length === 0) return noData;
    const targetHb = MACHINING_MATERIAL_HARDNESS_HB[materialClass];
    const row = nearestByHardness(turningMaterials, targetHb) as any;
    const rough = row?.operations?.medium_rough_turning;
    const finish = row?.operations?.finish_turning;
    if (
      !rough || !finish
      || typeof rough.cut_depth_mm !== 'number' || rough.cut_depth_mm <= 0
      || typeof rough.cutting_speed_m_min !== 'number' || rough.cutting_speed_m_min <= 0
      || typeof rough.feed_rate_mm_rev !== 'number' || rough.feed_rate_mm_rev <= 0
      || typeof finish.cut_depth_mm !== 'number' || finish.cut_depth_mm <= 0
      || typeof finish.cutting_speed_m_min !== 'number' || finish.cutting_speed_m_min <= 0
      || typeof finish.feed_rate_mm_rev !== 'number' || finish.feed_rate_mm_rev <= 0
    ) {
      return noData;
    }
    return {
      roughCutDepthMm: rough.cut_depth_mm,
      roughCuttingSpeedMPerMin: rough.cutting_speed_m_min,
      roughFeedMmPerRev: rough.feed_rate_mm_rev,
      finishCutDepthMm: finish.cut_depth_mm,
      finishCuttingSpeedMPerMin: finish.cutting_speed_m_min,
      finishFeedMmPerRev: finish.feed_rate_mm_rev,
      dataFound: true,
      materialCutCode: row.material_cut_code,
    };
  }

  // ── Multi-spindle op-splitting (tblMultiSpindleOpSplitting /
  // tblMultiSpindleOpSplittingThresholds, migration 785, source:
  // memory/machining/lookup/) — real spindle-count-driven station-split
  // rules for a Simultaneous Turning machine. Exact match on real spindle
  // count (the real table only has entries for 2/6/8, and every real
  // machine in simultaneous_turning_usa.csv reports a spindle count in
  // that same set — no interpolation needed or performed). Returns
  // dataFound:false (never a guessed split) when the feature/operation
  // pair has no real row, or the machine's real spindle count has no exact
  // real entry for that pair.
  async getMultiSpindleOpSplit(
    feature: string,
    operation: string,
    spindleCount: number,
  ): Promise<{ shouldSplit: boolean; numberOfOperations: number; thresholdRatio: number | null; dataFound: boolean }> {
    const noData = { shouldSplit: false, numberOfOperations: 1, thresholdRatio: null, dataFound: false };
    const [splitRows, thresholdRows] = await Promise.all([
      this.loadTable('tblMultiSpindleOpSplitting'),
      this.loadTable('tblMultiSpindleOpSplittingThresholds'),
    ]);
    const thresholdRow = thresholdRows?.find(
      (r: any) => r.feature === feature && r.operation === operation,
    );
    if (!thresholdRow || thresholdRow.enable_operation_splitting !== true) return noData;
    const splitRow = splitRows?.find(
      (r: any) => r.feature === feature && r.operation === operation && Number(r.machine_spindles) === spindleCount,
    );
    if (!splitRow) return noData;
    return {
      shouldSplit: true,
      numberOfOperations: Number(splitRow.number_of_operations) || 1,
      thresholdRatio: Number(thresholdRow.threshold),
      dataFound: true,
    };
  }
}
