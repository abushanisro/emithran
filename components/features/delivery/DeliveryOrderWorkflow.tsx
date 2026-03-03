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
  Upload,
  Image,
  X,
  Paperclip,
  ChevronLeft,
  ChevronRight,
  Trash2,
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
import RouteCalculator from './RouteCalculator';
import RouteMap from './RouteMap';

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
  fromAddressId: string;
  carrierId: string;
  transportMode: string; // road, ship, air
  materialType: string;   // box, metal, bulk, fragile
  specialHandling: string;
  deliveryInstructions: string;
  estimatedCost: number;
  notes: string;
  estimatedDistance?: number; // in km
  estimatedTime?: number; // in minutes
  routeOptimized?: boolean;
}

interface UploadedFile {
  id: string;
  file: File;
  preview?: string; // data URL for images
}

interface DockAuditItem {
  slNo: number;
  activity: string;
  specified: string;
  isOk: boolean;
  value: string;
}

const DEFAULT_DOCK_AUDIT: DockAuditItem[] = [
  { slNo: 1, activity: 'Documents', specified: 'PDI report with latest drawing revision number', isOk: false, value: '' },
  { slNo: 2, activity: 'Cleaning', specified: 'Free from dust stains', isOk: false, value: '' },
  { slNo: 3, activity: 'Oiling', specified: 'All surfaces are covered, no excess oil', isOk: false, value: '' },
  { slNo: 4, activity: 'Stretch film cover packing', specified: 'All surfaces are covered with Stretch film', isOk: false, value: '' },
  { slNo: 5, activity: 'VCI bag condition', specified: 'Free from damage, No oil seepage', isOk: false, value: '' },
  { slNo: 6, activity: 'No. Of parts in each bag/packing', specified: 'Verify part Qty', isOk: false, value: '' },
  { slNo: 7, activity: 'No. Of bags/packing', specified: 'Verify no of bag / pack Qty', isOk: false, value: '' },
  { slNo: 8, activity: 'Sealing of VCI bag with adhesive tape', specified: 'Free from gape', isOk: false, value: '' },
  { slNo: 9, activity: 'Identification Tag', specified: 'Verify the part no, Description, Qty', isOk: false, value: '' },
  { slNo: 10, activity: 'Invoice', specified: 'Verify the invoice as per PO', isOk: false, value: '' },
  { slNo: 11, activity: 'Whom & When', specified: 'Verified by & Date of verification', isOk: false, value: '' },
];

