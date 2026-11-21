import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

interface FilterToolbarProps {
  /** The page's existing search input; grows to fill the row. */
  search?: ReactNode;
  /** The page's existing filter selects, toggles and Clear button. */
  children?: ReactNode;
  /** Right-aligned actions such as export or view toggles. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Layout-only toolbar for list pages: search first, then filters, then
 * actions on the right. Wraps on narrow screens. Pages pass in their own
 * controls, so no state or behaviour lives here.
 */
export function FilterToolbar({ search, children, actions, className }: FilterToolbarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {search && <div className="min-w-[200px] flex-1 basis-64">{search}</div>}
      {children}
      {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
