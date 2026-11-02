'use client';

import { Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useClearCopilotMemory, useCopilotMemory, useRemoveCopilotPreference } from '@/lib/api/copilot-memory';

/**
 * Everything the manufacturing copilot remembers about how this user likes answers, with a delete for each entry and for all.
 * The copilot only proposes entries; one is saved when the user presses Save in the copilot panel.
 */
export function CopilotMemorySection() {
  const { data, isLoading, error } = useCopilotMemory();
  const remove = useRemoveCopilotPreference();
  const clear = useClearCopilotMemory();
  const preferences = data?.preferences ?? [];

  return (
    <section>
      <div className="mb-4">
        <h3 className="text-base font-semibold">Copilot memory</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          What the manufacturing copilot remembers about how you like answers. It only saves what you confirm in the copilot panel.
        </p>
      </div>

      {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {error && <p className="text-sm text-destructive">Copilot memory could not be loaded.</p>}
      {!isLoading && !error && preferences.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing saved.</p>
      )}

      {preferences.length > 0 && (
        <>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {preferences.map((preference) => (
              <li key={preference} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1 break-words">{preference}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete "${preference}"`}
                  disabled={remove.isPending}
                  onClick={() => { remove.mutate(preference); }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
          <Button className="mt-3" variant="outline" size="sm" disabled={clear.isPending} onClick={() => { clear.mutate(); }}>
            Forget everything
          </Button>
        </>
      )}
    </section>
  );
}
