"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/PageHeader";
import { GitCompare, Search, FolderOpen } from "lucide-react";
import type { SelectedProject } from "../types";
import { formatPrice, formatDate, safeNum } from "../utils";

interface Props {
  projects: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  multiProjectMode: boolean;
  selectedProjects: SelectedProject[];
  searchProject: string;
  onSearch: (v: string) => void;
  onProjectSelect: (p: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  onMultiToggle: (p: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  onSetMultiMode: (v: boolean) => void;
  onCompareProjects: () => void;
}

export function ProjectSelection({
  projects,
  multiProjectMode,
  selectedProjects,
  searchProject,
  onSearch,
  onProjectSelect,
  onMultiToggle,
  onSetMultiMode,
  onCompareProjects,
}: Props) {
  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(searchProject.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        title="Benchmarking"
        description="Select a project to compare BOMs and identify optimization opportunities"
      />

      <div className="w-full max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 mb-4">
            <FolderOpen className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">
            {multiProjectMode ? "Select Projects to Compare" : "Select Project"}
          </h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            {multiProjectMode
              ? "Choose multiple projects to compare BOMs across different projects."
              : "Choose a project to analyze its BOMs and identify cost drivers and VAVE opportunities."}
          </p>

          {/* Mode toggle */}
          <div className="flex items-center justify-center gap-4 mt-4">
            <Button
              variant={!multiProjectMode ? "default" : "outline"}
              size="sm"
              onClick={() => onSetMultiMode(false)}
            >
              Single Project
            </Button>
            <Button
              variant={multiProjectMode ? "default" : "outline"}
              size="sm"
              onClick={() => onSetMultiMode(true)}
            >
              Multiple Projects
            </Button>
          </div>

          {/* Selected project badges */}
          {multiProjectMode && selectedProjects.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-muted-foreground mb-2">
                Selected ({selectedProjects.length}):
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {selectedProjects.map((project) => (
                  <Badge key={project.id} variant="secondary" className="px-3 py-1">
                    {project.name}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-4 w-4 p-0 ml-2 hover:bg-destructive hover:text-destructive-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMultiToggle(project);
                      }}
                    >
                      ×
                    </Button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="space-y-4 mb-8">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              className="w-full pl-10"
              value={searchProject}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>

          {/* Project list */}
          <div className="space-y-2 max-h-96 overflow-auto">
            {filtered.length > 0 ? (
              filtered.map((project) => {
                const isSelected = multiProjectMode
                  ? selectedProjects.some((p) => p.id === project.id)
                  : false;

                return (
                  <button
                    key={project.id}
                    className={`w-full text-left rounded-lg border px-4 py-3 text-sm transition-all hover:bg-muted/50 relative ${
                      isSelected ? "bg-primary/10 border-primary" : ""
                    }`}
                    onClick={() =>
                      multiProjectMode ? onMultiToggle(project) : onProjectSelect(project)
                    }
                  >
                    {multiProjectMode && isSelected && (
                      <div className="absolute top-2 right-2">
                        <Badge variant="default" className="text-xs px-2 py-0">
                          ✓
                        </Badge>
                      </div>
                    )}
                    <p className="font-semibold">{project.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatPrice(
                        project.targetPrice ?? project.shouldCost ?? project.targetBomCost
                      )}{" "}
                      · {project.status} · Updated{" "}
                      {formatDate(project.updatedAt ?? new Date().toISOString())}
                    </p>
                  </button>
                );
              })
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <FolderOpen className="mx-auto h-12 w-12 mb-4" />
                <p className="text-sm">No projects found</p>
                <p className="text-xs">Try a different search term</p>
              </div>
            )}
          </div>

          {/* Compare button (multi-mode) */}
          {multiProjectMode && selectedProjects.length >= 2 && (
            <Button onClick={onCompareProjects} className="w-full" size="lg">
              <GitCompare className="h-4 w-4 mr-2" />
              Compare {selectedProjects.length} Projects
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}