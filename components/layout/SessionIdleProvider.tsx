'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { fetchSessionStatus, sendSessionHeartbeat, signOutForInactivity } from '@/lib/auth/session-idle/browser';
import { SessionIdleController, type IdleSnapshot } from '@/lib/auth/session-idle/controller';
import { SESSION_IDLE_TIMEOUT_EVENT } from '@/lib/auth/session-idle/policy';
import { protectedJobCount, subscribeProtectedJobs } from '@/lib/auth/session-idle/protected-jobs';
import { browserIdleStorage } from '@/lib/auth/session-idle/shared-state';
import { sessionSource } from '@/lib/auth/session-source';

import type { ReactNode } from 'react';

/** Real user input. Background requests, polling and streams never count. */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

interface SessionIdleValue {
  snapshot: IdleSnapshot | null;
}

const SessionIdleContext = createContext<SessionIdleValue>({ snapshot: null });

export function useSessionIdle(): SessionIdleValue {
  return useContext(SessionIdleContext);
}

/** The current session id; changes on a new sign-in, not on token refresh. */
function useSessionId(): string | null {
  const [sessionId, setSessionId] = useState<string | null>(null);
  useEffect(() => sessionSource.onSessionChange(setSessionId), []);
  return sessionId;
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The 30-minute inactivity timeout for the signed-in dashboard: tracks real
 * activity (shared across tabs), shows the warning in the last 2 minutes, and
 * signs out at the deadline. The backend enforces the same deadline itself.
 */
export function SessionIdleProvider({ children }: { children: ReactNode }) {
  const sessionId = useSessionId();
  const controllerRef = useRef<SessionIdleController | null>(null);
  const [snapshot, setSnapshot] = useState<IdleSnapshot | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const controller = new SessionIdleController(sessionId, {
      now: Date.now,
      storage: browserIdleStorage(),
      status: fetchSessionStatus,
      beat: sendSessionHeartbeat,
      onExpire: signOutForInactivity,
      localJobCount: protectedJobCount,
    });
    controllerRef.current = controller;

    // Re-render only when the shown second (or phase) changes.
    let shown = '';
    const publish = (next: IdleSnapshot) => {
      const key = `${next.phase}|${Math.ceil(next.remainingMs / 1000)}|${String(next.jobRunning)}`;
      if (key !== shown) {
        shown = key;
        setSnapshot(next);
      }
    };
    const tick = () => { publish(controller.tick()); };

    publish(controller.start());
    const interval = window.setInterval(tick, 1_000);
    const onActivity = () => { controller.recordActivity(); };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true, capture: true });
    // A tab coming back from the background, or a laptop waking, checks at once.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    const onServerIdle = () => { controller.serverReportedIdle(); };
    window.addEventListener(SESSION_IDLE_TIMEOUT_EVENT, onServerIdle);
    const unsubscribeJobs = subscribeProtectedJobs(tick);

    return () => {
      window.clearInterval(interval);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity, { capture: true });
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(SESSION_IDLE_TIMEOUT_EVENT, onServerIdle);
      unsubscribeJobs();
      controller.stop();
      controllerRef.current = null;
    };
  }, [sessionId]);

  const warning = snapshot?.phase === 'warning';
  const stay = () => controllerRef.current?.staySignedIn();

  return (
    <SessionIdleContext.Provider value={{ snapshot }}>
      {children}
      <AlertDialog open={warning} onOpenChange={(open) => !open && stay()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you still there?</AlertDialogTitle>
            <AlertDialogDescription>
              For your security, you will be signed out in{' '}
              <span className="font-medium tabular-nums text-foreground">{formatRemaining(snapshot?.remainingMs ?? 0)}</span>{' '}
              because of inactivity.
              {snapshot?.jobRunning && (
                <>
                  {' '}A CAD or BOM task is still running, so sign-out waits for it to finish, for up to 15 extra
                  minutes.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => controllerRef.current?.signOutNow()}>Sign out now</AlertDialogCancel>
            <AlertDialogAction onClick={stay}>Stay signed in</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SessionIdleContext.Provider>
  );
}
