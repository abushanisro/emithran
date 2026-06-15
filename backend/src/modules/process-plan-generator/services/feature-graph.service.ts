import { Injectable } from '@nestjs/common';

import type { EngineeringBrief } from '../dto/engineering-brief.dto';
import type {
  ManufacturingFeature,
  ManufacturingFeatureGraph,
  ManufacturingFeatureType,
} from '../dto/manufacturing-feature.dto';

/**
 * Builds a ManufacturingFeatureGraph from existing extraction data:
 *   - DrawingBrief (Claude vision on 2D PDF — highest confidence)
 *   - BriefDfm     (3D STEP geometry analysis — medium confidence)
 *   - BriefBomItem (BOM metadata — lowest confidence)
 *
 * This is a pure deterministic transformation. No AI, no network calls.
 * The Rule Engine downstream converts features → MandatoryOp[].
 */
@Injectable()
export class FeatureGraphService {
  build(brief: EngineeringBrief): ManufacturingFeatureGraph {
    const features: ManufacturingFeature[] = [];
    let seq = 1;
    const dr = brief.drawing;

    // ── From 2D drawing (confidence ≥ 0.92) ────────────────────────────────
    if (dr.available) {
      // Holes: cross-holes and axial holes
      for (const h of dr.holes) {
        const isCross = /cross|transverse/i.test(h.feature);
        const type: ManufacturingFeatureType = isCross ? 'CROSS_HOLE' : 'AXIAL_HOLE';
        features.push({
          id: `F${seq++}`, type, source: 'drawing', confidence: 0.95,
          diameter: h.diameter,
          depth: h.depth ?? undefined,
          throughHole: h.throughHole,
        });
        if (h.counterbore) {
          features.push({
            id: `F${seq++}`, type: 'COUNTERBORE', source: 'drawing', confidence: 0.95,
            diameter: h.counterbore.diameter,
            depth: h.counterbore.depth,
          });
        }
        if (h.countersink) {
          features.push({
            id: `F${seq++}`, type: 'COUNTERSINK', source: 'drawing', confidence: 0.95,
            diameter: h.countersink.diameter,
          });
        }
      }

      // Threads
      for (const t of dr.threads) {
        // Internal threads: tap specs (UNC-2B, UNF-2B) or metric (M6×1)
        const isInternal = /unc-2b|unf-2b|tap/i.test(t.spec) || /^M\d/.test(t.spec);
        features.push({
          id: `F${seq++}`,
          type: isInternal ? 'THREAD_INTERNAL' : 'THREAD_EXTERNAL',
          source: 'drawing', confidence: 0.95,
          spec: t.spec,
        });
      }

      // Surface finish requirements — tiered by achievable process
      for (const sf of dr.surfaceFinishes) {
        if (sf.raMicrons == null) continue;
        if (sf.raMicrons <= 0.8) {
          // Ra ≤ 0.8μm → grinding required after turning
          features.push({
            id: `F${seq++}`, type: 'GRIND', source: 'drawing', confidence: 0.92,
            raMicrons: sf.raMicrons,
          });
        } else if (sf.raMicrons <= 1.6) {
          // Ra 0.8–1.6μm → dedicated finish turning pass required
          features.push({
            id: `F${seq++}`, type: 'SURFACE_FINISH_FINE', source: 'drawing', confidence: 0.92,
            raMicrons: sf.raMicrons,
          });
        }
        // Ra > 1.6μm → standard rough turning sufficient; no additional feature
      }

      // Shoulder / step turning — if ≥2 distinct diameters appear in the drawing,
      // the part has a step that requires a dedicated shoulder turning operation.
      const diamDims = dr.dimensions.filter((d) => d.type === 'diameter');
      const distinctDiamKeys = new Set(diamDims.map((d) => Math.round(d.nominal * 10)));
      if (distinctDiamKeys.size >= 2) {
        features.push({
          id: `F${seq++}`, type: 'SHOULDER_TURN', source: 'drawing', confidence: 0.90,
          count: distinctDiamKeys.size - 1, // number of shoulder steps
        });
      }

      // Surface treatment (anodize / plate / passivate)
      if (dr.surfaceTreatment) {
        const isAnodize = /anodiz/i.test(dr.surfaceTreatment);
        features.push({
          id: `F${seq++}`,
          type: isAnodize ? 'ANODIZE' : 'PLATE',
          source: 'drawing', confidence: 0.95,
          spec: dr.surfaceTreatment,
        });
      }

      // Heat treatment (skip generic placeholders)
      if (dr.heatTreatment && !/^(as.?required|none|n\/a|\s*)$/i.test(dr.heatTreatment.trim())) {
        features.push({
          id: `F${seq++}`, type: 'HEAT_TREAT', source: 'drawing', confidence: 0.95,
          spec: dr.heatTreatment,
        });
      }

      // Pockets from GD&T / drawing keywords
      if (brief.dfm.pocketCount > 0) {
        features.push({
          id: `F${seq++}`, type: 'POCKET', source: 'geometry', confidence: 0.70,
          count: brief.dfm.pocketCount,
        });
      }
    }

    // ── From 3D geometry (confidence 0.70) ──────────────────────────────────
    // Only add hole feature if drawing didn't already capture holes
    const drawingHasHoles = features.some(
      (f) => f.type === 'CROSS_HOLE' || f.type === 'AXIAL_HOLE',
    );
    if (!drawingHasHoles && brief.dfm.holeCount > 0) {
      features.push({
        id: `F${seq++}`, type: 'AXIAL_HOLE', source: 'geometry', confidence: 0.70,
        count: brief.dfm.holeCount,
      });
    }

    // ── Always-present manufacturing constants (confidence 0.99) ────────────
    features.push({ id: `F${seq++}`, type: 'SAW_CUT', source: 'bom', confidence: 0.99 });
    features.push({ id: `F${seq++}`, type: 'DEBURR',  source: 'bom', confidence: 0.99 });
    features.push({ id: `F${seq++}`, type: 'INSPECT', source: 'bom', confidence: 0.99 });

    const overallConfidence = features.length > 0
      ? Math.min(...features.map((f) => f.confidence))
      : 1.0;

    const buildSources: ('drawing' | 'geometry' | 'bom')[] = dr.available
      ? ['drawing', 'geometry', 'bom']
      : ['geometry', 'bom'];

    return { features, buildSources, overallConfidence };
  }
}
