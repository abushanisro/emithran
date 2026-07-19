"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Download, Info, TriangleAlert, Zap } from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BOMMetricEntry, EnrichedBOMItem, HighCostPart } from "../types";
import { itemCost, itemWeight, safeNum, formatPrice } from "../utils";

type ResolvedBOMMetricEntry = Omit<BOMMetricEntry, 'items'> & { items: EnrichedBOMItem[] };

interface Props {
  bomMetrics: BOMMetricEntry[];
  selectedParts: Set<string>;
  onBack: () => void;
}

export function SelectedPartsAnalysis({ bomMetrics, selectedParts, onBack }: Props) {
  // Filter BOM metrics to only selected parts
  const filteredBomMetrics: ResolvedBOMMetricEntry[] = bomMetrics.map((bd) => ({
    ...bd,
    items: (bd.items ?? []).filter((item) => {
      const key = item.partNumber ?? item.name ?? `item-${item.id}`;
      return selectedParts.has(key);
    }),
  }));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-bold">
              Selected Parts Analysis ({selectedParts.size} parts)
            </h1>
            <p className="text-xs text-muted-foreground">
              Detailed analysis for selected parts across {bomMetrics.length} BOMs
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm">
          <Download className="h-3.5 w-3.5 mr-2" />
          Export Analysis
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="cost-weight" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="cost-weight">Cost & Weight Analysis</TabsTrigger>
          <TabsTrigger value="materials">Materials & Processes</TabsTrigger>
          <TabsTrigger value="assembly">Assembly & Design</TabsTrigger>
          <TabsTrigger value="vave">VAVE Opportunities</TabsTrigger>
        </TabsList>

        {/* ── Cost & Weight ── */}
        <TabsContent value="cost-weight" className="space-y-6 mt-4">
          <CostWeightContent filteredBomMetrics={filteredBomMetrics} />
        </TabsContent>

        {/* ── Materials & Processes ── */}
        <TabsContent value="materials" className="space-y-6 mt-4">
          <MaterialsContent filteredBomMetrics={filteredBomMetrics} />
        </TabsContent>

        {/* ── Assembly & Design ── */}
        <TabsContent value="assembly" className="space-y-6 mt-4">
          <AssemblyContent filteredBomMetrics={filteredBomMetrics} />
        </TabsContent>

        {/* ── VAVE ── */}
        <TabsContent value="vave" className="space-y-6 mt-4">
          <VAVEContent filteredBomMetrics={filteredBomMetrics} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Cost & Weight content ────────────────────────────────────────────────────

function CostWeightContent({ filteredBomMetrics }: { filteredBomMetrics: ResolvedBOMMetricEntry[] }) {
  return (
    <>
      {/* Cost analysis table */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Analysis - Selected Parts</CardTitle>
          <CardDescription>
            Cost breakdown for selected parts across BOMs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">Metric</th>
                  {filteredBomMetrics.map((bd) => (
                    <th key={bd.bom.id} className="text-center py-3 px-2 font-medium min-w-[120px]">
                      {bd.bom.name}
                    </th>
                  ))}
                  <th className="text-center py-3 px-2 font-medium">Variance</th>
                </tr>
              </thead>
              <tbody>
                {/* Total cost */}
                <tr className="border-b hover:bg-muted/25">
                  <td className="py-3 px-2 font-medium">Total Selected Parts Cost</td>
                  {filteredBomMetrics.map((bd) => {
                    const total = bd.items.reduce((s, i) => s + itemCost(i), 0);
                    const costed = bd.items.filter((i) => safeNum(i.unitCost) > 0).length;
                    return (
                      <td key={bd.bom.id} className="text-center py-3 px-2">
                        <div className="font-medium">
                          {total > 0 ? formatPrice(total) : "No cost data"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {costed} of {bd.items.length} costed
                        </div>
                      </td>
                    );
                  })}
                  <td className="text-center py-3 px-2">
                    {(() => {
                      const costs = filteredBomMetrics
                        .map((bd) => bd.items.reduce((s, i) => s + itemCost(i), 0))
                        .filter((c) => c > 0);
                      if (costs.length < 2) return "-";
                      const max = Math.max(...costs);
                      const min = Math.min(...costs);
                      const v = ((max - min) / min) * 100;
                      return (
                        <div className="space-y-1">
                          <Badge variant={v > 20 ? "destructive" : "secondary"}>
                            {v.toFixed(1)}%
                          </Badge>
                          <div className="text-xs text-muted-foreground">
                            {formatPrice(max - min)} diff
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                </tr>

                {/* Average cost */}
                <tr className="border-b hover:bg-muted/25">
                  <td className="py-3 px-2 font-medium">Average Cost per Part</td>
                  {filteredBomMetrics.map((bd) => {
                    const costed = bd.items.filter((i) => safeNum(i.unitCost) > 0);
                    const total = bd.items.reduce((s, i) => s + itemCost(i), 0);
                    const avg = costed.length > 0 ? total / costed.length : 0;
                    return (
                      <td key={bd.bom.id} className="text-center py-3 px-2">
                        <div className="font-medium">
                          {avg > 0 ? formatPrice(avg) : "No cost data"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Avg of {costed.length} parts
                        </div>
                      </td>
                    );
                  })}
                  <td className="text-center py-3 px-2">
                    <Badge variant="outline">Avg</Badge>
                  </td>
                </tr>

                {/* Weight */}
                <tr className="border-b hover:bg-muted/25">
                  <td className="py-3 px-2 font-medium">Total Weight (kg)</td>
                  {filteredBomMetrics.map((bd) => (
                    <td key={bd.bom.id} className="text-center py-3 px-2 font-mono">
                      {bd.items.reduce((s, i) => s + itemWeight(i), 0).toFixed(2)}
                    </td>
                  ))}
                  <td className="text-center py-3 px-2">
                    {(() => {
                      const ws = filteredBomMetrics
                        .map((bd) => bd.items.reduce((s, i) => s + itemWeight(i), 0))
                        .filter((w) => w > 0);
                      if (ws.length < 2) return "-";
                      const v =
                        ((Math.max(...ws) - Math.min(...ws)) / Math.min(...ws)) * 100;
                      return (
                        <Badge variant={v > 15 ? "destructive" : "secondary"}>
                          {v.toFixed(1)}%
                        </Badge>
                      );
                    })()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Cost data status */}
      <Card className="border-slate-600 bg-slate-800">
        <CardHeader>
          <CardTitle className="text-slate-100">Cost Data Status</CardTitle>
          <CardDescription className="text-slate-300">
            Cost analysis coverage for selected parts
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(() => {
            const totalParts = filteredBomMetrics.reduce((s, bd) => s + bd.items.length, 0);
            const costedParts = filteredBomMetrics.reduce(
              (s, bd) => s + bd.items.filter((i) => safeNum(i.unitCost) > 0).length,
              0
            );
            const missing = totalParts - costedParts;
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-slate-700 rounded border border-slate-500">
                    <div className="text-2xl font-bold text-blue-400">{totalParts}</div>
                    <div className="text-sm text-slate-200">Total Parts</div>
                  </div>
                  <div className="text-center p-4 bg-slate-700 rounded border border-slate-500">
                    <div className="text-2xl font-bold text-green-400">{costedParts}</div>
                    <div className="text-sm text-slate-200">With Cost Data</div>
                  </div>
                  <div className="text-center p-4 bg-slate-700 rounded border border-slate-500">
                    <div className="text-2xl font-bold text-red-400">{missing}</div>
                    <div className="text-sm text-slate-200">Missing Cost Data</div>
                  </div>
                </div>
                {missing > 0 && (
                  <div className="bg-amber-900 border border-amber-600 rounded p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TriangleAlert className="h-4 w-4 text-amber-400" />
                      <span className="text-sm font-semibold text-amber-100">Cost Data Required</span>
                    </div>
                    <p className="text-xs text-amber-200">
                      {missing} parts are missing unit cost information.
                    </p>
                  </div>
                )}
                {costedParts === 0 && (
                  <div className="bg-blue-900 border border-blue-600 rounded p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Info className="h-4 w-4 text-blue-400" />
                      <span className="text-sm font-semibold text-blue-100">Alternative Analysis</span>
                    </div>
                    <p className="text-xs text-blue-200">
                      While cost analysis is unavailable, you can still analyze Materials,
                      Processes, Assembly complexity, and VAVE opportunities.
                    </p>
                  </div>
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Part details table */}
      <Card>
        <CardHeader>
          <CardTitle>Part Details</CardTitle>
          <CardDescription>Selected parts cost breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          <PartDetailsTable filteredBomMetrics={filteredBomMetrics} />
        </CardContent>
      </Card>

      {/* Cost & weight charts */}
      <div>
        <h2 className="text-xl font-bold mb-2">Cost & Weight Charts</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 mb-6">
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-4">Total Cost by BOM</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={filteredBomMetrics.map((bd) => ({
                  name: bd.bom.name,
                  cost: bd.items.reduce((s, i) => s + itemCost(i), 0),
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={70} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`$${Number(v).toFixed(0)}`, "Total Cost"]} />
                <Bar dataKey="cost" fill="hsl(220, 70%, 45%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-4">Weight Distribution</h3>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={filteredBomMetrics.map((bd) => ({
                    name: bd.bom.name,
                    value: bd.items.reduce((s, i) => s + itemWeight(i), 0),
                  }))}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${Number(value).toFixed(1)}kg`}
                  outerRadius={80}
                  dataKey="value"
                >
                  {filteredBomMetrics.map((_, index) => (
                    <Cell key={index} fill={`hsl(${220 + index * 40}, 70%, ${45 + index * 10}%)`} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [`${Number(v).toFixed(2)}kg`, "Weight"]} />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-4">Cost per Kilogram</h3>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart
                data={filteredBomMetrics.map((bd) => {
                  const totalCost = bd.items.reduce((s, i) => s + itemCost(i), 0);
                  const totalWeight = bd.items.reduce((s, i) => s + itemWeight(i), 0);
                  return {
                    name: bd.bom.name,
                    costPerKg: totalWeight > 0 ? totalCost / totalWeight : 0,
                  };
                })}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={70} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [`$${Number(v).toFixed(0)}/kg`, "Cost per Kg"]} />
                <Area
                  type="monotone"
                  dataKey="costPerKg"
                  stroke="hsl(160, 60%, 40%)"
                  fill="hsl(160, 60%, 40%)"
                  fillOpacity={0.6}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </div>
    </>
  );
}

// ─── Part details table ───────────────────────────────────────────────────────

function PartDetailsTable({ filteredBomMetrics }: { filteredBomMetrics: ResolvedBOMMetricEntry[] }) {
  const allParts = new Map<
    string,
    {
      name: string;
      partNumber?: string | undefined;
      material?: string | undefined;
      makeBuy?: string | undefined;
      bomData: (EnrichedBOMItem | null)[];
    }
  >();

  filteredBomMetrics.forEach((bd, bomIdx) => {
    bd.items.forEach((item) => {
      const key = item.partNumber ?? item.name ?? "";
      if (!allParts.has(key)) {
        allParts.set(key, {
          name: item.name ?? "",
          partNumber: item.partNumber,
          material: item.material,
          makeBuy: item.makeBuy,
          bomData: new Array(filteredBomMetrics.length).fill(null),
        });
      }
      allParts.get(key)!.bomData[bomIdx] = item;
    });
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-3 px-2 font-medium">Part Name</th>
            <th className="text-left py-3 px-2 font-medium">Part Number</th>
            <th className="text-center py-3 px-2 font-medium">Material</th>
            <th className="text-center py-3 px-2 font-medium">Make/Buy</th>
            {filteredBomMetrics.map((bd) => (
              <th key={bd.bom.id} className="text-center py-3 px-2 font-medium">
                {bd.bom.name} (Qty)
              </th>
            ))}
            <th className="text-center py-3 px-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {Array.from(allParts.values()).map((part, idx) => {
            const hasAnyCost = part.bomData.some((item) => item && safeNum(item.unitCost) > 0);
            return (
              <tr
                key={idx}
                className={`border-b hover:bg-muted/25 ${!hasAnyCost ? "bg-red-900/20" : ""}`}
              >
                <td className="py-3 px-2 font-medium">{part.name}</td>
                <td className="py-3 px-2 text-muted-foreground">{part.partNumber ?? "-"}</td>
                <td className="py-3 px-2 text-center">
                  {part.material ? (
                    <Badge variant="outline" className="text-xs">
                      {part.material}
                    </Badge>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="py-3 px-2 text-center">
                  {part.makeBuy ? (
                    <Badge
                      variant={part.makeBuy === "make" ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {part.makeBuy}
                    </Badge>
                  ) : (
                    "-"
                  )}
                </td>
                {part.bomData.map((item, bIdx) => (
                  <td key={bIdx} className="text-center py-3 px-2">
                    {item ? (
                      <div className="space-y-1">
                        <div className="text-sm font-medium">{item.quantity}</div>
                        {safeNum(item.unitCost) > 0 ? (
                          <div className="text-xs text-green-600">
                            {formatPrice(safeNum(item.unitCost))}
                          </div>
                        ) : (
                          <div className="text-xs text-red-500">Need cost</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </td>
                ))}
                <td className="py-3 px-2 text-center">
                  <Badge variant={hasAnyCost ? "default" : "destructive"} className="text-xs">
                    {hasAnyCost ? "Has Cost" : "Missing Cost"}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Materials content ────────────────────────────────────────────────────────

function MaterialsContent({ filteredBomMetrics }: { filteredBomMetrics: ResolvedBOMMetricEntry[] }) {
  const inferProcess = (item: EnrichedBOMItem): string => {
    if (item.makeBuy === "buy") return "Procurement";
    const mat = (item.material ?? "").toLowerCase();
    if (mat.includes("steel") || mat.includes("stainless")) return "Machining";
    if (mat.includes("aluminum") || mat.includes("alloy")) return "Machining";
    if (mat.includes("plastic") || mat.includes("polymer")) return "Injection Molding";
    if (mat.includes("rubber") || mat.includes("silicone")) return "Molding";
    if (mat.includes("composite") || mat.includes("fiber")) return "Composite Fabrication";
    if (mat.includes("cast") || mat.includes("iron")) return "Casting";
    return "Manufacturing Required";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Materials Analysis - Selected Parts</CardTitle>
        <CardDescription>Material distribution and process requirements</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {filteredBomMetrics.map((bd, bomIndex) => (
            <Card key={bd.bom.id} className="p-4 bg-primary/5 border-primary/20">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h4 className="text-lg font-semibold">{bd.bom.name}</h4>
                  <p className="text-sm text-muted-foreground">
                    Materials & Process Analysis · Level {bomIndex + 1}
                  </p>
                </div>
                <Badge variant="default" className="text-xs">
                  {bd.items.length} Parts
                </Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {/* Material distribution */}
                <Card className="p-3">
                  <h5 className="text-sm font-semibold mb-3">Material Distribution</h5>
                  <div className="space-y-2">
                    {(() => {
                      const matMap = new Map<string, number>();
                      bd.items.forEach((item) => {
                        const mat = item.material ?? item.materialGrade ?? "Unknown";
                        matMap.set(mat, (matMap.get(mat) ?? 0) + 1);
                      });
                      const sorted = Array.from(matMap.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 6);
                      return sorted.length > 0 ? (
                        sorted.map(([mat, count]) => (
                          <div key={mat} className="flex justify-between items-center">
                            <span className="text-sm truncate flex-1" title={mat}>
                              {mat}
                            </span>
                            <Badge variant="secondary" className="text-xs ml-2">
                              {count} part{count !== 1 ? "s" : ""}
                            </Badge>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-2">
                          No material data
                        </p>
                      );
                    })()}
                  </div>
                </Card>

                {/* Process requirements */}
                <Card className="p-3">
                  <h5 className="text-sm font-semibold mb-3">Process Requirements</h5>
                  <div className="space-y-2">
                    {(() => {
                      const procMap = new Map<string, number>();
                      bd.items.forEach((item) => {
                        const proc = inferProcess(item);
                        procMap.set(proc, (procMap.get(proc) ?? 0) + 1);
                      });
                      const sorted = Array.from(procMap.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 6);
                      return sorted.length > 0 ? (
                        sorted.map(([proc, count]) => (
                          <div key={proc} className="flex justify-between items-center">
                            <span className="text-sm flex-1 truncate">{proc}</span>
                            <Badge
                              variant={proc === "Procurement" ? "secondary" : "default"}
                              className="text-xs ml-2"
                            >
                              {count}
                            </Badge>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-2">
                          No process data
                        </p>
                      );
                    })()}
                  </div>
                </Card>
              </div>

              {/* Part-wise list */}
              {bd.items.length > 0 && (
                <Card className="p-3">
                  <h5 className="text-sm font-semibold mb-3">Part-wise Material Analysis</h5>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {bd.items.map((item, i) => (
                      <div
                        key={`${item.id}-${i}`}
                        className="border rounded-lg p-3 bg-muted/20"
                      >
                        <div className="flex justify-between items-start mb-1">
                          <div>
                            <p className="text-sm font-medium">{item.name}</p>
                            <p className="text-xs text-muted-foreground">
                              Qty: {item.quantity ?? 1} · ${itemCost(item).toFixed(0)}
                            </p>
                          </div>
                          <Badge
                            variant={item.makeBuy === "make" ? "default" : "secondary"}
                            className="text-xs"
                          >
                            {item.makeBuy ?? "TBD"}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Material: </span>
                            <span className="font-medium">
                              {item.material ?? item.materialGrade ?? "Not specified"}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Process: </span>
                            <Badge variant="outline" className="text-xs">
                              {inferProcess(item)}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Assembly content ─────────────────────────────────────────────────────────

function AssemblyContent({ filteredBomMetrics }: { filteredBomMetrics: ResolvedBOMMetricEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Assembly & Design - Selected Parts</CardTitle>
        <CardDescription>Assembly complexity and design characteristics</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {filteredBomMetrics.map((bd, bomIndex) => {
            const metrics = bd.metrics.complexityMetrics;
            const makeVsBuy = bd.metrics.makeVsBuy;
            const complexityScore =
              (metrics.assemblyParts ?? 0) * 3 +
              (metrics.subAssemblyParts ?? 0) * 2 +
              (metrics.childParts ?? 0) * 1;

            return (
              <Card key={bd.bom.id} className="p-4 bg-primary/5 border-primary/20">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h4 className="text-lg font-semibold">{bd.bom.name}</h4>
                    <p className="text-sm text-muted-foreground">
                      Assembly & Design Analysis · Level {bomIndex + 1}
                    </p>
                  </div>
                  <Badge variant="default" className="text-xs">
                    {bd.items.length} Total Parts
                  </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  {/* Part hierarchy */}
                  <Card className="p-3">
                    <h5 className="text-sm font-semibold mb-3">Part Hierarchy</h5>
                    <div className="space-y-2 text-sm">
                      {[
                        { label: "Assembly", value: metrics.assemblyParts ?? 0, variant: "default" as const },
                        { label: "Sub-Assembly", value: metrics.subAssemblyParts ?? 0, variant: "secondary" as const },
                        { label: "Child Parts", value: metrics.childParts ?? 0, variant: "outline" as const },
                      ].map(({ label, value, variant }) => (
                        <div key={label} className="flex justify-between">
                          <span>{label}</span>
                          <Badge variant={variant}>{value}</Badge>
                        </div>
                      ))}
                    </div>
                  </Card>

                  {/* Make vs buy */}
                  <Card className="p-3">
                    <h5 className="text-sm font-semibold mb-3">Manufacturing Strategy</h5>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Make Parts</span>
                        <Badge variant="default">{makeVsBuy?.make ?? 0}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>Buy Parts</span>
                        <Badge variant="outline">{makeVsBuy?.buy ?? 0}</Badge>
                      </div>
                      <div className="flex justify-between pt-2 border-t">
                        <span className="font-medium">Make Ratio</span>
                        <Badge variant="secondary">
                          {(
                            ((makeVsBuy?.make ?? 0) /
                              Math.max((makeVsBuy?.make ?? 0) + (makeVsBuy?.buy ?? 0), 1)) *
                            100
                          ).toFixed(1)}
                          %
                        </Badge>
                      </div>
                    </div>
                  </Card>

                  {/* Complexity score */}
                  <Card className="p-3">
                    <h5 className="text-sm font-semibold mb-3">Design Complexity</h5>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between pt-2 border-t">
                        <span className="font-medium">Complexity Score</span>
                        <Badge
                          variant={
                            complexityScore > 50
                              ? "destructive"
                              : complexityScore > 20
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {complexityScore}
                        </Badge>
                      </div>
                    </div>
                  </Card>
                </div>

                {/* Part list */}
                {bd.items.length > 0 && (
                  <Card className="p-3">
                    <h5 className="text-sm font-semibold mb-3">Part-wise Analysis</h5>
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {bd.items.map((item, i) => (
                        <div
                          key={`${item.id}-${i}`}
                          className="border rounded-lg p-3 bg-muted/20"
                        >
                          <div className="flex justify-between items-start mb-1">
                            <div>
                              <p className="text-sm font-medium">{item.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {item.material ?? "No material"} · Qty: {item.quantity ?? 1}
                              </p>
                            </div>
                            <div className="flex gap-1">
                              <Badge variant="outline" className="text-xs">
                                ${itemCost(item).toFixed(0)}
                              </Badge>
                              <Badge
                                variant={item.makeBuy === "make" ? "default" : "secondary"}
                                className="text-xs"
                              >
                                {item.makeBuy ?? "TBD"}
                              </Badge>
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground capitalize">
                            Type: {item.itemType?.replace("_", " ") ?? "Standard"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </Card>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── VAVE content ─────────────────────────────────────────────────────────────

function VAVEContent({ filteredBomMetrics }: { filteredBomMetrics: ResolvedBOMMetricEntry[] }) {
  const opportunities: React.ReactNode[] = [];

  // High cost parts
  const highCostParts: HighCostPart[] = [];
  filteredBomMetrics.forEach((bd) =>
    bd.items.forEach((item) => {
      const total = itemCost(item);
      if (total > 500) highCostParts.push({ ...item, totalCost: total, bomName: bd.bom.name });
    })
  );

  if (highCostParts.length > 0) {
    opportunities.push(
      <Card key="high-cost" className="p-4 bg-red-900/20 border-red-600">
        <h4 className="text-sm font-semibold mb-2 text-red-100">High Cost Parts Review</h4>
        <p className="text-xs text-red-200 mb-3">
          {highCostParts.length} parts with cost &gt; $500
        </p>
        <div className="space-y-2">
          {highCostParts.slice(0, 3).map((part, idx) => (
            <div key={idx} className="flex justify-between text-xs">
              <span>{part.name}</span>
              <span className="font-medium">{formatPrice(part.totalCost)}</span>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  const materialCount = new Set(
    filteredBomMetrics.flatMap((bd) => bd.items.map((i) => i.material).filter(Boolean))
  ).size;

  if (materialCount > 3) {
    opportunities.push(
      <Card key="materials" className="p-4 bg-blue-50 border-blue-200">
        <h4 className="text-sm font-semibold mb-2 text-blue-800">Material Standardization</h4>
        <p className="text-xs text-blue-700 mb-3">{materialCount} different materials used</p>
        <div className="text-xs text-blue-600">
          Consider standardizing on fewer material types for volume benefits
        </div>
      </Card>
    );
  }

  let makeCount = 0;
  let buyCount = 0;
  filteredBomMetrics.forEach((bd) =>
    bd.items.forEach((item) => {
      if (item.makeBuy === "make") makeCount++;
      else if (item.makeBuy === "buy") buyCount++;
    })
  );

  if (makeCount > buyCount * 2) {
    opportunities.push(
      <Card key="makebuy" className="p-4 bg-yellow-50 border-yellow-200">
        <h4 className="text-sm font-semibold mb-2 text-yellow-800">Make vs Buy Review</h4>
        <p className="text-xs text-yellow-700 mb-3">
          {makeCount} make parts vs {buyCount} buy parts
        </p>
        <div className="text-xs text-yellow-600">
          Consider outsourcing some make parts for cost optimization
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>VAVE Opportunities - Selected Parts</CardTitle>
        <CardDescription>Value analysis and value engineering opportunities</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {opportunities.length > 0 ? (
            opportunities
          ) : (
            <Card className="p-8 text-center col-span-2">
              <div className="text-muted-foreground">
                <Zap className="mx-auto h-8 w-8 mb-2" />
                <p className="text-sm">Selected parts are well optimized</p>
                <p className="text-xs">No major VAVE opportunities identified</p>
              </div>
            </Card>
          )}
        </div>
      </CardContent>
    </Card>
  );
}