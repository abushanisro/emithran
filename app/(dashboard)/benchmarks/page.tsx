"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  useProjects,
  useBOMItems,
  useRawMaterials,
  useProcesses,
  useVendors,
  useBOMs,
} from "@/lib/api/hooks";
import type {
  BenchmarkStep,
  BOMMetricEntry,
  SelectedBOM,
  SelectedProject,
} from "./types";
import { calculateMetrics, safeNum } from "./utils";
import { ProjectSelection } from "./components/ProjectSelection";
import { BOMSelection } from "./components/BOMSelection";
import { ComparisonView } from "./components/comparison";

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function BenchmarkPage() {
  const searchParams = useSearchParams();
  const projectIdFromUrl = searchParams?.get("projectId");

  // ── Remote data ──────────────────────────────────────────────────────────────
  const { data: projectsData } = useProjects();
  const projects = projectsData?.projects ?? [];

  const { data: rawMaterialsData } = useRawMaterials();
  const { data: processesData } = useProcesses();
  const { data: vendorsData } = useVendors();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawMaterialsRecord = rawMaterialsData as unknown as Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawMaterials: any[] =
    rawMaterialsRecord?.rawMaterials ?? rawMaterialsRecord?.data ?? [];
  const processes = processesData?.processes ?? [];
  const vendors = vendorsData?.vendors ?? [];

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<BenchmarkStep>("project-selection");
  const [searchProject, setSearchProject] = useState("");
  const [selectedProject, setSelectedProject] = useState<SelectedProject | null>(null);
  const [selectedBOMs, setSelectedBOMs] = useState<SelectedBOM[]>([]);
  const [multiProjectMode, setMultiProjectMode] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<SelectedProject[]>([]);

  // ── BOMs for single-project mode ─────────────────────────────────────────────
  const { data: bomsData } = useBOMs(
    selectedProject ? { projectId: selectedProject.id } : undefined
  );
  const boms = bomsData?.boms ?? [];

  // ── BOMs for up to 10 projects (fixed hook count — Rules of Hooks) ────────────
  const p1 = selectedProjects[0];
  const p2 = selectedProjects[1];
  const p3 = selectedProjects[2];
  const p4 = selectedProjects[3];
  const p5 = selectedProjects[4];
  const p6 = selectedProjects[5];
  const p7 = selectedProjects[6];
  const p8 = selectedProjects[7];
  const p9 = selectedProjects[8];
  const p10 = selectedProjects[9];

  const { data: bomsP1 } = useBOMs(p1 ? { projectId: p1.id } : undefined);
  const { data: bomsP2 } = useBOMs(p2 ? { projectId: p2.id } : undefined);
  const { data: bomsP3 } = useBOMs(p3 ? { projectId: p3.id } : undefined);
  const { data: bomsP4 } = useBOMs(p4 ? { projectId: p4.id } : undefined);
  const { data: bomsP5 } = useBOMs(p5 ? { projectId: p5.id } : undefined);
  const { data: bomsP6 } = useBOMs(p6 ? { projectId: p6.id } : undefined);
  const { data: bomsP7 } = useBOMs(p7 ? { projectId: p7.id } : undefined);
  const { data: bomsP8 } = useBOMs(p8 ? { projectId: p8.id } : undefined);
  const { data: bomsP9 } = useBOMs(p9 ? { projectId: p9.id } : undefined);
  const { data: bomsP10 } = useBOMs(p10 ? { projectId: p10.id } : undefined);

  const multiProjectBoms = (
    [
      p1 && { projectId: p1.id, projectName: p1.name, boms: bomsP1?.boms ?? [] },
      p2 && { projectId: p2.id, projectName: p2.name, boms: bomsP2?.boms ?? [] },
      p3 && { projectId: p3.id, projectName: p3.name, boms: bomsP3?.boms ?? [] },
      p4 && { projectId: p4.id, projectName: p4.name, boms: bomsP4?.boms ?? [] },
      p5 && { projectId: p5.id, projectName: p5.name, boms: bomsP5?.boms ?? [] },
      p6 && { projectId: p6.id, projectName: p6.name, boms: bomsP6?.boms ?? [] },
      p7 && { projectId: p7.id, projectName: p7.name, boms: bomsP7?.boms ?? [] },
      p8 && { projectId: p8.id, projectName: p8.name, boms: bomsP8?.boms ?? [] },
      p9 && { projectId: p9.id, projectName: p9.name, boms: bomsP9?.boms ?? [] },
      p10 && { projectId: p10.id, projectName: p10.name, boms: bomsP10?.boms ?? [] },
    ] as const
  ).filter(
    (x): x is { projectId: string; projectName: string; boms: any[] } => Boolean(x) // eslint-disable-line @typescript-eslint/no-explicit-any
  );

  // ── BOM items for up to 10 selected BOMs (fixed hook count) ─────────────────
  const bi1 = useBOMItems(selectedBOMs[0]?.id);
  const bi2 = useBOMItems(selectedBOMs[1]?.id);
  const bi3 = useBOMItems(selectedBOMs[2]?.id);
  const bi4 = useBOMItems(selectedBOMs[3]?.id);
  const bi5 = useBOMItems(selectedBOMs[4]?.id);
  const bi6 = useBOMItems(selectedBOMs[5]?.id);
  const bi7 = useBOMItems(selectedBOMs[6]?.id);
  const bi8 = useBOMItems(selectedBOMs[7]?.id);
  const bi9 = useBOMItems(selectedBOMs[8]?.id);
  const bi10 = useBOMItems(selectedBOMs[9]?.id);

  const bomItemsQueries = [bi1, bi2, bi3, bi4, bi5, bi6, bi7, bi8, bi9, bi10].slice(
    0,
    selectedBOMs.length
  );

  // ── URL param: auto-select project ───────────────────────────────────────────
  useEffect(() => {
    if (projectIdFromUrl && projects.length > 0) {
      const project = projects.find((p) => p.id === projectIdFromUrl);
      if (project) handleProjectSelect(project);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdFromUrl, projects]);

  // ── Derived: BOM metrics ─────────────────────────────────────────────────────
  const bomMetrics: BOMMetricEntry[] = selectedBOMs.map((bom, index) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawItems = bomItemsQueries[index]?.data?.items as any[] | undefined;
    return {
      bom,
      metrics: calculateMetrics(rawItems),
      items: rawItems,
    };
  });

  const bomItemCounts = bomItemsQueries.map((q) => q?.data?.items?.length ?? 0);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toSelectedProject = (project: any): SelectedProject => ({
    id: project.id,
    name: project.name,
    targetPrice:
      safeNum(project.targetPrice) ||
      safeNum(project.shouldCost) ||
      safeNum(project.targetBomCost),
    updatedAt: project.updatedAt ?? new Date().toISOString(),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleProjectSelect = (project: any) => {
    if (multiProjectMode) {
      handleMultiProjectToggle(project);
    } else {
      setSelectedProject(toSelectedProject(project));
      setStep("bom-selection");
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMultiProjectToggle = (project: any) => {
    const pd = toSelectedProject(project);
    setSelectedProjects((prev) =>
      prev.some((p) => p.id === project.id)
        ? prev.filter((p) => p.id !== project.id)
        : [...prev, pd]
    );
  };

  const handleMultiProjectComparison = () => {
    if (selectedProjects.length >= 2) setStep("bom-selection");
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleBomToggle = (bom: any) => {
    const bomData: SelectedBOM = {
      id: bom.id,
      name: bom.displayName ?? bom.name,
      version: bom.version ?? "v1.0",
      status: bom.status ?? "draft",
    };
    setSelectedBOMs((prev) =>
      prev.some((b) => b.id === bom.id)
        ? prev.filter((b) => b.id !== bom.id)
        : [...prev, bomData]
    );
  };

  const handleBack = () => {
    if (step === "comparison") {
      setStep("bom-selection");
    } else if (step === "bom-selection") {
      setStep("project-selection");
      if (!multiProjectMode) setSelectedProject(null);
      setSelectedBOMs([]);
    }
  };

  const handleSetMultiMode = (v: boolean) => {
    setMultiProjectMode(v);
    if (v) {
      setSelectedProject(null);
    } else {
      setSelectedProjects([]);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  if (step === "project-selection") {
    return (
      <ProjectSelection
        projects={projects}
        multiProjectMode={multiProjectMode}
        selectedProjects={selectedProjects}
        searchProject={searchProject}
        onSearch={setSearchProject}
        onProjectSelect={handleProjectSelect}
        onMultiToggle={handleMultiProjectToggle}
        onSetMultiMode={handleSetMultiMode}
        onCompareProjects={handleMultiProjectComparison}
      />
    );
  }

  if (step === "bom-selection" && (selectedProject || multiProjectMode)) {
    return (
      <BOMSelection
        selectedProject={selectedProject}
        multiProjectMode={multiProjectMode}
        selectedProjects={selectedProjects}
        selectedBOMs={selectedBOMs}
        boms={boms}
        multiProjectBoms={multiProjectBoms}
        bomItemCounts={bomItemCounts}
        onBack={handleBack}
        onBomToggle={handleBomToggle}
        onCompare={() => {
          if (selectedBOMs.length >= 2) setStep("comparison");
        }}
      />
    );
  }

  if (
    step === "comparison" &&
    (selectedProject || multiProjectMode) &&
    selectedBOMs.length >= 2
  ) {
    return (
      <ComparisonView
        bomMetrics={bomMetrics}
        selectedBOMs={selectedBOMs}
        selectedProject={selectedProject}
        multiProjectMode={multiProjectMode}
        selectedProjects={selectedProjects}
        processes={processes}
        vendors={vendors}
        rawMaterials={rawMaterials}
        onBack={handleBack}
      />
    );
  }

  // Fallback — should not normally render
  return null;
}