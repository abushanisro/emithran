'use client';

import { X } from 'lucide-react';
import { FEATURE_GROUP_META, featureGroupFromType } from '@/lib/utils/feature-colors';
import type { FeatureGroup } from '@/lib/utils/feature-colors';

interface Props {
  feature: any;        // ManufacturingFeature from brief.featureGraph
  reason: string;      // from DraftProcessPayload.reason
  onClose: () => void;
}

export function FeatureExplainCard({ feature, reason, onClose }: Props) {
  const group = featureGroupFromType(feature?.type) as FeatureGroup;
  const meta  = FEATURE_GROUP_META[group] ?? FEATURE_GROUP_META.GENERAL;
  const conf  = feature?.confidence != null ? Math.round(feature.confidence * 100) : null;

  const sourceLabel =
    feature?.source === 'drawing'  ? '2D Drawing (Claude Vision)' :
    feature?.source === 'geometry' ? '3D Geometry Analysis' :
    feature?.source === 'bom'      ? 'BOM Inference' : 'AI Detected';

  const confColor =
    conf == null         ? 'text-muted-foreground' :
    conf >= 90           ? 'text-emerald-400' :
    conf >= 70           ? 'text-amber-400'   : 'text-red-400';

  return (
    <div className="mt-1.5 rounded-md border bg-card/90 backdrop-blur-sm text-xs shadow-lg">
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b">
        <div className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: meta.hexColor }}
          />
          <span className="font-semibold text-foreground">
            {meta.label} — {feature?.type ?? ''}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="px-2.5 py-2 space-y-1.5">
        {/* Feature details */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
          {feature?.count && (
            <span>×{feature.count}</span>
          )}
          {feature?.spec && (
            <span className="font-mono">{feature.spec}</span>
          )}
          {feature?.diameter && (
            <span>⌀{feature.diameter} mm</span>
          )}
          {feature?.depth && (
            <span>depth {feature.depth} mm</span>
          )}
          {feature?.throughHole === true && <span>Through</span>}
          {feature?.throughHole === false && <span>Blind</span>}
        </div>

        {/* Source + confidence */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{sourceLabel}</span>
          {conf != null && (
            <span className={`font-semibold tabular-nums ${confColor}`}>{conf}% confidence</span>
          )}
        </div>

        {/* AI reason */}
        {reason && (
          <div className="border-t pt-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">AI Reason</p>
            <p className="text-[11px] text-foreground/80 leading-relaxed">{reason}</p>
          </div>
        )}
      </div>
    </div>
  );
}
