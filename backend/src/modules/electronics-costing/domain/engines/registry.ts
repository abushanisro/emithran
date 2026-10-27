import { ASSEMBLY_ENGINES } from './assembly-steps.engine';

import type { ElectronicsEngine } from './engine.types';

// The single, explicit list of electronics engines. Adding a process is one engine
// file, its spec, and one line here; the registry spec lists every id.
//
// The PCBA assembly steps and the two stated material lines. Not registered: FoundationProbeEngine (a placeholder that
// always reported a gap, so no quote could ever complete) and PcbFabDrillingEngine (bare-board fabrication is parked:
// the bare PCB is priced from the fabricator's quote, stated in the scenario; the engine and its spec stay for later).
export const ELECTRONICS_ENGINE_REGISTRY: readonly ElectronicsEngine<any>[] = [...ASSEMBLY_ENGINES];
