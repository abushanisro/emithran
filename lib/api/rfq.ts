/**
 * RFQ (Request for Quotation) API client
 */

import { apiClient } from './client';

export interface CreateRfqData {
  rfqName: string;
  projectId?: string;
  bomItemIds: string[];
  vendorIds: string[];
  quoteDeadline?: Date;
  selectionType: 'single' | 'multiple' | 'competitive';
  buyerName?: string;
  emailBody?: string;
  emailSubject?: string;
}

export interface RfqRecord {
  id: string;
  userId: string;
  projectId?: string;
  rfqName: string;
  rfqNumber: string;
  bomItemIds: string[];
  vendorIds: string[];
  quoteDeadline?: Date;
  selectionType: string;
  buyerName?: string;
  emailBody?: string;
  emailSubject?: string;
  status: 'draft' | 'sent' | 'responses_received' | 'evaluated' | 'closed';
  sentAt?: Date;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RfqSummary {
  id: string;
  rfqName: string;
  rfqNumber: string;
  status: 'draft' | 'sent' | 'responses_received' | 'evaluated' | 'closed';
  itemCount: number;
  vendorCount: number;
  responseCount: number;
  createdAt: Date;
  sentAt?: Date;
  quoteDeadline?: Date;
}

export interface RfqQuery {
  projectId?: string;
}

export const rfqApi = {
  /**
   * Create a new RFQ
   */
  async create(data: CreateRfqData): Promise<RfqRecord> {
    return apiClient.post<RfqRecord>('/rfq', data);
  },

  /**
   * Get all RFQs for the current user
   */
  async getAll(query?: RfqQuery): Promise<RfqSummary[]> {
    const params = new URLSearchParams();
    if (query?.projectId) {
      params.append('projectId', query.projectId);
    }

    const url = params.toString() ? `/rfq?${params.toString()}` : '/rfq';
    return apiClient.get<RfqSummary[]>(url);
  },

  /**
   * Get RFQ details by ID
   */
  async getById(id: string): Promise<RfqRecord> {
    return apiClient.get<RfqRecord>(`/rfq/${id}`);
  },

  /**
   * Send RFQ to vendors
   */
  async send(id: string): Promise<{ message: string }> {
    return apiClient.patch<{ message: string }>(`/rfq/${id}/send`, {});
  },

  /**
   * Close RFQ (no more responses accepted)
   */
  async close(id: string): Promise<{ message: string }> {
    return apiClient.patch<{ message: string }>(`/rfq/${id}/close`, {});
  },
};