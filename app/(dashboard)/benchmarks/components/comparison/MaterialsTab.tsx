"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package } from "lucide-react";
import type { BOMMetricEntry, MaterialCategory } from "../../types";
import { itemCost, itemWeight, safeNum, formatPrice, buildMaterialCategories, classifyMaterial } from "../../utils";

interface Props {
  bomMetrics: BOMMetricEntry[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawMaterials: any[];
}

export function MaterialsTab({ bomMetrics, rawMaterials }: Props) {
  const categories = buildMaterialCategories(rawMaterials);

  // Build full material analysis map
  const materialAnalysis = new Map<
    string,
    {
      material: string;
      bomPresence: boolean[];
      quantities: number[];
      costs: number[];
      partCount: number[];
    }
  >();

  bomMetrics.forEach((bd, bomIdx) =>
    bd.items?.forEach((item) => {
      const mat = item.material ?? item.materialGrade;
      if (!mat) return;
      if (!materialAnalysis.has(mat)) {
        materialAnalysis.set(mat, {
          material: mat,
          bomPresence: new Array(bomMetrics.length).fill(false),
          quantities: new Array(bomMetrics.length).fill(0),
          costs: new Array(bomMetrics.length).fill(0),
          partCount: new Array(bomMetrics.length).fill(0),
        });
      }
      const a = materialAnalysis.get(mat)!;
      a.bomPresence[bomIdx] = true;
      a.quantities[bomIdx] = (a.quantities[bomIdx] ?? 0) + safeNum(item.quantity);
      a.costs[bomIdx] = (a.costs[bomIdx] ?? 0) + itemCost(item);
      a.partCount[bomIdx] = (a.partCount[bomIdx] ?? 0) + 1;
    })
  );

  type CatEntry = { material: string; bomPresence: boolean[]; quantities: number[]; costs: number[]; partCount: number[] };
  const categorized: Record<MaterialCategory, CatEntry[]> = {
    Ferrous: [],
    "Non-Ferrous": [],
    Plastics: [],
    Rubber: [],
    Composites: [],
    Other: [],
  };
  materialAnalysis.forEach((analysis) => {
    const cat = classifyMaterial(analysis.material, categories);
    categorized[cat].push(analysis);
  });

  return (
    <div className="space-y-6 mt-4">
      {/* Summary benchmarking table */}
      <Card>
        <CardHeader>
          <CardTitle>Material Benchmarking</CardTitle>
          <CardDescription>Comprehensive material usage and cost analysis</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">Material Type</th>
                  {bomMetrics.map((bd) => (
                    <th key={bd.bom.id} className="text-center py-3 px-2 font-medium min-w-[120px]">
                      {bd.bom.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    {
                      label: "Ferrous Materials (kg)",
                      filter: (m?: string) => m ? classifyMaterial(m, categories) === "Ferrous" : false,
                      aggregate: "weight" as const,
                    },
                    {
                      label: "Non-Ferrous Materials (kg)",
                      filter: (m?: string) => m ? classifyMaterial(m, categories) === "Non-Ferrous" : false,
                      aggregate: "weight" as const,
                    },
                    {
                      label: "Plastic Components",
                      filter: (m?: string) => m ? classifyMaterial(m, categories) === "Plastics" : false,
                      aggregate: "count" as const,
                    },
                    {
                      label: "Rubber Components", 
                      filter: (m?: string) => m ? classifyMaterial(m, categories) === "Rubber" : false,
                      aggregate: "count" as const,
                    },
                    {
                      label: "Composite Materials",
                      filter: (m?: string) => m ? classifyMaterial(m, categories) === "Composites" : false,
                      aggregate: "count" as const,
                    },
                  ] as const
                ).map(({ label, filter, aggregate }) => (
                  <tr key={label} className="border-b hover:bg-muted/25">
                    <td className="py-3 px-2 font-medium">{label}</td>
                    {bomMetrics.map((bd) => {
                      const matching = (bd.items ?? []).filter((i) => filter(i.material));
                      const val =
                        aggregate === "weight"
                          ? matching.reduce((s, i) => s + itemWeight(i), 0).toFixed(2)
                          : matching.length.toString();
                      return (
                        <td key={bd.bom.id} className="text-center py-3 px-2">
                          {val}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Materials by category */}
      <Card>
        <CardHeader>
          <CardTitle>Materials by Category</CardTitle>
          <CardDescription>Material usage categorized by type</CardDescription>
        </CardHeader>
        <CardContent>
          {materialAnalysis.size > 0 ? (
            <div className="space-y-8">
              {/* Category summary */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {(Object.entries(categorized) as [MaterialCategory, CatEntry[]][])
                  .filter(([, items]) => items.length > 0)
                  .map(([cat, items]) => (
                    <Card key={cat} className="p-4">
                      <h4 className="text-sm font-semibold mb-2">{cat}</h4>
                      <p className="text-2xl font-bold text-primary">{items.length}</p>
                      <p className="text-xs text-muted-foreground">material types</p>
                    </Card>
                  ))}
              </div>

              {/* Detailed table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-2 font-medium">Material</th>
                      <th className="text-left py-3 px-2 font-medium">Category</th>
                      {bomMetrics.map((bd) => (
                        <th key={bd.bom.id} className="text-center py-3 px-2 font-medium min-w-[120px]">
                          {bd.bom.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(materialAnalysis.values()).map((a, idx) => {
                      const cat = classifyMaterial(a.material, categories);
                      return (
                        <tr key={idx} className="border-b hover:bg-muted/25">
                          <td className="py-3 px-2 font-medium">{a.material}</td>
                          <td className="py-3 px-2">
                            <Badge variant="outline" className="text-xs">
                              {cat}
                            </Badge>
                          </td>
                          {a.bomPresence.map((present, bIdx) => (
                            <td key={bIdx} className="text-center py-3 px-2">
                              {present ? (
                                <div className="space-y-1">
                                  <div className="text-sm font-medium">{a.partCount[bIdx]} parts</div>
                                  <div className="text-xs text-muted-foreground">
                                    Qty: {a.quantities[bIdx]}
                                  </div>
                                  {(a.costs[bIdx] ?? 0) > 0 && (
                                    <div className="text-xs text-green-600">
                                      {formatPrice(a.costs[bIdx] ?? 0)}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-xs">Not used</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="mx-auto h-8 w-8 mb-2" />
              <p className="text-sm">No material data found in selected BOMs</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}