import { Injectable } from '@nestjs/common';
import type { RawGeometry } from './auto-fill.service';

type ExtractionMethod = 'occ_cylindrical_face' | 'stl_curvature_analysis' | 'bbox_heuristic' | 'summary_expansion';

interface GeometryRefs { faces: number[]; edges: number[]; vertices: number[]; }

interface CostDriver {
  name: string; unit: string; value: number;
  driverType: string; quantity: number;
}

interface ManufacturingFeatureBase {
  id: string;
  featureCategory: 'cut' | 'form' | 'machined';
  index: number;
  faces: number[];
  edges: number[];
  geometryRefs: GeometryRefs;
  costDrivers: CostDriver[];
  confidence: number;
  source: 'step_topology' | 'mesh_inference';
  extractionMethod: ExtractionMethod;
  manufacturingIntent: string;
}

interface FlatPatternFeature extends ManufacturingFeatureBase {
  type: 'flat_pattern';
  featureCategory: 'cut';
  recognition: {
    area_mm2: number;
    cut_length_mm: number;
    // Present only when the cad-engine's panel-wire walk produced a
    // breakdown (sheet-metal STEP topology path) — undefined for
    // mesh-inference-only parts, where only the combined total is known.
    cut_length_breakdown?: { outer_profile_mm: number; circular_holes_mm: number; internal_profiles_mm: number };
    // Length of the single longest unbroken laser path — laser machines
    // slow down on long contours, so this is distinct from the summed
    // cut_length_mm total. Same undefined convention as cut_length_breakdown.
    longest_continuous_cut_mm?: number;
    // Corner counts by turn angle — how many discrete corners on the cut
    // path need the machine to decelerate. acute is always a SUBSET of
    // sharp (150deg > 60deg threshold), not a separate/overlapping bucket.
    // Same undefined convention as cut_length_breakdown.
    sharp_corner_count?: number;
    acute_corner_count?: number;
    // Holes under 2x sheet thickness in diameter — a laser/punch must run a
    // reduced feed rate piercing these. Same undefined convention as
    // cut_length_breakdown.
    small_hole_count?: number;
    // Nesting/material-utilization metrics — present only when the cad
    // engine's 2D unfold solver could resolve the flat pattern's real
    // bounding rectangle (fails gracefully to undefined on a graph it
    // can't confidently walk, e.g. non-manifold topology — never guessed).
    bounding_rect_mm2?: number;
    material_utilization_pct?: number;
    scrap_area_mm2?: number;
    pierce_count: number;
    sheet_thickness_mm: number;
    est_laser_time_sec: number;
    // Non-cutting head-repositioning time between real pierce locations
    // (nearest-neighbour tour over hole/slot centroids) — additive on top
    // of cutting+piercing time, not part of est_laser_time_sec. Same
    // undefined convention as cut_length_breakdown.
    rapid_traverse_sec?: number;
  };
}

type HoleType = 'through' | 'counterbore' | 'countersink';

interface HoleFeature extends ManufacturingFeatureBase {
  type: 'hole';
  featureCategory: 'cut';
  recognition: {
    diameter_mm: number;
    count: number;
    depth_mm: number | null;
    through: null;
    hole_type: HoleType;
  };
}

interface BendFeature extends ManufacturingFeatureBase {
  type: 'bend';
  featureCategory: 'form';
  recognition: {
    radius_mm: number | null;
    count: number;
    // Real per-bend angle (averaged across this radius group's real bends —
    // in practice near-constant per group) and length (the LONGEST real bend
    // line in the group, the sizing-relevant one for press-brake tonnage).
    // null when the cad-engine's bend clustering didn't carry this data
    // (mesh-inference-only parts, or a sharp-fold part with no bend radius
    // at all) — never a guessed/backfilled value.
    angle_deg: number | null;
    bend_length_mm: number | null;
  };
}

export type SheetMetalFeature = FlatPatternFeature | HoleFeature | BendFeature;

