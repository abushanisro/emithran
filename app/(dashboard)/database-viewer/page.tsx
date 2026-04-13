'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Database, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { useProjects } from '@/lib/api/hooks/useProjects';
import { useBOMs } from '@/lib/api/hooks/useBOM';
import { useBOMItems } from '@/lib/api/hooks/useBOMItems';
import { useVendors } from '@/lib/api/hooks/useVendors';

export default function DatabaseViewerPage() {
  const [selectedBomId, setSelectedBomId] = useState<string | undefined>();

  const { data: projectsData, isLoading: projectsLoading, refetch: refreshProjects } = useProjects();
  const { data: bomsData, isLoading: bomsLoading, refetch: refreshBOMs } = useBOMs();
  const { data: bomItemsData, isLoading: itemsLoading, refetch: refreshItems } = useBOMItems(selectedBomId);
  const { data: vendorsData, isLoading: vendorsLoading, refetch: refreshVendors } = useVendors();

  const projects = projectsData?.projects || [];
  const boms = bomsData?.boms || [];
  const bomItems = bomItemsData?.items || [];
  const vendors = vendorsData?.vendors || [];

  const handleRefreshAll = () => {
    refreshProjects();
    refreshBOMs();
    refreshItems();
    refreshVendors();
  };

  const renderDataStatus = (isLoading: boolean, count: number) => {
    if (isLoading) return <Badge variant="outline">Loading...</Badge>;
    return count > 0 ? (
      <Badge variant="default" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        {count} records
      </Badge>
    ) : (
      <Badge variant="secondary" className="gap-1">
        <XCircle className="h-3 w-3" />
        No data
      </Badge>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Database Viewer"
        description="View and verify all data stored in your Supabase database"
      >
        <Button onClick={handleRefreshAll} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh All
        </Button>
      </PageHeader>

      {/* Status Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Projects</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{projectsLoading ? '...' : projects.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {renderDataStatus(projectsLoading, projects.length)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">BOMs</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{bomsLoading ? '...' : boms.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {renderDataStatus(bomsLoading, boms.length)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">BOM Items</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {selectedBomId ? (itemsLoading ? '...' : bomItems.length) : 'Select BOM'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {selectedBomId && renderDataStatus(itemsLoading, bomItems.length)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vendors</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{vendorsLoading ? '...' : vendors.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {renderDataStatus(vendorsLoading, vendors.length)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Data Tables */}
      <Tabs defaultValue="projects" className="space-y-4">
        <TabsList>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="boms">BOMs</TabsTrigger>
          <TabsTrigger value="items">BOM Items</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
        </TabsList>

        <TabsContent value="projects">
          <Card>
            <CardHeader>
              <CardTitle>Projects Data</CardTitle>
              <CardDescription>All projects in your database</CardDescription>
            </CardHeader>
            <CardContent>
              {projectsLoading ? (
                <p className="text-muted-foreground">Loading...</p>
              ) : projects.length === 0 ? (
                <p className="text-muted-foreground">No projects found. Create a project first.</p>
              ) : (
                <div className="space-y-4">
                  {projects.map((project) => (
                    <div key={project.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-semibold">{project.name}</h4>
                          <p className="text-sm text-muted-foreground">{project.description}</p>
                        </div>
                        <Badge>{project.status}</Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">ID: {project.id}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="boms">
          <Card>
            <CardHeader>
              <CardTitle>BOMs Data</CardTitle>
              <CardDescription>All Bill of Materials in your database</CardDescription>
            </CardHeader>
            <CardContent>
              {bomsLoading ? (
                <p className="text-muted-foreground">Loading...</p>
              ) : boms.length === 0 ? (
                <p className="text-muted-foreground">No BOMs found. Create a BOM first.</p>
              ) : (
                <div className="space-y-4">
                  {boms.map((bom) => (
                    <div key={bom.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-semibold">{bom.name}</h4>
                          <p className="text-sm text-muted-foreground">
                            {bom.description || 'No description'}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedBomId(bom.id)}
                        >
                          View Items
                        </Button>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground space-y-1">
                        <div>ID: {bom.id}</div>
                        <div>Project: {bom.projectId}</div>
                        {bom.version && <div>Version: {bom.version}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="items">
          <Card>
            <CardHeader>
              <CardTitle>BOM Items Data</CardTitle>
              <CardDescription>
                {selectedBomId
                  ? `Items for selected BOM (${selectedBomId.substring(0, 8)}...)`
                  : 'Select a BOM from the BOMs tab to view its items'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedBomId ? (
                <p className="text-muted-foreground">
                  Go to the BOMs tab and click &quot;View Items&quot; on a BOM to see its items here.
                </p>
              ) : itemsLoading ? (
                <p className="text-muted-foreground">Loading...</p>
              ) : bomItems.length === 0 ? (
                <p className="text-muted-foreground">No items found in this BOM. Add items first.</p>
              ) : (
                <div className="space-y-4">
                  {bomItems.map((item: any) => (
                    <div key={item.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-semibold">{item.name}</h4>
                          <p className="text-sm text-muted-foreground">
                            Part Number: {item.partNumber || 'N/A'}
                          </p>
                        </div>
                        <Badge>{item.itemType}</Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Quantity:</span> {item.quantity} {item.unit}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Annual Volume:</span> {item.annualVolume}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Material:</span> {item.materialGrade || 'N/A'}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Sort:</span> {item.sortOrder}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">ID: {item.id}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vendors">
          <Card>
            <CardHeader>
              <CardTitle>Vendors Data</CardTitle>
              <CardDescription>All vendors in your database</CardDescription>
            </CardHeader>
            <CardContent>
              {vendorsLoading ? (
                <p className="text-muted-foreground">Loading...</p>
              ) : vendors.length === 0 ? (
                <p className="text-muted-foreground">No vendors found.</p>
              ) : (
                <div className="space-y-4">
                  {vendors.map((vendor) => (
                    <div key={vendor.id} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-semibold">{vendor.name}</h4>
                          <p className="text-sm text-muted-foreground">
                            {vendor.supplierCode || vendor.city || 'N/A'}
                          </p>
                        </div>
                        <Badge>{vendor.status}</Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">ID: {vendor.id}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>How to Use Database Viewer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><strong>1. Check Status Cards:</strong> See how many records you have in each table</p>
          <p><strong>2. View Data:</strong> Click through tabs to see actual data from your database</p>
          <p><strong>3. Verify BOM Items:</strong> Go to BOMs tab → Click &quot;View Items&quot; → Check Items tab</p>
          <p><strong>4. Refresh Data:</strong> Click &quot;Refresh All&quot; button to reload all data from database</p>
          <p className="text-muted-foreground pt-2">
            This page directly queries your Supabase database. If you don&apos;t see data here but
            you created it, check:
            <br />• Browser console for errors
            <br />• Supabase dashboard for RLS policy issues
            <br />• Backend logs for API errors
          </p>
        </CardContent>
      </Card>
    </div>
  );
}