"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/PageHeader";
import { ArrowLeft, ArrowRight, Package } from "lucide-react";
import type { SelectedBOM, SelectedProject } from "../types";
import { formatDate } from "../utils";

interface MultiProjectBOM {
  projectId: string;
  projectName: string;
  boms: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface Props {
  selectedProject: SelectedProject | null;
  multiProjectMode: boolean;
  selectedProjects: SelectedProject[];
  selectedBOMs: SelectedBOM[];
  // Single-project boms
  boms: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  // Multi-project boms
  multiProjectBoms: MultiProjectBOM[];
  // Item counts per selected BOM index
  bomItemCounts: number[];
  onBack: () => void;
  onBomToggle: (bom: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  onCompare: () => void;
}

export function BOMSelection({
  selectedProject,
  multiProjectMode,
  selectedProjects,
  selectedBOMs,
  boms,
  multiProjectBoms,
  bomItemCounts,
  onBack,
  onBomToggle,
  onCompare,
}: Props) {
  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <PageHeader
          title={
            multiProjectMode
              ? `BOMs Across ${selectedProjects.length} Projects`
              : `BOMs in ${selectedProject?.name}`
          }
          description={
            multiProjectMode
              ? "Select BOMs from different projects to compare"
              : "Select multiple BOMs to compare within this project"
          }
        />
      </div>

      <div className="w-full max-w-4xl mx-auto">
        {/* Hero */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-blue-100 mb-4">
            <Package className="h-6 w-6 text-blue-600" />
          </div>
          <h2 className="text-xl font-bold mb-2">Select BOMs to Compare</h2>
          <p className="text-muted-foreground text-sm">
            Choose multiple BOMs to analyze differences and identify optimization opportunities
          </p>
          {selectedBOMs.length > 0 && (
            <Badge variant="secondary" className="mt-4 text-sm">
              {selectedBOMs.length} BOM{selectedBOMs.length !== 1 ? "s" : ""} selected
            </Badge>
          )}
        </div>

        {/* Selected BOMs */}
        {selectedBOMs.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Selected ({selectedBOMs.length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {selectedBOMs.map((bom, idx) => (
                <div
                  key={bom.id}
                  className="p-3 border rounded-lg bg-primary/5 border-primary/30 relative"
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 h-6 w-6"
                    onClick={() => onBomToggle(bom)}
                  >
                    ×
                  </Button>
                  <p className="font-semibold pr-8">{bom.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {bom.version} · {bom.status}
                  </p>
                  <p className="text-xs text-green-600 mt-1">
                    Parts: {bomItemCounts[idx] ?? 0}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Available BOMs */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Available BOMs
          </h3>
          <div className="space-y-4 max-h-96 overflow-auto">
            {multiProjectMode ? (
              multiProjectBoms.map((pb) => (
                <div key={pb.projectId} className="space-y-2">
                  <h4 className="text-xs font-medium text-primary bg-primary/10 px-3 py-1 rounded-full inline-block">
                    {pb.projectName}
                  </h4>
                  {pb.boms.length > 0 ? (
                    pb.boms.map((bom) => {
                      const isSelected = selectedBOMs.some((s) => s.id === bom.id);
                      return (
                        <button
                          key={bom.id}
                          className={`w-full text-left rounded-lg border px-4 py-3 text-sm transition-all hover:bg-muted/50 ml-4 ${
                            isSelected ? "bg-primary/10 border-primary/50" : ""
                          }`}
                          onClick={() =>
                            onBomToggle({
                              ...bom,
                              displayName: `${pb.projectName} - ${bom.name}`,
                            })
                          }
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-semibold">{bom.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {bom.version ?? "v1.0"} · {bom.status ?? "draft"} · Updated{" "}
                                {formatDate(bom.updatedAt ?? new Date().toISOString())}
                              </p>
                            </div>
                            {isSelected && (
                              <Badge variant="default" className="text-xs">
                                ✓
                              </Badge>
                            )}
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <p className="text-xs text-muted-foreground ml-4">No BOMs available</p>
                  )}
                </div>
              ))
            ) : boms.length > 0 ? (
              boms.map((bom) => {
                const isSelected = selectedBOMs.some((s) => s.id === bom.id);
                return (
                  <button
                    key={bom.id}
                    className={`w-full text-left rounded-lg border px-4 py-3 text-sm transition-all hover:bg-muted/50 ${
                      isSelected ? "bg-primary/10 border-primary/50" : ""
                    }`}
                    onClick={() => onBomToggle(bom)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold">{bom.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {bom.version ?? "v1.0"} · {bom.status ?? "draft"} · Updated{" "}
                          {formatDate(bom.updatedAt ?? new Date().toISOString())}
                        </p>
                      </div>
                      {isSelected && <Badge variant="secondary">Selected</Badge>}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="mx-auto h-8 w-8 mb-2" />
                <p className="text-sm">No BOMs found in this project</p>
              </div>
            )}
          </div>
        </div>

        {/* Compare button */}
        <div className="flex justify-center">
          <Button
            className="gap-2 px-8"
            disabled={selectedBOMs.length < 2}
            onClick={onCompare}
          >
            Compare BOMs ({selectedBOMs.length})
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}