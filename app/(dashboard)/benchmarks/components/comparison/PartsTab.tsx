"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GitCompare, Package } from "lucide-react";
import type { BOMMetricEntry, EnrichedBOMItem } from "../../types";
import { itemCost, itemWeight, safeNum, formatPrice } from "../../utils";

interface Props {
  bomMetrics: BOMMetricEntry[];
  selectedParts: Set<string>;
  showSelectedOnly: boolean;
  onPartToggle: (key: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onShowSelectedOnly: (v: boolean) => void;
  onAnalyzeSelected: () => void;
}

export function PartsTab({
  bomMetrics,
  selectedParts,
  showSelectedOnly,
  onPartToggle,
  onSelectAll,
  onClearAll,
  onShowSelectedOnly,
  onAnalyzeSelected,
}: Props) {
  const hasItems = bomMetrics.some((b) => b.items && b.items.length > 0);

  // Build unified parts map
  const buildPartsMap = () => {
    const map = new Map<
      string,
      {
        name: string;
        partNumber?: string;
        material?: string;
        itemType?: string;
        bomData: (EnrichedBOMItem | null)[];
      }
    >();

    bomMetrics.forEach((bd, bomIdx) => {
      bd.items?.forEach((item) => {
        const key = item.partNumber ?? item.name ?? `item-${item.id}`;
        if (!map.has(key)) {
          map.set(key, {
            name: item.name ?? "",
            partNumber: item.partNumber,
            material: item.material,
            itemType: item.itemType,
            bomData: new Array(bomMetrics.length).fill(null),
          });
        }
        map.get(key)!.bomData[bomIdx] = item;
      });
    });

    return map;
  };

  const allPartsMap = buildPartsMap();

  // Summary metrics
  const uniquePartCount = allPartsMap.size;

  const commonPartsCount = Array.from(allPartsMap.values()).filter(
    (p) => p.bomData.filter(Boolean).length === bomMetrics.length
  ).length;

  const costs = bomMetrics.map((b) => b.metrics.totalCost).filter((c) => c > 0);
  const costVariance =
    costs.length >= 2
      ? `${(((Math.max(...costs) - Math.min(...costs)) / Math.min(...costs)) * 100).toFixed(1)}%`
      : "0%";

  const weights = bomMetrics.map((b) => b.metrics.totalWeight).filter((w) => w > 0);
  const weightVariance =
    weights.length >= 2
      ? `${(((Math.max(...weights) - Math.min(...weights)) / Math.min(...weights)) * 100).toFixed(1)}%`
      : "0%";

  return (
    <div className="space-y-6 mt-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: "Total Unique Parts", color: "text-primary", value: uniquePartCount, sub: "Across all BOMs" },
          { label: "Common Parts", color: "text-green-600", value: commonPartsCount, sub: "Present in all BOMs" },
          { label: "Cost Variance", color: "text-orange-600", value: costVariance, sub: "Max vs Min BOM cost" },
          { label: "Weight Variance", color: "text-blue-600", value: weightVariance, sub: "Max vs Min BOM weight" },
        ].map(({ label, color, value, sub }) => (
          <Card key={label} className="p-4">
            <h4 className="text-sm font-semibold mb-2">{label}</h4>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground">{sub}</p>
          </Card>
        ))}
      </div>

