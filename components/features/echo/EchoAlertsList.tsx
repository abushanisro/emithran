'use client';

import { AlertTriangle, Info, Loader2, X } from 'lucide-react';
import Link from 'next/link';

import type { EchoAlertSeverity } from '@/lib/echo/types';
import { useDismissEchoAlert, useEchoAlerts } from '@/lib/echo/useEchoApi';
import { cn } from '@/lib/utils';

const SEVERITY_STYLES: Record<EchoAlertSeverity, string> = {
  info: 'border-blue-500/30 bg-blue-500/5',
  warn: 'border-amber-500/30 bg-amber-500/5',
  urgent: 'border-red-500/40 bg-red-500/10',
};

const SEVERITY_ICON: Record<EchoAlertSeverity, React.ReactNode> = {
  info: <Info className="h-4 w-4 text-blue-500" />,
  warn: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  urgent: <AlertTriangle className="h-4 w-4 text-red-500" />,
};

export function EchoAlertsList({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useEchoAlerts();
  const dismiss = useDismissEchoAlert();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Scanning your projects…
      </div>
    );
  }
  const list = Array.isArray(data) ? data : [];
  if (list.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        All clear. No pending RFQs, stale lots, or cost spikes.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {list.map((a) => (
        <div
          key={a.id}
          className={cn(
            'rounded-md border px-3 py-2.5 text-sm',
            SEVERITY_STYLES[a.severity],
          )}
        >
          <div className="flex items-start gap-2">
            <div className="mt-0.5">{SEVERITY_ICON[a.severity]}</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{a.title}</div>
              {a.body && (
                <div className="text-muted-foreground text-xs mt-0.5 leading-snug">
                  {a.body}
                </div>
              )}
              {a.nextAction && (
                <div className="text-foreground text-xs mt-1.5 leading-snug">
                  <span className="font-medium">Next:</span> {a.nextAction}
                </div>
              )}
              {a.linkRoute && (
                <Link
                  href={a.linkRoute}
                  onClick={onClose}
                  className="inline-block mt-1.5 text-xs font-medium text-violet-600 dark:text-violet-300 underline-offset-2 hover:underline"
                >
                  Open →
                </Link>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss alert"
              onClick={() => { dismiss.mutate(a.id); }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
