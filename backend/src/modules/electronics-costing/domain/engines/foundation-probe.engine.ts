import type { ElectronicsCapability, ElectronicsEngine, ElectronicsResult } from './engine.types';

// The empty engine that proves the pipeline end to end (upload -> job -> versioned
// result) before any real process has sourced rates. It applies to every graph and
// always reports an unsupported-operation gap, so a quote that only the probe touched
// can never look complete or cost Rs 0. Removed from the registry when the first real
// engine lands in Phase 3.
const PROCESS_LABEL = 'Foundation probe';

export class FoundationProbeEngine implements ElectronicsEngine<null> {
  readonly id = 'foundation_probe' as const;
  readonly processFamily = 'electronics';
  readonly processLabel = PROCESS_LABEL;

  applies(): boolean {
    return true;
  }

  inputs(): null {
    return null;
  }

  checkCapability(): ElectronicsCapability {
    return { capable: true };
  }

  computeCost(): ElectronicsResult {
    return {
      status: 'gap',
      gap: {
        gapType: 'unsupported_operation',
        process: PROCESS_LABEL,
        machineClass: 'electronics_unassigned',
        reason: 'No electronics process engine or reference rates exist yet; this probe only exercises the pipeline.',
        requiredCapability:
          'Stage sourced SMT, THT, test and harness rates (Phase 2), then register the real engines (Phase 3).',
      },
    };
  }
}
