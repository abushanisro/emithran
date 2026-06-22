'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Edit, Trash2, Loader2, Eye, Database, FlaskConical } from 'lucide-react';
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

function RawMaterialBreakdown({ m }: { m: any }) {
  const gross    = Number(m.grossUsage || 0);
  const net      = Number(m.netUsage   || 0);
  const unitCost = Number(m.unitCost   || 0);
  const scrap    = Number(m.scrap      || 0);
  const overhead = Number(m.overhead   || 0);

  const materialCost = gross * unitCost;
  const overheadAmt  = materialCost * (overhead / 100);
  const total        = materialCost + overheadAmt;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Inputs */}
      <div>
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Inputs</p>
        <BRow label="Material"                          value={m.materialName || '—'} />
        {m.materialDescription && (
          <BRow label="Grade / Spec"                    value={m.materialDescription} />
        )}
        <BRow label="Unit Cost (₹/kg)"                  value={`₹${unitCost.toFixed(2)}`}    icon="db" />
        <BRow label="Net Usage (Unit Reference: kg)"    value={`${net.toFixed(4)} kg`} />
        <BRow label="Gross Usage (Unit Reference: kg)"  value={`${gross.toFixed(4)} kg`} />
        <BRow label="Scrap %"                           value={`${scrap}`} />
        <BRow label="Overhead %"                        value={`${overhead}`} />
      </div>

      {/* Formula steps */}
      <div>
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Formula Steps</p>
        <BRow
          label="Net usage"
          value={`${net.toFixed(4)} kg`}
          sub="volume_mm³ × density_kg/m³ × 1e-9"
        />
        <BRow
          label={`Gross usage (scrap ${scrap}%)`}
          value={`${gross.toFixed(4)} kg`}
          sub={`= ${net.toFixed(4)} ÷ (1 − ${scrap}/100)`}
          icon="formula"
        />
        <Divider />
        <BRow
          label="Material cost"
          value={`₹${materialCost.toFixed(4)}`}
          sub={`= ${gross.toFixed(4)} kg × ₹${unitCost.toFixed(2)}/kg`}
          icon="formula"
        />
        {overhead > 0 && (
          <BRow
            label={`Overhead (${overhead}%)`}
            value={`₹${overheadAmt.toFixed(4)}`}
            sub={`= ₹${materialCost.toFixed(4)} × ${overhead}%`}
            icon="formula"
          />
        )}
        <BRow label="Total per part" value={`₹${total.toFixed(4)}`} highlight />
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function RawMaterialsSection({ bomItemId, bomItem }: RawMaterialsSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editMaterial, setEditMaterial] = useState<any | null>(null);
  const [openBreakdownId, setOpenBreakdownId] = useState<string | null>(null);

  const { data, isLoading, error } = useRawMaterialCosts({
    bomItemId,
    isActive: true,
    enabled: !!bomItemId,
  });

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
    try {
      if (editMaterial?.id) {
        await updateMutation.mutateAsync({
          id: editMaterial.id,
          data: {
            materialId: data.materialId,
            materialName: data.materialName,
            materialGroup: data.materialGroup,
            materialType: data.materialType,
            materialDescription: data.materialDescription,
            country: data.country,
            quarter: data.quarter,
            unitCost: data.unitCost,
            grossUsage: data.grossUsage,
            netUsage: data.netUsage,
            scrap: data.scrap,
            overhead: data.overhead,
            notes: data.notes,
          },
        });
      } else {
        await createMutation.mutateAsync({
          bomItemId,
          materialId: data.materialId,
          materialName: data.materialName,
          materialGroup: data.materialGroup,
          materialType: data.materialType,
          materialDescription: data.materialDescription,
          country: data.country,
          quarter: data.quarter,
          unitCost: data.unitCost,
          grossUsage: data.grossUsage,
          netUsage: data.netUsage,
          scrap: data.scrap,
          overhead: data.overhead,
          notes: data.notes,
          isActive: true,
        });
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
      } catch (error) {}
    }
  };

  const fmtUsage = (v: any): string => {
    const n = Number(v || 0);
    return n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2);
  };

  const computeMatCost = (m: any): number => {
    const gross    = Number(m.grossUsage || 0);
    const unit     = Number(m.unitCost   || 0);
    const overhead = Number(m.overhead   || 0);
    return gross * unit * (1 + overhead / 100);
  };

  const calculateTotal = () =>
    materials.reduce((sum, m) => sum + computeMatCost(m), 0).toFixed(2);

  if (!bomItemId) {
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

  return (
    <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
      <div className="bg-primary py-3 px-4">
        <h6 className="m-0 font-semibold text-primary-foreground">Raw Materials</h6>
      </div>
      <div className="bg-card p-4">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">Loading materials...</span>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-destructive">
            <p className="text-sm">Error loading materials</p>
            <p className="text-xs mt-1">{error.message}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-primary text-primary-foreground">
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 min-w-[150px]">
                      Material
                    </th>
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">
                      Unit Cost (₹)
                    </th>
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">
                      Gross Usage
                    </th>
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">
                      Net Usage
                    </th>
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-24">
                      Scrap %
                    </th>
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-28">
                      Overhead %
                    </th>
                    <th className="p-3 text-left text-xs font-semibold border-r border-primary-foreground/20 w-36">
                      Total Cost (₹)
                    </th>
                    <th className="p-3 text-center text-xs font-semibold w-24">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {materials.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-muted-foreground">
                        <p className="text-sm">No raw materials added yet</p>
                        <p className="text-xs mt-1">Click "Add Material" to get started</p>
                      </td>
                    </tr>
                  ) : (
                    <>
                      {materials.map((material) => (
                        <React.Fragment key={material.id}>
                          <tr className="hover:bg-secondary/50">
                            <td className="p-3 border-r border-border text-xs font-medium">
                              {material.materialName}
                            </td>
                            <td className="p-3 border-r border-border text-xs text-right">
                              ₹{(material.unitCost || 0).toFixed(2)}
                            </td>
                            <td className="p-3 border-r border-border text-xs text-right">
                              {fmtUsage(material.grossUsage)}
                            </td>
                            <td className="p-3 border-r border-border text-xs text-right">
                              {fmtUsage(material.netUsage)}
                            </td>
                            <td className="p-3 border-r border-border text-xs text-right">
                              {material.scrap || 0}%
                            </td>
                            <td className="p-3 border-r border-border text-xs text-right">
                              {material.overhead || 0}%
                            </td>
                            <td className="p-3 border-r border-border text-xs text-right font-semibold">
                              <div className="flex items-center justify-end gap-1.5">
                                <span>₹{computeMatCost(material).toFixed(2)}</span>
                                <button
                                  title="Show calculation"
                                  onClick={() => setOpenBreakdownId(openBreakdownId === material.id ? null : material.id)}
                                  className={`rounded p-0.5 transition-colors ${
                                    openBreakdownId === material.id
                                      ? 'text-primary bg-primary/10'
                                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                  }`}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => handleEditMaterial(material)}
                                  title="Edit"
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                  onClick={() => handleDeleteMaterial(material.id)}
                                  title="Delete"
                                  disabled={deleteMutation.isPending}
                                >
                                  {deleteMutation.isPending ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                            </td>
                          </tr>

                          {/* Breakdown row */}
                          {openBreakdownId === material.id && (
                            <tr>
                              <td colSpan={8} className="px-4 py-3 bg-muted/20 border-b border-border">
                                <RawMaterialBreakdown m={material} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}

                      <tr className="bg-secondary/30 font-semibold">
                        <td colSpan={6} className="p-3 text-right border-r border-border text-xs">
                          Total:
                        </td>
                        <td className="p-3 border-r border-border text-xs text-right">
                          ₹{calculateTotal()}
                        </td>
                        <td className="p-3"></td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4">
              <Button
                onClick={handleAddMaterial}
                variant="outline"
                size="sm"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3 mr-1" />
                    Add Material
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>

      <RawMaterialDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleDialogSubmit}
        editData={editMaterial}
        bomItemData={bomItem}
      />
    </div>
  );
}
