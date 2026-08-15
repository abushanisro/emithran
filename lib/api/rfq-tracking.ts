/**
 * RFQ Tracking API
 * Production database-backed RFQ tracking system
 */

import { apiClient } from './client';

// ============================================================================
// TYPES
// ============================================================================

export enum RfqTrackingStatus {
  SENT = 'sent',
  RESPONDED = 'responded',
  EVALUATED = 'evaluated',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export type RfqTrackingVendor = {
  id: string;
  name: string;
  email?: string;
  responded: boolean;
  responseReceivedAt?: Date;
  quoteAmount?: number;
  leadTimeDays?: number;
};

export type RfqTrackingPart = {
  id: string;
  partNumber: string;
  description: string;
  process: string;
  quantity: number;
  file2dPath?: string;
  file3dPath?: string;
  has2dFile: boolean;
  has3dFile: boolean;
};

export type RfqTrackingRecord = {
  id: string;
  rfqId: string;
  userId: string;
  projectId?: string;
  rfqName: string;
  rfqNumber: string;
  status: RfqTrackingStatus;
  vendorCount: number;
  partCount: number;
  responseCount: number;
  sentAt: Date;
  firstResponseAt?: Date;
  lastResponseAt?: Date;
  completedAt?: Date;
  vendors: RfqTrackingVendor[];
  parts: RfqTrackingPart[];
};

export type RfqTrackingStats = {
  totalSent: number;
  totalResponded: number;
  totalCompleted: number;
  avgResponseTime: number;
  recentActivity: number;
};

export type CreateRfqTrackingData = {
  rfqId: string;
  projectId?: string;
  rfqName: string;
  rfqNumber: string;
  vendors: Array<{
    id: string;
    name: string;
    email?: string;
  }>;
  parts: Array<{
    id: string;
    partNumber: string;
    description: string;
    process: string;
    quantity?: number;
    file2dPath?: string;
    file3dPath?: string;
  }>;
};

export type UpdateVendorResponseData = {
  responded: boolean;
  quoteAmount?: number;
  leadTimeDays?: number;
};

export type UpdateTrackingStatusData = {
  status: RfqTrackingStatus;
};

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Create a new RFQ tracking record
 */
export async function createRfqTracking(
  data: CreateRfqTrackingData
): Promise<RfqTrackingRecord> {
  const response = await apiClient.post<RfqTrackingRecord>(
    '/rfq/tracking',
    data
  );
  return response;
}

/**
 * Get all RFQ tracking records for the current user
 */
export async function getRfqTrackingRecords(
  projectId?: string
): Promise<RfqTrackingRecord[]> {
  const url = projectId 
    ? `/rfq/tracking?projectId=${projectId}`
    : '/rfq/tracking';
  
  const response = await apiClient.get<RfqTrackingRecord[]>(url);
  return response || [];
}

/**
 * Get RFQ tracking record by ID
 */
export async function getRfqTrackingById(
  trackingId: string
): Promise<RfqTrackingRecord> {
  const response = await apiClient.get<RfqTrackingRecord>(
    `/rfq/tracking/${trackingId}`
  );
  return response;
}

/**
 * Get RFQ tracking statistics
 */
export async function getRfqTrackingStats(
  projectId?: string
): Promise<RfqTrackingStats> {
  const url = projectId 
    ? `/rfq/tracking/stats?projectId=${projectId}`
    : '/rfq/tracking/stats';
    
  const response = await apiClient.get<RfqTrackingStats>(url);
  return response;
}

/**
 * Update RFQ tracking status
 */
export async function updateRfqTrackingStatus(
  trackingId: string,
  data: UpdateTrackingStatusData
): Promise<void> {
  await apiClient.patch(
    `/rfq/tracking/${trackingId}/status`,
    data
  );
}

/**
 * Update vendor response information
 */
export async function updateVendorResponse(
  trackingId: string,
  vendorId: string,
  data: UpdateVendorResponseData
): Promise<void> {
  await apiClient.patch(
    `/rfq/tracking/${trackingId}/vendors/${vendorId}/response`,
    data
  );
}

/**
 * Delete RFQ tracking record (cancel RFQ)
 */
export async function deleteRfqTracking(trackingId: string): Promise<void> {
  await apiClient.delete(`/rfq/tracking/${trackingId}`);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate response rate percentage
 */
export function calculateResponseRate(tracking: RfqTrackingRecord): number {
  if (tracking.vendorCount === 0) return 0;
  return Math.round((tracking.responseCount / tracking.vendorCount) * 100);
}

/**
 * Get status color for UI display
 */
export function getStatusColor(status: RfqTrackingStatus): string {
  switch (status) {
    case RfqTrackingStatus.SENT:
      return 'blue';
    case RfqTrackingStatus.RESPONDED:
      return 'green';
    case RfqTrackingStatus.EVALUATED:
      return 'orange';
    case RfqTrackingStatus.COMPLETED:
      return 'gray';
    case RfqTrackingStatus.CANCELLED:
      return 'red';
    default:
      return 'gray';
  }
}

/**
 * Get human-readable status text
 */
export function getStatusText(status: RfqTrackingStatus): string {
  switch (status) {
    case RfqTrackingStatus.SENT:
      return 'Sent to Vendors';
    case RfqTrackingStatus.RESPONDED:
      return 'Responses Received';
    case RfqTrackingStatus.EVALUATED:
      return 'Under Evaluation';
    case RfqTrackingStatus.COMPLETED:
      return 'Completed';
    case RfqTrackingStatus.CANCELLED:
      return 'Cancelled';
    default:
      return 'Unknown';
  }
}

/**
 * Check if RFQ has any files attached
 */
export function hasAttachedFiles(tracking: RfqTrackingRecord): boolean {
  return tracking.parts.some(part => part.has2dFile || part.has3dFile);
}

/**
 * Get total file count for RFQ
 */
export function getTotalFileCount(tracking: RfqTrackingRecord): number {
  return tracking.parts.reduce((count, part) => {
    return count + (part.has2dFile ? 1 : 0) + (part.has3dFile ? 1 : 0);
  }, 0);
}

/**
 * Format average response time for display
 */
export function formatResponseTime(days: number): string {
  if (days === 0) return 'No responses yet';
  if (days < 1) return 'Less than 1 day';
  if (days === 1) return '1 day';
  return `${Math.round(days * 10) / 10} days`;
}

/**
 * Check if RFQ tracking is overdue (based on typical response time)
 */
export function isOverdue(tracking: RfqTrackingRecord, expectedDays: number = 7): boolean {
  if (tracking.status === RfqTrackingStatus.COMPLETED) return false;
  if (tracking.responseCount > 0) return false;
  
  const daysSinceSent = (Date.now() - new Date(tracking.sentAt).getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceSent > expectedDays;
}

/**
 * Get summary text for RFQ tracking card
 */
export function getRfqSummaryText(tracking: RfqTrackingRecord): string {
  const responseRate = calculateResponseRate(tracking);
  return `${tracking.vendorCount} vendors • ${tracking.partCount} parts • ${responseRate}% responded`;
}