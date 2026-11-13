/**
 * Which registered formula (formula-registry.ts: id, version, validation state) stands behind a field of a plastic-molding calculator. The engine puts it on the
 * calculation trace, so a number carries the state of the formula that made it, and the written report (plastic-calculator-report.ts) shows the same. The
 * compression calculator is not in the registry yet, so its fields have none; the reaction injection calculator has F-19 for its Fill Time (its Cure Time and Cycle Time are not F-09 and F-08).
 */
const INJECTION: Record<string, string> = {
  'Cooling Time': 'F-04', 'Injection Time': 'F-05', 'Press Dry Cycle Time': 'F-07', 'Cycle Time': 'F-08', 'Plasticizing Time': 'F-20', 'Ejection Time': 'F-21',
};

/** By the calculator's key in plastic-molding-calculators.json, then the field's name. */
export const REGISTRY_FORMULA_OF_FIELD: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  injection: INJECTION,
  structural_foam: INJECTION,
  injection_lsr: { 'Cure Time': 'F-09', 'Fill Time': 'F-22', 'Press Dry Cycle Time': 'F-07', 'Cycle Time': 'F-23' },
  rim: { 'Fill Time': 'F-19' },
};
