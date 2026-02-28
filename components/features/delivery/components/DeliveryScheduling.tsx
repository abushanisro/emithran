'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Calendar, 
  Clock, 
  Factory, 
  Package, 
  CheckCircle, 
  AlertTriangle,
  Plus,
  Search,
  Filter,
  MoreVertical,
  Edit,
  Truck
} from 'lucide-react';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DeliveryBatch } from '@/lib/api/hooks/useDelivery';

interface DeliverySchedulingProps {
  projectId: string;
  batches: DeliveryBatch[];
  onScheduleUpdate: () => void;
}

export default function DeliveryScheduling({ projectId, batches, onScheduleUpdate }: DeliverySchedulingProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const filteredBatches = batches.filter(batch => {
    const matchesSearch = !searchTerm || 
      batch.batchNumber.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = !statusFilter || statusFilter === 'all' || batch.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getBatchStatusBadge = (status: string) => {
    const statusConfig = {
      'production': { color: 'bg-blue-100 text-blue-800', label: 'Production', icon: Factory },
      'qc_review': { color: 'bg-yellow-100 text-yellow-800', label: 'QC Review', icon: AlertTriangle },
      'pending': { color: 'bg-orange-100 text-orange-800', label: 'Pending', icon: Clock },
      'ready_for_shipment': { color: 'bg-green-100 text-green-800', label: 'Ready for Shipment', icon: CheckCircle },
      'shipped': { color: 'bg-purple-100 text-purple-800', label: 'Shipped', icon: Truck },
      'delivered': { color: 'bg-green-100 text-green-800', label: 'Delivered', icon: CheckCircle }
    };

    const config = statusConfig[status] || statusConfig['pending'];
    const Icon = config.icon;

    return (
      <Badge className={`${config.color} flex items-center gap-1 text-xs`}>
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const getStatusProgress = (status: string) => {
    const statusOrder = ['production', 'qc_review', 'pending', 'ready_for_shipment', 'shipped', 'delivered'];
    const currentIndex = statusOrder.indexOf(status);
    return ((currentIndex + 1) / statusOrder.length) * 100;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Delivery Scheduling</h2>
          <p className="text-sm text-muted-foreground">Plan and schedule delivery timelines</p>
        </div>
        <Button className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Schedule Delivery
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search batches..."
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
                <SelectItem value="production">Production</SelectItem>
                <SelectItem value="qc_review">QC Review</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="ready_for_shipment">Ready for Shipment</SelectItem>
                <SelectItem value="shipped">Shipped</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Batches Grid */}
      <div className="grid gap-4">
        {filteredBatches.map((batch) => (
          <Card key={batch.id} className="hover:shadow-md transition-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-lg">{batch.batchNumber}</CardTitle>
                    {getBatchStatusBadge(batch.status)}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Package className="h-4 w-4" />
                      <span>{batch.itemCount} items</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span>Value: ₹{batch.totalValue?.toLocaleString() || '0'}</span>
                    </div>
                    {batch.expectedCompletion && (
                      <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        <span>Expected: {new Date(batch.expectedCompletion).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-9 w-9 p-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>
                        <Edit className="h-4 w-4 mr-2" />
                        Edit Schedule
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Package className="h-4 w-4 mr-2" />
                        View Items
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Truck className="h-4 w-4 mr-2" />
                        Create Shipment
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
                    <span className="font-medium">Progress</span>
                    <span className="text-muted-foreground">{Math.round(getStatusProgress(batch.status))}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${getStatusProgress(batch.status)}%` }}
                    />
                  </div>
                </div>

                {/* Status Details */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="font-medium text-muted-foreground">Current Status</p>
                    <p className="capitalize">{batch.status.replace('_', ' ')}</p>
                  </div>
                  {batch.completedAt ? (
                    <div>
                      <p className="font-medium text-muted-foreground">Completed</p>
                      <p>{new Date(batch.completedAt).toLocaleDateString()}</p>
                    </div>
                  ) : batch.expectedCompletion ? (
                    <div>
                      <p className="font-medium text-muted-foreground">Expected Completion</p>
                      <p>{new Date(batch.expectedCompletion).toLocaleDateString()}</p>
                    </div>
                  ) : null}
                </div>

                {batch.notes && (
                  <div>
                    <p className="font-medium text-muted-foreground text-sm">Notes</p>
                    <p className="text-sm">{batch.notes}</p>
                  </div>
                )}

                {/* Quick Actions */}
                <div className="flex gap-2 pt-2 border-t">
                  {batch.status === 'ready_for_shipment' && (
                    <Button size="sm" className="flex items-center gap-1">
                      <Truck className="h-3 w-3" />
                      Schedule Shipment
                    </Button>
                  )}
                  {batch.status === 'production' && (
                    <Button size="sm" variant="outline" className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Update Timeline
                    </Button>
                  )}
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

      {filteredBatches.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Factory className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Production Batches</h3>
            <p className="text-muted-foreground mb-4">
              No production batches found matching your criteria.
            </p>
            <Button className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create Production Batch
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}