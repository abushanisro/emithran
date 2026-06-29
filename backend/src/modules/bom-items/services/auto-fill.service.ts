import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { StepConverterService } from './step-converter.service';
import { SheetMetalFeatureExtractorService } from './sheet-metal-feature-extractor.service';
import { evaluate } from 'mathjs';
import axios from 'axios';
import * as path from 'path';
import {
  AutoFillResponseDto,
  AutoFillGeometryDto,
  AutoFillSuggestionsDto,
  AutoFillCostsDto,
  AutoFillConfidenceDto,
} from '../dto/auto-fill.dto';

export interface RawGeometry {
  volume: number;
  surfaceArea: number;
  boundingBox: { length: number; width: number; height: number };
  holeCount: number;
  pocketCount: number;
  thinWallCount: number;
  bendCount: number;
  cutLengthMm: number;
  sheetThicknessMm: number;
  pierceCount: number;
  flatPatternAreaMm2: number;
  holeDiameters: number[];
  holeGroups: Array<{ diameter_mm: number; count: number }>;
  bendRadii: number[];
  featureSource: 'step_topology' | 'mesh_inference';
}

interface ProcessSuggestion {
  processType: string;
  makeBuy: 'make' | 'buy';
  estimatedCycleTimeMin: number;
  processConfidence: number;
  itemType: 'assembly' | 'sub_assembly' | 'child_part';
}

