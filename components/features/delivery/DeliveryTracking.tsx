'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MapPin,
  Truck,
  Clock,
  Navigation,
  Phone,
  RefreshCw,
  Package,
  CheckCircle,
  AlertCircle,
  Calendar,
  Route,
  Bell,
  Download,
  Filter,
} from 'lucide-react';
import { toast } from 'sonner';

// Dynamic import for Map component to avoid SSR issues
const DeliveryMap = dynamic(() => import('./DeliveryMap'), {
  loading: () => (
    <div className="h-96 bg-muted rounded-lg flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
        <p className="text-muted-foreground">Loading map...</p>
      </div>
    </div>
  ),
  ssr: false,
});

interface TrackingLocation {
  lat: number;
  lng: number;
  timestamp: string;
  address: string;
  status: string;
  notes?: string;
}

interface DeliveryTracking {
  orderId: string;
  orderNumber: string;
  status: 'pending' | 'pickup' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failed';
  priority: 'low' | 'standard' | 'high' | 'urgent';
  estimatedDelivery: string;
  actualDelivery?: string;
  customer: {
    name: string;
    phone: string;
    address: string;
  };
  origin: {
    lat: number;
    lng: number;
    address: string;
  };
  destination: {
    lat: number;
    lng: number;
    address: string;
  };
  currentLocation?: {
    lat: number;
    lng: number;
    timestamp: string;
  };
  carrier: {
    name: string;
    trackingNumber: string;
    driverName?: string;
    driverPhone?: string;
    vehicleNumber?: string;
  };
  items: Array<{
    partNumber: string;
    description: string;
    quantity: number;
  }>;
  trackingHistory: TrackingLocation[];
}

interface DeliveryTrackingProps {
  projectId: string;
  dateRange?: {
    from: string;
    to: string;
  };
}

