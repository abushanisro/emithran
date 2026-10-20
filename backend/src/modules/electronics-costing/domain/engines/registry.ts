import { FoundationProbeEngine } from './foundation-probe.engine';

import type { ElectronicsEngine } from './engine.types';

// The single, explicit list of electronics engines. Adding a process is one engine
// file, its spec, and one line here; the registry spec lists every id.
export const ELECTRONICS_ENGINE_REGISTRY: readonly ElectronicsEngine<any>[] = [new FoundationProbeEngine()];
