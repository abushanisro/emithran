"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from "recharts";
import type { BOMMetricEntry } from "../../types";
import { safeNum } from "../../utils";

interface Props {
  bomMetrics: BOMMetricEntry[];
}

export function ComplexityTab({ bomMetrics }: Props) {
  // Assembly complexity analysis
  const assemblyData = bomMetrics.map((bd) => {
    const fastenerCount = (bd.items ?? []).filter((item) => {
      const n = item.name?.toLowerCase() ?? "";
      return (
        n.includes("screw") ||
        n.includes("bolt") ||
        n.includes("washer") ||
        n.includes("nut") ||
        n.includes("rivet")
      );
    }).reduce((s, i) => s + safeNum(i.quantity), 0);

    const assemblySteps = bd.metrics.complexityMetrics.assemblyParts * 2 + 
                         bd.metrics.complexityMetrics.subAssemblyParts;

    const assemblyTime = (
      bd.metrics.complexityMetrics.assemblyParts * 2 +
      bd.metrics.complexityMetrics.subAssemblyParts * 1.5 +
      bd.metrics.complexityMetrics.childParts * 0.5
    );

    return {
      name: bd.bom.name,
      assemblyParts: bd.metrics.complexityMetrics.assemblyParts,
      subAssemblyParts: bd.metrics.complexityMetrics.subAssemblyParts,
      childParts: bd.metrics.complexityMetrics.childParts,
      fastenerCount,
      assemblySteps,
      assemblyTime,
    };
  });

  // Design complexity analysis
  const designData = bomMetrics.map((bd) => {
    const machinedParts = (bd.items ?? []).filter((item) => {
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
    }).length;

    const toleranceCritical = (bd.items ?? []).filter((item) => {
      if (item.toleranceGrade || item.surfaceFinish) return true;
      const n = item.name?.toLowerCase() ?? "";
      return (
        n.includes("bearing") ||
        n.includes("shaft") ||
        n.includes("pin") ||
        n.includes("housing") ||
        n.includes("fitting")
      );
    }).length;

    const complexGeometry = (bd.items ?? []).filter((item) => {
      if (
        item.manufacturingProcess?.toLowerCase().includes("5-axis") ||
        item.manufacturingProcess?.toLowerCase().includes("multi-axis")
      )
        return true;
      if (item.heatTreatment && item.makeBuy === "make") return true;
      const n = item.name?.toLowerCase() ?? "";
      return n.includes("impeller") || n.includes("turbine") || n.includes("contour");
    }).length;

    const customParts = (bd.items ?? []).filter((item) => 
      item.makeBuy === "make"
    ).length;

    return {
      name: bd.bom.name,
      machinedParts,
      toleranceCritical,
      complexGeometry,
      customParts,
      totalParts: bd.metrics.totalParts,
    };
  });

  // Radar chart data for complexity comparison
  const radarData = bomMetrics.map((bd) => {
    const assemblyComplexity = Math.min(100, (bd.metrics.complexityMetrics.assemblyParts / 20) * 100);
    const partComplexity = Math.min(100, (bd.metrics.totalParts / 100) * 100);
    const makeComplexity = Math.min(100, (bd.metrics.makeVsBuy.make / bd.metrics.totalParts) * 100);
    const materialComplexity = Math.min(100, (new Set((bd.items ?? []).map(i => i.material)).size / 10) * 100);
    const costComplexity = Math.min(100, (bd.metrics.totalCost / 10000) * 100);

    return {
      bom: bd.bom.name,
      Assembly: assemblyComplexity,
      Parts: partComplexity,
      Manufacturing: makeComplexity,
      Materials: materialComplexity,
      Cost: costComplexity,
    };
  });

  // Manufacturing process complexity
  const processComplexity = bomMetrics.map((bd) => {
    const processes = new Set<string>();
    (bd.items ?? []).forEach((item) => {
      if (item.manufacturingProcess) {
        processes.add(item.manufacturingProcess);
      } else if (item.material && item.makeBuy === "make") {
        // Infer process from material
        const mat = item.material.toLowerCase();
        if (mat.includes("steel") || mat.includes("aluminum")) processes.add("CNC Machining");
        if (mat.includes("plastic")) processes.add("Injection Molding");
        if (mat.includes("sheet")) processes.add("Sheet Metal");
        if (mat.includes("cast")) processes.add("Casting");
      }
    });

    const heatTreatmentParts = (bd.items ?? []).filter(item => item.heatTreatment).length;
    const surfaceFinishParts = (bd.items ?? []).filter(item => item.surfaceFinish).length;

    return {
      name: bd.bom.name,
      processCount: processes.size,
      heatTreatmentParts,
      surfaceFinishParts,
      uniqueProcesses: Array.from(processes).slice(0, 3).join(", "),
    };
  });

  return (
    <div className="space-y-6 mt-4">
      {/* Assembly Complexity Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Assembly Complexity Analysis</CardTitle>
          <CardDescription>Assembly structure and estimated effort across BOMs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={assemblyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="assemblyParts" stackId="a" fill="#3b82f6" name="Assembly Parts" />
                <Bar dataKey="subAssemblyParts" stackId="a" fill="#8b5cf6" name="Sub-Assembly Parts" />
                <Bar dataKey="childParts" stackId="a" fill="#06b6d4" name="Child Parts" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Design Complexity Radar */}
      <Card>
        <CardHeader>
          <CardTitle>Multi-Dimensional Complexity Comparison</CardTitle>
          <CardDescription>Radar view of complexity across different dimensions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-96 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="bom" />
                <PolarRadiusAxis angle={90} domain={[0, 100]} />
                {bomMetrics.map((bd, idx) => (
                  <Radar
                    key={bd.bom.id}
                    name={bd.bom.name}
                    dataKey={bd.bom.name}
                    stroke={`hsl(${idx * 137.508}deg, 70%, 50%)`}
                    fill={`hsl(${idx * 137.508}deg, 70%, 50%)`}
                    fillOpacity={0.1}
                    strokeWidth={2}
                  />
                ))}
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Assembly Metrics Table */}
      <Card>
        <CardHeader>
          <CardTitle>Assembly Metrics Comparison</CardTitle>
          <CardDescription>Detailed assembly complexity breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">BOM Name</th>
                  <th className="text-center py-3 px-2 font-medium">Assembly Steps</th>
                  <th className="text-center py-3 px-2 font-medium">Fasteners</th>
                  <th className="text-center py-3 px-2 font-medium">Est. Time (hrs)</th>
                  <th className="text-center py-3 px-2 font-medium">Complexity Score</th>
                </tr>
              </thead>
              <tbody>
                {assemblyData.map((data) => {
                  const complexityScore = data.assemblyParts * 3 + data.subAssemblyParts * 2 + data.childParts;
                  const maxScore = Math.max(...assemblyData.map(d => d.assemblyParts * 3 + d.subAssemblyParts * 2 + d.childParts));
                  const scorePercentage = maxScore > 0 ? (complexityScore / maxScore) * 100 : 0;
                  
                  return (
                    <tr key={data.name} className="border-b hover:bg-muted/25">
                      <td className="py-3 px-2 font-medium">{data.name}</td>
                      <td className="text-center py-3 px-2">{data.assemblySteps}</td>
                      <td className="text-center py-3 px-2">{data.fastenerCount}</td>
                      <td className="text-center py-3 px-2">{data.assemblyTime.toFixed(1)}</td>
                      <td className="text-center py-3 px-2">
                        <div className="flex items-center gap-2">
                          <Progress value={scorePercentage} className="flex-1 max-w-20" />
                          <Badge variant={scorePercentage > 75 ? "destructive" : scorePercentage > 50 ? "secondary" : "default"}>
                            {complexityScore}
                          </Badge>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Design Complexity and Manufacturing Process side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Design Complexity</CardTitle>
            <CardDescription>Manufacturing and tolerance requirements</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {designData.map((data) => (
                <div key={data.name} className="border rounded-lg p-4">
                  <h4 className="font-medium mb-3">{data.name}</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Machined Parts</div>
                      <div className="text-lg font-semibold text-orange-600">{data.machinedParts}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Tolerance Critical</div>
                      <div className="text-lg font-semibold text-red-600">{data.toleranceCritical}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Complex Geometry</div>
                      <div className="text-lg font-semibold text-purple-600">{data.complexGeometry}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Custom Parts</div>
                      <div className="text-lg font-semibold text-blue-600">{data.customParts}</div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between items-center text-xs">
                      <span>Design Complexity</span>
                      <span>{((data.machinedParts + data.toleranceCritical + data.complexGeometry) / data.totalParts * 100).toFixed(1)}%</span>
                    </div>
                    <Progress 
                      value={(data.machinedParts + data.toleranceCritical + data.complexGeometry) / data.totalParts * 100} 
                      className="mt-1" 
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Manufacturing Process Complexity</CardTitle>
            <CardDescription>Process diversity and special requirements</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {processComplexity.map((data) => (
                <div key={data.name} className="border rounded-lg p-4">
                  <h4 className="font-medium mb-3">{data.name}</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Unique Processes</span>
                      <Badge variant="outline">{data.processCount}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {data.uniqueProcesses || "Standard processes"}
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-muted-foreground">Heat Treatment</div>
                        <div className="font-semibold">{data.heatTreatmentParts} parts</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Surface Finish</div>
                        <div className="font-semibold">{data.surfaceFinishParts} parts</div>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between items-center text-xs">
                        <span>Process Complexity</span>
                        <span>{Math.min(100, data.processCount * 20).toFixed(0)}%</span>
                      </div>
                      <Progress value={Math.min(100, data.processCount * 20)} className="mt-1" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Complexity Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Complexity Impact Analysis</CardTitle>
          <CardDescription>Understanding complexity drivers across BOMs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bomMetrics.map((bd) => {
              const assemblyComplexity = bd.metrics.complexityMetrics.assemblyParts * 3 + 
                                        bd.metrics.complexityMetrics.subAssemblyParts * 2 + 
                                        bd.metrics.complexityMetrics.childParts;
              const makeRatio = bd.metrics.totalParts > 0 ? bd.metrics.makeVsBuy.make / bd.metrics.totalParts : 0;
              const costPerPart = bd.metrics.totalParts > 0 ? bd.metrics.totalCost / bd.metrics.totalParts : 0;
              
              return (
                <Card key={bd.bom.id} className="p-4">
                  <h4 className="font-medium mb-3">{bd.bom.name}</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Assembly Score:</span>
                      <Badge variant={assemblyComplexity > 100 ? "destructive" : "secondary"}>
                        {assemblyComplexity}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Make Ratio:</span>
                      <span className="font-medium">{(makeRatio * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cost per Part:</span>
                      <span className="font-medium">${costPerPart.toFixed(2)}</span>
                    </div>
                    <div className="pt-2">
                      <div className="text-xs text-muted-foreground mb-1">Overall Complexity</div>
                      <Progress 
                        value={Math.min(100, (assemblyComplexity + makeRatio * 50) / 1.5)} 
                        className="h-2" 
                      />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}