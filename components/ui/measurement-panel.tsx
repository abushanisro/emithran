'use client';

import { Card } from '@/components/ui/card';
import { Ruler, X, Copy, Trash2 } from 'lucide-react';
import type { MeasureMode, MeasureSubMode, MeasureSelection, MeasureResult, MeasureUnit, ArcSelection } from './measurement-overlay';
import { UNIT_SCALE, getSelectionPoint, getResultColors } from './measurement-overlay';

interface MeasurementPanelProps {
  mode: MeasureMode;
  selA: MeasureSelection | null;
  hoverSel: MeasureSelection | null;
  results: MeasureResult[];
  unit: MeasureUnit;
  measureSubMode: MeasureSubMode;
  selectedResultId: string | null;
  onSelectResult: (id: string) => void;
  onUnitChange: (u: MeasureUnit) => void;
  onSubModeChange: (m: MeasureSubMode) => void;
  onExit: () => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

const STATUS: Record<MeasureMode, string> = {
  IDLE: '',
  PICKING_A: 'Click first element on model',
  PICKING_B: 'Click second element',
  DONE: 'Done',
};

const TYPE_LABEL: Record<string, string> = {
  'face-face':   'Face — Face',
  'edge-edge':   'Edge — Edge',
  'point-point': 'Point — Point',
  'arc-arc':     'Arc — Arc',
  'mixed':       'Mixed',
};

const SUB_MODES: { key: MeasureSubMode; label: string }[] = [
  { key: 'face',  label: 'Face'  },
  { key: 'edge',  label: 'Edge'  },
  { key: 'point', label: 'Point' },
  { key: 'arc',   label: 'Arc ○' },
];

function selLabel(sel: MeasureSelection): string {
  if (sel.type === 'face')  return 'Face';
  if (sel.type === 'edge')  return 'Edge';
  if (sel.type === 'arc')   return 'Arc/Circle';
  return 'Point';
}

export function MeasurementPanel({
  mode, selA, hoverSel, results, unit, measureSubMode,
  selectedResultId, onSelectResult,
  onUnitChange, onSubModeChange, onExit, onDelete, onClearAll,
}: MeasurementPanelProps) {
  const scale = UNIT_SCALE[unit];

  const fmt   = (v: number) => (v * scale).toFixed(2);
  const fmtPt = (v: import('three').Vector3) =>
    `X ${fmt(v.x)}  Y ${fmt(v.y)}  Z ${fmt(v.z)}`;

  const copyResult = (r: MeasureResult) => {
    const lines: string[] = [TYPE_LABEL[r.measureType] ?? r.measureType];
    if (r.measureType === 'arc-arc') {
      const a = r.selA as ArcSelection, b = r.selB as ArcSelection;
      lines.push(`A Diameter: Ø${fmt(a.radius * 2)} ${unit}`, `B Diameter: Ø${fmt(b.radius * 2)} ${unit}`);
    }
    lines.push(`Distance: ${fmt(r.distanceMm)} ${unit}`);
    if (r.normalDistanceMm !== undefined)
      lines.push(`Normal distance: ${fmt(r.normalDistanceMm)} ${unit}`);
    lines.push(
      `ΔX ${fmt(r.deltaXMm)}  ΔY ${fmt(r.deltaYMm)}  ΔZ ${fmt(r.deltaZMm)}`,
      `A: ${fmtPt(getSelectionPoint(r.selA))}`,
      `B: ${fmtPt(getSelectionPoint(r.selB))}`,
    );
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
  };

  // Latest result always shown at top
  const latestResult = results.length > 0 ? results[results.length - 1]! : null;
  // All results reversed for history list (newest first, skip the one shown at top)
  const historyResults = results.slice(0, -1).reverse();

  const renderResult = (r: MeasureResult, compact = false) => (
    <div className="space-y-0.5">
      {/* Type badge */}
      <div className="flex items-center gap-1">
        <span className="text-[7px] px-1 py-0.5 rounded bg-blue-900/60 text-blue-300 font-medium">
          {TYPE_LABEL[r.measureType] ?? r.measureType}
        </span>
        {r.isParallel !== undefined && (
          <span className={`text-[7px] px-1 py-0.5 rounded font-medium ${
            r.isParallel ? 'bg-green-900/60 text-green-300' : 'bg-orange-900/60 text-orange-300'
          }`}>
            {r.isParallel ? 'Parallel' : 'Not parallel'}
          </span>
        )}
      </div>

      {/* Arc diameters */}
      {r.measureType === 'arc-arc' && (
        <div className="bg-[#3f3f3f] rounded px-1 py-0.5 space-y-0.5">
          {([r.selA, r.selB] as ArcSelection[]).map((arc, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className={`text-[7px] font-medium ${i === 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                {i === 0 ? 'A' : 'B'} Diameter
              </span>
              <span className="font-mono text-[10px] text-yellow-300 font-bold">
                Ø {fmt(arc.radius * 2)} {unit}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Single arc A */}
      {r.selA.type === 'arc' && r.measureType !== 'arc-arc' && !compact && (
        <div className="bg-[#3f3f3f] rounded px-1 py-0.5">
          <div className="text-[7px] text-blue-400 font-medium mb-0.5">A — Arc/Circle</div>
          <div className="flex items-center justify-between">
            <span className="text-[7px] text-gray-400">Diameter</span>
            <span className="font-mono text-[11px] text-yellow-300 font-bold">
              Ø {fmt((r.selA as ArcSelection).radius * 2)} {unit}
            </span>
          </div>
        </div>
      )}
      {r.selB.type === 'arc' && r.measureType !== 'arc-arc' && !compact && (
        <div className="bg-[#3f3f3f] rounded px-1 py-0.5">
          <div className="text-[7px] text-orange-400 font-medium mb-0.5">B — Arc/Circle</div>
          <div className="flex items-center justify-between">
            <span className="text-[7px] text-gray-400">Diameter</span>
            <span className="font-mono text-[11px] text-yellow-300 font-bold">
              Ø {fmt((r.selB as ArcSelection).radius * 2)} {unit}
            </span>
          </div>
        </div>
      )}

      {/* Point A */}
      {r.selA.type !== 'arc' && !compact && (
        <div className="bg-[#3f3f3f] rounded px-1 py-0.5">
          <div className="text-[7px] text-blue-400 font-medium mb-0.5">A — {selLabel(r.selA)}</div>
          <div className="font-mono text-[7px] text-white">{fmtPt(getSelectionPoint(r.selA))} {unit}</div>
        </div>
      )}
      {/* Point B */}
      {r.selB.type !== 'arc' && !compact && (
        <div className="bg-[#3f3f3f] rounded px-1 py-0.5">
          <div className="text-[7px] text-orange-400 font-medium mb-0.5">B — {selLabel(r.selB)}</div>
          <div className="font-mono text-[7px] text-white">{fmtPt(getSelectionPoint(r.selB))} {unit}</div>
        </div>
      )}

      {/* Distance block */}
      <div className="bg-[#3f3f3f] rounded px-1 py-0.5 space-y-0.5">
        <div className="flex items-center justify-between">
          <span className="text-[7px] text-gray-400">Distance</span>
          <span className="font-mono text-[11px] text-yellow-300 font-bold">
            {fmt(r.distanceMm)} {unit}
          </span>
        </div>
        {r.normalDistanceMm !== undefined && (
          <div className="flex items-center justify-between">
            <span className="text-[7px] text-gray-400">Normal dist</span>
            <span className="font-mono text-[10px] text-green-300 font-semibold">
              {fmt(r.normalDistanceMm)} {unit}
            </span>
          </div>
        )}
        {!compact && (
          <div className="font-mono text-[7px] grid grid-cols-3 gap-1 mt-0.5">
            <span className="text-gray-500">ΔX <span className="text-white">{fmt(r.deltaXMm)}</span></span>
            <span className="text-gray-500">ΔY <span className="text-white">{fmt(r.deltaYMm)}</span></span>
            <span className="text-gray-500">ΔZ <span className="text-white">{fmt(r.deltaZMm)}</span></span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Card className="bg-[#505050] border-[#666666]">
      <div className="p-1 space-y-1">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h4 className="text-[9px] font-semibold text-white flex items-center gap-0.5">
            <Ruler className="h-2.5 w-2.5 text-yellow-300" /> Measurement
            {results.length > 0 && (
              <span className="ml-1 text-[7px] bg-blue-600 text-white px-1 py-0.5 rounded">
                {results.length}
              </span>
            )}
          </h4>
          <button onClick={onExit} className="text-gray-400 hover:text-white transition-colors" title="Exit measurement">
            <X className="h-2.5 w-2.5" />
          </button>
        </div>

        {/* Selection sub-mode */}
        <div className="space-y-0.5">
          <span className="text-[7px] text-gray-400 font-medium">Select by</span>
          <div className="flex gap-0.5">
            {SUB_MODES.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => onSubModeChange(key)}
                className={`text-[7px] px-1 py-0.5 rounded font-medium transition-colors flex-1 ${
                  measureSubMode === key
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#3f3f3f] text-gray-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Unit switcher */}
        <div className="flex gap-0.5">
          {(['mm', 'cm', 'in'] as MeasureUnit[]).map((u) => (
            <button
              key={u}
              onClick={() => onUnitChange(u)}
              className={`flex-1 text-[8px] px-1 py-0.5 rounded font-medium transition-colors ${
                unit === u ? 'bg-blue-600 text-white' : 'bg-[#3f3f3f] text-gray-400 hover:text-white'
              }`}
            >
              {u}
            </button>
          ))}
        </div>

        {/* Status */}
        <div className="bg-[#3f3f3f] rounded px-1 py-0.5">
          <span className="text-[8px] text-gray-300">{STATUS[mode]}</span>
          {hoverSel && (
            <span className="ml-1 text-[8px] text-green-400 font-medium">
              [{selLabel(hoverSel)}{hoverSel.type === 'arc' ? ` Ø${fmt(hoverSel.radius * 2)}${unit}` : ''}]
            </span>
          )}
        </div>

        {/* Selection A info while picking B */}
        {mode === 'PICKING_B' && selA && (
          <div className="bg-[#3f3f3f] rounded px-1 py-0.5 space-y-0.5">
            <div className="text-[7px] text-blue-400 font-medium">A — {selLabel(selA)}</div>
            {selA.type === 'arc' ? (
              <div className="flex items-center justify-between">
                <span className="text-[7px] text-gray-400">Diameter</span>
                <span className="font-mono text-[11px] text-yellow-300 font-bold">
                  Ø {fmt(selA.radius * 2)} {unit}
                </span>
              </div>
            ) : (
              <div className="font-mono text-[7px] text-white">
                {fmtPt(getSelectionPoint(selA))} {unit}
              </div>
            )}
          </div>
        )}

        {/* Latest measurement — always visible */}
        {latestResult && (() => {
          const { a: colA, b: colB } = getResultColors(results.length - 1);
          const isSelected = selectedResultId === latestResult.id;
          return (
            <div
              className="rounded p-0.5 space-y-0.5 cursor-pointer transition-colors"
              style={{ border: `1px solid ${isSelected ? colA : colA + '55'}`, background: isSelected ? '#2a2a2a' : undefined }}
              onClick={() => onSelectResult(latestResult.id)}
            >
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1">
                  <span className="inline-flex gap-0.5">
                    <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: colA }} />
                    <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: colB }} />
                  </span>
                  <span className="text-[7px] text-gray-400 font-medium">Latest</span>
                  {isSelected && <span className="text-[6px] text-blue-400 font-medium">● selected</span>}
                </div>
                <div className="flex gap-0.5">
                  <button onClick={(e) => { e.stopPropagation(); copyResult(latestResult); }} className="text-gray-500 hover:text-white" title="Copy">
                    <Copy className="h-2 w-2" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onDelete(latestResult.id); }} className="text-gray-500 hover:text-red-400" title="Delete">
                    <Trash2 className="h-2 w-2" />
                  </button>
                </div>
              </div>
              {renderResult(latestResult)}
            </div>
          );
        })()}

        {/* All previous measurements */}
        {historyResults.length > 0 && (
          <div className="space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[7px] text-gray-400 font-medium">
                All measurements ({results.length})
              </span>
              <button onClick={onClearAll} className="text-[7px] text-red-400 hover:text-red-300 transition-colors">
                Clear all
              </button>
            </div>
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {/* Latest also in list */}
              {[...results].reverse().map((r, revIdx) => {
                const origIdx = results.length - 1 - revIdx;
                const { a: colA, b: colB } = getResultColors(origIdx);
                const isSelected = selectedResultId === r.id;
                return (
                  <div
                    key={r.id}
                    className="rounded px-1 py-0.5 cursor-pointer transition-colors"
                    style={{
                      background: isSelected ? '#2a2a2a' : '#3f3f3f',
                      border: `1px solid ${isSelected ? colA : 'transparent'}`,
                    }}
                    onClick={() => onSelectResult(r.id)}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1">
                        <span className="inline-flex gap-0.5">
                          <span className="w-2 h-2 rounded-sm inline-block" style={{ background: colA }} />
                          <span className="w-2 h-2 rounded-sm inline-block" style={{ background: colB }} />
                        </span>
                        <span className="text-[7px] text-gray-400 font-medium">
                          {TYPE_LABEL[r.measureType] ?? r.measureType}
                        </span>
                        {isSelected && <span className="text-[6px] text-blue-400 font-medium">● selected</span>}
                      </div>
                      <div className="flex gap-0.5">
                        <button onClick={(e) => { e.stopPropagation(); copyResult(r); }} className="text-gray-500 hover:text-white">
                          <Copy className="h-2 w-2" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onDelete(r.id); }} className="text-gray-500 hover:text-red-400">
                          <X className="h-2 w-2" />
                        </button>
                      </div>
                    </div>
                    {r.measureType === 'arc-arc' ? (
                      <div className="font-mono text-[8px] text-gray-300">
                        Ø{fmt((r.selA as ArcSelection).radius * 2)} / Ø{fmt((r.selB as ArcSelection).radius * 2)} {unit}
                        {r.distanceMm > 0 && <span className="text-gray-500 ml-1">d={fmt(r.distanceMm)}</span>}
                      </div>
                    ) : (
                      <div className="font-mono text-[8px] text-gray-300">
                        {fmt(r.distanceMm)} {unit}
                        {r.normalDistanceMm !== undefined && (
                          <span className="text-green-400 ml-1">(n:{fmt(r.normalDistanceMm)})</span>
                        )}
                      </div>
                    )}
                    <div className="font-mono text-[7px] text-gray-500 mt-0.5">
                      ΔX {fmt(r.deltaXMm)} ΔY {fmt(r.deltaYMm)} ΔZ {fmt(r.deltaZMm)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </Card>
  );
}
