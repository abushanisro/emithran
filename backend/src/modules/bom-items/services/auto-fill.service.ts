import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { StepConverterService } from './step-converter.service';
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

interface RawGeometry {
  volume: number;
  surfaceArea: number;
  boundingBox: { length: number; width: number; height: number };
  holeCount: number;
  pocketCount: number;
  thinWallCount: number;
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

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly stepConverterService: StepConverterService,
  ) {
    this.cadEngineUrl = process.env.CAD_ENGINE_URL || 'http://localhost:5000';
  }

  async analyzeAndSuggest(
    fileBuffer: Buffer,
    fileName: string,
    userId: string,
    accessToken: string,
  ): Promise<AutoFillResponseDto> {
    let cadEngineAvailable = false;
    let rawGeometry: RawGeometry;

    // 1. Try CAD engine; fall back to STL bounding-box parse
    try {
      const cadResult = await this.callCADEngineStateless(fileBuffer, fileName);
      cadEngineAvailable = true;
      rawGeometry = this.extractGeometryFromCADResult(cadResult);
    } catch (e) {
      this.logger.warn(`CAD engine unavailable (${e.message}), using bounding-box fallback`);
      rawGeometry = this.extractGeometryFromSTLFallback(fileBuffer);
    }

    // 2. Classify process + item type
    const processSuggestion = this.classifyProcess(rawGeometry);

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

    return {
      fileName,
      geometry,
      suggestions,
      costs,
      confidence,
      cadEngineAvailable,
    };
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
    form.append('force_reanalysis', 'false');
    form.append('bypass_format_check', 'true');

    const response = await axios.post(
      `${this.cadEngineUrl}/analyze/geometry`,
      form,
      {
        headers: form.getHeaders(),
        timeout: 30000,
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

    const safe = (v: any, fallback = 0): number => {
      const n = parseFloat(v);
      return isFinite(n) ? n : fallback;
    };

    return {
      volume: safe(gf.estimated_volume_mm3, 1000),
      surfaceArea: safe(gf.surface_area_estimation ?? gf.surface_area_mm2, 100),
      boundingBox: {
        length: safe(bbox.length ?? bbox.x, 10),
        width: safe(bbox.width ?? bbox.y, 10),
        height: safe(bbox.height ?? bbox.z, 5),
      },
      holeCount: safe(mf?.holes?.count ?? gf?.feature_detection?.holes_detected, 0),
      pocketCount: safe(mf?.pockets?.count, 0),
      thinWallCount: (mf?.thin_walls ?? 0) > 0 || gf?.feature_detection?.thin_walls ? 1 : 0,
    };
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

    // Sheet Metal: flat profile (one dim very thin) + high aspect ratio
    if (minDim < 4 && aspectRatio > 6) {
      return {
        processType: 'Sheet Metal',
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
        .select('id, material, material_grade, density, unit_cost, material_group, material_category')
        .ilike('material_group', isPlastic ? '%Plastic%' : '%Ferrous%')
        .order('density', { ascending: true })
        .limit(10);

      if (error || !data?.length) return null;

      const volumeCm3 = geo.volume / 1000;
      // Pick material whose density-based weight estimate is most "reasonable"
      // (we want median density for the detected geometry volume range)
      const sorted = [...data].sort((a: any, b: any) => Math.abs((a.density ?? 2.7) - 2.7) - Math.abs((b.density ?? 2.7) - 2.7));
      const best: any = sorted[0];

      return {
        id: best.id,
        grade: best.material_grade ?? best.material ?? '',
        density: parseFloat(best.density) || 2.7,
        unitCost: parseFloat(best.unit_cost) || 0,
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
