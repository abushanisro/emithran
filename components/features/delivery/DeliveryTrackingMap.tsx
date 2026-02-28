'use client';

import { useState, useEffect, useCallback } from 'react';
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
  Route,
  AlertCircle,
  CheckCircle,
  Package,
  Phone,
  RefreshCw,
  Calendar,
  Filter,
  Download,
  Share,
  Bell,
} from 'lucide-react';
import { toast } from 'sonner';

// Types for tracking system
interface DeliveryLocation {
  id: string;
  lat: number;
  lng: number;
  timestamp: string;
  address: string;
  status: 'pickup' | 'transit' | 'delivered' | 'delayed' | 'failed';
  notes?: string;
  driverInfo?: {
    name: string;
    phone: string;
    vehicleNumber: string;
  };
}

interface DeliveryRoute {
  orderId: string;
  orderNumber: string;
  status: 'pending' | 'pickup' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failed';
  priority: 'low' | 'standard' | 'high' | 'urgent';
  estimatedDelivery: string;
  actualDelivery?: string;
  origin: {
    lat: number;
    lng: number;
    address: string;
  };
  destination: {
    lat: number;
    lng: number;
    address: string;
    contactPerson: string;
    contactPhone: string;
  };
  currentLocation?: {
    lat: number;
    lng: number;
    timestamp: string;
  };
  trackingHistory: DeliveryLocation[];
  carrier: {
    name: string;
    trackingNumber: string;
  };
  items: {
    partNumber: string;
    quantity: number;
    description: string;
  }[];
}

interface DeliveryTrackingMapProps {
  projectId: string;
  dateRange: {
    from: string;
    to: string;
  };
}

