import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '../client';
import { useAuthReady } from '@/lib/providers/supabase-auth-provider';

// Production-ready types
export interface DeliveryOrder {
  id: string;
  orderNumber: string;
  projectId: string;
  projectName?: string;
  inspectionId?: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failed_delivery' | 'returned' | 'cancelled';
  priority: 'low' | 'standard' | 'high' | 'urgent';
  requestedDeliveryDate?: string;
  estimatedDeliveryDate?: string;
  actualDeliveryDate?: string;
  deliveryWindowStart?: string;
  deliveryWindowEnd?: string;
  totalWeightKg?: number;
  totalVolumeM3?: number;
  packageCount: number;
  specialHandlingRequirements?: string;
  deliveryInstructions?: string;
  deliveryCostInr?: number;
  insuranceCostInr?: number;
  handlingCostInr?: number;
  totalDeliveryCostInr?: number;
  trackingNumber?: string;
  carrierReference?: string;
  pickupDate?: string;
  notes?: string;
  deliveryAddress?: DeliveryAddress;
  billingAddress?: DeliveryAddress;
  carrier?: Carrier;
  items: DeliveryItem[];
  tracking?: TrackingEvent[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface DeliveryItem {
  id: string;
  bomItemId: string;
  qualityApprovedItemId: string;
  partNumber: string;
  description: string;
  material?: string;
  unitOfMeasure?: string;
  approvedQuantity: number;
  deliveryQuantity: number;
  unitWeightKg?: number;
  totalWeightKg?: number;
  unitDimensionsCm?: string;
  packagingType?: string;
  packagingInstructions?: string;
  hazmatClassification?: string;
  qcCertificateNumber?: string;
  batchNumber?: string;
  serialNumbers?: string[];
  unitValueInr?: number;
  totalValueInr?: number;
  qualityGrade?: string;
  approvalNotes?: string;
}

export interface QualityApprovedItem {
  id: string;
  inspectionId: string;
  bomItemId: string;
  approvedQuantity: number;
  approvalStatus: string;
  approvalNotes?: string;
  qcCertificateNumber?: string;
  deliveryReady: boolean;
  approvedAt: string;
  approvedBy: string;
  bomItem: {
    id: string;
    partNumber: string;
    description: string;
    material: string;
    unitOfMeasure: string;
    unitCost: number;
  };
  inspection: {
    id: string;
    name: string;
    projectId: string;
    status: string;
    type: string;
  };
}

export interface TrackingEvent {
  id: string;
  eventType: string;
  eventDescription: string;
  eventTimestamp: string;
  locationName?: string;
  locationAddress?: string;
  latitude?: number;
  longitude?: number;
  carrierStatusCode?: string;
  internalNotes?: string;
  proofOfDelivery?: any;
  createdAt: string;
}

export interface DeliveryAddress {
  id?: string;
  projectId?: string;
  addressType?: string;
  companyName?: string;
  contactPerson: string;
  contactPhone?: string;
  contactEmail?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateProvince?: string;
  postalCode: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  specialInstructions?: string;
  isDefault?: boolean;
}

export interface Carrier {
  id: string;
  name: string;
  code: string;
  contactEmail?: string;
  contactPhone?: string;
  serviceAreas?: any;
  capabilities?: any;
  performanceMetrics?: any;
}

export interface DeliveryMetrics {
  totalDeliveries: number;
  deliveredCount: number;
  onTimeDeliveries: number;
  deliverySuccessRate: string;
  onTimeDeliveryRate: string;
  avgDeliveryCost: number;
  avgDelayDays: number;
  totalDeliveryCost: number;
  qualityMetrics?: any;
  carrierPerformance?: any[];
}

export interface DeliveryBatch {
  id: string;
  batchNumber: string;
  projectId: string;
  status: 'production' | 'qc_review' | 'pending' | 'ready_for_shipment' | 'shipped' | 'delivered';
  itemCount: number;
  totalValue: number;
  expectedCompletion?: string;
  completedAt?: string;
  notes?: string;
}

export interface Shipment {
  id: string;
  shipmentNumber: string;
  deliveryOrderId: string;
  origin: string;
  destination: string;
  status: 'scheduled' | 'in_transit' | 'delivered' | 'delayed' | 'cancelled';
  departureDate?: string;
  estimatedArrival?: string;
  actualArrival?: string;
  carrierName: string;
  trackingNumber: string;
  route?: string[];
}

// Query Keys
const QUERY_KEYS = {
  deliveryOrders: (projectId?: string, filters?: any) => ['delivery-orders', projectId, filters],
  deliveryOrder: (id: string) => ['delivery-order', id],
  availableItems: (projectId: string) => ['delivery-available-items', projectId],
  deliveryAddresses: (projectId: string) => ['delivery-addresses', projectId],
  carriers: () => ['delivery-carriers'],
  deliveryMetrics: (projectId?: string, startDate?: string, endDate?: string) => ['delivery-metrics', projectId, startDate, endDate],
  tracking: (orderId: string) => ['delivery-tracking', orderId],
  deliveryBatches: (projectId?: string) => ['delivery-batches', projectId],
  shipments: (filters?: any) => ['shipments', filters],
  invoices: (filters?: any) => ['delivery-invoices', filters],
} as const;

// Get available QC-approved items for delivery
export function useAvailableItemsForDelivery(projectId: string) {
  const authReady = useAuthReady();
  
  return useQuery({
    queryKey: QUERY_KEYS.availableItems(projectId),
    queryFn: async (): Promise<QualityApprovedItem[]> => {
      const response = await apiClient.get(`/delivery/available-items/${projectId}`);
      return response.data || [];
    },
    enabled: !!projectId && authReady,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

// Get delivery orders
export function useDeliveryOrders(
  projectId?: string,
  filters?: {
    status?: string | string[];
    priority?: string | string[];
    carrierId?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }
) {
  const authReady = useAuthReady();
  
  return useQuery({
    queryKey: QUERY_KEYS.deliveryOrders(projectId, filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (projectId) params.append('projectId', projectId);
      if (filters?.status) {
        if (Array.isArray(filters.status)) {
          filters.status.forEach(s => params.append('status', s));
        } else {
          params.append('status', filters.status);
        }
      }
      if (filters?.priority) {
        if (Array.isArray(filters.priority)) {
          filters.priority.forEach(p => params.append('priority', p));
        } else {
          params.append('priority', filters.priority);
        }
      }
      if (filters?.carrierId) params.append('carrierId', filters.carrierId);
      if (filters?.search) params.append('search', filters.search);
      if (filters?.startDate) params.append('startDate', filters.startDate);
      if (filters?.endDate) params.append('endDate', filters.endDate);
      if (filters?.page) params.append('page', filters.page.toString());
      if (filters?.limit) params.append('limit', filters.limit.toString());
      if (filters?.sortBy) params.append('sortBy', filters.sortBy);
      if (filters?.sortOrder) params.append('sortOrder', filters.sortOrder);

      const response = await apiClient.get(`/delivery/orders?${params.toString()}`);
      return response.data;
    },
    enabled: authReady,
    staleTime: 1000 * 60 * 1, // 1 minute
  });
}

// Get single delivery order
export function useDeliveryOrder(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.deliveryOrder(id),
    queryFn: async (): Promise<DeliveryOrder> => {
      const response = await apiClient.get(`/delivery/orders/${id}`);
      return response.data.data;
    },
    enabled: !!id,
    staleTime: 1000 * 60 * 1, // 1 minute
  });
}

// Create delivery order
export function useCreateDeliveryOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      projectId: string;
      inspectionId?: string;
      deliveryAddressId: string;
      billingAddressId?: string;
      carrierId?: string;
      priority?: 'low' | 'standard' | 'high' | 'urgent';
      requestedDeliveryDate?: string;
      deliveryWindowStart?: string;
      deliveryWindowEnd?: string;
      packageCount?: number;
      specialHandlingRequirements?: string;
      deliveryInstructions?: string;
      deliveryCostInr?: number;
      insuranceCostInr?: number;
      handlingCostInr?: number;
      notes?: string;
      items: Array<{
        qualityApprovedItemId: string;
        bomItemId: string;
        approvedQuantity: number;
        deliveryQuantity: number;
        unitWeightKg?: number;
        unitDimensionsCm?: string;
        packagingType?: string;
        packagingInstructions?: string;
        hazmatClassification?: string;
        qcCertificateNumber?: string;
        batchNumber?: string;
        serialNumbers?: string[];
        unitValueInr?: number;
      }>;
    }): Promise<DeliveryOrder> => {
      const response = await apiClient.post('/delivery/orders', data);
      return response.data.data;
    },
    onSuccess: (newOrder, variables) => {
      toast.success(`Delivery order ${newOrder.orderNumber} created successfully`);
      
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.deliveryOrders(variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.availableItems(variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.deliveryMetrics(variables.projectId),
      });
    },
    onError: (error: any) => {
      console.error('Failed to create delivery order:', error);
      toast.error(error?.response?.data?.message || 'Failed to create delivery order');
    },
  });
}