const WORKFLOW_STEPS = [
  { id: 1, title: 'Select Items', description: 'Choose quality-approved BOM parts' },
  { id: 2, title: 'Delivery & Transport', description: 'Set address, route optimization, and transport details' },
  { id: 3, title: 'Documentation & Quality', description: 'Upload photos, documents, and quality checks' },
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

// Transport modes configuration
const TRANSPORT_MODES = [
  {
    value: 'road',
    label: 'Road Transport',
    description: 'Trucks, delivery vans, surface transport'
  },
  {
    value: 'air',
    label: 'Air Transport',
    description: 'Air cargo, express air delivery'
  },
  {
    value: 'ship',
    label: 'Sea/Ship Transport',
    description: 'Ocean freight, port-to-port delivery'
  }
];

// Material types available for each transport mode
const MATERIAL_TYPES_BY_TRANSPORT = {
  road: [
    { value: 'box', label: 'Boxes/Packages', description: 'Packaged goods, parcels' },
    { value: 'metal', label: 'Metal Parts', description: 'Heavy metal components, machinery' },
    { value: 'bulk', label: 'Bulk Materials', description: 'Raw materials, large quantities' },
    { value: 'fragile', label: 'Fragile Items', description: 'Delicate, precision parts' }
  ],
  air: [
    { value: 'box', label: 'Express Packages', description: 'Small packages, documents' },
    { value: 'fragile', label: 'High-Value Items', description: 'Electronics, precision instruments' }
  ],
  ship: [
    { value: 'bulk', label: 'Bulk Cargo', description: 'Large quantities, containers' },
    { value: 'metal', label: 'Heavy Machinery', description: 'Industrial equipment, steel' }
  ]
};

// Carrier configurations by transport mode and material type
const CARRIER_CONFIG = {
  road: {
    box: ['dtdc', 'ecom_express', 'delhivery', 'professional_couriers'],
    metal: ['tci_express', 'agarwal_packers', 'transport_corp', 'industrial_logistics'],
    bulk: ['bulk_logistics', 'freight_corp', 'bulk_transport', 'material_movers'],
    fragile: ['special_handling', 'fragile_care', 'precision_logistics', 'careful_cargo']
  },
  air: {
    box: ['fedex', 'dhl', 'ups', 'blue_dart', 'speed_post'],
    fragile: ['fedex', 'dhl', 'special_air_cargo', 'precision_air']
  },
  ship: {
    bulk: ['maersk', 'msc', 'cosco', 'bulk_shipping'],
    metal: ['heavy_cargo_shipping', 'industrial_sea_freight', 'steel_shipping']
  }
};

export default function DeliveryOrderWorkflow({
  projectId,
  onComplete
}: DeliveryOrderWorkflowProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddAddress, setShowAddAddress] = useState(false);
  const [partsPhotos, setPartsPhotos] = useState<UploadedFile[]>([]);
  const [packingPhotos, setPackingPhotos] = useState<UploadedFile[]>([]);
  const [documents, setDocuments] = useState<UploadedFile[]>([]);
  const [dockAudit, setDockAudit] = useState<DockAuditItem[]>(() =>
    DEFAULT_DOCK_AUDIT.map(row => ({ ...row }))
  );
  const [checkedBy, setCheckedBy] = useState('');
  
  // File preview modal state
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [currentImageCollection, setCurrentImageCollection] = useState<UploadedFile[]>([]);
  
  // Route calculation state
  const [routeData, setRouteData] = useState<{
    distance?: number;
    duration?: number;
    cost?: number;
    optimizationScore?: number;
  } | null>(null);

  const [formData, setFormData] = useState<OrderFormData>({
    priority: 'standard',
    requestedDeliveryDate: '',
    deliveryWindowStart: '',
    deliveryWindowEnd: '',
    deliveryAddressId: '',
    fromAddressId: '',
    carrierId: '',
    transportMode: '',
    materialType: '',
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

  // Delete address function (mock - replace with actual API call)
  const handleDeleteAddress = async (addressId: string) => {
    try {
      // Mock API call - replace with actual implementation
      console.log('Deleting address:', addressId);
      
      // If the deleted address was selected, clear the selection
      if (formData.deliveryAddressId === addressId) {
        setFormData(prev => ({ ...prev, deliveryAddressId: '' }));
        setRouteInfo({}); // Clear route info
      }
      
      // Refresh the addresses list
      await refetchAddresses();
      toast.success('Address deleted successfully');
    } catch (error) {
      console.error('Error deleting address:', error);
      toast.error('Failed to delete address');
    }
  };

  // Keyboard navigation for image gallery
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!showPreviewModal) return;
      
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        handleNextImage();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        handlePrevImage();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        handleClosePreview();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showPreviewModal, currentImageIndex, currentImageCollection]);

  // Get available material types for selected transport mode
  const getAvailableMaterialTypes = () => {
    if (!formData.transportMode) return [];
    return MATERIAL_TYPES_BY_TRANSPORT[formData.transportMode as keyof typeof MATERIAL_TYPES_BY_TRANSPORT] || [];
  };

  // Filter carriers based on selected transport mode and material type
  const getAvailableCarriers = () => {
    if (!formData.transportMode || !formData.materialType) return [];
    
    const carrierCodes = CARRIER_CONFIG[formData.transportMode as keyof typeof CARRIER_CONFIG]?.[formData.materialType as keyof typeof CARRIER_CONFIG.road] || [];
    
    return carriers.filter(carrier => {
      if (!carrier.name) return false;
      
      const carrierName = carrier.name.toLowerCase();
      const carrierCode = carrier.code?.toLowerCase() || '';
      
      // Check if carrier matches the configuration
      return carrierCodes.some(configCode => 
        carrierName.includes(configCode.replace('_', ' ')) || 
        carrierCode.includes(configCode) ||
        carrierName.includes(configCode)
      ) ||
      // Fallback: match based on keywords
      (formData.transportMode === 'road' && (
        carrierName.includes('road') || carrierName.includes('truck') || carrierName.includes('transport')
      )) ||
      (formData.transportMode === 'air' && (
        carrierName.includes('air') || carrierName.includes('express') || carrierName.includes('fedex') || carrierName.includes('dhl')
      )) ||
      (formData.transportMode === 'ship' && (
        carrierName.includes('ship') || carrierName.includes('sea') || carrierName.includes('ocean') || carrierName.includes('freight')
      ));
    });
  };

  // Handle transport mode change
  const handleTransportModeChange = (newMode: string) => {
    setFormData(prev => ({ 
      ...prev, 
      transportMode: newMode,
      materialType: '', // Reset material type when transport mode changes
      carrierId: '' // Reset carrier when transport mode changes
    }));
  };

  // Handle material type change
  const handleMaterialTypeChange = (newType: string) => {
    setFormData(prev => ({ 
      ...prev, 
      materialType: newType,
      carrierId: '' // Reset carrier when material type changes
    }));
  };

  // Filter available items based on search
  const filteredItems = availableItems.filter(item =>
    item.bomItem.partNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.bomItem.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calculate and update total estimated cost
  useEffect(() => {
    const calculatedCost = selectedItems.reduce((sum, item) => {
      const unitCost = item.bomItem.unitCost || 0;
      const quantity = item.deliveryQuantity || 1;
      return sum + (unitCost * quantity);
    }, 0);
    
    // Always update to show the calculated value as default
    setFormData(prev => ({
      ...prev,
      estimatedCost: calculatedCost
    }));
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
      setPartsPhotos([]);
      setPackingPhotos([]);
      setDocuments([]);
      setDockAudit(DEFAULT_DOCK_AUDIT.map(row => ({ ...row })));
      setCheckedBy('');
      setFormData({
        priority: 'standard',
        requestedDeliveryDate: '',
        deliveryWindowStart: '',
        deliveryWindowEnd: '',
        deliveryAddressId: '',
        carrierId: '',
        transportMode: '',
        materialType: '',
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

  // --- File upload helpers ---
  const readFileAsDataURL = (file: File): Promise<string> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });

  const handleAddFiles = async (
    files: FileList | null,
    setter: React.Dispatch<React.SetStateAction<UploadedFile[]>>,
    imageOnly = false
  ) => {
    if (!files) return;
    const toAdd: UploadedFile[] = [];
    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith('image/');
      const preview = isImage ? await readFileAsDataURL(file) : undefined;
      toAdd.push({ id: `${Date.now()}-${Math.random()}`, file, preview });
    }
    setter(prev => [...prev, ...toAdd]);
  };

  const handleRemoveFile = (
    id: string,
    setter: React.Dispatch<React.SetStateAction<UploadedFile[]>>
  ) => setter(prev => prev.filter(f => f.id !== id));

  const handleOpenPreview = (file: UploadedFile, collection?: UploadedFile[]) => {
    setPreviewFile(file);
    
    if (collection && file.preview) {
      // If it's an image and we have a collection, set up gallery navigation
      const imageFiles = collection.filter(f => f.preview);
      setCurrentImageCollection(imageFiles);
      setCurrentImageIndex(imageFiles.findIndex(f => f.id === file.id));
    } else {
      // Single file preview
      setCurrentImageCollection([]);
      setCurrentImageIndex(0);
    }
    
    setShowPreviewModal(true);
  };

  const handleClosePreview = () => {
    setShowPreviewModal(false);
    setPreviewFile(null);
    setCurrentImageCollection([]);
    setCurrentImageIndex(0);
  };

  const handleNextImage = () => {
    if (currentImageCollection.length > 1) {
      const nextIndex = (currentImageIndex + 1) % currentImageCollection.length;
      setCurrentImageIndex(nextIndex);
      setPreviewFile(currentImageCollection[nextIndex]);
    }
  };

  const handlePrevImage = () => {
    if (currentImageCollection.length > 1) {
      const prevIndex = currentImageIndex === 0 ? currentImageCollection.length - 1 : currentImageIndex - 1;
      setCurrentImageIndex(prevIndex);
      setPreviewFile(currentImageCollection[prevIndex]);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Route calculation callback
  const handleRouteCalculated = (result: any) => {
    setRouteData(result);
    
    // Update form data for submission
    setFormData(prev => ({
      ...prev,
      estimatedDistance: result.distance,
      estimatedTime: result.duration,
      routeOptimized: (result.optimizationScore || 0) > 70,
      estimatedCost: prev.estimatedCost + (result.cost || 0)
    }));
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Progress Indicator */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-6">Create Delivery Order</h1>

        <div className="flex items-center justify-between">
          {WORKFLOW_STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${step.id === currentStep
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
                <p className={`text-sm font-medium ${step.id === currentStep ? 'text-primary' :
                  step.id < currentStep ? 'text-green-600' : 'text-gray-500'
                  }`}>
                  Step {step.id} of {WORKFLOW_STEPS.length}
                </p>
                <p className={`text-xs ${step.id === currentStep ? 'text-primary' :
                  step.id < currentStep ? 'text-green-600' : 'text-gray-500'
                  }`}>
                  {step.title}
                </p>
              </div>

              {index < WORKFLOW_STEPS.length - 1 && (
                <ArrowRight className={`mx-4 h-5 w-5 ${step.id < currentStep ? 'text-green-500' : 'text-gray-300'
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

                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="font-medium">Calculated Value:</span>
                        <span className="text-lg font-semibold text-muted-foreground">
                          ₹{selectedItems.reduce((sum, item) => {
                            const unitCost = item.bomItem.unitCost || 0;
                            const quantity = item.deliveryQuantity || 1;
                            return sum + (unitCost * quantity);
                          }, 0).toLocaleString('en-IN')}
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-center gap-4">
                        <Label htmlFor="estimatedCost" className="font-medium whitespace-nowrap">Total Estimated Value:</Label>
                        <div className="flex-1 max-w-xs">
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">₹</span>
                            <Input
                              id="estimatedCost"
                              type="number"
                              placeholder="0"
                              value={formData.estimatedCost || ''}
                              onChange={(e) => setFormData(prev => ({ ...prev, estimatedCost: parseFloat(e.target.value) || 0 }))}
                              className="pl-8 text-right font-bold"
                              min="0"
                              step="0.01"
                            />
                          </div>
                        </div>
                      </div>
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
                {/* From Address Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="fromAddress">From Address (Pickup) *</Label>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="flex items-center gap-2">
                          <Plus className="h-4 w-4" />
                          Add Pickup Address
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Add New Pickup Address</DialogTitle>
                          <DialogDescription>
                            Create a new pickup/origin address for this shipment. Fields marked with * are required.
                          </DialogDescription>
                        </DialogHeader>

                        <div className="grid gap-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <Label htmlFor="fromCompanyName">Company Name</Label>
                              <Input
                                id="fromCompanyName"
                                value={newAddress.companyName || ''}
                                onChange={(e) => setNewAddress(prev => ({ ...prev, companyName: e.target.value, addressType: 'pickup' }))}
                                placeholder="Company name"
                              />
                            </div>
                            <div>
                              <Label htmlFor="fromContactPerson">Contact Person *</Label>
                              <Input
                                id="fromContactPerson"
                                value={newAddress.contactPerson || ''}
                                onChange={(e) => setNewAddress(prev => ({ ...prev, contactPerson: e.target.value }))}
                                placeholder="Contact person name"
                                className={!newAddress.contactPerson ? 'border-red-300 focus:border-red-500' : ''}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <Label htmlFor="fromContactPhone">Phone</Label>
                              <Input
                                id="fromContactPhone"
                                value={newAddress.contactPhone || ''}
                                onChange={(e) => setNewAddress(prev => ({ ...prev, contactPhone: e.target.value }))}
                                placeholder="+91 98765 43210"
                              />
                            </div>
                            <div>
                              <Label htmlFor="fromContactEmail">Email</Label>
                              <Input
                                id="fromContactEmail"
                                type="email"
                                value={newAddress.contactEmail || ''}
                                onChange={(e) => setNewAddress(prev => ({ ...prev, contactEmail: e.target.value }))}
                                placeholder="email@example.com"
                              />
                            </div>
                          </div>

                          <div>
                            <Label htmlFor="fromAddressLine1">Address Line 1 *</Label>
                            <Input
                              id="fromAddressLine1"
                              value={newAddress.addressLine1 || ''}
                              onChange={(e) => setNewAddress(prev => ({ ...prev, addressLine1: e.target.value }))}
                              placeholder="Building number, street name"
                              className={!newAddress.addressLine1 ? 'border-red-300 focus:border-red-500' : ''}
                            />
                          </div>

                          <div>
                            <Label htmlFor="fromAddressLine2">Address Line 2</Label>
                            <Input
                              id="fromAddressLine2"
                              value={newAddress.addressLine2 || ''}
                              onChange={(e) => setNewAddress(prev => ({ ...prev, addressLine2: e.target.value }))}
                              placeholder="Landmark, area (optional)"
                            />
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <Label htmlFor="fromCity">City *</Label>
                              <Input
                                id="fromCity"
                                value={newAddress.city || ''}
                                onChange={(e) => setNewAddress(prev => ({ ...prev, city: e.target.value }))}
                                placeholder="City name"
                                className={!newAddress.city ? 'border-red-300 focus:border-red-500' : ''}
                              />
                            </div>
                            <div>
                              <Label htmlFor="fromState">State *</Label>
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
                              <Label htmlFor="fromPostalCode">PIN Code *</Label>
                              <Input
                                id="fromPostalCode"
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
                            <Label htmlFor="fromInstructions">Pickup Instructions</Label>
                            <Textarea
                              id="fromInstructions"
                              value={newAddress.specialInstructions || ''}
                              onChange={(e) => setNewAddress(prev => ({ ...prev, specialInstructions: e.target.value }))}
                              placeholder="Special pickup instructions..."
                              rows={3}
                            />
                          </div>
                        </div>

                        <div className="flex justify-end gap-2">
                          <DialogTrigger asChild>
                            <Button variant="outline">Cancel</Button>
                          </DialogTrigger>
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

                  {/* From Address Selection Cards */}
                  <div>
                    {addresses.filter(addr => addr.addressType === 'pickup' || !addr.addressType).length === 0 ? (
                      <div className="p-6 border-2 border-dashed border-gray-300 rounded-lg text-center">
                        <div className="flex flex-col items-center gap-2 text-gray-500">
                          <AlertCircle className="h-8 w-8" />
                          <span className="font-medium">No pickup addresses found</span>
                          <p className="text-sm">Add a pickup address to continue</p>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {addresses
                          .filter(addr => addr.addressType === 'pickup' || !addr.addressType)
                          .map((address) => (
                          <div
                            key={`from-${address.id}`}
                            className={`group relative p-3 border-2 rounded-lg cursor-pointer transition-all duration-200 hover:shadow-md ${formData.fromAddressId === address.id
                              ? 'border-green-500 bg-green-50/80 shadow-sm ring-1 ring-green-200'
                              : 'border-gray-200 hover:border-green-300 hover:bg-gray-50/50'
                              }`}
                            onClick={() => setFormData(prev => ({ ...prev, fromAddressId: address.id! }))}
                          >
                            {/* Selection indicator and delete button */}
                            <div className="absolute top-2 right-2 flex items-center gap-2">
                              {/* Delete button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (window.confirm('Are you sure you want to delete this pickup address?')) {
                                    handleDeleteAddress(address.id!);
                                  }
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-100 rounded-full"
                                title="Delete pickup address"
                              >
                                <Trash2 className="h-3 w-3 text-red-500 hover:text-red-600" />
                              </button>

                              {/* Selection indicator */}
                              <div className={`w-4 h-4 rounded-full border-2 transition-all ${formData.fromAddressId === address.id
                                ? 'border-green-500 bg-green-500'
                                : 'border-gray-300'
                                }`}>
                                {formData.fromAddressId === address.id && (
                                  <div className="w-full h-full rounded-full bg-green-500 flex items-center justify-center">
                                    <div className="w-1.5 h-1.5 rounded-full bg-white" />
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Address content - compact version */}
                            <div className="pr-6">
                              <h3 className="font-semibold text-sm text-gray-900 leading-tight">
                                {address.companyName || address.contactPerson}
                              </h3>
                              <p className="text-xs text-gray-600 mt-1">
                                {address.city}, {address.stateProvince}
                              </p>
                              {address.contactPhone && (
                                <p className="text-xs text-gray-500 mt-1">📞 {address.contactPhone}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Delivery Address Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="deliveryAddress">Delivery Address (Destination) *</Label>
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
                    {addresses.filter(addr => addr.addressType === 'delivery' || !addr.addressType).length === 0 ? (
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
                        {addresses
                          .filter(addr => addr.addressType === 'delivery' || !addr.addressType)
                          .map((address) => (
                          <div
                            key={address.id}
                            className={`group relative p-4 border-2 rounded-lg cursor-pointer transition-all duration-200 hover:shadow-md ${formData.deliveryAddressId === address.id
                              ? 'border-blue-500 bg-blue-50/80 shadow-sm ring-1 ring-blue-200'
                              : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50/50'
                              }`}
                            onClick={() => setFormData(prev => ({ ...prev, deliveryAddressId: address.id! }))}
                          >
                            {/* Selection indicator and delete button */}
                            <div className="absolute top-3 right-3 flex items-center gap-2">
                              {/* Delete button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (window.confirm('Are you sure you want to delete this address?')) {
                                    handleDeleteAddress(address.id!);
                                  }
                                }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-100 rounded-full"
                                title="Delete address"
                              >
                                <Trash2 className="h-3 w-3 text-red-500 hover:text-red-600" />
                              </button>

                              {/* Selection indicator */}
                              <div className={`w-4 h-4 rounded-full border-2 transition-all ${formData.deliveryAddressId === address.id
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

              {/* Delivery & Handling */}
              <div className="mt-8">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Delivery &amp; Handling</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Transport Mode Dropdown */}
                  <div>
                    <Label htmlFor="transportMode">Transport Mode *</Label>
                    <Select value={formData.transportMode} onValueChange={handleTransportModeChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select transport mode" />
                      </SelectTrigger>
                      <SelectContent>
                        {TRANSPORT_MODES.map((mode) => (
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

                  {/* Material Type Dropdown - Only enabled after transport mode is selected */}
                  <div>
                    <Label htmlFor="materialType">Material Type *</Label>
                    <Select 
                      value={formData.materialType} 
                      onValueChange={handleMaterialTypeChange}
                      disabled={!formData.transportMode}
                    >
                      <SelectTrigger>
                        <SelectValue 
                          placeholder={
                            !formData.transportMode 
                              ? "Select transport first" 
                              : "Select material type"
                          } 
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {getAvailableMaterialTypes().length === 0 ? (
                          <SelectItem value="empty" disabled>Select transport mode first</SelectItem>
                        ) : (
                          getAvailableMaterialTypes().map((material) => (
                            <SelectItem key={material.value} value={material.value}>
                              <div className="flex flex-col">
                                <span className="font-medium">{material.label}</span>
                                <span className="text-xs text-muted-foreground">{material.description}</span>
                              </div>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Special Handling */}
                <div className="mt-4">
                  <Label htmlFor="specialHandling">Special Handling</Label>
                  <Input
                    id="specialHandling"
                    value={formData.specialHandling}
                    onChange={(e) => setFormData(prev => ({ ...prev, specialHandling: e.target.value }))}
                    placeholder="Fragile, temperature controlled, etc."
                  />
                </div>

                {/* Additional Notes */}
                <div className="mt-4">
                  <Label htmlFor="notes">Additional Notes</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Any additional information for the delivery team..."
                    rows={3}
                  />
                </div>
              </div>

              {/* Visual Route Map with Google Maps Integration */}
              {formData.fromAddressId && formData.deliveryAddressId && (
                <div className="mt-8">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Route Visualization</h3>
                  
                  <RouteMap
                    fromAddress={addresses.find(a => a.id === formData.fromAddressId)}
                    toAddress={addresses.find(a => a.id === formData.deliveryAddressId)}
                    onRouteCalculated={handleRouteCalculated}
                  />
                </div>
              )}

              {/* Enhanced Route Calculator with Real Map Integration */}
              <div className="mt-8">
                <RouteCalculator
                  fromAddress={formData.fromAddressId ? addresses.find(a => a.id === formData.fromAddressId) || null : null}
                  toAddress={formData.deliveryAddressId ? addresses.find(a => a.id === formData.deliveryAddressId) || null : null}
                  transportMode={formData.transportMode === 'road' ? 'car' : formData.transportMode === 'air' ? 'car' : 'car'}
                  onRouteCalculated={handleRouteCalculated}
                />
              </div>
            </div>
          )}

          {/* Step 3: Carrier & Logistics */}
          {currentStep === 3 && (
            <div className="space-y-8">

              {/* Dock Audit Check Sheet - Moved to top */}
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  6.5 Dock Audit Check Sheet
                  <Badge variant="secondary">
                    {dockAudit.filter(r => r.isOk).length} / {dockAudit.length} OK
                  </Badge>
                </h3>

                <div className="rounded-lg border overflow-hidden">
                  {/* Table header */}
                  <div className="grid bg-muted/60 text-xs font-semibold uppercase tracking-wide" style={{ gridTemplateColumns: '44px 1fr 1.4fr 52px 96px' }}>
                    <div className="px-3 py-2 border-r text-center">S.No</div>
                    <div className="px-3 py-2 border-r">Activity</div>
                    <div className="px-3 py-2 border-r">Specified</div>
                    <div className="px-3 py-2 border-r text-center">OK</div>
                    <div className="px-3 py-2 text-center">Value</div>
                  </div>

                  {/* Table rows */}
                  {dockAudit.map((row, idx) => (
                    <div
                      key={row.slNo}
                      className={`grid border-t text-sm ${idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                        }`}
                      style={{ gridTemplateColumns: '44px 1fr 1.4fr 52px 96px' }}
                    >
                      {/* S.No */}
                      <div className="px-3 py-2 border-r text-center text-muted-foreground font-medium">
                        {row.slNo}
                      </div>

                      {/* Activity */}
                      <div className="px-3 py-2 border-r font-medium">
                        {row.activity}
                      </div>

                      {/* Specified */}
                      <div className="px-3 py-2 border-r text-muted-foreground">
                        {row.specified}
                      </div>

                      {/* OK checkbox */}
                      <div className="px-3 py-2 border-r flex items-center justify-center">
                        <button
                          type="button"
                          onClick={() =>
                            setDockAudit(prev =>
                              prev.map((r, i) =>
                                i === idx ? { ...r, isOk: !r.isOk } : r
                              )
                            )
                          }
                          className={`w-6 h-6 rounded flex items-center justify-center border-2 transition-colors ${row.isOk
                              ? 'bg-green-500 border-green-600 text-white'
                              : 'border-muted-foreground/40 hover:border-green-400'
                            }`}
                          title={row.isOk ? 'Unmark OK' : 'Mark OK'}
                        >
                          {row.isOk && (
                            <svg viewBox="0 0 12 10" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="1,5 4,9 11,1" />
                            </svg>
                          )}
                        </button>
                      </div>

                      {/* Value */}
                      <div className="px-2 py-1.5 flex items-center">
                        <input
                          type="text"
                          value={row.value}
                          onChange={(e) =>
                            setDockAudit(prev =>
                              prev.map((r, i) =>
                                i === idx ? { ...r, value: e.target.value } : r
                              )
                            )
                          }
                          placeholder="—"
                          className="w-full text-xs bg-transparent border border-transparent rounded px-1 py-0.5 focus:border-border focus:outline-none focus:bg-muted/30 transition-colors"
                        />
                      </div>
                    </div>
                  ))}

                  {/* Checked By footer */}
                  <div className="border-t px-3 py-2 flex items-center gap-3 bg-muted/30">
                    <span className="text-xs font-semibold whitespace-nowrap">Checked by :</span>
                    <input
                      type="text"
                      value={checkedBy}
                      onChange={(e) => setCheckedBy(e.target.value)}
                      placeholder="Name"
                      className="flex-1 text-sm bg-transparent border-b border-muted-foreground/30 focus:border-primary outline-none py-0.5 transition-colors"
                    />
                  </div>
                </div>
              </div>


              {/* File Upload Sections with Enhanced UI/UX */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Parts Photos */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <Image className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-foreground">Parts Photos</h4>
                      <p className="text-xs text-muted-foreground">Visual documentation of parts</p>
                    </div>
                    {partsPhotos.length > 0 && (
                      <Badge variant="default" className="ml-auto bg-primary">
                        {partsPhotos.length}
                      </Badge>
                    )}
                  </div>
                  
                  <label
                    htmlFor="parts-photos-input"
                    className="relative group block w-full p-6 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary hover:bg-primary/5 transition-all duration-200"
                  >
                    <div className="text-center">
                      <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                        <Upload className="h-6 w-6 text-primary" />
                      </div>
                      <div className="mt-3">
                        <p className="text-sm font-medium text-foreground">Click to upload photos</p>
                        <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP accepted</p>
                        <p className="text-xs text-primary font-medium mt-1">Multiple files allowed</p>
                      </div>
                    </div>
                    <input
                      id="parts-photos-input"
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => handleAddFiles(e.target.files, setPartsPhotos, true)}
                    />
                  </label>

                  {partsPhotos.length > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                      {partsPhotos.map((f) => (
                        <div key={f.id} className="relative group">
                          <div 
                            className="aspect-square rounded-lg overflow-hidden border-2 border-border bg-muted/30 cursor-pointer hover:border-primary transition-colors"
                            onClick={() => handleOpenPreview(f, partsPhotos)}
                          >
                            {f.preview ? (
                              <img src={f.preview} alt={f.file.name} className="w-full h-full object-cover hover:scale-105 transition-transform duration-200" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Image className="h-8 w-8 text-muted-foreground" />
                              </div>
                            )}
                          </div>
                          <div className="mt-1 px-1">
                            <p className="text-xs font-medium truncate text-foreground">{f.file.name}</p>
                            <p className="text-xs text-muted-foreground">{formatFileSize(f.file.size)}</p>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveFile(f.id, setPartsPhotos);
                            }}
                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600 z-10"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Packing Photos */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-green-100 rounded-lg">
                      <Package className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">Packing Photos</h4>
                      <p className="text-xs text-gray-500">Documentation of packaging</p>
                    </div>
                    {packingPhotos.length > 0 && (
                      <Badge variant="default" className="ml-auto bg-green-500">
                        {packingPhotos.length}
                      </Badge>
                    )}
                  </div>
                  
                  <label
                    htmlFor="packing-photos-input"
                    className="relative group block w-full p-6 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-green-400 hover:bg-green-50/50 transition-all duration-200"
                  >
                    <div className="text-center">
                      <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center group-hover:bg-green-200 transition-colors">
                        <Upload className="h-6 w-6 text-green-600" />
                      </div>
                      <div className="mt-3">
                        <p className="text-sm font-medium text-gray-900">Click to upload photos</p>
                        <p className="text-xs text-gray-500 mt-1">JPG, PNG, WEBP accepted</p>
                        <p className="text-xs text-green-600 font-medium mt-1">Multiple files allowed</p>
                      </div>
                    </div>
                    <input
                      id="packing-photos-input"
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => handleAddFiles(e.target.files, setPackingPhotos, true)}
                    />
                  </label>

                  {packingPhotos.length > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                      {packingPhotos.map((f) => (
                        <div key={f.id} className="relative group">
                          <div 
                            className="aspect-square rounded-lg overflow-hidden border-2 border-gray-200 bg-gray-50 cursor-pointer hover:border-green-400 transition-colors"
                            onClick={() => handleOpenPreview(f, packingPhotos)}
                          >
                            {f.preview ? (
                              <img src={f.preview} alt={f.file.name} className="w-full h-full object-cover hover:scale-105 transition-transform duration-200" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Image className="h-8 w-8 text-gray-400" />
                              </div>
                            )}
                          </div>
                          <div className="mt-1 px-1">
                            <p className="text-xs font-medium truncate">{f.file.name}</p>
                            <p className="text-xs text-gray-500">{formatFileSize(f.file.size)}</p>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveFile(f.id, setPackingPhotos);
                            }}
                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-600 z-10"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Supporting Documents */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-purple-100 rounded-lg">
                      <Paperclip className="h-5 w-5 text-purple-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">Documents</h4>
                      <p className="text-xs text-gray-500">Supporting documentation</p>
                    </div>
                    {documents.length > 0 && (
                      <Badge variant="default" className="ml-auto bg-purple-500">
                        {documents.length}
                      </Badge>
                    )}
                  </div>
                  
                  <label
                    htmlFor="documents-input"
                    className="relative group block w-full p-6 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-purple-400 hover:bg-purple-50/50 transition-all duration-200"
                  >
                    <div className="text-center">
                      <div className="mx-auto w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                        <Upload className="h-6 w-6 text-purple-600" />
                      </div>
                      <div className="mt-3">
                        <p className="text-sm font-medium text-gray-900">Click to upload files</p>
                        <p className="text-xs text-gray-500 mt-1">PDF, Word, Excel, Images</p>
                        <p className="text-xs text-purple-600 font-medium mt-1">Multiple files allowed</p>
                      </div>
                    </div>
                    <input
                      id="documents-input"
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                      multiple
                      className="hidden"
                      onChange={(e) => handleAddFiles(e.target.files, setDocuments)}
                    />
                  </label>

                  {documents.length > 0 && (
                    <div className="space-y-3">
                      {documents.map((f) => (
                        <div 
                          key={f.id} 
                          className="group flex items-center gap-3 p-3 border border-gray-200 rounded-lg bg-gray-50/50 hover:bg-gray-50 hover:border-purple-300 transition-colors cursor-pointer"
                          onClick={() => handleOpenPreview(f)}
                        >
                          <div className="flex-shrink-0">
                            {f.preview ? (
                              <img src={f.preview} alt={f.file.name} className="h-10 w-10 object-cover rounded" />
                            ) : (
                              <div className="h-10 w-10 rounded bg-gray-200 flex items-center justify-center">
                                <FileText className="h-5 w-5 text-gray-500" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate text-gray-900">{f.file.name}</p>
                            <p className="text-xs text-gray-500">{formatFileSize(f.file.size)} • Click to preview</p>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveFile(f.id, setDocuments);
                            }}
                            className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

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
                      {formData.deliveryMode && (
                        <div><strong>Delivery Mode:</strong> {DELIVERY_MODES.find(m => m.value === formData.deliveryMode)?.label}</div>
                      )}
                      {formData.carrierId && (
                        <div><strong>Carrier:</strong> {getAvailableCarriers().find(c => c.id === formData.carrierId)?.name}</div>
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

              {/* Attachments Summary */}
              {(partsPhotos.length > 0 || packingPhotos.length > 0 || documents.length > 0) && (
                <Card>
                  <CardHeader>
                    <CardTitle>Attachments</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {partsPhotos.length > 0 && (
                      <div className="flex items-center gap-2 text-sm">
                        <Image className="h-4 w-4 text-muted-foreground" />
                        <span><strong>{partsPhotos.length}</strong> parts photo{partsPhotos.length > 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {packingPhotos.length > 0 && (
                      <div className="flex items-center gap-2 text-sm">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <span><strong>{packingPhotos.length}</strong> packing photo{packingPhotos.length > 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {documents.length > 0 && (
                      <div className="flex items-center gap-2 text-sm">
                        <Paperclip className="h-4 w-4 text-muted-foreground" />
                        <span><strong>{documents.length}</strong> document{documents.length > 1 ? 's' : ''}</span>
                      </div>
                    )}
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

      {/* File Preview Modal */}
      {showPreviewModal && previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={handleClosePreview}
          />
          
          {/* Modal Content */}
          <div className="relative z-10 max-w-7xl max-h-[90vh] w-full bg-background rounded-2xl shadow-2xl overflow-hidden border">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b bg-muted/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  {previewFile.preview ? (
                    <Image className="h-5 w-5 text-primary" />
                  ) : (
                    <FileText className="h-5 w-5 text-primary" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-foreground text-lg">{previewFile.file.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {formatFileSize(previewFile.file.size)} • {previewFile.file.type || 'Unknown type'}
                    {currentImageCollection.length > 1 && (
                      <span className="ml-2">• {currentImageIndex + 1} of {currentImageCollection.length}</span>
                    )}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const url = URL.createObjectURL(previewFile.file);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = previewFile.file.name;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                  }}
                  className="flex items-center gap-2"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClosePreview}
                  className="flex items-center justify-center w-10 h-10 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 max-h-[calc(90vh-140px)] overflow-auto">
              {previewFile.preview ? (
                // Image Preview with Navigation
                <div className="relative flex items-center justify-center">
                  {/* Previous Button */}
                  {currentImageCollection.length > 1 && (
                    <button
                      onClick={handlePrevImage}
                      className="absolute left-4 top-1/2 -translate-y-1/2 z-10 bg-background/90 hover:bg-background border border-border rounded-full p-3 shadow-lg transition-all duration-200 hover:scale-110"
                      title="Previous image (← or ↑)"
                    >
                      <ChevronLeft className="h-6 w-6 text-foreground" />
                    </button>
                  )}

                  {/* Main Image */}
                  <img 
                    src={previewFile.preview} 
                    alt={previewFile.file.name}
                    className="max-w-full max-h-[calc(90vh-200px)] object-contain rounded-lg shadow-lg"
                  />

                  {/* Next Button */}
                  {currentImageCollection.length > 1 && (
                    <button
                      onClick={handleNextImage}
                      className="absolute right-4 top-1/2 -translate-y-1/2 z-10 bg-background/90 hover:bg-background border border-border rounded-full p-3 shadow-lg transition-all duration-200 hover:scale-110"
                      title="Next image (→ or ↓)"
                    >
                      <ChevronRight className="h-6 w-6 text-foreground" />
                    </button>
                  )}

                  {/* Image Counter Overlay */}
                  {currentImageCollection.length > 1 && (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-primary/90 text-primary-foreground px-3 py-1 rounded-full text-sm backdrop-blur-sm">
                      {currentImageIndex + 1} / {currentImageCollection.length}
                    </div>
                  )}
                </div>
              ) : (
                // Document Preview
                <div className="text-center py-12">
                  <div className="mx-auto w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-4">
                    <FileText className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium text-foreground mb-2">Document Preview</h3>
                  <p className="text-muted-foreground mb-6">
                    {previewFile.file.name}
                  </p>
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p><strong>File Type:</strong> {previewFile.file.type || 'Unknown'}</p>
                    <p><strong>File Size:</strong> {formatFileSize(previewFile.file.size)}</p>
                    <p><strong>Last Modified:</strong> {new Date(previewFile.file.lastModified).toLocaleString()}</p>
                  </div>
                  
                  {/* PDF Preview Attempt */}
                  {previewFile.file.type === 'application/pdf' && (
                    <div className="mt-8">
                      <iframe
                        src={URL.createObjectURL(previewFile.file)}
                        className="w-full h-96 border rounded-lg"
                        title="PDF Preview"
                      />
                    </div>
                  )}
                  
                  {/* Text file preview attempt */}
                  {(previewFile.file.type.startsWith('text/') || 
                    previewFile.file.name.endsWith('.txt') || 
                    previewFile.file.name.endsWith('.csv')) && (
                    <div className="mt-8">
                      <div className="bg-muted/50 p-4 rounded-lg">
                        <p className="text-sm text-muted-foreground mb-2">Text Preview:</p>
                        <div className="bg-background p-3 rounded border max-h-40 overflow-auto text-left">
                          <FilePreviewContent file={previewFile.file} />
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <Button
                    onClick={() => {
                      const url = URL.createObjectURL(previewFile.file);
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = previewFile.file.name;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      URL.revokeObjectURL(url);
                    }}
                    className="mt-6"
                  >
                    Download File
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper component for text file preview
function FilePreviewContent({ file }: { file: File }) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setContent(text.slice(0, 1000) + (text.length > 1000 ? '...' : '')); // Limit preview to first 1000 chars
      setLoading(false);
    };
    reader.onerror = () => {
      setContent('Error reading file');
      setLoading(false);
    };
    reader.readAsText(file.slice(0, 10000)); // Only read first 10KB for preview
  }, [file]);

  if (loading) {
    return <div className="text-muted-foreground">Loading preview...</div>;
  }

  return <pre className="text-xs text-foreground whitespace-pre-wrap font-mono">{content}</pre>;
}