@Injectable()
export class SheetMetalFeatureExtractorService {
  extract(geo: RawGeometry): SheetMetalFeature[] {
    return [
      this.buildFlatPatternFeature(geo),
      ...this.buildHoleFeatures(geo),
      ...this.buildBendFeatures(geo),
    ].filter((f): f is SheetMetalFeature => f !== null);
  }

  private featureId(type: string, attrs: Record<string, unknown>): string {
    if (type === 'flat_pattern') return 'flat_pattern';
    if (type === 'hole') return `hole_${attrs.hole_type ?? 'through'}_d${Number(attrs.diameter_mm).toFixed(1)}_x${attrs.count}`;
    if (type === 'bend') {
      const r = attrs.radius_mm != null ? Number(attrs.radius_mm).toFixed(1) : 'unk';
      return `bend_r${r}_x${attrs.count}`;
    }
    return `${type}_${attrs.count ?? 0}`;
  }

  private emptyGeoRefs(): GeometryRefs {
    return { faces: [], edges: [], vertices: [] };
  }

  private buildFlatPatternFeature(geo: RawGeometry): FlatPatternFeature | null {
    if (geo.flatPatternAreaMm2 <= 0) return null;
    const estLaserTimeSec = geo.cutLengthMm > 0
      ? Math.round((geo.cutLengthMm / 4000) * 60 + geo.pierceCount * 2.0)
      : 0;
    const recognition = {
      area_mm2: Math.round(geo.flatPatternAreaMm2),
      cut_length_mm: Math.round(geo.cutLengthMm),
      ...(geo.cutLengthBreakdown ? {
        cut_length_breakdown: {
          outer_profile_mm: Math.round(geo.cutLengthBreakdown.outerProfileMm * 10) / 10,
          circular_holes_mm: Math.round(geo.cutLengthBreakdown.circularHolesMm * 10) / 10,
          internal_profiles_mm: Math.round(geo.cutLengthBreakdown.internalProfilesMm * 10) / 10,
        },
      } : {}),
      ...(geo.longestContinuousCutMm != null ? { longest_continuous_cut_mm: Math.round(geo.longestContinuousCutMm * 10) / 10 } : {}),
      ...(geo.sharpCornerCount != null ? { sharp_corner_count: geo.sharpCornerCount, acute_corner_count: geo.acuteCornerCount ?? 0 } : {}),
      ...(geo.smallHoleCount != null ? { small_hole_count: geo.smallHoleCount } : {}),
      ...(geo.boundingRectMm2 ? {
        bounding_rect_mm2: Math.round(geo.boundingRectMm2 * 10) / 10,
        material_utilization_pct: geo.materialUtilizationPct,
        scrap_area_mm2: geo.scrapAreaMm2,
      } : {}),
      pierce_count: geo.pierceCount,
      ...(geo.rapidTraverseSec != null ? { rapid_traverse_sec: geo.rapidTraverseSec } : {}),
      sheet_thickness_mm: geo.sheetThicknessMm,
      est_laser_time_sec: estLaserTimeSec,
    };
    return {
      id: this.featureId('flat_pattern', recognition),
      type: 'flat_pattern',
      featureCategory: 'cut',
      index: 0,
      faces: [], edges: [],
      geometryRefs: this.emptyGeoRefs(),
      recognition,
      costDrivers: [
        { name: 'Part Area', driverType: 'material_usage', unit: 'mm²', value: geo.flatPatternAreaMm2, quantity: geo.flatPatternAreaMm2 },
        ...(geo.boundingRectMm2 ? [
          { name: 'Bounding Rectangle', driverType: 'material_usage', unit: 'mm²', value: geo.boundingRectMm2, quantity: geo.boundingRectMm2 },
          { name: 'Material Utilization', driverType: 'material_usage', unit: '%', value: geo.materialUtilizationPct ?? 0, quantity: geo.materialUtilizationPct ?? 0 },
          { name: 'Scrap', driverType: 'material_usage', unit: 'mm²', value: geo.scrapAreaMm2 ?? 0, quantity: geo.scrapAreaMm2 ?? 0 },
        ] : []),
        { name: 'Laser Cut Length', driverType: 'laser_time', unit: 'mm', value: geo.cutLengthMm, quantity: geo.cutLengthMm },
        ...(geo.longestContinuousCutMm != null ? [
          { name: 'Longest Continuous Cut', driverType: 'laser_time', unit: 'mm', value: geo.longestContinuousCutMm, quantity: geo.longestContinuousCutMm },
        ] : []),
        ...(geo.sharpCornerCount != null ? [
          { name: 'Sharp Corners (>60°)', driverType: 'corner_deceleration', unit: 'pcs', value: geo.sharpCornerCount, quantity: geo.sharpCornerCount },
          { name: 'Acute Corners (<30°)', driverType: 'corner_deceleration', unit: 'pcs', value: geo.acuteCornerCount ?? 0, quantity: geo.acuteCornerCount ?? 0 },
        ] : []),
        ...(geo.smallHoleCount != null ? [
          { name: 'Small Holes (<2x Thickness)', driverType: 'feed_rate_reduction', unit: 'pcs', value: geo.smallHoleCount, quantity: geo.smallHoleCount },
        ] : []),
        ...(geo.rapidTraverseSec != null ? [
          { name: 'Rapid Traverse', driverType: 'laser_time', unit: 'sec', value: geo.rapidTraverseSec, quantity: geo.rapidTraverseSec },
        ] : []),
      ],
      confidence: 0.90,
      source: geo.featureSource,
      extractionMethod: geo.featureSource === 'step_topology' ? 'occ_cylindrical_face' : 'bbox_heuristic',
      manufacturingIntent: 'laser_cut',
    };
  }

