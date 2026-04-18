"use client";
import { cn } from "@/lib/utils";
import { useRef } from "react";

export const GlareCard = ({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) => {
  const isPointerInside = useRef(false);
  const refElement = useRef<HTMLDivElement>(null);
  const state = useRef({
    glare: {
      x: 50,
      y: 50,
    },
  });

  const containerStyle = {
    "--m-x": "50%",
    "--m-y": "50%",
    "--duration": "300ms",
    "--opacity": "0",
    "--radius": "8px",
    "--easing": "ease",
    "--transition": "var(--duration) var(--easing)",
  } as any;

  const updateStyles = () => {
    if (refElement.current) {
      const { glare } = state.current;
      refElement.current?.style.setProperty("--m-x", `${glare.x}%`);
      refElement.current?.style.setProperty("--m-y", `${glare.y}%`);
    }
  };

  return (
    <div
      style={containerStyle}
      className="relative isolate w-full h-auto transition-all duration-300 ease-out hover:shadow-lg hover:shadow-primary/5"
      ref={refElement}
      onClick={onClick}
      onPointerMove={(event) => {
        const target = event.target as HTMLElement;
        // Don't interfere with buttons
        if (target.closest('button, a, input, select, textarea')) return;
        
        const rect = event.currentTarget.getBoundingClientRect();
        const position = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
        const percentage = {
          x: (100 / rect.width) * position.x,
          y: (100 / rect.height) * position.y,
        };

        state.current.glare.x = percentage.x;
        state.current.glare.y = percentage.y;
        updateStyles();
      }}
      onPointerEnter={() => {
        isPointerInside.current = true;
        if (refElement.current) {
          refElement.current?.style.setProperty("--opacity", "0.3");
        }
      }}
      onPointerLeave={() => {
        isPointerInside.current = false;
        if (refElement.current) {
          refElement.current?.style.setProperty("--opacity", "0");
        }
      }}
    >
      <div className="relative overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        {/* Content */}
        <div className={cn("relative z-10 h-full w-full", className)}>
          {children}
        </div>
        
        {/* Glare Effect */}
        <div 
          className="absolute inset-0 opacity-[var(--opacity)] transition-opacity duration-300 ease-out pointer-events-none"
          style={{
            background: `radial-gradient(circle at var(--m-x) var(--m-y), 
              hsla(187, 100%, 42%, 0.15) 0%, 
              hsla(187, 100%, 55%, 0.1) 25%, 
              transparent 50%)`
          }}
        />
      </div>
    </div>
  );
};