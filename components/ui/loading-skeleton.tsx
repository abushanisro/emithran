import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

/**
 * Presentation-only loading placeholders built from <Skeleton>. They replace
 * the old centred spinners: same place in the tree, same loading condition,
 * but a content-shaped placeholder instead. Each announces itself to
 * assistive tech through role="status" and a visually hidden label.
 */

interface LoadingRegionProps {
  label: string;
  className?: string;
  children: ReactNode;
}

function LoadingRegion({ label, className, children }: LoadingRegionProps) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  label?: string;
  className?: string;
}

/** Header row plus body rows, for tables and data grids. */
export function TableSkeleton({ rows = 5, columns = 4, label = 'Loading…', className }: TableSkeletonProps) {
  return (
    <LoadingRegion label={label} className={cn('w-full space-y-3 p-4', className)}>
      <div className="flex gap-4">
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} className="h-4 flex-1" />
        ))}
      </div>
      <div className="space-y-3 border-t pt-3">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-4">
            {Array.from({ length: columns }, (_, c) => (
              <Skeleton key={c} className={cn('h-5 flex-1', c === 0 && 'max-w-[40%]')} />
            ))}
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

interface ListSkeletonProps {
  rows?: number;
  label?: string;
  className?: string;
}

/** Stacked rows with a leading marker, for lists, comments and cards. */
export function ListSkeleton({ rows = 3, label = 'Loading…', className }: ListSkeletonProps) {
  return (
    <LoadingRegion label={label} className={cn('w-full space-y-3 py-2', className)}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </LoadingRegion>
  );
}

interface PageSkeletonProps {
  label?: string;
  className?: string;
}

/** A whole page: header block, a row of stat cards and a table. */
export function PageSkeleton({ label = 'Loading…', className }: PageSkeletonProps) {
  return (
    <LoadingRegion label={label} className={cn('w-full space-y-6', className)}>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 pt-6">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <TableSkeleton rows={6} columns={5} label={label} />
      </Card>
    </LoadingRegion>
  );
}
