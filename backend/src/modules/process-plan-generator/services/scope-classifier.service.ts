import { Injectable, Logger } from '@nestjs/common';
import {
  BriefBomItem,
  BriefDfm,
  PartFamily,
  PartFamilyDecision,
} from '../dto/engineering-brief.dto';

/**
 * Stage 1.5 — decides whether the part is in Phase-1 scope (CNC turned /
 * milled / sheet metal) or out of scope (castings, forgings, composites,
 * complex assemblies, welded fab).
 *
 * Runs BEFORE any LLM call — out-of-scope generations are free.
 *
 * Heuristic rather than statistical because we want determinism + auditability
 * here. The user has explicitly asked for a narrower-but-trustworthy launch
 * (Phase 1 = high accuracy on a small surface area).
 */
@Injectable()
export class ScopeClassifierService {
  private readonly logger = new Logger(ScopeClassifierService.name);

  classify(bom: BriefBomItem, dfm: BriefDfm): PartFamilyDecision {
    // 1. Assemblies/sub-assemblies are Phase 2 (BOM tree reasoning is out of scope)
    if (bom.itemType === 'assembly' || bom.itemType === 'sub_assembly') {
      return this.outOfScope(
        `Item type ${bom.itemType} requires BOM-tree reasoning; Phase 1 covers child parts only`,
        0.95,
      );
    }

    // 2. Material/process hints in the material name → out of scope
    const materialHint = (bom.materialHint ?? '').toLowerCase();
    const castOrForgeKeywords = ['cast iron', 'gg25', 'gg30', 'ductile iron', 'sand cast', 'die cast', 'investment cast', 'forging', 'forged', 'composite', 'frp', 'cfrp', 'gfrp'];
    for (const kw of castOrForgeKeywords) {
      if (materialHint.includes(kw)) {
        return this.outOfScope(
          `Material "${bom.materialHint}" matches non-machining keyword "${kw}"`,
          0.9,
        );
      }
    }

    // 3. Pull dimensions (prefer DFM bbox if it exists, fall back to BOM dims)
    const lengthMm = dfm.boundingBox.lengthMm || bom.dimensions.lengthMm || 1;
    const widthMm = dfm.boundingBox.widthMm || bom.dimensions.widthMm || 1;
    const heightMm = dfm.boundingBox.heightMm || bom.dimensions.heightMm || 1;
    const minDim = Math.min(lengthMm, widthMm, heightMm);
    const maxDim = Math.max(lengthMm, widthMm, heightMm);
    const midDim = lengthMm + widthMm + heightMm - minDim - maxDim;
    const aspectRatio = maxDim / Math.max(minDim, 0.1);
    const volumeCm3 = (dfm.volumeMm3 || 1) / 1000;
    const complexity = dfm.holeCount + dfm.pocketCount * 2 + dfm.thinWallCount + dfm.undercutCount * 3;

    // 4. Very large + very complex → likely casting (out of scope)
    if (volumeCm3 > 5000 && complexity > 8) {
      return this.outOfScope(
        `Large volume ${volumeCm3.toFixed(0)}cm³ + high complexity score ${complexity} suggests casting/forging`,
        0.75,
      );
    }

    // 5. Sheet metal — one dim very thin + flat profile
    if (minDim < 4 && aspectRatio > 6) {
      return this.inScope(
        'sheet_metal',
        `Flat profile (min dim ${minDim.toFixed(1)}mm) + aspect ratio ${aspectRatio.toFixed(1)} = sheet metal`,
        0.85,
      );
    }

    // 6. CNC turned — cylindrical/rotational symmetry
    //    Heuristic: middle and short axes are ~equal (within 25%) AND
    //    longest axis is >= 1.4× the cross-section diameter. This catches
    //    pins, shafts, bushings, rollers.
    const crossSectionRatio = Math.abs(midDim - minDim) / Math.max(minDim, 0.1);
    const isLikelyCylinder = crossSectionRatio < 0.25 && maxDim >= 1.4 * minDim;
    if (isLikelyCylinder) {
      return this.inScope(
        'cnc_turned',
        `Rotational geometry (mid/min Δ=${(crossSectionRatio * 100).toFixed(0)}%, L/D=${(maxDim / minDim).toFixed(2)}) → turning`,
        0.8,
      );
    }

    // 7. Anything else with reasonable size → CNC milled
    if (volumeCm3 < 8000 && bom.itemType === 'child_part') {
      return this.inScope(
        'cnc_milled',
        `Prismatic geometry, child part, volume ${volumeCm3.toFixed(0)}cm³ → CNC milling`,
        complexity > 3 ? 0.75 : 0.65,
      );
    }

    // 8. Default safety net — out of scope (don't generate on guesses)
    return this.outOfScope(
      `Geometry doesn't match any Phase-1 family confidently (volume ${volumeCm3.toFixed(0)}cm³, complexity ${complexity})`,
      0.5,
    );
  }

  private inScope(family: PartFamily, reason: string, confidence: number): PartFamilyDecision {
    return { family, inScope: true, reason, confidence };
  }

  private outOfScope(reason: string, confidence: number): PartFamilyDecision {
    this.logger.log(`Out of scope: ${reason}`);
    return {
      family: 'out_of_scope',
      inScope: false,
      reason,
      confidence,
    };
  }
}
