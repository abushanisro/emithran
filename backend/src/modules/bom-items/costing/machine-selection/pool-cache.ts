



// In-process cache of machine pools keyed by location. TTL 60 s, invalidated
// synchronously on any MHR write (create/update/delete/import call
// invalidateMachinePools). One cost summary touches up to 12 machine classes;
// without this every summary would re-query mhr_records per class.

import type { MachineCandidate } from '../../dto/machine-selection.dto';


const TTL_MS = 60_000;
const MAX_ENTRIES = 32;

interface PoolEntry {
  at: number;
  candidates: MachineCandidate[];
}

const pools = new Map<string, PoolEntry>();

export function machinePoolKey(location: string): string {
  return location.trim().toLowerCase();
}

export function getCachedMachinePool(location: string): MachineCandidate[] | null {
  const key = machinePoolKey(location);
  const entry = pools.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    pools.delete(key);
    return null;
  }
  return entry.candidates;
}

export function setCachedMachinePool(location: string, candidates: MachineCandidate[]): void {
  if (pools.size >= MAX_ENTRIES) {
    // Evict oldest entry (insertion order ≈ age for our access pattern)
    const oldest = pools.keys().next().value;
    if (oldest !== undefined) pools.delete(oldest);
  }
  pools.set(machinePoolKey(location), { at: Date.now(), candidates });
}

export function invalidateMachinePools(location?: string): void {
  if (location) pools.delete(machinePoolKey(location));
  else pools.clear();
}
