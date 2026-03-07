'use client';

import { useState, useMemo } from 'react';
import { BOMSelectionCard } from '@/components/features/process-planning/BOMSelectionCard';
import { RawMaterialsSection } from '@/components/features/process-planning/RawMaterialsSection';
import { ToolingSection } from '@/components/features/process-planning/ToolingSection';
import { ManufacturingProcessSection } from '@/components/features/process-planning/ManufacturingProcessSection';
import { PackagingLogisticsSection } from '@/components/features/process-planning/PackagingLogisticsSection';
import { ChildPartsSection } from '@/components/features/process-planning/ChildPartsSection';
import { ProcuredPartsSection } from '@/components/features/process-planning/ProcuredPartsSection';
import { ParentEstimatesSection } from '@/components/features/process-planning/ParentEstimatesSection';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useBOMs } from '@/lib/api/hooks/useBOM';
import { useBOMItems } from '@/lib/api/hooks/useBOMItems';
import { Loader2 } from 'lucide-react';

export default function ProcessPlanningPage() {
  const [selectedBomId, setSelectedBomId] = useState<string>('');
  const [selectedPartNumber, setSelectedPartNumber] = useState<string>('');
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
  }

  interface LocalBOM {
    id: string;
    name: string;
    version: string;
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
      version: bom.version || '1.0',
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
    }));
  }, [bomItemsData]);

  const selectedBom = boms.find(b => b.id === selectedBomId);
  const selectedPart = bomItems.find(i => i.partNumber === selectedPartNumber);

  // Add items to selected BOM
  if (selectedBom) {
    selectedBom.items = bomItems;
  }

  // Show loading state
  if (isLoadingBOMs || (selectedBomId && isLoadingItems)) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="flex items-center gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="text-muted-foreground">
            {isLoadingBOMs ? 'Loading BOMs...' : 'Loading Items...'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto space-y-6">
        {/* PAGE HEADER */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Process Planning & Costing</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Simplified workflow for creating manufacturing process routes
            </p>
          </div>
          {selectedPartNumber && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Current Part:</span>
              <Badge variant="default" className="text-xs">
                {selectedPartNumber}
              </Badge>
            </div>
          )}
        </div>

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
            <div className="card border-l-4 border-l-green-500 shadow-md rounded-lg overflow-hidden">
              <div className="bg-green-500 py-2 px-4">
                <h6 className="m-0 font-semibold text-white text-xs">
                  Creating Process Plan For
                </h6>
              </div>
              <div className="bg-card p-3">
                <div className="grid grid-cols-4 gap-4">
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
                    <Badge variant="outline" className="text-xs">
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
                      className="text-xs"
                    >
                      {selectedPart.status.replace('_', ' ').toUpperCase()}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            {/* Raw Materials Section */}
            <RawMaterialsSection bomItemId={selectedPart.id} bomItem={selectedPart} />

            {/* Tooling & Fixtures Section */}
            <ToolingSection bomItemId={selectedPart.id} bomItem={selectedPart} />

            {/* Manufacturing Process Section */}
            <ManufacturingProcessSection />

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

            {/* Action Buttons */}
            <div className="flex items-center justify-between p-4 bg-card border-l-4 border-l-primary rounded-lg shadow-md">
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
          <div className="text-center py-12 bg-card border-2 border-dashed border-border rounded-lg">
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
          <div className="text-center py-12 bg-card border-2 border-dashed border-border rounded-lg">
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
