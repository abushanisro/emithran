/**
 * Which registered formula (formula-registry.ts: id, version, validation state) stands behind a field of a plastic-molding calculator. The engine puts it on the
 * calculation trace, so a number carries the state of the formula that made it, and the written report (plastic-calculator-report.ts) shows the same. The
 * compression calculator is not in the registry yet, so its fields have none; the reaction injection calculator has F-19 for its Fill Time (its Cure Time and Cycle Time are not F-09 and F-08).
 */
const INJECTION: Record<string, string> = { 'Cooling Time': 'F-04', 'Fill Time': 'F-05', 'Pack Time': 'F-06', 'Press Dry Cycle Time': 'F-07', 'Cycle Time': 'F-08' };

/** By the calculator's key in plastic-molding-calculators.json, then the field's name. */
export const REGISTRY_FORMULA_OF_FIELD: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  injection: INJECTION,
  structural_foam: INJECTION,
  injection_lsr: { 'Cure Time': 'F-09', 'Fill Time': 'F-05', 'Press Dry Cycle Time': 'F-07', 'Cycle Time': 'F-08' },
  rim: { 'Fill Time': 'F-19' },
  injection_deflash: { 'Cycle Time': 'F-24' },
  injection_mold_tooling: { 'Mold Base Steel Cost': 'F-25', 'Cavity Machining Cost': 'F-26', 'Polish Cost': 'F-26', 'Ejector System Cost': 'F-27', 'Sprue and Locating Ring Cost': 'F-27', 'Tryout Cost': 'F-27', 'Side Action Cost': 'F-28', 'Side Action Steel Cost': 'F-28', 'Side Action Machining Cost': 'F-28', 'Side Action CMM Cost': 'F-28', 'Heat Treatment Cost': 'F-29', 'Mold Cost': 'F-16', 'Molds Required': 'F-17', 'Tooling Cost Per Part': 'F-18' },
};
