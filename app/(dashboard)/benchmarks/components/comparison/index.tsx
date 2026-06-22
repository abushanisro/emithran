"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Download } from "lucide-react";
import type { BOMMetricEntry, SelectedBOM, SelectedProject } from "../../types";
import { formatPrice } from "../../utils";
import { OverviewTab } from "./OverviewTab";
import { PartsTab } from "./PartsTab";
import { MaterialsTab } from "./MaterialsTab";
import { ComplexityTab } from "./ComplexityTab";
import { VAVETab } from "./VAVETab";
import { SelectedPartsAnalysis } from "../SelectedPartsAnalysis";

interface Props {
  bomMetrics: BOMMetricEntry[];
  selectedBOMs: SelectedBOM[];
  selectedProject: SelectedProject | null;
  multiProjectMode: boolean;
  selectedProjects: SelectedProject[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processes: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vendors: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawMaterials: any[];
  onBack: () => void;
}

export function ComparisonView({
  bomMetrics,
  selectedBOMs,
  selectedProject,
  multiProjectMode,
  selectedProjects,
  processes,
  vendors,
  rawMaterials,
  onBack,
}: Props) {
  const [activeTab, setActiveTab] = useState("parts");
  const [selectedParts, setSelectedParts] = useState<Set<string>>(new Set());
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [showPartAnalysis, setShowPartAnalysis] = useState(false);

  const handlePartToggle = (key: string) => {
    setSelectedParts((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleSelectAll = () => {
    const keys = new Set<string>();
    bomMetrics.forEach(({ items }) =>
      items?.forEach((item) => keys.add(item.partNumber ?? item.name ?? `item-${item.id}`))
    );
    setSelectedParts(keys);
  };

  const handleClearAll = () => {
    setSelectedParts(new Set());
    setShowSelectedOnly(false);
  };

  // Show selected parts analysis
  if (showPartAnalysis && selectedParts.size > 0) {
    return (
      <SelectedPartsAnalysis
        bomMetrics={bomMetrics}
        selectedParts={selectedParts}
        onBack={() => setShowPartAnalysis(false)}
      />
    );
  }

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
              Multi-BOM Comparison ({selectedBOMs.length} BOMs)
            </h1>
            <p className="text-xs text-muted-foreground">
              {multiProjectMode
                ? `Multi-Project: ${selectedProjects.map((p) => p.name).join(", ")}`
                : `Project: ${selectedProject?.name}`}{" "}
              · {selectedBOMs.map((b) => b.name).join(", ")}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm">
          <Download className="h-3.5 w-3.5 mr-2" />
          Export
        </Button>
      </div>

      {/* Overview table */}
      <Card>
        <CardHeader>
          <CardTitle>BOM Comparison Overview</CardTitle>
          <CardDescription>Key metrics across all selected BOMs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">BOM Name</th>
                  <th className="text-right py-3 px-2 font-medium">Total Parts</th>
                  <th className="text-right py-3 px-2 font-medium">Weight (kg)</th>
                  <th className="text-right py-3 px-2 font-medium">Total Cost</th>
                  <th className="text-right py-3 px-2 font-medium">Make</th>
                  <th className="text-right py-3 px-2 font-medium">Buy</th>
                  <th className="text-right py-3 px-2 font-medium">Complexity</th>
                </tr>
              </thead>
              <tbody>
                {bomMetrics.map((bd) => (
                  <tr key={bd.bom.id} className="border-b hover:bg-muted/50">
                    <td className="py-3 px-2">
                      <p className="font-medium">{bd.bom.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {bd.bom.version} · {bd.bom.status}
                      </p>
                    </td>
                    <td className="text-right py-3 px-2 font-mono">{bd.metrics.totalParts}</td>
                    <td className="text-right py-3 px-2 font-mono">
                      {bd.metrics.totalWeight.toFixed(1)}
                    </td>
                    <td className="text-right py-3 px-2">{formatPrice(bd.metrics.totalCost)}</td>
                    <td className="text-right py-3 px-2 font-mono">{bd.metrics.makeVsBuy.make}</td>
                    <td className="text-right py-3 px-2 font-mono">{bd.metrics.makeVsBuy.buy}</td>
                    <td className="text-right py-3 px-2 font-mono">
                      {bd.metrics.complexityMetrics.assemblyParts * 3 +
                        bd.metrics.complexityMetrics.subAssemblyParts * 2 +
                        bd.metrics.complexityMetrics.childParts}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="parts">Parts Comparison</TabsTrigger>
          <TabsTrigger value="overview">Cost & Weight</TabsTrigger>
          <TabsTrigger value="materials">Materials & Processes</TabsTrigger>
          <TabsTrigger value="complexity">Assembly & Design</TabsTrigger>
          <TabsTrigger value="vave">VAVE</TabsTrigger>
        </TabsList>

        <TabsContent value="parts">
          <PartsTab
            bomMetrics={bomMetrics}
            selectedParts={selectedParts}
            showSelectedOnly={showSelectedOnly}
            onPartToggle={handlePartToggle}
            onSelectAll={handleSelectAll}
            onClearAll={handleClearAll}
            onShowSelectedOnly={setShowSelectedOnly}
            onAnalyzeSelected={() => setShowPartAnalysis(true)}
          />
        </TabsContent>

        <TabsContent value="overview">
          <OverviewTab bomMetrics={bomMetrics} processes={processes} vendors={vendors} />
        </TabsContent>

        <TabsContent value="materials">
          <MaterialsTab bomMetrics={bomMetrics} rawMaterials={rawMaterials} />
        </TabsContent>

        <TabsContent value="complexity">
          <ComplexityTab bomMetrics={bomMetrics} />
        </TabsContent>

        <TabsContent value="vave">
          <VAVETab bomMetrics={bomMetrics} />
        </TabsContent>
      </Tabs>
    </div>
  );
}