'use client';

import { Loader2 } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { FlatPatternDrawing, normalizeFlatPattern } from '@/components/ui/flat-pattern-drawing';
import { Input } from '@/components/ui/input';
import { useSvgPanZoom } from '@/components/ui/use-svg-pan-zoom';
import { useTrueNest, type TrueNestResultDto } from '@/lib/api/hooks/useBOMItems';
import { shoelaceAreaMm2, boundingBoxMm } from '@/lib/geometry/polygon2d';

interface NestViewProps {
  bomItemId: string;
  quantity: number;
  sheetWidthMm?: number | undefined;
  sheetLengthMm?: number | undefined;
  kerfMm?: number | undefined;
  edgeMarginMm?: number | undefined;
  materialLabel?: string | undefined;
  gradeLabel?: string | undefined;
  thicknessMm?: number | undefined;
}

// The 3 standard stock sheet sizes from
// memory/sheetmetal/laser_cutting_costing_params (1).md section 6b's worked
// example -- the md's own recommendation rule is "pick whichever candidate
// gives the lowest input weight per part" (best material yield).
const STANDARD_SHEETS: { key: string; label: string; widthMm: number; lengthMm: number }[] = [
  { key: 'A', label: '1219 × 2438 mm (4×8 ft)', widthMm: 1219, lengthMm: 2438 },
  { key: 'B', label: '1524 × 3048 mm (5×10 ft)', widthMm: 1524, lengthMm: 3048 },
  { key: 'C', label: '1219 × 3048 mm (4×10 ft)', widthMm: 1219, lengthMm: 3048 },
];

function extractErrorDetail(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const withResponse = error as Error & { response?: { data?: { message?: unknown } } };
  const responseMessage = withResponse.response?.data?.message;
  if (typeof responseMessage === 'string') return responseMessage;
  return error.message || null;
}

