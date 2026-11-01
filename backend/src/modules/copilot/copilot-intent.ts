/**
 * Deterministic gate for the copilot's only write (update_preferences). The
 * model is offered the tool, and the runner executes it, only when the user's
 * own latest message asks to remember or forget something. Part names, warnings,
 * tool results and assistant turns (which the client sends back and can forge)
 * never count, so org-shared data cannot plant durable memory on its own.
 *
 * The matcher is deliberately simple and errs towards not offering the tool:
 * case-insensitive whole words or phrases, matched against the user's text only.
 *   remember, forget, always, never, prefer, from now on
 * ("don't remember" / "stop remembering" are covered by "remember"; the
 * inflections remembers/remembering/forgets/forgetting/prefers/preferred are
 * accepted too.)
 */
const MEMORY_REQUEST =
  /\b(?:remember(?:s|ing)?|forget(?:s|ting)?|always|never|prefer(?:s|red)?|from\s+now\s+on)\b/i;

export function asksToChangeMemory(userText: string): boolean {
  return MEMORY_REQUEST.test(userText);
}

/**
 * The one-line confirmation streamed to the user after a memory change, built
 * from what was actually written, not from the model's account of it. Empty
 * when nothing changed. Asterisks are dropped so saved text cannot alter the
 * panel's bold markup.
 */
export function memoryConfirmation(change: { saved: string[]; removed: string[] }): string {
  const list = (items: string[]) => items.map((p) => `"${p.replace(/\*/g, '')}"`).join(', ');
  const parts = [
    change.saved.length ? `saved ${list(change.saved)}` : '',
    change.removed.length ? `removed ${list(change.removed)}` : '',
  ].filter(Boolean);
  return parts.length ? `**Copilot memory updated:** ${parts.join('; ')}.` : '';
}

/** The content of the last message whose role is "user"; '' when there is none. Assistant turns are never considered. */
export function latestUserText(messages: ReadonlyArray<{ role: string; content: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') return typeof m.content === 'string' ? m.content : '';
  }
  return '';
}
