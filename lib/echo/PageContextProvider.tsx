'use client';

/**
 * PageContextProvider
 * ───────────────────
 * The 30% differentiator. Tracks (a) the live pathname and (b) the currently-
 * focused manufacturing entity (project / BOM / part / RFQ / lot / vendor).
 *
 * Pages mount `usePageContext({ entityType, entityId })` near their top to
 * register the entity. Multiple consumers can register; the most-recently
 * mounted one wins (stack semantics) so deep child components can override
 * what a parent route layout registered.
 *
 * Echo reads this on every chat turn and forwards it to the backend so
 * Claude knows exactly what the user is looking at.
 *
 * Loop-safety
 * ───────────
 * `register` and `unregister` are stable across renders (useCallback with
 * `[]` deps) AND `register` short-circuits when the registration is
 * functionally identical to what's already on the stack. This breaks any
 * register → setState → re-render → register cycle that callers might
 * otherwise create by passing fresh object/array literals on every render.
 *
 * The consumer hook reads the provider via TWO contexts so callers that
 * subscribe to mutator functions don't re-render when the snapshot changes,
 * and vice versa.
 */

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { EchoEntityType, EchoPageContext } from './types';

interface EntityRegistration {
  id: string;
  entityType: EchoEntityType;
  entityId: string;
  breadcrumbs?: string[] | undefined;
}

interface PageContextMutators {
  register: (reg: EntityRegistration) => void;
  unregister: (id: string) => void;
}

const PageContextStateCtx = createContext<EchoPageContext | null>(null);
const PageContextMutatorsCtx = createContext<PageContextMutators | null>(null);

export function PageContextProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const [stack, setStack] = useState<EntityRegistration[]>([]);

  const register = useCallback((reg: EntityRegistration) => {
    setStack((prev) => {
      // Idempotent — don't trigger a re-render for an already-equal entry.
      const isUnchanged = prev.some(
        (r) =>
          r.id === reg.id &&
          r.entityType === reg.entityType &&
          r.entityId === reg.entityId &&
          sameBreadcrumbs(r.breadcrumbs, reg.breadcrumbs),
      );
      if (isUnchanged) return prev;
      const filtered = prev.filter((r) => r.id !== reg.id);
      return [...filtered, reg];
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setStack((prev) => {
      if (!prev.some((r) => r.id === id)) return prev;
      return prev.filter((r) => r.id !== id);
    });
  }, []);

  const mutators = useMemo<PageContextMutators>(
    () => ({ register, unregister }),
    [register, unregister],
  );

  const context = useMemo<EchoPageContext>(() => {
    const top = stack[stack.length - 1];
    return {
      route: pathname,
      entityType: top?.entityType,
      entityId: top?.entityId,
      breadcrumbs: top?.breadcrumbs,
    };
  }, [pathname, stack]);

  return (
    <PageContextMutatorsCtx.Provider value={mutators}>
      <PageContextStateCtx.Provider value={context}>
        {children}
      </PageContextStateCtx.Provider>
    </PageContextMutatorsCtx.Provider>
  );
}

/**
 * Read the current page context. Subscribes to state, not mutators —
 * components using this re-render when the snapshot changes.
 */
export function useEchoPageContext(): EchoPageContext {
  const ctx = useContext(PageContextStateCtx);
  if (!ctx) {
    if (typeof window !== 'undefined') {
      return { route: window.location.pathname };
    }
    return { route: '/' };
  }
  return ctx;
}

/**
 * Register the entity this page is about. Call once near the top of a page.
 *
 * ```tsx
 * usePageContext({ entityType: 'bom_item', entityId: id });
 * ```
 *
 * Safe with conditional ids — registration is skipped while id is undefined.
 * Subscribes only to mutators (stable refs) so it never re-renders due to
 * other components' registrations.
 */
export function usePageContext(reg: {
  entityType: EchoEntityType;
  entityId?: string | null;
  breadcrumbs?: string[];
}) {
  const mutators = useContext(PageContextMutatorsCtx);

  // Stable per-call key — same call site gets the same registration id across renders.
  const idRef = useRef<string>('');
  if (!idRef.current) {
    idRef.current = `${reg.entityType}-${Math.random().toString(36).slice(2, 10)}`;
  }
  const id = idRef.current;

  // Stringify breadcrumbs to make a stable dep. The reference of
  // `reg.breadcrumbs` is unstable when callers pass an inline literal,
  // but the joined string only changes when contents change.
  const crumbsKey = (reg.breadcrumbs ?? []).join('|');

  // Keep the latest breadcrumbs in a ref so the effect doesn't need to
  // depend on the unstable array reference.
  const crumbsRef = useRef(reg.breadcrumbs);
  crumbsRef.current = reg.breadcrumbs;

  useEffect(() => {
    if (!mutators || !reg.entityId) return;
    mutators.register({
      id,
      entityType: reg.entityType,
      entityId: reg.entityId,
      breadcrumbs: crumbsRef.current,
    });
    return () => { mutators.unregister(id); };
  }, [mutators, reg.entityType, reg.entityId, crumbsKey, id]);
}

function sameBreadcrumbs(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
