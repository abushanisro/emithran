import type { CadEvidenceKey } from './cad-evidence';
import type { SourceRef } from '../../dto/cost-breakdown.dto';

/**
 * Where a seeded calculator input was read (its trace step's `ref`): the source its engine named, else, for a value measured on CAD faces,
 * those faces. Undefined when neither is known: nothing is opened for it.
 */
export function sourceRefOfSeed(named: SourceRef | undefined, evidence: CadEvidenceKey | undefined): SourceRef | undefined {
  if (named) return named;
  return evidence ? { kind: 'cad', evidence } : undefined;
}
