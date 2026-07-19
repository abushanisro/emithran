'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Edit, Trash2, Loader2, Eye, Database, FlaskConical, TrendingUp } from 'lucide-react';
import { RawMaterialDialog } from './RawMaterialDialog';
import {
  useRawMaterialCosts,
  useCreateRawMaterialCost,
  useUpdateRawMaterialCost,
  useDeleteRawMaterialCost,
} from '@/lib/api/hooks/useRawMaterialCosts';

interface RawMaterialsSectionProps {
  bomItemId?: string;
  bomItem?: any;
  location?: string;
  compact?: boolean; // render without the outer card chrome (for embedding inside other panels)
  currencySymbol?: string; // e.g. '₹', '$', '€' — default '$'
  conversionRate?: number; // multiply stored USD values by this to get factory currency — default 1
  /** Called after the last material record for this item is deleted. Use to cascade-clear stale process records. */
  onAllMaterialsDeleted?: () => void;
}

// ─── Breakdown helpers ────────────────────────────────────────────────────────

function BRow({ label, value, sub, highlight, icon }: {
  label: string; value: string; sub?: string; highlight?: boolean;
  icon?: 'db' | 'formula';
}) {
  const ico =
    icon === 'db'      ? <Database    className="h-2.5 w-2.5 text-blue-500 inline mr-1" /> :
    icon === 'formula' ? <FlaskConical className="h-2.5 w-2.5 text-amber-500 inline mr-1" /> : null;
  return (
    <div className={`flex items-start justify-between py-0.5 ${highlight ? 'font-semibold text-foreground border-t border-border mt-0.5 pt-1' : 'text-muted-foreground'}`}>
      <span className="text-[10px] leading-tight pr-2">
        {ico}{label}
        {sub && <span className="block text-[9px] font-mono text-muted-foreground/70 mt-0.5">{sub}</span>}
      </span>
      <span className={`text-[10px] tabular-nums font-mono whitespace-nowrap ${highlight ? 'text-primary' : ''}`}>{value}</span>
    </div>
  );
}

function Divider() { return <div className="border-t border-dashed border-border/60 my-1" />; }

