import { cn } from '@/lib/utils';

interface VendorStatusBadgeProps {
  status: string;
  className?: string;
}

const STATUS_STYLES: Record<string, { dot: string; badge: string }> = {
  active: { dot: 'bg-success', badge: 'bg-success/10 text-success border-success/20' },
  pending: { dot: 'bg-warning', badge: 'bg-warning/10 text-warning border-warning/20' },
};

const INACTIVE_STYLE = {
  dot: 'bg-muted-foreground/60',
  badge: 'bg-muted text-muted-foreground border-border',
};

/**
 * Presentation-only status indicator for vendors. Shows the vendor's existing
 * status text unchanged, with a coloured dot and tint per state.
 */
export function VendorStatusBadge({ status, className }: VendorStatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? INACTIVE_STYLE;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium capitalize',
        style.badge,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} aria-hidden="true" />
      {status}
    </span>
  );
}
