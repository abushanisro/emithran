'use client';

import { motion, useDragControls } from 'framer-motion';
import { MessageSquareText, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useEchoAlerts } from '@/lib/echo/useEchoApi';
import { cn } from '@/lib/utils';

import { useEchoUi } from './EchoProvider';

export function EchoFloatingButton() {
  const { isOpen, toggle, buttonPos, setButtonPos } = useEchoUi();
  const dragControls = useDragControls();
  const draggedRef = useRef(false);

  const { data: alerts } = useEchoAlerts();
  const alertCount = Array.isArray(alerts) ? alerts.length : 0;

  // Clamp position into viewport on resize so the button can't drift off screen.
  useEffect(() => {
    const clamp = () => {
      setButtonPos({
        x: Math.min(buttonPos.x, window.innerWidth - 72),
        y: Math.min(buttonPos.y, window.innerHeight - 72),
      });
    };
    clamp();
    window.addEventListener('resize', clamp);
    return () => { window.removeEventListener('resize', clamp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      drag
      dragControls={dragControls}
      dragMomentum={false}
      dragElastic={0}
      onDragStart={() => { draggedRef.current = false; }}
      onDrag={() => { draggedRef.current = true; }}
      onDragEnd={(_e, info) => {
        // info.point is from viewport top-left; convert to right/bottom offsets
        setButtonPos({
          x: Math.max(8, Math.min(window.innerWidth - 64, window.innerWidth - info.point.x - 28)),
          y: Math.max(8, Math.min(window.innerHeight - 64, window.innerHeight - info.point.y - 28)),
        });
      }}
      style={{
        position: 'fixed',
        right: buttonPos.x,
        bottom: buttonPos.y,
        zIndex: 61,
        touchAction: 'none',
      }}
      className="hidden md:block"
    >
      <button
        type="button"
        aria-label={isOpen ? 'Close Echo assistant' : 'Open Echo assistant'}
        onClick={() => {
          if (draggedRef.current) { draggedRef.current = false; return; }
          toggle();
        }}
        className={cn(
          'relative h-14 w-14 rounded-full shadow-lg ring-1 ring-black/10',
          'text-white transition-all duration-200',
          'flex items-center justify-center cursor-grab active:cursor-grabbing',
          isOpen
            ? 'bg-gradient-to-br from-violet-600 via-fuchsia-600 to-indigo-600 ring-violet-400/40 scale-90'
            : 'bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-violet-600 hover:shadow-xl',
        )}
      >
        {isOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <MessageSquareText className="h-6 w-6" />
        )}

        {!isOpen && alertCount > 0 && (
          <span
            aria-label={`${String(alertCount)} unread alerts`}
            className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-semibold flex items-center justify-center ring-2 ring-white"
          >
            {alertCount > 9 ? '9+' : alertCount}
          </span>
        )}
      </button>
    </motion.div>
  );
}
