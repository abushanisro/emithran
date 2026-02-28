'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Truck, 
  Package, 
  CheckCircle, 
  Clock, 
  AlertTriangle,
  Plus,
  Search,
  Filter,
  Download,
  Eye,
  MoreVertical,
  ArrowLeft,
  TrendingUp,
  DollarSign,
  Target,
  Calendar,
  MapPin,
  FileText,
  Ship,
  Factory,
  QrCode,
  Settings
} from 'lucide-react';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { 
  useDeliveryOrders, 
  useAvailableItemsForDelivery,
  useDeliveryMetrics,
  useDeliveryBatches,
  useShipments,
  useCancelDeliveryOrder,
  DeliveryOrder,
  DeliveryBatch,
  Shipment
} from '@/lib/api/hooks/useDelivery';

import DeliveryScheduling from './components/DeliveryScheduling';
import LogisticsCoordination from './components/LogisticsCoordination';
import DocumentationCompliance from './components/DocumentationCompliance';
import CreateDeliveryOrderDialog from './CreateDeliveryOrderDialog';

interface DeliveryDashboardProps {
  projectId: string;
}

export default function DeliveryDashboard({ projectId }: DeliveryDashboardProps) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState('overview');

  // API Hooks
  const {
    data: deliveryOrdersResponse,
    isLoading: ordersLoading,
    refetch: refetchOrders
  } = useDeliveryOrders(projectId, {
    search: searchTerm,
    status: statusFilter,
    priority: priorityFilter,
    page,
    limit: 20
  });

  const {
    data: availableItems = [],
    isLoading: itemsLoading
  } = useAvailableItemsForDelivery(projectId);

  const {
    data: metrics,
    isLoading: metricsLoading
  } = useDeliveryMetrics(projectId);

  const {
    data: deliveryBatches = [],
    isLoading: batchesLoading
  } = useDeliveryBatches(projectId);

  const {
    data: shipments = [],
    isLoading: shipmentsLoading
  } = useShipments({ projectId });

  const cancelOrderMutation = useCancelDeliveryOrder();

  const deliveryOrders = deliveryOrdersResponse?.data || [];
  const pagination = deliveryOrdersResponse?.pagination;

  // Calculate stats for overview
  const totalShipments = shipments.length;
  const readyForDelivery = deliveryBatches.filter(b => b.status === 'ready_for_shipment').length;
  const inTransit = shipments.filter(s => s.status === 'in_transit').length;
  const delivered = shipments.filter(s => s.status === 'delivered').length;
  const avgDeliveryTime = metrics?.avgDelayDays ? Math.abs(metrics.avgDelayDays) : 5.2;

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'draft': { color: 'bg-gray-100 text-gray-800', icon: Clock },
      'pending_approval': { color: 'bg-yellow-100 text-yellow-800', icon: Clock },
      'approved': { color: 'bg-blue-100 text-blue-800', icon: CheckCircle },
      'in_transit': { color: 'bg-purple-100 text-purple-800', icon: Truck },
      'out_for_delivery': { color: 'bg-orange-100 text-orange-800', icon: Truck },
      'delivered': { color: 'bg-green-100 text-green-800', icon: CheckCircle },
      'failed_delivery': { color: 'bg-red-100 text-red-800', icon: AlertTriangle },
      'returned': { color: 'bg-yellow-100 text-yellow-800', icon: AlertTriangle },
      'cancelled': { color: 'bg-gray-100 text-gray-800', icon: AlertTriangle }
    };

    const config = statusConfig[status] || statusConfig['draft'];
    const Icon = config.icon;

    return (
      <Badge className={`${config.color} flex items-center gap-1 text-xs`}>
        <Icon className="h-3 w-3" />
        {status?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Draft'}
      </Badge>
    );
  };

  const getBatchStatusBadge = (status: string) => {
    const statusConfig = {
      'production': { color: 'bg-blue-100 text-blue-800', label: 'Production' },
      'qc_review': { color: 'bg-yellow-100 text-yellow-800', label: 'QC Review' },
      'pending': { color: 'bg-orange-100 text-orange-800', label: 'Pending' },
      'ready_for_shipment': { color: 'bg-green-100 text-green-800', label: 'Ready for Shipment' },
      'shipped': { color: 'bg-purple-100 text-purple-800', label: 'Shipped' },
      'delivered': { color: 'bg-green-100 text-green-800', label: 'Delivered' }
    };

    const config = statusConfig[status] || statusConfig['pending'];

    return (
      <Badge className={`${config.color} text-xs`}>
        {config.label}
      </Badge>
    );
  };

  const getShipmentStatusBadge = (status: string) => {
    const statusConfig = {
      'scheduled': { color: 'bg-blue-100 text-blue-800', label: 'Scheduled' },
      'in_transit': { color: 'bg-purple-100 text-purple-800', label: 'In Transit' },
      'delivered': { color: 'bg-green-100 text-green-800', label: 'Delivered' },
      'delayed': { color: 'bg-red-100 text-red-800', label: 'Delayed' },
      'cancelled': { color: 'bg-gray-100 text-gray-800', label: 'Cancelled' }
    };

    const config = statusConfig[status] || statusConfig['scheduled'];

    return (
      <Badge className={`${config.color} text-xs`}>
        {config.label}
      </Badge>
    );
  };

  const handleCancelOrder = async (orderId: string, orderNumber: string) => {
    if (window.confirm(`Are you sure you want to cancel delivery order ${orderNumber}?`)) {
      try {
        await cancelOrderMutation.mutateAsync({ id: orderId, reason: 'Cancelled by user' });
      } catch (error) {
        // Error handling is done in the mutation
      }
    }
  };

  const handleViewOrder = (orderId: string) => {
    router.push(`/projects/${projectId}/delivery/${orderId}`);
  };

  // Main metrics cards
  const MetricsCards = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-muted-foreground">Shipments</p>
              <p className="text-2xl font-bold">{totalShipments}</p>
              <p className="text-xs text-muted-foreground">Total shipments</p>
            </div>
            <Ship className="h-8 w-8 text-blue-600" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-muted-foreground">Ready for delivery</p>
              <p className="text-2xl font-bold text-green-600">{readyForDelivery}</p>
              <p className="text-xs text-muted-foreground">Batches ready</p>
            </div>
            <Package className="h-8 w-8 text-green-600" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-muted-foreground">In Transit</p>
              <p className="text-2xl font-bold text-purple-600">{inTransit}</p>
              <p className="text-xs text-muted-foreground">Currently shipping</p>
            </div>
            <Truck className="h-8 w-8 text-purple-600" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center">
            <div className="flex-1">
              <p className="text-sm font-medium text-muted-foreground">Delivered</p>
              <p className="text-2xl font-bold text-green-600">{delivered}</p>
              <p className="text-xs text-muted-foreground">Successfully delivered</p>
            </div>
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // Average delivery time card
  const AvgDeliveryCard = () => (
    <Card className="mb-6">
      <CardContent className="p-6">
        <div className="flex items-center">
          <div className="flex-1">
            <p className="text-sm font-medium text-muted-foreground">Avg Delivery</p>
            <p className="text-3xl font-bold">{avgDeliveryTime.toFixed(1)}</p>
            <p className="text-sm text-muted-foreground">Days delivery time</p>
          </div>
          <Clock className="h-10 w-10 text-blue-600" />
        </div>
      </CardContent>
    </Card>
  );

  if (ordersLoading || itemsLoading || metricsLoading || batchesLoading || shipmentsLoading) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p>Loading delivery dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card text-card-foreground border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  onClick={() => router.push(`/projects/${projectId}`)}
                  className="flex items-center gap-2"
                  size="sm"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Project
                </Button>
                <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
                  <Truck className="h-6 w-6 text-primary" />
                  Delivery & Logistics Management
                </h1>
              </div>
              <p className="text-sm text-muted-foreground ml-24">
                Coordinate final delivery and logistics for project completion
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="text-sm">
                {availableItems.length} Items Ready for Delivery
              </Badge>
              <CreateDeliveryOrderDialog
                projectId={projectId}
                availableItems={availableItems}
                open={createOrderOpen}
                onOpenChange={setCreateOrderOpen}
                onSuccess={() => {
                  refetchOrders();
                  setCreateOrderOpen(false);
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto p-6">
        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="scheduling">Delivery Scheduling</TabsTrigger>
            <TabsTrigger value="logistics">Logistics Coordination</TabsTrigger>
            <TabsTrigger value="documentation">Documentation & Compliance</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <MetricsCards />
            <AvgDeliveryCard />
            
            {/* Quick sections */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Delivery Scheduling */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-lg font-semibold">Delivery Scheduling</CardTitle>
                  <Factory className="h-5 w-5 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">Plan and schedule delivery timelines</p>
                  
                  <div className="space-y-3">
                    {deliveryBatches.slice(0, 3).map((batch) => (
                      <div key={batch.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="space-y-1">
                          <p className="font-medium">{batch.batchNumber}</p>
                          <p className="text-sm text-muted-foreground">
                            {batch.status === 'ready_for_shipment' && 'Ready for shipment'}
                            {batch.status === 'qc_review' && 'In quality control'}
                            {batch.status === 'production' && `Expected completion: ${batch.expectedCompletion ? new Date(batch.expectedCompletion).toLocaleDateString() : 'Tomorrow'}`}
                          </p>
                        </div>
                        <div className="text-right">
                          {getBatchStatusBadge(batch.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <Button 
                    variant="outline" 
                    className="w-full mt-4"
                    onClick={() => setSelectedTab('scheduling')}
                  >
                    View All Batches
                  </Button>
                </CardContent>
              </Card>

              {/* Logistics Coordination */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-lg font-semibold">Logistics Coordination</CardTitle>
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">Track shipments and delivery routes</p>
                  
                  <div className="space-y-3">
                    {shipments.slice(0, 3).map((shipment) => (
                      <div key={shipment.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="space-y-1">
                          <p className="font-medium">{shipment.shipmentNumber}</p>
                          <p className="text-sm text-muted-foreground">
                            {shipment.origin} → {shipment.destination}
                          </p>
                        </div>
                        <div className="text-right">
                          {getShipmentStatusBadge(shipment.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <Button 
                    variant="outline" 
                    className="w-full mt-4"
                    onClick={() => setSelectedTab('logistics')}
                  >
                    Track All Shipments
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Documentation & Communication */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Documentation & Compliance */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-lg font-semibold">Documentation & Compliance</CardTitle>
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    Delivery documentation, certificates, and compliance records
                  </p>
                  
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium">Shipping Documents</p>
                        <p className="text-sm text-muted-foreground">Bills of lading, packing lists, and invoices</p>
                      </div>
                      <Button size="sm" variant="outline">Generate Documents</Button>
                    </div>
                    
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium">Quality Certificates</p>
                        <p className="text-sm text-muted-foreground">QC reports and compliance certificates</p>
                      </div>
                      <Button size="sm" variant="outline">View Certificates</Button>
                    </div>
                    
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium">Delivery Confirmation</p>
                        <p className="text-sm text-muted-foreground">Customer acknowledgments and signatures</p>
                      </div>
                      <Button size="sm" variant="outline">Manage Confirmations</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

            </div>
          </TabsContent>

          <TabsContent value="scheduling" className="space-y-6">
            <DeliveryScheduling 
              projectId={projectId} 
              batches={deliveryBatches}
              onScheduleUpdate={() => {
                // Refresh data when schedule is updated
                refetchOrders();
              }}
            />
          </TabsContent>

          <TabsContent value="logistics" className="space-y-6">
            <LogisticsCoordination 
              projectId={projectId}
              shipments={shipments}
              deliveryOrders={deliveryOrders}
              onTrackingUpdate={() => {
                // Refresh data when tracking is updated
                refetchOrders();
              }}
            />
          </TabsContent>

          <TabsContent value="documentation" className="space-y-6">
            <DocumentationCompliance 
              projectId={projectId}
              deliveryOrders={deliveryOrders}
            />
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}