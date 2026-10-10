'use client';

import { useMemo } from 'react';
import { Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ModelViewer } from '@/components/ui/model-viewer';
import { CadFeatureViewer } from '@/components/features/cad-feature-viewer/CadFeatureViewer';
import type { FieldHighlight } from '@/lib/features/field-highlight';
import type { FaceMapEntry } from '@/lib/types/manufacturing';

export interface CadEvidence {
  fieldLabel: string;
  /** null when this analysis did not record the CAD faces for the value: the part needs re-analysis. */
  highlight: FieldHighlight | null;
}

interface CadEvidencePanelProps {
  evidence: CadEvidence;
  /** null while the page has no signed URL for the model (still loading, or it failed). */
  fileUrl: string | null;
  /** Why the page has no URL, when it failed (otherwise it is still being fetched). */
  modelError?: string | null;
  fileName: string;
  fileType: string;
  faceMap: FaceMapEntry[] | null;
  sheetThickness?: number;
  /** Real setup-axis directions, when the engine proved any. */
  axes?: Array<[number, number, number]>;
  /** Re-run the CAD analysis of this part (the page's Refresh Analysis). */
  onReanalyse: () => void;
  reanalysing: boolean;
  onClose: () => void;
}

/**
 * A small window beside the calculator (same slot as the reference-table panel)
 * showing the part with only the faces a calculator input was measured on.
 * Read-only; face ids are only ever indices into this part's own face_map.
 */
export function CadEvidencePanel({
  evidence, fileUrl, modelError, fileName, fileType, faceMap, sheetThickness, axes, onReanalyse, reanalysing, onClose,
}: CadEvidencePanelProps) {
  const { highlight } = evidence;
  const faceIds = useMemo(() => highlight?.node.occurrences.flatMap((o) => o.face_ids) ?? [], [highlight]);
  return (
    <div className="fixed top-16 left-4 z-[60] w-[480px] rounded-lg border border-border bg-background shadow-xl flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div>
          <h3 className="font-semibold text-sm">CAD evidence: {evidence.fieldLabel}</h3>
          {highlight ? (
            <p className={`text-xs ${highlight.reconciles ? 'text-muted-foreground' : 'text-amber-600'}`}>
              {highlight.measured.label} = {Math.round(highlight.measured.value * 10) / 10} {highlight.measured.unit}
              {!highlight.reconciles && ` — ${highlight.note ?? 'these faces do not fully account for the extracted value'}`}
            </p>
          ) : (
            <p className="text-xs text-amber-600">The CAD faces for this value were not recorded by this analysis</p>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0" title="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>
      {!highlight ? (
        <div className="flex flex-col items-start gap-3 p-4 text-sm">
          <p>
            This part was analysed before the CAD engine recorded the faces behind this value. Re-analyse the part to
            record them, then click the eye again.
          </p>
          <Button type="button" size="sm" onClick={onReanalyse} disabled={reanalysing}>
            {reanalysing ? 'Re-analysing…' : 'Re-analyse part'}
          </Button>
        </div>
      ) : !fileUrl ? (
        modelError ? (
          <p className="p-4 text-sm text-muted-foreground">
            The 3D model could not be loaded ({modelError}), so the faces cannot be drawn. The measured value above is still the engine's.
          </p>
        ) : (
          <div role="status" className="flex h-[360px] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Preparing 3D model…
          </div>
        )
      ) : (
      <div className="h-[360px]">
        {fileType.toLowerCase() === 'stl' ? (
          <CadFeatureViewer fileUrl={fileUrl} faceMap={faceMap} faceIds={faceIds} {...(axes ? { axes } : {})} />
        ) : (
          // STEP/other models need the main viewer's server-side conversion.
          <ModelViewer
            key={fileUrl}
            fileUrl={fileUrl}
            fileName={fileName}
            fileType={fileType}
            highlightOccurrences={highlight.node}
            faceMap={faceMap}
            {...(sheetThickness !== undefined ? { sheetThickness } : {})}
          />
        )}
      </div>
      )}
    </div>
  );
}
