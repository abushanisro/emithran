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

    // 1b. CAD engine's own topology-based family decision — highest-confidence signal
    //     The Python OCC engine computes flatness, hole density, and planar face fraction
    //     directly from geometry. Trust it over any BOM/name heuristic.
    //     CAVEAT: detected_family is persisted in geometry_analysis at upload time, so it
    //     can predate classifier fixes. A "cnc_milled" verdict is NOT trusted when the
    //     geometry carries sheet-metal evidence no milled billet part can have (extreme
    //     low fill, extracted sheet thickness, or bends) — fall through to the geometry
    //     rules below, which will re-derive the family with their own reasons.
    if (dfm.cadDetectedFamily && dfm.cadDetectedFamily !== 'unknown') {
      const familyMap: Record<string, PartFamily | null> = {
        sheet_metal: 'sheet_metal',
        cnc_turned:  'cnc_turned',
        cnc_milled:  'cnc_milled',
        mill_turn:   'cnc_turned',
      };
      const mapped = familyMap[dfm.cadDetectedFamily];
      if (mapped) {
        const bb = dfm.boundingBox;
        const storedBboxVol = bb.lengthMm * bb.widthMm * bb.heightMm;
        const fill = storedBboxVol > 0 && dfm.volumeMm3 > 0 ? dfm.volumeMm3 / storedBboxVol : 1;
        const storedMinDim = Math.min(
          bb.lengthMm || Infinity, bb.widthMm || Infinity, bb.heightMm || Infinity,
        );
        const sheetContradiction =
          mapped === 'cnc_milled' &&
          ((fill < 0.10 && storedMinDim < 200) ||
            (dfm.sheetThicknessMm > 0 && dfm.sheetThicknessMm < 10) ||
            (dfm.bendCount > 0 && fill < 0.30));
        if (sheetContradiction) {
          this.logger.warn(
            `[classify] Stored CAD family "cnc_milled" contradicted by sheet-metal geometry ` +
            `(fill ${(fill * 100).toFixed(1)}%, sheetThickness ${dfm.sheetThicknessMm}mm, ` +
            `bends ${dfm.bendCount}) — ignoring stored family, using geometry rules`,
          );
        } else {
          this.logger.log(`[classify] CAD engine detected family "${dfm.cadDetectedFamily}" → ${mapped}`);
          return this.inScope(mapped, `CAD engine topology analysis: "${dfm.cadDetectedFamily}"`, 0.90);
        }
      }
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

    // 2b. Material-keyword family hints — drawing material is already promoted
    //     into bom.materialHint before classify() is called (retrieval.service.ts).
    //     These override geometry heuristics because material evidence is more reliable.
    if (/\b(sheet|plate|cold.?rolled|\bcr\b|\bhr\b|strip|shim|coil|flat\s*bar)\b/.test(materialHint)) {
      return this.inScope(
        'sheet_metal',
        `Material "${bom.materialHint}" matches sheet/plate keywords`,
        0.92,
      );
    }
    if (/\b(bar\s*stock|round\s*bar|hex\s*bar|\brod\b|\bbillet\b)/.test(materialHint)) {
      return this.inScope(
        'cnc_turned',
        `Material "${bom.materialHint}" matches bar/rod stock keywords`,
        0.90,
      );
    }

    // 2c. Part name keywords — many sheet metal parts are named as brackets/panels/covers
    //     even when the material field is generic "Steel" or blank.
    const partName = (bom.partName ?? '').toLowerCase();
    if (/\b(bracket|panel|cover|enclosure|clip|chassis|shroud|shield|flange|duct|gusset|tray|housing\s*cover)\b|frame\b/.test(partName)) {
      return this.inScope(
        'sheet_metal',
        `Part name "${bom.partName}" matches sheet metal indicator keyword`,
        0.82,
      );
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
    const bboxVol = lengthMm * widthMm * heightMm;

    // 4. Very large + very complex → likely casting (out of scope)
    if (volumeCm3 > 5000 && complexity > 8) {
      return this.outOfScope(
        `Large volume ${volumeCm3.toFixed(0)}cm³ + high complexity score ${complexity} suggests casting/forging`,
        0.75,
      );
    }

    // 4b. Sheet-metal geometry signals extracted from OCC analysis.
    //     These fire even when the full CAD family decision is missing (STL-only parts).
    if (dfm.sheetThicknessMm > 0 && dfm.sheetThicknessMm < 10) {
      return this.inScope(
        'sheet_metal',
        `Sheet thickness ${dfm.sheetThicknessMm}mm extracted by CAD engine → sheet metal`,
        0.92,
      );
    }
    if (dfm.bendCount > 0) {
      const fillRatio = bboxVol > 0 ? dfm.volumeMm3 / bboxVol : 1;
      if (fillRatio < 0.30) {
        return this.inScope(
          'sheet_metal',
          `${dfm.bendCount} bend(s) detected with low fill fraction (${(fillRatio * 100).toFixed(0)}%) → sheet metal`,
          0.88,
        );
      }
    }

    // 5. Sheet metal — one dim thin + flat profile.
    //    Threshold raised from 4mm to 12mm: catches 6mm aluminium/steel sheet
    //    (e.g. 200×150×6 → aspectRatio 33) while excluding solid prismatic blocks.
    if (minDim < 12 && aspectRatio > 4) {
      return this.inScope(
        'sheet_metal',
        `Flat profile (min dim ${minDim.toFixed(1)}mm, aspect ${aspectRatio.toFixed(1)}) → sheet metal`,
        0.85,
      );
    }

    // 5b. Low volume fill-fraction: perforated/cut-out sheet with holes uses much less
    //     volume than the bounding box predicts. A solid CNC block cannot have < 10 %
    //     fill; sheet metal enclosures routinely do. minDim < 200 excludes only truly
    //     massive structural fabrications (ship hull sections, etc.).
    if (bboxVol > 0 && dfm.volumeMm3 > 0 && (dfm.volumeMm3 / bboxVol) < 0.10 && minDim < 200) {
      return this.inScope(
        'sheet_metal',
        `Low volume fill (${((dfm.volumeMm3 / bboxVol) * 100).toFixed(0)}%) with min dim ${minDim.toFixed(1)}mm → sheet metal frame`,
        0.78,
      );
    }
    if (dfm.thinWallCount > 0 && minDim < 60) {
      return this.inScope(
        'sheet_metal',
        `Thin-wall feature detected + min dim ${minDim.toFixed(1)}mm → sheet metal`,
        0.80,
      );
    }

    // 5c. SA/Vol ratio: solid machined parts ~0.1–0.4 mm⁻¹; open frames/panels >0.8.
    //     bboxVol > 100_000 skips small solid parts (pins/shafts) that also have high
    //     SA/Vol simply because they are tiny — those are caught by the cylinder rule below.
    if (dfm.surfaceAreaMm2 > 0 && dfm.volumeMm3 > 0 && bboxVol > 100_000) {
      const saVol = dfm.surfaceAreaMm2 / dfm.volumeMm3;
      if (saVol > 0.8 && minDim < 100) {
        return this.inScope(
          'sheet_metal',
          `High SA/Vol ratio (${saVol.toFixed(2)} mm⁻¹) with min dim ${minDim.toFixed(1)}mm → sheet metal frame/panel`,
          0.82,
        );
      }
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
