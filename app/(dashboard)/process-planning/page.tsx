'use client';

import { useState, useMemo, useEffect } from 'react';

import { BOMSelectionCard } from '@/components/features/process-planning/BOMSelectionCard';
import { ChildPartsSection } from '@/components/features/process-planning/ChildPartsSection';
import { ManufacturingProcessSection } from '@/components/features/process-planning/ManufacturingProcessSection';
import { PackagingLogisticsSection } from '@/components/features/process-planning/PackagingLogisticsSection';
import { ParentEstimatesSection } from '@/components/features/process-planning/ParentEstimatesSection';
import { ProcuredPartsSection } from '@/components/features/process-planning/ProcuredPartsSection';
import { RawMaterialsSection } from '@/components/features/process-planning/RawMaterialsSection';
import { ToolingSection } from '@/components/features/process-planning/ToolingSection';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageSkeleton } from '@/components/ui/loading-skeleton';
import { PartDimensionViewer } from '@/components/ui/part-dimension-viewer';
import { apiClient } from '@/lib/api/client';
import { useBOMs } from '@/lib/api/hooks/useBOM';
import { useBOMItems } from '@/lib/api/hooks/useBOMItems';

export default function ProcessPlanningPage() {
  const [selectedBomId, setSelectedBomId] = useState<string>('');
  const [selectedPartNumber, setSelectedPartNumber] = useState<string>('');
  const [file3dUrl, setFile3dUrl] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // Fetch BOMs from API
  const { data: bomsData, isLoading: isLoadingBOMs } = useBOMs();
  const { data: bomItemsData, isLoading: isLoadingItems } = useBOMItems(selectedBomId || undefined);

  interface LocalBOMItem {
    id: string;
    partNumber: string;
    description: string;
    itemType: 'assembly' | 'sub_assembly' | 'child_part';
    status: 'pending' | 'in_progress' | 'completed';
    file3dPath?: string;
    maxLength?: number | null;
    maxWidth?: number | null;
    maxHeight?: number | null;
  }

  interface LocalBOM {
    id: string;
    name: string;
    items: LocalBOMItem[];
  }

  const handleBomChange = (bomId: string) => {
    setSelectedBomId(bomId);
    setSelectedPartNumber('');
    setSearchTerm('');
    setStatusFilter('all');
    setTypeFilter('all');
  };
  
  // Transform BOMs data into the format expected by BOMSelectionCard
  const boms = useMemo<LocalBOM[]>(() => {
    if (!bomsData?.boms) return [];

    return bomsData.boms.map((bom) => ({
      id: bom.id,
      name: bom.name,
      items: [], // Items will be fetched separately when BOM is selected
    }));
  }, [bomsData]);

  // Transform BOM items data
  const bomItems = useMemo<LocalBOMItem[]>(() => {
    if (!bomItemsData?.items) return [];

    return bomItemsData.items.map((item) => ({
      id: item.id,
      partNumber: item.partNumber || 'N/A',
      description: item.description || item.name || 'No description',
      itemType: (item.itemType || 'child_part') as 'assembly' | 'sub_assembly' | 'child_part',
      status: 'pending' as 'pending' | 'in_progress' | 'completed',
      ...(item.file3dPath !== undefined ? { file3dPath: item.file3dPath } : {}),
      ...(item.maxLength !== undefined ? { maxLength: item.maxLength } : {}),
      ...(item.maxWidth !== undefined ? { maxWidth: item.maxWidth } : {}),
      ...(item.maxHeight !== undefined ? { maxHeight: item.maxHeight } : {}),
    }));
  }, [bomItemsData]);

  const selectedBom = boms.find(b => b.id === selectedBomId);
  const selectedPart = bomItems.find(i => i.partNumber === selectedPartNumber);

  // Add items to selected BOM
  if (selectedBom) {
    selectedBom.items = bomItems;
  }

  useEffect(() => {
    if (!selectedPart?.id || !selectedPart.file3dPath) {
      setFile3dUrl(null);
      return;
    }
    setFile3dUrl(null);
    apiClient.get<{ url: string }>(`/bom-items/${selectedPart.id}/file-url/3d`)
      .then((r) => { if (r?.url) setFile3dUrl(r.url); })
      .catch((e) => console.error('Failed to fetch 3D URL:', e));
  }, [selectedPart?.id, selectedPart?.file3dPath]);

  // Show loading state
  if (isLoadingBOMs || (selectedBomId && isLoadingItems)) {
    return (
      <div>
        <PageSkeleton label={isLoadingBOMs ? 'Loading BOMs...' : 'Loading Items...'} />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="space-y-6">
        {/* PAGE HEADER */}
        <PageHeader
          title="Process Planning & Costing"
          description="Simplified workflow for creating manufacturing process routes"
        >
          {selectedPartNumber && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Current Part:</span>
              <Badge variant="default" className="text-xs">
                {selectedPartNumber}
              </Badge>
            </div>
          )}
        </PageHeader>

        {/* BOM SELECTION CARD WITH FILTERS */}
        <BOMSelectionCard
          boms={boms}
          selectedBomId={selectedBomId}
          selectedPartNumber={selectedPartNumber}
          searchTerm={searchTerm}
          statusFilter={statusFilter}
          typeFilter={typeFilter}
          onBomChange={handleBomChange}
          onPartChange={setSelectedPartNumber}
          onSearchChange={setSearchTerm}
          onStatusFilterChange={setStatusFilter}
          onTypeFilterChange={setTypeFilter}
        />

        {/* PROCESS PLANNING SECTIONS - Only show if part is selected */}
        {selectedPartNumber && selectedPart && (
          <>
            {/* Selected Part Details Card */}
            <div className="rounded-lg border bg-card shadow-xs overflow-hidden">
              <div className="border-b bg-muted/40 py-2.5 px-4">
                <h6 className="m-0 text-sm font-semibold text-foreground">
                  Creating Process Plan For
                </h6>
              </div>
              <div className="bg-card p-3">
                <div className="flex flex-col md:flex-row gap-6 items-start justify-between">
                  <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Part Number</p>
                      <p className="text-sm font-semibold">{selectedPart.partNumber}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Description</p>
                      <p className="text-sm font-semibold">{selectedPart.description}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Type</p>
                      <Badge variant="outline" className="text-xs block w-fit">
                        {selectedPart.itemType.replace('_', ' ').toUpperCase()}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Status</p>
                      <Badge
                        variant={
                          selectedPart.status === 'completed'
                            ? 'default'
                            : selectedPart.status === 'in_progress'
                              ? 'secondary'
                              : 'outline'
                        }
                        className="text-xs block w-fit"
                      >
                        {selectedPart.status.replace('_', ' ').toUpperCase()}
                      </Badge>
                    </div>
                  </div>

                  {/* Part Envelope — live 3D render with projected dimension arrows */}
                  {(file3dUrl || selectedPart.maxLength != null || selectedPart.maxWidth != null) && (
                    <div className="shrink-0 flex flex-col items-center border border-border/60 rounded-md p-1.5 bg-muted/20">
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                        Part Envelope
                      </span>
                      <div className="flex justify-center" style={{ minHeight: 158 }}>
                        {file3dUrl && selectedPart.file3dPath?.toLowerCase().endsWith('.stl') ? (
                          <PartDimensionViewer
                            fileUrl={file3dUrl}
                            maxLength={selectedPart.maxLength ?? null}
                            maxWidth={selectedPart.maxWidth ?? null}
                            maxHeight={selectedPart.maxHeight ?? null}
                          />
                        ) : (
                          /* Fallback bounding box rectangle */
                          (() => {
                            const L = selectedPart.maxLength ?? 0;
                            const W = selectedPart.maxWidth ?? 0;
                            const D = selectedPart.maxHeight ?? 0;
                            if (L === 0 && W === 0) return null;
                            const svgW = 210, svgH = 158;
                            const padT = 10, padL = 10, padB = 44, padR = 82;
                            const areaW = svgW - padL - padR;
                            const areaH = svgH - padT - padB;
                            const s = Math.min(areaW / (L || 1), areaH / (W || 1), 4);
                            const rW = (L || areaW) * s;
                            const rH = (W || areaH) * s;
                            const rx = padL + (areaW - rW) / 2;
                            const ry = padT + (areaH - rH) / 2;
                            const extGap = 5;
                            const arrowY = ry + rH + extGap + 14;
                            const arrowX = rx + rW + extGap + 14;
                            return (
                              <svg width={svgW} height={svgH} style={{ overflow: 'visible' }}>
                                <defs>
                                  <marker id="pdv-e" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
                                    <polygon points="0,0 6,2.5 0,5" fill="#6b7280" />
                                  </marker>
                                  <marker id="pdv-s" markerWidth="6" markerHeight="5" refX="1" refY="2.5" orient="auto-start-reverse">
                                    <polygon points="0,0 6,2.5 0,5" fill="#6b7280" />
                                  </marker>
                                </defs>
                                <rect x={rx} y={ry} width={rW} height={rH} fill="none" stroke="#4b7fc4" strokeWidth="1.5" />
                                <line x1={rx} y1={ry + rH + extGap} x2={rx} y2={arrowY + 5} stroke="#374151" strokeWidth="0.6" />
                                <line x1={rx + rW} y1={ry + rH + extGap} x2={rx + rW} y2={arrowY + 5} stroke="#374151" strokeWidth="0.6" />
                                {L > 0 && (
                                  <>
                                    <line x1={rx} y1={arrowY} x2={rx + rW} y2={arrowY} stroke="#6b7280" strokeWidth="0.9" markerStart="url(#pdv-s)" markerEnd="url(#pdv-e)" />
                                    <text x={rx + rW / 2} y={arrowY + 13} textAnchor="middle" fontSize="9.5" fill="#e5e7eb" fontFamily="ui-monospace, monospace">
                                      {L.toFixed(2)} mm
                                    </text>
                                  </>
                                )}
                                <line x1={rx + rW + extGap} y1={ry} x2={arrowX + 5} y2={ry} stroke="#374151" strokeWidth="0.6" />
                                <line x1={rx + rW + extGap} y1={ry + rH} x2={arrowX + 5} y2={ry + rH} stroke="#374151" strokeWidth="0.6" />
                                {W > 0 && (
                                  <>
                                    <line x1={arrowX} y1={ry} x2={arrowX} y2={ry + rH} stroke="#6b7280" strokeWidth="0.9" markerStart="url(#pdv-s)" markerEnd="url(#pdv-e)" />
                                    <text x={arrowX + 7} y={ry + rH / 2} textAnchor="start" dominantBaseline="middle" fontSize="9.5" fill="#e5e7eb" fontFamily="ui-monospace, monospace">
                                      {W.toFixed(2)} mm
                                    </text>
                                  </>
                                )}
                                {D > 0 && (
                                  <text x={rx + rW} y={ry - 5} textAnchor="end" fontSize="8" fill="#6b7280" fontFamily="ui-monospace, monospace">
                                    D: {D.toFixed(2)} mm
                                  </text>
                                )}
                              </svg>
                            );
                          })()
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Raw Materials Section */}
            <RawMaterialsSection bomItemId={selectedPart.id} bomItem={selectedPart} />

            {/* Manufacturing Process Section */}
            <ManufacturingProcessSection bomItemId={selectedPart.id} bomItem={selectedPart} />

            {/* Packaging & Logistics Section */}
            <PackagingLogisticsSection bomItemId={selectedPart.id} />

            {/* Child Parts Section - Only show for assembly and sub_assembly */}
            {selectedPart && selectedPart.itemType !== 'child_part' && (
              <ChildPartsSection bomItemId={selectedPart.id} bomId={selectedBomId} />
            )}

            {/* Procured Parts Section */}
            <ProcuredPartsSection bomItemId={selectedPart.id} />

            {/* Parent Estimates Section */}
            <ParentEstimatesSection />

            {/* Tooling & Fixtures Section - Moved to last */}
            <ToolingSection bomItemId={selectedPart.id} bomItem={selectedPart} />

            {/* Action Buttons */}
            <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Complete Process Plan</p>
                <p className="text-xs text-muted-foreground mt-1">
                  All sections above will be saved for part: {selectedPartNumber}
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline">Save as Draft</Button>
                <Button>Save & Calculate Cost</Button>
              </div>
            </div>
          </>
        )}

        {/* Empty State - No Part Selected */}
        {!selectedPartNumber && selectedBomId && (
          <div className="text-center py-12 bg-card border border-dashed border-border rounded-lg">
            <p className="text-muted-foreground mb-2 text-sm font-semibold">
              No Part Selected
            </p>
            <p className="text-xs text-muted-foreground">
              Use the filters and dropdown above to find and select a part
            </p>
          </div>
        )}

        {/* Empty State - No BOM Selected */}
        {!selectedBomId && (
          <div className="text-center py-12 bg-card border border-dashed border-border rounded-lg">
            <p className="text-muted-foreground mb-2 text-sm font-semibold">
              No BOM Selected
            </p>
            <p className="text-xs text-muted-foreground">
              Select a BOM from the dropdown above to begin
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
