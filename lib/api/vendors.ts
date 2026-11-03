/**
 * Vendors API - Comprehensive Vendor Management System
 */

import { apiClient } from './client';

// ============================================================================
// TYPES
// ============================================================================

export type Vendor = {
  id: string;
  supplierCode?: string;
  name: string;
  addresses?: string;
  website?: string;
  companyPhone?: string;
  companyEmail?: string;
  majorCustomers?: string;
  countriesServed?: string;
  companyTurnover?: string;

  // Services
  industries?: string[];
  process?: string[];
  materials?: string[];

  // Quality
  certifications?: string[];
  inspectionOptions?: string;
  qmsMetrics?: string;
  qmsProcedures?: string;

  // Facility
  manufacturingWorkshop?: string;
  warehouse?: boolean;
  packing?: boolean;
  logisticsTransportation?: boolean;
  maximumProductionCapacity?: string;
  averageCapacityUtilization?: number;
  numHoursInShift?: number;
  numShiftsInDay?: number;
  numWorkingDaysPerWeek?: number;
  inHouseMaterialTesting?: boolean;

  // Staff
  numOperators?: number;
  numEngineers?: number;
  numProductionManagers?: number;

  // Location
  city?: string;
  state?: string;
  country?: string;

  // Documents
  companyProfileUrl?: string;
  machineListUrl?: string;

  // Status
  status: 'active' | 'inactive' | 'pending';
  vendorType: 'supplier' | 'oem' | 'both';

  // Metadata
  userId: string;
  createdAt?: string;
  updatedAt?: string;

  // From view
  equipmentCount?: number;
  serviceCount?: number;
  primaryContacts?: VendorContact[];
};

