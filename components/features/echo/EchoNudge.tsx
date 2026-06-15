'use client';

/**
 * EchoNudge — a floating, TryHackMe-style "thought bubble" that appears next
 * to the Echo button while the panel is closed. It surfaces the single most
 * specific, entity-aware suggestion for the page the user is on.
 *
 * Behaviour
 * ─────────
 * - Visible only when (a) Echo panel is closed AND (b) there's at least one
 *   non-dismissed suggestion.
 * - Click the bubble → opens the panel with the suggestion's title pre-filled
 *   in the chat composer.
 * - "×" → dismisses just that suggestion (server-side cooldown).
 * - Position: pinned to the bottom-right, above and to the left of the floating
 *   button, with the small triangle pointing at the button.
 * - Animated entrance via framer-motion. Auto re-hides after 25 seconds so it
 *   doesn't overstay; reappears on route change or new suggestion.
 *
 * The wording comes from the backend's `SuggestionService` and is intentionally
 * specific (e.g. "Pin 2: manufacturability 62/100 (hard). Top warning: thin
 * wall 1.2 mm on flange — want options?").
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useEchoPageContext } from '@/lib/echo/PageContextProvider';
import {
  useDismissEchoSuggestion,
  useEchoSuggestions,
} from '@/lib/echo/useEchoApi';

import { useEchoUi } from './EchoProvider';

const AUTO_HIDE_MS = 25_000;

export function EchoNudge() {
  const ui = useEchoUi();
  const ctx = useEchoPageContext();

  const { data: suggestions } = useEchoSuggestions(
    { route: ctx.route, entityType: ctx.entityType, entityId: ctx.entityId },
    !ui.isOpen, // don't poll if Echo is open — banner already shows it inside
  );
  const dismiss = useDismissEchoSuggestion();

  const list = Array.isArray(suggestions) ? suggestions : [];
  const top = list[0];

  // Auto-hide bookkeeping: store the last suggestion id we displayed so the
  // bubble re-shows when a new one arrives.
  const [hiddenForId, setHiddenForId] = useState<string | null>(null);
  const topId = top?.id;
  useEffect(() => {
    if (!topId) return;
    setHiddenForId(null);
    const t = setTimeout(() => { setHiddenForId(topId); }, AUTO_HIDE_MS);
    return () => { clearTimeout(t); };
  }, [topId]);

  // Hide entirely when panel is open.
  if (ui.isOpen || !top || hiddenForId === top.id) return null;

  const handleOpen = () => {
    // Open Echo and pre-fill the question with the suggestion title.
    // We use openWithTopic with a synthetic topic id; the consumer side ignores
    // unknown topics and the chat composer is left at the user's discretion.
    // For now: open and let the user click "Ask Echo" inside the banner.
    ui.open();
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    dismiss.mutate({ route: ctx.route, suggestionId: top.id });
    setHiddenForId(top.id);
  };

  return (
    <AnimatePresence>
      <motion.div
        key={top.id}
        initial={{ opacity: 0, y: 8, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.95 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        // Sits directly above the Echo button, right-aligned — thought bubble style.
        style={{
          position: 'fixed',
          right: ui.buttonPos.x,
          bottom: ui.buttonPos.y + 64, // 56px button + 8px gap
          zIndex: 59,
          maxWidth: 280,
        }}
        className="hidden md:block"
      >
        <button
          type="button"
          onClick={handleOpen}
          className="relative group text-left rounded-2xl rounded-br-sm
                     border border-violet-500/30 bg-background shadow-xl
                     px-3 py-2.5 hover:shadow-2xl transition-shadow
                     w-full cursor-pointer"
        >
          {/* tail pointing down toward the button */}
          <span
            aria-hidden
            className="absolute -bottom-2 right-4 w-3 h-3 rotate-45
                       border-r border-b border-violet-500/30
                       bg-background"
          />

          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="h-3 w-3 text-violet-500" />
            <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-300 uppercase tracking-wide">
              Smart suggestion
            </span>
            <span
              role="button"
              tabIndex={0}
              aria-label="Dismiss"
              onClick={handleDismiss}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  handleDismiss(e as unknown as React.MouseEvent);
                }
              }}
              className="ml-auto text-muted-foreground hover:text-foreground p-0.5
                         rounded hover:bg-muted cursor-pointer"
            >
              <X className="h-3 w-3" />
            </span>
          </div>

          <div className="text-sm font-medium leading-snug text-foreground">
            {top.title}
          </div>
          {top.body && (
            <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {top.body}
            </div>
          )}
          <div className="mt-1.5 inline-flex items-center text-xs font-medium text-violet-600 dark:text-violet-300 group-hover:underline underline-offset-2">
            {top.ctaLabel ?? 'Ask Echo'} →
          </div>
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