  private buildHoleFeatures(geo: RawGeometry): HoleFeature[] {
    // Prefer pre-grouped data from CAD engine: avoids NaN→null bug where
    // d.toFixed() on a non-number produces "NaN" → parseFloat("NaN") = NaN
    // → JSON.stringify({diameter_mm: NaN}) = '{"diameter_mm":null}' → Ø? in UI.
    const groupsFromCAD = geo.holeGroups ?? [];
    const rawGroups: Array<{ diameter_mm: number; count: number }> = groupsFromCAD.length > 0
      ? groupsFromCAD
      : (() => {
          if (geo.holeDiameters.length === 0) return [];
          const acc: Record<string, number> = {};
          for (const d of geo.holeDiameters) {
            if (typeof d !== 'number' || !isFinite(d) || d <= 0) continue;
            const k = d.toFixed(1);
            acc[k] = (acc[k] ?? 0) + 1;
          }
          return Object.entries(acc).map(([k, count]) => ({ diameter_mm: parseFloat(k), count }));
        })();

    const buildGroup = (
      g: { diameter_mm: number; count: number },
      i: number,
      holeType: HoleType,
      manufacturingIntent: string,
      costDriverName: string,
    ): HoleFeature => {
      const recognition = { diameter_mm: g.diameter_mm, count: g.count, depth_mm: null, through: null as null, hole_type: holeType };
      return {
        id: this.featureId('hole', recognition),
        type: 'hole' as const,
        featureCategory: 'cut' as const,
        index: i,
        faces: [], edges: [],
        geometryRefs: this.emptyGeoRefs(),
        recognition,
        costDrivers: [
          { name: costDriverName, driverType: 'pierce_count', unit: 'pcs', value: g.count, quantity: g.count },
        ],
        confidence: geo.featureSource === 'step_topology' ? 0.85 : 0.45,
        source: geo.featureSource,
        extractionMethod: geo.featureSource === 'step_topology' ? 'occ_cylindrical_face' : 'stl_curvature_analysis',
        manufacturingIntent,
      };
    };

    // Counterbore/countersink groups are a distinct secondary-operation feature —
    // subtract their counts from the generic through-hole population at the same
    // diameter so the same physical hole isn't reported twice (once as a plain
    // through-hole, once as counterbore/countersink).
    const counterboreGroups = geo.counterboreGroups ?? [];
    const countersinkGroups = geo.countersinkGroups ?? [];
    const remaining = new Map(rawGroups.map((g) => [g.diameter_mm, g.count]));
    for (const g of [...counterboreGroups, ...countersinkGroups]) {
      const left = remaining.get(g.diameter_mm);
      if (left != null) remaining.set(g.diameter_mm, Math.max(0, left - g.count));
    }

    const throughFeatures = rawGroups
      .map((g) => ({ diameter_mm: g.diameter_mm, count: remaining.get(g.diameter_mm) ?? g.count }))
      .filter((g) => g.count > 0)
      .map((g, i) => buildGroup(g, i, 'through', 'laser_pierce', 'Pierce Points'));

    const counterboreFeatures = counterboreGroups.map((g, i) =>
      buildGroup(g, i, 'counterbore', 'counterbore', 'Counterbore Hits'));

    const countersinkFeatures = countersinkGroups.map((g, i) =>
      buildGroup(g, i, 'countersink', 'countersink', 'Countersink Hits'));

    return [...throughFeatures, ...counterboreFeatures, ...countersinkFeatures];
  }

