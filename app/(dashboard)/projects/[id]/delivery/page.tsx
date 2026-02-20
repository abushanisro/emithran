'use client';

import { useParams } from 'next/navigation';
import { WorkflowNavigation } from '@/components/features/workflow/WorkflowNavigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Truck, Package, MapPin, Clock, CheckCircle, Calendar, FileText } from 'lucide-react';
import Link from 'next/link';

export default function DeliveryPage() {
  const params = useParams();
  const projectId = params.id as string;

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
              <span>Delivery & Logistics</span>
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              Delivery & Logistics Management
            </h1>
            <p className="text-sm text-muted-foreground">
              Coordinate final delivery and logistics for project completion
            </p>
          </div>
          <Button className="flex items-center gap-2">
            <Truck className="h-4 w-4" />
            Schedule Delivery
          </Button>
        </div>

        {/* OVERVIEW CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Shipments</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">12</div>
              <p className="text-xs text-muted-foreground">
                Ready for delivery
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">In Transit</CardTitle>
              <Truck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">8</div>
              <p className="text-xs text-muted-foreground">
                Currently shipping
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Delivered</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">25</div>
              <p className="text-xs text-muted-foreground">
                Successfully delivered
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Delivery</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">5.2</div>
              <p className="text-xs text-muted-foreground">
                Days delivery time
              </p>
            </CardContent>
          </Card>
        </div>

        {/* MAIN CONTENT */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* DELIVERY SCHEDULING */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Delivery Scheduling
              </CardTitle>
              <CardDescription>
                Plan and schedule delivery timelines
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">Production Batch #001</p>
                    <p className="text-sm text-muted-foreground">Ready for shipment</p>
                  </div>
                  <Badge variant="outline">Pending</Badge>
                </div>
                
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">Production Batch #002</p>
                    <p className="text-sm text-muted-foreground">In quality control</p>
                  </div>
                  <Badge variant="secondary">QC Review</Badge>
                </div>
                
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">Production Batch #003</p>
                    <p className="text-sm text-muted-foreground">Expected completion: Tomorrow</p>
                  </div>
                  <Badge variant="outline">Production</Badge>
                </div>
                
                <Button className="w-full">
                  View All Batches
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* LOGISTICS COORDINATION */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Logistics Coordination
              </CardTitle>
              <CardDescription>
                Track shipments and delivery routes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">Shipment #SH001</p>
                    <p className="text-sm text-muted-foreground">Mumbai → Delhi</p>
                  </div>
                  <Badge>In Transit</Badge>
                </div>
                
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">Shipment #SH002</p>
                    <p className="text-sm text-muted-foreground">Chennai → Bangalore</p>
                  </div>
                  <Badge variant="secondary">Delivered</Badge>
                </div>
                
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">Shipment #SH003</p>
                    <p className="text-sm text-muted-foreground">Pune → Hyderabad</p>
                  </div>
                  <Badge variant="outline">Scheduled</Badge>
                </div>
                
                <Button className="w-full">
                  Track All Shipments
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* DOCUMENTATION & COMPLIANCE */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Documentation & Compliance
            </CardTitle>
            <CardDescription>
              Delivery documentation, certificates, and compliance records
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 border rounded-lg">
                <h4 className="font-medium mb-2">Shipping Documents</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Bills of lading, packing lists, and invoices
                </p>
                <Button variant="outline" size="sm" className="w-full">
                  Generate Documents
                </Button>
              </div>
              
              <div className="p-4 border rounded-lg">
                <h4 className="font-medium mb-2">Quality Certificates</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  QC reports and compliance certificates
                </p>
                <Button variant="outline" size="sm" className="w-full">
                  View Certificates
                </Button>
              </div>
              
              <div className="p-4 border rounded-lg">
                <h4 className="font-medium mb-2">Delivery Confirmation</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Customer acknowledgments and signatures
                </p>
                <Button variant="outline" size="sm" className="w-full">
                  Manage Confirmations
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CUSTOMER COMMUNICATION */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Customer Communication</CardTitle>
            <CardDescription>
              Keep customers informed about delivery status and updates
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8">
              <Truck className="h-16 w-16 mx-auto text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-semibold text-muted-foreground mb-2">
                Delivery Communication Hub
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Send delivery notifications, track customer feedback, and manage delivery schedules.
              </p>
              <Button>
                Setup Communication Templates
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Workflow Navigation */}
        <WorkflowNavigation 
          currentModuleId="delivery" 
          projectId={projectId}
        />
      </div>
    </div>
  );
}