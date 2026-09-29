// Minimum milling machine class a part needs, from its features' real tool
// axes and the reference setup rule. Never from a feature-count threshold.
//
// Source: memory/Machining/variables.csv (staged by migration 639 as
// machining_reference_data category 'variable', source_version '2026-03'):
//   perpendicularCountFor3AM              4  "Maximum no of perpendicular setups for 3AM"
//   maxOblique4AMSetups                   0  (oblique setups a 4 axis mill may take)
//   allowedAngleDeviationSetupAxisToolAxis 0  "Allowed angle deviation between setup
//                                             axis and tool axis when selecting setup axis"
//
// Replaces requiredMilledMachineClass(difficultyLevel, pocketCount), which read
// a "difficulty" made of hole + 2 x bend + pocket counts against 5/15/30 and a
// classification confidence, plus pockets > 12 / > 25: invented thresholds
// that decided whether a quote was allowed on a 3, 4 or 5 axis mill.
//
// Tool-axis contract (cad-engine feature_graph_v2 occurrences):
//   tool_axis                 unit APPROACH vector (from the material toward the
//                             spindle); a blind feature is reachable only along it
//   tool_axis_bidirectional   true when the feature is reachable from either side
//                             (through holes, cutouts, slots): +axis or -axis
//   omitted                   no single tool axis (generic surface regions,
//                             lathe-spindle features, stock-derived features)

import { MACHINING_REFERENCE_SOURCE_VERSION } from './lookup/machining-lookup-tables';

export const SETUP_AXIS_SOURCE_VERSION = MACHINING_REFERENCE_SOURCE_VERSION;
export const SETUP_AXIS_VARIABLE_KEYS = [
  'perpendicularCountFor3AM',
  'maxOblique4AMSetups',
  'allowedAngleDeviationSetupAxisToolAxis',
] as const;

export interface SetupAxisRule {
  perpendicularCountFor3AM: number;
  maxOblique4AMSetups: number;
  allowedAngleDeviationDeg: number;
}

export type MilledClass = '3_axis_mill' | '4_axis_mill' | '5_axis_mill';

export interface RequiredMilledClass {
  /** null = not derivable (no rule staged, or no feature carries a tool axis):
   *  no class is excluded, and `reason` says why. */
  required: MilledClass | null;
  reason: string;
  principalSetups: number;
  obliqueSetups: number;
}

export function resolveSetupAxisRule(
  rows: ReadonlyArray<{ key: string; value: string | number | null }> | null | undefined,
): { rule: SetupAxisRule | null; missing: string[] } {
  const byKey = new Map((rows ?? []).map((r) => [r.key, Number(r.value)]));
  const missing = SETUP_AXIS_VARIABLE_KEYS.filter((k) => !Number.isFinite(byKey.get(k)));
  if (missing.length > 0) return { rule: null, missing: [...missing] };
  return {
    rule: {
      perpendicularCountFor3AM: byKey.get('perpendicularCountFor3AM')!,
      maxOblique4AMSetups: byKey.get('maxOblique4AMSetups')!,
      allowedAngleDeviationDeg: byKey.get('allowedAngleDeviationSetupAxisToolAxis')!,
    },
    missing: [],
  };
}

type Vec = [number, number, number];

interface AxisFeatureLike {
  occurrences?: ReadonlyArray<{ tool_axis?: readonly number[] | null; tool_axis_bidirectional?: boolean | null }>;
}

const PRINCIPAL: Vec[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function unit(v: readonly number[]): Vec | null {
  if (v.length !== 3 || !v.every(Number.isFinite)) return null;
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  return n > 0 ? [v[0]! / n, v[1]! / n, v[2]! / n] : null;
}

function angleDeg(a: Vec, b: Vec): number {
  const d = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return (Math.acos(d) * 180) / Math.PI;
}

const neg = (v: Vec): Vec => [-v[0], -v[1], -v[2]];

/** The engine rounds tool_axis components to this step (feature contract). */
const ENGINE_AXIS_ROUNDING = 1e-4;
const ENGINE_ROUNDING_NOISE_DEG = (Math.sqrt(3) * ENGINE_AXIS_ROUNDING * 180) / Math.PI;

/**
 * Distinct setup directions the features need, then the least machine class
 * that can take them: any oblique setup beyond maxOblique4AMSetups needs a
 * 5 axis mill; more principal (perpendicular) setups than
 * perpendicularCountFor3AM need a 4 axis mill; otherwise a 3 axis mill.
 *
 * Axes are collapsed with the rule's own angular tolerance, plus the angle
 * the engine's own rounding can introduce: it rounds each component to 1e-4,
 * so two roundings of one direction differ by at most sqrt(3) x 1e-4 rad.
 * Without that an exact-match rule (0 deg) would split one direction in two.
 */
export function requiredMilledClassFromToolAxes(
  features: ReadonlyArray<AxisFeatureLike> | null | undefined,
  rule: SetupAxisRule | null,
): RequiredMilledClass {
  const none = (reason: string): RequiredMilledClass => ({ required: null, reason, principalSetups: 0, obliqueSetups: 0 });
  if (!rule) return none('Machine axis requirement not derived: the reference setup-axis variables are not staged.');

  const one: Vec[] = [];
  const both: Vec[] = [];
  for (const f of features ?? []) {
    for (const o of f.occurrences ?? []) {
      const v = o.tool_axis ? unit(o.tool_axis) : null;
      if (!v) continue;
      (o.tool_axis_bidirectional ? both : one).push(v);
    }
  }
  if (one.length === 0 && both.length === 0) {
    return none('Machine axis requirement not derived: the CAD analysis carries no feature tool axes, so no mill class is excluded.');
  }

  const tol = rule.allowedAngleDeviationDeg + ENGINE_ROUNDING_NOISE_DEG;
  const same = (a: Vec, b: Vec) => angleDeg(a, b) <= tol;
  const setups: Vec[] = [];
  for (const v of one) if (!setups.some((s) => same(s, v))) setups.push(v);
  // A two-sided feature shares any setup at +axis or -axis; only when neither
  // exists does it need a setup of its own.
  for (const v of both) if (!setups.some((s) => same(s, v) || same(s, neg(v)))) setups.push(v);

  const principalSetups = setups.filter((s) => PRINCIPAL.some((p) => same(s, p))).length;
  const obliqueSetups = setups.length - principalSetups;

  if (obliqueSetups > rule.maxOblique4AMSetups) {
    return {
      required: '5_axis_mill', principalSetups, obliqueSetups,
      reason: `${obliqueSetups} oblique setup${obliqueSetups === 1 ? '' : 's'} (a 4 axis mill takes at most ${rule.maxOblique4AMSetups}).`,
    };
  }
  if (principalSetups > rule.perpendicularCountFor3AM) {
    return {
      required: '4_axis_mill', principalSetups, obliqueSetups,
      reason: `${principalSetups} perpendicular setups (a 3 axis mill takes at most ${rule.perpendicularCountFor3AM}).`,
    };
  }
  return {
    required: '3_axis_mill', principalSetups, obliqueSetups,
    reason: `${principalSetups} perpendicular setup${principalSetups === 1 ? '' : 's'}, no oblique setup.`,
  };
}