// Update delivery order
export function useUpdateDeliveryOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: {
      id: string;
      data: {
        carrierId?: string;
        status?: string;
        priority?: string;
        requestedDeliveryDate?: string;
        estimatedDeliveryDate?: string;
        trackingNumber?: string;
        carrierReference?: string;
        pickupDate?: string;
        deliveryCostInr?: number;
        insuranceCostInr?: number;
        handlingCostInr?: number;
        notes?: string;
      };
    }): Promise<DeliveryOrder> => {
      const response = await apiClient.put(`/delivery/orders/${id}`, data);
      return response.data.data;
    },
    onSuccess: (updatedOrder) => {
      toast.success(`Delivery order ${updatedOrder.orderNumber} updated successfully`);
      
      queryClient.setQueryData(
        QUERY_KEYS.deliveryOrder(updatedOrder.id),
        updatedOrder
      );
      
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.deliveryOrders(updatedOrder.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.deliveryMetrics(updatedOrder.projectId),
      });
    },
    onError: (error: any) => {
      console.error('Failed to update delivery order:', error);
      toast.error(error?.response?.data?.message || 'Failed to update delivery order');
    },
  });
}

// Add tracking event
export function useAddTrackingEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      deliveryOrderId: string;
      eventType: string;
      eventDescription: string;
      eventTimestamp: string;
      locationName?: string;
      locationAddress?: string;
      latitude?: number;
      longitude?: number;
      carrierStatusCode?: string;
      internalNotes?: string;
      proofOfDelivery?: any;
    }) => {
      const response = await apiClient.post('/delivery/tracking', data);
      return response.data;
    },
    onSuccess: (_, variables) => {
      toast.success('Tracking event added successfully');
      
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.deliveryOrder(variables.deliveryOrderId),
      });
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.tracking(variables.deliveryOrderId),
      });
    },
    onError: (error: any) => {
      console.error('Failed to add tracking event:', error);
      toast.error(error?.response?.data?.message || 'Failed to add tracking event');
    },
  });
}

