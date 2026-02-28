'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  MapPin, 
  Truck, 
  Package, 
  CheckCircle, 
  AlertTriangle,
  Plus,
  Search,
  Navigation,
  Clock,
  MoreVertical,
  Eye,
  Route,
  Calendar
} from 'lucide-react';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Shipment, DeliveryOrder } from '@/lib/api/hooks/useDelivery';

interface LogisticsCoordinationProps {
  projectId: string;
  shipments: Shipment[];
  deliveryOrders: DeliveryOrder[];
  onTrackingUpdate: () => void;
}

export default function LogisticsCoordination({ 
  projectId, 
  shipments, 
  deliveryOrders, 
  onTrackingUpdate 
}: LogisticsCoordinationProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedView, setSelectedView] = useState('shipments');

  const filteredShipments = shipments.filter(shipment => {
    const matchesSearch = !searchTerm || 
      shipment.shipmentNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      shipment.origin.toLowerCase().includes(searchTerm.toLowerCase()) ||
      shipment.destination.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = !statusFilter || statusFilter === 'all' || shipment.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getShipmentStatusBadge = (status: string) => {
    const statusConfig = {
      'scheduled': { color: 'bg-blue-100 text-blue-800', label: 'Scheduled', icon: Calendar },
      'in_transit': { color: 'bg-purple-100 text-purple-800', label: 'In Transit', icon: Truck },
      'delivered': { color: 'bg-green-100 text-green-800', label: 'Delivered', icon: CheckCircle },
      'delayed': { color: 'bg-red-100 text-red-800', label: 'Delayed', icon: AlertTriangle },
      'cancelled': { color: 'bg-gray-100 text-gray-800', label: 'Cancelled', icon: AlertTriangle }
    };

    const config = statusConfig[status] || statusConfig['scheduled'];
    const Icon = config.icon;

    return (
      <Badge className={`${config.color} flex items-center gap-1 text-xs`}>
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const getStatusProgress = (status: string, departureDate?: string, estimatedArrival?: string) => {
    if (status === 'delivered') return 100;
    if (status === 'cancelled') return 0;
    if (status === 'scheduled') return 10;
    if (status === 'delayed') return 75;
    
    if (status === 'in_transit' && departureDate && estimatedArrival) {
      const departure = new Date(departureDate).getTime();
      const arrival = new Date(estimatedArrival).getTime();
      const now = Date.now();
      const progress = Math.min(90, Math.max(20, ((now - departure) / (arrival - departure)) * 100));
      return progress;
    }
    
    return 50;
  };

  const getRouteDisplay = (shipment: Shipment) => {
    if (shipment.route && shipment.route.length > 0) {
      return shipment.route.join(' → ');
    }
    return `${shipment.origin} → ${shipment.destination}`;
  };

  const getEstimatedDeliveryTime = (shipment: Shipment) => {
    if (shipment.actualArrival) {
      return `Delivered: ${new Date(shipment.actualArrival).toLocaleDateString()}`;
    }
    if (shipment.estimatedArrival) {
      const eta = new Date(shipment.estimatedArrival);
      const now = new Date();
      const diffHours = Math.ceil((eta.getTime() - now.getTime()) / (1000 * 60 * 60));
      
      if (diffHours < 24) {
        return `ETA: ${diffHours}h`;
      } else {
        return `ETA: ${Math.ceil(diffHours / 24)}d`;
      }
    }
    return 'ETA: TBD';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Logistics Coordination</h2>
          <p className="text-sm text-muted-foreground">Track shipments and delivery routes</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedView} onValueChange={setSelectedView}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shipments">Shipments</SelectItem>
              <SelectItem value="routes">Routes</SelectItem>
              <SelectItem value="tracking">Live Tracking</SelectItem>
            </SelectContent>
          </Select>
          <Button className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            New Shipment
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search shipments, routes, or destinations..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="in_transit">In Transit</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="delayed">Delayed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Shipments Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground">Total Shipments</p>
                <p className="text-xl font-bold">{shipments.length}</p>
              </div>
              <Package className="h-6 w-6 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground">In Transit</p>
                <p className="text-xl font-bold text-purple-600">
                  {shipments.filter(s => s.status === 'in_transit').length}
                </p>
              </div>
              <Truck className="h-6 w-6 text-purple-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground">Delivered</p>
                <p className="text-xl font-bold text-green-600">
                  {shipments.filter(s => s.status === 'delivered').length}
                </p>
              </div>
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground">Delayed</p>
                <p className="text-xl font-bold text-red-600">
                  {shipments.filter(s => s.status === 'delayed').length}
                </p>
              </div>
              <AlertTriangle className="h-6 w-6 text-red-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Shipments List */}
      <div className="grid gap-4">
        {filteredShipments.map((shipment) => (
          <Card key={shipment.id} className="hover:shadow-md transition-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-lg">{shipment.shipmentNumber}</CardTitle>
                    {getShipmentStatusBadge(shipment.status)}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Route className="h-4 w-4" />
                      <span>{getRouteDisplay(shipment)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Truck className="h-4 w-4" />
                      <span>{shipment.carrierName}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Package className="h-4 w-4" />
                      <span>#{shipment.trackingNumber}</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <div className="text-right text-sm">
                    <p className="font-medium">{getEstimatedDeliveryTime(shipment)}</p>
                    {shipment.departureDate && (
                      <p className="text-muted-foreground">
                        Departed: {new Date(shipment.departureDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-9 w-9 p-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>
                        <Eye className="h-4 w-4 mr-2" />
                        Track Shipment
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <MapPin className="h-4 w-4 mr-2" />
                        View Route
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Package className="h-4 w-4 mr-2" />
                        View Manifest
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </CardHeader>
            
            <CardContent>
              <div className="space-y-4">
                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">Delivery Progress</span>
                    <span className="text-muted-foreground">
                      {Math.round(getStatusProgress(shipment.status, shipment.departureDate, shipment.estimatedArrival))}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all duration-300 ${
                        shipment.status === 'delivered' ? 'bg-green-600' :
                        shipment.status === 'delayed' ? 'bg-red-600' :
                        shipment.status === 'cancelled' ? 'bg-gray-400' :
                        'bg-blue-600'
                      }`}
                      style={{ 
                        width: `${getStatusProgress(shipment.status, shipment.departureDate, shipment.estimatedArrival)}%` 
                      }}
                    />
                  </div>
                </div>

                {/* Route Information */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="font-medium text-muted-foreground">Origin</p>
                    <p className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {shipment.origin}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-muted-foreground">Destination</p>
                    <p className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {shipment.destination}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-muted-foreground">Status</p>
                    <p className="capitalize">{shipment.status.replace('_', ' ')}</p>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="flex gap-2 pt-2 border-t">
                  <Button size="sm" className="flex items-center gap-1">
                    <Navigation className="h-3 w-3" />
                    Track Live
                  </Button>
                  <Button size="sm" variant="outline" className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    View Route
                  </Button>
                  <Button size="sm" variant="outline" className="flex items-center gap-1">
                    <Package className="h-3 w-3" />
                    View Details
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredShipments.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Truck className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Shipments Found</h3>
            <p className="text-muted-foreground mb-4">
              No shipments found matching your criteria. Create a new shipment to get started.
            </p>
            <Button className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create First Shipment
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}