function RawMaterialBreakdown({ m, currencySymbol = '$', conversionRate = 1 }: { m: any; currencySymbol?: string; conversionRate?: number }) {
  const gross    = Number(m.grossUsage  || 0);
  const net      = Number(m.netUsage    || 0);
  const unitCost = Number(m.unitCost    || 0);
  const scrap    = Number(m.scrap       || 0);
  const overhead = Number(m.overhead    || 0);
  const reclaim  = Number(m.reclaimRate || 0);

  // Prefer server-computed values; derive locally only for legacy records that
  // pre-date the reclaimRate / 8-step engine (they will have totalCost = 0).
  const grossMatCost  = Number(m.grossMaterialCost) || gross * unitCost;
  const scrapAmt      = gross - net;
  const reclaimValue  = Number(m.reclaimValue)  || scrapAmt * reclaim;
  const netMatCost    = Number(m.netMaterialCost) || grossMatCost - reclaimValue;
  const scrapAdj      = Number(m.scrapAdjustment) || netMatCost * (scrap / 100);
  const subtotal      = netMatCost + scrapAdj;
  const overheadCost  = Number(m.overheadCost)  || subtotal * (overhead / 100);
  const total         = Number(m.totalCost)      || subtotal + overheadCost;
  const utilRate      = Number(m.materialUtilizationRate) || (gross > 0 ? (net / gross) * 100 : 0);
  const effPerUnit    = Number(m.effectiveCostPerUnit) || (net > 0 ? total / net : 0);
  // Convert USD → factory currency for display only
  const c = (v: number) => v * conversionRate;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Inputs */}
      <div>
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Inputs</p>
        <BRow label="Material"                         value={m.materialName || '—'} />
        {m.materialDescription && (
          <BRow label="Grade / Spec"                   value={m.materialDescription} />
        )}
        <BRow label="Unit Cost ($/kg)"                 value={`${currencySymbol}${c(unitCost).toFixed(3)}`}   icon="db" />
        <BRow label="Net Usage (kg)"                   value={`${net.toFixed(4)} kg`} />
        <BRow label="Gross Usage (kg)"                 value={`${gross.toFixed(4)} kg`} />
        <BRow label="Scrap %"                          value={`${scrap}`} />
        {reclaim > 0 && <BRow label="Reclaim Rate ($/kg)" value={`${currencySymbol}${c(reclaim).toFixed(3)}`} icon="db" />}
        <BRow label="Overhead %"                       value={`${overhead}`} />
        <Divider />
        <BRow label="Material Utilization"             value={`${utilRate.toFixed(1)}%`} />
        <BRow label="Effective $/kg (net)"             value={`${currencySymbol}${c(effPerUnit).toFixed(3)}`} />
      </div>

      {/* 8-step formula breakdown */}
      <div>
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Cost Formula (8-step)</p>
        <BRow
          label={`Gross material cost`}
          value={`${currencySymbol}${c(grossMatCost).toFixed(4)}`}
          sub={`= ${gross.toFixed(4)} kg × ${currencySymbol}${c(unitCost).toFixed(3)}/kg`}
          icon="formula"
        />
        {reclaimValue > 0 && (
          <BRow
            label="− Reclaim value"
            value={`−${currencySymbol}${c(reclaimValue).toFixed(4)}`}
            sub={`= ${scrapAmt.toFixed(4)} kg scrap × ${currencySymbol}${c(reclaim).toFixed(3)}/kg`}
            icon="formula"
          />
        )}
        <BRow
          label="= Net material cost"
          value={`${currencySymbol}${c(netMatCost).toFixed(4)}`}
          {...(reclaimValue > 0 ? { sub: `= ${currencySymbol}${c(grossMatCost).toFixed(4)} − ${currencySymbol}${c(reclaimValue).toFixed(4)}` } : {})}
          icon="formula"
        />
        {scrap > 0 && (
          <BRow
            label={`+ Scrap adjustment (${scrap}%)`}
            value={`+${currencySymbol}${c(scrapAdj).toFixed(4)}`}
            sub={`= ${currencySymbol}${c(netMatCost).toFixed(4)} × ${scrap}%`}
            icon="formula"
          />
        )}
        {overhead > 0 && (
          <BRow
            label={`+ Overhead (${overhead}%)`}
            value={`+${currencySymbol}${c(overheadCost).toFixed(4)}`}
            sub={`= ${currencySymbol}${c(subtotal).toFixed(4)} × ${overhead}%`}
            icon="formula"
          />
        )}
        <Divider />
        <BRow label="Total cost per part" value={`${currencySymbol}${c(total).toFixed(4)}`} highlight />
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function RawMaterialsSection({ bomItemId, bomItem, location, compact, currencySymbol = '$', conversionRate = 1, onAllMaterialsDeleted }: RawMaterialsSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMaterial, setEditMaterial] = useState<any | null>(null);
  const [openBreakdownId, setOpenBreakdownId] = useState<string | null>(null);

  const { data, isLoading, error } = useRawMaterialCosts(
    bomItemId ? { bomItemId, isActive: true, enabled: true } : { enabled: false },
  );

  const createMutation = useCreateRawMaterialCost();
  const updateMutation = useUpdateRawMaterialCost();
  const deleteMutation = useDeleteRawMaterialCost();

  const materials = data?.records || [];

  const handleAddMaterial = () => {
    setEditMaterial(null);
    setDialogOpen(true);
  };

  const handleEditMaterial = (material: any) => {
    setEditMaterial(material);
    setDialogOpen(true);
  };

  const handleDialogSubmit = async (data: any) => {
    if (!bomItemId) return;
    const payload = {
      materialId:          data.materialId,
      materialName:        data.materialName,
      materialGroup:       data.materialGroup,
      materialType:        data.materialType,
      materialDescription: data.materialDescription,
      country:             data.country,
      quarter:             data.quarter,
      unitCost:            data.unitCost,
      grossUsage:          data.grossUsage,
      netUsage:            data.netUsage,
      scrap:               data.scrap,
      overhead:            data.overhead,
      reclaimRate:         data.reclaimRate ?? 0,
      notes:               data.notes,
    };
    try {
      if (editMaterial?.id) {
        await updateMutation.mutateAsync({ id: editMaterial.id, data: payload });
      } else {
        await createMutation.mutateAsync({ bomItemId, ...payload, isActive: true });
      }
      setDialogOpen(false);
      setEditMaterial(null);
    } catch (error) {}
  };

  const handleDeleteMaterial = async (id: string) => {
    if (!bomItemId) return;
    if (confirm('Are you sure you want to delete this material?')) {
      try {
        await deleteMutation.mutateAsync({ id, bomItemId });
        // When the last material record is deleted, notify the parent so it can
        // cascade-clear process cost records that were computed from this material.
        if (materials.length === 1) {
          onAllMaterialsDeleted?.();
        }
      } catch (error) {}
    }
  };

  const fmtUsage = (v: any): string => {
    const n = Number(v || 0);
    return n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2);
  };

  // Use the server-computed 8-step total — falls back to simplified estimate for
  // legacy records that pre-date the reclaim/scrap-adjustment engine.
  const computeMatCost = (m: any): number => Number(m.totalCost) || 0;

  const calculateTotal = () =>
    materials.reduce((sum, m) => sum + computeMatCost(m), 0).toFixed(2);

  if (!bomItemId) {
    if (compact) return (
      <div className="py-4 text-center text-sm text-muted-foreground">Select a BOM item to manage materials</div>
    );
    return (
      <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
        <div className="bg-primary py-3 px-4">
          <h6 className="m-0 font-semibold text-primary-foreground">Raw Materials</h6>
        </div>
        <div className="bg-card p-8 text-center text-muted-foreground">
          <p className="text-sm">Please select a BOM item to manage raw materials</p>
        </div>
      </div>
    );
  }

  const fullColSpan = 10;
  const colSpan = fullColSpan; // used by the full table (compact path uses flex-list, not table)

  // ── Compact flex-list (no table) — fits any panel width ──────────────────
  const compactContent = (
    <>
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="ml-2 text-xs text-muted-foreground">Loading…</span>
        </div>
      ) : error ? (
        <p className="py-3 text-center text-xs text-destructive">{error.message}</p>
      ) : materials.length === 0 ? (
        <div className="py-4 text-center text-muted-foreground">
          <p className="text-xs">No raw materials added yet</p>
          <p className="text-[11px] mt-0.5">Click "Add Material" to get started</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {materials.map((m) => (
            <React.Fragment key={m.id}>
              <div className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" title={m.materialName}>{m.materialName}</p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {fmtUsage(m.netUsage)} kg · {m.scrap || 0}% scrap
                  </p>
                </div>
                <span className="text-xs font-semibold tabular-nums shrink-0">{currencySymbol}{(computeMatCost(m) * conversionRate).toFixed(2)}</span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    title="Cost breakdown"
                    onClick={() => setOpenBreakdownId(openBreakdownId === m.id ? null : m.id)}
                    className={`p-1 rounded transition-colors ${openBreakdownId === m.id ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                  >
                    <Eye className="h-3 w-3" />
                  </button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleEditMaterial(m)} title="Edit">
                    <Edit className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                    onClick={() => handleDeleteMaterial(m.id)} title="Delete" disabled={deleteMutation.isPending}>
                    {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
              {openBreakdownId === m.id && (
                <div className="px-3 py-2 bg-muted/20 border-b border-border">
                  <RawMaterialBreakdown m={m} currencySymbol={currencySymbol} conversionRate={conversionRate} />
                </div>
              )}
            </React.Fragment>
          ))}
          <div className="flex justify-between items-center px-3 py-1.5 bg-muted/20">
            <span className="text-[11px] font-semibold text-muted-foreground">Total</span>
            <span className="text-xs font-bold tabular-nums">{currencySymbol}{(Number(calculateTotal()) * conversionRate).toFixed(2)}</span>
          </div>
        </div>
      )}
      <div className="px-3 py-2">
        <Button onClick={handleAddMaterial} variant="outline" size="sm" className="w-full"
          disabled={createMutation.isPending || updateMutation.isPending}>
          {createMutation.isPending || updateMutation.isPending
            ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving…</>
            : <><Plus className="h-3 w-3 mr-1" />Add Material</>}
        </Button>
      </div>
    </>
  );

  const tableContent = (
    <>
      {isLoading ? (
        <div className="flex items-center justify-center p-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="ml-2 text-xs text-muted-foreground">Loading materials...</span>
        </div>
      ) : error ? (
        <div className="p-6 text-center text-destructive">
          <p className="text-xs">Error loading materials</p>
          <p className="text-xs mt-1 text-muted-foreground">{error.message}</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-primary text-primary-foreground">
                  <th className="px-2 py-2 text-left text-[11px] font-semibold border-r border-primary-foreground/20">Material</th>
                  {compact ? null : <>
                    <th className="px-2 py-2 text-right text-[11px] font-semibold border-r border-primary-foreground/20 w-20">$/unit</th>
                    <th className="px-2 py-2 text-right text-[11px] font-semibold border-r border-primary-foreground/20 w-20">Gross (kg)</th>
                  </>}
                  <th className="px-2 py-2 text-right text-[11px] font-semibold border-r border-primary-foreground/20 w-20">Net (kg)</th>
                  {compact ? null : <>
                    <th className="px-2 py-2 text-right text-[11px] font-semibold border-r border-primary-foreground/20 w-16">Scrap%</th>
                    <th className="px-2 py-2 text-right text-[11px] font-semibold border-r border-primary-foreground/20 w-16">OH%</th>
                  </>}
                  <th className="px-2 py-2 text-right text-[11px] font-semibold border-r border-primary-foreground/20 w-24">Total ($)</th>
                  {compact ? null : <>
                    <th className="px-2 py-2 text-right text-[11px] font-semibold border-r border-primary-foreground/20 w-16">
                      <span className="flex items-center justify-end gap-0.5"><TrendingUp className="h-3 w-3" />Util%</span>
                    </th>
                    <th className="px-2 py-2 text-right text-[11px] font-semibold border-r border-primary-foreground/20 w-20">$/kg net</th>
                  </>}
                  <th className="px-2 py-2 text-center text-[11px] font-semibold w-16">Act.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {materials.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="p-6 text-center text-muted-foreground">
                      <p className="text-xs">No raw materials added yet</p>
                      <p className="text-xs mt-1">Click "Add Material" to get started</p>
                    </td>
                  </tr>
                ) : (
                  <>
                    {materials.map((material) => {
                      const utilRate  = Number(material.materialUtilizationRate) || 0;
                      const effPerKg  = Number(material.effectiveCostPerUnit)    || 0;
                      return (
                        <React.Fragment key={material.id}>
                          <tr className="hover:bg-secondary/50">
                            <td className="px-2 py-2 border-r border-border text-xs font-medium truncate max-w-[120px]" title={material.materialName}>{material.materialName}</td>
                            {compact ? null : <>
                              <td className="px-2 py-2 border-r border-border text-xs text-right tabular-nums">{currencySymbol}{((material.unitCost || 0) * conversionRate).toFixed(3)}</td>
                              <td className="px-2 py-2 border-r border-border text-xs text-right tabular-nums">{fmtUsage(material.grossUsage)}</td>
                            </>}
                            <td className="px-2 py-2 border-r border-border text-xs text-right tabular-nums">{fmtUsage(material.netUsage)}</td>
                            {compact ? null : <>
                              <td className="px-2 py-2 border-r border-border text-xs text-right tabular-nums">{material.scrap || 0}%</td>
                              <td className="px-2 py-2 border-r border-border text-xs text-right tabular-nums">{material.overhead || 0}%</td>
                            </>}
                            <td className="px-2 py-2 border-r border-border text-xs text-right font-semibold tabular-nums">
                              <div className="flex items-center justify-end gap-1">
                                <span>{currencySymbol}{(computeMatCost(material) * conversionRate).toFixed(4)}</span>
                                <button
                                  title="Show cost breakdown"
                                  onClick={() => setOpenBreakdownId(openBreakdownId === material.id ? null : material.id)}
                                  className={`rounded p-0.5 transition-colors ${openBreakdownId === material.id ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                                >
                                  <Eye className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                            {compact ? null : <>
                              <td className="px-2 py-2 border-r border-border text-xs text-right tabular-nums">
                                {utilRate > 0 ? (
                                  <span className={utilRate < 50 ? 'text-destructive font-medium' : utilRate < 75 ? 'text-amber-500' : 'text-emerald-600'}>
                                    {utilRate.toFixed(1)}%
                                  </span>
                                ) : '—'}
                              </td>
                              <td className="px-2 py-2 border-r border-border text-xs text-right tabular-nums text-muted-foreground">
                                {effPerKg > 0 ? `${currencySymbol}${(effPerKg * conversionRate).toFixed(3)}` : '—'}
                              </td>
                            </>}
                            <td className="px-2 py-2 text-center">
                              <div className="flex items-center justify-center gap-0.5">
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleEditMaterial(material)} title="Edit">
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                                  onClick={() => handleDeleteMaterial(material.id)} title="Delete" disabled={deleteMutation.isPending}>
                                  {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                                </Button>
                              </div>
                            </td>
                          </tr>

                          {openBreakdownId === material.id && (
                            <tr>
                              <td colSpan={colSpan} className="px-3 py-3 bg-muted/20 border-b border-border">
                                <RawMaterialBreakdown m={material} currencySymbol={currencySymbol} conversionRate={conversionRate} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}

                    <tr className="bg-secondary/30 font-semibold">
                      <td colSpan={compact ? 2 : 8} className="px-2 py-2 text-right border-r border-border text-xs">Total:</td>
                      <td colSpan={compact ? 1 : 2} className="px-2 py-2 border-r border-border text-xs text-right tabular-nums">{currencySymbol}{(Number(calculateTotal()) * conversionRate).toFixed(2)}</td>
                      <td className="px-2 py-2" />
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3">
            <Button onClick={handleAddMaterial} variant="outline" size="sm"
              disabled={createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? (
                <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving...</>
              ) : (
                <><Plus className="h-3 w-3 mr-1" />Add Material</>
              )}
            </Button>
          </div>
        </>
      )}
    </>
  );

  const dialog = (
    <RawMaterialDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      onSubmit={handleDialogSubmit}
      editData={editMaterial}
      bomItemData={bomItem}
      {...(location !== undefined ? { location } : {})}
    />
  );

  if (compact) {
    return (
      <div>
        {compactContent}
        {dialog}
      </div>
    );
  }

  return (
    <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
      <div className="bg-primary py-3 px-4">
        <h6 className="m-0 font-semibold text-primary-foreground">Raw Materials</h6>
      </div>
      <div className="bg-card p-4">{tableContent}</div>
      {dialog}
    </div>
  );
}
