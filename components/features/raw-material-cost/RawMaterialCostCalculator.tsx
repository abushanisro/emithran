"use client";

/**
 * Raw Material Cost Calculator Component (INR-Native)
 * Dark-themed table UI matching Process Costs design
 *
 * @author Manufacturing Cost Engineering Team
 * @version 3.0.0 (INR-Native + Dark Theme)
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, SquarePen, Trash2 } from 'lucide-react';

interface RawMaterial {
  id: string;
  materialName: string;
  unitCost: number;
  grossUsage: number;
  netUsage: number;
  scrap: number;
  reclaimRate: number;
  overhead: number;
  uom: string;
  totalCost: number;
}

interface RawMaterialCostCalculatorProps {
  initialMaterials?: RawMaterial[];
  onMaterialsChange?: (materials: RawMaterial[]) => void;
  readOnly?: boolean;
}

// Calculate single material cost
function calculateMaterialCost(material: Omit<RawMaterial, 'id' | 'totalCost'>): number {
  const grossMaterialCost = material.grossUsage * material.unitCost;
  const scrapAmount = material.grossUsage - material.netUsage;
  const reclaimValue = scrapAmount * material.reclaimRate;
  const netMaterialCost = grossMaterialCost - reclaimValue;
  const scrapAdjustment = netMaterialCost * (material.scrap / 100);
  const subtotal = netMaterialCost + scrapAdjustment;
  const overheadCost = subtotal * (material.overhead / 100);
  const totalCost = subtotal + overheadCost;
  return Math.round(totalCost * 1000) / 1000;
}

export function RawMaterialCostCalculator({
  initialMaterials = [],
  onMaterialsChange,
  readOnly = false,
}: RawMaterialCostCalculatorProps) {
  const [materials, setMaterials] = useState<RawMaterial[]>(initialMaterials);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Calculate total cost
  const totalCost = materials.reduce((sum, m) => sum + m.totalCost, 0);

  // Add new material
  const handleAddMaterial = () => {
    const newMaterial: RawMaterial = {
      id: `mat-${Date.now()}`,
      materialName: 'New Material',
      unitCost: 0,
      grossUsage: 0,
      netUsage: 0,
      scrap: 0,
      reclaimRate: 0,
      overhead: 0,
      uom: 'KG',
      totalCost: 0,
    };
    const updated = [...materials, newMaterial];
    setMaterials(updated);
    onMaterialsChange?.(updated);
  };

  // Update material field
  const handleUpdateMaterial = (id: string, field: keyof RawMaterial, value: string | number) => {
    const updated = materials.map(m => {
      if (m.id === id) {
        const updatedMaterial = { ...m, [field]: value };
        // Recalculate total cost
        if (field !== 'id' && field !== 'totalCost') {
          updatedMaterial.totalCost = calculateMaterialCost(updatedMaterial);
        }
        return updatedMaterial;
      }
      return m;
    });
    setMaterials(updated);
    onMaterialsChange?.(updated);
  };

  // Delete material
  const handleDeleteMaterial = (id: string) => {
    const updated = materials.filter(m => m.id !== id);
    setMaterials(updated);
    onMaterialsChange?.(updated);
  };

  // Toggle edit mode
  const handleEdit = (id: string) => {
    setEditingId(editingId === id ? null : id);
  };

  return (
    <div className="bg-[#0a0a0a] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-cyan-500/20">
        <h2 className="text-xl font-semibold text-white">Raw Material Costs</h2>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-cyan-500">
              <th className="px-4 py-3 text-left text-sm font-semibold text-black">
                Material
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-black">
                Unit Cost
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-black">
                Gross Usage
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-black">
                Net Usage
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-black">
                Scrap %
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-black">
                Reclaim Rate
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-black">
                Overhead %
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-black">
                Total Cost ($)
              </th>
              <th className="px-4 py-3 text-center text-sm font-semibold text-black">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {materials.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-gray-500 text-sm">
                  No materials added. Click "Add Material" to get started.
                </td>
              </tr>
            ) : (
              materials.map((material) => {
                const isEditing = editingId === material.id;

                return (
                  <tr key={material.id} className="border-b border-gray-800 hover:bg-gray-900/50">
                    {/* Material Name */}
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <Input
                          className="h-8 text-xs bg-gray-900 border-gray-700 text-white"
                          placeholder="Material name"
                          value={material.materialName || ''}
                          onChange={(e) =>
                            handleUpdateMaterial(material.id, 'materialName', e.target.value)
                          }
                        />
                      ) : (
                        <div className="text-sm text-white">{material.materialName || '-'}</div>
                      )}
                    </td>

                    {/* Unit Cost */}
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <Input
                          className="h-8 text-xs bg-gray-900 border-gray-700 text-white"
                          type="number"
                          step="0.01"
                          value={material.unitCost ?? 0}
                          onChange={(e) =>
                            handleUpdateMaterial(material.id, 'unitCost', parseFloat(e.target.value) || 0)
                          }
                        />
                      ) : (
                        <div className="text-sm text-white">{material.unitCost.toFixed(2)}</div>
                      )}
                    </td>

                    {/* Gross Usage */}
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <Input
                          className="h-8 text-xs bg-gray-900 border-gray-700 text-white"
                          type="number"
                          step="0.01"
                          value={material.grossUsage ?? 0}
                          onChange={(e) =>
                            handleUpdateMaterial(material.id, 'grossUsage', parseFloat(e.target.value) || 0)
                          }
                        />
                      ) : (
                        <div className="text-sm text-white">{material.grossUsage.toFixed(2)}</div>
                      )}
                    </td>

                    {/* Net Usage */}
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <Input
                          className="h-8 text-xs bg-gray-900 border-gray-700 text-white"
                          type="number"
                          step="0.01"
                          value={material.netUsage ?? 0}
                          onChange={(e) =>
                            handleUpdateMaterial(material.id, 'netUsage', parseFloat(e.target.value) || 0)
                          }
                        />
                      ) : (
                        <div className="text-sm text-white">{material.netUsage.toFixed(2)}</div>
                      )}
                    </td>

                    {/* Scrap % */}
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <Input
                          className="h-8 text-xs bg-gray-900 border-gray-700 text-white"
                          type="number"
                          step="0.1"
                          value={material.scrap ?? 0}
                          onChange={(e) =>
                            handleUpdateMaterial(material.id, 'scrap', parseFloat(e.target.value) || 0)
                          }
                        />
                      ) : (
                        <div className="text-sm text-white">{material.scrap.toFixed(1)}</div>
                      )}
                    </td>

                    {/* Reclaim Rate */}
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <Input
                          className="h-8 text-xs bg-gray-900 border-gray-700 text-white"
                          type="number"
                          step="0.01"
                          value={material.reclaimRate ?? 0}
                          onChange={(e) =>
                            handleUpdateMaterial(material.id, 'reclaimRate', parseFloat(e.target.value) || 0)
                          }
                        />
                      ) : (
                        <div className="text-sm text-white">{material.reclaimRate.toFixed(2)}</div>
                      )}
                    </td>

                    {/* Overhead % */}
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <Input
                          className="h-8 text-xs bg-gray-900 border-gray-700 text-white"
                          type="number"
                          step="0.1"
                          value={material.overhead ?? 0}
                          onChange={(e) =>
                            handleUpdateMaterial(material.id, 'overhead', parseFloat(e.target.value) || 0)
                          }
                        />
                      ) : (
                        <div className="text-sm text-white">{material.overhead.toFixed(1)}</div>
                      )}
                    </td>

                    {/* Total Cost */}
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-white">
                        {material.totalCost.toFixed(2)}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-gray-400 hover:text-white hover:bg-gray-800"
                          onClick={() => handleEdit(material.id)}
                          title={isEditing ? 'Done' : 'Edit'}
                          disabled={readOnly}
                        >
                          <SquarePen className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-400 hover:bg-gray-800"
                          onClick={() => handleDeleteMaterial(material.id)}
                          title="Delete"
                          disabled={readOnly}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}

            {/* Total Row */}
            {materials.length > 0 && (
              <tr className="border-t border-gray-700">
                <td colSpan={7} className="px-4 py-3 text-right text-sm font-semibold text-white">
                  Total:
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-white">
                  ${totalCost.toFixed(2)}
                </td>
                <td className="px-4 py-3"></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Material Button */}
      {!readOnly && (
        <div className="px-6 py-4">
          <Button
            variant="outline"
            onClick={handleAddMaterial}
            className="bg-transparent border-gray-700 text-white hover:bg-gray-900 hover:border-gray-600"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Material
          </Button>
        </div>
      )}
    </div>
  );
}
