'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, X, Database, Calculator, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DraftLine, DraftLineKind } from '@/lib/api/hooks/useProcessPlanGenerate';

interface Props {
  line: DraftLine;
  removed: boolean;
  override: Record<string, any> | null;
  onFieldChange: (fieldPath: string, value: unknown) => void;
  onRemove: () => void;
}

const EDITABLE_FIELDS_BY_KIND: Record<DraftLineKind, Array<{ path: string; label: string; type: 'number' | 'string' }>> = {
  raw_material: [
    { path: 'grossUsage', label: 'Gross usage (kg)', type: 'number' },
    { path: 'netUsage', label: 'Net usage (kg)', type: 'number' },
    { path: 'scrapPercentage', label: 'Scrap %', type: 'number' },
    { path: 'overheadPercentage', label: 'Overhead %', type: 'number' },
    { path: 'unitCost', label: '₹/kg', type: 'number' },
  ],
  process: [
    { path: 'opNbr', label: 'Op #', type: 'number' },
    { path: 'setupTimeMinutes', label: 'Setup (min)', type: 'number' },
    { path: 'batchSize', label: 'Batch', type: 'number' },
    { path: 'cycleTimeSeconds', label: 'Cycle (s)', type: 'number' },
    { path: 'partsPerCycle', label: 'Parts/cycle', type: 'number' },
    { path: 'heads', label: 'Heads', type: 'number' },
    { path: 'scrapPercentage', label: 'Scrap %', type: 'number' },
  ],
  tooling: [
    { path: 'description', label: 'Description', type: 'string' },
    { path: 'unitCost', label: 'Unit cost (₹)', type: 'number' },
    { path: 'quantity', label: 'Qty', type: 'number' },
    { path: 'amortizationParts', label: 'Amort. parts', type: 'number' },
    { path: 'usagePercentage', label: 'Usage %', type: 'number' },
  ],
  logistics: [
    { path: 'costName', label: 'Cost name', type: 'string' },
    { path: 'unitCost', label: 'Unit cost (₹)', type: 'number' },
    { path: 'quantity', label: 'Qty', type: 'number' },
  ],
  procured_part: [
    { path: 'partName', label: 'Part name', type: 'string' },
    { path: 'unitCost', label: 'Unit cost (₹)', type: 'number' },
    { path: 'quantity', label: 'Qty', type: 'number' },
    { path: 'scrapPercentage', label: 'Scrap %', type: 'number' },
  ],
};

function describeLine(line: DraftLine): string {
  switch (line.kind) {
    case 'raw_material': {
      const name = line.data.materialName || line.data.materialGrade || 'material';
      const grade = line.data.materialGrade && line.data.materialGrade !== line.data.materialName ? ` (${line.data.materialGrade})` : '';
      return `${name}${grade} — ${line.data.grossUsage} kg gross`;
    }
    case 'process':
      return `Op ${line.data.opNbr} · ${line.data.machineName ?? 'machine'} · ${line.data.setupTimeMinutes}min setup + ${line.data.cycleTimeSeconds}s cycle`;
    case 'tooling':
      return `${line.data.toolingType} · ${line.data.description}`;
    case 'logistics':
      return `${line.data.costName} · ${line.data.logisticsType} · ${line.data.modeOfTransport}`;
    case 'procured_part':
      return `${line.data.partName} × ${line.data.quantity}`;
  }
}

// ─── Breakdown row helpers ────────────────────────────────────────────────────

