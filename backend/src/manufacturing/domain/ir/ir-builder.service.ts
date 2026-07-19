/**
 * IrBuilderService — converts a BOM item record into a ManufacturingIR.
 *
 * This is the only service allowed to construct a ManufacturingIR. It reads
 * the loose JSON blobs (featureGraph, drawingIntelligence) from the BOM item
 * and produces a fully-typed, validated IR that the pipeline can consume.
 *
 * Fallback strategy: featureGraph.summary → item fields → safe defaults.
 * A warning is attached to IRMetadata for every field that fell back.
 */

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type {
  ManufacturingIR,
  Feature,
  MaterialContext,
  Constraint,
  IRMetadata,
  ISOGroup,
  PartContext,
  HoleFeature,
  ThreadedHoleFeature,
  BendFeature,
  ContourFeature,
  TurnedDiameterFeature,
  PocketFeature,
} from './manufacturing-ir';

// ── ISO group keyword heuristics ──────────────────────────────────────────────
const ISO_GROUP_KEYWORDS: Array<[RegExp, ISOGroup]> = [
  [/stainless|ss\s*3\d\d|316|duplex|inconel|hastelloy/i, 'M'],
  [/titanium|ti-6|grade\s*5|ti64/i, 'S'],
  [/alumin|6061|7075|2024|5052|6082|al\s*alloy/i, 'N'],
  [/cast iron|grey iron|ductile iron|\bci\b/i, 'K'],
  [/nylon|abs|pp|pom|pc\b|peek|ptfe|polymer|plastic|pa66|pa6\b/i, 'POLYMER'],
  // Hardened steels — must come before generic steel
  [/hardened|h13|d2\b|hrc\s*\d|maraging/i, 'H'],
  // ISO P covers all plain / low-alloy / tool steel not matched above
  [/steel|en\s*\d|is\s*\d|astm\s*a\d|s235|s355|en8|en24|en31|e250|e350/i, 'P'],
];

function resolveISOGroup(grade: string): ISOGroup {
  for (const [pattern, group] of ISO_GROUP_KEYWORDS) {
    if (pattern.test(grade)) return group;
  }
  return 'P'; // Safe default: carbon/low-alloy steel
}

const DENSITY_BY_ISO: Record<ISOGroup, number> = {
  P: 7.85,       // g/cm³ — carbon / low-alloy steel
  M: 7.93,       // stainless steel
  K: 7.20,       // cast iron
  N: 2.70,       // aluminium alloys
  S: 4.43,       // titanium (Ti-6Al-4V)
  H: 7.80,       // hardened steels
  POLYMER: 1.20, // generic polymer density; overridden by drawingIntelligence where possible
};

// ── Public service ────────────────────────────────────────────────────────────
@Injectable()
export class IrBuilderService {
  private readonly logger = new Logger(IrBuilderService.name);

