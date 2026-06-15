'use client';

import { HelpCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

import { useEchoUi } from './EchoProvider';

/**
 * Drop this anywhere a hint exists. Clicking opens Echo with the topic
 * pre-loaded into the input. The hint content itself is served by the
 * backend's HintsService and seeded in `supabase` migration 315.
 *
 * ```tsx
 * <EchoHintButton topicId="bom.cost-rollup" />
 * ```
 */
export function EchoHintButton({
  topicId,
  label = 'Need a hint?',
  className,
}: {
  topicId: string;
  label?: string;
  className?: string;
}) {
  const ui = useEchoUi();

  return (
    <button
      type="button"
      onClick={() => { ui.openWithTopic(topicId); }}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-muted-foreground',
        'hover:text-violet-600 dark:hover:text-violet-300 underline-offset-2 hover:underline',
        className,
      )}
    >
      <HelpCircle className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
