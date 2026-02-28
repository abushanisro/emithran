'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Plus,
  Package,
  Truck,
  CheckCircle,
  Trash2,
  Camera,
  Upload,
  Image,
  PlayCircle,
} from 'lucide-react';
import {
  QualityApprovedItem,
  useCreateDeliveryOrder,
  useDeliveryAddresses,
  useCarriers
} from '@/lib/api/hooks/useDelivery';
import { toast } from 'sonner';

interface CreateDeliveryOrderDialogProps {
  projectId: string;
  availableItems: QualityApprovedItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface SelectedItem {
  qualityApprovedItemId: string;
  bomItemId: string;
  partNumber: string;
  description: string;
  approvedQuantity: number;
  deliveryQuantity: number;
  unitValueInr?: number;
  packagingType?: string;
  notes?: string;
  partPhotos?: File[];
  packingPhotos?: File[];
}

export default function CreateDeliveryOrderDialog({
  projectId,
  availableItems,
  open,
  onOpenChange,
  onSuccess
}: CreateDeliveryOrderDialogProps) {
  const [step, setStep] = useState(1);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    priority: 'standard' as 'low' | 'standard' | 'high' | 'urgent',
    requestedDeliveryDate: '',
    deliveryWindowStart: '',
    deliveryWindowEnd: '',
    deliveryAddressId: '',
    billingAddressId: '',
    carrierId: '',
    packageCount: 1,
    specialHandlingRequirements: '',
    deliveryInstructions: '',
    deliveryCostInr: 0,
    insuranceCostInr: 0,
    handlingCostInr: 0,
    notes: '',
    startDate: '',
    endDate: '',
    trackingEnabled: true
  });

  // API hooks
  const createOrderMutation = useCreateDeliveryOrder();
  const { data: addresses = [], isLoading: addressesLoading, error: addressesError } = useDeliveryAddresses(projectId);
  const { data: carriers = [], isLoading: carriersLoading, error: carriersError } = useCarriers();

  const resetForm = () => {
    setStep(1);
    setSelectedItems([]);
    setSearchTerm('');
    setFormData({
      priority: 'standard',
      requestedDeliveryDate: '',
      deliveryWindowStart: '',
      deliveryWindowEnd: '',
      deliveryAddressId: '',
      billingAddressId: '',
      carrierId: '',
      packageCount: 1,
      specialHandlingRequirements: '',
      deliveryInstructions: '',
      deliveryCostInr: 0,
      insuranceCostInr: 0,
      handlingCostInr: 0,
      notes: '',
      startDate: '',
      endDate: '',
      trackingEnabled: true
    });
  };

  const filteredItems = availableItems.filter(item =>
    !searchTerm ||
    item.bomItem.partNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.bomItem.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const addItem = (item: QualityApprovedItem) => {
    const newItem: SelectedItem = {
      qualityApprovedItemId: item.id,
      bomItemId: item.bomItemId,
      partNumber: item.bomItem.partNumber,
      description: item.bomItem.description,
      approvedQuantity: item.approvedQuantity,
      deliveryQuantity: item.approvedQuantity,
      unitValueInr: item.bomItem.unitCost || 0,
      packagingType: 'standard'
    };
    setSelectedItems([...selectedItems, newItem]);
  };

  const removeItem = (index: number) => {
    setSelectedItems(selectedItems.filter((_, i) => i !== index));
  };

  const updateItemQuantity = (index: number, quantity: number) => {
    const updated = [...selectedItems];
    const item = updated[index];
    if (!item) return;
    item.deliveryQuantity = Math.min(quantity, item.approvedQuantity);
    setSelectedItems(updated);
  };

  const updateItemPackaging = (index: number, packagingType: string) => {
    const updated = [...selectedItems];
    const item = updated[index];
    if (!item) return;
    item.packagingType = packagingType;
    setSelectedItems(updated);
  };

  const calculateTotals = () => {
    const totalValue = selectedItems.reduce((sum, item) =>
      sum + (item.deliveryQuantity * (item.unitValueInr || 0)), 0
    );
    const totalQuantity = selectedItems.reduce((sum, item) => sum + item.deliveryQuantity, 0);
    const totalCost = formData.deliveryCostInr + formData.insuranceCostInr + formData.handlingCostInr;

    return { totalValue, totalQuantity, totalCost };
  };

  const handleSubmit = async () => {
    if (selectedItems.length === 0) {
      toast.error('Please select at least one item for delivery');
      return;
    }

    if (!formData.deliveryAddressId) {
      toast.error('Please select a delivery address');
      return;
    }

    try {
      const orderData = {
        projectId,
        deliveryAddressId: formData.deliveryAddressId,
        billingAddressId: formData.billingAddressId || formData.deliveryAddressId,
        carrierId: formData.carrierId || undefined,
        priority: formData.priority,
        requestedDeliveryDate: formData.requestedDeliveryDate || undefined,
        deliveryWindowStart: formData.deliveryWindowStart || undefined,
        deliveryWindowEnd: formData.deliveryWindowEnd || undefined,
        packageCount: formData.packageCount,
        specialHandlingRequirements: formData.specialHandlingRequirements || undefined,
        deliveryInstructions: formData.deliveryInstructions || undefined,
        deliveryCostInr: formData.deliveryCostInr || undefined,
        insuranceCostInr: formData.insuranceCostInr || undefined,
        handlingCostInr: formData.handlingCostInr || undefined,
        notes: formData.notes || undefined,
        items: selectedItems.map(item => ({
          qualityApprovedItemId: item.qualityApprovedItemId,
          bomItemId: item.bomItemId,
          approvedQuantity: item.approvedQuantity,
          deliveryQuantity: item.deliveryQuantity,
          packagingType: item.packagingType,
          unitValueInr: item.unitValueInr
        }))
      };

      await createOrderMutation.mutateAsync(orderData);
      onSuccess();
      resetForm();
    } catch (error) {
      // Error handling is done in the mutation
      console.error('Failed to create delivery order:', error);
    }
  };

  const { totalValue, totalQuantity, totalCost } = calculateTotals();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Create Delivery Order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Create Delivery Order - Step {step} of 4
          </DialogTitle>
          <DialogDescription>
            {step === 1 && 'Select quality-approved BOM parts from quality control'}
            {step === 2 && 'Upload part photos and packing documentation'}
            {step === 3 && 'Configure delivery tracking and schedule'}
            {step === 4 && 'Review and confirm delivery order'}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Item Selection */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium">Available Items</h3>
                <p className="text-sm text-muted-foreground">
                  {availableItems.length} quality-approved items ready for delivery
                </p>
              </div>
              <Input
                placeholder="Search items..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-64"
              />
            </div>

            {/* Selected Items Summary */}
            {selectedItems.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Selected Items ({selectedItems.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {selectedItems.map((item, index) => (
                      <div key={index} className="flex items-center justify-between p-2 border rounded">
                        <div>
                          <p className="font-medium">{item.partNumber}</p>
                          <p className="text-sm text-muted-foreground">{item.description}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">Qty: {item.deliveryQuantity}</Badge>
                          <Button size="sm" variant="ghost" onClick={() => removeItem(index)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Available Items List */}
            <div className="grid gap-3 max-h-96 overflow-y-auto">
              {filteredItems.map((item) => {
                const isSelected = selectedItems.some(si => si.qualityApprovedItemId === item.id);

                return (
                  <Card key={item.id} className={isSelected ? 'opacity-50' : 'hover:shadow-sm'}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium">{item.bomItem.partNumber}</h4>
                            <Badge variant="secondary">QC Approved</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{item.bomItem.description}</p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>Available: {item.approvedQuantity} {item.bomItem.unitOfMeasure}</span>
                            <span>Value: ₹{item.bomItem.unitCost?.toLocaleString() || 0}</span>
                            {item.qcCertificateNumber && (
                              <span>Cert: {item.qcCertificateNumber}</span>
                            )}
                          </div>
                        </div>

                        <Button
                          onClick={() => addItem(item)}
                          disabled={isSelected}
                          size="sm"
                        >
                          {isSelected ? 'Selected' : 'Add'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {filteredItems.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <p>No items available for delivery</p>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Photo Documentation */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <Camera className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium">Photo Documentation Required</h3>
              <p className="text-sm text-muted-foreground">
                Please upload part photos and packing photos for each selected item
              </p>
            </div>

            <div className="space-y-4">
              {selectedItems.map((item, index) => (
                <Card key={index}>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Package className="h-4 w-4" />
                      {item.partNumber} - {item.description}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Part Photos */}
                      <div>
                        <Label className="flex items-center gap-2 mb-2">
                          <Image className="h-4 w-4" />
                          Part Photos *
                        </Label>
                        <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-4 text-center">
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            id={`part-photos-${index}`}
                            onChange={(e) => {
                              if (e.target.files) {
                                const files = Array.from(e.target.files);
                                const updated = [...selectedItems];
                                const updatedItem = updated[index];
                                if (!updatedItem) return;
                                updatedItem.partPhotos = files;
                                setSelectedItems(updated);
                              }
                            }}
                          />
                          <label htmlFor={`part-photos-${index}`} className="cursor-pointer">
                            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">
                              Click to upload part photos
                            </p>
                          </label>
                          {item.partPhotos && item.partPhotos.length > 0 && (
                            <div className="mt-2">
                              <Badge variant="secondary">
                                {item.partPhotos.length} photos uploaded
                              </Badge>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Packing Photos */}
                      <div>
                        <Label className="flex items-center gap-2 mb-2">
                          <Package className="h-4 w-4" />
                          Packing Photos *
                        </Label>
                        <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-4 text-center">
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            id={`packing-photos-${index}`}
                            onChange={(e) => {
                              if (e.target.files) {
                                const files = Array.from(e.target.files);
                                const updated = [...selectedItems];
                                const updatedItem = updated[index];
                                if (!updatedItem) return;
                                updatedItem.packingPhotos = files;
                                setSelectedItems(updated);
                              }
                            }}
                          />
                          <label htmlFor={`packing-photos-${index}`} className="cursor-pointer">
                            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">
                              Click to upload packing photos
                            </p>
                          </label>
                          {item.packingPhotos && item.packingPhotos.length > 0 && (
                            <div className="mt-2">
                              <Badge variant="secondary">
                                {item.packingPhotos.length} photos uploaded
                              </Badge>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Quality Control Information */}
                    <Card className="bg-muted/50">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <CheckCircle className="h-5 w-5 text-green-600 mt-1" />
                          <div>
                            <h4 className="font-medium">Quality Control Approved</h4>
                            <p className="text-sm text-muted-foreground">
                              Approved Qty: {item.approvedQuantity} {" "}
                              {item.description?.includes('Certificate') ?
                                `• QC Certificate: ${item.qualityApprovedItemId.slice(-8)}` : ''}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Tracking & Schedule Configuration */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Tracking System */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <Truck className="h-5 w-5" />
                  Delivery Tracking
                </h3>

                <div>
                  <Label htmlFor="startDate">Start Date *</Label>
                  <Input
                    type="datetime-local"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  />
                </div>

                <div>
                  <Label htmlFor="endDate">Expected End Date *</Label>
                  <Input
                    type="datetime-local"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  />
                </div>

                <Card className="bg-blue-50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <PlayCircle className="h-5 w-5 text-green-600" />
                        <span className="font-medium">Tracking System</span>
                      </div>
                      <Badge variant="secondary">Enabled</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      Real-time tracking will be enabled for this delivery order
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Basic Details */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Delivery Details</h3>

                <div>
                  <Label htmlFor="priority">Priority</Label>
                  <Select value={formData.priority} onValueChange={(value: any) => setFormData({ ...formData, priority: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="deliveryDate">Requested Delivery Date</Label>
                  <Input
                    type="date"
                    value={formData.requestedDeliveryDate}
                    onChange={(e) => setFormData({ ...formData, requestedDeliveryDate: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Delivery Window Start</Label>
                    <Input
                      type="time"
                      value={formData.deliveryWindowStart}
                      onChange={(e) => setFormData({ ...formData, deliveryWindowStart: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Delivery Window End</Label>
                    <Input
                      type="time"
                      value={formData.deliveryWindowEnd}
                      onChange={(e) => setFormData({ ...formData, deliveryWindowEnd: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Address & Carrier */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="deliveryAddress">Delivery Address *</Label>
                <Select value={formData.deliveryAddressId} onValueChange={(value) => setFormData({ ...formData, deliveryAddressId: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder={addressesLoading ? "Loading addresses..." : "Select delivery address"} />
                  </SelectTrigger>
                  <SelectContent className="z-[100]">
                    {addressesError ? (
                      <SelectItem value="error" disabled>Error loading addresses</SelectItem>
                    ) : addresses.length === 0 ? (
                      <SelectItem value="empty" disabled>No addresses available - Add one first</SelectItem>
                    ) : (
                      addresses.map((address) => (
                        <SelectItem key={address.id} value={address.id!}>
                          {address.companyName || address.contactPerson} - {address.city}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {addresses.length === 0 && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Use the Address Manager to add delivery addresses for your project
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="carrier">Preferred Carrier</Label>
                <Select value={formData.carrierId} onValueChange={(value) => setFormData({ ...formData, carrierId: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder={carriersLoading ? "Loading carriers..." : "Select carrier"} />
                  </SelectTrigger>
                  <SelectContent className="z-[100]">
                    {carriersError ? (
                      <SelectItem value="error" disabled>Error loading carriers</SelectItem>
                    ) : carriers.length === 0 ? (
                      <SelectItem value="empty" disabled>No carriers available</SelectItem>
                    ) : (
                      carriers.map((carrier) => (
                        <SelectItem key={carrier.id} value={carrier.id}>
                          {carrier.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Review & Confirm */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Basic Details */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Delivery Details</h3>

                <div>
                  <Label htmlFor="priority">Priority</Label>
                  <Select value={formData.priority} onValueChange={(value: any) => setFormData({ ...formData, priority: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="deliveryDate">Requested Delivery Date</Label>
                  <Input
                    type="date"
                    value={formData.requestedDeliveryDate}
                    onChange={(e) => setFormData({ ...formData, requestedDeliveryDate: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Delivery Window Start</Label>
                    <Input
                      type="time"
                      value={formData.deliveryWindowStart}
                      onChange={(e) => setFormData({ ...formData, deliveryWindowStart: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Delivery Window End</Label>
                    <Input
                      type="time"
                      value={formData.deliveryWindowEnd}
                      onChange={(e) => setFormData({ ...formData, deliveryWindowEnd: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Address & Carrier */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Logistics</h3>

                <div>
                  <Label htmlFor="deliveryAddress">Delivery Address *</Label>
                  <Select value={formData.deliveryAddressId} onValueChange={(value) => setFormData({ ...formData, deliveryAddressId: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder={addressesLoading ? "Loading addresses..." : "Select delivery address"} />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {addressesError ? (
                        <SelectItem value="error" disabled>Error loading addresses</SelectItem>
                      ) : addresses.length === 0 ? (
                        <SelectItem value="empty" disabled>No addresses available</SelectItem>
                      ) : (
                        addresses.map((address) => (
                          <SelectItem key={address.id} value={address.id!}>
                            {address.companyName || address.contactPerson} - {address.city}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="carrier">Preferred Carrier</Label>
                  <Select value={formData.carrierId} onValueChange={(value) => setFormData({ ...formData, carrierId: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder={carriersLoading ? "Loading carriers..." : "Select carrier"} />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {carriersError ? (
                        <SelectItem value="error" disabled>Error loading carriers</SelectItem>
                      ) : carriers.length === 0 ? (
                        <SelectItem value="empty" disabled>No carriers available</SelectItem>
                      ) : (
                        carriers.map((carrier) => (
                          <SelectItem key={carrier.id} value={carrier.id}>
                            {carrier.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="packages">Number of Packages</Label>
                  <Input
                    type="number"
                    min="1"
                    value={formData.packageCount}
                    onChange={(e) => setFormData({ ...formData, packageCount: parseInt(e.target.value) || 1 })}
                  />
                </div>
              </div>
            </div>

            {/* Item Details Configuration */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Item Configuration</h3>

              <div className="space-y-3">
                {selectedItems.map((item, index) => (
                  <Card key={index}>
                    <CardContent className="p-4">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                          <h4 className="font-medium">{item.partNumber}</h4>
                          <p className="text-sm text-muted-foreground">{item.description}</p>
                        </div>

                        <div>
                          <Label>Delivery Quantity</Label>
                          <Input
                            type="number"
                            min="1"
                            max={item.approvedQuantity}
                            value={item.deliveryQuantity}
                            onChange={(e) => updateItemQuantity(index, parseInt(e.target.value) || 1)}
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Max: {item.approvedQuantity}
                          </p>
                        </div>

                        <div>
                          <Label>Packaging Type</Label>
                          <Select value={item.packagingType} onValueChange={(value) => updateItemPackaging(index, value)}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="standard">Standard</SelectItem>
                              <SelectItem value="fragile">Fragile</SelectItem>
                              <SelectItem value="hazmat">Hazmat</SelectItem>
                              <SelectItem value="temperature_controlled">Temperature Controlled</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label>Unit Value</Label>
                          <Input
                            type="number"
                            value={item.unitValueInr || 0}
                            onChange={(e) => {
                              const updated = [...selectedItems];
                              const updatedItem = updated[index];
                              if (!updatedItem) return;
                              updatedItem.unitValueInr = parseFloat(e.target.value) || 0;
                              setSelectedItems(updated);
                            }}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Additional Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="specialHandling">Special Handling Requirements</Label>
                <Textarea
                  placeholder="Any special handling instructions..."
                  value={formData.specialHandlingRequirements}
                  onChange={(e) => setFormData({ ...formData, specialHandlingRequirements: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="deliveryInstructions">Delivery Instructions</Label>
                <Textarea
                  placeholder="Instructions for the delivery team..."
                  value={formData.deliveryInstructions}
                  onChange={(e) => setFormData({ ...formData, deliveryInstructions: e.target.value })}
                />
              </div>
            </div>

            {/* Cost Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="deliveryCost">Delivery Cost (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.deliveryCostInr}
                  onChange={(e) => setFormData({ ...formData, deliveryCostInr: parseFloat(e.target.value) || 0 })}
                />
              </div>

              <div>
                <Label htmlFor="insuranceCost">Insurance Cost (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.insuranceCostInr}
                  onChange={(e) => setFormData({ ...formData, insuranceCostInr: parseFloat(e.target.value) || 0 })}
                />
              </div>

              <div>
                <Label htmlFor="handlingCost">Handling Cost (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.handlingCostInr}
                  onChange={(e) => setFormData({ ...formData, handlingCostInr: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Review & Confirm */}
        {step === 3 && (
          <div className="space-y-6">
            {/* Order Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Order Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-600">{selectedItems.length}</p>
                    <p className="text-sm text-muted-foreground">Items</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-600">{totalQuantity}</p>
                    <p className="text-sm text-muted-foreground">Total Quantity</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-purple-600">₹{totalValue.toLocaleString()}</p>
                    <p className="text-sm text-muted-foreground">Items Value</p>
                  </div>
                </div>

                {totalCost > 0 && (
                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center">
                      <span>Delivery Charges:</span>
                      <span>₹{totalCost.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center font-bold text-lg">
                      <span>Total Cost:</span>
                      <span>₹{(totalValue + totalCost).toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Selected Items List */}
            <Card>
              <CardHeader>
                <CardTitle>Items to Deliver</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {selectedItems.map((item, index) => (
                    <div key={index} className="flex items-center justify-between p-2 border rounded">
                      <div>
                        <p className="font-medium">{item.partNumber}</p>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">Qty: {item.deliveryQuantity}</p>
                        <p className="text-sm text-muted-foreground">
                          ₹{((item.unitValueInr || 0) * item.deliveryQuantity).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Order Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Delivery Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span>Priority:</span>
                    <Badge>{formData.priority.charAt(0).toUpperCase() + formData.priority.slice(1)}</Badge>
                  </div>
                  {formData.requestedDeliveryDate && (
                    <div className="flex justify-between">
                      <span>Requested Date:</span>
                      <span>{new Date(formData.requestedDeliveryDate).toLocaleDateString()}</span>
                    </div>
                  )}
                  {formData.deliveryWindowStart && formData.deliveryWindowEnd && (
                    <div className="flex justify-between">
                      <span>Delivery Window:</span>
                      <span>{formData.deliveryWindowStart} - {formData.deliveryWindowEnd}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Packages:</span>
                    <span>{formData.packageCount}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Logistics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div>
                    <span className="text-sm text-muted-foreground">Delivery Address:</span>
                    <p className="font-medium">
                      {addresses.find(a => a.id === formData.deliveryAddressId)?.companyName ||
                        addresses.find(a => a.id === formData.deliveryAddressId)?.contactPerson ||
                        'Address not found'}
                    </p>
                  </div>
                  {formData.carrierId && (
                    <div>
                      <span className="text-sm text-muted-foreground">Carrier:</span>
                      <p className="font-medium">
                        {carriers.find(c => c.id === formData.carrierId)?.name || 'Carrier not found'}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        <DialogFooter>
          <div className="flex justify-between items-center w-full">
            <div>
              {step > 1 && (
                <Button variant="outline" onClick={() => setStep(step - 1)}>
                  Back
                </Button>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>

              {step < 4 ? (
                <Button
                  onClick={() => setStep(step + 1)}
                  disabled={
                    (step === 1 && selectedItems.length === 0) ||
                    (step === 2 && !selectedItems.every(item => item.partPhotos?.length && item.packingPhotos?.length)) ||
                    (step === 3 && (!formData.deliveryAddressId || !formData.startDate || !formData.endDate))
                  }
                >
                  {step === 2 ? 'Photos Required' : 'Next'}
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={createOrderMutation.isPending}
                >
                  {createOrderMutation.isPending ? 'Creating...' : 'Create Order'}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}