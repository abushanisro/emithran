import { useSyncExternalStore } from 'react';

// A blocked Apply points at the Refresh analysis button (top bar): it asks for the cue, the button shows it for a few seconds. One cue for the page,
// so the Apply buttons and the top bar need no props threaded between them.

let until = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export const CUE_MS = 4000;

/** Highlight the Refresh analysis button for `ms`. */
export function cueRefreshAnalysis(now = Date.now(), ms = CUE_MS): void {
  until = now + ms;
  emit();
  setTimeout(emit, ms);
}

export function isRefreshAnalysisCued(now = Date.now()): boolean {
  return now < until;
}

export function useRefreshAnalysisCue(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => isRefreshAnalysisCued(),
    () => false,
  );
}