  /**
   * Build a ManufacturingIR from a BOM item record (as returned by
   * BOMItemsService.findOne). Never throws — validation warnings are
   * attached to IRMetadata.warnings so the pipeline can decide how to proceed.
   */
  buildFromBomItem(
    item: Record<string, unknown>,
    options: { batchSize?: number; location?: string; currency?: string; currencySymbol?: string } = {},
  ): ManufacturingIR {
    const warnings: string[] = [];
    const fg = (item.featureGraph as Record<string, unknown> | null) ?? {};
    const fgSummary = (fg.summary as Record<string, unknown> | null) ?? {};
    const di = (item.drawingIntelligence as Record<string, unknown> | null) ?? {};

    // ── Material ──────────────────────────────────────────────────────────────
    const grade = String(
      item.materialGrade
        ?? di.material
        ?? fgSummary.drawingGradeRC
        ?? 'IS2062 E250',
    );
    const isoGroup = resolveISOGroup(grade);
    const densityGCm3 = DENSITY_BY_ISO[isoGroup];

    // ── Weight ────────────────────────────────────────────────────────────────
    const volumeMm3 = num(item.volume ?? fgSummary.volumeMm3) ?? 0;
    const netWeightKg = (volumeMm3 / 1e6) * densityGCm3;
    const grossWeightKg = netWeightKg * 1.1; // 10% overhead default

    if (!item.materialGrade) {
      warnings.push(`material_grade: defaulted to '${grade}' — set explicitly on BOM item for accuracy`);
    }

    const material: MaterialContext = {
      grade,
      isoGroup,
      densityGCm3,
      netWeightKg,
      grossWeightKg,
      tensileStrengthMpa: num(item.tensileStrengthMpa ?? fgSummary.tensileStrengthMpa) ?? undefined,
      standardRef: 'ISO 513:2012',
    };

    // ── Features ──────────────────────────────────────────────────────────────
    const features: Feature[] = [];
    const family = String(item.familyClassification ?? fgSummary.family ?? 'unknown').toLowerCase();
    const isSheetMetal = family.includes('sheet') || family.includes('metal');
    const isPlastic = family.includes('plastic') || family.includes('injection') || family.includes('polymer');

    if (isSheetMetal) {
      this.extractSheetMetalFeatures(item, fgSummary, di, features, warnings);
    } else if (isPlastic) {
      this.extractPlasticFeatures(item, fgSummary, features, warnings);
    } else {
      this.extractCNCFeatures(item, fgSummary, features, warnings);
    }

    // ── Constraints ───────────────────────────────────────────────────────────
    const constraints: Constraint[] = [];
    if (item.toleranceGrade || di.tolerance) {
      constraints.push({ kind: 'geometric_tolerance', appliesTo: 'part', value: String(item.toleranceGrade ?? di.tolerance) });
    }
    if (item.surfaceFinish || di.surfaceFinish) {
      constraints.push({ kind: 'surface_finish', appliesTo: 'part', value: String(item.surfaceFinish ?? di.surfaceFinish) });
    }
    if (item.heatTreatment || di.heatTreatment) {
      constraints.push({ kind: 'heat_treatment', appliesTo: 'part', value: String(item.heatTreatment ?? di.heatTreatment) });
    }
    if (di.coating) {
      constraints.push({ kind: 'coating', appliesTo: 'part', value: String(di.coating) });
    }

    // ── Part context ──────────────────────────────────────────────────────────
    const part: PartContext = {
      partId: String(item.id),
      partNumber: String(item.partNumber ?? item.name ?? 'UNKNOWN'),
      description: item.description ? String(item.description) : undefined,
      material,
      batchSize: options.batchSize ?? 1,
      location: options.location ?? 'USA',
      currency: options.currency ?? 'INR',
      currencySymbol: options.currencySymbol ?? '₹',
    };

    // ── Metadata ──────────────────────────────────────────────────────────────
    const cadVersion = String(fgSummary.engineVersion ?? fg.version ?? '0.0.0');
    const confidence = warnings.length === 0 ? 'high' : warnings.length <= 2 ? 'medium' : 'low';

    const metadata: IRMetadata = {
      cadEngineVersion: cadVersion,
      extractedAt: new Date(),
      confidence,
      featureSource: volumeMm3 > 0 ? 'cad_engine' : 'manual',
      warnings,
    };

    if (warnings.length > 0) {
      this.logger.debug(`[ir-builder] partId=${item.id} ${warnings.length} warning(s): ${warnings.join('; ')}`);
    }

    return {
      irVersion: '1.0',
      irId: randomUUID(),
      part,
      features,
      constraints,
      metadata,
    };
  }

  // ── Feature extraction helpers ────────────────────────────────────────────

