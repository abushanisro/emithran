// Which features does the primary process leave short, and which machining
// operations can finish them. Pure; any primary process (casting, forging,
// sheet metal, ...) whose capability is in tblGtolProcessCapabilities.
//
// Per feature instance (feature-tolerances.ts) a feature needs machining when
//   - a required tolerance is finer than the primary process holds
//     (process-capability.ts, ISO 286 at the feature size), or
//   - the caller says the primary process cannot form it at all
//     (e.g. a hole below the casting minimum diameter -- formability).
// The operations, in order:
//   forming     when the primary process cannot form the feature, it is made
//               from solid by the machining engine's own operation for that
//               feature type and variant (canonical-operation.ts: a through or
//               blind hole is Drilling, a stepped hole Step Drilling). A hole
//               cannot be reamed, bored, tapped or ground before it exists.
//   finishing   when a requirement is finer than the feature's previous
//               operation holds (the forming operation, else the primary
//               process): the memory/Machining catalog operations for the
//               feature type (REFERENCE_FEATURE_OPERATIONS.machining) that link
//               to a capability process (operation_capability_process, migration
//               882) holding EVERY requirement -- the last operation on a
//               feature sets all its tolerances.
// Choosing among finishing candidates (cheapest) is the costing step's job.

import { REFERENCE_FEATURE_OPERATIONS } from '../reference-features.generated';
import { resolveCanonicalOperation } from '../../machining/process/canonical-operation';
import type { InstanceRequirements, ResolvedRequirement } from './feature-tolerances';
import { processHolds, type CapabilityRow, type IsoToleranceRow } from './process-capability';

export interface OperationLink { operation: string; capabilityProcess: string }

export function resolveOperationLinks(rows: ReadonlyArray<Record<string, unknown>>): OperationLink[] {
  return rows
    .map((r) => ({ operation: String(r['Operation'] ?? '').trim(), capabilityProcess: String(r['Capability Process'] ?? '').trim() }))
    .filter((l) => l.operation && l.capabilityProcess);
}

type Formability = { formable: true; detail: string } | { formable: false; detail: string } | { formable: null; detail: string };

interface MachiningCandidate { operation: string; capabilityProcess: string; detail: string[] }

type FeatureVerdict = 'as_primary' | 'needs_machining' | 'undecided';

interface FeatureMachiningNeed {
  featureKey: string | null;
  label: string;
  featureType: string;
  faceIds: number[];
  /** feature_graph_v2 entry id + occurrence index of this analysis (viewer highlighting). */
  featureId: string | null;
  occurrenceIndex: number;
  verdict: FeatureVerdict;
  /** Why: each requirement against the primary process, and formability. */
  reasons: string[];
  requirements: ResolvedRequirement[];
  /** Makes the feature from solid when the primary process cannot form it; null otherwise. */
  forming: MachiningCandidate | null;
  /** Finishing operations that hold every requirement (empty when none is needed or none is on file). */
  candidates: MachiningCandidate[];
  /** Catalog operations rejected for this feature, with why. */
  rejected: Array<{ operation: string; reason: string }>;
}

export interface MachiningNeedResult {
  primaryProcess: string;
  features: FeatureMachiningNeed[];
  /** Any feature needs machining. */
  machiningRequired: boolean;
}

const machiningOperationsFor = (featureType: string): readonly string[] =>
  (REFERENCE_FEATURE_OPERATIONS.machining as Readonly<Record<string, readonly string[]>>)[featureType] ?? [];

export function evaluateMachiningNeed(input: {
  primaryProcess: string;
  features: readonly InstanceRequirements[];
  capability: readonly CapabilityRow[];
  iso: readonly IsoToleranceRow[];
  links: readonly OperationLink[];
  /** Whether the primary process can form this feature at all (holes). Absent = not assessed. */
  formability?: (f: InstanceRequirements) => Formability | null;
}): MachiningNeedResult {
  const linkOf = new Map(input.links.map((l) => [l.operation, l.capabilityProcess]));
  const features = input.features.map(({ instance, requirements }) => {
    const reasons: string[] = [];
    let short = false;
    let undecided = false;

    const form = input.formability?.({ instance, requirements }) ?? null;
    if (form) {
      reasons.push(form.detail);
      if (form.formable === false) short = true;
      if (form.formable === null) undecided = true;
    }
    for (const req of requirements) {
      const h = processHolds(input.primaryProcess, req, instance.sizeMm, input.capability, input.iso);
      reasons.push(`${h.detail} [${req.source}]`);
      if (h.held === false) short = true;
      if (h.held === null) undecided = true;
    }

    const candidates: MachiningCandidate[] = [];
    const rejected: FeatureMachiningNeed['rejected'] = [];
    let forming: MachiningCandidate | null = null;
    if (short) {
      // Forming: the feature is not formed by the primary process.
      if (form?.formable === false) {
        const label = resolveCanonicalOperation(instance.featureType, instance.variant, 'milling');
        const operation = label?.split(' // ')[0] ?? null;
        const cap = operation ? linkOf.get(operation) : undefined;
        if (!operation || !cap) {
          reasons.push(`no machining operation on file forms a ${instance.featureType}${instance.variant ? ` (${instance.variant})` : ''} from solid`);
        } else {
          forming = { operation, capabilityProcess: cap, detail: ['forms the feature from solid (canonical-operation.ts)'] };
        }
      }
      // Finishing: requirements the last operation does not hold.
      const after = forming?.capabilityProcess ?? input.primaryProcess;
      const unmet = requirements.filter((r) => processHolds(after, r, instance.sizeMm, input.capability, input.iso).held !== true);
      if (unmet.length > 0) {
        for (const operation of machiningOperationsFor(instance.featureType)) {
          if (operation === forming?.operation) continue;
          const cap = linkOf.get(operation);
          if (!cap) { rejected.push({ operation, reason: 'no capability process linked (operation_capability_process)' }); continue; }
          const checks = requirements.map((r) => processHolds(cap, r, instance.sizeMm, input.capability, input.iso));
          const fail = checks.find((c) => c.held !== true);
          if (fail) rejected.push({ operation, reason: `${cap}: ${fail.detail}` });
          else candidates.push({ operation, capabilityProcess: cap, detail: checks.map((c) => c.detail) });
        }
        if (candidates.length === 0) reasons.push(`no ${instance.featureType} finishing operation on file holds every requirement`);
      }
    }

    const verdict: FeatureVerdict = short ? 'needs_machining' : undecided ? 'undecided' : 'as_primary';
    return {
      featureKey: instance.key, label: instance.label, featureType: instance.featureType, faceIds: instance.faceIds,
      featureId: instance.featureId, occurrenceIndex: instance.occurrenceIndex,
      verdict, reasons, requirements, forming, candidates, rejected,
    };
  });
  return { primaryProcess: input.primaryProcess, features, machiningRequired: features.some((f) => f.verdict === 'needs_machining') };
}