function BRow({ label, value, sub, highlight, source }: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  source?: 'db' | 'calc' | 'formula';
}) {
  const sourceIcon = source === 'db'
    ? <Database className="h-2.5 w-2.5 text-blue-500 inline mr-1" />
    : source === 'calc'
      ? <Calculator className="h-2.5 w-2.5 text-violet-500 inline mr-1" />
      : source === 'formula'
        ? <FlaskConical className="h-2.5 w-2.5 text-amber-500 inline mr-1" />
        : null;

  return (
    <div className={`flex items-start justify-between py-0.5 ${highlight ? 'font-semibold text-foreground border-t border-border mt-0.5 pt-1' : 'text-muted-foreground'}`}>
      <span className="text-[10px] leading-tight pr-2">
        {sourceIcon}{label}
        {sub && <span className="block text-[9px] font-mono text-muted-foreground/70 mt-0.5">{sub}</span>}
      </span>
      <span className={`text-[10px] tabular-nums font-mono whitespace-nowrap ${highlight ? 'text-primary' : ''}`}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-dashed border-border/60 my-1" />;
}

// ─── Per-kind breakdowns ──────────────────────────────────────────────────────

function RawMaterialBreakdown({ d }: { d: Record<string, any> }) {
  const gross = Number(d.grossUsage ?? 0);
  const net = Number(d.netUsage ?? 0);
  const unitCost = Number(d.unitCost ?? 0);
  const scrap = Number(d.scrapPercentage ?? 0);
  const overhead = Number(d.overheadPercentage ?? 0);

  const materialCost = gross * unitCost;
  const overheadAmt = materialCost * (overhead / 100);
  const total = materialCost + overheadAmt;

  return (
    <div className="space-y-0">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Cost Breakdown</p>

      <BRow label="Material" value={d.materialName || d.materialGrade || '—'} source="db" />
      {d.materialGrade && d.materialGrade !== d.materialName && (
        <BRow label="Grade" value={d.materialGrade} source="db" />
      )}
      <BRow label="Unit cost (from DB)" value={`₹${unitCost.toFixed(2)}/kg`} source="db" />
      <Divider />
      <BRow
        label="Net usage"
        value={`${net.toFixed(4)} kg`}
        sub="volume_mm³ × density_kg/m³ × 1e-9"
      />
      <BRow
        label={`Gross usage (scrap ${scrap}%)`}
        value={`${gross.toFixed(4)} kg`}
        sub={`= ${net.toFixed(4)} ÷ (1 − ${scrap}/100)`}
        source="formula"
      />
      <Divider />
      <BRow
        label="Material cost"
        value={`₹${materialCost.toFixed(4)}`}
        sub={`= ${gross.toFixed(4)} kg × ₹${unitCost.toFixed(2)}/kg`}
        source="formula"
      />
      <BRow
        label={`Overhead (${overhead}%)`}
        value={`₹${overheadAmt.toFixed(4)}`}
        sub={`= ₹${materialCost.toFixed(4)} × ${overhead}%`}
        source="formula"
      />
      <BRow label="Total per part" value={`₹${total.toFixed(4)}`} highlight />
    </div>
  );
}

function ProcessBreakdown({ d }: { d: Record<string, any> }) {
  const machineRate = Number(d.machineRate ?? 0);   // ₹/hr — from MHR DB
  const labourRate  = Number(d.labourRate ?? 0);    // ₹/hr — from LHR DB
  const setupMin    = Number(d.setupTimeMinutes ?? 0);
  const cycleSec    = Number(d.cycleTimeSeconds ?? 0);
  const batch       = Number(d.batchSize ?? 1);
  const heads       = Number(d.heads ?? 1);
  const manning     = Number(d.setupManning ?? 1);
  const ppc         = Number(d.partsPerCycle ?? 1);
  const scrap       = Number(d.scrapPercentage ?? 0);
  const directRate  = Number(d.directRate ?? 0);

  const setupHrs       = setupMin / 60;
  const combinedSetup  = machineRate + labourRate * manning;
  const setupTotal     = setupHrs * combinedSetup;
  const setupPerPart   = setupTotal / Math.max(batch, 1);

  const cycleHrs       = cycleSec / 3600;
  const combinedCycle  = machineRate + labourRate * heads;
  const cyclePerPart   = (cycleHrs * combinedCycle) / Math.max(ppc, 1);

  const subtotal    = setupPerPart + cyclePerPart;
  const scrapAmt    = subtotal * (scrap / 100);
  const total       = subtotal + scrapAmt;

  const usedCalc = !!d.calculatorName;
  const timingSource: string = d.timingSource ?? 'default';
  const timingLabel =
    timingSource === 'calculator'        ? 'Calculator (geometry)' :
    timingSource === 'geometry_estimate' ? 'Geometry estimate (physics)' :
    timingSource === 'ai_hint'          ? 'AI estimate' :
                                          'Default fallback';
  const timingSourceIcon: 'calc' | 'db' | 'formula' =
    timingSource === 'calculator'        ? 'calc' :
    timingSource === 'geometry_estimate' ? 'formula' :
    timingSource === 'ai_hint'          ? 'formula' : 'formula';

  return (
    <div className="space-y-0">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Cost Breakdown</p>

      {/* Master rates from DB */}
      <BRow label={`MHR — ${d.machineName ?? 'machine'}`} value={`₹${machineRate.toFixed(2)}/hr`} source="db" />
      <BRow label={`LHR — ${d.labourType ?? 'labour'}`} value={`₹${labourRate.toFixed(2)}/hr`} source="db" />
      <BRow label="Direct rate (MHR + LHR×heads)" value={`₹${directRate.toFixed(2)}/hr`} source="formula" />
      <BRow label="Timing source" value={timingLabel} source={timingSourceIcon} />

      <Divider />

      {/* Setup */}
      <p className="text-[9px] text-muted-foreground font-medium mt-1">Setup cost / part</p>
      <BRow label="Setup time" value={`${setupMin} min = ${setupHrs.toFixed(4)} hr`} />
      <BRow label="Manning" value={`${manning} operator(s)`} />
      <BRow label="Combined setup rate" value={`₹${machineRate.toFixed(2)} + ₹${labourRate.toFixed(2)} × ${manning} = ₹${combinedSetup.toFixed(2)}/hr`} source="formula" />
      <BRow label="Setup cost (total)" value={`${setupHrs.toFixed(4)} hr × ₹${combinedSetup.toFixed(2)} = ₹${setupTotal.toFixed(4)}`} source="formula" />
      <BRow
        label={`Amortised over batch (${batch} pcs)`}
        value={`₹${setupTotal.toFixed(4)} ÷ ${batch} = ₹${setupPerPart.toFixed(4)}/part`}
        source="formula"
      />

      <Divider />

      {/* Cycle */}
      <p className="text-[9px] text-muted-foreground font-medium mt-1">Cycle cost / part</p>
      <BRow label="Cycle time" value={`${cycleSec} s = ${cycleHrs.toFixed(6)} hr`} />
      <BRow label="Heads" value={`${heads} operator(s)`} />
      <BRow label="Parts per cycle" value={`${ppc}`} />
      <BRow label="Combined cycle rate" value={`₹${machineRate.toFixed(2)} + ₹${labourRate.toFixed(2)} × ${heads} = ₹${combinedCycle.toFixed(2)}/hr`} source="formula" />
      <BRow
        label="Cycle cost / part"
        value={`(${cycleHrs.toFixed(6)} × ₹${combinedCycle.toFixed(2)}) ÷ ${ppc} = ₹${cyclePerPart.toFixed(4)}`}
        source="formula"
      />

      <Divider />

      <BRow label="Subtotal (setup + cycle)" value={`₹${setupPerPart.toFixed(4)} + ₹${cyclePerPart.toFixed(4)} = ₹${subtotal.toFixed(4)}`} source="formula" />
      <BRow label={`Scrap allowance (${scrap}%)`} value={`₹${scrapAmt.toFixed(4)}`} source="formula" />

      {usedCalc && (
        <>
          <Divider />
          <BRow label="Calculator (assigned)" value={d.calculatorName ?? ''} source="calc" />
          {timingSource === 'calculator'
            ? <BRow label="Calculator result" value={`₹${total.toFixed(4)}`} source="calc" />
            : <BRow label="Calculator returned no result" value="formula fallback used" source="formula" />
          }
        </>
      )}

      <BRow label="Total per part" value={`₹${total.toFixed(4)}`} highlight />
    </div>
  );
}

function ToolingBreakdown({ d }: { d: Record<string, any> }) {
  const unitCost   = Number(d.unitCost ?? 0);
  const qty        = Number(d.quantity ?? 1);
  const amort      = Number(d.amortizationParts ?? 1);
  const usagePct   = Number(d.usagePercentage ?? 100);

  const perPart = (unitCost * qty * (usagePct / 100)) / Math.max(amort, 1);

  return (
    <div className="space-y-0">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Cost Breakdown</p>
      <BRow label="Type" value={d.toolingType ?? '—'} />
      <BRow label="Unit cost" value={`₹${unitCost.toFixed(2)}`} />
      <BRow label="Quantity" value={`${qty}`} />
      <BRow label="Usage %" value={`${usagePct}%`} />
      <BRow label="Amortise over" value={`${amort} parts`} />
      <Divider />
      <BRow
        label="Per part"
        value={`₹${perPart.toFixed(4)}`}
        sub={`= (₹${unitCost} × ${qty} × ${usagePct}%) ÷ ${amort}`}
        highlight
        source="formula"
      />
    </div>
  );
}

function LogisticsBreakdown({ d }: { d: Record<string, any> }) {
  const unitCost = Number(d.unitCost ?? 0);
  const qty = Number(d.quantity ?? 1);
  const total = unitCost * qty;
  return (
    <div className="space-y-0">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Cost Breakdown</p>
      <BRow label="Cost name" value={d.costName ?? '—'} />
      <BRow label="Type" value={`${d.logisticsType ?? '—'} · ${d.modeOfTransport ?? '—'}`} />
      <BRow label="Basis" value={d.costBasis ?? '—'} />
      <BRow label="Unit cost" value={`₹${unitCost.toFixed(2)}`} />
      <BRow label="Quantity" value={`${qty}`} />
      <Divider />
      <BRow label="Total" value={`₹${total.toFixed(4)}`} sub={`= ₹${unitCost} × ${qty}`} highlight source="formula" />
    </div>
  );
}

function ProcuredPartBreakdown({ d }: { d: Record<string, any> }) {
  const unitCost = Number(d.unitCost ?? 0);
  const qty = Number(d.quantity ?? 1);
  const scrap = Number(d.scrapPercentage ?? 0);
  const overhead = Number(d.overheadPercentage ?? 0);
  const base = unitCost * qty;
  const total = base * (1 + scrap / 100 + overhead / 100);
  return (
    <div className="space-y-0">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Cost Breakdown</p>
      <BRow label="Part" value={`${d.partName ?? '—'}${d.partNumber ? ` (${d.partNumber})` : ''}`} />
      {d.supplierName && <BRow label="Supplier" value={d.supplierName} source="db" />}
      <BRow label="Unit cost" value={`₹${unitCost.toFixed(2)}`} source="db" />
      <BRow label="Quantity" value={`${qty}`} />
      <BRow label="Base cost" value={`₹${base.toFixed(4)}`} sub={`= ₹${unitCost} × ${qty}`} source="formula" />
      <BRow label={`Scrap (${scrap}%) + Overhead (${overhead}%)`} value={`₹${(total - base).toFixed(4)}`} source="formula" />
      <BRow label="Total" value={`₹${total.toFixed(4)}`} highlight />
    </div>
  );
}

function CostBreakdownSection({ line, merged }: { line: DraftLine; merged: Record<string, any> }) {
  switch (line.kind) {
    case 'raw_material': return <RawMaterialBreakdown d={merged} />;
    case 'process':      return <ProcessBreakdown d={merged} />;
    case 'tooling':      return <ToolingBreakdown d={merged} />;
    case 'logistics':    return <LogisticsBreakdown d={merged} />;
    case 'procured_part': return <ProcuredPartBreakdown d={merged} />;
  }
}

// ─── Main card ────────────────────────────────────────────────────────────────

export function DraftLineCard({ line, removed, override, onFieldChange, onRemove }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'breakdown' | 'edit' | 'candidates'>('breakdown');
  const merged = { ...line.data, ...(override ?? {}) };
  const fields = EDITABLE_FIELDS_BY_KIND[line.kind];

  if (removed) {
    return (
      <div className="rounded border border-dashed border-muted-foreground/40 px-3 py-2 text-xs text-muted-foreground line-through">
        {describeLine(line)} · removed
      </div>
    );
  }

  return (
    <div className="rounded border border-border bg-card">
      {/* Header row */}
      <div className="px-3 py-2 flex items-start gap-2">
        <button onClick={() => setExpanded((v) => !v)} className="mt-0.5 text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{describeLine({ ...line, data: merged })}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{line.reason}</p>
          {line.estimatedCost !== null && (
            <p className="text-[11px] text-primary tabular-nums mt-0.5 font-semibold">
              ₹{line.estimatedCost.toFixed(4)}/part
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={onRemove}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t bg-muted/10">
          {/* Tab strip */}
          <div className="flex border-b text-[10px]">
            {(['breakdown', 'edit', 'candidates'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 capitalize transition-colors ${tab === t
                  ? 'border-b-2 border-primary text-foreground font-medium -mb-px'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                {t === 'breakdown' ? '₹ Breakdown' : t === 'edit' ? 'Edit' : 'Candidates'}
              </button>
            ))}
          </div>

          <div className="px-3 py-2">
            {/* ── Cost Breakdown tab ── */}
            {tab === 'breakdown' && (
              <CostBreakdownSection line={line} merged={merged} />
            )}

            {/* ── Edit tab ── */}
            {tab === 'edit' && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {fields.map(({ path, label, type }) => (
                  <label key={path} className="text-[11px]">
                    <span className="text-muted-foreground">{label}</span>
                    <Input
                      className="h-6 text-xs mt-0.5"
                      type={type === 'number' ? 'number' : 'text'}
                      value={merged[path] ?? ''}
                      onChange={(e) => {
                        const v = type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
                        onFieldChange(path, v);
                      }}
                    />
                  </label>
                ))}
              </div>
            )}

            {/* ── Candidates tab ── */}
            {tab === 'candidates' && (
              <div className="space-y-1">
                {line.references.candidatesConsidered.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No candidate references recorded.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {line.references.candidatesConsidered.map((c) => (
                      <li key={c.candidateId} className={`text-[11px] flex items-center justify-between ${c.chosen ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                        <span>{c.chosen ? '★ ' : '  '}{c.candidateId}: {c.label}</span>
                        <span className="tabular-nums text-[10px]">score {c.score.toFixed(3)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
