import {
  computeTapPhysics, TAP_UNLOAD_SEC,
  computeDeburrCycleSec, DEBURR_SEC_PER_METRE, DEBURR_SEC_PER_PIERCE,
} from '../bom-items/costing/shared/core/default-rates.constants';

/**
 * Physics-backed calculator execution — see backend/migrations/056 and
 * calculators.service.ts's execute(). For a calculator whose `physics_key`
 * is set, execute() calls the matching function here instead of evaluating
 * the calculator's own calculator_fields.default_value formula strings. Each
 * function takes the SAME inputValues shape (keyed by field_name) the DB-
 * formula path already receives, and returns results keyed by the SAME
 * field names the calculator's own fields define, so the frontend needs no
 * changes at all — only the actual computation source changes, from a
 * duplicated DB formula to the one real function cost-engine.ts also uses.
 *
 * calculator_fields.default_value formula strings are left in the DB
 * unchanged for these calculators — they still drive the "Why: {formula}"
 * caption text, just not the actual computed value.
 */

const num = (v: any): number => (typeof v === 'number' ? v : parseFloat(v)) || 0;

// A missing rate input (dialog never passed a machine/labor rate) and a
// genuine $0 rate look identical after num()'s `|| 0` coercion — Machine
// Cost/Labour Cost silently compute as $0 either way, with nothing in the
// returned result distinguishing "no rate provided" from "real $0 rate".
// rateWarnings() flags the missing case so callers can disclose it (see
// calculators.service.ts's execute(), which lifts `_warnings` into the
// response's own `warnings` array) instead of a silent $0.
function missingRateWarnings(inputValues: Record<string, any>, keys: string[], costLabels: Record<string, string>): string[] {
  const warnings: string[] = [];
  for (const key of keys) {
    if (inputValues[key] == null) {
      warnings.push(`No "${key}" provided — ${costLabels[key]} computed as $0, not a real rate.`);
    }
  }
  return warnings;
}

function tapping(inputValues: Record<string, any>): Record<string, any> {
  const diameterMm = num(inputValues['Tap Diameter']);
  const length = num(inputValues['Length']);
  const cuttingSpeed = num(inputValues['Cutting Speed']);
  const feedPerRev = num(inputValues['Feed per Rev']);
  const noOfUses = num(inputValues['No of Uses']) || 1;
  const mhrPerHour = num(inputValues['MHR per Hour']);
  const lhrPerHour = num(inputValues['LHR per Hour']);
  const ole = num(inputValues['OLE']) || 100;
  const setupPct = num(inputValues['Setup Percentage']);
  const toolCost = num(inputValues['Tool Cost']);
  const toolLife = num(inputValues['Tool Life']);
  const _warnings = missingRateWarnings(inputValues, ['MHR per Hour', 'LHR per Hour'], {
    'MHR per Hour': 'Machine Cost', 'LHR per Hour': 'Labour Cost',
  });

  const physics = computeTapPhysics(diameterMm, noOfUses, feedPerRev, length, cuttingSpeed);

  const totalTime = physics.toolChangeSec + TAP_UNLOAD_SEC + noOfUses * physics.perHoleSec;
  const toolCostPerPart = toolLife > 0 ? toolCost / toolLife : 0;
  const machineCost = (mhrPerHour * totalTime) / 3600;
  const labourCost = (lhrPerHour * totalTime) / (3600 * (ole / 100));
  const processCost = machineCost + labourCost;
  const setupCost = processCost * (setupPct / 100);
  const totalProcessCost = processCost + setupCost + toolCostPerPart;

  return {
    'Spindle RPM': physics.rpm,
    'Machining Time Min': physics.machiningTimeSec / 60,
    'Machining Time': physics.machiningTimeSec,
    'Approach Time': physics.approachSec,
    'Retract Time': physics.retractSec,
    'Tool Change Time': physics.toolChangeSec,
    'Unload Time': TAP_UNLOAD_SEC,
    'Time per Use': physics.perHoleSec,
    'Total Time': totalTime,
    'Tool Cost per Part': toolCostPerPart,
    'Machine Cost': machineCost,
    'Labour Cost': labourCost,
    'Process Cost': processCost,
    'Setup Cost': setupCost,
    'Total Process Cost': totalProcessCost,
    ...(_warnings.length > 0 ? { _warnings } : {}),
  };
}

function deburring(inputValues: Record<string, any>): Record<string, any> {
  const lengthOfCut = num(inputValues['Length Of Cut (mm)']);
  const noOfStarts = num(inputValues['No Of Starts']);
  const mhrPerHour = num(inputValues['MHR per Hour']);
  const lhrPerHour = num(inputValues['LHR per Hour']);
  const ole = num(inputValues['OLE']) || 100;
  const _warnings = missingRateWarnings(inputValues, ['MHR per Hour', 'LHR per Hour'], {
    'MHR per Hour': 'Machine Cost', 'LHR per Hour': 'Labour Cost',
  });

  // 'Sec Per Metre'/'Sec Per Pierce' are optional real-rate overrides — the
  // caller (resolvePhysicsQuantity) passes the material/process-specific rate
  // from sm_lookup_deburr_rate when a real row was found, same as
  // computeDeburrCycleSec()'s own optional parameters. typeof-checked rather
  // than num()'d directly: num() coerces a genuinely-absent override to 0,
  // which would silently zero out deburr time instead of falling back to the
  // documented default rate.
  const secPerMetre = typeof inputValues['Sec Per Metre'] === 'number' ? inputValues['Sec Per Metre'] : DEBURR_SEC_PER_METRE;
  const secPerPierce = typeof inputValues['Sec Per Pierce'] === 'number' ? inputValues['Sec Per Pierce'] : DEBURR_SEC_PER_PIERCE;
  const totalTime = computeDeburrCycleSec(lengthOfCut, noOfStarts, secPerMetre, secPerPierce);
  const machineCost = (mhrPerHour * totalTime) / 3600;
  const labourCost = (lhrPerHour * totalTime) / (3600 * (ole / 100));
  const processCost = machineCost + labourCost;
  const setupCost = 0; // matches cost-engine.ts's explicit setupTimeMin: 0 for Deburring
  const totalProcessCost = processCost + setupCost;

  return {
    'Sec Per Metre': secPerMetre,
    'Sec Per Pierce': secPerPierce,
    'Total Time': totalTime,
    'Machine Cost': machineCost,
    'Labour Cost': labourCost,
    'Process Cost': processCost,
    'Setup Cost': setupCost,
    'Total Process Cost': totalProcessCost,
    ...(_warnings.length > 0 ? { _warnings } : {}),
  };
}

export const PHYSICS_REGISTRY: Record<string, (inputValues: Record<string, any>) => Record<string, any>> = {
  tapping,
  deburring,
};
