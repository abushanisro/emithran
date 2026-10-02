import { Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from '../../../../../common/supabase/supabase.service';
import {
  type BoundingBox, type BlankResult, type StockForm, type StockProfile,
  sortedDimensions, roundBarCandidates, hexBarCandidates, rectangularBarCandidates,
  selectBestAutoCandidate, selectForcedFormCandidate, billetFallback, BAR_LENGTH_ALLOWANCE_MM,
} from './blank-stock-candidates';

import {
  resolveStockAllowanceRule, stockAllowancePerSideMm, STOCK_MACHINING_SOURCE_VERSION, STOCK_ALLOWANCE_VARIABLE_KEYS,
  type StockAllowanceRule,
} from '../../machining/stock-allowance';

export type { BoundingBox, BlankResult, StockForm } from './blank-stock-candidates';

@Injectable()
export class BlankOptimizerService {
  private readonly logger = new Logger(BlankOptimizerService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async selectOptimalBlank(
    bbox: BoundingBox,
    partVolMm3: number,
    family: "milled" | "turned" | "mill_turn",
    accessToken: string,
    // Cost Guide "Stock Form" manual override (bom_items.scenario_overrides.
    // stockForm — see resolveScenarioStockForm). null/undefined = "Let
    // eMithran Decide", the existing auto-selection behaviour below.
    forcedForm?: StockForm | null,
    // Turned parts: the CAD turning axis (turned OD + length along the axis,
    // BOMItemsService.resolveTurnedGeometry). A bar is fed along the turning
    // axis, which is not necessarily the bounding box's longest side — a
    // Ø17.6 × 3.0 mm disc is fed 3 mm per part, not 17.6 mm.
    turnedAxis?: { diameterMm: number; lengthMm: number } | null,
  ): Promise<BlankResult> {
    try {
      const profiles = await this.loadStockProfiles(accessToken);
      const allowance = (await this.stockAllowanceFor(bbox)).allowancePerSideMm;
      const turnedFamily = family === 'turned' || family === 'mill_turn';
      const { L, W, H } = turnedFamily && turnedAxis
        ? { L: turnedAxis.lengthMm, W: turnedAxis.diameterMm, H: turnedAxis.diameterMm }
        : sortedDimensions(bbox);
      const barLen = L + BAR_LENGTH_ALLOWANCE_MM;
      const minDiam = Math.max(W, H) * 1.03;

      if (forcedForm) {
        return selectForcedFormCandidate(forcedForm, profiles, bbox, partVolMm3, barLen, minDiam, W, H, allowance);
      }

      if (profiles.length === 0) return billetFallback(bbox, partVolMm3, allowance);

      const candidates =
        family === "turned" || family === "mill_turn"
          // Turning: must fit inside a round bar diameter ≥ max(W, H) × 1.03
          ? roundBarCandidates(profiles, minDiam, barLen, partVolMm3)
          // Milled: try round bar (if roughly cylindrical), hex bar (if
          // roughly hexagonal), and rectangular bar — real stock_profiles
          // data exists for all three (migration 350); scoring picks
          // whichever real candidate wastes the least material.
          : [
              ...roundBarCandidates(profiles, minDiam, barLen, partVolMm3),
              ...hexBarCandidates(profiles, minDiam, barLen, partVolMm3),
              ...rectangularBarCandidates(profiles, W, H, barLen, partVolMm3),
            ];

      const best = selectBestAutoCandidate(candidates, bbox, allowance);
      if (!best) {
        this.logger.debug('Blank optimizer: no stock profile smaller than bbox billet — using billet');
        return billetFallback(bbox, partVolMm3, allowance);
      }

      if ((best.utilizationPct ?? 0) > 85) {
        this.logger.warn(
          `Blank optimizer: ${best.sizeLabel} gives ${best.utilizationPct?.toFixed(0)}% utilization — may be too tight. Check CAD dimensions.`,
        );
      }

      this.logger.debug(
        `Blank optimizer: selected ${best.sizeLabel} — vol=${best.billetVolMm3.toFixed(0)} mm³, util=${best.utilizationPct?.toFixed(1)}%`,
      );
      return {
        form: best.form, sizeLabel: best.sizeLabel, billetVolMm3: best.billetVolMm3, utilizationPct: best.utilizationPct,
        ...(best.barDiameterMm != null ? { barDiameterMm: best.barDiameterMm } : {}),
      };
    } catch (err) {
      this.logger.warn(`Blank optimizer failed, using billet fallback: ${(err as Error).message}`);
      return billetFallback(bbox, partVolMm3, (await this.stockAllowanceFor(bbox)).allowancePerSideMm);
    }
  }

  /**
   * The reference stock-allowance rule (memory/Stock Maching/variables.csv,
   * migration 816), read once per process. A read error is not cached; a
   * genuinely absent rule is.
   */
  private allowanceRule: { rule: StockAllowanceRule | null; missing: string[] } | null = null;

  private async loadStockAllowanceRule(): Promise<{ rule: StockAllowanceRule | null; missing: string[] }> {
    if (this.allowanceRule) return this.allowanceRule;
    const { data, error } = await this.supabase
      .getPrivilegedClient('reference-data: machining_reference_data and stock_profiles, global shared')
      .from('machining_reference_data')
      .select('key, value')
      .eq('category', 'variable')
      .eq('source_version', STOCK_MACHINING_SOURCE_VERSION)
      .in('key', [...STOCK_ALLOWANCE_VARIABLE_KEYS]);
    if (error) return { rule: null, missing: [...STOCK_ALLOWANCE_VARIABLE_KEYS] };
    this.allowanceRule = resolveStockAllowanceRule(data ?? []);
    return this.allowanceRule;
  }

  /** Per-side allowance for a billet of this bounding box, or null (with the
   *  missing variables named) when the reference rule is not staged. */
  async stockAllowanceFor(bbox: BoundingBox): Promise<{ allowancePerSideMm: number | null; missing: string[] }> {
    const { rule, missing } = await this.loadStockAllowanceRule();
    if (!rule) return { allowancePerSideMm: null, missing };
    return { allowancePerSideMm: stockAllowancePerSideMm(rule, bbox), missing: [] };
  }

  private async loadStockProfiles(accessToken: string): Promise<StockProfile[]> {
    const client = this.supabase.getClient(accessToken);
    const { data, error } = await client
      .from("stock_profiles")
      .select("form, size_a_mm, size_b_mm")
      .order("form")
      .order("size_a_mm");

    if (error) {
      this.logger.warn(`Failed to load stock_profiles: ${error.message}`);
      return [];
    }
    return (data ?? []) as StockProfile[];
  }
}
