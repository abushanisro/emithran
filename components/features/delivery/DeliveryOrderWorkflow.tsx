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
import { DeliveryOrderDetailDialog } from './DeliveryOrderDetailDialog';
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
  useDeliveryOrders,
  DeliveryOrder,
  useDeleteDeliveryAddress,
  useDeleteDeliveryOrder,
  DeliveryAddress,
} from '@/lib/api/hooks/useDelivery';
import { toast } from 'sonner';
import RouteCalculator from './RouteCalculator';
import RouteMap from './RouteMap';

interface DeliveryOrderWorkflowProps {
  projectId: string;
  onComplete?: () => void;
  onTrackOrder?: (orderId: string) => void;
}

interface SelectedItem extends QualityApprovedItem {
  deliveryQuantity: number;
  notes?: string;
}

interface OrderFormData {
  priority: 'low' | 'standard' | 'high' | 'urgent';
  requestedDate: string;
  requestedTime: string;
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
  onComplete,
  onTrackOrder
}: DeliveryOrderWorkflowProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddAddress, setShowAddAddress] = useState(false);
  const [partsPhotos, setPartsPhotos] = useState<UploadedFile[]>([]);
  const [packingPhotos, setPackingPhotos] = useState<UploadedFile[]>([]);
  const [documents, setDocuments] = useState<UploadedFile[]>([]);
  const [dockAudit, setDockAudit] = useState<DockAuditItem[]>(() =>
    DEFAULT_DOCK_AUDIT.map(item => ({ ...item }))
  );
  const [checkedBy, setCheckedBy] = useState('');

  // File preview modal state
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [currentImageCollection, setCurrentImageCollection] = useState<UploadedFile[]>([]);

  // Delivery order detail dialog state
  const [showOrderDetail, setShowOrderDetail] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Route calculation state
  const [routeData, setRouteData] = useState<{
    distance?: number;
    duration?: number;
    cost?: number;
    optimizationScore?: number;
    dataQualityScore?: number;
    isEstimated?: boolean;
    routeProvider?: string;
    optimizationLevel?: string;
    materialType?: string;
    costBreakdown?: {
      transportBase: number;
      loadingUnloading: number;
      materialSurcharge: number;
      fuelTollSurcharge: number;
    };
  } | null>(null);

  const [formData, setFormData] = useState<OrderFormData>({
    priority: 'standard',
    requestedDate: '',
    requestedTime: '',
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
  const deleteAddressMutation = useDeleteDeliveryAddress();
  const deleteOrderMutation = useDeleteDeliveryOrder();
  const { data: recentOrdersResponse, isLoading: ordersLoading, refetch: refetchOrders } = useDeliveryOrders(projectId, {
    limit: 10,
    sortBy: 'createdAt',
    sortOrder: 'desc'
  });
  
  const recentOrders = recentOrdersResponse || [];

  // Delete address function
  const handleDeleteAddress = async (addressId: string) => {
    try {
      await deleteAddressMutation.mutateAsync({ addressId, projectId });

      // If the deleted address was selected, clear the selection
      if (formData.deliveryAddressId === addressId) {
        setFormData(prev => ({ ...prev, deliveryAddressId: '' }));
        setRouteInfo({}); // Clear route info
      }
      if (formData.fromAddressId === addressId) {
        setFormData(prev => ({ ...prev, fromAddressId: '' }));
      }
    } catch (error) {
      // Error is handled in the mutation's onError callback
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

    // Validate requested date
    if (formData.requestedDate) {
      const requestedDateTime = new Date(`${formData.requestedDate}T${formData.requestedTime || '00:00'}`);
      if (requestedDateTime < new Date()) {
        toast.error('Requested delivery date cannot be in the past');
        return;
      }
    }

    try {
      const orderData = {
        projectId,
        deliveryAddressId: formData.deliveryAddressId,
        carrierId: formData.carrierId || undefined,
        priority: formData.priority,
        requestedDeliveryDate: formData.requestedDate ? `${formData.requestedDate}T${formData.requestedTime || '00:00'}:00.000Z` : undefined,
        deliveryWindowStart: formData.requestedTime || undefined,
        deliveryWindowEnd: formData.requestedTime ? 
          (() => {
            // Add 2 hours to the start time for the end window
            const [hours, minutes] = formData.requestedTime.split(':').map(Number);
            const endHours = (hours + 2) % 24;
            return `${endHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
          })() : undefined,
        specialHandlingRequirements: formData.specialHandling || undefined,
        deliveryInstructions: formData.deliveryInstructions || undefined,
        deliveryCostInr: formData.estimatedCost || 0,
        totalDeliveryCostInr: formData.estimatedCost || 0,
        packageCount: selectedItems.reduce((sum, item) => sum + (item.deliveryQuantity || 0), 0),
        notes: formData.notes || undefined,
        items: selectedItems.map(item => ({
          qualityApprovedItemId: item.id,
          bomItemId: item.bomItemId,
          approvedQuantity: item.approvedQuantity,
          deliveryQuantity: item.deliveryQuantity,
          qcCertificateNumber: item.qcCertificateNumber || undefined,
        })),
        // Route and transport data
        transportMode: formData.transportMode,
        materialType: formData.materialType || routeData?.materialType,
        routeType: routeData?.optimizationLevel,
        routeDistanceKm: routeData?.distance,
        routeTravelTimeMinutes: routeData?.duration,
        routeData: routeData,
        // Cost breakdown from route calculation
        transportCostInr: routeData?.costBreakdown?.transportBase || 0,
        loadingCostInr: routeData?.costBreakdown?.loadingUnloading || 0,
        fuelTollCostInr: routeData?.costBreakdown?.fuelTollSurcharge || 0,
        costBreakdown: routeData?.costBreakdown,
        // Additional workflow data
        partsPhotos: partsPhotos,
        packingPhotos: packingPhotos,
        documents: documents,
        dockAudit: dockAudit.map(item => ({
          slNo: item.slNo,
          activity: item.activity,
          specified: item.specified,
          ok: item.isOk,
          value: item.value
        })),
        checkedBy: checkedBy
      };

      
      await createOrderMutation.mutateAsync(orderData);
      toast.success('Delivery order created successfully!');
      // Refresh the recent orders list
      await refetchOrders();
      onComplete?.();

      // Reset form
      setCurrentStep(1);
      setSelectedItems([]);
      setPartsPhotos([]);
      setPackingPhotos([]);
      setDocuments([]);
      setDockAudit(DEFAULT_DOCK_AUDIT.map(item => ({ ...item })));
      setCheckedBy('');
      setFormData({
        priority: 'standard',
        requestedDate: '',
        requestedTime: '',
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
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {addresses
                          .filter(addr => addr.addressType === 'pickup' || !addr.addressType)
                          .map((address) => (
                            <div
                              key={`from-${address.id}`}
                              className={`group relative p-4 border-2 rounded-lg cursor-pointer transition-all duration-200 ${formData.fromAddressId === address.id
                                ? 'border-primary bg-primary/10 shadow-lg ring-1 ring-primary/30'
                                : 'border-border bg-card hover:border-primary/40 hover:bg-secondary/50'
                                }`}
                              onClick={() => setFormData(prev => ({ ...prev, fromAddressId: address.id! }))}
                            >
                              {/* Selection indicator and delete button */}
                              <div className="absolute top-3 right-3 flex items-center gap-2">
                                {/* Delete button */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm('Are you sure you want to delete this pickup address?')) {
                                      handleDeleteAddress(address.id!);
                                    }
                                  }}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-destructive/20 rounded-full"
                                  title="Delete pickup address"
                                >
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </button>

                                {/* Selection indicator */}
                                <div className={`w-4 h-4 rounded-full border-2 transition-all ${formData.fromAddressId === address.id
                                  ? 'border-primary bg-primary'
                                  : 'border-muted-foreground/40'
                                  }`}>
                                  {formData.fromAddressId === address.id && (
                                    <div className="w-full h-full rounded-full bg-primary flex items-center justify-center">
                                      <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Company/Contact header */}
                              <div className="pr-6 mb-3">
                                <div className="flex items-start gap-2 mb-2">
                                  <div className="flex-1">
                                    <h3 className="font-semibold text-sm text-foreground leading-tight">
                                      {address.companyName || address.contactPerson}
                                    </h3>
                                    {address.companyName && address.contactPerson && (
                                      <p className="text-xs text-muted-foreground mt-1 leading-tight">
                                        Contact: {address.contactPerson}
                                      </p>
                                    )}
                                  </div>
                                  {address.isDefault && (
                                    <Badge variant="default" className="text-xs bg-primary/20 text-primary border-primary/30 shrink-0">
                                      Default
                                    </Badge>
                                  )}
                                </div>
                              </div>

                              {/* Address */}
                              <div className="space-y-2 mb-3">
                                <div className="text-xs text-muted-foreground leading-relaxed">
                                  <div className="break-words">{address.addressLine1}</div>
                                  {address.addressLine2 && (
                                    <div className="break-words mt-1">{address.addressLine2}</div>
                                  )}
                                </div>
                                <div className="text-xs font-medium text-foreground/80">
                                  {address.city}, {address.stateProvince} {address.postalCode}
                                </div>
                                <div className="text-xs text-muted-foreground/70 uppercase tracking-wide">
                                  {address.country}
                                </div>
                              </div>

                              {/* Contact info */}
                              <div className="space-y-2 mb-3">
                                {address.contactPhone && (
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="text-primary shrink-0">📞</span>
                                    <span className="break-words">{address.contactPhone}</span>
                                  </div>
                                )}
                                {address.contactEmail && (
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="text-primary shrink-0">✉️</span>
                                    <span className="break-words">{address.contactEmail}</span>
                                  </div>
                                )}
                              </div>

                              {/* Special instructions */}
                              {address.specialInstructions && (
                                <div className="mt-3 p-2 bg-warning/10 border border-warning/30 rounded">
                                  <div className="flex items-start gap-2">
                                    <span className="text-warning text-xs shrink-0">💡</span>
                                    <div className="flex-1">
                                      <p className="text-xs font-medium text-warning mb-1">Note:</p>
                                      <p className="text-xs text-foreground/70 break-words leading-relaxed">{address.specialInstructions}</p>
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
                      <div className="p-6 border-2 border-dashed border-border rounded-lg text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
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
                              className={`group relative p-4 border-2 rounded-lg cursor-pointer transition-all duration-200 ${formData.deliveryAddressId === address.id
                                ? 'border-primary bg-primary/10 shadow-lg ring-1 ring-primary/30'
                                : 'border-border bg-card hover:border-primary/40 hover:bg-secondary/50'
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
                                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-destructive/20 rounded-full"
                                  title="Delete address"
                                >
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </button>

                                {/* Selection indicator */}
                                <div className={`w-4 h-4 rounded-full border-2 transition-all ${formData.deliveryAddressId === address.id
                                  ? 'border-primary bg-primary'
                                  : 'border-muted-foreground/40'
                                  }`}>
                                  {formData.deliveryAddressId === address.id && (
                                    <div className="w-full h-full rounded-full bg-primary flex items-center justify-center">
                                      <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Company/Contact header */}
                              <div className="pr-6 mb-3">
                                <div className="flex items-start gap-2 mb-2">
                                  <div className="flex-1">
                                    <h3 className="font-semibold text-sm text-foreground leading-tight">
                                      {address.companyName || address.contactPerson}
                                    </h3>
                                    {address.companyName && address.contactPerson && (
                                      <p className="text-xs text-muted-foreground mt-1 leading-tight">
                                        Contact: {address.contactPerson}
                                      </p>
                                    )}
                                  </div>
                                  {address.isDefault && (
                                    <Badge variant="default" className="text-xs bg-primary/20 text-primary border-primary/30 shrink-0">
                                      Default
                                    </Badge>
                                  )}
                                </div>
                              </div>

                              {/* Address */}
                              <div className="space-y-2 mb-3">
                                <div className="text-xs text-muted-foreground leading-relaxed">
                                  <div className="break-words">{address.addressLine1}</div>
                                  {address.addressLine2 && (
                                    <div className="break-words mt-1">{address.addressLine2}</div>
                                  )}
                                </div>
                                <div className="text-xs font-medium text-foreground/80">
                                  {address.city}, {address.stateProvince} {address.postalCode}
                                </div>
                                <div className="text-xs text-muted-foreground/70 uppercase tracking-wide">
                                  {address.country}
                                </div>
                              </div>

                              {/* Contact info */}
                              <div className="space-y-2 mb-3">
                                {address.contactPhone && (
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="text-primary shrink-0">📞</span>
                                    <span className="break-words">{address.contactPhone}</span>
                                  </div>
                                )}
                                {address.contactEmail && (
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="text-primary shrink-0">✉️</span>
                                    <span className="break-words">{address.contactEmail}</span>
                                  </div>
                                )}
                              </div>

                              {/* Special instructions */}
                              {address.specialInstructions && (
                                <div className="mt-3 p-2 bg-warning/10 border border-warning/30 rounded">
                                  <div className="flex items-start gap-2">
                                    <span className="text-warning text-xs shrink-0">💡</span>
                                    <div className="flex-1">
                                      <p className="text-xs font-medium text-warning mb-1">Note:</p>
                                      <p className="text-xs text-foreground/70 break-words leading-relaxed">{address.specialInstructions}</p>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="requestedDate">Requested Date</Label>
                  <Input
                    id="requestedDate"
                    type="date"
                    value={formData.requestedDate}
                    onChange={(e) => setFormData(prev => ({ ...prev, requestedDate: e.target.value }))}
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>

                <div>
                  <Label htmlFor="requestedTime">Requested Time</Label>
                  <Input
                    id="requestedTime"
                    type="time"
                    value={formData.requestedTime}
                    onChange={(e) => setFormData(prev => ({ ...prev, requestedTime: e.target.value }))}
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
                    transportMode={formData.transportMode || 'car'}
                    materialType={formData.materialType || 'general'}
                    onRouteCalculated={handleRouteCalculated}
                    onTransportModeChange={handleTransportModeChange}
                    onMaterialTypeChange={handleMaterialTypeChange}
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
                          onClick={() => {
                            const newDockAudit = [...dockAudit];
                            newDockAudit[idx] = { ...newDockAudit[idx], isOk: !newDockAudit[idx].isOk };
                            setDockAudit(newDockAudit);
                          }
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
                          onChange={(e) => {
                            const newDockAudit = [...dockAudit];
                            newDockAudit[idx] = { ...newDockAudit[idx], value: e.target.value };
                            setDockAudit(newDockAudit);
                          }
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
          {currentStep === 4 && (() => {
            const fromAddress = addresses.find(a => a.id === formData.fromAddressId);
            const toAddress = addresses.find(a => a.id === formData.deliveryAddressId);
            const auditOkCount = dockAudit.filter(r => r.isOk).length;
            const auditTotal = dockAudit.length;

            const handleExportPDF = () => {
              const el = document.getElementById('delivery-review-print');
              if (!el) return;

              const fromAddr = addresses.find(a => a.id === formData.fromAddressId);
              const toAddr = addresses.find(a => a.id === formData.deliveryAddressId);
              const okCount = dockAudit.filter(r => r.isOk).length;
              const partsTotal = selectedItems.reduce((s, i) => s + (i.bomItem.unitCost || 0) * i.deliveryQuantity, 0);
              const grandTotal = partsTotal + (routeData?.cost ?? 0);

              const addrBlock = (addr: any, label: string) => addr ? `
                <div class="addr-card">
                  <div class="addr-label">${label}</div>
                  <div class="addr-name">${addr.companyName || addr.contactPerson || ''}</div>
                  ${addr.companyName && addr.contactPerson ? `<div>${addr.contactPerson}</div>` : ''}
                  <div>${addr.addressLine1 || ''}</div>
                  ${addr.addressLine2 ? `<div>${addr.addressLine2}</div>` : ''}
                  <div>${addr.city || ''}, ${addr.stateProvince || ''} – ${addr.postalCode || ''}</div>
                  <div>${addr.country || ''}</div>
                  ${addr.contactPhone ? `<div>📞 ${addr.contactPhone}</div>` : ''}
                  ${addr.contactEmail ? `<div>✉ ${addr.contactEmail}</div>` : ''}
                  ${addr.specialInstructions ? `<div class="instructions"><b>Instructions:</b> ${addr.specialInstructions}</div>` : ''}
                </div>` : `<div class="addr-card"><i>Not selected</i></div>`;

              const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Delivery Order – Dock Audit Report</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#111;background:#fff;padding:12mm}
    h1{font-size:15pt;margin-bottom:2mm}
    h2{font-size:12pt;border-bottom:2px solid #333;padding-bottom:2mm;margin:6mm 0 3mm}
    h3{font-size:10pt;margin-bottom:2mm;color:#555}
    table{width:100%;border-collapse:collapse;margin-bottom:4mm}
    th,td{border:1px solid #bbb;padding:4px 7px;font-size:10pt;text-align:left;vertical-align:middle}
    th{background:#f0f0f0;font-weight:bold;text-align:center}
    td.center{text-align:center}
    td.right{text-align:right}
    .ok-badge{display:inline-block;width:18px;height:18px;border-radius:50%;background:#22c55e;color:#fff;text-align:center;line-height:18px;font-size:9pt;font-weight:bold}
    .no-badge{display:inline-block;width:18px;height:18px;border-radius:50%;background:#e5e7eb;color:#888;text-align:center;line-height:18px;font-size:9pt}
    .ok-row{background:#f0fdf4}
    .header-row{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:3mm}
    .score-box{text-align:right}
    .score-num{font-size:22pt;font-weight:bold;color:#1d4ed8}
    .badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:9pt;font-weight:bold}
    .badge-pass{background:#dcfce7;color:#166534}
    .badge-partial{background:#fef9c3;color:#854d0e}
    .badge-fail{background:#fee2e2;color:#991b1b}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:6mm;margin-bottom:4mm}
    .addr-card{border:1px solid #ddd;border-radius:4px;padding:4mm;font-size:10pt;line-height:1.6}
    .addr-label{font-size:8pt;text-transform:uppercase;letter-spacing:.05em;color:#666;margin-bottom:1mm}
    .addr-name{font-weight:bold;font-size:11pt}
    .instructions{margin-top:2mm;background:#f5f5f5;padding:2mm 3mm;border-radius:3px;font-size:9pt}
    .metrics-row{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;margin-bottom:4mm}
    .metric-box{border:1px solid #ddd;border-radius:4px;padding:3mm;text-align:center}
    .metric-val{font-size:14pt;font-weight:bold;color:#1d4ed8}
    .metric-val.green{color:#16a34a}
    .metric-val.sky{color:#0284c7}
    .metric-lbl{font-size:8pt;color:#666;margin-top:1mm}
    .breakdown-header{background:#f5f5f5;padding:2mm 4mm;font-size:9pt;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;color:#555;border:1px solid #ddd;border-bottom:none;border-radius:4px 4px 0 0}
    .breakdown-body{border:1px solid #ddd;border-radius:0 0 4px 4px;overflow:hidden}
    .breakdown-row{display:flex;justify-content:space-between;padding:2mm 4mm;font-size:10pt;border-bottom:1px solid #eee}
    .breakdown-row:last-child{border-bottom:none;font-weight:bold;background:#f9f9f9}
    .breakdown-muted{color:#555}
    .chips{display:flex;flex-wrap:wrap;gap:2mm;margin-top:3mm}
    .chip{display:inline-block;padding:1mm 3mm;border-radius:20px;font-size:9pt;background:#e0e7ff;color:#3730a3}
    .chip.secondary{background:#f3f4f6;color:#374151}
    .chip.warn{background:#fef3c7;color:#92400e}
    .footer{margin-top:6mm;display:flex;justify-content:space-between;font-size:9pt;color:#555;border-top:1px solid #ccc;padding-top:2mm}
    tfoot td{font-weight:bold;background:#f5f5f5}
    tfoot tr:last-child td{background:#eff6ff;color:#1d4ed8;font-size:11pt}
    .audit-footer{display:flex;justify-content:space-between;margin-top:3mm;padding-top:2mm;border-top:1px solid #eee;font-size:10pt}
    @page{margin:12mm;size:A4}
  </style>
</head>
<body>
  <div class="header-row">
    <div>
      <h1>Delivery Order Report</h1>
      <div style="font-size:9pt;color:#666">Generated: ${new Date().toLocaleString('en-IN')}</div>
    </div>
  </div>

  <!-- DOCK AUDIT -->
  <h2>6.5 Dock Audit Check Sheet</h2>
  <div class="header-row">
    <div></div>
    <div class="score-box">
      <span class="score-num">${okCount} / ${dockAudit.length}</span>
      <div style="font-size:9pt;color:#555">Items OK</div>
      <span class="badge ${okCount === dockAudit.length ? 'badge-pass' : okCount >= dockAudit.length * 0.7 ? 'badge-partial' : 'badge-fail'}">
        ${okCount === dockAudit.length ? '✓ PASS' : okCount >= dockAudit.length * 0.7 ? '⚠ PARTIAL' : '✗ FAIL'}
      </span>
    </div>
  </div>
  <table>
    <thead><tr><th style="width:40px">S.No</th><th>Activity</th><th>Specified</th><th style="width:50px">OK</th><th style="width:70px">Value</th></tr></thead>
    <tbody>
      ${dockAudit.map(r => `
        <tr class="${r.isOk ? 'ok-row' : ''}">
          <td class="center">${r.slNo}</td>
          <td><b>${r.activity}</b></td>
          <td style="color:#555">${r.specified}</td>
          <td class="center">${r.isOk ? '<span class="ok-badge">✓</span>' : '<span class="no-badge">—</span>'}</td>
          <td class="center">${r.value || '—'}</td>
        </tr>`).join('')}
    </tbody>
  </table>
  <div class="audit-footer">
    <span><b>Checked by:</b> ${checkedBy || '—'}</span>
    <span><b>Date:</b> ${new Date().toLocaleDateString('en-IN')}</span>
  </div>

  <!-- ADDRESSES -->
  <h2>Addresses</h2>
  <div class="grid2">
    ${addrBlock(fromAddr, '⬆ From (Pickup)')}
    ${addrBlock(toAddr, '⬇ To (Delivery)')}
  </div>

  <!-- ROUTE -->
  ${routeData ? `
  <h2>Route & Shipping Cost</h2>
  <div class="metrics-row">
    <div class="metric-box"><div class="metric-val">${routeData.distance} km</div><div class="metric-lbl">${routeData.isEstimated ? 'Est. Distance' : 'Road Distance'}</div></div>
    <div class="metric-box"><div class="metric-val">${(routeData.duration ?? 0) >= 60 ? `${Math.floor((routeData.duration ?? 0) / 60)}h ${(routeData.duration ?? 0) % 60}m` : `${routeData.duration ?? 0}m`}</div><div class="metric-lbl">${routeData.isEstimated ? 'Est. Time' : 'Travel Time'}</div></div>
    <div class="metric-box"><div class="metric-val green">₹${(routeData.cost ?? 0).toLocaleString('en-IN')}</div><div class="metric-lbl">Shipping Cost</div></div>
    <div class="metric-box"><div class="metric-val sky">${routeData.dataQualityScore ?? '—'}%</div><div class="metric-lbl">Data Quality</div></div>
  </div>
  ${routeData.costBreakdown ? `
  <div class="breakdown-header">Cost Breakdown</div>
  <div class="breakdown-body">
    <div class="breakdown-row"><span class="breakdown-muted">Transport (${routeData.distance} km)</span><span>₹${(routeData.costBreakdown.transportBase ?? 0).toLocaleString('en-IN')}</span></div>
    <div class="breakdown-row"><span class="breakdown-muted">Loading & Unloading</span><span>₹${(routeData.costBreakdown.loadingUnloading ?? 0).toLocaleString('en-IN')}</span></div>
    ${(routeData.costBreakdown.materialSurcharge ?? 0) > 0 ? `<div class="breakdown-row"><span class="breakdown-muted">Material Surcharge (${formData.materialType || 'general'})</span><span>₹${routeData.costBreakdown.materialSurcharge.toLocaleString('en-IN')}</span></div>` : ''}
    ${(routeData.costBreakdown.fuelTollSurcharge ?? 0) > 0 ? `<div class="breakdown-row"><span class="breakdown-muted">Fuel & Toll (6%)</span><span>₹${routeData.costBreakdown.fuelTollSurcharge.toLocaleString('en-IN')}</span></div>` : ''}
    <div class="breakdown-row"><span>Total Shipping</span><span style="color:#16a34a">₹${(routeData.cost ?? 0).toLocaleString('en-IN')}</span></div>
  </div>
  <div class="chips">
    ${formData.transportMode ? `<span class="chip">🚛 ${formData.transportMode}</span>` : ''}
    ${formData.materialType ? `<span class="chip secondary">📦 ${formData.materialType}</span>` : ''}
    ${routeData.isEstimated ? `<span class="chip warn">⚠ Estimated route</span>` : ''}
    ${routeData.routeProvider ? `<span class="chip secondary">via ${routeData.routeProvider}</span>` : ''}
  </div>` : ''}` : ''}

  <!-- ITEMS -->
  <h2>Items Summary (${selectedItems.length})</h2>
  <table>
    <thead><tr><th>Part No.</th><th>Description</th><th style="width:50px">Qty</th><th style="width:90px;text-align:right">Unit Cost</th><th style="width:90px;text-align:right">Total</th></tr></thead>
    <tbody>
      ${selectedItems.map(item => `
        <tr>
          <td><b>${item.bomItem.partNumber}</b></td>
          <td style="color:#555">${item.bomItem.description || ''}</td>
          <td class="center">${item.deliveryQuantity}</td>
          <td class="right">₹${(item.bomItem.unitCost || 0).toLocaleString('en-IN')}</td>
          <td class="right">₹${((item.bomItem.unitCost || 0) * item.deliveryQuantity).toLocaleString('en-IN')}</td>
        </tr>`).join('')}
    </tbody>
    <tfoot>
      <tr><td colspan="4" class="right">Parts Total</td><td class="right">₹${partsTotal.toLocaleString('en-IN')}</td></tr>
      ${routeData?.cost ? `<tr><td colspan="4" class="right">Shipping Cost</td><td class="right" style="color:#16a34a">₹${(routeData.cost).toLocaleString('en-IN')}</td></tr>` : ''}
      <tr><td colspan="4" class="right">Grand Total</td><td class="right">₹${grandTotal.toLocaleString('en-IN')}</td></tr>
    </tfoot>
  </table>

  <!-- META -->
  <div class="grid2" style="margin-top:3mm">
    <div><b>Priority:</b> ${formData.priority}</div>
    ${formData.requestedDeliveryDate ? `<div><b>Requested Delivery:</b> ${new Date(formData.requestedDeliveryDate).toLocaleDateString('en-IN')}</div>` : ''}
    ${formData.specialHandling ? `<div><b>Special Handling:</b> ${formData.specialHandling}</div>` : ''}
  </div>

  ${(partsPhotos.length > 0 || packingPhotos.length > 0 || documents.length > 0) ? `
  <h3 style="margin-top:4mm">Attachments</h3>
  <div style="font-size:10pt;line-height:1.8">
    ${partsPhotos.length > 0 ? `
    <div style="margin-bottom:2mm">
      <b>📷 Parts Photos (${partsPhotos.length}):</b><br/>
      ${partsPhotos.map(f => `<span style="display:inline-block;margin:1mm 2mm 1mm 0;padding:1mm 3mm;background:#f3f4f6;border:1px solid #ddd;border-radius:3px;font-size:9pt">${f.file.name}</span>`).join('')}
    </div>` : ''}
    ${packingPhotos.length > 0 ? `
    <div style="margin-bottom:2mm">
      <b>📦 Packing Photos (${packingPhotos.length}):</b><br/>
      ${packingPhotos.map(f => `<span style="display:inline-block;margin:1mm 2mm 1mm 0;padding:1mm 3mm;background:#f3f4f6;border:1px solid #ddd;border-radius:3px;font-size:9pt">${f.file.name}</span>`).join('')}
    </div>` : ''}
    ${documents.length > 0 ? `
    <div style="margin-bottom:2mm">
      <b>📄 Documents (${documents.length}):</b><br/>
      ${documents.map(f => `<span style="display:inline-block;margin:1mm 2mm 1mm 0;padding:1mm 3mm;background:#f3f4f6;border:1px solid #ddd;border-radius:3px;font-size:9pt">${f.file.name}</span>`).join('')}
    </div>` : ''}
  </div>` : ''}

  ${formData.deliveryInstructions ? `<h3 style="margin-top:4mm">Delivery Instructions</h3><p>${formData.deliveryInstructions}</p>` : ''}
  ${formData.notes ? `<h3 style="margin-top:4mm">Notes</h3><p>${formData.notes}</p>` : ''}

  <div class="footer">
    <span>Document 6.5 – Dock Audit Check Sheet</span>
    <span>Printed: ${new Date().toLocaleString('en-IN')}</span>
  </div>
</body>
</html>`;

              const win = window.open('', '_blank', 'width=900,height=700');
              if (!win) { alert('Please allow popups for this site to export PDF.'); return; }
              win.document.write(html);
              win.document.close();
              win.focus();
              setTimeout(() => { win.print(); }, 600);
            };

            return (
              <div id="delivery-review-print" className="space-y-6">

                {/* Export Button */}
                <div className="flex justify-end no-print">
                  <Button variant="outline" size="sm" onClick={handleExportPDF} className="gap-2">
                    <FileText className="h-4 w-4" />
                    Export as PDF
                  </Button>
                </div>

                {/* ── Section: Dock Audit Check Sheet 6.5 ─────────────────────── */}
                <Card className="border-2 border-primary/20">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">Document 6.5</div>
                        <CardTitle className="text-lg">Dock Audit Check Sheet</CardTitle>
                      </div>
                      <div className="text-right">
                        <div className="text-3xl font-bold text-primary">{auditOkCount} / {auditTotal}</div>
                        <div className="text-xs text-muted-foreground">Items OK</div>
                        <div className="mt-1">
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${auditOkCount === auditTotal ? 'bg-green-100 text-green-700' :
                            auditOkCount >= auditTotal * 0.7 ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                            {auditOkCount === auditTotal ? '✓ PASS' : auditOkCount >= auditTotal * 0.7 ? '⚠ PARTIAL' : '✗ FAIL'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="bg-muted/60">
                            <th className="border border-border px-3 py-2 text-center w-10">S.No</th>
                            <th className="border border-border px-3 py-2 text-left">Activity</th>
                            <th className="border border-border px-3 py-2 text-left">Specified</th>
                            <th className="border border-border px-3 py-2 text-center w-16">OK</th>
                            <th className="border border-border px-3 py-2 text-center w-24">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dockAudit.map((row) => (
                            <tr key={row.slNo} className={row.isOk ? 'bg-green-50/30' : ''}>
                              <td className="border border-border px-3 py-2 text-center font-medium">{row.slNo}</td>
                              <td className="border border-border px-3 py-2 font-medium">{row.activity}</td>
                              <td className="border border-border px-3 py-2 text-muted-foreground">{row.specified}</td>
                              <td className="border border-border px-3 py-2 text-center">
                                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${row.isOk ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'
                                  }`}>
                                  {row.isOk ? '✓' : '—'}
                                </span>
                              </td>
                              <td className="border border-border px-3 py-2 text-center">
                                {row.value || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t text-sm">
                      <span className="text-muted-foreground">Checked by:</span>
                      <span className="font-semibold">{checkedBy || '—'}</span>
                      <span className="text-muted-foreground">Date:</span>
                      <span className="font-semibold">{new Date().toLocaleDateString('en-IN')}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* ── Section: Addresses ─────────────────────────────────────── */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-green-500 text-white text-xs flex items-center justify-center font-bold">F</span>
                        From (Pickup)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm space-y-1">
                      {fromAddress ? (
                        <>
                          <div className="font-semibold text-foreground">{fromAddress.companyName || fromAddress.contactPerson}</div>
                          {fromAddress.companyName && fromAddress.contactPerson && (
                            <div className="text-muted-foreground">{fromAddress.contactPerson}</div>
                          )}
                          <div>{fromAddress.addressLine1}</div>
                          {fromAddress.addressLine2 && <div>{fromAddress.addressLine2}</div>}
                          <div>{fromAddress.city}, {fromAddress.stateProvince} – {fromAddress.postalCode}</div>
                          <div>{fromAddress.country}</div>
                          {fromAddress.contactPhone && (
                            <div className="flex items-center gap-1 text-muted-foreground pt-1">
                              <Phone className="h-3 w-3" />{fromAddress.contactPhone}
                            </div>
                          )}
                          {fromAddress.contactEmail && (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Mail className="h-3 w-3" />{fromAddress.contactEmail}
                            </div>
                          )}
                        </>
                      ) : <p className="text-muted-foreground italic">No pickup address selected</p>}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-bold">T</span>
                        To (Delivery)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm space-y-1">
                      {toAddress ? (
                        <>
                          <div className="font-semibold text-foreground">{toAddress.companyName || toAddress.contactPerson}</div>
                          {toAddress.companyName && toAddress.contactPerson && (
                            <div className="text-muted-foreground">{toAddress.contactPerson}</div>
                          )}
                          <div>{toAddress.addressLine1}</div>
                          {toAddress.addressLine2 && <div>{toAddress.addressLine2}</div>}
                          <div>{toAddress.city}, {toAddress.stateProvince} – {toAddress.postalCode}</div>
                          <div>{toAddress.country}</div>
                          {toAddress.contactPhone && (
                            <div className="flex items-center gap-1 text-muted-foreground pt-1">
                              <Phone className="h-3 w-3" />{toAddress.contactPhone}
                            </div>
                          )}
                          {toAddress.contactEmail && (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Mail className="h-3 w-3" />{toAddress.contactEmail}
                            </div>
                          )}
                          {toAddress.specialInstructions && (
                            <div className="mt-2 p-2 bg-muted rounded text-xs">
                              <strong>Instructions:</strong> {toAddress.specialInstructions}
                            </div>
                          )}
                        </>
                      ) : <p className="text-muted-foreground italic">No delivery address selected</p>}
                    </CardContent>
                  </Card>
                </div>

                {/* ── Section: Route & Cost Breakdown ────────────────────────── */}
                {routeData && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Truck className="h-4 w-4" />
                        Route & Shipping Cost
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {/* Metrics row */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                        <div className="text-center p-3 bg-muted/40 rounded-lg border">
                          <div className="text-xl font-bold text-primary">{routeData.distance} km</div>
                          <div className="text-xs text-muted-foreground mt-1">{routeData.isEstimated ? 'Est. Distance' : 'Road Distance'}</div>
                        </div>
                        <div className="text-center p-3 bg-muted/40 rounded-lg border">
                          <div className="text-xl font-bold text-primary">
                            {(routeData.duration ?? 0) >= 60
                              ? `${Math.floor((routeData.duration ?? 0) / 60)}h ${(routeData.duration ?? 0) % 60}m`
                              : `${routeData.duration ?? 0}m`}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">{routeData.isEstimated ? 'Est. Time' : 'Travel Time'}</div>
                        </div>
                        <div className="text-center p-3 bg-muted/40 rounded-lg border">
                          <div className="text-xl font-bold text-emerald-500">₹{(routeData.cost ?? 0).toLocaleString('en-IN')}</div>
                          <div className="text-xs text-muted-foreground mt-1">Shipping Cost</div>
                        </div>
                        <div className="text-center p-3 bg-muted/40 rounded-lg border">
                          <div className="text-xl font-bold text-sky-500">{routeData.dataQualityScore ?? '—'}%</div>
                          <div className="text-xs text-muted-foreground mt-1">Data Quality</div>
                        </div>
                      </div>

                      {/* Cost breakdown table */}
                      {routeData.costBreakdown && (
                        <div className="border rounded-lg overflow-hidden">
                          <div className="bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cost Breakdown</div>
                          <div className="divide-y">
                            <div className="flex justify-between px-3 py-2 text-sm">
                              <span className="text-muted-foreground">Transport ({routeData.distance} km)</span>
                              <span>₹{(routeData.costBreakdown.transportBase ?? 0).toLocaleString('en-IN')}</span>
                            </div>
                            <div className="flex justify-between px-3 py-2 text-sm">
                              <span className="text-muted-foreground">Loading & Unloading</span>
                              <span>₹{(routeData.costBreakdown.loadingUnloading ?? 0).toLocaleString('en-IN')}</span>
                            </div>
                            {(routeData.costBreakdown.materialSurcharge ?? 0) > 0 && (
                              <div className="flex justify-between px-3 py-2 text-sm">
                                <span className="text-muted-foreground">
                                  Material Surcharge ({formData.materialType || 'general'})
                                </span>
                                <span>₹{routeData.costBreakdown.materialSurcharge.toLocaleString('en-IN')}</span>
                              </div>
                            )}
                            {(routeData.costBreakdown.fuelTollSurcharge ?? 0) > 0 && (
                              <div className="flex justify-between px-3 py-2 text-sm">
                                <span className="text-muted-foreground">Fuel & Toll (6%)</span>
                                <span>₹{routeData.costBreakdown.fuelTollSurcharge.toLocaleString('en-IN')}</span>
                              </div>
                            )}
                            <div className="flex justify-between px-3 py-2 text-sm font-semibold bg-muted/20">
                              <span>Total Shipping</span>
                              <span className="text-emerald-500">₹{(routeData.cost ?? 0).toLocaleString('en-IN')}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Transport info */}
                      <div className="flex flex-wrap gap-2 mt-3">
                        {formData.transportMode && (
                          <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">
                            🚛 {formData.transportMode}
                          </span>
                        )}
                        {formData.materialType && (
                          <span className="text-xs px-2 py-1 rounded-full bg-secondary text-secondary-foreground font-medium">
                            📦 {formData.materialType}
                          </span>
                        )}
                        {routeData.isEstimated && (
                          <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700">
                            ⚠ Estimated route
                          </span>
                        )}
                        {routeData.routeProvider && (
                          <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                            via {routeData.routeProvider}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* ── Section: Order Summary ──────────────────────────────────── */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        Items Summary ({selectedItems.length})
                      </CardTitle>
                      <div className="text-right">
                        <div className="text-sm text-muted-foreground">Parts Value</div>
                        <div className="font-bold text-primary">₹{selectedItems.reduce((s, i) => s + (i.bomItem.unitCost || 0) * i.deliveryQuantity, 0).toLocaleString('en-IN')}</div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="bg-muted/60">
                            <th className="border border-border px-3 py-2 text-left">Part No.</th>
                            <th className="border border-border px-3 py-2 text-left">Description</th>
                            <th className="border border-border px-3 py-2 text-center">Qty</th>
                            <th className="border border-border px-3 py-2 text-right">Unit Cost</th>
                            <th className="border border-border px-3 py-2 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedItems.map((item) => (
                            <tr key={item.id}>
                              <td className="border border-border px-3 py-2 font-mono font-medium">{item.bomItem.partNumber}</td>
                              <td className="border border-border px-3 py-2 text-muted-foreground">{item.bomItem.description}</td>
                              <td className="border border-border px-3 py-2 text-center">{item.deliveryQuantity}</td>
                              <td className="border border-border px-3 py-2 text-right">₹{(item.bomItem.unitCost || 0).toLocaleString('en-IN')}</td>
                              <td className="border border-border px-3 py-2 text-right font-medium">₹{((item.bomItem.unitCost || 0) * item.deliveryQuantity).toLocaleString('en-IN')}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-muted/40 font-semibold">
                            <td colSpan={4} className="border border-border px-3 py-2 text-right">Parts Total</td>
                            <td className="border border-border px-3 py-2 text-right text-primary">
                              ₹{selectedItems.reduce((s, i) => s + (i.bomItem.unitCost || 0) * i.deliveryQuantity, 0).toLocaleString('en-IN')}
                            </td>
                          </tr>
                          {routeData?.cost && (
                            <tr className="bg-muted/40 font-semibold">
                              <td colSpan={4} className="border border-border px-3 py-2 text-right">Shipping Cost</td>
                              <td className="border border-border px-3 py-2 text-right text-emerald-500">
                                ₹{(routeData.cost).toLocaleString('en-IN')}
                              </td>
                            </tr>
                          )}
                          <tr className="bg-primary/5 font-bold text-base">
                            <td colSpan={4} className="border border-border px-3 py-2 text-right">Grand Total</td>
                            <td className="border border-border px-3 py-2 text-right text-primary">
                              ₹{(selectedItems.reduce((s, i) => s + (i.bomItem.unitCost || 0) * i.deliveryQuantity, 0) + (routeData?.cost ?? 0)).toLocaleString('en-IN')}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
                      <div><span className="text-muted-foreground">Priority:</span> <strong className="capitalize">{formData.priority}</strong></div>
                      {formData.requestedDeliveryDate && (
                        <div><span className="text-muted-foreground">Delivery Date:</span> <strong>{new Date(formData.requestedDeliveryDate).toLocaleDateString('en-IN')}</strong></div>
                      )}
                      {formData.carrierId && (
                        <div><span className="text-muted-foreground">Carrier:</span> <strong>{getAvailableCarriers().find(c => c.id === formData.carrierId)?.name || '—'}</strong></div>
                      )}
                    </div>
                    {/* Attachments file list */}
                    {(partsPhotos.length > 0 || packingPhotos.length > 0 || documents.length > 0) && (
                      <div className="mt-3 pt-3 border-t space-y-2">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Attachments</div>
                        {partsPhotos.length > 0 && (
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">📷 Parts Photos ({partsPhotos.length})</div>
                            <div className="flex flex-wrap gap-1">
                              {partsPhotos.map(f => (
                                <span key={f.id} className="text-xs px-2 py-0.5 rounded bg-muted border truncate max-w-[200px]" title={f.file.name}>{f.file.name}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {packingPhotos.length > 0 && (
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">📦 Packing Photos ({packingPhotos.length})</div>
                            <div className="flex flex-wrap gap-1">
                              {packingPhotos.map(f => (
                                <span key={f.id} className="text-xs px-2 py-0.5 rounded bg-muted border truncate max-w-[200px]" title={f.file.name}>{f.file.name}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {documents.length > 0 && (
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">📄 Documents ({documents.length})</div>
                            <div className="flex flex-wrap gap-1">
                              {documents.map(f => (
                                <span key={f.id} className="text-xs px-2 py-0.5 rounded bg-muted border truncate max-w-[200px]" title={f.file.name}>{f.file.name}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* ── Delivery Instructions & Notes ───────────────────────────── */}
                {(formData.deliveryInstructions || formData.notes) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {formData.deliveryInstructions && (
                      <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm">Delivery Instructions</CardTitle></CardHeader>
                        <CardContent><p className="text-sm text-muted-foreground">{formData.deliveryInstructions}</p></CardContent>
                      </Card>
                    )}
                    {formData.notes && (
                      <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-sm">Additional Notes</CardTitle></CardHeader>
                        <CardContent><p className="text-sm text-muted-foreground">{formData.notes}</p></CardContent>
                      </Card>
                    )}
                  </div>
                )}

              </div>
            );
          })()}
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
      
      {/* Recent Delivery Orders Section */}
      <div className="mt-12">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Recent Delivery Orders
              <Badge variant="outline" className="ml-auto">
                {recentOrders.length} orders
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ordersLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <span className="ml-2 text-muted-foreground">Loading delivery orders...</span>
              </div>
            ) : recentOrders.length === 0 ? (
              <div className="text-center py-8">
                <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-medium text-muted-foreground mb-2">No delivery orders yet</h3>
                <p className="text-sm text-muted-foreground">
                  Create your first delivery order using the workflow above
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {recentOrders.map((order) => (
                  <div
                    key={order.id}
                    className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <h4 className="font-semibold text-lg">
                            {order.items && order.items.length > 0 ? (
                              order.items.length === 1 
                                ? `${order.items[0].partNumber} - ${order.items[0].description?.slice(0, 60)}${order.items[0].description?.length > 60 ? '...' : ''}`
                                : `${order.items.length} Parts: ${order.items.map(item => item.partNumber).join(', ')}`
                            ) : (
                              order.orderNumber
                            )}
                          </h4>
                          <Badge variant={order.status === 'delivered' ? 'default' : 'secondary'}>
                            {order.status.replace('_', ' ').toUpperCase()}
                          </Badge>
                          <Badge variant="outline" className={`
                            ${order.priority === 'urgent' ? 'border-red-200 text-red-700 bg-red-50' : ''}
                            ${order.priority === 'high' ? 'border-orange-200 text-orange-700 bg-orange-50' : ''}
                            ${order.priority === 'standard' ? 'border-blue-200 text-blue-700 bg-blue-50' : ''}
                            ${order.priority === 'low' ? 'border-gray-200 text-gray-700 bg-gray-50' : ''}
                          `}>
                            {order.priority.toUpperCase()}
                          </Badge>
                          {/* Dock Audit Status Badge */}
                          {(() => {
                            if (!order.dockAudit || !Array.isArray(order.dockAudit) || order.dockAudit.length === 0) {
                              return (
                                <Badge variant="outline" className="border-yellow-200 text-yellow-700 bg-yellow-50">
                                  ⚠ PARTIAL
                                </Badge>
                              );
                            }
                            
                            const completedItems = order.dockAudit.filter(item => item && (item.ok === true || item.isOk === true)).length;
                            const totalItems = order.dockAudit.length;
                            const completionRate = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
                            
                            if (completionRate === 100) {
                              return (
                                <Badge variant="outline" className="border-green-200 text-green-700 bg-green-50">
                                  ✓ COMPLETE
                                </Badge>
                              );
                            } else if (completionRate >= 80) {
                              return (
                                <Badge variant="outline" className="border-blue-200 text-blue-700 bg-blue-50">
                                  ⚪ MOSTLY
                                </Badge>
                              );
                            } else {
                              return (
                                <Badge variant="outline" className="border-yellow-200 text-yellow-700 bg-yellow-50">
                                  ⚠ PARTIAL
                                </Badge>
                              );
                            }
                          })()}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          Order: {order.orderNumber}
                        </div>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              <span>Created: {new Date(order.createdAt).toLocaleDateString()}</span>
                            </div>
                            {order.requestedDeliveryDate && (
                              <div className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                <span>Delivery: {new Date(order.requestedDeliveryDate).toLocaleDateString()}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-1">
                              <Package className="h-4 w-4" />
                              <span>{order.itemsCount || order.items?.length || 0} items</span>
                            </div>
                            {/* Dock Audit Summary */}
                            {(() => {
                              if (order.dockAudit && Array.isArray(order.dockAudit) && order.dockAudit.length > 0) {
                                const completedItems = order.dockAudit.filter(item => item && (item.ok === true || item.isOk === true)).length;
                                const totalItems = order.dockAudit.length;
                                return (
                                  <div className="flex items-center gap-1">
                                    <CheckCircle className="h-4 w-4" />
                                    <span>Audit: {completedItems}/{totalItems} OK</span>
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                          {order.deliveryAddress && (
                            <div className="flex items-start gap-1">
                              <MapPin className="h-4 w-4 mt-0.5" />
                              <span className="line-clamp-2">
                                <span className="font-medium">{order.deliveryAddress.companyName}</span>, {order.deliveryAddress.city}, {order.deliveryAddress.country}
                              </span>
                            </div>
                          )}
                          {order.carrier && (
                            <div className="flex items-center gap-1">
                              <Truck className="h-4 w-4" />
                              <span>{order.carrier.name}</span>
                              {order.trackingNumber && (
                                <span className="text-xs bg-muted px-2 py-1 rounded font-mono">
                                  {order.trackingNumber}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        {order.totalDeliveryCostInr && (
                          <div className="text-right">
                            <div className="text-sm text-muted-foreground">Total Cost</div>
                            <div className="font-semibold">₹{order.totalDeliveryCostInr.toLocaleString()}</div>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="shrink-0"
                            onClick={() => {
                              setSelectedOrderId(order.id);
                              setShowOrderDetail(true);
                            }}
                          >
                            <svg className="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            View
                          </Button>
                          {/* Show Track button for all orders that have tracking capability */}
                          {onTrackOrder && (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="shrink-0"
                              onClick={() => onTrackOrder(order.id)}
                            >
                              <MapPin className="h-4 w-4 mr-1" />
                              Track
                            </Button>
                          )}
                          {order.status === 'draft' && (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="shrink-0 text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
                              onClick={async () => {
                                if (window.confirm('Are you sure you want to delete this delivery order? This action cannot be undone.')) {
                                  console.log('Attempting to delete order:', { id: order.id, projectId: order.projectId, status: order.status });
                                  try {
                                    await deleteOrderMutation.mutateAsync({ id: order.id, projectId: order.projectId });
                                  } catch (error) {
                                    console.error('Failed to delete delivery order:', error);
                                    const errorMessage = error?.response?.data?.message || error?.message || 'Failed to delete delivery order';
                                    toast.error(errorMessage);
                                  }
                                }
                              }}
                              disabled={deleteOrderMutation.isPending}
                            >
                              <svg className="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              {deleteOrderMutation.isPending ? 'Deleting...' : 'Delete'}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {recentOrders.length >= 10 && (
                  <div className="text-center pt-4">
                    <Button variant="ghost" size="sm" className="text-muted-foreground">
                      View all delivery orders →
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delivery Order Detail Dialog */}
      {selectedOrderId && (
        <DeliveryOrderDetailDialog
          isOpen={showOrderDetail}
          onClose={() => {
            setShowOrderDetail(false);
            setSelectedOrderId(null);
          }}
          orderId={selectedOrderId}
        />
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