export type VendorEquipment = {
  id: string;
  vendorId: string;
  manufacturer?: string;
  model?: string;
  equipmentType?: string;
  equipmentSubtype?: string;
  bedSizeLengthMm?: number;
  bedSizeWidthMm?: number;
  bedSizeHeightMm?: number;
  tonnage?: number;
  process?: string;
  quantity?: number;
  yearOfManufacture?: number;
  marketPrice?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type VendorService = {
  id: string;
  vendorId: string;
  serviceCategory: string;
  serviceSubcategory?: string;
  materialCapability?: string[];
  minTonnage?: number;
  maxTonnage?: number;
  minPartSizeMm?: number;
  maxPartSizeMm?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type VendorContact = {
  id: string;
  vendorId: string;
  name: string;
  designation?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateVendorData = Partial<Omit<Vendor, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'equipmentCount' | 'serviceCount' | 'primaryContacts'>>;
export type UpdateVendorData = Partial<CreateVendorData>;

export type VendorQuery = {
  search?: string;
  status?: Vendor['status'];
  vendorType?: Vendor['vendorType'];
  city?: string;
  state?: string;
  country?: string;
  process?: string[];
  industries?: string[];
  certifications?: string[];
  equipmentType?: string;
  minTonnage?: number;
  maxTonnage?: number;
  minBedLength?: number;
  minBedWidth?: number;
  minBedHeight?: number;
  page?: number;
  limit?: number;
};

export type VendorsResponse = {
  vendors: Vendor[];
  total: number;
  page: number;
  limit: number;
};

export type VendorPerformance = {
  vendorId: string;
  totalOrders: number;
  onTimeDeliveryRate: number;
  qualityScore: number;
  averageLeadTime: number;
  costCompetitiveness: number;
};

export type CsvImportResult = {
  message: string;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  total: number;
  errors?: Array<{
    row: number;
    name?: string;
    error: string;
  }>;
};

// ============================================================================
// API METHODS
// ============================================================================

export const vendorsApi = {
  // ============================================================================
  // VENDOR CRUD
  // ============================================================================

  /**
   * Get all vendors with comprehensive filtering
   */
  getAll: async (query?: VendorQuery): Promise<VendorsResponse> => {
    const params = new URLSearchParams();
    if (query?.search) params.append('search', query.search);
    if (query?.status) params.append('status', query.status);
    if (query?.vendorType) params.append('vendorType', query.vendorType);
    if (query?.city) params.append('city', query.city);
    if (query?.state) params.append('state', query.state);
    if (query?.country) params.append('country', query.country);
    if (query?.process) query.process.forEach(p => params.append('process', p));
    if (query?.industries) query.industries.forEach(i => params.append('industries', i));
    if (query?.certifications) query.certifications.forEach(c => params.append('certifications', c));
    if (query?.equipmentType) params.append('equipmentType', query.equipmentType);
    if (query?.minTonnage) params.append('minTonnage', query.minTonnage.toString());
    if (query?.maxTonnage) params.append('maxTonnage', query.maxTonnage.toString());
    if (query?.minBedLength) params.append('minBedLength', query.minBedLength.toString());
    if (query?.minBedWidth) params.append('minBedWidth', query.minBedWidth.toString());
    if (query?.minBedHeight) params.append('minBedHeight', query.minBedHeight.toString());
    if (query?.page) params.append('page', query.page.toString());
    if (query?.limit) params.append('limit', query.limit.toString());

    const queryString = params.toString();
    return apiClient.get<VendorsResponse>(
      `/vendors${queryString ? `?${queryString}` : ''}`,
    );
  },

  /**
   * Get vendor by ID
   */
  getById: async (id: string): Promise<Vendor> => {
    return apiClient.get<Vendor>(`/vendors/${id}`);
  },

  /**
   * Create new vendor
   */
  create: async (data: CreateVendorData): Promise<Vendor> => {
    return apiClient.post<Vendor>('/vendors', data);
  },

  /**
   * Update vendor
   */
  update: async (id: string, data: UpdateVendorData): Promise<Vendor> => {
    return apiClient.put<Vendor>(`/vendors/${id}`, data);
  },

  /**
   * Delete vendor
   */
  delete: async (id: string): Promise<void> => {
    return apiClient.delete(`/vendors/${id}`);
  },

  /**
   * Delete all vendors
   */
  deleteAll: async (): Promise<{ deleted: number }> => {
    return apiClient.delete<{ deleted: number }>('/vendors?confirm=delete-all');
  },

  /**
   * Upload vendors from CSV file
   */
  uploadCsv: async (file: File): Promise<CsvImportResult> => {
    const formData = new FormData();
    formData.append('file', file);
    // Use 5 minute timeout for large CSV files
    return apiClient.uploadFiles<CsvImportResult>('/vendors/imports', formData, { timeout: 300000 });
  },

  // ============================================================================
  // VENDOR EQUIPMENT
  // ============================================================================

  /**
   * Get equipment for a vendor
   */
  getEquipment: async (vendorId: string): Promise<VendorEquipment[]> => {
    return apiClient.get<VendorEquipment[]>(`/vendors/${vendorId}/equipment`);
  },

  /**
   * Add equipment to vendor
   */
  createEquipment: async (data: Partial<VendorEquipment>): Promise<VendorEquipment> => {
    return apiClient.post<VendorEquipment>('/vendors/equipment', data);
  },

  /**
   * Update equipment
   */
  updateEquipment: async (id: string, data: Partial<VendorEquipment>): Promise<VendorEquipment> => {
    return apiClient.put<VendorEquipment>(`/vendors/equipment/${id}`, data);
  },

  /**
   * Delete equipment
   */
  deleteEquipment: async (id: string): Promise<void> => {
    return apiClient.delete(`/vendors/equipment/${id}`);
  },

  // ============================================================================
  // VENDOR SERVICES
  // ============================================================================

  /**
   * Get services for a vendor
   */
  getServices: async (vendorId: string): Promise<VendorService[]> => {
    return apiClient.get<VendorService[]>(`/vendors/${vendorId}/services`);
  },

  /**
   * Add service to vendor
   */
  createService: async (data: Partial<VendorService>): Promise<VendorService> => {
    return apiClient.post<VendorService>('/vendors/services', data);
  },

  /**
   * Update service
   */
  updateService: async (id: string, data: Partial<VendorService>): Promise<VendorService> => {
    return apiClient.put<VendorService>(`/vendors/services/${id}`, data);
  },

  /**
   * Delete service
   */
  deleteService: async (id: string): Promise<void> => {
    return apiClient.delete(`/vendors/services/${id}`);
  },

  // ============================================================================
  // VENDOR CONTACTS
  // ============================================================================

  /**
   * Get contacts for a vendor
   */
  getContacts: async (vendorId: string): Promise<VendorContact[]> => {
    return apiClient.get<VendorContact[]>(`/vendors/${vendorId}/contacts`);
  },

  /**
   * Add contact to vendor
   */
  createContact: async (data: Partial<VendorContact>): Promise<VendorContact> => {
    return apiClient.post<VendorContact>('/vendors/contacts', data);
  },

  /**
   * Update contact
   */
  updateContact: async (id: string, data: Partial<VendorContact>): Promise<VendorContact> => {
    return apiClient.put<VendorContact>(`/vendors/contacts/${id}`, data);
  },

  /**
   * Delete contact
   */
  deleteContact: async (id: string): Promise<void> => {
    return apiClient.delete(`/vendors/contacts/${id}`);
  },

  /**
   * Get vendor capabilities
   */
  getCapabilities: async (): Promise<string[]> => {
    return apiClient.get<string[]>('/vendors/capabilities');
  },

  /**
   * Get all unique equipment types
   */
  getEquipmentTypes: async (): Promise<string[]> => {
    return apiClient.get<string[]>('/vendors/equipment-types');
  },
};