// Mock data generator for demonstration
const generateMockDeliveries = (count: number): DeliveryRoute[] => {
  const statuses: DeliveryRoute['status'][] = ['pending', 'pickup', 'in_transit', 'out_for_delivery', 'delivered'];
  const priorities: DeliveryRoute['priority'][] = ['low', 'standard', 'high', 'urgent'];
  const carriers = ['DHL', 'FedEx', 'Blue Dart', 'DTDC', 'Ecom Express'];
  
  return Array.from({ length: count }, (_, i) => ({
    orderId: `ord_${i + 1}`,
    orderNumber: `DO-2024-${String(i + 1).padStart(4, '0')}`,
    status: statuses[Math.floor(Math.random() * statuses.length)],
    priority: priorities[Math.floor(Math.random() * priorities.length)],
    estimatedDelivery: new Date(Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
    actualDelivery: Math.random() > 0.5 ? new Date().toISOString() : undefined,
    origin: {
      lat: 28.6139 + (Math.random() - 0.5) * 0.1,
      lng: 77.2090 + (Math.random() - 0.5) * 0.1,
      address: 'Manufacturing Hub, Sector 18, Gurgaon, Haryana'
    },
    destination: {
      lat: 28.5355 + (Math.random() - 0.5) * 0.5,
      lng: 77.3910 + (Math.random() - 0.5) * 0.5,
      address: `Customer Location ${i + 1}, Delhi NCR`,
      contactPerson: `Contact Person ${i + 1}`,
      contactPhone: `+91 98765${String(i).padStart(5, '0')}`
    },
    currentLocation: Math.random() > 0.3 ? {
      lat: 28.5355 + (Math.random() - 0.5) * 0.3,
      lng: 77.3910 + (Math.random() - 0.5) * 0.3,
      timestamp: new Date().toISOString()
    } : undefined,
    trackingHistory: [],
    carrier: {
      name: carriers[Math.floor(Math.random() * carriers.length)],
      trackingNumber: `TK${Math.random().toString(36).substring(2, 10).toUpperCase()}`
    },
    items: [
      {
        partNumber: `PT-${String(i + 1).padStart(3, '0')}`,
        quantity: Math.floor(Math.random() * 50) + 1,
        description: `Manufacturing Part ${i + 1}`
      }
    ]
  }));
};

export default function DeliveryTrackingMap({ 
  projectId, 
  dateRange 
}: DeliveryTrackingMapProps) {
  const [deliveries, setDeliveries] = useState<DeliveryRoute[]>([]);
  const [selectedDelivery, setSelectedDelivery] = useState<DeliveryRoute | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isLiveTracking, setIsLiveTracking] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>(new Date().toISOString());

  // Initialize with mock data
  useEffect(() => {
    const mockDeliveries = generateMockDeliveries(15);
    setDeliveries(mockDeliveries);
  }, [projectId]);

  // Simulate real-time updates
  useEffect(() => {
    if (!isLiveTracking) return;

    const interval = setInterval(() => {
      setDeliveries(prev => prev.map(delivery => {
        if (delivery.status === 'in_transit' || delivery.status === 'out_for_delivery') {
          return {
            ...delivery,
            currentLocation: delivery.currentLocation ? {
              lat: delivery.currentLocation.lat + (Math.random() - 0.5) * 0.01,
              lng: delivery.currentLocation.lng + (Math.random() - 0.5) * 0.01,
              timestamp: new Date().toISOString()
            } : delivery.currentLocation
          };
        }
        return delivery;
      }));
      setLastUpdate(new Date().toISOString());
    }, 10000); // Update every 10 seconds

    return () => clearInterval(interval);
  }, [isLiveTracking]);

  // Filter deliveries
  const filteredDeliveries = deliveries.filter(delivery => {
    const matchesStatus = filterStatus === 'all' || delivery.status === filterStatus;
    const matchesPriority = filterPriority === 'all' || delivery.priority === filterPriority;
    const matchesSearch = searchTerm === '' || 
      delivery.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      delivery.carrier.trackingNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      delivery.destination.contactPerson.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesStatus && matchesPriority && matchesSearch;
  });

  const getStatusColor = (status: DeliveryRoute['status']) => {
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

  const getPriorityColor = (priority: DeliveryRoute['priority']) => {
    const colors = {
      low: 'text-gray-600 bg-gray-100',
      standard: 'text-blue-600 bg-blue-100',
      high: 'text-orange-600 bg-orange-100',
      urgent: 'text-red-600 bg-red-100'
    };
    return colors[priority] || 'text-gray-600 bg-gray-100';
  };

  const calculateETA = (delivery: DeliveryRoute) => {
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

  const handleNotifyCustomer = (delivery: DeliveryRoute) => {
    toast.success(`Notification sent to ${delivery.destination.contactPerson}`);
  };

  const handleExportData = () => {
    const csvData = filteredDeliveries.map(d => ({
      'Order Number': d.orderNumber,
      'Status': d.status,
      'Priority': d.priority,
      'Customer': d.destination.contactPerson,
      'ETA': calculateETA(d),
      'Carrier': d.carrier.name,
      'Tracking Number': d.carrier.trackingNumber
    }));
    
    const csv = [
      Object.keys(csvData[0]).join(','),
      ...csvData.map(row => Object.values(row).join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `delivery-tracking-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    
    toast.success('Data exported successfully');
  };

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Real-time Delivery Tracking</h1>
          <p className="text-muted-foreground">
            Track deliveries from {new Date(dateRange.from).toLocaleDateString()} to {new Date(dateRange.to).toLocaleDateString()}
          </p>
        </div>
        
        <div className="flex gap-2">
          <Button
            variant={isLiveTracking ? "default" : "outline"}
            onClick={() => setIsLiveTracking(!isLiveTracking)}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isLiveTracking ? 'animate-spin' : ''}`} />
            {isLiveTracking ? 'Live' : 'Start Live'}
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
        <div className="lg:col-span-1 space-y-4">
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
                          {delivery.destination.contactPerson}
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
          {/* Map Placeholder */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Navigation className="h-5 w-5" />
                Real-time Map View
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-96 bg-muted rounded-lg flex items-center justify-center relative overflow-hidden">
                {/* Map Integration Instructions */}
                <div className="text-center p-8">
                  <MapPin className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-xl font-semibold mb-2">Interactive Map Integration</h3>
                  <p className="text-muted-foreground mb-4">
                    Integrate with Google Maps, OpenStreetMap, or Mapbox for real-time tracking
                  </p>
                  <div className="text-sm text-left bg-background p-4 rounded border">
                    <strong>Integration Options:</strong>
                    <ul className="list-disc list-inside mt-2 space-y-1">
                      <li><strong>Google Maps API:</strong> react-google-maps/api</li>
                      <li><strong>Mapbox:</strong> react-map-gl</li>
                      <li><strong>OpenStreetMap:</strong> react-leaflet</li>
                      <li><strong>HERE Maps:</strong> @here/maps-api-for-javascript</li>
                    </ul>
                  </div>
                </div>

                {/* Simulated pins for selected delivery */}
                {selectedDelivery && (
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-4 left-4 bg-green-500 text-white p-2 rounded-full shadow-lg">
                      <MapPin className="h-4 w-4" />
                    </div>
                    <div className="absolute bottom-4 right-4 bg-red-500 text-white p-2 rounded-full shadow-lg">
                      <MapPin className="h-4 w-4" />
                    </div>
                    {selectedDelivery.currentLocation && (
                      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-blue-500 text-white p-2 rounded-full shadow-lg animate-pulse">
                        <Truck className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                )}
              </div>
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
                    <Button size="sm" variant="outline">
                      <Phone className="h-4 w-4 mr-1" />
                      Call
                    </Button>
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
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <h4 className="font-medium">Customer Information</h4>
                        <div className="space-y-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">Contact:</span>
                            <div>{selectedDelivery.destination.contactPerson}</div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Phone:</span>
                            <div>{selectedDelivery.destination.contactPhone}</div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Address:</span>
                            <div>{selectedDelivery.destination.address}</div>
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
                            <br />
                            Coordinates: {selectedDelivery.currentLocation.lat.toFixed(4)}, {selectedDelivery.currentLocation.lng.toFixed(4)}
                          </div>
                        </div>
                      )}
                      
                      {/* Simulated tracking events */}
                      <div className="space-y-2">
                        {[
                          { time: '2 hours ago', event: 'Out for delivery', location: 'Last Mile Hub' },
                          { time: '4 hours ago', event: 'Arrived at destination city', location: 'Delhi Sort Facility' },
                          { time: '1 day ago', event: 'In transit', location: 'Gurgaon Hub' },
                          { time: '2 days ago', event: 'Picked up', location: 'Origin Warehouse' }
                        ].map((event, index) => (
                          <div key={index} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className="w-2 h-2 rounded-full bg-primary" />
                              {index < 3 && <div className="w-px h-6 bg-border" />}
                            </div>
                            <div className="flex-1 pb-4">
                              <div className="text-sm font-medium">{event.event}</div>
                              <div className="text-xs text-muted-foreground">{event.location}</div>
                              <div className="text-xs text-muted-foreground">{event.time}</div>
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
            value: deliveries.filter(d => d.status === 'delivered').length,
            icon: CheckCircle,
            color: 'text-green-600'
          },
          {
            label: 'Delayed',
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