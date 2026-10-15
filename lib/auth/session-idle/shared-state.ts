/**
 * Idle-timeout state shared by every tab of this browser.
 *
 * One localStorage key per field, so two tabs writing different fields at the
 * same moment never overwrite each other. Times only move forward (setMax),
 * except the heartbeat claim fields, which a failed heartbeat rolls back.
 * When storage is unavailable (private mode, blocked site data) it falls back
 * to memory: that tab then times out on its own, and the server still enforces.
 */
export type SharedField =
  | 'sessionId'
  | 'lastActivityAt'
  | 'lastJobAt'
  | 'userBeatSentAt'
  | 'userBeatCovers'
  | 'jobBeatSentAt'
  | 'expiredSession';

export interface IdleStorage {
  get(field: SharedField): string | null;
  set(field: SharedField, value: string): void;
  remove(field: SharedField): void;
  /** Calls back when ANOTHER tab changes a field. */
  subscribe(listener: (field: SharedField, value: string | null) => void): () => void;
}

const PREFIX = 'emithran.sessionIdle.';

const noop = (): void => undefined;

export function getNumber(storage: IdleStorage, field: SharedField): number | null {
  const raw = storage.get(field);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function setMax(storage: IdleStorage, field: SharedField, value: number): void {
  const current = getNumber(storage, field);
  if (current === null || value > current) storage.set(field, String(value));
}

export function memoryIdleStorage(): IdleStorage {
  const map = new Map<SharedField, string>();
  return {
    get: (f) => map.get(f) ?? null,
    set: (f, v) => void map.set(f, v),
    remove: (f) => void map.delete(f),
    subscribe: () => noop,
  };
}

export function browserIdleStorage(): IdleStorage {
  const fallback = memoryIdleStorage();
  const ls = (): Storage | null => {
    try {
      return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
      return null;
    }
  };
  return {
    get(field) {
      try {
        return ls()?.getItem(PREFIX + field) ?? fallback.get(field);
      } catch {
        return fallback.get(field);
      }
    },
    set(field, value) {
      fallback.set(field, value);
      try {
        ls()?.setItem(PREFIX + field, value);
      } catch {
        // memory fallback already holds it
      }
    },
    remove(field) {
      fallback.remove(field);
      try {
        ls()?.removeItem(PREFIX + field);
      } catch {
        // ignore
      }
    },
    subscribe(listener) {
      if (typeof window === 'undefined') return noop;
      const onStorage = (e: StorageEvent) => {
        if (e.key?.startsWith(PREFIX)) listener(e.key.slice(PREFIX.length) as SharedField, e.newValue);
      };
      window.addEventListener('storage', onStorage);
      return () => { window.removeEventListener('storage', onStorage); };
    },
  };
}
