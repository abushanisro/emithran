import { Injectable } from '@nestjs/common';

import type { ManufacturingFeatureGraph, MandatoryOp } from '../dto/manufacturing-feature.dto';

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
  evaluate(graph: ManufacturingFeatureGraph): MandatoryOp[] {
    const mandatory: MandatoryOp[] = [];

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
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: f.type === 'CROSS_HOLE' ? 50 : 40,
            operationHint: `Drilling ${diamStr}${thruStr}`,
            reason: `${f.type} ${diamStr} requires dedicated drilling op`,
            confidence: f.confidence,
            machineCategoryHint: 'cnc_lathe',
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
            machineCategoryHint: 'cnc_lathe',
          });
          break;

        case 'THREAD_INTERNAL':
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 50,
            operationHint: `Tapping ${f.spec ?? ''}`.trim(),
            reason: `Internal thread ${f.spec ?? ''} requires tapping op`,
            confidence: f.confidence,
            machineCategoryHint: 'cnc_lathe',
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
          mandatory.push({
            featureId: f.id,
            suggestedOpNbr: 99,
            operationHint: 'Final Inspection',
            reason: 'Mandatory last op on all manufactured parts',
            confidence: f.confidence,
            machineCategoryHint: 'inspection_bench',
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
        case 'BEND':
        case 'LASER_CUT':
        case 'FORM':
        case 'HONE':
        case 'LAPP':
          break;
      }
    }

    return mandatory.sort((a, b) => a.suggestedOpNbr - b.suggestedOpNbr);
  }
}
