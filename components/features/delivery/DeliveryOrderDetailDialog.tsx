import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useDeliveryOrder } from '@/lib/api/hooks/useDelivery';
import { DeliveryOrder } from '@/lib/api/hooks/useDelivery';
import { format } from 'date-fns';

interface DeliveryOrderDetailDialogProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
}

export const DeliveryOrderDetailDialog: React.FC<DeliveryOrderDetailDialogProps> = ({
  isOpen,
  onClose,
  orderId
}) => {
  const { data: order, isLoading, error } = useDeliveryOrder(orderId);

  if (error) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Error Loading Order</DialogTitle>
            <DialogDescription>
              Failed to load delivery order details. Please try again.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 text-center">
            <Button onClick={onClose}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (isLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Loading Order Details...</DialogTitle>
            <DialogDescription>
              Please wait while we fetch the delivery order information.
            </DialogDescription>
          </DialogHeader>
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!order) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Order Not Found</DialogTitle>
            <DialogDescription>
              The requested delivery order could not be found.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 text-center">
            <Button onClick={onClose}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-secondary/50 text-muted-foreground border border-border';
      case 'pending_approval': return 'bg-warning/20 text-warning border border-warning/30';
      case 'approved': return 'bg-success/20 text-success border border-success/30';
      case 'in_transit': return 'bg-primary/20 text-primary border border-primary/30';
      case 'out_for_delivery': return 'bg-primary/20 text-primary border border-primary/30';
      case 'delivered': return 'bg-success/20 text-success border border-success/30';
      case 'failed_delivery': return 'bg-destructive/20 text-destructive border border-destructive/30';
      case 'returned': return 'bg-warning/20 text-warning border border-warning/30';
      case 'cancelled': return 'bg-destructive/20 text-destructive border border-destructive/30';
      default: return 'bg-secondary/50 text-muted-foreground border border-border';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-destructive/20 text-destructive border border-destructive/30';
      case 'high': return 'bg-warning/20 text-warning border border-warning/30';
      case 'standard': return 'bg-primary/20 text-primary border border-primary/30';
      case 'low': return 'bg-secondary/50 text-muted-foreground border border-border';
      default: return 'bg-secondary/50 text-muted-foreground border border-border';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Delivery Order Details</span>
            <div className="flex gap-2">
              <Badge className={getStatusColor(order.status)}>
                {order.status.replace('_', ' ').toUpperCase()}
              </Badge>
              <Badge className={getPriorityColor(order.priority)}>
                {order.priority.toUpperCase()} PRIORITY
              </Badge>
            </div>
          </DialogTitle>
          <DialogDescription>
            Complete workflow information for {order.orderNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(90vh-120px)] overflow-y-auto custom-scrollbar">
          <div className="space-y-6 p-1">
            
            {/* Step 1: Basic Information */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-foreground">Step 1: Order Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-secondary/50 rounded-lg border border-border/50">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Order Number</p>
                  <p className="text-sm text-foreground font-mono">{order.orderNumber}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Project</p>
                  <p className="text-sm text-foreground">{order.projectName || order.projectId}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Created Date</p>
                  <p className="text-sm text-foreground">
                    {format(new Date(order.createdAt), 'MMM dd, yyyy at hh:mm a')}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Last Updated</p>
                  <p className="text-sm text-foreground">
                    {format(new Date(order.updatedAt), 'MMM dd, yyyy at hh:mm a')}
                  </p>
                </div>
                {order.inspectionId && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Inspection ID</p>
                    <p className="text-sm text-foreground font-mono">{order.inspectionId}</p>
                  </div>
                )}
                {order.notes && (
                  <div className="md:col-span-2">
                    <p className="text-sm font-medium text-muted-foreground">Notes</p>
                    <p className="text-sm text-foreground">{order.notes}</p>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Step 2: Selected Items */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-foreground">Step 2: Selected Items ({order.items?.length || 0})</h3>
              <div className="bg-secondary/30 border border-border/30 rounded-lg p-4">
                {order.items && order.items.length > 0 ? (
                  <div className="space-y-3">
                    {order.items.map((item: any, index: number) => (
                      <div key={index} className="flex justify-between items-start p-3 bg-card rounded border border-border">
                        <div className="flex-1">
                          <p className="font-medium text-foreground">
                            {item.partNumber || 'N/A'}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {item.description || 'No description available'}
                          </p>
                          {item.qcCertificateNumber && (
                            <p className="text-xs text-muted-foreground mt-1">
                              QC Certificate: {item.qcCertificateNumber}
                            </p>
                          )}
                        </div>
                        <div className="text-right ml-4">
                          <p className="font-medium text-foreground">
                            Qty: {item.deliveryQuantity}
                          </p>
                          {item.unitOfMeasure && (
                            <p className="text-sm text-muted-foreground">{item.unitOfMeasure}</p>
                          )}
                          {item.totalValueInr && (
                            <p className="text-sm text-success font-medium">
                              ₹{item.totalValueInr.toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                    
                    <div className="mt-4 p-3 bg-primary/10 rounded border-l-4 border-primary">
                      <div className="flex justify-between items-center">
                        <p className="font-medium text-primary">Summary</p>
                        <div className="text-right">
                          <p className="text-sm text-primary">Total Items: {order.itemsCount || order.items.length}</p>
                          {order.totalQuantity && (
                            <p className="text-sm text-primary">Total Quantity: {order.totalQuantity}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No items found for this order.</p>
                )}
              </div>
            </div>

            <Separator />

            {/* Step 3: Delivery Details */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-foreground">Step 3: Delivery Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Delivery Address */}
                <div className="p-4 bg-secondary/30 border border-border/30 rounded-lg">
                  <h4 className="font-medium text-foreground mb-3">Delivery Address</h4>
                  {order.deliveryAddress ? (
                    <div className="space-y-2">
                      <p className="font-medium text-foreground">{order.deliveryAddress.companyName}</p>
                      <p className="text-sm text-muted-foreground">{order.deliveryAddress.contactPerson}</p>
                      <p className="text-sm text-muted-foreground">{order.deliveryAddress.addressLine1}</p>
                      {order.deliveryAddress.addressLine2 && (
                        <p className="text-sm text-muted-foreground">{order.deliveryAddress.addressLine2}</p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        {order.deliveryAddress.city}, {order.deliveryAddress.stateProvince} {order.deliveryAddress.postalCode}
                      </p>
                      <p className="text-sm text-muted-foreground">{order.deliveryAddress.country}</p>
                      {order.deliveryAddress.contactPhone && (
                        <p className="text-sm text-muted-foreground">📞 {order.deliveryAddress.contactPhone}</p>
                      )}
                      {order.deliveryAddress.contactEmail && (
                        <p className="text-sm text-muted-foreground">✉️ {order.deliveryAddress.contactEmail}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No delivery address information available</p>
                  )}
                </div>

                {/* Delivery Schedule */}
                <div className="p-4 bg-secondary/30 border border-border/30 rounded-lg">
                  <h4 className="font-medium text-foreground mb-3">Delivery Schedule</h4>
                  <div className="space-y-2">
                    {order.requestedDeliveryDate && (
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Requested Date</p>
                        <p className="text-sm text-foreground">
                          {format(new Date(order.requestedDeliveryDate), 'MMM dd, yyyy')}
                        </p>
                      </div>
                    )}
                    {order.estimatedDeliveryDate && (
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Estimated Date</p>
                        <p className="text-sm text-foreground">
                          {format(new Date(order.estimatedDeliveryDate), 'MMM dd, yyyy')}
                        </p>
                      </div>
                    )}
                    {order.actualDeliveryDate && (
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Actual Date</p>
                        <p className="text-sm text-foreground">
                          {format(new Date(order.actualDeliveryDate), 'MMM dd, yyyy')}
                        </p>
                      </div>
                    )}
                    {order.deliveryWindowStart && order.deliveryWindowEnd && (
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Delivery Window</p>
                        <p className="text-sm text-foreground">
                          {order.deliveryWindowStart} - {order.deliveryWindowEnd}
                        </p>
                      </div>
                    )}
                    {!order.requestedDeliveryDate && !order.estimatedDeliveryDate && (
                      <p className="text-muted-foreground text-sm">No delivery schedule information available</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Special Instructions */}
              {(order.deliveryInstructions || order.specialHandlingRequirements) && (
                <div className="p-4 bg-warning/10 rounded-lg border-l-4 border-warning">
                  <h4 className="font-medium text-warning mb-2">Special Instructions</h4>
                  <div className="space-y-1">
                    {order.deliveryInstructions && (
                      <p className="text-sm text-warning">{order.deliveryInstructions}</p>
                    )}
                    {order.specialHandlingRequirements && (
                      <p className="text-sm text-warning">Special Handling: {order.specialHandlingRequirements}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Step 4: Costs & Carrier */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-foreground">Step 4: Costs & Shipping</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Carrier Information */}
                <div className="p-4 bg-secondary/30 border border-border/30 rounded-lg">
                  <h4 className="font-medium text-foreground mb-3">Carrier Information</h4>
                  {order.carrier ? (
                    <div className="space-y-2">
                      <p className="font-medium text-foreground">{order.carrier.name}</p>
                      <p className="text-sm text-muted-foreground">Code: {order.carrier.code}</p>
                      {order.trackingNumber && (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Tracking Number</p>
                          <p className="text-sm text-foreground font-mono">{order.trackingNumber}</p>
                        </div>
                      )}
                      {order.carrierReference && (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Carrier Reference</p>
                          <p className="text-sm text-foreground">{order.carrierReference}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No carrier assigned yet</p>
                  )}
                </div>

                {/* Cost Breakdown */}
                <div className="p-4 bg-secondary/30 border border-border/30 rounded-lg">
                  <h4 className="font-medium text-foreground mb-3">Cost Breakdown</h4>
                  <div className="space-y-2">
                    {(order.deliveryCostInr !== null && order.deliveryCostInr !== undefined) && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Delivery Cost:</span>
                        <span className="text-sm text-foreground">₹{order.deliveryCostInr.toLocaleString()}</span>
                      </div>
                    )}
                    {(order.insuranceCostInr !== null && order.insuranceCostInr !== undefined) && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Insurance Cost:</span>
                        <span className="text-sm text-foreground">₹{order.insuranceCostInr.toLocaleString()}</span>
                      </div>
                    )}
                    {(order.handlingCostInr !== null && order.handlingCostInr !== undefined) && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Handling Cost:</span>
                        <span className="text-sm text-foreground">₹{order.handlingCostInr.toLocaleString()}</span>
                      </div>
                    )}
                    {(order.totalDeliveryCostInr !== null && order.totalDeliveryCostInr !== undefined) && (
                      <div className="flex justify-between font-medium pt-2 border-t">
                        <span className="text-foreground">Total Cost:</span>
                        <span className="text-foreground">₹{order.totalDeliveryCostInr.toLocaleString()}</span>
                      </div>
                    )}
                    {(order.deliveryCostInr === null || order.deliveryCostInr === undefined) && 
                     (order.totalDeliveryCostInr === null || order.totalDeliveryCostInr === undefined) && (
                      <p className="text-muted-foreground text-sm">No cost information available</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Package Information */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {order.packageCount && (
                  <div className="text-center p-3 bg-primary/10 rounded">
                    <p className="text-2xl font-bold text-primary">{order.packageCount}</p>
                    <p className="text-sm text-primary">Packages</p>
                  </div>
                )}
                {order.totalWeightKg && (
                  <div className="text-center p-3 bg-success/10 rounded">
                    <p className="text-2xl font-bold text-success">{order.totalWeightKg}kg</p>
                    <p className="text-sm text-success">Total Weight</p>
                  </div>
                )}
                {order.totalVolumeM3 && (
                  <div className="text-center p-3 bg-primary/10 rounded">
                    <p className="text-2xl font-bold text-primary">{order.totalVolumeM3}m³</p>
                    <p className="text-sm text-primary">Total Volume</p>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Route & Transport Information */}
            {(order.transportMode || order.materialType || order.routeDistanceKm || order.transportCostInr) && (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-foreground">Route & Transport Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  
                  {/* Transport Details */}
                  <div className="p-4 bg-secondary/30 border border-border/30 rounded-lg">
                    <h4 className="font-medium text-foreground mb-3">Transport Details</h4>
                    <div className="space-y-2">
                      {order.transportMode && (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Transport Mode</p>
                          <p className="text-sm text-foreground capitalize">{order.transportMode}</p>
                        </div>
                      )}
                      {order.materialType && (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Material Type</p>
                          <p className="text-sm text-foreground">{order.materialType}</p>
                        </div>
                      )}
                      {order.routeType && (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Route Type</p>
                          <p className="text-sm text-foreground capitalize">{order.routeType}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Route Information */}
                  <div className="p-4 bg-secondary/30 border border-border/30 rounded-lg">
                    <h4 className="font-medium text-foreground mb-3">Route Information</h4>
                    <div className="space-y-2">
                      {order.routeDistanceKm && (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Distance</p>
                          <p className="text-sm text-foreground">{order.routeDistanceKm.toFixed(1)} km</p>
                        </div>
                      )}
                      {order.routeTravelTimeMinutes && (
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">Travel Time</p>
                          <p className="text-sm text-foreground">{Math.round(order.routeTravelTimeMinutes / 60)} hours {order.routeTravelTimeMinutes % 60} minutes</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Detailed Cost Breakdown */}
                {(order.transportCostInr || order.loadingCostInr || order.fuelTollCostInr) && (
                  <div className="p-4 bg-secondary/30 border border-border/30 rounded-lg">
                    <h4 className="font-medium text-foreground mb-3">Detailed Cost Breakdown</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {order.transportCostInr && (
                        <div className="text-center">
                          <p className="text-lg font-bold text-primary">₹{order.transportCostInr.toLocaleString()}</p>
                          <p className="text-sm text-muted-foreground">Transport Base</p>
                        </div>
                      )}
                      {order.loadingCostInr && (
                        <div className="text-center">
                          <p className="text-lg font-bold text-warning">₹{order.loadingCostInr.toLocaleString()}</p>
                          <p className="text-sm text-muted-foreground">Loading/Unloading</p>
                        </div>
                      )}
                      {order.fuelTollCostInr && (
                        <div className="text-center">
                          <p className="text-lg font-bold text-success">₹{order.fuelTollCostInr.toLocaleString()}</p>
                          <p className="text-sm text-muted-foreground">Fuel & Toll Surcharge</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <Separator />

            {/* Step 5: Documentation & Quality */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-foreground">Step 5: Documentation & Quality</h3>
              
              {/* Parts Photos */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-secondary/30 border border-border/30 rounded-lg">
                  <h4 className="font-medium text-foreground mb-3">Parts Photos</h4>
                  <p className="text-sm text-muted-foreground mb-2">Visual documentation of parts</p>
                  {/* TODO: Display uploaded photos if available */}
                  <div className="text-center py-4 border-2 border-dashed border-border rounded-lg">
                    <p className="text-xs text-muted-foreground">No photos uploaded</p>
                  </div>
                </div>

                {/* Packing Photos */}
                <div className="p-4 bg-secondary/30 border border-border/30 rounded-lg">
                  <h4 className="font-medium text-foreground mb-3">Packing Photos</h4>
                  <p className="text-sm text-muted-foreground mb-2">Documentation of packaging</p>
                  {/* TODO: Display uploaded photos if available */}
                  <div className="text-center py-4 border-2 border-dashed border-border rounded-lg">
                    <p className="text-xs text-muted-foreground">No photos uploaded</p>
                  </div>
                </div>

                {/* Documents */}
                <div className="p-4 bg-secondary/30 border border-border/30 rounded-lg">
                  <h4 className="font-medium text-foreground mb-3">Documents</h4>
                  <p className="text-sm text-muted-foreground mb-2">Supporting documentation</p>
                  {/* TODO: Display uploaded documents if available */}
                  <div className="text-center py-4 border-2 border-dashed border-border rounded-lg">
                    <p className="text-xs text-muted-foreground">No documents uploaded</p>
                  </div>
                </div>
              </div>

              {/* Dock Audit Check Sheet */}
              <div className="p-4 bg-secondary/30 border border-border/30 rounded-lg">
                <h4 className="font-medium text-foreground mb-3">Dock Audit Check Sheet</h4>
                {(() => {
                  const defaultAuditItems = [
                    { id: 1, activity: "Documents", specified: "PDI report with latest drawing revision number" },
                    { id: 2, activity: "Cleaning", specified: "Free from dust stains" },
                    { id: 3, activity: "Oiling", specified: "All surfaces are covered, no excess oil" },
                    { id: 4, activity: "Stretch film cover packing", specified: "All surfaces are covered with Stretch film" },
                    { id: 5, activity: "VCI bag condition", specified: "Free from damage, No oil seepage" },
                    { id: 6, activity: "No. Of parts in each bag/packing", specified: "Verify part Qty" },
                    { id: 7, activity: "No. Of bags/packing", specified: "Verify no of bag / pack Qty" },
                    { id: 8, activity: "Sealing of VCI bag with adhesive tape", specified: "Free from gape" },
                    { id: 9, activity: "Identification Tag", specified: "Verify the part no, Description, Qty" },
                    { id: 10, activity: "Invoice", specified: "Verify the invoice as per PO" },
                    { id: 11, activity: "Whom & When", specified: "Verified by & Date of verification" }
                  ];
                  
                  // Handle saved dock audit data - merge with default items
                  let auditData = defaultAuditItems;
                  
                  if (order.dockAudit && Array.isArray(order.dockAudit) && order.dockAudit.length > 0) {
                    // Check if the saved data has proper structure
                    const firstItem = order.dockAudit[0];
                    if (firstItem && firstItem.activity && firstItem.specified) {
                      // Use saved data directly
                      auditData = order.dockAudit;
                    } else {
                      // Saved data exists but is incomplete, merge with defaults
                      auditData = defaultAuditItems.map(defaultItem => {
                        const savedItem = order.dockAudit.find((item: any) => item.id === defaultItem.id);
                        return {
                          ...defaultItem,
                          ok: savedItem?.ok || '',
                          value: savedItem?.value || ''
                        };
                      });
                    }
                  }
                  
                  const completedItems = auditData.filter(item => item.ok === 'yes' || item.ok === true).length;
                  const totalItems = auditData.length;
                  
                  return (
                    <>
                      <div className="text-sm text-muted-foreground mb-4">
                        Quality verification checklist - {completedItems} / {totalItems} items completed
                      </div>
                      
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left p-2 text-muted-foreground">S.No</th>
                              <th className="text-left p-2 text-muted-foreground">Activity</th>
                              <th className="text-left p-2 text-muted-foreground">Specified</th>
                              <th className="text-left p-2 text-muted-foreground">OK</th>
                              <th className="text-left p-2 text-muted-foreground">Value</th>
                            </tr>
                          </thead>
                          <tbody className="text-foreground">
                            {auditData.map((item, index) => (
                              <tr key={item.id || index + 1} className="border-b border-border/30">
                                <td className="p-2">{item.id || index + 1}</td>
                                <td className="p-2">{item.activity || `Item ${index + 1}`}</td>
                                <td className="p-2 text-muted-foreground">{item.specified || 'No specification'}</td>
                                <td className="p-2">
                                  {item.ok === 'yes' || item.ok === true ? (
                                    <div className="w-4 h-4 bg-success rounded border border-success flex items-center justify-center">
                                      <div className="w-2 h-2 bg-white rounded-sm"></div>
                                    </div>
                                  ) : item.ok === 'no' || item.ok === false ? (
                                    <div className="w-4 h-4 bg-destructive rounded border border-destructive"></div>
                                  ) : (
                                    <div className="w-4 h-4 border border-border rounded"></div>
                                  )}
                                </td>
                                <td className="p-2 text-muted-foreground">{item.value || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  );
                })()}

                <div className="mt-4 pt-4 border-t border-border">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">Checked by:</p>
                      <p className="text-sm text-foreground">{order.checkedBy || 'Not specified'}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">Date:</p>
                      <p className="text-sm text-foreground">
                        {order.checkedAt ? format(new Date(order.checkedAt), 'MMM dd, yyyy') : 'Not specified'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        <div className="flex justify-end space-x-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {order.trackingNumber && (
            <Button 
              onClick={() => {
                // Open tracking in a new window/tab
                window.open(`https://track.example.com/${order.trackingNumber}`, '_blank');
              }}
            >
              Track Package
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};