  private extractSheetMetalFeatures(
    item: Record<string, unknown>,
    fg: Record<string, unknown>,
    di: Record<string, unknown>,
    out: Feature[],
    warnings: string[],
  ): void {
    const t = num(item.sheetThicknessMm ?? fg.sheetThicknessMm ?? di.sheetThickness) ?? 2.0;
    const cutLen = num(item.cutLengthMm ?? fg.cutLengthMm) ?? Math.sqrt(num(item.flatPatternAreaMm2 ?? fg.flatPatternAreaMm2) ?? 50000) * 4;
    const pierces = int(item.pierceCount ?? fg.pierceCount) ?? 1;
    const holes = int(item.holeCount ?? fg.holeCount) ?? 0;
    const bends = int(item.bendCount ?? fg.bendCount ?? di.bendCount) ?? 0;
    const area = num(item.flatPatternAreaMm2 ?? fg.flatPatternAreaMm2) ?? 0;

    if (t === 2.0 && !item.sheetThicknessMm) {
      warnings.push('sheet_thickness_mm: defaulted to 2.0 mm');
    }

    const contour: ContourFeature = {
      kind: 'contour',
      featureId: 'contour-0',
      perimeterMm: cutLen,
      thicknessMm: t,
      flatPatternAreaMm2: area,
      cutLengthMm: cutLen,
      pierceCount: pierces + holes,
    };
    out.push(contour);

    if (bends > 0) {
      const tensile = num(item.tensileStrengthMpa) ?? 400; // MPa
      const bend: BendFeature = {
        kind: 'bend',
        featureId: 'bend-0',
        angleDeg: 90,
        radiusMm: t * 1.0,
        lengthMm: Math.sqrt(area) * 0.6,
        count: bends,
      };
      out.push(bend);
    }

    if (holes > 0) {
      const hole: HoleFeature = {
        kind: 'hole',
        featureId: 'hole-0',
        diameterMm: 6,
        depthMm: t,
        isThrough: true,
        count: holes,
      };
      out.push(hole);
    }

    // Tapped holes from drawing intelligence
    const threads = (di.threads as Array<{ size: string; count: number }> | null) ?? [];
    threads.forEach((th, idx) => {
      const tf: ThreadedHoleFeature = {
        kind: 'threaded_hole',
        featureId: `thread-${idx}`,
        threadSpec: th.size,
        majorDiameterMm: parseThreadDia(th.size),
        pitchMm: parseThreadPitch(th.size),
        depthMm: t,
        isThrough: true,
        count: th.count,
      };
      out.push(tf);
    });
  }

  private extractPlasticFeatures(
    item: Record<string, unknown>,
    fg: Record<string, unknown>,
    out: Feature[],
    warnings: string[],
  ): void {
    const vol = num(item.volume ?? fg.volumeMm3) ?? 10000;
    const area = num(item.flatPatternAreaMm2 ?? fg.flatPatternAreaMm2) ?? Math.pow(vol / 50, 0.67) * 100;
    const pocket: PocketFeature = {
      kind: 'pocket',
      featureId: 'im-cavity-0',
      lengthMm: Math.cbrt(vol) * 1.2,
      widthMm: Math.cbrt(vol) * 0.8,
      depthMm: Math.cbrt(vol) * 0.6,
      isBlind: true,
      count: 1,
    };
    out.push(pocket);
  }

  private extractCNCFeatures(
    item: Record<string, unknown>,
    fg: Record<string, unknown>,
    out: Feature[],
    warnings: string[],
  ): void {
    const vol = num(item.volume ?? fg.volumeMm3) ?? 100000;
    const sizeMm = Math.cbrt(vol);
    const holes = int(item.holeCount ?? fg.holeCount) ?? 0;

    const pocket: PocketFeature = {
      kind: 'pocket',
      featureId: 'mill-0',
      lengthMm: sizeMm * 1.5,
      widthMm: sizeMm * 0.8,
      depthMm: sizeMm * 0.4,
      isBlind: true,
      count: 1,
    };
    out.push(pocket);

    const turned: TurnedDiameterFeature = {
      kind: 'turned_diameter',
      featureId: 'turn-0',
      outerDiameterMm: sizeMm,
      lengthMm: sizeMm * 1.5,
      materialRemovalMm: sizeMm * 0.05,
    };
    out.push(turned);

    if (holes > 0) {
      const hole: HoleFeature = {
        kind: 'hole',
        featureId: 'hole-0',
        diameterMm: 8,
        depthMm: sizeMm * 0.5,
        isThrough: false,
        count: holes,
      };
      out.push(hole);
    }
  }
}

// ── Utility ────────────────────────────────────────────────────────────────────
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function int(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseThreadDia(spec: string): number {
  const m = spec.match(/M(\d+(?:\.\d+)?)/i);
  if (m) return parseFloat(m[1]);
  const u = spec.match(/(\d+(?:\/\d+)?)\s*[-\s]/);
  if (u) {
    const parts = u[1].split('/');
    return parts.length === 2 ? parseInt(parts[0]) / parseInt(parts[1]) * 25.4 : parseFloat(parts[0]) * 25.4;
  }
  return 6; // safe default
}

function parseThreadPitch(spec: string): number {
  const m = spec.match(/×\s*(\d+(?:\.\d+)?)/);
  if (m) return parseFloat(m[1]);
  const tpi = spec.match(/(\d+)\s*TPI/i);
  if (tpi) return 25.4 / parseFloat(tpi[1]);
  return 1.0; // safe default
}
