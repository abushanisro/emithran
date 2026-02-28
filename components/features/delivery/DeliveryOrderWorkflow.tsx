'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  ArrowRight,
  ArrowLeft,
  Search,
  Package,
  MapPin,
  Truck,
  CheckCircle,
  Plus,
  Building,
  Phone,
  Mail,
  Calendar,
  Clock,
  AlertCircle,
  FileText,
} from 'lucide-react';
import {
  QualityApprovedItem,
  useAvailableItemsForDelivery,
  useCreateDeliveryOrder,
  useDeliveryAddresses,
  useCarriers,
  useCreateDeliveryAddress,
  DeliveryAddress,
} from '@/lib/api/hooks/useDelivery';
import { toast } from 'sonner';

interface DeliveryOrderWorkflowProps {
  projectId: string;
  onComplete?: () => void;
}

interface SelectedItem extends QualityApprovedItem {
  deliveryQuantity: number;
  notes?: string;
}

interface OrderFormData {
  priority: 'low' | 'standard' | 'high' | 'urgent';
  requestedDeliveryDate: string;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  deliveryAddressId: string;
  carrierId: string;
  specialHandling: string;
  deliveryInstructions: string;
  estimatedCost: number;
  notes: string;
}

const WORKFLOW_STEPS = [
  { id: 1, title: 'Select Items', description: 'Choose quality-approved BOM parts' },
  { id: 2, title: 'Delivery Details', description: 'Set delivery address and schedule' },
  { id: 3, title: 'Carrier & Logistics', description: 'Select carrier and shipping options' },
  { id: 4, title: 'Review & Submit', description: 'Confirm order details' },
];

// Indian States for address form
const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim',
  'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal', 'Delhi', 'Jammu and Kashmir', 'Ladakh'
];