@Injectable()
export class AutoFillService {
  private readonly logger = new Logger(AutoFillService.name);
  private readonly cadEngineUrl: string;
  private readonly cadEngineApiKey: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly stepConverterService: StepConverterService,
    private readonly sheetMetalExtractor: SheetMetalFeatureExtractorService,
  ) {
    this.cadEngineUrl = process.env.CAD_ENGINE_URL || 'http://localhost:5000';
    this.cadEngineApiKey = process.env.CAD_ENGINE_API_KEY || '';
  }

  async analyzeAndSuggest(
    fileBuffer: Buffer,
    fileName: string,
    userId: string,
    accessToken: string,
  ): Promise<AutoFillResponseDto> {
    let cadEngineAvailable = false;
    let rawGeometry: RawGeometry;
    let cadFamilyClassification: { family: string | null; confidence: number | null } = { family: null, confidence: null };
    let cadResult: any = null;

    // 1. Try CAD engine; fall back to STL bounding-box parse
    try {
      cadResult = await this.callCADEngineStateless(fileBuffer, fileName);
      cadEngineAvailable = true;
      rawGeometry = this.sanitizeGeometry(this.extractGeometryFromCADResult(cadResult));
      cadFamilyClassification = this.extractFamilyClassification(cadResult);
    } catch (e) {
      this.logger.warn(`CAD engine unavailable (${e.message})`);
      const ext = path.extname(fileName).toLowerCase();
      rawGeometry = ext === '.stl'
        ? this.sanitizeGeometry(this.extractGeometryFromSTLFallback(fileBuffer))
        : this.zeroGeometry();
    }

    // 2. Classify process + item type
    const processSuggestion = this.classifyProcess(rawGeometry);

    // 2b. TypeScript geometry rules are authoritative over Python family when structure signals sheet metal.
    let effectiveFamily = cadFamilyClassification;
    if (
      processSuggestion.processType.startsWith('Sheet Metal') &&
      cadFamilyClassification.family !== 'sheet_metal'
    ) {
      effectiveFamily = { family: 'sheet_metal', confidence: processSuggestion.processConfidence };
      this.logger.debug(
        `[classify] TypeScript overrides Python family: ${cadFamilyClassification.family ?? 'null'} → sheet_metal`,
      );
    }

    // 3. Lookup material
    const materialResult = await this.suggestMaterial(rawGeometry, processSuggestion.processType, userId, accessToken);

    // 4. Calculate weight (volume mm³ → cm³ × density g/cm³ → kg)
    const density = materialResult?.density ?? 2.7; // default aluminium density
    const weightKg = (rawGeometry.volume / 1000) * density / 1000;

    const geometry: AutoFillGeometryDto = {
      ...rawGeometry,
      weight: parseFloat(weightKg.toFixed(4)),
    };

    // 5. MHR lookup
    const mhrRate = await this.getMHR(processSuggestion.processType, accessToken);

    // 6. LSR/LHR lookup
    const lhrRate = await this.getLHR(accessToken);

    // 7. Calculator execution
    const costResult = await this.runMatchingCalculator(
      processSuggestion.processType,
      geometry,
      mhrRate,
      lhrRate,
      materialResult?.unitCost ?? null,
      userId,
      accessToken,
    );

    // 8. Build suggestions
    const suggestions: AutoFillSuggestionsDto = {
      name: this.inferName(fileName),
      partNumber: this.generatePartNumber(fileName),
      materialCategory: materialResult?.category ?? 'FERROUS_NON_FERROUS',
      materialGrade: materialResult?.grade ?? '',
      materialId: materialResult?.id ?? null,
      density: materialResult?.density ?? null,
      processType: processSuggestion.processType,
      familyClassification: effectiveFamily.family,
      familyConfidence: effectiveFamily.confidence,
      makeBuy: processSuggestion.makeBuy,
      itemType: processSuggestion.itemType,
    };

    const costs: AutoFillCostsDto = {
      materialCostPerKg: materialResult?.unitCost ?? null,
      mhrRate,
      lhrRate,
      estimatedCycleTimeMin: processSuggestion.estimatedCycleTimeMin,
      calculatorId: costResult.calculatorId,
      estimatedUnitCost: costResult.estimatedUnitCost,
    };

    // 9. Confidence
    const confidence = this.calculateConfidence(cadEngineAvailable, !!materialResult, processSuggestion, !!costResult.estimatedUnitCost);

    // 10. Feature Graph (Phase 1: count-level summary + process recommendations)
    const featureGraph = this.buildFeatureGraph(rawGeometry, processSuggestion, effectiveFamily, cadResult);

    return {
      fileName,
      geometry,
      suggestions,
      costs,
      confidence,
      cadEngineAvailable,
      featureGraph,
    };
  }

  private buildFeatureGraph(
    geo: RawGeometry,
    proc: ProcessSuggestion,
    family: { family: string | null; confidence: number | null },
    cadResult?: any,
  ): object {
    const signals: string[] = [];
    if (geo.sheetThicknessMm > 0) signals.push(`Uniform thickness ${geo.sheetThicknessMm} mm`);
    if (geo.bendCount > 0) signals.push(`${geo.bendCount} bends detected`);
    if (geo.flatPatternAreaMm2 > 0) signals.push('Flat pattern detected');
    if (geo.holeCount > 0) signals.push(`${geo.holeCount} holes detected`);

    const processMap: Record<string, string[]> = {
      'Sheet Metal Laser Cutting': ['Fiber Laser Cutting', 'CNC Press Brake', 'Deburring'],
      'Sheet Metal Bending':       ['Fiber Laser Cutting', 'CNC Press Brake', 'Deburring'],
      'Sheet Metal':               ['Fiber Laser Cutting', 'CNC Press Brake', 'Deburring'], // legacy safety net
      'CNC Machining':             ['CNC Milling', 'Drilling', 'Deburring'],
      'CNC Turning':               ['CNC Turning', 'Deburring'],
      'Die Casting':               ['Die Casting', 'Deburring', 'Inspection'],
      'Injection Moulding':        ['Injection Moulding', 'Inspection'],
      'Injection Molding':         ['Injection Moulding', 'Inspection'],
    };
    const processes = processMap[proc.processType] ?? ['Manufacturing'];
    const processRecommendations = processes.map((p, i) => ({
      sequence: i + 1,
      process: p,
      status: i === 0 ? 'recommended' : 'optional',
    }));

    // Phase 1 aggregate cost drivers — typed for formula routing in Phase 2
    type CostDriverType =
      | 'laser_time' | 'press_brake_hits' | 'pierce_count'
      | 'material_usage' | 'drill_time' | 'setup_time';
    interface CostDriver { name: string; unit: string; value: number; driverType: CostDriverType; quantity: number; }
    const costDrivers: CostDriver[] = [];
    if (geo.flatPatternAreaMm2 > 0) {
      costDrivers.push({ name: 'Material Usage', driverType: 'material_usage', quantity: geo.flatPatternAreaMm2, unit: 'mm²', value: geo.flatPatternAreaMm2 });
    }
    if (geo.cutLengthMm > 0) {
      costDrivers.push({ name: 'Laser Cut Length', driverType: 'laser_time', quantity: geo.cutLengthMm, unit: 'mm', value: geo.cutLengthMm });
    }
    if (geo.pierceCount > 0) {
      costDrivers.push({ name: 'Pierce Points', driverType: 'pierce_count', quantity: geo.pierceCount, unit: 'pcs', value: geo.pierceCount });
    }
    if (geo.bendCount > 0) {
      costDrivers.push({ name: 'Press Brake Hits', driverType: 'press_brake_hits', quantity: geo.bendCount, unit: 'hits', value: geo.bendCount });
    }
    if (geo.holeCount > 0) {
      costDrivers.push({ name: 'Drill Points', driverType: 'drill_time', quantity: geo.holeCount, unit: 'pcs', value: geo.holeCount });
    }

    const isSheetMetal = family.family === 'sheet_metal' || proc.processType.includes('Sheet Metal');

    const cadV2: any = cadResult
      ?.geometry_features
      ?.manufacturing_features
      ?.manufacturing_intelligence
      ?.features
      ?.feature_graph_v2 ?? null;
    const cncFeatures: any = (cadResult as any)?.cnc_features ?? null;

    // STL ordering verification: compare face_map triangle total to STL header count.
    // STL header count is logged by /convert-step as X-STL-Triangle-Count.
    // face_map_tri_total is logged here. If they match, face_map ordinals are valid.
    if (cadV2?.metadata?.face_map?.length) {
      const faceMapTriTotal = (cadV2.metadata.face_map as any[]).reduce(
        (sum: number, e: any) => sum + (e.tri_count ?? 0), 0
      );
      this.logger.log(
        `feature_graph_v2 face_map: ${cadV2.metadata.face_map.length} faces, ` +
        `${faceMapTriTotal} triangles [verify == X-STL-Triangle-Count from /convert-step]`
      );
    }

    return {
      extractedAt: new Date().toISOString(),
      classification: {
        family: family.family ?? 'cnc_milled',
        confidence: family.confidence ?? 0.65,
        signals,
      },
      features: isSheetMetal ? this.sheetMetalExtractor.extract(geo) : [],
      processRecommendations,
      summary: {
        bendCount:          geo.bendCount,
        cutLengthMm:        geo.cutLengthMm,
        holeCount:          geo.holeCount,
        sheetThicknessMm:   geo.sheetThicknessMm,
        slotCount:          0, // populated in Phase 2
        pierceCount:        geo.pierceCount,
        flatPatternAreaMm2: geo.flatPatternAreaMm2,
        costDrivers,
        holeDiameters:      geo.holeDiameters ?? [],
        holeGroups:         (geo.holeGroups ?? []).map((g) => ({
          ...g,
          id: `hole_d${g.diameter_mm.toFixed(1)}_c${g.count}`,
          geometry_refs: { faces: [], edges: [] },
        })),
        bendRadii:          geo.bendRadii ?? [],
      },
      dfmWarnings:            this.buildDFMWarnings(geo, proc, cadResult),
      validationResults:      this.buildValidationChecks(geo, proc, cadResult),
      manufacturabilityScore: this.extractManufacturabilityScore(cadResult),
      difficultyLevel:        this.deriveDifficultyLevel(geo, proc),
      feature_graph_version:  parseInt(process.env.FEATURE_GRAPH_VERSION ?? '4', 10),
      cad_engine_version:     process.env.CAD_ENGINE_VERSION ?? 'geo_v5',
      analyzed_at:            new Date().toISOString(),
      ...(cadV2 ? { feature_graph_v2: cadV2 } : {}),
      ...(cncFeatures ? { cnc_features: cncFeatures } : {}),
    };
  }

  private extractManufacturabilityScore(cadResult?: any): number | undefined {
    if (!cadResult) return undefined;
    const normalize = (raw: any): number | undefined => {
      const n = parseFloat(raw);
      if (!isFinite(n)) return undefined;
      // CAD engines may return 0–1 float or 0–100 int; treat ≤ 1 as float
      return n <= 1 ? Math.round(n * 100) : Math.round(n);
    };
    const mi = cadResult?.geometry_features?.manufacturing_features?.manufacturing_intelligence;
    const miScore = normalize(mi?.manufacturability_score);
    if (miScore != null) return miScore;
    const dfmScore = normalize(
      cadResult?.dfm_analysis?.manufacturability_score
        ?? cadResult?.geometry_features?.dfm_analysis?.manufacturability_score,
    );
    return dfmScore;
  }

  private deriveDifficultyLevel(
    geo: RawGeometry,
    proc: ProcessSuggestion,
  ): 'easy' | 'medium' | 'hard' | 'very_hard' {
    // STL mesh analysis overcounts holes (e.g. 448 for a simple bracket from tessellation artifacts)
    const effectiveHoleCount = geo.featureSource === 'mesh_inference' ? 0 : geo.holeCount;
    const complexity = effectiveHoleCount + geo.bendCount * 2 + geo.pocketCount;
    if (complexity < 5 && proc.processConfidence > 0.85) return 'easy';
    if (complexity < 15 && proc.processConfidence > 0.7) return 'medium';
    if (complexity < 30) return 'hard';
    return 'very_hard';
  }

  private mapSeverity(raw: any): 'critical' | 'warning' | 'info' {
    const s = String(raw ?? '').toLowerCase();
    if (s === 'critical' || s === 'error' || s === 'high') return 'critical';
    if (s === 'warning' || s === 'medium' || s === 'warn') return 'warning';
    return 'info';
  }

  private buildDFMWarnings(geo: RawGeometry, _proc: ProcessSuggestion, cadResult?: any): object[] {
    const warnings: object[] = [];
    let id = 0;

    const dfmAI = cadResult?.dfm_analysis?.ai_insights?.dfm_warnings
      ?? cadResult?.geometry_features?.dfm_analysis?.ai_insights?.dfm_warnings;
    if (Array.isArray(dfmAI)) {
      for (const w of dfmAI) {
        warnings.push({
          id: `dfm_ai_${id++}`,
          severity: this.mapSeverity(w.severity),
          category: 'general',
          message: String(w.message ?? w.warning ?? w),
          recommendation: String(w.recommendation ?? 'Review this feature before production.'),
        });
      }
    }

    if (geo.sheetThicknessMm > 0 && geo.sheetThicknessMm < 1.0) {
      warnings.push({
        id: `dfm_thin_wall_${id++}`,
        severity: 'warning',
        category: 'thin_wall',
        message: `Sheet thickness ${geo.sheetThicknessMm.toFixed(1)} mm may cause distortion during forming.`,
        recommendation: 'Increase to ≥ 1.0 mm for structural frames.',
      });
    }

    if (geo.sheetThicknessMm > 0 && geo.bendRadii.length > 0) {
      const minBendRadius = geo.sheetThicknessMm * 0.8;
      const smallestRadius = Math.min(...geo.bendRadii);
      if (smallestRadius < minBendRadius) {
        warnings.push({
          id: `dfm_bend_radius_${id++}`,
          severity: 'warning',
          category: 'sharp_corner',
          message: `Minimum bend radius ${smallestRadius.toFixed(1)} mm is below 0.8× thickness (${minBendRadius.toFixed(1)} mm).`,
          recommendation: `Increase bend radius to ≥ ${minBendRadius.toFixed(1)} mm to prevent cracking.`,
        });
      }
    }

    if (geo.sheetThicknessMm > 0 && warnings.length === 0) {
      warnings.push({
        id: `dfm_general_${id++}`,
        severity: 'info',
        category: 'general',
        message: 'Consider adding edge breaks (0.3 mm × 45°) to all laser-cut edges.',
        recommendation: 'Reduces injury risk during assembly and handling.',
      });
    }

    return warnings;
  }

  private buildValidationChecks(geo: RawGeometry, proc: ProcessSuggestion, cadResult?: any): object[] {
    const checks: object[] = [];
    const isSheetMetal = proc.processType.includes('Sheet Metal');

    if (geo.sheetThicknessMm > 0) {
      const minThickness = isSheetMetal ? 0.8 : 1.0;
      const passed = geo.sheetThicknessMm >= minThickness;
      checks.push({
        id: 'check_wall_thickness',
        check: 'Wall thickness adequate',
        passed,
        severity: passed ? 'info' : 'warning',
        actualValue: `${geo.sheetThicknessMm.toFixed(1)} mm`,
        threshold: `≥ ${minThickness} mm`,
        ...(passed ? {} : { recommendation: 'Increase wall thickness to prevent distortion.' }),
      });
    }

    if (geo.bendCount > 0 && geo.sheetThicknessMm > 0 && geo.bendRadii.length > 0) {
      const minBendRadius = geo.sheetThicknessMm * 0.8;
      const smallestRadius = Math.min(...geo.bendRadii);
      const passed = smallestRadius >= minBendRadius;
      checks.push({
        id: 'check_bend_radius',
        check: 'Bend radius adequate',
        passed,
        severity: passed ? 'info' : 'warning',
        actualValue: `${smallestRadius.toFixed(1)} mm`,
        threshold: `≥ ${minBendRadius.toFixed(1)} mm`,
        ...(passed ? {} : { recommendation: `Increase minimum bend radius to ${minBendRadius.toFixed(1)} mm.` }),
      });
    }

    // Only validate hole count from OCC topology — STL mesh artifacts produce false positives
    if (geo.holeCount > 0 && geo.featureSource === 'step_topology') {
      const passed = geo.holeCount < 200;
      checks.push({
        id: 'check_hole_count',
        check: 'Hole count in range',
        passed,
        severity: passed ? 'info' : 'warning',
        actualValue: String(geo.holeCount),
        threshold: '≤ 200',
        ...(passed ? {} : { recommendation: 'Consider splitting into sub-assemblies.' }),
      });
    }

    const score = this.extractManufacturabilityScore(cadResult);
    if (score != null) {
      const passed = score >= 60;
      checks.push({
        id: 'check_mfr_score',
        check: 'Manufacturability score',
        passed,
        severity: passed ? (score >= 80 ? 'info' : 'warning') : 'critical',
        actualValue: `${score}/100`,
        threshold: '≥ 60',
        ...(passed ? {} : { recommendation: 'Review DFM warnings and improve feature design.' }),
      });
    }

    return checks;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // CAD ENGINE (STATELESS)
  // ────────────────────────────────────────────────────────────────────────────

  private async callCADEngineStateless(fileBuffer: Buffer, fileName: string): Promise<any> {
    const ext = path.extname(fileName).toLowerCase().replace('.', '') || 'step';
    const contentTypeMap: Record<string, string> = {
      step: 'application/step',
      stp: 'application/step',
      iges: 'application/iges',
      igs: 'application/iges',
      stl: 'model/stl',
      obj: 'application/octet-stream',
    };

    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fileBuffer, {
      filename: `model.${ext}`,
      contentType: contentTypeMap[ext] ?? 'application/octet-stream',
    });
    form.append('strategy', 'balanced');
    form.append('bypass_format_check', 'true');

    const response = await axios.post(
      `${this.cadEngineUrl}/analyze/geometry`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          ...(this.cadEngineApiKey && { 'X-API-Key': this.cadEngineApiKey }),
        },
        timeout: 120_000,
        maxContentLength: 150 * 1024 * 1024,
      },
    );

    if (!response.data?.success) {
      throw new Error('CAD engine returned unsuccessful result');
    }
    return response.data;
  }

  private extractGeometryFromCADResult(cadResult: any): RawGeometry {
    const gf = cadResult?.geometry_features ?? {};
    const bbox = gf?.bounding_box ?? {};
    const mf = gf?.manufacturing_features ?? {};
    // Correct path: manufacturing_intelligence.features (only present for sheet_metal family)
    const smf = mf?.manufacturing_intelligence?.features ?? {};

    this.logger.debug(
      `[smf] family=${mf?.manufacturing_intelligence?.detected_family ?? 'n/a'} ` +
      `holes=${smf?.hole_count ?? 'null'} groups=${Array.isArray(smf?.hole_groups) ? smf.hole_groups.length : 0} ` +
      `bends=${smf?.bend_count ?? 'null'} thickness=${smf?.sheet_thickness_mm ?? 'null'} ` +
      `cut_length=${smf?.cut_length_mm ?? 'null'}`,
    );

    const safe = (v: any, fallback = 0): number => {
      const n = parseFloat(v);
      return isFinite(n) ? n : fallback;
    };

    return {
      volume: safe(gf.volume_mm3 ?? gf.estimated_volume_mm3, 0),
      surfaceArea: safe(gf.surface_area_mm2 ?? gf.surface_area_estimation, 0),
      boundingBox: {
        length: safe(bbox.length ?? bbox.x, 0),
        width: safe(bbox.width ?? bbox.y, 0),
        height: safe(bbox.height ?? bbox.z, 0),
      },
      holeCount: safe(smf?.hole_count ?? mf?.holes?.count ?? gf?.feature_detection?.holes_detected, 0),
      pocketCount: safe(mf?.pockets?.count, 0),
      thinWallCount: (mf?.thin_walls ?? 0) > 0 || gf?.feature_detection?.thin_walls ? 1 : 0,
      bendCount: safe(smf?.bend_count, 0),
      cutLengthMm: safe(smf?.cut_length_mm, 0),
      sheetThicknessMm: safe(smf?.sheet_thickness_mm, 0),
      pierceCount: safe(smf?.pierce_count, 0),
      flatPatternAreaMm2: safe(smf?.flat_pattern_area_mm2, 0),
      // Prefer SheetMetalExtractor full-per-hole list → OCC _detect_holes_real all_diameters → unique fallback
      holeDiameters: Array.isArray(smf?.hole_diameters_mm) && smf.hole_diameters_mm.length > 0
        ? smf.hole_diameters_mm
        : Array.isArray(mf?.holes?.all_diameters) && mf.holes.all_diameters.length > 0
          ? mf.holes.all_diameters
          : [],
      holeGroups: Array.isArray(smf?.hole_groups)
        ? (smf.hole_groups as Array<{ diameter_mm: number; count: number }>)
            .filter((g) => typeof g.diameter_mm === 'number' && g.diameter_mm > 0 && g.count > 0)
        : [],
      bendRadii: Array.isArray(smf?.bend_radii_mm) ? smf.bend_radii_mm : [],
      featureSource: smf?.hole_count != null ? 'step_topology' : 'mesh_inference',
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // FAMILY CLASSIFICATION EXTRACTION
  // ────────────────────────────────────────────────────────────────────────────

  private extractFamilyClassification(cadResult: any): { family: string | null; confidence: number | null } {
    try {
      const mi = cadResult?.geometry_features?.manufacturing_features?.manufacturing_intelligence;
      if (!mi || mi.error) return { family: null, confidence: null };
      const family = mi.detected_family ?? null;
      const rawConfidence = mi.family_confidence;
      const confidence = rawConfidence != null ? parseFloat(rawConfidence) : null;
      return {
        family: typeof family === 'string' ? family : null,
        confidence: confidence !== null && isFinite(confidence) ? confidence : null,
      };
    } catch {
      return { family: null, confidence: null };
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // STL BOUNDING-BOX FALLBACK
  // ────────────────────────────────────────────────────────────────────────────

  private extractGeometryFromSTLFallback(fileBuffer: Buffer): RawGeometry {
    let xmin = Infinity, xmax = -Infinity;
    let ymin = Infinity, ymax = -Infinity;
    let zmin = Infinity, zmax = -Infinity;
    let triangleCount = 0;

    try {
      const isBinary = fileBuffer.length > 84 &&
        !fileBuffer.subarray(0, 5).toString('ascii').toLowerCase().startsWith('solid ');
      if (isBinary) {
        triangleCount = fileBuffer.readUInt32LE(80);
        const max = Math.min(triangleCount, 200000);
        for (let i = 0; i < max; i++) {
          const base = 84 + i * 50 + 12;
          if (base + 36 > fileBuffer.length) break;
          for (let v = 0; v < 3; v++) {
            const vb = base + v * 12;
            const x = fileBuffer.readFloatLE(vb);
            const y = fileBuffer.readFloatLE(vb + 4);
            const z = fileBuffer.readFloatLE(vb + 8);
            if (isFinite(x) && isFinite(y) && isFinite(z)) {
              if (x < xmin) xmin = x; if (x > xmax) xmax = x;
              if (y < ymin) ymin = y; if (y > ymax) ymax = y;
              if (z < zmin) zmin = z; if (z > zmax) zmax = z;
            }
          }
        }
      }
    } catch (_) { /* ignore parse errors */ }

    if (!isFinite(xmin)) { xmin = 0; xmax = 20; ymin = 0; ymax = 40; zmin = 0; zmax = 5; }

    const dx = xmax - xmin;
    const dy = ymax - ymin;
    const dz = zmax - zmin;
    const safeTriangleCount = triangleCount || Math.max(1, Math.floor((fileBuffer.length - 84) / 50));

    return {
      volume: parseFloat((dx * dy * dz * 0.4).toFixed(2)),
      surfaceArea: parseFloat((safeTriangleCount * 0.001).toFixed(2)),
      boundingBox: {
        length: parseFloat(dx.toFixed(2)),
        width: parseFloat(dy.toFixed(2)),
        height: parseFloat(dz.toFixed(2)),
      },
      holeCount: safeTriangleCount > 2000 ? 3 : safeTriangleCount > 500 ? 2 : 1,
      pocketCount: safeTriangleCount > 1000 ? 2 : 1,
      thinWallCount: Math.min(dx, dy, dz) < 2.0 ? 3 : 0,
      bendCount: 0,
      cutLengthMm: 0,
      sheetThicknessMm: 0,
      pierceCount: 0,
      flatPatternAreaMm2: 0,
      holeDiameters: [],
      holeGroups: [],
      bendRadii: [],
      featureSource: 'mesh_inference',
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // PROCESS CLASSIFICATION  (industry-standard geometry rules)
  // ────────────────────────────────────────────────────────────────────────────

  private classifyProcess(geo: RawGeometry): ProcessSuggestion {
    const { volume, boundingBox, holeCount, pocketCount, thinWallCount } = geo;
    const { length, width, height } = boundingBox;
    const minDim = Math.min(length, width, height);
    const maxDim = Math.max(length, width, height);
    const aspectRatio = maxDim / (minDim || 1);
    const volumeCm3 = volume / 1000;
    const complexityScore = holeCount + pocketCount * 2 + thinWallCount;

    // STRONGEST SIGNAL: CAD engine found sheet thickness via OCC antiparallel face-pair analysis.
    // Non-zero only when SheetMetalFeatureExtractor ran successfully on a flat/formed part.
    if (geo.sheetThicknessMm > 0) {
      const processType = geo.bendCount > 0 ? 'Sheet Metal Bending' : 'Sheet Metal Laser Cutting';
      return {
        processType,
        makeBuy: 'make',
        estimatedCycleTimeMin: 15,
        processConfidence: 0.88,
        itemType: 'child_part',
      };
    }

    // Fill ratio: actual volume vs bounding-box volume.
    // Sheet metal frames/enclosures are hollow — very low fill ratio (<12%).
    // Solid machined blocks are dense (>30%).
    const bbVolume = length * width * height;
    const fillRatio = bbVolume > 0 ? volume / bbVolume : 1;

    // Geometry fallback: thin flat sheet OR hollow formed frame/enclosure.
    // Fix: was returning 'Sheet Metal' which has no processMap entry → '1. Manufacturing' bug.
    if (
      (minDim < 8 && aspectRatio > 5) ||
      (fillRatio < 0.12 && aspectRatio > 3 && volumeCm3 < 5000)
    ) {
      const processType = (minDim < 8 && geo.bendCount === 0) ? 'Sheet Metal Laser Cutting' : 'Sheet Metal Bending';
      return {
        processType,
        makeBuy: 'make',
        estimatedCycleTimeMin: 15,
        processConfidence: 0.8,
        itemType: 'child_part',
      };
    }

    // Die Casting: large volume + complex geometry
    if (volumeCm3 > 500 && complexityScore > 7) {
      return {
        processType: 'Die Casting',
        makeBuy: 'make',
        estimatedCycleTimeMin: 120,
        processConfidence: 0.75,
        itemType: volumeCm3 > 5000 ? 'assembly' : 'sub_assembly',
      };
    }

    // Injection Molding: multiple thin walls + modest volume
    if (thinWallCount > 2 && volumeCm3 < 200) {
      return {
        processType: 'Injection Molding',
        makeBuy: 'make',
        estimatedCycleTimeMin: 45,
        processConfidence: 0.7,
        itemType: 'child_part',
      };
    }

    // Large assembly with many features
    if (volumeCm3 > 10000 || (holeCount > 10 && pocketCount > 5)) {
      return {
        processType: 'CNC Machining',
        makeBuy: 'make',
        estimatedCycleTimeMin: 180,
        processConfidence: 0.65,
        itemType: 'assembly',
      };
    }

    // Default: CNC Machining
    return {
      processType: 'CNC Machining',
      makeBuy: 'make',
      estimatedCycleTimeMin: 60,
      processConfidence: 0.6,
      itemType: 'child_part',
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // MATERIAL LOOKUP
  // ────────────────────────────────────────────────────────────────────────────

  private async suggestMaterial(
    geo: RawGeometry,
    processType: string,
    userId: string,
    accessToken: string,
  ): Promise<{ id: string; grade: string; density: number; unitCost: number; category: string } | null> {
    try {
      const client = this.supabaseService.getClient(accessToken);
      const isPlastic = processType === 'Injection Molding';

      const { data, error } = await client
        .from('raw_materials')
        .select('id, material, material_grade, density, cost, material_group')
        .ilike('material_group', isPlastic ? '%Plastic%' : '%Ferrous%')
        .not('density', 'is', null)
        .order('density', { ascending: true })
        .limit(10);

      if (error || !data?.length) return null;

      // Filter to physically plausible densities (g/cm³), then take the median
      const valid = data.filter((r: any) => {
        const d = parseFloat(r.density);
        return isFinite(d) && d >= (isPlastic ? 0.5 : 1.5) && d <= 22;
      });
      if (!valid.length) return null;
      const sorted = [...valid].sort((a: any, b: any) => (a.density ?? 0) - (b.density ?? 0));
      const best: any = sorted[Math.floor(sorted.length / 2)];

      return {
        id: best.id,
        grade: best.material_grade ?? best.material ?? '',
        density: parseFloat(best.density) || 2.7,
        unitCost: parseFloat(best.cost) || 0,
        category: (best.material_group ?? '').toLowerCase().includes('plastic') ? 'PLASTIC_RUBBER' : 'FERROUS_NON_FERROUS',
      };
    } catch (e) {
      this.logger.warn(`Material lookup failed: ${e.message}`);
      return null;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // MHR LOOKUP
  // ────────────────────────────────────────────────────────────────────────────

  private async getMHR(processType: string, accessToken: string): Promise<number | null> {
    try {
      const client = this.supabaseService.getClient(accessToken);
      const keyword = processType.split(' ')[0].toLowerCase(); // e.g. 'cnc', 'sheet', 'die'

      const { data, error } = await client
        .from('mhr')
        .select('final_mhr, machine_name, machine_description, commodity_code')
        .or(`machine_description.ilike.%${keyword}%,commodity_code.ilike.%${keyword}%,machine_name.ilike.%${keyword}%`)
        .not('final_mhr', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error || !data?.length) {
        // Fallback: return any recent MHR record
        const { data: fallback } = await client
          .from('mhr')
          .select('final_mhr')
          .not('final_mhr', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1);
        return fallback?.[0]?.final_mhr ? parseFloat(fallback[0].final_mhr) : null;
      }

      return parseFloat(data[0].final_mhr);
    } catch (e) {
      this.logger.warn(`MHR lookup failed: ${e.message}`);
      return null;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // LHR / LSR LOOKUP
  // ────────────────────────────────────────────────────────────────────────────

  private async getLHR(accessToken: string): Promise<number | null> {
    try {
      const client = this.supabaseService.getClient(accessToken);
      const { data, error } = await client
        .from('lsr')
        .select('lhr')
        .not('lhr', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error || !data?.length) return null;
      return parseFloat(data[0].lhr);
    } catch (e) {
      this.logger.warn(`LHR lookup failed: ${e.message}`);
      return null;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // CALCULATOR EXECUTION
  // ────────────────────────────────────────────────────────────────────────────

  private async runMatchingCalculator(
    processType: string,
    geometry: AutoFillGeometryDto,
    mhrRate: number | null,
    lhrRate: number | null,
    materialCostPerKg: number | null,
    userId: string,
    accessToken: string,
  ): Promise<{ calculatorId: string | null; estimatedUnitCost: number | null }> {
    try {
      const client = this.supabaseService.getClient(accessToken);
      const keyword = processType.toLowerCase();

      const { data, error } = await client
        .from('calculators')
        .select('id, name, calc_category, fields:calculator_fields(*), formulas:calculator_formulas(*)')
        .eq('user_id', userId)
        .or(`name.ilike.%${keyword}%,calc_category.ilike.%${keyword}%`)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error || !data?.length) return { calculatorId: null, estimatedUnitCost: null };

      const calculator: any = data[0];
      const fields: any[] = calculator.fields ?? [];
      const formulas: any[] = calculator.formulas ?? [];

      // Build input scope from geometry + rates
      const normalizeKey = (s: string) => s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

      const geoInputs: Record<string, number> = {
        volume: geometry.volume,
        volume_mm3: geometry.volume,
        surface_area: geometry.surfaceArea,
        surface_area_mm2: geometry.surfaceArea,
        weight: geometry.weight,
        part_weight: geometry.weight,
        weight_kg: geometry.weight,
        max_length: geometry.boundingBox.length,
        max_width: geometry.boundingBox.width,
        max_height: geometry.boundingBox.height,
        ...(mhrRate !== null ? { mhr: mhrRate, machine_hour_rate: mhrRate, machine_rate: mhrRate } : {}),
        ...(lhrRate !== null ? { lhr: lhrRate, labor_hour_rate: lhrRate, labour_hour_rate: lhrRate } : {}),
        ...(materialCostPerKg !== null ? { material_cost: materialCostPerKg, cost_per_kg: materialCostPerKg, material_cost_per_kg: materialCostPerKg } : {}),
      };

      const scope: Record<string, number> = {};

      // Seed scope with all input fields (use default_value or geo inputs)
      for (const field of fields) {
        if (field.field_type === 'input') {
          const key = normalizeKey(field.field_name);
          scope[key] = geoInputs[key] ?? (parseFloat(field.default_value) || 0);
        }
      }

      // Also seed by matching field names against geo input keys
      for (const field of fields) {
        const key = normalizeKey(field.field_name);
        if (geoInputs[key] !== undefined) {
          scope[key] = geoInputs[key];
        }
      }

      let lastCalculatedResult: number | null = null;

      // Execute calculated fields in display_order
      const calcFields = fields
        .filter((f: any) => f.field_type === 'calculated' && f.default_value)
        .sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0));

      for (const field of calcFields) {
        try {
          let expr: string = field.default_value.trim().replace(/^=/, '');
          // Replace {fieldName} tokens
          expr = expr.replace(/\{([^}]+)\}/g, (_: string, name: string) => normalizeKey(name));
          const result = evaluate(expr, scope);
          if (typeof result === 'number' && isFinite(result)) {
            scope[normalizeKey(field.field_name)] = result;
            lastCalculatedResult = result;
          }
        } catch (_) { /* skip formula errors */ }
      }

      // Execute formulas in execution_order
      const sortedFormulas = [...formulas].sort((a: any, b: any) => (a.execution_order ?? 0) - (b.execution_order ?? 0));
      for (const formula of sortedFormulas) {
        try {
          let expr: string = (formula.formula_expression ?? '').trim().replace(/^=/, '');
          if (!expr) continue;
          expr = expr.replace(/\{([^}]+)\}/g, (_: string, name: string) => normalizeKey(name));
          const result = evaluate(expr, scope);
          if (typeof result === 'number' && isFinite(result)) {
            if (formula.formula_name) scope[normalizeKey(formula.formula_name)] = result;
            lastCalculatedResult = result;
          }
        } catch (_) { /* skip formula errors */ }
      }

      return {
        calculatorId: calculator.id,
        estimatedUnitCost: lastCalculatedResult !== null ? parseFloat(lastCalculatedResult.toFixed(4)) : null,
      };
    } catch (e) {
      this.logger.warn(`Calculator execution failed: ${e.message}`);
      return { calculatorId: null, estimatedUnitCost: null };
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ────────────────────────────────────────────────────────────────────────────

  private zeroGeometry(): RawGeometry {
    return {
      volume: 0, surfaceArea: 0,
      boundingBox: { length: 0, width: 0, height: 0 },
      holeCount: 0, pocketCount: 0, thinWallCount: 0,
      bendCount: 0, cutLengthMm: 0,
      sheetThicknessMm: 0, pierceCount: 0, flatPatternAreaMm2: 0,
      holeDiameters: [], holeGroups: [], bendRadii: [],
      featureSource: 'mesh_inference',
    };
  }

  private sanitizeGeometry(geo: RawGeometry): RawGeometry {
    const clamp = (v: number, max: number): number =>
      Number.isFinite(v) && v >= 0 && v <= max ? v : 0;
    return {
      volume:        clamp(geo.volume, 1e10),
      surfaceArea:   clamp(geo.surfaceArea, 1e8),
      boundingBox: {
        length: clamp(geo.boundingBox.length, 10_000),
        width:  clamp(geo.boundingBox.width,  10_000),
        height: clamp(geo.boundingBox.height, 10_000),
      },
      holeCount:        Math.min(Math.max(0, geo.holeCount        ?? 0), 1000),
      pocketCount:      Math.min(Math.max(0, geo.pocketCount      ?? 0), 500),
      thinWallCount:    Math.min(Math.max(0, geo.thinWallCount    ?? 0), 100),
      bendCount:        Math.min(Math.max(0, geo.bendCount        ?? 0), 100),
      cutLengthMm:      clamp(geo.cutLengthMm, 100_000),
      sheetThicknessMm: clamp(geo.sheetThicknessMm, 50),
      pierceCount:      Math.min(Math.max(0, geo.pierceCount      ?? 0), 500),
      flatPatternAreaMm2: clamp(geo.flatPatternAreaMm2, 1e7),
      holeDiameters: Array.isArray(geo.holeDiameters) ? geo.holeDiameters : [],
      holeGroups:    Array.isArray(geo.holeGroups)    ? geo.holeGroups    : [],
      bendRadii:     Array.isArray(geo.bendRadii)     ? geo.bendRadii     : [],
      featureSource: geo.featureSource ?? 'mesh_inference',
    };
  }

  private inferName(fileName: string): string {
    const base = path.basename(fileName, path.extname(fileName));
    return base
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }

  private generatePartNumber(fileName: string): string {
    const base = path.basename(fileName, path.extname(fileName))
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 12);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(Math.random() * 900 + 100);
    return `${base}-${date}-${rand}`;
  }

  private calculateConfidence(
    cadEngineAvailable: boolean,
    materialFound: boolean,
    process: ProcessSuggestion,
    costCalculated: boolean,
  ): AutoFillConfidenceDto {
    const geometry = cadEngineAvailable ? 0.9 : 0.5;
    const material = materialFound ? 0.8 : 0.3;
    const proc = process.processConfidence;
    const cost = costCalculated ? 0.75 : 0.2;
    const overall = parseFloat(((geometry + material + proc + cost) / 4).toFixed(2));
    return { overall, geometry, material, process: proc, cost };
  }
}
