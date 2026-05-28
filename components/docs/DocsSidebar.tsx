'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MethodBadge } from './MethodBadge';
import { buildSidebarTree } from '@/lib/docs/docs-navigation';
import type { ApiSpec } from '@/lib/docs/api-spec-types';

interface DocsSidebarProps {
  spec: ApiSpec;
  activeSection: string;
  activeEndpoint: string;
}

export function DocsSidebar({ spec, activeSection, activeEndpoint }: DocsSidebarProps) {
  const tree = buildSidebarTree(spec, activeSection, activeEndpoint);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    spec.groups.forEach((g) => {
      init[g.id] = g.id === activeSection;
    });
    return init;
  });

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <aside className="w-[280px] shrink-0 border-r border-border/60 bg-background/50 h-[calc(100vh-57px)] sticky top-[57px] overflow-y-auto">
      <nav className="p-4 space-y-1">
        {/* Introduction link */}
        <Link
          href="/developer"
          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors mb-3"
        >
          Introduction
        </Link>

        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-3 mb-2">
          API Reference
        </div>

        {tree.map(({ group, isActive, endpoints }) => (
          <div key={group.id}>
            {/* Group header */}
            <button
              onClick={() => toggleGroup(group.id)}
              className={cn(
                'w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'text-foreground bg-muted/60'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
              )}
            >
              <span>{group.label}</span>
              <span className="ml-auto mr-1.5 text-[10px] tabular-nums text-muted-foreground/50 font-normal">
                {endpoints.length}
              </span>
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 transition-transform text-muted-foreground/60 shrink-0',
                  openGroups[group.id] && 'rotate-90',
                )}
              />
            </button>

            {/* Endpoint list */}
            {openGroups[group.id] && (
              <div className="ml-3 border-l border-border/60 pl-3 mt-1 mb-2 space-y-0.5">
                {endpoints.map(({ endpoint, isActive: epActive, href }) => (
                  <Link
                    key={endpoint.id}
                    href={href}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors',
                      epActive
                        ? 'text-foreground bg-primary/10 font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
                    )}
                  >
                    <MethodBadge method={endpoint.method} size="sm" />
                    <span className="truncate">{endpoint.summary}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}