// Get delivery addresses
export function useDeliveryAddresses(projectId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.deliveryAddresses(projectId),
    queryFn: async (): Promise<DeliveryAddress[]> => {
      const response = await apiClient.get(`/delivery/addresses/${projectId}`);
      // Backend returns: { success: true, data: addresses, metadata: {...} }
      return response.data.data || response.data || [];
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Create delivery address
export function useCreateDeliveryAddress() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: DeliveryAddress): Promise<DeliveryAddress> => {
      const response = await apiClient.post('/delivery/addresses', data);
      return response.data.data;
    },
    onSuccess: (newAddress, variables) => {
      toast.success('Delivery address created successfully');
      
      // Use projectId from the original request variables if not in response
      const projectId = newAddress?.projectId || newAddress?.project_id || variables.projectId;
      if (projectId) {
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.deliveryAddresses(projectId),
        });
      }
    },
    onError: (error: any) => {
      console.error('Failed to create delivery address:', error);
      toast.error(error?.response?.data?.message || 'Failed to create delivery address');
    },
  });
}

// Get carriers
export function useCarriers() {
  return useQuery({
    queryKey: QUERY_KEYS.carriers(),
    queryFn: async (): Promise<Carrier[]> => {
      const response = await apiClient.get('/delivery/carriers');
      return response.data.data || [];
    },
    staleTime: 1000 * 60 * 10, // 10 minutes
  });
}

