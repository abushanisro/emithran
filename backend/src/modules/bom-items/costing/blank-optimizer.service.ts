import { Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from "../../../common/supabase/supabase.service";

export interface BoundingBox {
  length: number; // mm — longest dimension (feed direction)
  width: number; // mm
  height: number; // mm
}

export interface BlankResult {
  form: string; // 'round_bar' | 'hex_bar' | 'rectangular_bar' | 'billet'
  sizeLabel: string; // human-readable e.g. "Ø30 round bar" or "50×30 rect bar"
  billetVolMm3: number;
  utilizationPct: number | null; // null when fallback billet
}

interface StockProfile {
  form: string;
  size_a_mm: number;
  size_b_mm: number | null;
}

// Facing/parting stock added to bar length (one end face + cutoff groove)
const BAR_LENGTH_ALLOWANCE_MM = 5;

@Injectable()
export class BlankOptimizerService {
  private readonly logger = new Logger(BlankOptimizerService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async selectOptimalBlank(
    bbox: BoundingBox,
    partVolMm3: number,
    family: "cnc_milled" | "cnc_turned" | "mill_turn",
    accessToken: string,
  ): Promise<BlankResult> {
    try {
      const profiles = await this.loadStockProfiles(accessToken);
      if (profiles.length === 0) return this.billetFallback(bbox, partVolMm3);

      const candidates: Array<BlankResult & { score: number }> = [];

      const { L, W, H } = this.sortedDimensions(bbox);

      if (family === "cnc_turned" || family === "mill_turn") {
        // Turning: must fit inside a round bar diameter ≥ max(W, H) × 1.03
        const minDiam = Math.max(W, H) * 1.03;
        for (const p of profiles.filter((p) => p.form === "round_bar")) {
          if (p.size_a_mm < minDiam) continue;
          const barLen = L + BAR_LENGTH_ALLOWANCE_MM;
          const r = p.size_a_mm / 2;
          const vol = Math.PI * r * r * barLen;
          const util = partVolMm3 > 0 ? (partVolMm3 / vol) * 100 : null;
          candidates.push({
            form: "round_bar",
            sizeLabel: `Ø${p.size_a_mm} round bar`,
            billetVolMm3: vol,
            utilizationPct: util !== null ? Math.min(100, util) : null,
            score: this.score(vol, partVolMm3),
          });
        }
      } else {
        // Milled: try round bar (if part is roughly cylindrical) and rectangular bar
        const minDiam = Math.max(W, H) * 1.03;
        for (const p of profiles.filter((p) => p.form === "round_bar")) {
          if (p.size_a_mm < minDiam) continue;
          const barLen = L + BAR_LENGTH_ALLOWANCE_MM;
          const r = p.size_a_mm / 2;
          const vol = Math.PI * r * r * barLen;
          const util = partVolMm3 > 0 ? (partVolMm3 / vol) * 100 : null;
          candidates.push({
            form: "round_bar",
            sizeLabel: `Ø${p.size_a_mm} round bar`,
            billetVolMm3: vol,
            utilizationPct: util !== null ? Math.min(100, util) : null,
            score: this.score(vol, partVolMm3),
          });
        }

        for (const p of profiles.filter(
          (p) => p.form === "rectangular_bar" && p.size_b_mm != null,
        )) {
          // Rectangular bar must fit W × H in either orientation
          const fits =
            (p.size_a_mm >= W * 1.03 && p.size_b_mm! >= H * 1.03) ||
            (p.size_a_mm >= H * 1.03 && p.size_b_mm! >= W * 1.03);
          if (!fits) continue;
          const barLen = L + BAR_LENGTH_ALLOWANCE_MM;
          const vol = p.size_a_mm * p.size_b_mm! * barLen;
          const util = partVolMm3 > 0 ? (partVolMm3 / vol) * 100 : null;
          candidates.push({
            form: "rectangular_bar",
            sizeLabel: `${p.size_a_mm}×${p.size_b_mm} rect bar`,
            billetVolMm3: vol,
            utilizationPct: util !== null ? Math.min(100, util) : null,
            score: this.score(vol, partVolMm3),
          });
        }
      }

      if (candidates.length === 0) return this.billetFallback(bbox, partVolMm3);

      // Best candidate = highest utilization-weighted score (lowest oversize)
      candidates.sort((a, b) => b.score - a.score);

      // Never use a stock form that's LARGER than the bbox billet — that would make
      // material cost and chip loss worse than the fallback. Only select bar stock
      // when it genuinely improves utilization.
      const bboxFallbackVol = (bbox.length + 6) * (bbox.width + 6) * (bbox.height + 6);
      const best = candidates.find(c => c.billetVolMm3 < bboxFallbackVol);
      if (!best) {
        this.logger.debug(
          `Blank optimizer: no stock profile smaller than bbox billet (${bboxFallbackVol.toFixed(0)} mm³) — using billet`,
        );
        return this.billetFallback(bbox, partVolMm3);
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
      return this.billetFallback(bbox, partVolMm3);
    }
  }

  private score(blankVol: number, partVol: number): number {
    if (blankVol <= 0) return -Infinity;
    const util = partVol / blankVol; // higher = better fit
    const oversize = blankVol / Math.max(partVol, 1); // lower = better
    // 70% weight on utilization, 30% on minimising excess material
    return util * 0.7 + (1 / oversize) * 0.3;
  }

  // Sort bbox so L is always the longest (feed axis)
  private sortedDimensions(bbox: BoundingBox): { L: number; W: number; H: number } {
    const dims = [bbox.length, bbox.width, bbox.height].sort((a, b) => b - a);
    return { L: dims[0], W: dims[1], H: dims[2] };
  }

  private billetFallback(bbox: BoundingBox, partVolMm3: number): BlankResult {
    // 3mm per side (not 6mm) — halved stock allowance is still an improvement
    const allow = 6; // 3mm per side × 2 axes
    const vol =
      (bbox.length + allow) * (bbox.width + allow) * (bbox.height + allow);
    const util = vol > 0 && partVolMm3 > 0 ? (partVolMm3 / vol) * 100 : null;
    return {
      form: "billet",
      sizeLabel: `${(bbox.length + allow).toFixed(0)}×${(bbox.width + allow).toFixed(0)}×${(bbox.height + allow).toFixed(0)} billet`,
      billetVolMm3: vol,
      utilizationPct: util !== null ? Math.min(100, util) : null,
    };
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
