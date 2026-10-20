'use client';

import { Cable, CircuitBoard, FolderTree, Layers } from 'lucide-react';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import type { DesignView } from '@/lib/api/electronics';
import { buildDesignTree, itemTypeLabel, levelLabel, statusLabel, typeLabel, type DesignNode } from '@/lib/electronics/design-view';

// The project as a hierarchy: Assembly > Sub-Assembly > Child Part, and each part's revisions. Component lines (BOM) join this
// tree once they are extracted.
export function ElectronicsTreeView({
  projectName,
  designs,
  onOpen,
}: {
  projectName: string;
  designs: DesignView[];
  onOpen: (design: DesignView, revisionId?: string) => void;
}) {
  const tree = useMemo(() => buildDesignTree(designs), [designs]);

  const render = (node: DesignNode): React.ReactElement => {
    const d = node.design;
    const container = d.itemType !== 'child_part';
    return (
      <li key={d.id}>
        {container ? (
          <div className="flex items-center gap-2 font-medium">
            <Layers className="h-4 w-4 text-muted-foreground" />
            {d.name}
            <Badge variant="outline" className="text-xs">{itemTypeLabel(d.itemType)}</Badge>
            <span className="text-xs text-muted-foreground">{levelLabel(node.depth)}</span>
          </div>
        ) : (
          <>
            <button type="button" className="flex items-center gap-2 font-medium hover:underline" onClick={() => { onOpen(d); }}>
              {d.kind === 'board' ? <CircuitBoard className="h-4 w-4 text-muted-foreground" /> : <Cable className="h-4 w-4 text-muted-foreground" />}
              {d.name}
              <Badge variant="outline" className="text-xs">{typeLabel(d)}</Badge>
              <span className="text-xs text-muted-foreground">{levelLabel(node.depth)}</span>
            </button>
            <ul className="ml-3 mt-1 space-y-1 border-l pl-4 text-xs">
              {d.revisions.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <button type="button" className="hover:underline" onClick={() => { onOpen(d, r.id); }}>Revision {r.revision}</button>
                  <Badge variant={r.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px]">{statusLabel(r.status)}</Badge>
                </li>
              ))}
            </ul>
          </>
        )}
        {node.children.length > 0 && <ul className="ml-3 mt-1 space-y-2 border-l pl-4">{node.children.map(render)}</ul>}
      </li>
    );
  };

  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-2 font-semibold"><FolderTree className="h-4 w-4" />{projectName}</div>
      <ul className="ml-3 space-y-2 border-l pl-4">{tree.map(render)}</ul>
    </div>
  );
}
