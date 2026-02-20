/**
 * React Query hooks for Vendors API - Comprehensive Vendor Management
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { vendorsApi } from '../vendors';
import type {
  CreateVendorData,
  UpdateVendorData,
  VendorQuery,
  VendorEquipment,
  VendorService,
  VendorContact,
} from '../vendors';
export type { Vendor } from '../vendors';
import { ApiError } from '../client';
import { toast } from 'sonner';


export const vendorKeys = {
  all: ['vendors'] as const,
  lists: () => [...vendorKeys.all, 'list'] as const,
  list: (query?: VendorQuery) => [...vendorKeys.lists(), query] as const,
  details: () => [...vendorKeys.all, 'detail'] as const,
  detail: (id: string) => [...vendorKeys.details(), id] as const,
  equipment: (vendorId: string) => [...vendorKeys.detail(vendorId), 'equipment'] as const,
  services: (vendorId: string) => [...vendorKeys.detail(vendorId), 'services'] as const,
  contacts: (vendorId: string) => [...vendorKeys.detail(vendorId), 'contacts'] as const,
  performance: (id: string) => [...vendorKeys.detail(id), 'performance'] as const,
  capabilities: () => [...vendorKeys.all, 'capabilities'] as const,
  equipmentTypes: () => [...vendorKeys.all, 'equipment-types'] as const,
};

// ============================================================================
// VENDOR HOOKS
// ============================================================================

export function useVendors(query?: VendorQuery, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: vendorKeys.list(query),
    queryFn: () => vendorsApi.getAll(query),
    staleTime: 1000 * 60 * 5,
    enabled: options?.enabled,
  });
}

export function useVendor(id: string) {
  return useQuery({
    queryKey: vendorKeys.detail(id),
    queryFn: () => vendorsApi.getById(id),
    enabled: !!id,
    staleTime: 1000 * 60 * 5,
  });
}

export function useVendorPerformance(id: string) {
  return useQuery({
    queryKey: vendorKeys.performance(id),
    queryFn: () => vendorsApi.getPerformance(id),
    enabled: !!id,
    staleTime: 1000 * 60 * 10,
  });
}

export function useVendorCapabilities() {
  return useQuery({
    queryKey: vendorKeys.capabilities(),
    queryFn: () => vendorsApi.getCapabilities(),
    staleTime: 1000 * 60 * 30,
  });
}

export function useEquipmentTypes() {
  return useQuery({
    queryKey: vendorKeys.equipmentTypes(),
    queryFn: () => vendorsApi.getEquipmentTypes(),
    staleTime: 1000 * 60 * 30,
  });
}

export function useCreateVendor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateVendorData) => vendorsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.lists() });
      toast.success('Vendor created successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check all required vendor information is filled out correctly.');
      } else if (error.status === 409) {
        toast.error('A vendor with this name or ID already exists.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to create vendors.');
      } else if (error.status === 422) {
        toast.error('Please ensure contact information and addresses are valid.');
      } else {
        toast.error('Unable to create vendor. Please try again or contact support.');
      }
    },
  });
}

export function useUpdateVendor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateVendorData }) =>
      vendorsApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.lists() });
      queryClient.invalidateQueries({ queryKey: vendorKeys.detail(variables.id) });
      // Also invalidate vendor ratings cache since it includes vendor data
      queryClient.invalidateQueries({ queryKey: ['vendorRatings'] });
      toast.success('Vendor updated successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check that all vendor information is valid.');
      } else if (error.status === 404) {
        toast.error('This vendor no longer exists. It may have been deleted.');
      } else if (error.status === 409) {
        toast.error('Another user is editing this vendor. Please refresh and try again.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to edit this vendor.');
      } else if (error.status === 422) {
        toast.error('Please ensure contact information and addresses are valid.');
      } else {
        toast.error('Unable to save changes. Please try again or contact support.');
      }
    },
  });
}

export function useDeleteVendor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => vendorsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.lists() });
      toast.success('Vendor deleted successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 404) {
        toast.error('This vendor has already been deleted.');
      } else if (error.status === 409) {
        toast.error('Cannot delete vendor because it is being used in active projects or RFQs.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to delete this vendor.');
      } else {
        toast.error('Unable to delete vendor. Please try again or contact support.');
      }
    },
  });
}

export function useDeleteAllVendors() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => vendorsApi.deleteAll(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.lists() });
      toast.success(`Successfully deleted ${data.deleted} vendors`);
    },
    onError: (error: ApiError) => {
      if (error.status === 403) {
        toast.error('You do not have permission to delete all vendors.');
      } else if (error.status === 409) {
        toast.error('Cannot delete vendors because some are being used in active projects.');
      } else if (error.status === 429) {
        toast.error('Too many deletion requests. Please wait a moment and try again.');
      } else {
        toast.error('Unable to delete all vendors. Please try again or contact support.');
      }
    },
  });
}

export function useUploadVendorsCsv() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => vendorsApi.uploadCsv(file),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.lists() });

      if (data.errors && data.errors.length > 0) {
        console.group('Vendor CSV Upload Errors');
        console.table(data.errors.slice(0, 10));
        console.groupEnd();
      }

      // Build comprehensive status message
      const parts = [];
      if (data.created > 0) parts.push(`${data.created} created`);
      if (data.updated > 0) parts.push(`${data.updated} updated`);
      if (data.skipped > 0) parts.push(`${data.skipped} skipped`);
      if (data.failed > 0) parts.push(`${data.failed} failed`);

      const summary = parts.join(', ');

      if (data.failed > 0) {
        toast.error(
          `Upload completed: ${summary}. Check console for error details.`,
          { duration: 10000 }
        );
      } else if (data.created > 0 || data.updated > 0) {
        toast.success(`Successfully imported vendors: ${summary}`);
      } else {
        toast.info(`No changes made: ${summary}`);
      }
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('The CSV file format is invalid. Please check the column headers and data.');
      } else if (error.status === 413) {
        toast.error('The CSV file is too large. Please split it into smaller files.');
      } else if (error.status === 422) {
        toast.error('Some vendor data in the CSV is invalid. Please check the format and try again.');
      } else if (error.status === 429) {
        toast.error('Too many upload requests. Please wait a moment and try again.');
      } else {
        toast.error('Unable to upload CSV file. Please try again or contact support.');
      }
    },
  });
}

// ============================================================================
// VENDOR EQUIPMENT HOOKS
// ============================================================================

export function useVendorEquipment(vendorId: string | undefined) {
  return useQuery({
    queryKey: vendorKeys.equipment(vendorId || ''),
    queryFn: () => vendorsApi.getEquipment(vendorId!),
    enabled: !!vendorId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateVendorEquipment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<VendorEquipment>) => vendorsApi.createEquipment(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.equipment(data.vendorId) });
      queryClient.invalidateQueries({ queryKey: vendorKeys.detail(data.vendorId) });
      toast.success('Equipment added successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check all equipment details are filled out correctly.');
      } else if (error.status === 404) {
        toast.error('This vendor no longer exists. Please refresh the page.');
      } else if (error.status === 409) {
        toast.error('Equipment with this name already exists for this vendor.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to add equipment for this vendor.');
      } else {
        toast.error('Unable to add equipment. Please try again or contact support.');
      }
    },
  });
}

export function useUpdateVendorEquipment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<VendorEquipment> }) =>
      vendorsApi.updateEquipment(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.equipment(data.vendorId) });
      toast.success('Equipment updated successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check that all equipment information is valid.');
      } else if (error.status === 404) {
        toast.error('This equipment no longer exists. It may have been deleted.');
      } else if (error.status === 409) {
        toast.error('Another user is editing this equipment. Please refresh and try again.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to edit this equipment.');
      } else {
        toast.error('Unable to update equipment. Please try again or contact support.');
      }
    },
  });
}

export function useDeleteVendorEquipment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, vendorId }: { id: string; vendorId: string }) => {
      return vendorsApi.deleteEquipment(id).then(() => ({ vendorId }));
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.equipment(data.vendorId) });
      toast.success('Equipment deleted successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 404) {
        toast.error('This equipment has already been deleted.');
      } else if (error.status === 409) {
        toast.error('Cannot delete equipment because it is being used in active processes.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to delete this equipment.');
      } else {
        toast.error('Unable to delete equipment. Please try again or contact support.');
      }
    },
  });
}

// ============================================================================
// VENDOR SERVICES HOOKS
// ============================================================================

export function useVendorServices(vendorId: string | undefined) {
  return useQuery({
    queryKey: vendorKeys.services(vendorId || ''),
    queryFn: () => vendorsApi.getServices(vendorId!),
    enabled: !!vendorId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateVendorService() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<VendorService>) => vendorsApi.createService(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.services(data.vendorId) });
      toast.success('Service added successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check all service details are filled out correctly.');
      } else if (error.status === 404) {
        toast.error('This vendor no longer exists. Please refresh the page.');
      } else if (error.status === 409) {
        toast.error('Service with this name already exists for this vendor.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to add services for this vendor.');
      } else {
        toast.error('Unable to add service. Please try again or contact support.');
      }
    },
  });
}

export function useUpdateVendorService() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<VendorService> }) =>
      vendorsApi.updateService(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.services(data.vendorId) });
      toast.success('Service updated successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check that all service information is valid.');
      } else if (error.status === 404) {
        toast.error('This service no longer exists. It may have been deleted.');
      } else if (error.status === 409) {
        toast.error('Another user is editing this service. Please refresh and try again.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to edit this service.');
      } else {
        toast.error('Unable to update service. Please try again or contact support.');
      }
    },
  });
}

export function useDeleteVendorService() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, vendorId }: { id: string; vendorId: string }) => {
      return vendorsApi.deleteService(id).then(() => ({ vendorId }));
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.services(data.vendorId) });
      toast.success('Service deleted successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 404) {
        toast.error('This service has already been deleted.');
      } else if (error.status === 409) {
        toast.error('Cannot delete service because it is being used in active projects.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to delete this service.');
      } else {
        toast.error('Unable to delete service. Please try again or contact support.');
      }
    },
  });
}

// ============================================================================
// VENDOR CONTACTS HOOKS
// ============================================================================

export function useVendorContacts(vendorId: string | undefined) {
  return useQuery({
    queryKey: vendorKeys.contacts(vendorId || ''),
    queryFn: () => vendorsApi.getContacts(vendorId!),
    enabled: !!vendorId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateVendorContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<VendorContact>) => vendorsApi.createContact(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.contacts(data.vendorId) });
      toast.success('Contact added successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check all contact details are filled out correctly.');
      } else if (error.status === 404) {
        toast.error('This vendor no longer exists. Please refresh the page.');
      } else if (error.status === 409) {
        toast.error('Contact with this email already exists for this vendor.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to add contacts for this vendor.');
      } else if (error.status === 422) {
        toast.error('Please ensure the email address and phone number are valid.');
      } else {
        toast.error('Unable to add contact. Please try again or contact support.');
      }
    },
  });
}

export function useUpdateVendorContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<VendorContact> }) =>
      vendorsApi.updateContact(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.contacts(data.vendorId) });
      toast.success('Contact updated successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 400) {
        toast.error('Please check that all contact information is valid.');
      } else if (error.status === 404) {
        toast.error('This contact no longer exists. It may have been deleted.');
      } else if (error.status === 409) {
        toast.error('Another user is editing this contact. Please refresh and try again.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to edit this contact.');
      } else if (error.status === 422) {
        toast.error('Please ensure the email address and phone number are valid.');
      } else {
        toast.error('Unable to update contact. Please try again or contact support.');
      }
    },
  });
}

export function useDeleteVendorContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, vendorId }: { id: string; vendorId: string }) => {
      return vendorsApi.deleteContact(id).then(() => ({ vendorId }));
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vendorKeys.contacts(data.vendorId) });
      toast.success('Contact deleted successfully');
    },
    onError: (error: ApiError) => {
      if (error.status === 404) {
        toast.error('This contact has already been deleted.');
      } else if (error.status === 409) {
        toast.error('Cannot delete contact because they are the primary contact for active projects.');
      } else if (error.status === 403) {
        toast.error('You do not have permission to delete this contact.');
      } else {
        toast.error('Unable to delete contact. Please try again or contact support.');
      }
    },
  });
}