  private buildBendFeatures(geo: RawGeometry): BendFeature[] {
    if (geo.bendCount <= 0) return [];
    const groups: Record<string, { count: number; lengths: number[]; angles: number[] }> = {};
    if (geo.bendRadii.length > 0) {
      // bendRadii/bendLengths/bendAngles are aligned index-for-index (same
      // cad-engine clustering pass — see RawGeometry.bendLengths), so index i
      // in each array describes the SAME physical bend.
      geo.bendRadii.forEach((r, i) => {
        const k = r.toFixed(1);
        const g = (groups[k] ??= { count: 0, lengths: [], angles: [] });
        g.count += 1;
        const len = geo.bendLengths?.[i];
        const ang = geo.bendAngles?.[i];
        if (typeof len === 'number' && isFinite(len)) g.lengths.push(len);
        if (typeof ang === 'number' && isFinite(ang)) g.angles.push(ang);
      });
    } else {
      // bend count known but no radii data (STL or no OCC bend detection)
      groups['?'] = { count: geo.bendCount, lengths: [], angles: [] };
    }
    return Object.entries(groups).map(([r, g], i) => {
      // Longest real bend line in the group -- the sizing-relevant one for
      // press-brake tonnage, not a sum (a brake bends one line at a time).
      const bend_length_mm = g.lengths.length > 0 ? Math.round(Math.max(...g.lengths) * 10) / 10 : null;
      const angle_deg = g.angles.length > 0
        ? Math.round((g.angles.reduce((a, b) => a + b, 0) / g.angles.length) * 10) / 10
        : null;
      const recognition = {
        radius_mm: r === '?' ? null : parseFloat(r),
        count: g.count,
        angle_deg,
        bend_length_mm,
      };
      return {
        id: this.featureId('bend', recognition),
        type: 'bend' as const,
        featureCategory: 'form' as const,
        index: i,
        faces: [], edges: [],
        geometryRefs: this.emptyGeoRefs(),
        recognition,
        costDrivers: [
          { name: 'Press Brake Hits', driverType: 'press_brake_hits', unit: 'hits', value: g.count, quantity: g.count },
          ...(bend_length_mm != null ? [
            { name: 'Bend Length', driverType: 'press_brake_tonnage', unit: 'mm', value: bend_length_mm, quantity: bend_length_mm },
          ] : []),
        ],
        confidence: geo.featureSource === 'step_topology' ? 0.75 : 0.40,
        source: geo.featureSource,
        extractionMethod: geo.featureSource === 'step_topology' ? 'occ_cylindrical_face' : 'summary_expansion',
        manufacturingIntent: 'press_brake',
      };
    });
  }
}
