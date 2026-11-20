import { cn } from '@/lib/utils';

import type { ComponentType, ReactNode } from 'react';

interface EmptyStateProps {
  /** Lucide icon (or any component taking className) shown in a soft tile. */
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  /** The page's own primary action, passed through unchanged (usually a <Button>). */
  children?: ReactNode;
  className?: string;
}

/**
 * Friendly "nothing here yet" block: icon, one-line title, short description,
 * optional action. Presentation only; the action is whatever the page already
 * offers, so no new behaviour is added.
 */
export function EmptyState({ icon: Icon, title, description, children, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 py-12 text-center',
        className,
      )}
    >
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <div className="max-w-sm space-y-1">
        <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  );
}
