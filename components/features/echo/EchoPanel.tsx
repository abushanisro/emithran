'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  BellRing,
  History,
  Lightbulb,
  MessageSquareText,
  Minimize2,
  X,
} from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useEchoAlerts } from '@/lib/echo/useEchoApi';
import { cn } from '@/lib/utils';

import { EchoAlertsList } from './EchoAlertsList';
import { EchoChat } from './EchoChat';
import { EchoConversationList } from './EchoConversationList';
import { useEchoUi } from './EchoProvider';

/**
 * Resizable side panel. Anchored bottom-right, slides up. Resize from the
 * left edge. Width persists via EchoProvider → localStorage.
 *
 * Pure-CSS resize via a horizontal drag bar so we avoid pulling in
 * `react-resizable-panels` (which is designed for layout splitters, not
 * floating panels).
 */
export function EchoPanel() {
  const ui = useEchoUi();
  const { data: alerts } = useEchoAlerts();
  const alertCount = Array.isArray(alerts) ? alerts.length : 0;

  const resizeStart = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    if (!resizeStart.current) return;
    const onMove = (e: MouseEvent) => {
      if (!resizeStart.current) return;
      const dx = resizeStart.current.x - e.clientX; // dragging left grows
      ui.setPanelWidth(resizeStart.current.w + dx);
    };
    const onUp = () => { resizeStart.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  });

  const beginResize = (e: React.MouseEvent) => {
    resizeStart.current = { x: e.clientX, w: ui.panelWidth };
  };

  // ESC to close
  useEffect(() => {
    if (!ui.isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ui.close();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [ui]);

  return (
    <AnimatePresence>
      {ui.isOpen && (
        <motion.div
          key="echo-panel"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.98 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          style={{ width: ui.panelWidth }}
          className={cn(
            'fixed bottom-4 right-4 z-[60] hidden md:flex flex-col',
            'h-[min(720px,calc(100vh-32px))]',
            'rounded-xl border border-border bg-background shadow-2xl',
            'overflow-hidden',
          )}
          role="dialog"
          aria-label="Echo assistant"
          aria-modal="false"
        >
          {/* Resize handle */}
          <div
            onMouseDown={beginResize}
            aria-hidden
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-violet-500/40 transition-colors"
          />

          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background">
            <div
              className="h-7 w-7 rounded-full flex items-center justify-center text-white shrink-0"
              style={{
                background:
                  'linear-gradient(135deg, #6366f1 0%, #d946ef 50%, #7c3aed 100%)',
              }}
            >
              <MessageSquareText className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold leading-tight flex items-center gap-1.5">
                Echo
                <span className="px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 text-[10px] font-semibold uppercase tracking-wide">
                  Beta
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Manufacturing copilot
              </div>
            </div>
            <button
              type="button"
              aria-label="Minimize"
              onClick={ui.close}
              className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Close"
              onClick={ui.close}
              className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center border-b border-border bg-muted/30 text-xs">
            <Tab
              active={ui.activeTab === 'chat'}
              onClick={() => { ui.setActiveTab('chat'); }}
              icon={<MessageSquareText className="h-3.5 w-3.5" />}
              label="Chat"
            />
            <Tab
              active={ui.activeTab === 'alerts'}
              onClick={() => { ui.setActiveTab('alerts'); }}
              icon={<BellRing className="h-3.5 w-3.5" />}
              label="Alerts"
              badge={alertCount}
            />
            <Tab
              active={ui.activeTab === 'suggestions'}
              onClick={() => { ui.setActiveTab('suggestions'); }}
              icon={<Lightbulb className="h-3.5 w-3.5" />}
              label="Tips"
            />
            <Tab
              active={ui.activeTab === 'history'}
              onClick={() => { ui.setActiveTab('history'); }}
              icon={<History className="h-3.5 w-3.5" />}
              label="History"
            />
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {ui.activeTab === 'chat' && <EchoChat />}
            {ui.activeTab === 'alerts' && <EchoAlertsList onClose={ui.close} />}
            {ui.activeTab === 'suggestions' && <SuggestionsTabBody />}
            {ui.activeTab === 'history' && <EchoConversationList />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Tab({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 py-2 border-b-2',
        active
          ? 'border-violet-500 text-violet-600 dark:text-violet-300 font-medium bg-background'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      <span>{label}</span>
      {badge && badge > 0 ? (
        <span className="ml-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  );
}

function SuggestionsTabBody() {
  // Suggestions are already shown inline in the chat banner. The full tab is a
  // V2 thing (curated tips library); for now point the user back to chat.
  return (
    <div className="p-4 text-sm text-muted-foreground leading-relaxed">
      Smart suggestions appear at the top of the <strong>Chat</strong> tab when
      they're relevant to the page you're on.
    </div>
  );
}
