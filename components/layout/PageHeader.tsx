import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, children, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6', className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="truncate text-2xl font-bold tracking-tight text-foreground sm:text-[28px] sm:leading-9" title={title}>
          {title}
        </h1>
        {description && (
          <p className="truncate text-[15px] text-muted-foreground" title={description}>
            {description}
          </p>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
