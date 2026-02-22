'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useProductionLots } from '@/lib/api/hooks/useProductionPlanning';
import { WorkflowNavigation } from '@/components/features/workflow/WorkflowNavigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, Shield, CheckCircle, AlertTriangle, Clock, FileText, BarChart3, Target, Package, Settings } from 'lucide-react';
import Link from 'next/link';
import CreateQCInspectionDialog from '@/components/features/quality-control/CreateQCInspectionDialog';
import QCReportDialog from '@/components/features/quality-control/QCReportDialog';

interface ProductionLot {
  id: string;
  lotNumber: string;
  productionQuantity: number;
  status: string;
  bom?: {
    id: string;
    bomName: string;
    version: string;
  };
  bomItems?: BOMItem[];
}

interface BOMItem {
  id: string;
  name: string;
  partNumber?: string;
  description?: string;
  itemType: string;
  quantity: number;
  unit?: string;
  material?: string;
}

export default function QualityControlPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { data: productionLots = [], isLoading: loading, error: lotsError } = useProductionLots({ projectId });
  const [currentInspection, setCurrentInspection] = useState<any>(null);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [completedInspections, setCompletedInspections] = useState<any[]>([]);

  // Debug logging
  console.log('QC Page state:', { showReportDialog, hasInspection: !!currentInspection });

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto space-y-6">
        {/* BREADCRUMB & HEADER */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link 
                href={`/projects/${projectId}`}
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to Project
              </Link>
              <span>/</span>
              <span>Quality Control</span>
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              Quality Control & Assurance
            </h1>
            <p className="text-sm text-muted-foreground">
              Monitor quality standards and ensure compliance across production
            </p>
          </div>
          <CreateQCInspectionDialog 
            projectId={projectId}
            onInspectionCreated={(inspection) => {
              console.log('Inspection created:', inspection);
              setCurrentInspection(inspection);
              setShowReportDialog(true);
            }}
          />
        </div>

        {/* OVERVIEW CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Inspections</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">-</div>
              <p className="text-xs text-muted-foreground">
                Completed this month
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pass Rate</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">-</div>
              <p className="text-xs text-muted-foreground">
                Quality compliance rate
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Non-Conformances</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">-</div>
              <p className="text-xs text-muted-foreground">
                Requiring attention
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Inspection Time</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">-</div>
              <p className="text-xs text-muted-foreground">
                Hours per inspection
              </p>
            </CardContent>
          </Card>
        </div>

        {/* PRODUCTION PLANNING BOM INTERFACE */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="h-5 w-5" />
              Production Planning - BOM Overview
            </CardTitle>
            <CardDescription>
              Production lots with lot numbers and BOM part details
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-muted-foreground">Loading production lots...</p>
              </div>
            ) : productionLots.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No production lots found.</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Create a production lot in the Production Planning module to see BOM details here.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Completed Inspections */}
                {completedInspections.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">Completed Quality Inspections</h3>
                    <div className="grid grid-cols-1 gap-4">
                      {completedInspections.map((inspection, index) => (
                        <Card key={index} className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="font-medium">{inspection.name}</h4>
                              <p className="text-sm text-muted-foreground">
                                {inspection.bomName} • {inspection.selectedItems?.length || 0} parts inspected
                              </p>
                              <div className="flex gap-2 mt-2">
                                <Badge variant={inspection.overallResult === 'pass' ? 'default' : inspection.overallResult === 'fail' ? 'destructive' : 'secondary'}>
                                  {inspection.overallResult?.toUpperCase() || 'COMPLETED'}
                                </Badge>
                                <Badge variant="outline">{inspection.checklist?.length || 0} checks</Badge>
                              </div>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {new Date(inspection.submittedAt || inspection.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="text-center py-8">
                  <CreateQCInspectionDialog 
                    projectId={projectId}
                    onInspectionCreated={(inspection) => {
                      console.log('Inspection created:', inspection);
                      console.log('Setting current inspection and showing dialog...');
                      // Open the report dialog immediately after creation
                      setCurrentInspection(inspection);
                      setShowReportDialog(true);
                      console.log('Dialog state set to true');
                    }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* QC STANDARDS & PROCEDURES */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Target className="h-5 w-5" />
              Quality Standards & Procedures
            </CardTitle>
            <CardDescription>
              Quality control standards, procedures, and inspection checklists
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 border rounded-lg">
                <h4 className="font-medium mb-2">Inspection Checklists</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Standard inspection procedures and quality checkpoints
                </p>
                <Button variant="outline" size="sm" className="w-full">
                  View Checklists
                </Button>
              </div>
              
              <div className="p-4 border rounded-lg">
                <h4 className="font-medium mb-2">Quality Standards</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  ISO standards and industry quality requirements
                </p>
                <Button variant="outline" size="sm" className="w-full">
                  Manage Standards
                </Button>
              </div>
              
              <div className="p-4 border rounded-lg">
                <h4 className="font-medium mb-2">Test Procedures</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Material testing and performance validation procedures
                </p>
                <Button variant="outline" size="sm" className="w-full">
                  Setup Procedures
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* QUALITY METRICS & REPORTING */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Quality Metrics & Reporting
            </CardTitle>
            <CardDescription>
              Quality performance analytics and compliance reporting
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h4 className="font-medium">Quality Performance</h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">First Pass Yield</span>
                    <span className="font-medium text-muted-foreground">-</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Defect Rate</span>
                    <span className="font-medium text-muted-foreground">-</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Customer Complaints</span>
                    <span className="font-medium text-muted-foreground">-</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Rework Rate</span>
                    <span className="font-medium text-muted-foreground">-</span>
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <h4 className="font-medium">Compliance Status</h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">ISO 9001 Compliance</span>
                    <Badge variant="outline">Not Set</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Customer QA Approval</span>
                    <Badge variant="outline">Not Set</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Material Certificates</span>
                    <Badge variant="outline">Not Set</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Test Reports</span>
                    <Badge variant="outline">Not Set</Badge>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="mt-6 pt-6 border-t">
              <Button className="w-full">
                <FileText className="h-4 w-4 mr-2" />
                Generate Quality Report
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Workflow Navigation */}
        <WorkflowNavigation 
          currentModuleId="quality-control" 
          projectId={projectId}
        />

        {/* QC Report Dialog */}
        <QCReportDialog
          open={showReportDialog}
          onOpenChange={setShowReportDialog}
          inspection={currentInspection}
        />
      </div>
    </div>
  );
}