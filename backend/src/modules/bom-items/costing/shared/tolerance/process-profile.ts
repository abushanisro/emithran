// What each manufacturing process does with a feature's required tolerances. The requirements themselves are process-independent (feature-tolerances.ts,
// auto-detect.ts); everything a process knows is reached through its profile here, so no process's capability, threshold or operation choice applies to another.
//
// A profile states, for the part families one process covers:
//   capability   where "what the process holds" comes from: its own row of tblGtolProcessCapabilities (a casting), the operation that makes each feature (machining),
//                or nothing validated yet;
//   operation    what is selected when a requirement is finer than that: machining after the primary process, a finer operation named, or nothing;
//   cost         whether the selected operation is priced (secondary-machining-cost.ts), only reported, or not selected at all.
// A process with no validated capability or no validated operation selection never produces a cost: its toleranced features come back needs_review, with what is
// missing. The same feature with the same tolerance therefore reads differently on a sand casting, a machined part and a moulded part, by design.
//
// Not built yet (each its own change): tolerance-dependent cycle time on machined parts, and validated rules for sheet metal, plastic moulding and the other
// processes.

import { isMachiningFamily } from '../../../../../domain/part-family';
import type { InstanceRequirements, ResolvedRequirement } from './feature-tolerances';
import type { MachiningNeedResult } from './machining-need';

export interface ToleranceProcessProfile {
  /** The process as the part page names it. */
  process: string;
  capability: 'primary_process' | 'feature_operation' | 'not_validated';
  operation: 'machining_after_primary' | 'finer_operation_named' | 'none';
  cost: 'priced' | 'reported' | 'none';
  /** One sentence for the engineer: what is assessed and what is not. */
  note: string;
}

const CASTING: Pick<ToleranceProcessProfile, 'capability' | 'operation' | 'cost'> = { capability: 'primary_process', operation: 'machining_after_primary', cost: 'priced' };

const PROFILES: Readonly<Record<string, ToleranceProcessProfile>> = {
  sand_cast: { process: 'Sand Casting', ...CASTING, note: 'Judged by what sand casting holds; a feature it leaves short is machined after casting and priced.' },
  die_cast: { process: 'Die Casting', ...CASTING, note: 'Judged by what the die-casting process chosen for the part holds; a feature it leaves short is machined after casting and priced.' },
  investment_cast: {
    process: 'Investment Casting', ...CASTING,
    note: 'Judged by what investment casting holds; a feature it leaves short is machined after casting and priced. Its hole and wall limits are not staged, so whether a hole can be cast at all is left for review.',
  },
  forged: {
    process: 'Forging', ...CASTING,
    note: 'Judged by what forging holds (its row of the capability table); a feature it leaves short, and a hole too small to pierce or across the die direction, is machined after forging and priced.',
  },
  powder_metal: {
    process: 'Powder Metal', ...CASTING,
    note: 'Judged by what powder metal holds (its row of the capability table); a feature it leaves short, and a hole too small to press or across the press direction, is machined after pressing and priced.',
  },
  sheet_metal: {
    process: 'Sheet Metal', capability: 'not_validated', operation: 'none', cost: 'none',
    note: 'No validated tolerance capability yet: which sheet-metal operation makes each feature is not mapped to the capability table, so toleranced features are listed for review and add no cost.',
  },
  plastic_molded: {
    process: 'Plastic Molding', capability: 'not_validated', operation: 'none', cost: 'none',
    note: 'No validated tolerance capability yet: what a mould holds per feature, and what follows when it does not, is not modelled, so toleranced features are listed for review and add no cost.',
  },
};

const MACHINING: ToleranceProcessProfile = {
  process: 'Machining', capability: 'feature_operation', operation: 'finer_operation_named', cost: 'reported',
  note: 'Each feature is judged by the operation that makes it. A tolerance finer than that names the finer operation; that operation is not added to the machining cost yet.',
};

/** The profile of the process a part family is costed as. Any family with none gets a profile that assesses nothing and says so. */
export function toleranceProfileOf(family: string): ToleranceProcessProfile {
  if (isMachiningFamily(family)) return MACHINING;
  return PROFILES[family] ?? {
    process: family || 'unknown', capability: 'not_validated', operation: 'none', cost: 'none',
    note: `No validated tolerance capability for "${family || 'unknown'}" parts yet: toleranced features are listed for review and add no cost.`,
  };
}

export type ToleranceDecisionKind = 'no_requirement' | 'held' | 'add_operation' | 'needs_review';

export interface ToleranceDecision {
  featureKey: string | null;
  label: string;
  featureType: string;
  featureId: string | null;
  occurrenceIndex: number;
  faceIds: number[];
  decision: ToleranceDecisionKind;
  /** The process the feature was judged against; null when none was. */
  judgedAs: string | null;
  /** The operations selected (add_operation) or named (needs_review on a machined part), in order. */
  operations: string[];
  requirements: ResolvedRequirement[];
  reason: string;
}

/**
 * One decision per feature, from the process's own assessment (`need`, machining-need.ts) when its profile has one. Without an assessment every toleranced
 * feature is needs_review. An operation is selected only when the profile prices it; anything undecided is needs_review, never a cost.
 */
export function evaluateToleranceDecisions(input: {
  profile: ToleranceProcessProfile;
  features: readonly InstanceRequirements[];
  need: MachiningNeedResult | null;
  /** Why there is no assessment (reference data not staged ...), when the profile would have one. */
  notAssessedReason?: string | null;
}): ToleranceDecision[] {
  const { profile, need } = input;
  const base = (i: InstanceRequirements['instance']) => ({
    featureKey: i.key, label: i.label, featureType: i.featureType, featureId: i.featureId, occurrenceIndex: i.occurrenceIndex, faceIds: i.faceIds,
  });
  if (!need) {
    return input.features.map(({ instance, requirements }) => ({
      ...base(instance), requirements, judgedAs: null, operations: [],
      decision: requirements.length ? 'needs_review' as const : 'no_requirement' as const,
      reason: requirements.length ? input.notAssessedReason ?? profile.note : 'No tolerance is required of this feature.',
    }));
  }
  return need.features.map((f): ToleranceDecision => {
    const common = {
      featureKey: f.featureKey, label: f.label, featureType: f.featureType, featureId: f.featureId, occurrenceIndex: f.occurrenceIndex, faceIds: f.faceIds,
      requirements: f.requirements, judgedAs: f.primaryProcess,
    };
    const operations = [...(f.forming ? [f.forming.operation] : []), ...f.candidates.map((c) => c.operation)];
    const why = f.reasons.join('; ');
    if (f.verdict === 'as_primary') {
      return f.requirements.length
        ? { ...common, decision: 'held', operations: [], reason: why }
        : { ...common, decision: 'no_requirement', operations: [], reason: why || 'No tolerance is required of this feature.' };
    }
    if (f.verdict === 'undecided') return { ...common, decision: 'needs_review', operations: [], reason: why };
    if (operations.length === 0) return { ...common, decision: 'needs_review', operations, reason: why };
    return profile.cost === 'priced'
      ? { ...common, decision: 'add_operation', operations, reason: why }
      : { ...common, decision: 'needs_review', operations, reason: `${why}; a finer operation holds it (${operations.join(', ')}) and is not added to the cost yet` };
  });
}