export default function DeliveryTracking({ 
  projectId, 
  dateRange 
}: DeliveryTrackingProps) {
  const [deliveries, setDeliveries] = useState<DeliveryTracking[]>([]);
  const [selectedDelivery, setSelectedDelivery] = useState<DeliveryTracking | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isLiveTracking, setIsLiveTracking] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>(new Date().toISOString());
  const [isLoading, setIsLoading] = useState(true);

  // Fetch delivery data from API
  const fetchDeliveries = useCallback(async () => {
    try {
      setIsLoading(true);
      // In production, this would be an actual API call
      const response = await fetch(`/api/delivery/tracking?projectId=${projectId}&from=${dateRange?.from}&to=${dateRange?.to}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch delivery data');
      }
      
      const data = await response.json();
      setDeliveries(data.deliveries || []);
      setLastUpdate(new Date().toISOString());
    } catch (error) {
      console.error('Error fetching deliveries:', error);
      toast.error('Failed to load delivery tracking data');
    } finally {
      setIsLoading(false);
    }
  }, [projectId, dateRange]);

  // Initialize data
  useEffect(() => {
    fetchDeliveries();
  }, [fetchDeliveries]);

  // Real-time updates
  useEffect(() => {
    if (!isLiveTracking) return;

    const interval = setInterval(() => {
      fetchDeliveries();
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [isLiveTracking, fetchDeliveries]);

  // Filter deliveries
  const filteredDeliveries = deliveries.filter(delivery => {
    const matchesStatus = filterStatus === 'all' || delivery.status === filterStatus;
    const matchesPriority = filterPriority === 'all' || delivery.priority === filterPriority;
    const matchesSearch = searchTerm === '' || 
      delivery.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      delivery.carrier.trackingNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      delivery.customer.name.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesStatus && matchesPriority && matchesSearch;
  });

  const getStatusColor = (status: DeliveryTracking['status']) => {
    const colors = {
      pending: 'bg-gray-500',
      pickup: 'bg-blue-500',
      in_transit: 'bg-yellow-500',
      out_for_delivery: 'bg-orange-500',
      delivered: 'bg-green-500',
      failed: 'bg-red-500'
    };
    return colors[status] || 'bg-gray-500';
  };

  const getPriorityColor = (priority: DeliveryTracking['priority']) => {
    const colors = {
      low: 'text-gray-600 bg-gray-100',
      standard: 'text-blue-600 bg-blue-100',
      high: 'text-orange-600 bg-orange-100',
      urgent: 'text-red-600 bg-red-100'
    };
    return colors[priority] || 'text-gray-600 bg-gray-100';
  };

  const calculateETA = (delivery: DeliveryTracking) => {
    if (delivery.status === 'delivered') return 'Delivered';
    
    const now = new Date();
    const eta = new Date(delivery.estimatedDelivery);
    const diff = eta.getTime() - now.getTime();
    
    if (diff < 0) return 'Overdue';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  const handleNotifyCustomer = (delivery: DeliveryTracking) => {
    // In production, this would trigger notification service
    toast.success(`Notification sent to ${delivery.customer.name}`);
  };

  const handleExportData = () => {
    const csvData = filteredDeliveries.map(d => ({
      'Order Number': d.orderNumber,
      'Status': d.status,
      'Priority': d.priority,
      'Customer': d.customer.name,
      'ETA': calculateETA(d),
      'Carrier': d.carrier.name,
      'Tracking Number': d.carrier.trackingNumber
    }));
    
    const csv = [
      Object.keys(csvData[0] || {}).join(','),
      ...csvData.map(row => Object.values(row).join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `delivery-tracking-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success('Data exported successfully');
  };

  const updateDeliveryLocation = async (orderId: string, location: { lat: number; lng: number; status?: string; notes?: string }) => {
    try {
      const response = await fetch(`/api/delivery/tracking/${orderId}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(location),
      });

      if (!response.ok) {
        throw new Error('Failed to update location');
      }

      await fetchDeliveries();
      toast.success('Location updated successfully');
    } catch (error) {
      toast.error('Failed to update delivery location');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3"></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="h-96 bg-muted rounded"></div>
            <div className="lg:col-span-2 h-96 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Delivery Tracking</h1>
          <p className="text-muted-foreground">
            Real-time tracking for project deliveries
            {dateRange && (
              <> from {new Date(dateRange.from).toLocaleDateString()} to {new Date(dateRange.to).toLocaleDateString()}</>
            )}
          </p>
        </div>
        
        <div className="flex gap-2">
          <Button
            variant={isLiveTracking ? "default" : "outline"}
            onClick={() => setIsLiveTracking(!isLiveTracking)}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isLiveTracking ? 'animate-spin' : ''}`} />
            {isLiveTracking ? 'Live Tracking' : 'Start Live'}
          </Button>
          
          <Button variant="outline" onClick={handleExportData} className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters & Search
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label>Search</Label>
              <Input
                placeholder="Order number, tracking ID, customer..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <div>
              <Label>Status</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="pickup">Pickup</SelectItem>
                  <SelectItem value="in_transit">In Transit</SelectItem>
                  <SelectItem value="out_for_delivery">Out for Delivery</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>Priority</Label>
              <Select value={filterPriority} onValueChange={setFilterPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priority</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-end">
              <div className="text-xs text-muted-foreground">
                Last updated: {new Date(lastUpdate).toLocaleTimeString()}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Delivery List */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Deliveries ({filteredDeliveries.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[600px] overflow-y-auto">
                {filteredDeliveries.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-4" />
                    <p>No deliveries found matching your filters</p>
                  </div>
                ) : (
                  filteredDeliveries.map((delivery) => (
                    <div
                      key={delivery.orderId}
                      className={`p-4 border-b cursor-pointer hover:bg-muted/50 transition-colors ${
                        selectedDelivery?.orderId === delivery.orderId ? 'bg-muted' : ''
                      }`}
                      onClick={() => setSelectedDelivery(delivery)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium">{delivery.orderNumber}</div>
                        <Badge className={getPriorityColor(delivery.priority)}>
                          {delivery.priority}
                        </Badge>
                      </div>
                      
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-2 h-2 rounded-full ${getStatusColor(delivery.status)}`} />
                        <span className="text-sm capitalize text-muted-foreground">
                          {delivery.status.replace('_', ' ')}
                        </span>
                      </div>
                      
                      <div className="text-sm text-muted-foreground space-y-1">
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {delivery.customer.name}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          ETA: {calculateETA(delivery)}
                        </div>
                        <div className="flex items-center gap-1">
                          <Truck className="h-3 w-3" />
                          {delivery.carrier.name}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Map and Details */}
        <div className="lg:col-span-2 space-y-4">
          {/* Map */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Navigation className="h-5 w-5" />
                Live Map Tracking
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DeliveryMap
                deliveries={filteredDeliveries}
                selectedDelivery={selectedDelivery}
                onLocationUpdate={updateDeliveryLocation}
                onDeliverySelect={setSelectedDelivery}
              />
            </CardContent>
          </Card>

          {/* Delivery Details */}
          {selectedDelivery && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Delivery Details - {selectedDelivery.orderNumber}</CardTitle>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleNotifyCustomer(selectedDelivery)}
                    >
                      <Bell className="h-4 w-4 mr-1" />
                      Notify
                    </Button>
                    {selectedDelivery.carrier.driverPhone && (
                      <Button size="sm" variant="outline" asChild>
                        <a href={`tel:${selectedDelivery.carrier.driverPhone}`}>
                          <Phone className="h-4 w-4 mr-1" />
                          Call Driver
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="overview" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="tracking">Tracking</TabsTrigger>
                    <TabsTrigger value="items">Items</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="overview" className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <h4 className="font-medium">Delivery Information</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Status:</span>
                            <Badge className={`${getStatusColor(selectedDelivery.status)} text-white`}>
                              {selectedDelivery.status.replace('_', ' ')}
                            </Badge>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Priority:</span>
                            <Badge className={getPriorityColor(selectedDelivery.priority)}>
                              {selectedDelivery.priority}
                            </Badge>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">ETA:</span>
                            <span>{calculateETA(selectedDelivery)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Carrier:</span>
                            <span>{selectedDelivery.carrier.name}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Tracking #:</span>
                            <span className="font-mono text-xs">
                              {selectedDelivery.carrier.trackingNumber}
                            </span>
                          </div>
                          {selectedDelivery.carrier.driverName && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Driver:</span>
                              <span>{selectedDelivery.carrier.driverName}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <h4 className="font-medium">Customer Information</h4>
                        <div className="space-y-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">Contact:</span>
                            <div>{selectedDelivery.customer.name}</div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Phone:</span>
                            <div>{selectedDelivery.customer.phone}</div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Address:</span>
                            <div>{selectedDelivery.customer.address}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="tracking" className="space-y-4">
                    <div className="space-y-3">
                      <h4 className="font-medium">Tracking History</h4>
                      {selectedDelivery.currentLocation && (
                        <div className="bg-muted/50 p-3 rounded-lg">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                            <span className="font-medium text-sm">Current Location (Live)</span>
                          </div>
                          <div className="text-xs text-muted-foreground ml-4">
                            Last updated: {new Date(selectedDelivery.currentLocation.timestamp).toLocaleString()}
                          </div>
                        </div>
                      )}
                      
                      <div className="space-y-2">
                        {selectedDelivery.trackingHistory.map((event, index) => (
                          <div key={index} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className="w-2 h-2 rounded-full bg-primary" />
                              {index < selectedDelivery.trackingHistory.length - 1 && (
                                <div className="w-px h-6 bg-border" />
                              )}
                            </div>
                            <div className="flex-1 pb-4">
                              <div className="text-sm font-medium">{event.status}</div>
                              <div className="text-xs text-muted-foreground">{event.address}</div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(event.timestamp).toLocaleString()}
                              </div>
                              {event.notes && (
                                <div className="text-xs text-muted-foreground mt-1">{event.notes}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="items" className="space-y-4">
                    <div className="space-y-3">
                      <h4 className="font-medium">Items in Delivery</h4>
                      <div className="space-y-2">
                        {selectedDelivery.items.map((item, index) => (
                          <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                            <div>
                              <div className="font-medium text-sm">{item.partNumber}</div>
                              <div className="text-xs text-muted-foreground">{item.description}</div>
                            </div>
                            <Badge variant="outline">Qty: {item.quantity}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          {
            label: 'Total Deliveries',
            value: deliveries.length,
            icon: Package,
            color: 'text-blue-600'
          },
          {
            label: 'In Transit',
            value: deliveries.filter(d => d.status === 'in_transit').length,
            icon: Truck,
            color: 'text-yellow-600'
          },
          {
            label: 'Delivered Today',
            value: deliveries.filter(d => d.status === 'delivered' && 
              d.actualDelivery && 
              new Date(d.actualDelivery).toDateString() === new Date().toDateString()
            ).length,
            icon: CheckCircle,
            color: 'text-green-600'
          },
          {
            label: 'Overdue',
            value: deliveries.filter(d => calculateETA(d) === 'Overdue').length,
            icon: AlertCircle,
            color: 'text-red-600'
          }
        ].map((stat, index) => (
          <Card key={index}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                  <p className="text-3xl font-bold">{stat.value}</p>
                </div>
                <stat.icon className={`h-8 w-8 ${stat.color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}