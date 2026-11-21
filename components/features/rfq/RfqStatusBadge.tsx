import { cn } from '@/lib/utils';

type RfqTone = 'primary' | 'success' | 'warning' | 'destructive' | 'muted';

const TONES: Record<RfqTone, string> = {
  primary: 'border-primary/30 bg-primary/10 text-primary',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
  muted: 'border-border bg-muted text-muted-foreground',
};

interface RfqStatusBadgeProps {
  tone: RfqTone;
  children: React.ReactNode;
  className?: string;
}

/**
 * Presentation-only status pill for RFQ lists and tables: a coloured dot and
 * tint per tone. Callers keep deciding the tone and the label from their data.
 */
export function RfqStatusBadge({ tone, children, className }: RfqStatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize',
        TONES[tone],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}
