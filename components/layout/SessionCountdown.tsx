'use client';

import { Timer } from 'lucide-react';

import { cn } from '@/lib/utils';

import { formatRemaining, useSessionIdle } from './SessionIdleProvider';

/** Header countdown to the inactivity sign-out. */
export function SessionCountdown() {
  const { snapshot } = useSessionIdle();
  if (!snapshot || snapshot.phase === 'expired') return null;
  const warning = snapshot.phase === 'warning';
  return (
    <div
      role="timer"
      aria-live={warning ? 'polite' : 'off'}
      title="You will be signed out after 30 minutes of inactivity"
      className={cn(
        'hidden sm:flex items-center gap-1 px-2 text-xs tabular-nums',
        warning ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground',
      )}
    >
      <Timer className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{formatRemaining(snapshot.remainingMs)}</span>
      <span className="sr-only">until automatic sign-out</span>
    </div>
  );
}
