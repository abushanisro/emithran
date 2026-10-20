'use client';

import { Cable, CircuitBoard } from 'lucide-react';
import { useMemo } from 'react';

import { useBoardThumbnail } from '@/lib/api/hooks/useElectronics';

interface Props {
  kind: 'board' | 'harness';
  /** The upload to draw, when its files were read (status needs_review or confirmed). */
  uploadId: string | null;
  ready: boolean;
}

// The tile on a list card: the board as drawn from its own files. The SVG comes from customer files, so it is shown through an
// <img> (a data URL image cannot run script or load anything) and never injected into the page. Without a picture (a harness,
// a board still parsing, none stored and the engine unreachable) the card keeps its icon.
export function BoardThumbnail({ kind, uploadId, ready }: Props) {
  const { data } = useBoardThumbnail(kind === 'board' ? uploadId : null, ready);
  const src = useMemo(() => (data?.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.svg)}` : null), [data?.svg]);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- a data URL of an SVG; next/image would add nothing
    return <img src={src} alt="Board layout" data-testid="board-thumbnail" className="h-full w-full rounded-md bg-emerald-950 object-contain p-1" />;
  }
  return kind === 'board' ? <CircuitBoard className="h-10 w-10 text-muted-foreground" /> : <Cable className="h-10 w-10 text-muted-foreground" />;
}
