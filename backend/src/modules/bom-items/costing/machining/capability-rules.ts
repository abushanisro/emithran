// Process-capability thresholds that decide whether a machining part needs a
// finishing process (grinding, jig boring, jig grinding), read from the staged
// reference data. Never a constant in code.
//
// Source (machining_reference_data, source_version '2026-03'):
//   variables (memory/Machining/variables.csv, migration 639)
//     finishGrindingDepth   0.1     stock a finish grinding pass removes (mm)
//     jigBoreMaxPosTol      0.0254  loosest position tolerance that needs a jig
//                                   borer/grinder (mm). tblGtol lists the same
//                                   ceiling rounded to 0.026; the variable is the
//                                   exact value the reference uses for this decision.
//   tblGtolProcessCapabilities (memory/Machining/lookup, migration 747)
//     Turning / Milling Fine  roughness  Best Achievable 0.4 um: a drawing Ra
//                             finer than both cannot be turned or milled and
//                             is ground.
//     Jig Boring / Jig Grind  positionTolerance  Num Repetitions 3 / 4: the
//                             finishing passes each process repeats.
//
// With any value missing there is no rule: the engine adds none of these
// lines and says which value is absent.

import { MACHINING_REFERENCE_SOURCE_VERSION } from './lookup/machining-lookup-tables';

export const CAPABILITY_RULES_SOURCE_VERSION = MACHINING_REFERENCE_SOURCE_VERSION;
export const CAPABILITY_VARIABLE_KEYS = ['finishGrindingDepth', 'jigBoreMaxPosTol'] as const;
export const CAPABILITY_GTOL_TABLE = 'tblGtolProcessCapabilities';

export interface MachiningCapabilityRules {
  /** variables: finishGrindingDepth (mm). */
  finishGrindingDepthMm: number;
  /** variables: jigBoreMaxPosTol (mm). At or below it a hole goes to a jig borer / grinder. */
  jigBorePositionToleranceMm: number;
  /** tblGtol roughness Best Achievable: the finer of Turning and Milling Fine (um).
   *  A drawing Ra strictly below it is ground. */
  grindingRaTriggerUm: number;
  /** tblGtol Jig Boring positionTolerance Num Repetitions. */
  jigBoringRepetitions: number;
  /** tblGtol Jig Grind positionTolerance Num Repetitions. */
  jigGrindRepetitions: number;
}

type GtolRow = Record<string, unknown>;

const gtol = (rows: readonly GtolRow[], process: string, category: string) =>
  rows.find((r) => r['Process'] === process && r['GtolCategory'] === category);

export function resolveMachiningCapabilityRules(
  variables: ReadonlyArray<{ key: string; value: string | number | null }> | null | undefined,
  gtolRows: readonly GtolRow[] | null | undefined,
): { rules: MachiningCapabilityRules | null; missing: string[] } {
  const missing: string[] = [];
  const byKey = new Map((variables ?? []).map((v) => [v.key, Number(v.value)]));
  const variable = (k: string) => {
    const v = byKey.get(k);
    if (!Number.isFinite(v) || v! <= 0) { missing.push(`variables: ${k}`); return NaN; }
    return v!;
  };
  const field = (process: string, category: string, name: string) => {
    const v = Number(gtol(gtolRows ?? [], process, category)?.[name]);
    if (!Number.isFinite(v) || v <= 0) { missing.push(`${CAPABILITY_GTOL_TABLE}: ${process} ${category} ${name}`); return NaN; }
    return v;
  };
  const finishGrindingDepthMm = variable('finishGrindingDepth');
  const jigBorePositionToleranceMm = variable('jigBoreMaxPosTol');
  const turningRa = field('Turning', 'roughness', 'Best Achievable');
  const millingRa = field('Milling Fine', 'roughness', 'Best Achievable');
  const jigBoringRepetitions = field('Jig Boring', 'positionTolerance', 'Num Repetitions');
  const jigGrindRepetitions = field('Jig Grind', 'positionTolerance', 'Num Repetitions');
  if (missing.length > 0) return { rules: null, missing };
  return {
    rules: {
      finishGrindingDepthMm,
      jigBorePositionToleranceMm,
      grindingRaTriggerUm: Math.min(turningRa, millingRa),
      jigBoringRepetitions,
      jigGrindRepetitions,
    },
    missing: [],
  };
}
