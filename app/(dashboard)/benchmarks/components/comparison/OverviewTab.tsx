"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { BOMMetricEntry } from "../../types";
import { itemCost, itemWeight, safeNum, formatPrice } from "../../utils";

interface Props {
  bomMetrics: BOMMetricEntry[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processes: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vendors: any[];
}

export function OverviewTab({ bomMetrics, processes, vendors }: Props) {
  return (
    <div className="space-y-6 mt-4">
      {/* Cost benchmarking */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Benchmarking</CardTitle>
          <CardDescription>Comprehensive cost analysis across all selected BOMs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">Metric</th>
                  {bomMetrics.map((bd) => (
                    <th key={bd.bom.id} className="text-center py-3 px-2 font-medium min-w-[120px]">
                      {bd.bom.name}
                    </th>
                  ))}
                  <th className="text-center py-3 px-2 font-medium">Difference</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    {
                      label: "Total BOM Cost",
                      getValue: (bd: BOMMetricEntry) => bd.metrics.totalCost,
                      threshold: 1000,
                    },
                    {
                      label: "Manufacturing Cost",
                      getValue: (bd: BOMMetricEntry) =>
                        (bd.items ?? [])
                          .filter((i) => i.makeBuy === "make")
                          .reduce((s, i) => s + itemCost(i), 0),
                      threshold: 500,
                    },
                    {
                      label: "Purchased Parts Cost",
                      getValue: (bd: BOMMetricEntry) =>
                        (bd.items ?? [])
                          .filter((i) => i.makeBuy === "buy")
                          .reduce((s, i) => s + itemCost(i), 0),
                      threshold: 500,
                    },
                  ] as const
                ).map(({ label, getValue, threshold }) => {
                  const values = bomMetrics.map(getValue);
                  const max = Math.max(...values);
                  const validMin = values.filter((v) => v > 0);
                  const min = validMin.length > 0 ? Math.min(...validMin) : 0;
                  const diff = max - min;
                  return (
                    <tr key={label} className="border-b hover:bg-muted/25">
                      <td className="py-3 px-2 font-medium">{label}</td>
                      {bomMetrics.map((bd) => (
                        <td key={bd.bom.id} className="text-center py-3 px-2">
                          {formatPrice(getValue(bd))}
                        </td>
                      ))}
                      <td className="text-center py-3 px-2">
                        <Badge variant={diff > threshold ? "destructive" : "secondary"}>
                          {formatPrice(diff)}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Weight benchmarking */}
      <Card>
        <CardHeader>
          <CardTitle>Weight Benchmarking</CardTitle>
          <CardDescription>Weight analysis across BOMs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">Metric</th>
                  {bomMetrics.map((bd) => (
                    <th key={bd.bom.id} className="text-center py-3 px-2 font-medium min-w-[120px]">
                      {bd.bom.name}
                    </th>
                  ))}
                  <th className="text-center py-3 px-2 font-medium">Difference</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b hover:bg-muted/25">
                  <td className="py-3 px-2 font-medium">Total Product Weight (kg)</td>
                  {bomMetrics.map((bd) => (
                    <td key={bd.bom.id} className="text-center py-3 px-2 font-mono">
                      {bd.metrics.totalWeight.toFixed(2)}
                    </td>
                  ))}
                  <td className="text-center py-3 px-2">
                    {bomMetrics.length > 1 && (() => {
                      const ws = bomMetrics.map((b) => b.metrics.totalWeight);
                      const diff = Math.max(...ws) - Math.min(...ws);
                      return (
                        <Badge variant={diff > 5 ? "destructive" : "secondary"}>
                          {diff.toFixed(2)} kg
                        </Badge>
                      );
                    })()}
                  </td>
                </tr>
                <tr className="border-b hover:bg-muted/25">
                  <td className="py-3 px-2 font-medium">Structural Weight (kg)</td>
                  {bomMetrics.map((bd) => (
                    <td key={bd.bom.id} className="text-center py-3 px-2 font-mono">
                      {(bd.items ?? [])
                        .filter((item) => {
                          const mat = item.material?.toLowerCase() ?? "";
                          return (
                            mat.includes("steel") ||
                            mat.includes("aluminum") ||
                            mat.includes("iron")
                          );
                        })
                        .reduce((s, i) => s + itemWeight(i), 0)
                        .toFixed(2)}
                    </td>
                  ))}
                  <td className="text-center py-3 px-2">
                    <Badge variant="outline">Structural</Badge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Manufacturing Process Comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Manufacturing Process Comparison</CardTitle>
          <CardDescription>Process usage across BOMs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">Process Type</th>
                  {bomMetrics.map((bd) => (
                    <th key={bd.bom.id} className="text-center py-3 px-2 font-medium min-w-[120px]">
                      {bd.bom.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const processCategories = [
                    ...new Set(processes.map((p) => p.processCategory)),
                  ];
                  const defaults = [
                    "CNC Machining",
                    "Sheet Metal",
                    "Casting",
                    "Injection Molding",
                    "3D Printing",
                  ];
                  const display =
                    processCategories.length > 0
                      ? processCategories.slice(0, 5)
                      : defaults;

                  return display.map((procName) => (
                    <tr key={procName} className="border-b hover:bg-muted/25">
                      <td className="py-3 px-2 font-medium">{procName}</td>
                      {bomMetrics.map((bd) => {
                        const keywords = procName.toLowerCase().split(" ");
                        const count = (bd.items ?? []).filter((item) => {
                          if (
                            item.manufacturingProcess &&
                            keywords.some((kw: string) =>
                              item.manufacturingProcess!.toLowerCase().includes(kw)
                            )
                          )
                            return true;
                          const mat = item.material?.toLowerCase() ?? "";
                          const lp = procName.toLowerCase();
                          if (lp.includes("machining") || lp.includes("cnc"))
                            return (
                              (mat.includes("steel") ||
                                mat.includes("aluminum") ||
                                mat.includes("titanium")) &&
                              item.makeBuy === "make"
                            );
                          if (lp.includes("sheet"))
                            return mat.includes("sheet") || (mat.includes("steel") && item.name?.toLowerCase().includes("sheet"));
                          if (lp.includes("casting"))
                            return mat.includes("cast") || mat.includes("iron");
                          if (lp.includes("injection"))
                            return (
                              (mat.includes("plastic") || mat.includes("polymer")) &&
                              item.makeBuy === "make"
                            );
                          if (lp.includes("printing"))
                            return (
                              mat.includes("pla") ||
                              mat.includes("abs") ||
                              mat.includes("nylon")
                            );
                          return false;
                        }).length;
                        return (
                          <td key={bd.bom.id} className="text-center py-3 px-2">
                            {count}
                          </td>
                        );
                      })}
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Assembly + Design complexity side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Assembly Complexity</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">Metric</th>
                  {bomMetrics.map((bd) => (
                    <th key={bd.bom.id} className="text-center py-3 px-2 font-medium">
                      {bd.bom.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b hover:bg-muted/25">
                  <td className="py-3 px-2 font-medium">Assembly Steps (est.)</td>
                  {bomMetrics.map((bd) => (
                    <td key={bd.bom.id} className="text-center py-3 px-2">
                      {bd.metrics.complexityMetrics.assemblyParts * 2 +
                        bd.metrics.complexityMetrics.subAssemblyParts}
                    </td>
                  ))}
                </tr>
                <tr className="border-b hover:bg-muted/25">
                  <td className="py-3 px-2 font-medium">Fastener Count</td>
                  {bomMetrics.map((bd) => (
                    <td key={bd.bom.id} className="text-center py-3 px-2">
                      {(bd.items ?? [])
                        .filter((item) => {
                          const n = item.name?.toLowerCase() ?? "";
                          return (
                            n.includes("screw") ||
                            n.includes("bolt") ||
                            n.includes("washer") ||
                            n.includes("nut") ||
                            n.includes("rivet")
                          );
                        })
                        .reduce((s, i) => s + safeNum(i.quantity), 0)}
                    </td>
                  ))}
                </tr>
                <tr className="border-b hover:bg-muted/25">
                  <td className="py-3 px-2 font-medium">Assembly Time (est. hrs)</td>
                  {bomMetrics.map((bd) => (
                    <td key={bd.bom.id} className="text-center py-3 px-2">
                      {(
                        bd.metrics.complexityMetrics.assemblyParts * 2 +
                        bd.metrics.complexityMetrics.subAssemblyParts * 1.5 +
                        bd.metrics.complexityMetrics.childParts * 0.5
                      ).toFixed(1)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Design Complexity</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">Metric</th>
                  {bomMetrics.map((bd) => (
                    <th key={bd.bom.id} className="text-center py-3 px-2 font-medium">
                      {bd.bom.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    {
                      label: "Machined Parts",
                      count: (bd: BOMMetricEntry) =>
                        (bd.items ?? []).filter((item) => {
                          if (
                            item.manufacturingProcess?.toLowerCase().includes("machining") ||
                            item.manufacturingProcess?.toLowerCase().includes("cnc")
                          )
                            return true;
                          if (item.makeBuy === "make") {
                            const mat = item.material?.toLowerCase() ?? "";
                            return (
                              mat.includes("steel") ||
                              mat.includes("aluminum") ||
                              mat.includes("titanium") ||
                              mat.includes("brass")
                            );
                          }
                          return false;
                        }).length,
                    },
                    {
                      label: "Tolerance Critical Parts",
                      count: (bd: BOMMetricEntry) =>
                        (bd.items ?? []).filter((item) => {
                          if (item.toleranceGrade || item.surfaceFinish) return true;
                          const n = item.name?.toLowerCase() ?? "";
                          return (
                            n.includes("bearing") ||
                            n.includes("shaft") ||
                            n.includes("pin") ||
                            n.includes("housing") ||
                            n.includes("fitting")
                          );
                        }).length,
                    },
                    {
                      label: "Complex Geometry Parts",
                      count: (bd: BOMMetricEntry) =>
                        (bd.items ?? []).filter((item) => {
                          if (
                            item.manufacturingProcess?.toLowerCase().includes("5-axis") ||
                            item.manufacturingProcess?.toLowerCase().includes("multi-axis")
                          )
                            return true;
                          if (item.heatTreatment && item.makeBuy === "make") return true;
                          const n = item.name?.toLowerCase() ?? "";
                          return n.includes("impeller") || n.includes("turbine") || n.includes("contour");
                        }).length,
                    },
                  ] as const
                ).map(({ label, count }) => (
                  <tr key={label} className="border-b hover:bg-muted/25">
                    <td className="py-3 px-2 font-medium">{label}</td>
                    {bomMetrics.map((bd) => (
                      <td key={bd.bom.id} className="text-center py-3 px-2">
                        {count(bd)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Performance per cost */}
      <Card>
        <CardHeader>
          <CardTitle>Performance per Cost Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-2 font-medium">Metric</th>
                {bomMetrics.map((bd) => (
                  <th key={bd.bom.id} className="text-center py-3 px-2 font-medium min-w-[120px]">
                    {bd.bom.name}
                  </th>
                ))}
                <th className="text-center py-3 px-2 font-medium">Best Value</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  {
                    label: "Cost per kg",
                    getVal: (bd: BOMMetricEntry): number | null =>
                      bd.metrics.totalWeight > 0
                        ? bd.metrics.totalCost / bd.metrics.totalWeight
                        : null,
                  },
                  {
                    label: "Cost per Part",
                    getVal: (bd: BOMMetricEntry): number | null =>
                      bd.metrics.totalParts > 0
                        ? bd.metrics.totalCost / bd.metrics.totalParts
                        : null,
                  },
                ] as const
              ).map(({ label, getVal }) => {
                const values = bomMetrics.map(getVal);
                const valid = values.filter((v): v is number => v !== null && v > 0);
                const minVal = valid.length > 0 ? Math.min(...valid) : null;
                const bestIdx = minVal !== null ? values.indexOf(minVal) : -1;

                return (
                  <tr key={label} className="border-b hover:bg-muted/25">
                    <td className="py-3 px-2 font-medium">{label}</td>
                    {bomMetrics.map((bd) => (
                      <td key={bd.bom.id} className="text-center py-3 px-2">
                        {getVal(bd) !== null ? formatPrice(getVal(bd)!) : "N/A"}
                      </td>
                    ))}
                    <td className="text-center py-3 px-2">
                      {bestIdx >= 0 ? (
                        <Badge variant="default">{bomMetrics[bestIdx]?.bom.name}</Badge>
                      ) : (
                        "N/A"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Part count + Supplier strategy */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Part Count Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">BOM Name</th>
                  <th className="text-right py-2">Assembly</th>
                  <th className="text-right py-2">Sub-Assy</th>
                  <th className="text-right py-2">Child</th>
                  <th className="text-right py-2">Make</th>
                  <th className="text-right py-2">Buy</th>
                  <th className="text-right py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {bomMetrics.map((bd) => (
                  <tr key={bd.bom.id} className="border-b">
                    <td className="py-2 font-medium">{bd.bom.name}</td>
                    <td className="text-right py-2">{bd.metrics.complexityMetrics.assemblyParts}</td>
                    <td className="text-right py-2">{bd.metrics.complexityMetrics.subAssemblyParts}</td>
                    <td className="text-right py-2">{bd.metrics.complexityMetrics.childParts}</td>
                    <td className="text-right py-2">{bd.metrics.makeVsBuy.make}</td>
                    <td className="text-right py-2">{bd.metrics.makeVsBuy.buy}</td>
                    <td className="text-right py-2 font-semibold">{bd.metrics.totalParts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Supplier Strategy</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">BOM Name</th>
                  <th className="text-right py-2">In-house</th>
                  <th className="text-right py-2">Outsourced</th>
                  <th className="text-right py-2">Suppliers</th>
                  <th className="text-right py-2">Make %</th>
                </tr>
              </thead>
              <tbody>
                {bomMetrics.map((bd) => {
                  const total = bd.metrics.makeVsBuy.make + bd.metrics.makeVsBuy.buy || 1;
                  const makePct = ((bd.metrics.makeVsBuy.make / total) * 100).toFixed(1);
                  const supplierIds = new Set(
                    (bd.items ?? []).map((item) => item.supplierId ?? item.vendor).filter(Boolean)
                  );
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const matchedVendors = vendors.filter((v: any) => {
                    const vid = v.id as string | undefined;
                    return vid && supplierIds.has(vid);
                  });
                  const supplierCount = Math.max(supplierIds.size, matchedVendors.length);
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const vendorNames = matchedVendors.slice(0, 2).map((v: any) => v.name ?? v.vendorName ?? "Unknown");

                  return (
                    <tr key={bd.bom.id} className="border-b">
                      <td className="py-2 font-medium">{bd.bom.name}</td>
                      <td className="text-right py-2">{bd.metrics.makeVsBuy.make}</td>
                      <td className="text-right py-2">{bd.metrics.makeVsBuy.buy}</td>
                      <td className="text-right py-2">
                        {supplierCount}
                        {vendorNames.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {vendorNames.join(", ")}
                            {matchedVendors.length > 2 && ` +${matchedVendors.length - 2} more`}
                          </div>
                        )}
                      </td>
                      <td className="text-right py-2">{makePct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}