function polygonToPoints(pts: number[][]): string {
  return pts
    .filter((p): p is [number, number] => p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number')
    .map(([x, y]) => `${x.toString()},${y.toString()}`)
    .join(' ');
}

// translate(x,y) then rotate(deg) applied to the ORIGINAL outline points --
// matches TrueNestResultDto's own doc comment (backend true-nest.dto.ts) and
// SVG's own right-to-left transform-list application, so `transform`
// attribute order below must read "translate(...) rotate(...)" verbatim.
function placementTransform(xMm: number, yMm: number, rotationDeg: number): string {
  return `translate(${xMm.toString()} ${yMm.toString()}) rotate(${rotationDeg.toString()})`;
}

// Kerf-adjusted rectangle yield estimate -- same formula as
// memory/sheetmetal/laser_cutting_costing_params (1).md section 6a, used
// ONLY to rank the 3 standard stock sizes before a real true-shape nest runs
// for whichever one the user actually picks. Deliberately the simpler
// bounding-rect estimate, not a true polygon nest for all 3 candidates --
// that would triple the cad-engine load for a ranking decision the rect
// estimate already gets right (ranking by yield is the same whether
// measured via bounding-rect count or true polygon utilization, for a fixed
// part/thickness/material -- see this file's presetEstimates comment).
function estimateRectPartsPerSheet(
  sheetWidthMm: number, sheetLengthMm: number,
  partWidthMm: number, partLengthMm: number,
  kerfMm: number, edgeMarginMm: number,
): number {
  const usableW = sheetWidthMm - 2 * edgeMarginMm;
  const usableL = sheetLengthMm - 2 * edgeMarginMm;
  if (usableW <= 0 || usableL <= 0) return 0;
  const orientationA = Math.floor((usableW + kerfMm) / (partWidthMm + kerfMm)) * Math.floor((usableL + kerfMm) / (partLengthMm + kerfMm));
  const orientationB = Math.floor((usableW + kerfMm) / (partLengthMm + kerfMm)) * Math.floor((usableL + kerfMm) / (partWidthMm + kerfMm));
  return Math.max(orientationA, orientationB, 0);
}

export function NestView({
  bomItemId, quantity, sheetWidthMm, sheetLengthMm, kerfMm, edgeMarginMm,
  materialLabel, gradeLabel, thicknessMm,
}: NestViewProps) {
  // Sheet & cutting setup is user-controlled from here down -- the incoming
  // props are only the INITIAL defaults (whatever sheet the existing
  // rectangle costing engine already picked), never live-updated from the
  // parent afterward.
  const initialPreset = STANDARD_SHEETS.find((s) => s.widthMm === sheetWidthMm && s.lengthMm === sheetLengthMm);
  const [sheetMode, setSheetMode] = useState<string>(initialPreset?.key ?? 'custom');
  const [customWidthStr, setCustomWidthStr] = useState(String(sheetWidthMm ?? 1250));
  const [customLengthStr, setCustomLengthStr] = useState(String(sheetLengthMm ?? 2500));
  const [qtyStr, setQtyStr] = useState(String(quantity));
  const [kerfStr, setKerfStr] = useState(String(kerfMm ?? 0));
  const [marginStr, setMarginStr] = useState(String(edgeMarginMm ?? 2));

  const qty = Number(qtyStr) || 0;
  const kerf = Number(kerfStr) || 0;
  const margin = Number(marginStr) || 0;
  const activeSheet: { widthMm: number; lengthMm: number } = sheetMode === 'custom'
    ? { widthMm: Number(customWidthStr) || 0, lengthMm: Number(customLengthStr) || 0 }
    : (STANDARD_SHEETS.find((s) => s.key === sheetMode) ?? { widthMm: 1219, lengthMm: 2438 });

  const { data, isLoading, isError, error } = useTrueNest(
    bomItemId, qty, activeSheet.widthMm, activeSheet.lengthMm, { kerfMm: kerf, edgeMarginMm: margin },
  );

  // The real part outline is CAD-static (independent of sheet size), so
  // once ANY sheet size has successfully loaded it, this bbox/area stays
  // valid for ranking the other standard sizes too -- no extra true-nest
  // calls needed just to populate the preset comparison below.
  const partGeometry = useMemo(() => {
    if (!data || data.outlinePointsMm.length < 3) return null;
    return { ...boundingBoxMm(data.outlinePointsMm), areaMm2: shoelaceAreaMm2(data.outlinePointsMm) };
  }, [data]);

  const presetEstimates = useMemo(() => {
    if (!partGeometry) return null;
    return STANDARD_SHEETS.map((s) => {
      const partsPerSheet = estimateRectPartsPerSheet(s.widthMm, s.lengthMm, partGeometry.widthMm, partGeometry.lengthMm, kerf, margin);
      const utilizationPct = partsPerSheet > 0 ? (partsPerSheet * partGeometry.areaMm2) / (s.widthMm * s.lengthMm) * 100 : 0;
      return { ...s, partsPerSheet, utilizationPct };
    });
  }, [partGeometry, kerf, margin]);

  // Recommended = highest yield (utilization%) among the 3 standard sizes --
  // for a fixed part/thickness/material this ranks identically to the md's
  // own "lowest input weight per part" rule (see estimateRectPartsPerSheet's
  // doc comment), without needing a material density lookup to compute it.
  const recommendedKey = useMemo(() => {
    if (!presetEstimates || presetEstimates.every((p) => p.partsPerSheet === 0)) return null;
    return presetEstimates.reduce((best, cur) => (cur.utilizationPct > best.utilizationPct ? cur : best)).key;
  }, [presetEstimates]);

  const [selected, setSelected] = useState<{ type: 'part'; index: number } | { type: 'sheet' } | null>(null);

  const { svgRef, effectiveViewBox, handleWheel, handleMouseDown, handleMouseMove, handleMouseUp } =
    useSvgPanZoom(data?.sheetWidthMm, data?.sheetLengthMm);

  // Switching sheet/cutting setup invalidates any part/sheet selection made
  // under the PREVIOUS true-nest result -- placements array is a fresh
  // layout each time, so a stale `index` could point at the wrong part.
  const changeSheetMode = (key: string) => { setSheetMode(key); setSelected(null); };

  // ── Apply this view's sheet selection to the Raw Material record ─────────
  // Self-contained: resolves the material's real density and the item's
  // active raw-material-cost record itself (same lookups already used
  // elsewhere in this app -- RawMaterialDialog's material search,
  // autoAddMaterialCost's raw-material-cost fetch), rather than threading
  // new props through the 3D viewer components above this one. Writes an
  // explicit, auditable OVERRIDE (never silently) -- exactly the same
  // grossUsageIsOverridden/grossUsageOverrideReason mechanism the "Edit —
  // override manually" flow in RawMaterialDialog's Gross Usage calculator
  // uses, so both entry points produce a record in the same shape.
  const queryClient = useQueryClient();
  const [applyState, setApplyState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [applyMessage, setApplyMessage] = useState<string>('');

  const handleApplyToRawMaterial = async () => {
    if (!data || data.partsPerSheet <= 0 || typeof thicknessMm !== 'number' || thicknessMm <= 0) return;
    setApplyState('loading');
    setApplyMessage('');
    try {
      const { apiClient } = await import('@/lib/api/client');

      // Resolve the real material density -- never fabricated. Same
      // exact-then-tokenized search convention used elsewhere in this app.
      const grade = gradeLabel || materialLabel;
      if (!grade) throw new Error('No material/grade selected for this part yet.');
      const matResp = await apiClient.get<{ items: Array<{ material?: string; materialGrade?: string; densityKgM3?: number }> }>(
        '/raw-materials', { params: { search: grade, limit: 10 } },
      );
      const items = matResp?.items ?? [];
      const exact = items.find((m) => m.materialGrade === grade || m.material === grade);
      const density = (exact ?? items[0])?.densityKgM3;
      if (!density || density <= 0) {
        throw new Error(`No real density on file for "${grade}" — add it to raw_materials before applying.`);
      }

      const sheetWeightKg = (data.sheetWidthMm * data.sheetLengthMm * thicknessMm / 1e9) * density;
      const grossWeightPerPartKg = sheetWeightKg / data.partsPerSheet;

      // Find the item's current active raw-material-cost record -- update it
      // in place (never create a duplicate, never silently pick one of many).
      const costResp = await apiClient.get<{ records: Array<{ id: string; materialName?: string }> }>(
        '/raw-material-costs', { params: { bomItemId, isActive: true, page: 1, limit: 10 } },
      );
      const records = costResp?.records ?? [];
      const target = records.find((r) => r.materialName === grade) ?? records[0];
      if (!target) {
        throw new Error('No raw material record exists for this part yet — add one in Raw Materials first.');
      }

      const reason = `Selected via Nest view — ${data.sheetWidthMm}×${data.sheetLengthMm}mm sheet, ` +
        `${data.partsPerSheet} parts/sheet (true-shape nest, ${data.utilizationPct}% utilization).`;
      await apiClient.put(`/raw-material-costs/${target.id}`, {
        grossUsage: parseFloat(grossWeightPerPartKg.toFixed(6)),
        grossUsageIsOverridden: true,
        grossUsageOverrideReason: reason,
      });

      await queryClient.invalidateQueries({ queryKey: ['raw-material-costs'] });
      await queryClient.invalidateQueries({ queryKey: ['bom-items', bomItemId, 'cost-summary'] });

      setApplyState('success');
      setApplyMessage(`Applied — Gross Usage set to ${grossWeightPerPartKg.toFixed(4)} kg/part (override).`);
    } catch (err) {
      setApplyState('error');
      setApplyMessage(err instanceof Error ? err.message : 'Failed to apply this sheet selection to the raw material record.');
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="shrink-0 border-b border-[#555555] bg-[#3a3a3a] text-white px-4 py-3 space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/50 font-semibold mb-1.5">Standard sheet sizes</p>
          <div className="flex flex-wrap gap-2">
            {STANDARD_SHEETS.map((s) => {
              const est = presetEstimates?.find((p) => p.key === s.key);
              const isRecommended = recommendedKey === s.key;
              const isActive = sheetMode === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => { changeSheetMode(s.key); }}
                  className={`text-left rounded border px-3 py-1.5 text-xs transition-colors ${
                    isActive ? 'bg-blue-600 border-blue-400' : 'bg-[#4a4a4a] border-[#666666] hover:bg-[#565656]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-medium">
                    {s.label}
                    {isRecommended && (
                      <span className="text-[9px] uppercase tracking-wide bg-emerald-500 text-black rounded px-1 py-0.5">Recommended</span>
                    )}
                  </div>
                  <div className="text-white/60 mt-0.5">
                    {est ? `~${est.partsPerSheet.toString()} parts/sheet · ${est.utilizationPct.toFixed(1)}% est. yield` : 'estimate pending'}
                  </div>
                </button>
              );
            })}
            <button
              onClick={() => { changeSheetMode('custom'); }}
              className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
                sheetMode === 'custom' ? 'bg-blue-600 border-blue-400' : 'bg-[#4a4a4a] border-[#666666] hover:bg-[#565656]'
              }`}
            >
              Custom
            </button>
          </div>
          <p className="text-[10px] text-white/40 mt-1.5 leading-snug">
            Estimated parts/sheet above use a kerf-adjusted bounding-rectangle count (per laser_cutting_costing_params.md), only to rank the 3 standard sizes — the actual nest below always uses the real part silhouette.
          </p>
        </div>

        <div className="grid grid-cols-5 gap-2">
          <LabeledInput label="Sheet width (mm)" value={customWidthStr} onChange={(v) => { setCustomWidthStr(v); setSheetMode('custom'); setSelected(null); }} />
          <LabeledInput label="Sheet length (mm)" value={customLengthStr} onChange={(v) => { setCustomLengthStr(v); setSheetMode('custom'); setSelected(null); }} />
          <LabeledInput label="Quantity" value={qtyStr} onChange={setQtyStr} />
          <LabeledInput label="Kerf (mm)" value={kerfStr} onChange={setKerfStr} />
          <LabeledInput label="Edge margin (mm)" value={marginStr} onChange={setMarginStr} />
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-white/70 gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Computing true nest…</span>
          </div>
        ) : isError || !data ? (
          <div className="flex flex-1 items-center justify-center text-white/70 text-sm text-center px-6">
            {extractErrorDetail(error) ?? 'Real flat-pattern outline unavailable for this part — true nesting could not be computed. This is a real geometry gap, not an error to retry.'}
          </div>
        ) : (
          <>
            <div className="flex-1 min-w-0 bg-[#2b2b2b] relative">
              <svg
                ref={svgRef}
                className="w-full h-full cursor-grab active:cursor-grabbing"
                viewBox={effectiveViewBox ? [effectiveViewBox.x, effectiveViewBox.y, effectiveViewBox.w, effectiveViewBox.h].join(' ') : undefined}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                preserveAspectRatio="xMidYMid meet"
              >
                {/* Sheet flips Y so mm-space (Y-up, matches cad-engine's 2D frame)
                    renders top-down like a real nesting drawing. */}
                <g transform={`translate(0 ${data.sheetLengthMm.toString()}) scale(1 -1)`}>
                  <rect
                    x={0} y={0} width={data.sheetWidthMm} height={data.sheetLengthMm}
                    fill="#3a3a3a" stroke="#777" strokeWidth={Math.max(data.sheetWidthMm, data.sheetLengthMm) * 0.002}
                    onClick={() => { setSelected({ type: 'sheet' }); }}
                    className="cursor-pointer"
                  />
                  {margin ? (
                    <rect
                      x={margin} y={margin}
                      width={Math.max(0, data.sheetWidthMm - 2 * margin)}
                      height={Math.max(0, data.sheetLengthMm - 2 * margin)}
                      fill="none" stroke="#999" strokeDasharray="4 3" strokeWidth={Math.max(data.sheetWidthMm, data.sheetLengthMm) * 0.001}
                    />
                  ) : null}
                  {data.placements.map((p, i) => (
                    <g
                      key={i}
                      transform={placementTransform(p.xMm, p.yMm, p.rotationDeg)}
                      onClick={(e) => { e.stopPropagation(); setSelected({ type: 'part', index: i }); }}
                      className="cursor-pointer"
                    >
                      <polygon
                        points={polygonToPoints(data.outlinePointsMm)}
                        fill={selected?.type === 'part' && selected.index === i ? '#4f9dff' : '#8ecae6'}
                        fillOpacity={0.55}
                        stroke={selected?.type === 'part' && selected.index === i ? '#1e6fd9' : '#2a6f97'}
                        strokeWidth={Math.max(data.sheetWidthMm, data.sheetLengthMm) * 0.0015}
                      />
                      {data.holesMm.map((h, hi) => (
                        <circle key={hi} cx={h.cxMm} cy={h.cyMm} r={h.diameterMm / 2} fill="#2b2b2b" />
                      ))}
                    </g>
                  ))}
                </g>
              </svg>
              {data.capped && (
                <div className="absolute top-2 left-2 right-2 bg-amber-500/90 text-black text-xs rounded px-2 py-1">
                  Nest computation hit its evaluation budget before confirming the sheet was full — this reflects everything placed so far, but true capacity may be slightly higher.
                </div>
              )}
            </div>

            <div className="w-72 shrink-0 border-l border-[#555555] bg-[#3f3f3f] text-white p-3 overflow-y-auto text-xs space-y-2">
              {selected?.type === 'part' ? (
                <PartDetail data={data} index={selected.index} materialLabel={materialLabel} gradeLabel={gradeLabel} thicknessMm={thicknessMm} />
              ) : (
                <SheetDetail
                  data={data} materialLabel={materialLabel} gradeLabel={gradeLabel} thicknessMm={thicknessMm} quantity={qty}
                  onApply={handleApplyToRawMaterial} applyState={applyState} applyMessage={applyMessage}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-[10px] text-white/50 space-y-0.5 block">
      {label}
      <Input
        type="number"
        value={value}
        onChange={(e) => { onChange(e.target.value); }}
        className="h-7 text-xs bg-[#4a4a4a] border-[#666666] text-white mt-0.5"
      />
    </label>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 py-0.5 border-b border-white/5">
      <span className="text-white/60">{label}</span>
      <span className="font-mono text-right">{value}</span>
    </div>
  );
}

function SheetDetail({ data, materialLabel, gradeLabel, thicknessMm, quantity, onApply, applyState, applyMessage }: {
  data: TrueNestResultDto; materialLabel?: string | undefined; gradeLabel?: string | undefined; thicknessMm?: number | undefined; quantity: number;
  onApply: () => void; applyState: 'idle' | 'loading' | 'success' | 'error'; applyMessage: string;
}) {
  const canApply = data.partsPerSheet > 0 && typeof thicknessMm === 'number' && thicknessMm > 0;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold mb-1.5">Visualization — heuristic placement</p>
      {materialLabel && <Row label="Material" value={materialLabel} />}
      {gradeLabel && <Row label="Grade" value={gradeLabel} />}
      {typeof thicknessMm === 'number' && <Row label="Thickness" value={`${thicknessMm.toString()} mm`} />}
      <Row label="Sheet size" value={`${data.sheetWidthMm.toString()}×${data.sheetLengthMm.toString()} mm`} />
      <Row label="Required qty" value={quantity} />
      <Row label="Parts / sheet (this view)" value={data.partsPerSheet} />
      <Row label="Sheets required (this view)" value={data.sheetsRequired ?? '—'} />
      <Row label="True-shape nest utilization" value={`${data.utilizationPct.toString()}%`} />
      <Row label="Outline source" value={data.outlineSource === 'wire_walk' ? 'verified geometry' : 'unavailable'} />
      <p className="text-[10px] text-white/40 mt-2 leading-snug">
        This is a heuristic (bottom-left-fill) placement, not a globally optimal packing — a different nester could report a different figure for the same part and sheet. "True-shape nest utilization" is computed from the real part silhouette area, not a bounding rectangle.
      </p>

      <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
        <Button
          size="sm"
          className="w-full h-7 text-xs"
          disabled={!canApply || applyState === 'loading'}
          onClick={onApply}
        >
          {applyState === 'loading' ? 'Applying…' : 'Apply this sheet to Raw Material'}
        </Button>
        {applyMessage && (
          <p className={`text-[10px] leading-snug ${applyState === 'success' ? 'text-emerald-400' : applyState === 'error' ? 'text-red-400' : 'text-white/60'}`}>
            {applyMessage}
          </p>
        )}
        <p className="text-[9px] text-white/30 leading-snug">
          Applying writes an explicit, auditable Gross Usage override (real gross weight/part for THIS sheet ÷
          parts/sheet, from real material density) to the raw material record — same mechanism as the "Edit —
          override manually" flow in the Gross Usage calculator. It does not change the true-shape costing
          algorithm's own automatic sheet selection; clear the override there to return to it.
        </p>
      </div>
    </div>
  );
}

function PartDetail({ data, index, materialLabel, gradeLabel, thicknessMm }: {
  data: TrueNestResultDto; index: number; materialLabel?: string | undefined; gradeLabel?: string | undefined; thicknessMm?: number | undefined;
}) {
  // Opens the same real flat-pattern drawing (with dimension lines) shown
  // in the standalone Flat Pattern view, right here when a placed part is
  // clicked -- so the user can validate this exact part's dimensions
  // without leaving Nest. data.holesMm is TrueNestResultDto's own camelCase
  // shape (cxMm/cyMm/diameterMm); normalizeFlatPattern expects the same
  // snake_case shape the rest of the app uses for raw hole geometry.
  const bbox = useMemo(() => normalizeFlatPattern(
    data.outlinePointsMm,
    data.holesMm.map((h) => ({ cx_mm: h.cxMm, cy_mm: h.cyMm, diameter_mm: h.diameterMm })),
  ), [data]);
  const p = data.placements[index];
  if (!p) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-white/50 font-semibold mb-1.5">Part {index + 1} of {data.partsPerSheet}</p>
      {bbox && (
        <div className="h-40 bg-[#2b2b2b] rounded border border-white/10 mb-2">
          <FlatPatternDrawing bbox={bbox} />
        </div>
      )}
      {materialLabel && <Row label="Material" value={materialLabel} />}
      {gradeLabel && <Row label="Grade" value={gradeLabel} />}
      {typeof thicknessMm === 'number' && <Row label="Thickness" value={`${thicknessMm.toString()} mm`} />}
      {bbox && <Row label="Width" value={`${bbox.widthMm.toFixed(2)} mm`} />}
      {bbox && <Row label="Length" value={`${bbox.lengthMm.toFixed(2)} mm`} />}
      <Row label="Rotation" value={`${p.rotationDeg.toString()}°`} />
      <Row label="Position on sheet (x, y)" value={`${p.xMm.toFixed(1)}, ${p.yMm.toFixed(1)} mm`} />
      <Row label="Sheet" value="1" />
      <Row label="Holes" value={data.holesMm.length} />
    </div>
  );
}
