import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

/** Semantic tones for any status chip, built only from the theme tokens. */
export type StatusTone = 'success' | 'warning' | 'destructive' | 'info' | 'neutral';

export const statusToneClasses: Record<StatusTone, string> = {
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  destructive: 'bg-destructive/10 text-destructive border-destructive/20',
  info: 'bg-info/10 text-info border-info/20',
  neutral: 'bg-muted text-muted-foreground border-border',
};

interface StatusBadgeProps {
  /** Project workflow status key. Optional when `tone` and `children` are given. */
  status?: string;
  /** Use a semantic tone instead of the project-status lookup. */
  tone?: StatusTone;
  /** Label override; defaults to the project-status label or the raw status. */
  children?: ReactNode;
  /** Show a leading dot in the badge's colour. */
  dot?: boolean;
  className?: string;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  raw_material_procurement: {
    label: 'Raw Material',
    className: 'bg-info/10 text-info border-info/20',
  },
  dfm_dfa_analysis: {
    label: 'DFM/DFA',
    className: 'bg-primary/10 text-primary border-primary/20',
  },
  process_planning: {
    label: 'Process Planning',
    className: 'bg-warning/10 text-warning border-warning/20',
  },
  should_costing: {
    label: 'Should Costing',
    className: 'bg-accent/10 text-accent border-accent/20',
  },
  quoted: {
    label: 'Quoted',
    className: 'bg-success/10 text-success border-success/20',
  },
  cost_driver_analysis: {
    label: 'Cost Drivers',
    className: 'bg-primary/10 text-primary border-primary/20',
  },
  value_negotiation: {
    label: 'Negotiation',
    className: 'bg-warning/10 text-warning border-warning/20',
  },
  production: {
    label: 'Production',
    className: 'bg-success/10 text-success border-success/20',
  },
  supply_chain: {
    label: 'Supply Chain',
    className: 'bg-info/10 text-info border-info/20',
  },
  lost: {
    label: 'Lost',
    className: 'bg-destructive/10 text-destructive border-destructive/20',
  },
};

export function StatusBadge({ status = '', tone, children, dot = false, className }: StatusBadgeProps) {
  const config = statusConfig[status] ?? {
    label: status,
    className: 'bg-muted text-muted-foreground border-muted',
  };
  const toneClassName = tone ? statusToneClasses[tone] : config.className;

  return (
    <span
      className={cn(
        'badge-status border',
        dot && 'gap-1.5',
        toneClassName,
        className
      )}
    >
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {children ?? config.label}
    </span>
  );
}

export function getStatusLabel(status: string): string {
  return statusConfig[status]?.label ?? status;
}
