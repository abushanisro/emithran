import { AlertTriangle, CheckCircle2, Star, XCircle } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

type MarkKind = 'ok' | 'warn' | 'fail' | 'star';

const KINDS: Record<MarkKind, { Icon: typeof CheckCircle2; tone: string }> = {
  ok: { Icon: CheckCircle2, tone: 'text-success' },
  warn: { Icon: AlertTriangle, tone: 'text-warning' },
  fail: { Icon: XCircle, tone: 'text-destructive' },
  star: { Icon: Star, tone: 'text-warning' },
};

interface MarkProps {
  kind: MarkKind;
  /** Keep the surrounding text colour instead of the status colour. */
  inherit?: boolean;
  className?: string;
}

/**
 * Inline status icon that replaces the ✓ ⚠ ✗ ★ text glyphs. It is sized in em,
 * so it scales with whatever text it sits in. Presentation only.
 */
export function Mark({ kind, inherit = false, className }: MarkProps) {
  const { Icon, tone } = KINDS[kind];
  return (
    <Icon
      aria-hidden="true"
      className={cn('inline-block h-[1.15em] w-[1.15em] shrink-0 align-[-0.2em]', !inherit && tone, className)}
    />
  );
}
