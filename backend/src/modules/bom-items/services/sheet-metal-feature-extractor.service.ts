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
    pierce_count: number;
    sheet_thickness_mm: number;
    est_laser_time_sec: number;
  };
}

interface HoleFeature extends ManufacturingFeatureBase {
  type: 'hole';
  featureCategory: 'cut';
  recognition: {
    diameter_mm: number;
    count: number;
    depth_mm: number | null;
    through: null;
  };
}

interface BendFeature extends ManufacturingFeatureBase {
  type: 'bend';
  featureCategory: 'form';
  recognition: {
    radius_mm: number | null;
    count: number;
    angle_deg: null;
    bend_length_mm: null;
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
    if (type === 'hole') return `hole_d${Number(attrs.diameter_mm).toFixed(1)}_x${attrs.count}`;
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
      pierce_count: geo.pierceCount,
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
        { name: 'Material Usage', driverType: 'material_usage', unit: 'mm²', value: geo.flatPatternAreaMm2, quantity: geo.flatPatternAreaMm2 },
        { name: 'Laser Cut Length', driverType: 'laser_time', unit: 'mm', value: geo.cutLengthMm, quantity: geo.cutLengthMm },
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

    return rawGroups.map((g, i) => {
      const recognition = { diameter_mm: g.diameter_mm, count: g.count, depth_mm: null, through: null as null };
      return {
        id: this.featureId('hole', recognition),
        type: 'hole' as const,
        featureCategory: 'cut' as const,
        index: i,
        faces: [], edges: [],
        geometryRefs: this.emptyGeoRefs(),
        recognition,
        costDrivers: [
          { name: 'Pierce Points', driverType: 'pierce_count', unit: 'pcs', value: g.count, quantity: g.count },
        ],
        confidence: geo.featureSource === 'step_topology' ? 0.85 : 0.45,
        source: geo.featureSource,
        extractionMethod: geo.featureSource === 'step_topology' ? 'occ_cylindrical_face' : 'stl_curvature_analysis',
        manufacturingIntent: 'laser_pierce',
      };
    });
  }

  private buildBendFeatures(geo: RawGeometry): BendFeature[] {
    if (geo.bendCount <= 0) return [];
    const groups: Record<string, number> = {};
    if (geo.bendRadii.length > 0) {
      for (const r of geo.bendRadii) {
        const k = r.toFixed(1);
        groups[k] = (groups[k] ?? 0) + 1;
      }
    } else {
      // bend count known but no radii data (STL or no OCC bend detection)
      groups['?'] = geo.bendCount;
    }
    return Object.entries(groups).map(([r, count], i) => {
      const recognition = {
        radius_mm: r === '?' ? null : parseFloat(r),
        count,
        angle_deg: null as null,
        bend_length_mm: null as null,
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
          { name: 'Press Brake Hits', driverType: 'press_brake_hits', unit: 'hits', value: count, quantity: count },
        ],
        confidence: geo.featureSource === 'step_topology' ? 0.75 : 0.40,
        source: geo.featureSource,
        extractionMethod: geo.featureSource === 'step_topology' ? 'occ_cylindrical_face' : 'summary_expansion',
        manufacturingIntent: 'press_brake',
      };
    });
  }
}
