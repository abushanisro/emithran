'use client';

import { ChevronDown, ChevronUp, Cpu, FileText, Layers, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { DesignView, ItemType } from '@/lib/api/electronics';
import {
  buildDesignTree,
  containerDetails,
  detailItems,
  isInFlight,
  itemTypeLabel,
  levelLabel,
  statusLabel,
  typeLabel,
  type DesignNode,
} from '@/lib/electronics/design-view';

import { BoardThumbnail } from './BoardThumbnail';

// The same card as a BOM item row, nested the same way: coloured left border by level (Assembly emerald, Sub-Assembly blue,
// Child Part amber), a thumbnail tile, name with type badges, a grid of label/value pairs, a level badge, and icon actions.
const LEVEL_STYLE: Record<ItemType, { border: string; badge: string }> = {
  assembly: { border: 'border-l-emerald-500', badge: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' },
  sub_assembly: { border: 'border-l-blue-500', badge: 'bg-blue-500/10 text-blue-700 border-blue-500/20' },
  child_part: { border: 'border-l-amber-500', badge: 'bg-amber-500/10 text-amber-700 border-amber-500/20' },
};

interface Props {
  designs: DesignView[];
  onOpen: (design: DesignView) => void;
  /** A new revision of a child part. */
  onAddRevision?: (design: DesignView) => void;
  /** A new sub-assembly inside an assembly or sub-assembly. */
  onAddSubAssembly?: (container: DesignView) => void;
  /** A new child part (an upload) inside an assembly or sub-assembly. */
  onAddChildPart?: (container: DesignView) => void;
  /** Delete this item and everything below it (the caller confirms). */
  onDelete?: (node: DesignNode) => void;
  /** Delete one revision of a child part (the caller confirms). */
  onDeleteRevision?: (design: DesignView, revisionId: string) => void;
}

export function ElectronicsItemsList({ designs, onOpen, onAddRevision, onAddSubAssembly, onAddChildPart, onDelete, onDeleteRevision }: Props) {
  const tree = useMemo(() => buildDesignTree(designs), [designs]);
  // Containers start open; a person's choice is kept.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showRevisions, setShowRevisions] = useState<Set<string>>(new Set());
  const flip = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const render = (node: DesignNode): React.ReactElement => {
    const design = node.design;
    const container = design.itemType !== 'child_part';
    const style = LEVEL_STYLE[design.itemType];
    const latest = design.revisions[0] ?? null;
    const isCollapsed = collapsed.has(design.id);
    const revisionsOpen = showRevisions.has(design.id);
    const details = container ? containerDetails(node) : detailItems(design);

    return (
      <div key={design.id} className="space-y-1">
        <div
          data-testid={`design-${design.id}`}
          data-item-type={design.itemType}
          className={`relative rounded-md border border-l-4 bg-card text-card-foreground shadow-xs transition-all duration-200 ${style.border}`}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]')) return;
            if (container) setCollapsed((c) => flip(c, design.id));
            else onOpen(design);
          }}
        >
          <div className="p-4">
            <div className="flex flex-col items-start justify-between gap-3 md:flex-row">
              <div className="relative flex h-24 w-32 shrink-0 items-center justify-center rounded-md bg-secondary/50">
                {container ? <Layers className="h-10 w-10 text-muted-foreground" /> : <BoardThumbnail kind={design.kind === 'board' ? 'board' : 'harness'} uploadId={latest?.uploadId ?? null} ready={latest?.status === 'needs_review' || latest?.status === 'confirmed'} />}
                <Badge className="absolute bottom-1 left-1 h-4 px-1 text-[10px]">{container ? 'ASM' : design.kind === 'board' ? 'PCB' : 'WIRE'}</Badge>
              </div>

              <div className="w-full min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {(container ? node.children.length > 0 : design.revisions.length > 1) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-full border p-0"
                      aria-label={container ? (isCollapsed ? 'Show contents' : 'Hide contents') : revisionsOpen ? 'Hide revisions' : 'Show revisions'}
                      onClick={() => {
                        if (container) setCollapsed((c) => flip(c, design.id));
                        else setShowRevisions((s) => flip(s, design.id));
                      }}
                    >
                      {(container ? !isCollapsed : revisionsOpen) ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                  <h3 className="max-w-[200px] truncate text-base font-semibold text-foreground md:max-w-none">{design.name}</h3>
                  <Badge variant="outline" className={`text-xs font-medium ${style.badge}`}>{itemTypeLabel(design.itemType)}</Badge>
                  {!container && <Badge variant="outline" className="text-xs">{typeLabel(design)}</Badge>}
                  {!container && (
                    <Badge variant={latest?.status === 'failed' ? 'destructive' : 'secondary'} className="text-xs">{statusLabel(latest?.status ?? null)}</Badge>
                  )}
                </div>

                {!container && latest?.status === 'failed' && latest.failure && (
                  <p className="mb-2 text-xs text-destructive" data-testid={`failure-${design.id}`}>
                    The files could not be read: {latest.failure.message}. Add the missing files as a new revision (the + button).
                  </p>
                )}

                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs sm:grid-cols-3 lg:grid-cols-6">
                  <div>
                    <span className="text-muted-foreground">Level: </span>
                    <Badge variant="outline" className="h-4 px-1 text-[10px] font-medium">{levelLabel(node.depth)}</Badge>
                  </div>
                  {details.map((item) => (
                    <div key={item.label}>
                      <span className="text-muted-foreground">{item.label}: </span>
                      <span className="font-medium">{item.value}</span>
                    </div>
                  ))}
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Created: </span>
                    <span className="font-medium">{new Date(design.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex w-full flex-wrap items-center justify-end gap-1.5 md:mt-0 md:w-auto">
                {!container && (
                  <>
                    <Button variant="outline" size="icon" className="h-8 w-8" title="Files and revisions" onClick={() => { onOpen(design); }}>
                      <FileText className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Viewer, features and cost" onClick={() => { onOpen(design); }}>
                      <Cpu className="h-4 w-4 text-brand-500" />
                    </Button>
                  </>
                )}
                {container && (onAddSubAssembly ?? onAddChildPart) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="default" size="icon" className="h-8 w-8 rounded-full" title="Add to this assembly" aria-label={`Add to ${design.name}`}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {onAddSubAssembly && <DropdownMenuItem onSelect={() => { onAddSubAssembly(design); }}>Sub-Assembly</DropdownMenuItem>}
                      {onAddChildPart && <DropdownMenuItem onSelect={() => { onAddChildPart(design); }}>Child Part</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {!container && onAddRevision && (
                  <Button variant="default" size="icon" className="h-8 w-8 rounded-full" title="Add a revision" aria-label={`Add a revision of ${design.name}`} onClick={() => { onAddRevision(design); }}>
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
                {onDelete && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    title="Delete"
                    aria-label={`Delete ${design.name}`}
                    onClick={() => { onDelete(node); }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          {!container && revisionsOpen && design.revisions.length > 1 && (
            <ul className="space-y-1 border-t px-4 py-2 text-xs">
              {design.revisions.map((r) => (
                <li key={r.id} className="flex items-center gap-3">
                  <span className="font-medium">Revision {r.revision}</span>
                  <Badge variant={r.status === 'failed' ? 'destructive' : 'outline'} className="text-[10px]">{statusLabel(r.status)}</Badge>
                  <span className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
                  {isInFlight(r.status) && <span className="text-muted-foreground">reading files…</span>}
                  {onDeleteRevision && (
                    <button
                      type="button"
                      className="ml-auto text-muted-foreground hover:text-destructive"
                      title={`Delete revision ${r.revision}`}
                      aria-label={`Delete revision ${r.revision} of ${design.name}`}
                      onClick={() => { onDeleteRevision(design, r.id); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {container && !isCollapsed && node.children.length > 0 && <div className="ml-6 space-y-1 border-l pl-3">{node.children.map(render)}</div>}
      </div>
    );
  };

  return <div className="space-y-2">{tree.map(render)}</div>;
}
