"use client";

import { groupFeatures, notAssessed, type FeatureGroup, type PlasticFeatureGraph } from "@/lib/plastic/recognised-features";
import type { FeatureNodeV2 } from "@/lib/types/manufacturing";

const READING_NOTE =
  "A reading of the staged variable notes, not a vendor rule: the engine's own definition is written in its source and carried with the feature.";

/** The viewer highlight for a group: every occurrence that has a place in the part. Null when none has (a legacy rib count). */
function highlightOf(group: FeatureGroup): FeatureNodeV2 | null {
  const occurrences = group.items.flatMap((i) => i.occurrences.flatMap((o) => (o.centroid && o.face_ids.length > 0 ? [{ centroid: o.centroid, face_ids: o.face_ids }] : [])));
  return occurrences.length > 0 ? ({ id: `hl-plastic-${group.type}`, feature_type: group.type, occurrences } as unknown as FeatureNodeV2) : null;
}

/**
 * What the CAD engine recognised on the part, by catalog feature type: how many, which are readings of the staged notes, and a click that highlights them
 * in the 3D view. Types the engine did not assess are named with the reason, so their absence is never read as "none found".
 */
export function PlasticRecognisedFeatures({ graph, onSelectHighlight }: { graph: PlasticFeatureGraph; onSelectHighlight?: ((node: FeatureNodeV2 | null) => void) | undefined }) {
  const groups = groupFeatures(graph.items);
  const missing = notAssessed(graph);
  return (
    <div className="space-y-1 border-b border-border/40 px-3 py-2 text-[11px]">
      <div className="font-medium text-foreground">Recognised features</div>
      {groups.length === 0 && <div className="text-muted-foreground">Nothing was recognised.</div>}
      <ul className="divide-y divide-border/30">
        {groups.map((g) => {
          const highlight = onSelectHighlight ? highlightOf(g) : null;
          return (
            <li key={g.type}>
              <button
                type="button"
                disabled={!highlight}
                onClick={() => { onSelectHighlight?.(highlight); }}
                className="flex w-full items-baseline gap-2 py-1 text-left enabled:hover:bg-muted/40 disabled:cursor-default"
              >
                <span className="flex-1 truncate">{g.type}</span>
                {g.reading && <span className="rounded border border-amber-500/40 px-1 text-[9px] text-amber-700 dark:text-amber-500" title={READING_NOTE}>reading</span>}
                <span className="font-medium tabular-nums">× {g.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {missing.length > 0 && (
        <div className="space-y-0.5 text-muted-foreground">
          <div>Not assessed:</div>
          {missing.map((m) => (
            <div key={m.type} className="pl-2">
              <span className="text-foreground">{m.type}</span>: {m.reason}
            </div>
          ))}
        </div>
      )}
      {graph.unclassified_faces > 0 && <div className="text-muted-foreground">{graph.unclassified_faces} faces could not be typed.</div>}
    </div>
  );
}
