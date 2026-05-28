import { cn } from '@/lib/utils';
import type { HttpMethod } from '@/lib/docs/api-spec-types';

const METHOD_STYLES: Record<HttpMethod, string> = {
  GET: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  POST: 'bg-green-500/15 text-green-400 border-green-500/30',
  PUT: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  PATCH: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  DELETE: 'bg-red-500/15 text-red-400 border-red-500/30',
};

interface MethodBadgeProps {
  method: HttpMethod;
  size?: 'sm' | 'md';
  className?: string;
}

export function MethodBadge({ method, size = 'sm', className }: MethodBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border font-mono font-semibold uppercase tracking-wider',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
        METHOD_STYLES[method],
        className,
      )}
    >
      {method}
    </span>
  );
}
