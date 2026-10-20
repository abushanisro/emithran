import { Injectable } from '@nestjs/common';

import { computeCoverage, orphanKeys, type EngineCoverage } from '../domain/reference/coverage';
import { PLANNED_ENGINES } from '../domain/reference/engine-inputs';
import { ElectronicsReferenceRepository } from '../infrastructure/repositories/electronics-reference.repository';

export interface ReferenceCoverageView {
  engines: EngineCoverage[];
  summary: { ready: number; pendingConfirmation: number; gap: number };
  /** Staged rows no planned engine asks for. Should always be empty. */
  orphanKeys: string[];
}

// The written "real inputs or a gap" answer for every planned engine, computed from the
// manifest and the staged rows, so it cannot drift from either.
@Injectable()
export class GetReferenceCoverageUseCase {
  constructor(private readonly reference: ElectronicsReferenceRepository) {}

  async execute(): Promise<ReferenceCoverageView> {
    const rows = await this.reference.listRows();
    const engines = computeCoverage(PLANNED_ENGINES, rows);
    const count = (r: EngineCoverage['readiness']) => engines.filter((e) => e.readiness === r).length;
    return {
      engines,
      summary: { ready: count('ready'), pendingConfirmation: count('pending_confirmation'), gap: count('gap') },
      orphanKeys: orphanKeys(PLANNED_ENGINES, rows),
    };
  }
}
