import { evaluate } from 'mathjs';
import type { CalculatorCandidate } from '../dto/candidate-set.dto';

/**
 * Executes a user-defined calculator against a process line's parameters.
 *
 * Maps field data_source declarations to runtime values:
 *   mhr              → machineRate (INR/hr)
 *   lhr              → labourRate  (INR/hr)
 *   processes        → setup_time_minutes → setupMin  |  cycle_time_minutes → cycleSec/60
 *   engineering_brief → geometry values from the part brief (volume, length, width, etc.)
 *
 * Non-DB fields fall back to their default_value if set.
 *
 * Returns the value of the formula marked is_primary_result, or null if
 * execution fails (so the resolver can fall back to its own formula).
 */
export interface BriefGeometry {
  volumeMm3: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  holeCount: number;
  holes: Array<{ diameter: number; depth: number | null }>;
  surfaceAreaMm2: number;
}

export function executeCalculator(
  calc: CalculatorCandidate,
  params: {
    machineRate: number;
    labourRate: number;
    setupMin: number;
    cycleSec: number;
    batchSize: number;
    heads: number;
    setupManning: number;
    partsPerCycle: number;
    scrapPct: number;
  },
  briefGeometry?: BriefGeometry,
): number | null {
  if (!calc.formulas.length) return null;

  const normalise = (s: string) =>
    s.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  // Build scope from the calculator's field declarations
  const scope: Record<string, number> = {};

  for (const field of calc.fields) {
    const key = normalise(field.fieldName);
    const ds = (field.dataSource ?? '').toLowerCase();
    const sf = (field.sourceField ?? '').toLowerCase();

    if (ds === 'mhr') {
      scope[key] = params.machineRate;
    } else if (ds === 'lhr') {
      scope[key] = params.labourRate;
    } else if (ds === 'processes') {
      if (sf.includes('setup')) {
        scope[key] = params.setupMin;
      } else if (sf.includes('cycle')) {
        scope[key] = params.cycleSec / 60; // formula expects minutes
      } else if (sf.includes('standard')) {
        scope[key] = params.cycleSec / 60;
      } else {
        scope[key] = parseFloatSafe(field.defaultValue);
      }
    } else if (ds === 'raw_materials') {
      // Raw material cost not applicable at process level; skip (leave 0)
      scope[key] = parseFloatSafe(field.defaultValue);
    } else if (ds === 'engineering_brief' && briefGeometry) {
      // Maps source_field dot-path to brief geometry values.
      // Supported source_field values: volume_mm3, length_mm, width_mm, height_mm,
      //   hole_count, surface_area_mm2
      const sfKey = (field.sourceField ?? '').toLowerCase().replace(/[\s.\-]/g, '_');
      const briefMap: Record<string, number> = {
        volume_mm3:      briefGeometry.volumeMm3,
        length_mm:       briefGeometry.lengthMm,
        width_mm:        briefGeometry.widthMm,
        height_mm:       briefGeometry.heightMm,
        hole_count:      briefGeometry.holeCount,
        surface_area_mm2: briefGeometry.surfaceAreaMm2,
      };
      scope[key] = briefMap[sfKey] ?? parseFloatSafe(field.defaultValue);
    } else {
      // manual / const / anything else: use default value
      scope[key] = parseFloatSafe(field.defaultValue);
    }
  }

  // Also inject standard aliases so common formula names work regardless of field labelling
  scope['machine_rate'] = scope['machine_rate'] ?? params.machineRate;
  scope['mhr'] = scope['mhr'] ?? params.machineRate;
  scope['labour_rate'] = scope['labour_rate'] ?? params.labourRate;
  scope['lhr'] = scope['lhr'] ?? params.labourRate;
  scope['setup_time'] = scope['setup_time'] ?? params.setupMin;
  scope['cycle_time'] = scope['cycle_time'] ?? params.cycleSec / 60;
  scope['batch_size'] = scope['batch_size'] ?? params.batchSize;
  scope['heads'] = scope['heads'] ?? params.heads;
  scope['setup_manning'] = scope['setup_manning'] ?? params.setupManning;
  scope['parts_per_cycle'] = scope['parts_per_cycle'] ?? params.partsPerCycle;
  scope['scrap_pct'] = scope['scrap_pct'] ?? params.scrapPct;

  // Custom functions to match the calculators service's IF/LN/LOG support
  (scope as any)['IF'] = (cond: boolean, t: number, f: number) => (cond ? t : f);

  // Run formulas in execution order
  let primaryResult: number | null = null;
  for (const formula of calc.formulas) {
    let expr = formula.formulaExpression.trim();
    if (expr.startsWith('=')) expr = expr.slice(1).trim();

    // Replace {fieldName} references
    expr = expr.replace(/\{([^}]+)\}/g, (_: string, name: string) => normalise(name));

    try {
      const result = evaluate(expr, scope);
      const num = typeof result === 'number' ? result : Number(result);
      if (Number.isFinite(num)) {
        // Store by index for backwards compat
        scope[`_f${calc.formulas.indexOf(formula)}`] = num;
        // Store by formulaName so multi-step formulas can chain (e.g. rpm → feed_rate → cycle_time)
        if (formula.formulaName) {
          scope[normalise(formula.formulaName)] = num;
        }
        if (formula.isPrimaryResult) {
          primaryResult = num;
        }
        // Last formula wins if none explicitly marked isPrimaryResult
        if (!calc.formulas.some((f) => f.isPrimaryResult)) {
          primaryResult = num;
        }
      }
    } catch {
      // Ignore individual formula failures; may still get a result from another
    }
  }

  return primaryResult !== null && primaryResult >= 0 ? primaryResult : null;
}

function parseFloatSafe(v: string | null | undefined): number {
  if (v == null) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