      {/* Main comparison table */}
      <Card>
        <CardHeader>
          <CardTitle>Part-by-Part Comparison</CardTitle>
          <CardDescription>Detailed analysis of every part across all selected BOMs</CardDescription>
          <div className="flex items-center gap-3 mt-4">
            <Button size="sm" onClick={onSelectAll} variant="outline">
              Select All
            </Button>
            <Button size="sm" onClick={onClearAll} variant="outline">
              Clear
            </Button>
            {selectedParts.size > 0 && (
              <>
                <Button
                  size="sm"
                  onClick={showSelectedOnly ? () => onShowSelectedOnly(false) : onAnalyzeSelected}
                  className="gap-2"
                >
                  {showSelectedOnly ? (
                    <>
                      <Package className="h-4 w-4" />
                      Show All
                    </>
                  ) : (
                    <>
                      <GitCompare className="h-4 w-4" />
                      Analyze Selected
                    </>
                  )}
                </Button>
                <Badge variant="secondary">{selectedParts.size} parts selected</Badge>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {hasItems ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="w-12 text-center py-3 px-2">
                      <input
                        type="checkbox"
                        checked={selectedParts.size > 0}
                        onChange={selectedParts.size > 0 ? onClearAll : onSelectAll}
                        className="rounded"
                      />
                    </th>
                    <th className="text-left py-3 px-2 font-medium min-w-[250px]">Part Details</th>
                    <th className="text-center py-3 px-2 font-medium min-w-[120px]">Type & Material</th>
                    <th className="text-center py-3 px-2 font-medium min-w-[100px]">Dimensions</th>
                    {bomMetrics.map((bd) => (
                      <th key={bd.bom.id} className="text-center py-3 px-2 font-medium min-w-[140px]">
                        {bd.bom.name}
                        <div className="text-xs font-normal text-muted-foreground">
                          ({bd.metrics.totalParts} parts)
                        </div>
                      </th>
                    ))}
                    <th className="text-center py-3 px-2 font-medium min-w-[120px]">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(allPartsMap.values())
                    .filter((part, idx) => {
                      const key = part.partNumber ?? part.name ?? `part-${idx}`;
                      return !showSelectedOnly || selectedParts.has(key);
                    })
                    .map((part, idx) => {
                      const partKey = part.partNumber ?? part.name ?? `part-${idx}`;
                      const isSelected = selectedParts.has(partKey);
                      const rep = (part.bomData.find(Boolean) ?? {}) as EnrichedBOMItem;

                      const quantities = part.bomData.filter(Boolean).map((i) => safeNum(i!.quantity));
                      const costVals = part.bomData.filter(Boolean).map((i) => itemCost(i!));
                      const maxQty = quantities.length ? Math.max(...quantities) : 0;
                      const minQty = quantities.length ? Math.min(...quantities) : 0;
                      const maxCostV = costVals.length ? Math.max(...costVals) : 0;
                      const minCostV = costVals.length ? Math.min(...costVals) : 0;
                      const qtyVar = minQty > 0 ? ((maxQty - minQty) / minQty) * 100 : 0;
                      const costVarPct = minCostV > 0 ? ((maxCostV - minCostV) / minCostV) * 100 : 0;

                      return (
                        <tr
                          key={idx}
                          className={`border-b hover:bg-muted/25 ${isSelected ? "bg-primary/5" : ""}`}
                        >
                          <td className="py-3 px-2 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => onPartToggle(partKey)}
                              className="rounded"
                            />
                          </td>
                          <td className="py-3 px-2">
                            <div className="font-medium">{part.name}</div>
                            {part.partNumber && (
                              <div className="text-xs text-muted-foreground">
                                Part No: {part.partNumber}
                              </div>
                            )}
                            {rep.description && (
                              <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                {rep.description}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-2 text-center">
                            <div className="space-y-1">
                              {rep.itemType && (
                                <Badge variant="secondary" className="text-xs">
                                  {rep.itemType}
                                </Badge>
                              )}
                              {rep.material && (
                                <div className="text-xs text-muted-foreground">{rep.material}</div>
                              )}
                              {rep.makeBuy && (
                                <Badge
                                  variant={rep.makeBuy === "make" ? "default" : "outline"}
                                  className="text-xs"
                                >
                                  {rep.makeBuy}
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-2 text-center text-xs">
                            {rep.maxLength && rep.maxWidth && rep.maxHeight ? (
                              <div>
                                {rep.maxLength}×{rep.maxWidth}×{rep.maxHeight}
                              </div>
                            ) : rep.length && rep.width ? (
                              <div>
                                {rep.length}×{rep.width}
                              </div>
                            ) : (
                              <div className="text-muted-foreground">-</div>
                            )}
                            {(safeNum(rep.weight) || safeNum(rep.unitWeight)) > 0 && (
                              <div className="text-muted-foreground">
                                {(safeNum(rep.weight) || safeNum(rep.unitWeight)).toFixed(2)}kg
                              </div>
                            )}
                          </td>
                          {part.bomData.map((item, bIdx) => (
                            <td key={bIdx} className="text-center py-3 px-2">
                              {item ? (
                                <div className="space-y-1">
                                  <div className="font-medium text-sm">Qty: {item.quantity}</div>
                                  {safeNum(item.unitCost) > 0 && (
                                    <>
                                      <div className="text-xs text-green-600 font-medium">
                                        {formatPrice(itemCost(item))}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        @{formatPrice(safeNum(item.unitCost))}
                                      </div>
                                    </>
                                  )}
                                  {itemWeight(item) > 0 && (
                                    <div className="text-xs text-blue-600">
                                      {itemWeight(item).toFixed(2)}kg
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-xs">Not present</span>
                              )}
                            </td>
                          ))}
                          <td className="py-3 px-2 text-center">
                            <div className="space-y-1">
                              {qtyVar > 0 && (
                                <Badge
                                  variant={qtyVar > 20 ? "destructive" : "secondary"}
                                  className="text-xs"
                                >
                                  Qty: {qtyVar.toFixed(1)}%
                                </Badge>
                              )}
                              {costVarPct > 0 && (
                                <Badge
                                  variant={costVarPct > 30 ? "destructive" : "default"}
                                  className="text-xs"
                                >
                                  Cost: {costVarPct.toFixed(1)}%
                                </Badge>
                              )}
                              <div className="text-xs text-muted-foreground">
                                In {part.bomData.filter(Boolean).length}/{bomMetrics.length} BOMs
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="mx-auto h-8 w-8 mb-2" />
              <p className="text-sm">No BOM data available for part comparison</p>
              <p className="text-xs">Add parts to the BOMs to enable detailed analysis</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analysis cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <HighVarianceCard bomMetrics={bomMetrics} />
        <StandardizationCard bomMetrics={bomMetrics} />
        <MissingPartsCard bomMetrics={bomMetrics} />
        <CostOptimizationCard bomMetrics={bomMetrics} />
      </div>
    </div>
  );
}

// ─── Sub-cards ────────────────────────────────────────────────────────────────

function HighVarianceCard({ bomMetrics }: { bomMetrics: BOMMetricEntry[] }) {
  const map = new Map<
    string,
    { name: string; partNumber?: string; bomData: (EnrichedBOMItem | null)[] }
  >();
  bomMetrics.forEach((bd, bIdx) =>
    bd.items?.forEach((item) => {
      const k = item.partNumber ?? item.name ?? "";
      if (!map.has(k))
        map.set(k, {
          name: item.name ?? "",
          partNumber: item.partNumber,
          bomData: new Array(bomMetrics.length).fill(null),
        });
      map.get(k)!.bomData[bIdx] = item;
    })
  );

  const high = Array.from(map.values())
    .map((part) => {
      const qs = part.bomData.filter(Boolean).map((i) => safeNum(i!.quantity));
      const cs = part.bomData.filter(Boolean).map((i) => itemCost(i!));
      const qv = qs.length > 1 && Math.min(...qs) > 0
        ? ((Math.max(...qs) - Math.min(...qs)) / Math.min(...qs)) * 100
        : 0;
      const cv = cs.length > 1 && Math.min(...cs) > 0
        ? ((Math.max(...cs) - Math.min(...cs)) / Math.min(...cs)) * 100
        : 0;
      return { ...part, maxVar: Math.max(qv, cv) };
    })
    .filter((p) => p.maxVar > 20)
    .sort((a, b) => b.maxVar - a.maxVar)
    .slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>High Variance Parts</CardTitle>
        <CardDescription>Parts with significant quantity or cost differences</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {high.length > 0 ? (
            high.map((part, i) => (
              <div
                key={i}
                className="flex justify-between items-center p-3 bg-yellow-50 rounded border border-yellow-200"
              >
                <div>
                  <div className="font-medium">{part.name}</div>
                  <div className="text-xs text-muted-foreground">{part.partNumber}</div>
                </div>
                <Badge variant="destructive" className="text-xs">
                  {part.maxVar.toFixed(1)}% variance
                </Badge>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No high variance parts detected
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StandardizationCard({ bomMetrics }: { bomMetrics: BOMMetricEntry[] }) {
  const byMat = new Map<string, EnrichedBOMItem[]>();
  bomMetrics.forEach((bd) =>
    bd.items?.forEach((item) => {
      if (item.material && item.itemType === "child_part") {
        if (!byMat.has(item.material)) byMat.set(item.material, []);
        byMat.get(item.material)!.push(item);
      }
    })
  );

  const opps = Array.from(byMat.entries())
    .filter(([, parts]) => parts.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Standardization Opportunities</CardTitle>
        <CardDescription>Parts that could be standardized across BOMs</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {opps.length > 0 ? (
            opps.map(([mat, parts], i) => (
              <div
                key={i}
                className="flex justify-between items-center p-3 bg-blue-50 rounded border border-blue-200"
              >
                <div>
                  <div className="font-medium">{mat}</div>
                  <div className="text-xs text-muted-foreground">{parts.length} similar parts</div>
                </div>
                <Badge variant="default" className="text-xs">
                  Standardize
                </Badge>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No standardization opportunities identified
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MissingPartsCard({ bomMetrics }: { bomMetrics: BOMMetricEntry[] }) {
  const map = new Map<string, { name: string; partNumber?: string; bomIndices: number[] }>();
  bomMetrics.forEach((bd, bIdx) =>
    bd.items?.forEach((item) => {
      const k = item.partNumber ?? item.name ?? "";
      if (!map.has(k)) map.set(k, { name: item.name ?? "", partNumber: item.partNumber, bomIndices: [] });
      map.get(k)!.bomIndices.push(bIdx);
    })
  );

  const missing = Array.from(map.values())
    .filter((p) => p.bomIndices.length > 1 && p.bomIndices.length < bomMetrics.length)
    .sort((a, b) => b.bomIndices.length - a.bomIndices.length)
    .slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Missing Parts Analysis</CardTitle>
        <CardDescription>Parts present in some BOMs but missing in others</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {missing.length > 0 ? (
            missing.map((part, i) => (
              <div
                key={i}
                className="flex justify-between items-center p-3 bg-orange-50 rounded border border-orange-200"
              >
                <div>
                  <div className="font-medium">{part.name}</div>
                  <div className="text-xs text-muted-foreground">{part.partNumber}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-orange-600">
                    Missing from {bomMetrics.length - part.bomIndices.length} BOMs
                  </div>
                  <Badge variant="outline" className="text-xs mt-1">
                    {part.bomIndices.length}/{bomMetrics.length} BOMs
                  </Badge>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No missing parts detected
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CostOptimizationCard({ bomMetrics }: { bomMetrics: BOMMetricEntry[] }) {
  const map = new Map<string, { name: string; partNumber?: string; totalCost: number; count: number }>();
  bomMetrics.forEach((bd) =>
    bd.items?.forEach((item) => {
      const k = item.partNumber ?? item.name ?? "";
      const existing = map.get(k) ?? { name: item.name ?? "", partNumber: item.partNumber, totalCost: 0, count: 0 };
      map.set(k, { ...existing, totalCost: existing.totalCost + itemCost(item), count: existing.count + 1 });
    })
  );

  const top = Array.from(map.values())
    .filter((p) => p.totalCost / p.count > 100)
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost Optimization</CardTitle>
        <CardDescription>Highest cost-impact parts</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {top.length > 0 ? (
            top.map((part, i) => (
              <div
                key={i}
                className="flex justify-between items-center p-3 bg-green-50 rounded border border-green-200"
              >
                <div>
                  <div className="font-medium">{part.name}</div>
                  <div className="text-xs text-muted-foreground">{part.partNumber}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-green-600">
                    {formatPrice(part.totalCost)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Avg: {formatPrice(part.totalCost / part.count)}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No high-cost parts requiring optimization
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}