// Get delivery metrics
export function useDeliveryMetrics(projectId?: string, startDate?: string, endDate?: string) {
  const authReady = useAuthReady();
  
  return useQuery({
    queryKey: QUERY_KEYS.deliveryMetrics(projectId, startDate, endDate),
    queryFn: async (): Promise<DeliveryMetrics> => {
      const params = new URLSearchParams();
      if (projectId) params.append('projectId', projectId);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await apiClient.get(`/delivery/metrics?${params.toString()}`);
      return response.data.data || {
        totalDeliveries: 0,
        deliveredCount: 0,
        onTimeDeliveries: 0,
        deliverySuccessRate: "0%",
        onTimeDeliveryRate: "0%",
        avgDeliveryCost: 0,
        avgDelayDays: 0,
        totalDeliveryCost: 0
      };
    },
    enabled: authReady,
    staleTime: 1000 * 60 * 3, // 3 minutes
  });
}

// Get delivery batches
export function useDeliveryBatches(projectId?: string) {
  return useQuery({
    queryKey: QUERY_KEYS.deliveryBatches(projectId),
    queryFn: async (): Promise<DeliveryBatch[]> => {
      const params = new URLSearchParams();
      if (projectId) params.append('projectId', projectId);

      const response = await apiClient.get(`/delivery/batches?${params.toString()}`);
      return response.data.data || [];
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

// Get shipments
export function useShipments(filters?: {
  projectId?: string;
  status?: string;
  origin?: string;
  destination?: string;
}) {
  return useQuery({
    queryKey: QUERY_KEYS.shipments(filters),
    queryFn: async (): Promise<Shipment[]> => {
      const params = new URLSearchParams();
      if (filters?.projectId) params.append('projectId', filters.projectId);
      if (filters?.status) params.append('status', filters.status);
      if (filters?.origin) params.append('origin', filters.origin);
      if (filters?.destination) params.append('destination', filters.destination);

      const response = await apiClient.get(`/delivery/shipments?${params.toString()}`);
      return response.data.data || [];
    },
    staleTime: 1000 * 60 * 1, // 1 minute
  });
}

// Cancel delivery order
export function useCancelDeliveryOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }): Promise<DeliveryOrder> => {
      const response = await apiClient.post(`/delivery/orders/${id}/cancel`, { reason });
      return response.data.data;
    },
    onSuccess: (cancelledOrder) => {
      toast.success(`Delivery order ${cancelledOrder.orderNumber} cancelled successfully`);
      
      queryClient.setQueryData(
        QUERY_KEYS.deliveryOrder(cancelledOrder.id),
        cancelledOrder
      );
      
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.deliveryOrders(cancelledOrder.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.deliveryMetrics(cancelledOrder.projectId),
      });
    },
    onError: (error: any) => {
      console.error('Failed to cancel delivery order:', error);
      toast.error(error?.response?.data?.message || 'Failed to cancel delivery order');
    },
  });
}