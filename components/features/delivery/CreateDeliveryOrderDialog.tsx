'use client';

import { useState, useEffect } from 'react';
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
  X,
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

  // Dock audit state
  const [auditData, setAuditData] = useState([
    { id: 1, activity: "Documents", specified: "PDI report with latest drawing revision number", ok: false, value: "" },
    { id: 2, activity: "Cleaning", specified: "Free from dust stains", ok: false, value: "" },
    { id: 3, activity: "Oiling", specified: "All surfaces are covered, no excess oil", ok: false, value: "" },
    { id: 4, activity: "Stretch film cover packing", specified: "All surfaces are covered with Stretch film", ok: false, value: "" },
    { id: 5, activity: "VCI bag condition", specified: "Free from damage, No oil seepage", ok: false, value: "" },
    { id: 6, activity: "No. Of parts in each bag/packing", specified: "Verify part Qty", ok: false, value: "" },
    { id: 7, activity: "No. Of bags/packing", specified: "Verify no of bag / pack Qty", ok: false, value: "" },
    { id: 8, activity: "Sealing of VCI bag with adhesive tape", specified: "Free from gape", ok: false, value: "" },
    { id: 9, activity: "Identification Tag", specified: "Verify the part no, Description, Qty", ok: false, value: "" },
    { id: 10, activity: "Invoice", specified: "Verify the invoice as per PO", ok: false, value: "" },
    { id: 11, activity: "Whom & When", specified: "Verified by & Date of verification", ok: false, value: "" }
  ]);
  const [checkedBy, setCheckedBy] = useState('');

  // Debug: Monitor audit data changes
  useEffect(() => {
    console.log('🔍 Audit data changed:', {
      length: auditData?.length || 0,
      isArray: Array.isArray(auditData),
      sample: auditData?.[0],
      hasValidStructure: auditData?.every(item => item && typeof item === 'object' && 'id' in item && 'activity' in item)
    });
  }, [auditData]);

  // Form state
  const [deliveryMode, setDeliveryMode] = useState<string>('');
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

  // Delivery modes configuration
  const deliveryModes = [
    {
      value: 'express',
      label: 'Express Delivery',
      description: 'Next day delivery',
      carriers: ['fedex', 'dhl', 'ups', 'blue_dart']
    },
    {
      value: 'standard',
      label: 'Standard Delivery',
      description: '3-5 business days',
      carriers: ['fedex', 'dhl', 'ups', 'india_post', 'dtdc', 'blue_dart']
    },
    {
      value: 'economy',
      label: 'Economy Delivery',
      description: '5-7 business days',
      carriers: ['india_post', 'dtdc', 'professional_couriers']
    },
    {
      value: 'freight',
      label: 'Freight/Heavy',
      description: 'Large shipments',
      carriers: ['logistics_plus', 'cargo_express', 'transport_corp']
    }
  ];

  // Filter carriers based on selected delivery mode
  const getAvailableCarriers = () => {
    if (!deliveryMode) return [];
    
    const selectedMode = deliveryModes.find(mode => mode.value === deliveryMode);
    if (!selectedMode) return [];
    
    return carriers.filter(carrier => 
      selectedMode.carriers.includes(carrier.code?.toLowerCase()) || 
      selectedMode.carriers.includes(carrier.name.toLowerCase().replace(/\s+/g, '_'))
    );
  };

  // Handle delivery mode change
  const handleDeliveryModeChange = (newMode: string) => {
    setDeliveryMode(newMode);
    // Reset carrier when mode changes
    setFormData({ ...formData, carrierId: '' });
  };

  const resetForm = () => {
    setStep(1);
    setSelectedItems([]);
    setSearchTerm('');
    setDeliveryMode('');
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
    setAuditData([
      { id: 1, activity: "Documents", specified: "PDI report with latest drawing revision number", ok: false, value: "" },
      { id: 2, activity: "Cleaning", specified: "Free from dust stains", ok: false, value: "" },
      { id: 3, activity: "Oiling", specified: "All surfaces are covered, no excess oil", ok: false, value: "" },
      { id: 4, activity: "Stretch film cover packing", specified: "All surfaces are covered with Stretch film", ok: false, value: "" },
      { id: 5, activity: "VCI bag condition", specified: "Free from damage, No oil seepage", ok: false, value: "" },
      { id: 6, activity: "No. Of parts in each bag/packing", specified: "Verify part Qty", ok: false, value: "" },
      { id: 7, activity: "No. Of bags/packing", specified: "Verify no of bag / pack Qty", ok: false, value: "" },
      { id: 8, activity: "Sealing of VCI bag with adhesive tape", specified: "Free from gape", ok: false, value: "" },
      { id: 9, activity: "Identification Tag", specified: "Verify the part no, Description, Qty", ok: false, value: "" },
      { id: 10, activity: "Invoice", specified: "Verify the invoice as per PO", ok: false, value: "" },
      { id: 11, activity: "Whom & When", specified: "Verified by & Date of verification", ok: false, value: "" }
    ]);
    setCheckedBy('');
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
    // Ensure we're on the correct step
    if (step !== 5) {
      toast.error('Please complete all steps before submitting the order');
      return;
    }

    if (selectedItems.length === 0) {
      toast.error('Please select at least one item for delivery');
      return;
    }

    if (!formData.deliveryAddressId) {
      toast.error('Please select a delivery address');
      return;
    }

    // Validate dock audit completion
    const incompletedItems = auditData.filter(item => typeof item.ok !== 'boolean');
    if (incompletedItems.length > 0) {
      toast.error(`Please complete dock audit review for ${incompletedItems.length} items before submitting`);
      return;
    }

    if (!checkedBy.trim()) {
      toast.error('Please enter the inspector name in the dock audit section');
      return;
    }

    try {
      // Final validation - ensure dock audit data is complete
      if (!Array.isArray(auditData) || auditData.length === 0 || 
          !auditData.every(item => item && typeof item === 'object' && 'id' in item && 'activity' in item && typeof item.ok === 'boolean')) {
        console.error('🚨 Invalid dock audit data detected at submission:', auditData);
        toast.error('Dock audit data is incomplete. Please complete all audit items.');
        return;
      }

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
        dockAudit: auditData.map(item => ({
          id: item.id,
          activity: item.activity,
          specified: item.specified,
          ok: item.ok,
          value: item.value || ""
        })),
        checkedBy: checkedBy || undefined,
        items: selectedItems.map(item => ({
          qualityApprovedItemId: item.qualityApprovedItemId,
          bomItemId: item.bomItemId,
          approvedQuantity: item.approvedQuantity,
          deliveryQuantity: item.deliveryQuantity,
          packagingType: item.packagingType,
          unitValueInr: item.unitValueInr
        }))
      };

      console.log('🚀 Submitting order data:', orderData);
      console.log('📋 Dock audit data being sent:', auditData);
      console.log('🔍 Audit data structure check:', {
        isArray: Array.isArray(auditData),
        length: auditData.length,
        firstItem: auditData[0],
        hasValidStructure: auditData.every(item => item && typeof item === 'object' && 'id' in item && 'activity' in item),
        allItemsHaveOkValue: auditData.map((item, i) => ({ index: i, ok: item?.ok, type: typeof item?.ok })),
        checkedBy: checkedBy,
        step: step
      });

      await createOrderMutation.mutateAsync(orderData);
      onSuccess();
      resetForm();
    } catch (error) {
      // Error handling is done in the mutation
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
            Create Delivery Order - Step {step} of 5
          </DialogTitle>
          <DialogDescription>
            {step === 1 && 'Select quality-approved BOM parts from quality control'}
            {step === 2 && 'Upload part photos and packing documentation'}
            {step === 3 && 'Complete dock audit checklist'}
            {step === 4 && 'Configure delivery tracking and schedule'}
            {step === 5 && 'Review and confirm delivery order'}
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

        {/* Step 3: Dock Audit Checklist */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <CheckCircle className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium">Dock Audit Check Sheet</h3>
              <p className="text-sm text-muted-foreground">
                Complete the quality verification checklist before proceeding to delivery
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quality Verification Checklist</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {auditData.filter(item => typeof item.ok === 'boolean').length} / {auditData.length} items reviewed
                  {auditData.some(item => typeof item.ok !== 'boolean') && 
                    <span className="text-orange-600 ml-2 font-medium">
                      - {auditData.filter(item => typeof item.ok !== 'boolean').length} items need review
                    </span>
                  }
                </p>
              </CardHeader>
              <CardContent>
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
                        <tr key={item.id} className={`border-b border-border/30 ${typeof item.ok !== 'boolean' ? 'bg-yellow-50' : ''}`}>
                          <td className="p-2">{item.id}</td>
                          <td className="p-2 font-medium">{item.activity}</td>
                          <td className="p-2 text-muted-foreground">{item.specified}</td>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  const updated = [...auditData];
                                  updated[index].ok = true;
                                  setAuditData(updated);
                                }}
                                className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                                  item.ok === true
                                    ? 'bg-green-500 border-green-500 text-white'
                                    : 'border-border hover:border-green-500'
                                }`}
                              >
                                {item.ok === true && <CheckCircle className="w-3 h-3" />}
                              </button>
                              <button
                                onClick={() => {
                                  const updated = [...auditData];
                                  updated[index].ok = false;
                                  setAuditData(updated);
                                }}
                                className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                                  item.ok === false
                                    ? 'bg-red-500 border-red-500 text-white'
                                    : 'border-border hover:border-red-500'
                                }`}
                              >
                                {item.ok === false && <X className="w-3 h-3" />}
                              </button>
                            </div>
                          </td>
                          <td className="p-2">
                            <Input
                              value={item.value}
                              onChange={(e) => {
                                const updated = [...auditData];
                                updated[index].value = e.target.value;
                                setAuditData(updated);
                              }}
                              placeholder="Enter value"
                              className="w-full text-xs"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 pt-4 border-t border-border">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="checkedBy">Checked by:</Label>
                      <Input
                        id="checkedBy"
                        value={checkedBy}
                        onChange={(e) => setCheckedBy(e.target.value)}
                        placeholder="Enter inspector name"
                      />
                    </div>
                    <div className="flex items-end">
                      <div className="w-full">
                        <Label>Date:</Label>
                        <p className="text-sm text-foreground mt-1">
                          {new Date().toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 4: Tracking & Schedule Configuration */}
        {step === 4 && (
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
                <Label htmlFor="deliveryMode">Delivery Mode *</Label>
                <Select value={deliveryMode} onValueChange={handleDeliveryModeChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select delivery mode" />
                  </SelectTrigger>
                  <SelectContent className="z-[100]">
                    {deliveryModes.map((mode) => (
                      <SelectItem key={mode.value} value={mode.value}>
                        <div className="flex flex-col">
                          <span className="font-medium">{mode.label}</span>
                          <span className="text-xs text-muted-foreground">{mode.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Carrier & Handling Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="carrier">Preferred Carrier</Label>
                <Select 
                  value={formData.carrierId} 
                  onValueChange={(value) => setFormData({ ...formData, carrierId: value })}
                  disabled={!deliveryMode}
                >
                  <SelectTrigger>
                    <SelectValue 
                      placeholder={
                        !deliveryMode 
                          ? "Select delivery mode first" 
                          : carriersLoading 
                            ? "Loading carriers..." 
                            : "Select carrier (optional)"
                      } 
                    />
                  </SelectTrigger>
                  <SelectContent className="z-[100]">
                    {carriersError ? (
                      <SelectItem value="error" disabled>Error loading carriers</SelectItem>
                    ) : getAvailableCarriers().length === 0 ? (
                      <SelectItem value="empty" disabled>
                        {deliveryMode ? "No carriers available for this mode" : "Select delivery mode first"}
                      </SelectItem>
                    ) : (
                      getAvailableCarriers().map((carrier) => (
                        <SelectItem key={carrier.id} value={carrier.id}>
                          <div className="flex flex-col">
                            <span className="font-medium">{carrier.name}</span>
                            {carrier.code && (
                              <span className="text-xs text-muted-foreground">Code: {carrier.code}</span>
                            )}
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {deliveryMode && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Available for {deliveryModes.find(m => m.value === deliveryMode)?.label}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="specialHandling">Special Handling</Label>
                <Input 
                  id="specialHandling" 
                  placeholder="Fragile, temperature controlled, etc." 
                  value={formData.specialHandlingRequirements || ''}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    specialHandlingRequirements: e.target.value 
                  })}
                />
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
                  <Label htmlFor="deliveryMode">Delivery Mode *</Label>
                  <Select value={deliveryMode} onValueChange={handleDeliveryModeChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select delivery mode" />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {deliveryModes.map((mode) => (
                        <SelectItem key={mode.value} value={mode.value}>
                          <div className="flex flex-col">
                            <span className="font-medium">{mode.label}</span>
                            <span className="text-xs text-muted-foreground">{mode.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="carrier">Preferred Carrier</Label>
                  <Select 
                    value={formData.carrierId} 
                    onValueChange={(value) => setFormData({ ...formData, carrierId: value })}
                    disabled={!deliveryMode}
                  >
                    <SelectTrigger>
                      <SelectValue 
                        placeholder={
                          !deliveryMode 
                            ? "Select delivery mode first" 
                            : carriersLoading 
                              ? "Loading carriers..." 
                              : "Select carrier (optional)"
                        } 
                      />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {carriersError ? (
                        <SelectItem value="error" disabled>Error loading carriers</SelectItem>
                      ) : getAvailableCarriers().length === 0 ? (
                        <SelectItem value="empty" disabled>
                          {deliveryMode ? "No carriers available for this mode" : "Select delivery mode first"}
                        </SelectItem>
                      ) : (
                        getAvailableCarriers().map((carrier) => (
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

        {/* Step 5: Review & Confirm */}
        {step === 5 && (
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
                  {deliveryMode && (
                    <div>
                      <span className="text-sm text-muted-foreground">Delivery Mode:</span>
                      <p className="font-medium">
                        {deliveryModes.find(m => m.value === deliveryMode)?.label || 'Not selected'}
                      </p>
                    </div>
                  )}
                  {formData.carrierId && (
                    <div>
                      <span className="text-sm text-muted-foreground">Carrier:</span>
                      <p className="font-medium">
                        {getAvailableCarriers().find(c => c.id === formData.carrierId)?.name || 'Carrier not found'}
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

              {step < 5 ? (
                <Button
                  onClick={() => setStep(step + 1)}
                  disabled={
                    (step === 1 && selectedItems.length === 0) ||
                    (step === 2 && !selectedItems.every(item => item.partPhotos?.length && item.packingPhotos?.length)) ||
                    (step === 3 && (!checkedBy.trim() || auditData.some(item => typeof item.ok !== 'boolean'))) ||
                    (step === 4 && (!formData.deliveryAddressId || !formData.startDate || !formData.endDate))
                  }
                >
                  {step === 2 ? 'Photos Required' : step === 3 ? 'Complete Audit' : 'Next'}
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