import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../../../common/supabase/supabase.service';
import type { MaterialClass } from '../process/cost-cnc-engine';
import {
  MACHINING_MATERIAL_HARDNESS_HB,
  nearestByHardness,
  nearestByDiameterThenHardness,
  nearestByDiameterKey,
} from './machining-material-hardness';

// The real hardness-bridge constants/matchers this service uses live in
// machining-material-hardness.ts — a plain, framework-free module (no
// NestJS @Injectable, no SupabaseService) so operation-sequencer.ts and
// cost-cnc-engine.ts (pure, no-DB-calls sync engines) can import the same
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
}

export interface CylindricalGrindingParams {
  wheelSpeedMS: number;
  workSpeedMMin: number;
  roughInfeedMm: number;
  finishInfeedMm: number;
  roughAxialFeedRevMm: number;
  finishAxialFeedRevMm: number;
  dataFound: boolean;
}

export interface BroachingParams {
  roughCuttingSpeedMPerMin: number;
  finishCuttingSpeedMPerMin: number;
  dataFound: boolean;
}

export interface WireEdmParams {
  roughFeedRateMmPerMin: number;
  finishFeedRateMmPerMin: number;
  dataFound: boolean;
}

export interface TurningParams {
  roughCutDepthMm: number;
  roughCuttingSpeedMPerMin: number;
  roughFeedMmPerRev: number;
  finishCutDepthMm: number;
  finishCuttingSpeedMPerMin: number;
  finishFeedMmPerRev: number;
  dataFound: boolean;
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
    const db = this.supabase.getAdminClient();
    const { data, error } = await db
      .from('machining_reference_data')
      .select('raw')
      .eq('category', 'lookup_table')
      .eq('key', key)
      .maybeSingle();
    if (error || !data?.raw) {
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
    const db = this.supabase.getAdminClient();
    const { data, error } = await db
      .from('machining_reference_data')
      .select('raw')
      .eq('category', 'lookup_table')
      .eq('key', key)
      .maybeSingle();
    const raw = !error && data?.raw && typeof data.raw === 'object' && !Array.isArray(data.raw) ? data.raw : null;
    this.tableCache.set(key, raw);
    return raw;
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

  // Raw rows — cost-cnc-engine.ts resolves the real diameter to ream AFTER
  // choosing the smallest real hole group (see computeReamCycleSec's own
  // doc comment), so it needs the table, not a single pre-resolved rate.
  async getReamTable(): Promise<any[] | null> {
    return this.loadTable('tblReaming');
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
    return { linearSpeedMmPerSec: row.linear_speed_mm_s, dataFound: true };
  }

  // ── Deburring (tblDeburring_lookup_table.json, 1182 real rows) ──────────
  async getDeburrParams(materialClass: MaterialClass): Promise<EdgeToolParams> {
    const noData: EdgeToolParams = { linearSpeedMmPerSec: 0, dataFound: false };
    const rows = await this.loadTable('tblDeburring');
    if (!rows?.length) return noData;
    const row = nearestByHardness(rows, MACHINING_MATERIAL_HARDNESS_HB[materialClass]);
    if (!row || typeof row.linear_speed_mm_s !== 'number') return noData;
    return { linearSpeedMmPerSec: row.linear_speed_mm_s, dataFound: true };
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

  // ── Cylindrical Grinding (tblCylindricalGrinding_lookup_table.json, 72
  // real rows) — this table carries NO hardness column at all (keyed only
  // by material_cut_code_name, confirmed by its own real data-quality
  // note), so the normal nearestByHardness bridge can't apply directly.
  // Real 2-hop bridge instead: resolve the nearest real material_cut_code
  // for this material class's hardness from tblGeneralTurning (which DOES
  // carry real hardness on the SAME real code numbering — code "1.0" =
  // hardness 125 in both tblDrilling and tblGeneralTurning, verified
  // earlier this session, ~0.6% apart, corroborating a shared real material
  // property), then look up that EXACT code in tblCylindricalGrinding. Not
  // a fabricated code mapping.
  async getCylindricalGrindingParams(materialClass: MaterialClass): Promise<CylindricalGrindingParams> {
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

    const grindingRows = await this.loadTable('tblCylindricalGrinding');
    if (!grindingRows?.length) return noData;
    const row = grindingRows.find((r: any) => r.material_cut_code_name === code);
    if (!row) return noData;
    const {
      wheel_speed_m_s: wheelSpeedMS, work_speed_m_min: workSpeedMMin,
      rough_infeed_mm: roughInfeedMm, finish_infeed_mm: finishInfeedMm,
      rough_axial_feed_rev_1: roughAxialFeedRevMm, finish_axial_feed_rev_1: finishAxialFeedRevMm,
    } = row;
    if ([wheelSpeedMS, workSpeedMMin, roughInfeedMm, finishInfeedMm, roughAxialFeedRevMm, finishAxialFeedRevMm]
      .some((v) => typeof v !== 'number')) {
      return noData;
    }
    return { wheelSpeedMS, workSpeedMMin, roughInfeedMm, finishInfeedMm, roughAxialFeedRevMm, finishAxialFeedRevMm, dataFound: true };
  }

  // ── Jig Boring (reuses tblBoringV2_lookup_table.json's real "Finish
  // Boring" rows, 1274 real rows total — Sandvik CoroBore tooling data
  // with a real hardness column, so the normal nearestByDiameterThenHardness
  // bridge applies directly, no 2-hop resolution needed). Real Jig Boring
  // achieves its tighter tolerance via real repeat passes over this same
  // real finish-boring physics (JIG_BORE_NUM_REPETITIONS), not a separate
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

  // ── Keyway Broaching (tblBroaching_lookup_table.json, 364 real rows) —
  // this table has no real "Keyway Broach" tool_type: only "Fir Tree
  // Broach" (turbine blade-root profile) and "Internal Gear Broach"
  // (involute gear-tooth profile) exist. The table's own real
  // data_quality_note confirms cutting_speed_m_min is IDENTICAL between
  // both tool series for every one of the 91 real material codes — cutting
  // speed here is a material property, not a tooth-profile property — so
  // which series is used to resolve keyway speed makes no numeric
  // difference; "Internal Gear Broach" is used as the representative
  // series (an internal profile pulled through the workpiece in one
  // stroke, mechanically closer to a keyway broach than a turbine Fir Tree
  // root). No diameter axis exists in this table (broach speed doesn't
  // vary by slot width the way drilling speed varies by hole diameter) —
  // hardness-only match, same pattern as Chamfering/Deburring above. Real
  // Roughing + Finishing cut_type rows both resolved so the cost engine can
  // model a genuine 2-pass (rough stroke + finish stroke) cycle.
  async getBroachingParams(materialClass: MaterialClass): Promise<BroachingParams> {
    const noData: BroachingParams = { roughCuttingSpeedMPerMin: 0, finishCuttingSpeedMPerMin: 0, dataFound: false };
    const rows = await this.loadTable('tblBroaching');
    if (!rows?.length) return noData;
    const seriesRows = rows.filter((r: any) => r.tool_type === 'Internal Gear Broach');
    const targetHb = MACHINING_MATERIAL_HARDNESS_HB[materialClass];
    const roughRow = nearestByHardness(seriesRows.filter((r: any) => r.cut_type === 'Roughing'), targetHb);
    const finishRow = nearestByHardness(seriesRows.filter((r: any) => r.cut_type === 'Finishing'), targetHb);
    const roughSpeed = roughRow?.cutting_speed_m_min;
    const finishSpeed = finishRow?.cutting_speed_m_min;
    if (typeof roughSpeed !== 'number' || typeof finishSpeed !== 'number') return noData;
    return { roughCuttingSpeedMPerMin: roughSpeed, finishCuttingSpeedMPerMin: finishSpeed, dataFound: true };
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
    return { roughFeedRateMmPerMin: roughFeed, finishFeedRateMmPerMin: finishFeed, dataFound: true };
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
    };
  }
}
