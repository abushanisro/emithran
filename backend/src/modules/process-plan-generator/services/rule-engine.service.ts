import { Injectable } from '@nestjs/common';

import type { ManufacturingFeatureGraph, MandatoryOp } from '../dto/manufacturing-feature.dto';
import type { BriefBomItem } from '../dto/engineering-brief.dto';

/**
 * Rule Engine — converts a ManufacturingFeatureGraph into a MandatoryOp list.
 *
 * These are manufacturing rules that must always fire regardless of AI judgment:
 *   hole → drilling
 *   internal thread → tapping
 *   anodize/plate → surface treatment op
 *   grinding → if Ra ≤ 0.8μm
 *   deburring → always after machining
 *   inspection → always last
 *
 * No AI, no network calls, no randomness. Same input → same output every run.
 */
@Injectable()
export class RuleEngineService {
  evaluate(
    graph: ManufacturingFeatureGraph,
    bomItem?: Pick<BriefBomItem, 'tightestToleranceMm' | 'coating'>,
    drawingNotes?: string,
    family?: string,
  ): MandatoryOp[] {
    const mandatory: MandatoryOp[] = [];
    // Hole-making and tapping run on the mill for milled parts, on the lathe otherwise
    const holeMachine: MandatoryOp['machineCategoryHint'] =
      family === 'cnc_milled' ? 'cnc_mill' : 'cnc_lathe';

    for (const f of graph.features) {
      switch (f.type) {
        case 'SAW_CUT':
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 10,
            operationHint: 'Sawing / Stock Cut',
            reason: 'Bar/billet stock requires saw cut before first machining op',
            confidence: f.confidence,
            machineCategoryHint: 'saw',
          });
          break;

        case 'CROSS_HOLE':
        case 'AXIAL_HOLE': {
          const diamStr = f.diameter != null ? `Ø${f.diameter}mm` : 'Ø?mm';
          const thruStr = f.throughHole ? ' THRU' : '';
          // L/D > 3: standard twist drilling needs peck cycles; > 5 gun drilling
          const isDeepHole =
            f.depth != null && f.diameter != null && f.diameter > 0 && f.depth / f.diameter > 3;
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: f.type === 'CROSS_HOLE' ? 50 : 40,
            operationHint: `Drilling ${diamStr}${thruStr}${isDeepHole ? ' (deep hole)' : ''}`,
            reason: `${f.type} ${diamStr} requires dedicated drilling op` +
              (isDeepHole ? ` — L/D ${(f.depth! / f.diameter!).toFixed(1)} > 3 requires peck drilling cycles` : ''),
            confidence: f.confidence,
            machineCategoryHint: holeMachine,
            // Drilling can be done on CNC lathe (drill attachment) OR VMC — AI picks best
            alternativeMachineHints: ['cnc_lathe', 'cnc_mill'],
          });
          break;
        }

        case 'COUNTERBORE':
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 45,
            operationHint: 'Counterboring',
            reason: 'Counterbore must follow drilling',
            confidence: f.confidence,
            machineCategoryHint: holeMachine,
          });
          break;

        case 'THREAD_INTERNAL':
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 50,
            operationHint: `Tapping ${f.spec ?? ''}`.trim(),
            reason: `Internal thread ${f.spec ?? ''} requires tapping op`,
            confidence: f.confidence,
            machineCategoryHint: holeMachine,
          });
          break;

        case 'THREAD_EXTERNAL':
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 50,
            operationHint: `Thread Turning ${f.spec ?? ''}`.trim(),
            reason: `External thread ${f.spec ?? ''} requires thread turning op`,
            confidence: f.confidence,
            machineCategoryHint: 'cnc_lathe',
          });
          break;

        case 'SHOULDER_TURN':
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 38,
            operationHint: `Shoulder / Flange Turning (${f.count ?? 1} step${(f.count ?? 1) !== 1 ? 's' : ''})`,
            reason: `Drawing shows ${(f.count ?? 1) + 1} distinct diameters — shoulder/step turning required`,
            confidence: f.confidence,
            machineCategoryHint: 'cnc_lathe',
          });
          break;

        case 'SURFACE_FINISH_FINE':
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 35,
            operationHint: `OD Finish Turning (Ra ${f.raMicrons ?? '?'}μm required)`,
            reason: `Ra ${f.raMicrons ?? '?'}μm — rough turning alone insufficient; dedicated finish pass required`,
            confidence: f.confidence,
            machineCategoryHint: 'cnc_lathe',
          });
          break;

        case 'GRIND':
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 65,
            operationHint: `Grinding${f.raMicrons != null ? ` (Ra ${f.raMicrons}μm)` : ''}`,
            reason: `Ra ${f.raMicrons ?? '?'}μm ≤ 0.8μm threshold — grinding required`,
            confidence: f.confidence,
            machineCategoryHint: 'any',
          });
          break;

        case 'HEAT_TREAT':
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 70,
            operationHint: `Heat Treatment: ${f.spec ?? ''}`,
            reason: `Drawing specifies heat treatment: ${f.spec ?? ''}`,
            confidence: f.confidence,
            machineCategoryHint: 'heat_treatment',
          });
          break;

        case 'ANODIZE':
        case 'PLATE':
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 75,
            operationHint: `${f.type === 'ANODIZE' ? 'Anodising' : 'Surface Plating'}: ${f.spec ?? ''}`,
            reason: `Drawing surface treatment: ${f.spec ?? ''}. Outsource if not in-house.`,
            confidence: f.confidence,
            machineCategoryHint: 'surface_treatment',
          });
          break;

        case 'DEBURR':
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 60,
            operationHint: 'Deburring',
            reason: 'Mandatory after all machined features — no exceptions',
            confidence: f.confidence,
            machineCategoryHint: 'bench_manual',
          });
          break;

        case 'INSPECT':
          // GD&T / tight tolerance upgraded the feature to CMM — dedicated CMM op
          // before final inspection (same featureId + suffix keeps traceability).
          if (f.inspectionMethod === 'cmm') {
            mandatory.push({
              featureId: `${f.id}_cmm`,
              suggestedOpNbr: 90,
              operationHint: 'CMM Inspection',
              reason: f.spec ?? 'GD&T / tight tolerance callouts require CMM inspection',
              confidence: f.confidence,
              machineCategoryHint: 'cmm',
            });
          }
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 99,
            operationHint: 'Final Inspection',
            reason: 'Mandatory last op on all manufactured parts',
            confidence: f.confidence,
            machineCategoryHint: 'inspection_bench',
          });
          break;

        case 'LASER_CUT':
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 10,
            operationHint: 'Laser Cutting (profile + internal cutouts)',
            reason: 'Sheet metal outer profile and internal cutouts require laser cutting as Op 10',
            confidence: f.confidence,
            machineCategoryHint: 'laser_cut',
          });
          break;

        case 'BEND':
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 30,
            operationHint: `Press Brake Bending${f.count != null ? ` (×${f.count} bend${f.count !== 1 ? 's' : ''})` : ''}`,
            reason: `Part has ${f.count ?? '?'} bend(s) — press brake required after laser cutting`,
            confidence: f.confidence,
            machineCategoryHint: 'press_brake',
          });
          break;

        case 'FORM':
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 35,
            operationHint: 'Forming / Deep Drawing',
            reason: 'FORM feature requires dedicated forming or deep-drawing operation',
            confidence: f.confidence,
            machineCategoryHint: 'press_brake',
          });
          break;

        // Features that generate planning context for the AI but not their own mandatory op
        case 'OD_TURN':
        case 'FACE_TURN':
        case 'ID_BORE':
        case 'COUNTERSINK':
        case 'POCKET':
        case 'SLOT':
        case 'FLAT_FACE':
        case 'HONE':
        case 'LAPP':
          break;
      }
    }

    // ── Drawing-intelligence-driven rules (from bom_items promoted columns) ──────
    // These fire independently of the feature graph — they use Gemini-extracted
    // fields persisted on the BOM item, not Claude DrawingBrief features.

    // Tight tolerance → CMM Inspection (skip when the feature graph already produced one)
    const alreadyHasCmm = mandatory.some((op) => op.machineCategoryHint === 'cmm');
    const tol = bomItem?.tightestToleranceMm;
    if (!alreadyHasCmm && tol != null && tol > 0 && tol <= 0.10) {
      mandatory.push({
        featureId: 'tol_cmm',
        suggestedOpNbr: 90,
        operationHint: `CMM Inspection (±${tol}mm)`,
        reason: `Tightest tolerance ±${tol}mm ≤ 0.10mm threshold — CMM required`,
        confidence: 0.90,
        machineCategoryHint: 'cmm',
        trigger: 'drawing_tolerance',
      } as MandatoryOp & { trigger: string });
    }

    // Coating present → Surface Treatment (only if feature graph didn't already add one)
    const alreadyHasSurfaceTreatment = mandatory.some(
      (op) => op.machineCategoryHint === 'surface_treatment',
    );
    if (!alreadyHasSurfaceTreatment && bomItem?.coating && bomItem.coating !== 'None') {
      mandatory.push({
        featureId: 'surface_treatment_drawing',
        suggestedOpNbr: 80,
        operationHint: `Surface Treatment: ${bomItem.coating}`,
        reason: `Drawing-confirmed coating "${bomItem.coating}" requires surface treatment op`,
        confidence: 0.88,
        machineCategoryHint: 'surface_treatment',
        trigger: 'drawing_coating',
      } as MandatoryOp & { trigger: string });
    }

    // Surface treatment present → Cleaning/Degreasing must precede it.
    // Anodize/plating on an oily or chip-contaminated surface fails adhesion.
    const surfaceOps = mandatory.filter((op) => op.machineCategoryHint === 'surface_treatment');
    if (surfaceOps.length > 0) {
      const firstSurfaceOpNbr = Math.min(...surfaceOps.map((op) => op.suggestedOpNbr));
      mandatory.push({
        featureId: 'clean_pre_treatment',
        suggestedOpNbr: Math.max(firstSurfaceOpNbr - 3, 1),
        operationHint: 'Cleaning / Degreasing',
        reason: 'Surface treatment requires a clean, oil-free surface — cleaning op inserted before treatment',
        confidence: 0.9,
        machineCategoryHint: 'cleaning',
      });
    }

    // Bending dimensions critical in notes → First Article Inspection
    const notesLower = (drawingNotes ?? '').toLowerCase();
    if (notesLower.includes('bending') && notesLower.includes('critical')) {
      mandatory.push({
        featureId: 'bend_critical_fai',
        suggestedOpNbr: 95,
        operationHint: 'First Article Inspection — bend dimensions critical',
        reason: 'Drawing note specifies bending dimensions are critical — FAI required',
        confidence: 0.85,
        machineCategoryHint: 'inspection',
        trigger: 'drawing_note_critical',
      } as MandatoryOp & { trigger: string });
    }

    return mandatory.sort((a, b) => a.suggestedOpNbr - b.suggestedOpNbr);
  }
}
