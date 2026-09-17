import { Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from '../../../../../common/supabase/supabase.service';
import {
  type BoundingBox, type BlankResult, type StockForm, type StockProfile,
  sortedDimensions, roundBarCandidates, hexBarCandidates, rectangularBarCandidates,
  selectBestAutoCandidate, selectForcedFormCandidate, billetFallback, BAR_LENGTH_ALLOWANCE_MM,
} from './blank-stock-candidates';

export type { BoundingBox, BlankResult, StockForm } from './blank-stock-candidates';

@Injectable()
export class BlankOptimizerService {
  private readonly logger = new Logger(BlankOptimizerService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async selectOptimalBlank(
    bbox: BoundingBox,
    partVolMm3: number,
    family: "cnc_milled" | "cnc_turned" | "mill_turn",
    accessToken: string,
    // Cost Guide "Stock Form" manual override (bom_items.scenario_overrides.
    // stockForm — see resolveScenarioStockForm). null/undefined = "Let
    // eMithran Decide", the existing auto-selection behaviour below.
    forcedForm?: StockForm | null,
  ): Promise<BlankResult> {
    try {
      const profiles = await this.loadStockProfiles(accessToken);
      const { L, W, H } = sortedDimensions(bbox);
      const barLen = L + BAR_LENGTH_ALLOWANCE_MM;
      const minDiam = Math.max(W, H) * 1.03;

      if (forcedForm) {
        return selectForcedFormCandidate(forcedForm, profiles, bbox, partVolMm3, barLen, minDiam, W, H);
      }

      if (profiles.length === 0) return billetFallback(bbox, partVolMm3);

      const candidates =
        family === "cnc_turned" || family === "mill_turn"
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

      const best = selectBestAutoCandidate(candidates, bbox);
      if (!best) {
        this.logger.debug('Blank optimizer: no stock profile smaller than bbox billet — using billet');
        return billetFallback(bbox, partVolMm3);
      }

      if ((best.utilizationPct ?? 0) > 85) {
        this.logger.warn(
          `Blank optimizer: ${best.sizeLabel} gives ${best.utilizationPct?.toFixed(0)}% utilization — may be too tight. Check CAD dimensions.`,
        );
      }

      this.logger.debug(
        `Blank optimizer: selected ${best.sizeLabel} — vol=${best.billetVolMm3.toFixed(0)} mm³, util=${best.utilizationPct?.toFixed(1)}%`,
      );
      return { form: best.form, sizeLabel: best.sizeLabel, billetVolMm3: best.billetVolMm3, utilizationPct: best.utilizationPct };
    } catch (err) {
      this.logger.warn(`Blank optimizer failed, using billet fallback: ${(err as Error).message}`);
      return billetFallback(bbox, partVolMm3);
    }
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