export default function DeliveryOrderWorkflow({ 
  projectId, 
  onComplete 
}: DeliveryOrderWorkflowProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddAddress, setShowAddAddress] = useState(false);
  
  const [formData, setFormData] = useState<OrderFormData>({
    priority: 'standard',
    requestedDeliveryDate: '',
    deliveryWindowStart: '',
    deliveryWindowEnd: '',
    deliveryAddressId: '',
    carrierId: '',
    specialHandling: '',
    deliveryInstructions: '',
    estimatedCost: 0,
    notes: ''
  });

  const [newAddress, setNewAddress] = useState<Partial<DeliveryAddress>>({
    projectId,
    addressType: 'delivery',
    country: 'India',
  });

  // API Hooks
  const { data: availableItems = [], isLoading: itemsLoading, error: itemsError } = useAvailableItemsForDelivery(projectId);
  const { data: addresses = [], isLoading: addressesLoading, refetch: refetchAddresses } = useDeliveryAddresses(projectId);
  const { data: carriers = [], isLoading: carriersLoading } = useCarriers();
  const createOrderMutation = useCreateDeliveryOrder();
  const createAddressMutation = useCreateDeliveryAddress();

  // Filter available items based on search
  const filteredItems = availableItems.filter(item =>
    item.bomItem.partNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.bomItem.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calculate total estimated cost
  useEffect(() => {
    const totalCost = selectedItems.reduce((sum, item) => 
      sum + (item.bomItem.unitCost * item.deliveryQuantity), 0
    );
    setFormData(prev => ({ ...prev, estimatedCost: totalCost }));
  }, [selectedItems]);

  const handleAddItem = (item: QualityApprovedItem) => {
    const existingItem = selectedItems.find(si => si.id === item.id);
    if (existingItem) {
      toast.warning('Item already added to delivery order');
      return;
    }

    const selectedItem: SelectedItem = {
      ...item,
      deliveryQuantity: Math.min(item.approvedQuantity, 1)
    };
    
    setSelectedItems(prev => [...prev, selectedItem]);
    toast.success(`Added ${item.bomItem.partNumber} to delivery order`);
  };

  const handleRemoveItem = (itemId: string) => {
    setSelectedItems(prev => prev.filter(item => item.id !== itemId));
    toast.info('Item removed from delivery order');
  };

  const handleQuantityChange = (itemId: string, quantity: number) => {
    setSelectedItems(prev => prev.map(item => 
      item.id === itemId 
        ? { ...item, deliveryQuantity: Math.min(quantity, item.approvedQuantity) }
        : item
    ));
  };

  const handleCreateAddress = async () => {
    // Enhanced validation for Indian addresses
    const requiredFields = {
      contactPerson: 'Contact person',
      addressLine1: 'Address line 1', 
      city: 'City',
      stateProvince: 'State',
      postalCode: 'PIN code'
    };

    const missingFields = Object.entries(requiredFields).filter(
      ([field, label]) => !newAddress[field as keyof DeliveryAddress]
    );

    if (missingFields.length > 0) {
      toast.error(`Please fill required fields: ${missingFields.map(([_, label]) => label).join(', ')}`);
      return;
    }

    // Validate PIN code format
    if (newAddress.postalCode && !validatePincode(newAddress.postalCode)) {
      toast.error('Please enter a valid 6-digit PIN code');
      return;
    }

    // Validate phone if provided
    if (newAddress.contactPhone && !validatePhone(newAddress.contactPhone)) {
      toast.error('Please enter a valid Indian mobile number');
      return;
    }

    try {
      const createdAddress = await createAddressMutation.mutateAsync(newAddress as DeliveryAddress);
      await refetchAddresses();
      
      if (createdAddress?.id) {
        setFormData(prev => ({ ...prev, deliveryAddressId: createdAddress.id! }));
        toast.success('✅ Delivery address created successfully! You can now proceed to the next step.');
      } else {
        // Fallback: refetch addresses and use the most recent one
        const { data: addressesData } = await refetchAddresses();
        const mostRecentAddress = addressesData?.[0];
        if (mostRecentAddress?.id) {
          setFormData(prev => ({ ...prev, deliveryAddressId: mostRecentAddress.id! }));
          toast.success('✅ Delivery address created successfully! You can now proceed to the next step.');
        } else {
          toast.error('Address was created but could not be selected. Please refresh and try again.');
        }
      }
      
      setShowAddAddress(false);
      setNewAddress({ projectId, addressType: 'delivery', country: 'India' });
    } catch (error) {
      console.error('Address creation error:', error);
      toast.error('Failed to create address. Please try again.');
    }
  };

  const handleSubmitOrder = async () => {
    if (selectedItems.length === 0) {
      toast.error('Please select at least one item');
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
        carrierId: formData.carrierId || undefined,
        priority: formData.priority,
        requestedDeliveryDate: formData.requestedDeliveryDate || undefined,
        deliveryWindowStart: formData.deliveryWindowStart || undefined,
        deliveryWindowEnd: formData.deliveryWindowEnd || undefined,
        specialHandlingRequirements: formData.specialHandling || undefined,
        deliveryInstructions: formData.deliveryInstructions || undefined,
        notes: formData.notes || undefined,
        items: selectedItems.map(item => ({
          qualityApprovedItemId: item.id,
          bomItemId: item.bomItemId,
          approvedQuantity: item.approvedQuantity,
          deliveryQuantity: item.deliveryQuantity,
          qcCertificateNumber: item.qcCertificateNumber || undefined,
        }))
      };

      await createOrderMutation.mutateAsync(orderData);
      toast.success('Delivery order created successfully!');
      onComplete?.();
      
      // Reset form
      setCurrentStep(1);
      setSelectedItems([]);
      setFormData({
        priority: 'standard',
        requestedDeliveryDate: '',
        deliveryWindowStart: '',
        deliveryWindowEnd: '',
        deliveryAddressId: '',
        carrierId: '',
        specialHandling: '',
        deliveryInstructions: '',
        estimatedCost: 0,
        notes: ''
      });
    } catch (error) {
      toast.error('Failed to create delivery order');
    }
  };

  const canProceedToStep = (step: number) => {
    switch (step) {
      case 2: return selectedItems.length > 0;
      case 3: return selectedItems.length > 0 && formData.deliveryAddressId;
      case 4: return selectedItems.length > 0 && formData.deliveryAddressId;
      default: return true;
    }
  };

  const validatePincode = (pincode: string) => /^[1-9][0-9]{5}$/.test(pincode);
  const validatePhone = (phone: string) => /^[6-9]\d{9}$/.test(phone.replace(/\D/g, ''));

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Progress Indicator */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-6">Create Delivery Order</h1>
        
        <div className="flex items-center justify-between">
          {WORKFLOW_STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
                step.id === currentStep 
                  ? 'border-primary bg-primary text-white' 
                  : step.id < currentStep
                  ? 'border-green-500 bg-green-500 text-white'
                  : 'border-gray-300 text-gray-500'
              }`}>
                {step.id < currentStep ? (
                  <CheckCircle className="h-5 w-5" />
                ) : (
                  <span className="text-sm font-medium">{step.id}</span>
                )}
              </div>
              
              <div className="ml-3 hidden sm:block">
                <p className={`text-sm font-medium ${
                  step.id === currentStep ? 'text-primary' : 
                  step.id < currentStep ? 'text-green-600' : 'text-gray-500'
                }`}>
                  Step {step.id} of {WORKFLOW_STEPS.length}
                </p>
                <p className={`text-xs ${
                  step.id === currentStep ? 'text-primary' : 
                  step.id < currentStep ? 'text-green-600' : 'text-gray-500'
                }`}>
                  {step.title}
                </p>
              </div>
              
              {index < WORKFLOW_STEPS.length - 1 && (
                <ArrowRight className={`mx-4 h-5 w-5 ${
                  step.id < currentStep ? 'text-green-500' : 'text-gray-300'
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {WORKFLOW_STEPS[currentStep - 1].title}
          </CardTitle>
          <p className="text-muted-foreground">
            {WORKFLOW_STEPS[currentStep - 1].description}
          </p>
        </CardHeader>

        <CardContent>
          {/* Step 1: Select Items */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search items by part number or description..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Badge variant="secondary">
                  {availableItems.length} quality-approved items ready for delivery
                </Badge>
              </div>

              {itemsError ? (
                <div className="text-center py-8 text-red-600">
                  <AlertCircle className="h-12 w-12 mx-auto mb-4" />
                  <p>Error loading items: {itemsError.message}</p>
                </div>
              ) : itemsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="animate-pulse bg-muted h-24 rounded-lg" />
                  ))}
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-4" />
                  <p>No quality-approved items found</p>
                  {searchTerm && <p className="text-sm">Try adjusting your search</p>}
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {filteredItems.map((item) => (
                    <Card key={item.id} className="border">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <h3 className="font-semibold text-lg">{item.bomItem.partNumber}</h3>
                            <Badge variant="outline" className="text-green-600 border-green-600 mb-2">
                              QC Approved
                            </Badge>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleAddItem(item)}
                            disabled={selectedItems.some(si => si.id === item.id)}
                          >
                            {selectedItems.some(si => si.id === item.id) ? 'Added' : 'Add'}
                          </Button>
                        </div>
                        
                        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                          {item.bomItem.description}
                        </p>
                        
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Available:</span>
                            <p className="font-medium">{item.approvedQuantity} pcs</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Value:</span>
                            <p className="font-medium">₹{item.bomItem.unitCost}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Cert:</span>
                            <p className="font-medium text-xs">{item.qcCertificateNumber || 'N/A'}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {selectedItems.length > 0 && (
                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle>Selected Items ({selectedItems.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {selectedItems.map((item) => (
                        <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex-1">
                            <h4 className="font-medium">{item.bomItem.partNumber}</h4>
                            <p className="text-sm text-muted-foreground">{item.bomItem.description}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <Label htmlFor={`qty-${item.id}`}>Qty:</Label>
                            <Input
                              id={`qty-${item.id}`}
                              type="number"
                              min="1"
                              max={item.approvedQuantity}
                              value={item.deliveryQuantity}
                              onChange={(e) => handleQuantityChange(item.id, parseInt(e.target.value))}
                              className="w-20"
                            />
                            <span className="text-sm text-muted-foreground">/ {item.approvedQuantity}</span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleRemoveItem(item.id)}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    <Separator className="my-4" />
                    
                    <div className="flex justify-between items-center">
                      <span className="font-medium">Total Estimated Value:</span>
                      <span className="text-xl font-bold">₹{formData.estimatedCost.toLocaleString('en-IN')}</span>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Step 2: Delivery Details */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="deliveryAddress">Delivery Address *</Label>
                    <Dialog open={showAddAddress} onOpenChange={setShowAddAddress}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="flex items-center gap-2">
                          <Plus className="h-4 w-4" />
                          Add New Address
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Add New Delivery Address</DialogTitle>
                          <DialogDescription>
                            Create a new delivery address for this project. Fields marked with * are required.
                          </DialogDescription>
                        </DialogHeader>
                        
                        <div className="grid gap-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <Label htmlFor="companyName">Company Name</Label>
                              <Input
                                id="companyName"
                                value={newAddress.companyName || ''}
                                onChange={(e) => setNewAddress(prev => ({ ...prev, companyName: e.target.value }))}
                                placeholder="Company name"
                              />
                            </div>
                            <div>
                              <Label htmlFor="contactPerson">Contact Person *</Label>
                              <Input
                                id="contactPerson"
                                value={newAddress.contactPerson || ''}
                                onChange={(e) => setNewAddress(prev => ({ ...prev, contactPerson: e.target.value }))}
                                placeholder="Contact person name"
                                className={!newAddress.contactPerson ? 'border-red-300 focus:border-red-500' : ''}
                              />
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <Label htmlFor="contactPhone">Phone</Label>
                              <Input
                                id="contactPhone"
                                value={newAddress.contactPhone || ''}
                                onChange={(e) => setNewAddress(prev => ({ ...prev, contactPhone: e.target.value }))}
                                placeholder="+91 98765 43210"
                              />
                            </div>
                            <div>
                              <Label htmlFor="contactEmail">Email</Label>
                              <Input
                                id="contactEmail"
                                type="email"
                                value={newAddress.contactEmail || ''}
                                onChange={(e) => setNewAddress(prev => ({ ...prev, contactEmail: e.target.value }))}
                                placeholder="email@example.com"
                              />
                            </div>
                          </div>
                          
                          <div>
                            <Label htmlFor="addressLine1">Address Line 1 *</Label>
                            <Input
                              id="addressLine1"
                              value={newAddress.addressLine1 || ''}
                              onChange={(e) => setNewAddress(prev => ({ ...prev, addressLine1: e.target.value }))}
                              placeholder="Building number, street name"
                              className={!newAddress.addressLine1 ? 'border-red-300 focus:border-red-500' : ''}
                            />
                          </div>
                          
                          <div>
                            <Label htmlFor="addressLine2">Address Line 2</Label>
                            <Input
                              id="addressLine2"
                              value={newAddress.addressLine2 || ''}
                              onChange={(e) => setNewAddress(prev => ({ ...prev, addressLine2: e.target.value }))}
                              placeholder="Landmark, area (optional)"
                            />
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <Label htmlFor="city">City *</Label>
                              <Input
                                id="city"
                                value={newAddress.city || ''}
                                onChange={(e) => setNewAddress(prev => ({ ...prev, city: e.target.value }))}
                                placeholder="City name"
                                className={!newAddress.city ? 'border-red-300 focus:border-red-500' : ''}
                              />
                            </div>
                            <div>
                              <Label htmlFor="state">State *</Label>
                              <Select
                                value={newAddress.stateProvince || ''}
                                onValueChange={(value) => setNewAddress(prev => ({ ...prev, stateProvince: value }))}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select state" />
                                </SelectTrigger>
                                <SelectContent>
                                  {INDIAN_STATES.map((state) => (
                                    <SelectItem key={state} value={state}>{state}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label htmlFor="postalCode">PIN Code *</Label>
                              <Input
                                id="postalCode"
                                value={newAddress.postalCode || ''}
                                onChange={(e) => setNewAddress(prev => ({ ...prev, postalCode: e.target.value }))}
                                placeholder="110001"
                                maxLength={6}
                                className={!newAddress.postalCode || !validatePincode(newAddress.postalCode) ? 'border-red-300 focus:border-red-500' : ''}
                              />
                              {newAddress.postalCode && !validatePincode(newAddress.postalCode) && (
                                <p className="text-sm text-red-600 mt-1">Enter a valid 6-digit PIN code</p>
                              )}
                            </div>
                          </div>
                          
                          <div>
                            <Label htmlFor="instructions">Delivery Instructions</Label>
                            <Textarea
                              id="instructions"
                              value={newAddress.specialInstructions || ''}
                              onChange={(e) => setNewAddress(prev => ({ ...prev, specialInstructions: e.target.value }))}
                              placeholder="Special delivery instructions..."
                              rows={3}
                            />
                          </div>
                        </div>
                        
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" onClick={() => setShowAddAddress(false)}>
                            Cancel
                          </Button>
                          <Button
                            onClick={handleCreateAddress}
                            disabled={createAddressMutation.isPending}
                            className="min-w-[120px]"
                          >
                            {createAddressMutation.isPending ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Creating...
                              </>
                            ) : (
                              <>
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Create Address
                              </>
                            )}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                  
                  {/* Address Selection Cards */}
                  <div>
                    {addresses.length === 0 ? (
                      <div className="p-6 border-2 border-dashed border-gray-300 rounded-lg text-center">
                        <div className="flex flex-col items-center gap-2 text-gray-500">
                          <AlertCircle className="h-8 w-8" />
                          <span className="font-medium">No delivery addresses found</span>
                          <p className="text-sm">Create your first delivery address to continue</p>
                          <Button 
                            size="sm" 
                            className="mt-2"
                            onClick={() => setShowAddAddress(true)}
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            Add Delivery Address Now
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {addresses.map((address) => (
                          <div
                            key={address.id}
                            className={`relative p-4 border-2 rounded-lg cursor-pointer transition-all duration-200 hover:shadow-md ${
                              formData.deliveryAddressId === address.id
                                ? 'border-blue-500 bg-blue-50/80 shadow-sm ring-1 ring-blue-200'
                                : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50/50'
                            }`}
                            onClick={() => setFormData(prev => ({ ...prev, deliveryAddressId: address.id! }))}
                          >
                            {/* Selection indicator */}
                            <div className="absolute top-3 right-3">
                              <div className={`w-4 h-4 rounded-full border-2 transition-all ${
                                formData.deliveryAddressId === address.id
                                  ? 'border-blue-500 bg-blue-500'
                                  : 'border-gray-300'
                              }`}>
                                {formData.deliveryAddressId === address.id && (
                                  <div className="w-full h-full rounded-full bg-blue-500 flex items-center justify-center">
                                    <div className="w-1.5 h-1.5 rounded-full bg-white" />
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Company/Contact header */}
                            <div className="pr-6 mb-3">
                              <div className="flex items-start gap-2 mb-2">
                                <div className="flex-1">
                                  <h3 className="font-semibold text-sm text-gray-900 leading-tight">
                                    {address.companyName || address.contactPerson}
                                  </h3>
                                  {address.companyName && address.contactPerson && (
                                    <p className="text-xs text-gray-600 mt-1 leading-tight">
                                      Contact: {address.contactPerson}
                                    </p>
                                  )}
                                </div>
                                {address.isDefault && (
                                  <Badge variant="default" className="text-xs bg-green-100 text-green-800 border-green-200 shrink-0">
                                    Default
                                  </Badge>
                                )}
                              </div>
                            </div>

                            {/* Address */}
                            <div className="space-y-2 mb-3">
                              <div className="text-xs text-gray-700 leading-relaxed">
                                <div className="break-words">{address.addressLine1}</div>
                                {address.addressLine2 && (
                                  <div className="break-words mt-1">{address.addressLine2}</div>
                                )}
                              </div>
                              <div className="text-xs font-medium text-gray-800">
                                {address.city}, {address.stateProvince} {address.postalCode}
                              </div>
                              <div className="text-xs text-gray-500 uppercase tracking-wide">
                                {address.country}
                              </div>
                            </div>

                            {/* Contact info */}
                            <div className="space-y-2 mb-3">
                              {address.contactPhone && (
                                <div className="flex items-center gap-2 text-xs text-gray-600">
                                  <span className="text-blue-500 shrink-0">📞</span>
                                  <span className="break-words">{address.contactPhone}</span>
                                </div>
                              )}
                              {address.contactEmail && (
                                <div className="flex items-center gap-2 text-xs text-gray-600">
                                  <span className="text-blue-500 shrink-0">✉️</span>
                                  <span className="break-words">{address.contactEmail}</span>
                                </div>
                              )}
                            </div>

                            {/* Special instructions */}
                            {address.specialInstructions && (
                              <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded">
                                <div className="flex items-start gap-2">
                                  <span className="text-yellow-600 text-xs shrink-0">💡</span>
                                  <div className="flex-1">
                                    <p className="text-xs font-medium text-yellow-800 mb-1">Note:</p>
                                    <p className="text-xs text-yellow-700 break-words leading-relaxed">{address.specialInstructions}</p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <Label htmlFor="priority">Priority</Label>
                  <Select
                    value={formData.priority}
                    onValueChange={(value: any) => setFormData(prev => ({ ...prev, priority: value }))}
                  >
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
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="requestedDate">Requested Delivery Date</Label>
                  <Input
                    id="requestedDate"
                    type="date"
                    value={formData.requestedDeliveryDate}
                    onChange={(e) => setFormData(prev => ({ ...prev, requestedDeliveryDate: e.target.value }))}
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
                
                <div>
                  <Label htmlFor="windowStart">Delivery Window Start</Label>
                  <Input
                    id="windowStart"
                    type="time"
                    value={formData.deliveryWindowStart}
                    onChange={(e) => setFormData(prev => ({ ...prev, deliveryWindowStart: e.target.value }))}
                  />
                </div>
                
                <div>
                  <Label htmlFor="windowEnd">Delivery Window End</Label>
                  <Input
                    id="windowEnd"
                    type="time"
                    value={formData.deliveryWindowEnd}
                    onChange={(e) => setFormData(prev => ({ ...prev, deliveryWindowEnd: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="deliveryInstructions">Delivery Instructions</Label>
                <Textarea
                  id="deliveryInstructions"
                  value={formData.deliveryInstructions}
                  onChange={(e) => setFormData(prev => ({ ...prev, deliveryInstructions: e.target.value }))}
                  placeholder="Special delivery instructions, access codes, preferred delivery location..."
                  rows={3}
                />
              </div>
            </div>
          )}

          {/* Step 3: Carrier & Logistics */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label htmlFor="carrier">Preferred Carrier</Label>
                  <Select
                    value={formData.carrierId}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, carrierId: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={carriersLoading ? "Loading carriers..." : "Select carrier (optional)"} />
                    </SelectTrigger>
                    <SelectContent>
                      {carriers.length === 0 ? (
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
                  <Label htmlFor="specialHandling">Special Handling</Label>
                  <Input
                    id="specialHandling"
                    value={formData.specialHandling}
                    onChange={(e) => setFormData(prev => ({ ...prev, specialHandling: e.target.value }))}
                    placeholder="Fragile, temperature controlled, etc."
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="notes">Additional Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Any additional information for the delivery team..."
                  rows={4}
                />
              </div>
            </div>
          )}

          {/* Step 4: Review & Submit */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Order Summary */}
                <Card>
                  <CardHeader>
                    <CardTitle>Order Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <h4 className="font-medium">Items ({selectedItems.length})</h4>
                      {selectedItems.map((item) => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <span>{item.bomItem.partNumber}</span>
                          <span>{item.deliveryQuantity} × ₹{item.bomItem.unitCost}</span>
                        </div>
                      ))}
                    </div>
                    
                    <Separator />
                    
                    <div className="flex justify-between font-medium">
                      <span>Total Value:</span>
                      <span>₹{formData.estimatedCost.toLocaleString('en-IN')}</span>
                    </div>
                    
                    <div className="text-sm space-y-1">
                      <div><strong>Priority:</strong> {formData.priority}</div>
                      {formData.requestedDeliveryDate && (
                        <div><strong>Requested Date:</strong> {new Date(formData.requestedDeliveryDate).toLocaleDateString()}</div>
                      )}
                      {formData.carrierId && (
                        <div><strong>Carrier:</strong> {carriers.find(c => c.id === formData.carrierId)?.name}</div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Delivery Information */}
                <Card>
                  <CardHeader>
                    <CardTitle>Delivery Information</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {formData.deliveryAddressId ? (
                      <div className="space-y-3">
                        {(() => {
                          const address = addresses.find(a => a.id === formData.deliveryAddressId);
                          return address ? (
                            <>
                              <div>
                                <strong>{address.companyName || address.contactPerson}</strong>
                                {address.companyName && address.contactPerson && (
                                  <div className="text-sm text-muted-foreground">{address.contactPerson}</div>
                                )}
                              </div>
                              <div className="text-sm">
                                <div>{address.addressLine1}</div>
                                {address.addressLine2 && <div>{address.addressLine2}</div>}
                                <div>{address.city}, {address.stateProvince} {address.postalCode}</div>
                              </div>
                              {address.contactPhone && (
                                <div className="text-sm flex items-center gap-1">
                                  <Phone className="h-3 w-3" />
                                  {address.contactPhone}
                                </div>
                              )}
                              {address.specialInstructions && (
                                <div className="text-sm bg-muted p-2 rounded">
                                  <strong>Instructions:</strong> {address.specialInstructions}
                                </div>
                              )}
                            </>
                          ) : null;
                        })()}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No address selected</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {formData.deliveryInstructions && (
                <Card>
                  <CardHeader>
                    <CardTitle>Delivery Instructions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{formData.deliveryInstructions}</p>
                  </CardContent>
                </Card>
              )}

              {formData.notes && (
                <Card>
                  <CardHeader>
                    <CardTitle>Additional Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{formData.notes}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))}
          disabled={currentStep === 1}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Previous
        </Button>

        <div className="text-sm text-muted-foreground">
          Step {currentStep} of {WORKFLOW_STEPS.length}
        </div>

        {currentStep < WORKFLOW_STEPS.length ? (
          <Button
            onClick={() => setCurrentStep(prev => prev + 1)}
            disabled={!canProceedToStep(currentStep + 1)}
          >
            Next
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmitOrder}
            disabled={createOrderMutation.isPending || !canProceedToStep(4)}
            className="bg-green-600 hover:bg-green-700"
          >
            {createOrderMutation.isPending ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Creating Order...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Create Delivery Order
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}