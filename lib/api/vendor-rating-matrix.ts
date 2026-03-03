import { apiClient } from './client';
import { createApiLogger } from '../utils/component-logger';

const apiLogger = createApiLogger('VendorRatingMatrix');

export interface VendorRatingMatrix {
  id: string;
  nominationEvaluationId: string;
  vendorId: string;
  sNo: number;
  category: string;
  assessmentAspects: string;
  sectionWiseCapabilityPercent: number;
  riskMitigationPercent: number;
  minorNC: number;
  majorNC: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ENTERPRISE: Frontend interface (camelCase)
export interface UpdateVendorRatingData {
  id: string;
  sectionWiseCapabilityPercent?: number;
  riskMitigationPercent?: number;
  minorNC?: number;
  majorNC?: number;
  assessmentAspects?: string;
}

// ENTERPRISE: Backend DTO interface (exact match for validation)
export interface BatchVendorRatingUpdateItemDto {
  id: string;
  assessmentAspects?: string;
  sectionWiseCapabilityPercent?: number;
  riskMitigationPercent?: number;
  minorNC?: number;
  majorNC?: number;
}

// ENTERPRISE: Root request DTO structure
export interface BatchVendorRatingUpdateDto {
  updates: BatchVendorRatingUpdateItemDto[];
}

export interface VendorRatingOverallScores {
  sectionWiseCapability: number;
  riskMitigation: number;
  totalMinorNC: number;
  totalMajorNC: number;
  totalRecords: number;
}

/**
 * Get vendor rating matrix data
 */
export async function getVendorRatingMatrix(
  nominationId: string,
  vendorId: string
): Promise<VendorRatingMatrix[]> {
  if (!nominationId || !vendorId) {
    throw new Error('Missing required parameters: nominationId or vendorId');
  }

  try {
    const response = await apiClient.get(`/supplier-nominations/${nominationId}/vendors/${vendorId}/rating-matrix`);

    // Extract data - API client returns direct array
    const data = Array.isArray(response) ? response : [];

    // API already returns camelCase format, use directly
    const transformed = data.map((item: any) => {
      return {
        id: item.id,
        nominationEvaluationId: item.nominationEvaluationId,
        vendorId: item.vendorId,
        sNo: item.sNo,
        category: item.category,
        assessmentAspects: item.assessmentAspects,
        sectionWiseCapabilityPercent: item.sectionWiseCapabilityPercent !== undefined ? item.sectionWiseCapabilityPercent : 0,
        riskMitigationPercent: item.riskMitigationPercent !== undefined ? item.riskMitigationPercent : 0,
        minorNC: item.minorNc !== undefined ? item.minorNc : 0,  // Note: API returns 'minorNc', component expects 'minorNC'
        majorNC: item.majorNc !== undefined ? item.majorNc : 0,  // Note: API returns 'majorNc', component expects 'majorNC'
        sortOrder: item.sortOrder,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      };
    });

    return transformed;
  } catch (error) {
    // Enhanced error handling for network failures
    const err = error as any;
    const status = err?.response?.status;
    const statusText = err?.response?.statusText;

    apiLogger.logApiError('GET', `/supplier-nominations/${nominationId}/vendors/${vendorId}/rating-matrix`, error, {
      status,
      statusText,
      nominationId,
      vendorId,
      errorType: err?.constructor?.name || 'Unknown'
    });

    // Return empty array for 404s (no data exists yet)
    if (status === 404) {
      return [];
    }

    throw error;
  }
}

/**
 * Initialize empty vendor rating matrix
 */
export async function initializeVendorRatingMatrix(
  nominationId: string,
  vendorId: string
): Promise<VendorRatingMatrix[]> {
  if (!nominationId || !vendorId) {
    throw new Error('Missing required parameters for initialization');
  }

  try {
    const response = await apiClient.post(`/supplier-nominations/${nominationId}/vendors/${vendorId}/rating-matrix/init`);

    // Extract data - API client returns direct array
    const dataArray = Array.isArray(response) ? response : [];

    // API now returns the created data directly
    if (Array.isArray(dataArray) && dataArray.length > 0) {
      // Transform database format to component format
      const transformed = dataArray.map((item: any) => ({
        id: item.id,
        nominationEvaluationId: item.nominationEvaluationId,
        vendorId: item.vendorId,
        sNo: item.sNo,
        category: item.category,
        assessmentAspects: item.assessmentAspects,
        sectionWiseCapabilityPercent: item.sectionWiseCapabilityPercent !== undefined ? item.sectionWiseCapabilityPercent : 0,
        riskMitigationPercent: item.riskMitigationPercent !== undefined ? item.riskMitigationPercent : 0,
        minorNC: item.minorNc !== undefined ? item.minorNc : 0,
        majorNC: item.majorNc !== undefined ? item.majorNc : 0,
        sortOrder: item.sortOrder,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      }));

      return transformed;
    }

    // Fallback: fetch the newly created data if response is empty
    const fallbackData = await getVendorRatingMatrix(nominationId, vendorId);
    return fallbackData;
  } catch (error) {
    const err = error as any;
    const status = err?.response?.status;

    apiLogger.logApiError('POST', `/supplier-nominations/${nominationId}/vendors/${vendorId}/rating-matrix/init`, error, {
      status,
      nominationId,
      vendorId
    });

    throw error;
  }
}

/**
 * Update individual rating matrix item
 */
export async function updateVendorRatingItem(
  nominationId: string,
  vendorId: string,
  ratingId: string,
  updateData: Partial<UpdateVendorRatingData>
): Promise<void> {
  try {
    await apiClient.put(
      `/supplier-nominations/${nominationId}/vendors/${vendorId}/rating-matrix/${ratingId}`,
      updateData
    );
  } catch (error) {
    console.error('Failed to update vendor rating item:', error);
    throw error;
  }
}

/**
 * ENTERPRISE BEST PRACTICE: Batch update vendor rating matrix
 */
/**
 * ENTERPRISE: Type-safe data transformation utilities
 * Ensures data integrity and validation compliance
 */
class VendorRatingDataTransformer {
  /**
   * PRINCIPAL ENGINEER: Ultra-strict DTO transformation
   * Only includes fields that are actually changing and valid
   */
  static transformToDto(updates: UpdateVendorRatingData[]): BatchVendorRatingUpdateDto {
    const transformedUpdates: BatchVendorRatingUpdateItemDto[] = [];

    for (const update of updates) {
      // Skip invalid records
      if (!update.id) {

        continue;
      }

      // Start with minimal valid structure
      const transformed: any = { id: update.id };
      let hasChanges = false;

      // Only include fields that are actually defined and valid
      // Send in both camelCase and snake_case formats to ensure backend compatibility
      if (update.sectionWiseCapabilityPercent !== undefined &&
        update.sectionWiseCapabilityPercent !== null &&
        !isNaN(Number(update.sectionWiseCapabilityPercent))) {
        const value = Number(update.sectionWiseCapabilityPercent);
        transformed.sectionWiseCapabilityPercent = value;
        transformed.section_wise_capability_percent = value;  // Backend compatibility
        hasChanges = true;
      }

      if (update.riskMitigationPercent !== undefined &&
        update.riskMitigationPercent !== null &&
        !isNaN(Number(update.riskMitigationPercent))) {
        const value = Number(update.riskMitigationPercent);
        transformed.riskMitigationPercent = value;
        transformed.risk_mitigation_percent = value;  // Backend compatibility
        hasChanges = true;
      }

      if (update.minorNC !== undefined &&
        update.minorNC !== null &&
        Number.isInteger(Number(update.minorNC))) {
        const value = Number(update.minorNC);
        transformed.minorNC = value;
        transformed.minor_nc = value;  // Backend compatibility
        hasChanges = true;
      }

      if (update.majorNC !== undefined &&
        update.majorNC !== null &&
        Number.isInteger(Number(update.majorNC))) {
        const value = Number(update.majorNC);
        transformed.majorNC = value;
        transformed.major_nc = value;  // Backend compatibility
        hasChanges = true;
      }

      if (update.assessmentAspects !== undefined &&
        update.assessmentAspects !== null &&
        typeof update.assessmentAspects === 'string' &&
        update.assessmentAspects.trim().length > 0) {
        transformed.assessmentAspects = update.assessmentAspects.trim();
        hasChanges = true;
      }

      // Only include records that have actual changes
      if (hasChanges) {
        transformedUpdates.push(transformed as BatchVendorRatingUpdateItemDto);
      }
    }

    return { updates: transformedUpdates };
  }

  /**
   * Validate DTO structure before sending
   * Prevents runtime validation errors
   */
  static validateDto(dto: BatchVendorRatingUpdateDto): void {
    if (!dto.updates || !Array.isArray(dto.updates)) {
      throw new Error('Invalid DTO structure: updates must be an array');
    }

    if (dto.updates.length === 0) {
      throw new Error('No updates provided');
    }

    dto.updates.forEach((update, index) => {
      if (!update.id) {
        throw new Error(`Update at index ${index} missing required id field`);
      }

      // Validate numeric fields with enterprise-grade constraints
      const numericFields = [
        { name: 'sectionWiseCapabilityPercent', min: 0, max: 100 },
        { name: 'riskMitigationPercent', min: 0, max: 100 },
        { name: 'minorNC', min: 0, max: 999 },
        { name: 'majorNC', min: 0, max: 999 }
      ];

      numericFields.forEach(({ name, min, max }) => {
        const value = (update as any)[name];
        if (value !== undefined) {
          const numValue = Number(value);
          if (isNaN(numValue) || numValue < min || numValue > max) {
            throw new Error(`Update at index ${index} has invalid ${name}: must be a number between ${min} and ${max}, received ${value}`);
          }
        }
      });
    });
  }
}

export async function batchUpdateVendorRatingMatrix(
  nominationId: string,
  vendorId: string,
  updates: UpdateVendorRatingData[]
): Promise<VendorRatingMatrix[]> {
  // Declare payload outside try block to make it accessible in catch block
  let payload: BatchVendorRatingUpdateDto | undefined;

  try {
    // ENTERPRISE: Pre-flight validation
    if (!nominationId || !vendorId) {
      throw new Error('Missing required parameters: nominationId or vendorId');
    }

    if (!updates || updates.length === 0) {
      throw new Error('No updates provided');
    }

    // Simple validation - let the API handle the rest
    if (!nominationId || !vendorId) {
      throw new Error("Missing required IDs for rating matrix update");
    }

    // Get or initialize the rating matrix
    let existingData: VendorRatingMatrix[];
    try {
      existingData = await getVendorRatingMatrix(nominationId, vendorId);
    } catch (fetchError) {
      // 404 is expected when no data exists - don't treat as error
      const fe = fetchError as any;
      if (fe?.response?.status !== 404) {
        console.error('Failed to fetch existing data before update:', fetchError);
        throw new Error(`Cannot update rating matrix: ${fe?.message ?? 'Unknown error'}`);
      }

      existingData = [];
    }

    // Auto-initialize if no data exists
    if (!existingData || existingData.length === 0) {
      try {

        existingData = await initializeVendorRatingMatrix(nominationId, vendorId);

        // If initialization still returns no data, proceed anyway (data might exist but not be returned)
        if (!existingData || existingData.length === 0) {

          // Try to fetch again after a short delay
          await new Promise(resolve => setTimeout(resolve, 500));
          try {
            existingData = await getVendorRatingMatrix(nominationId, vendorId);
          } catch (refetchError) {

            existingData = [];
          }
        }

      } catch (initError) {
        console.error('Failed to auto-initialize rating matrix:', initError);
        // Don't fail completely - try the update anyway

        existingData = [];
      }
    }

    // ENTERPRISE: Type-safe transformation and validation
    payload = VendorRatingDataTransformer.transformToDto(updates);

    // Debug: Log what's being sent to the API
    console.log('Batch update payload being sent:', {
      originalUpdates: updates,
      transformedPayload: payload,
      updateCount: payload.updates.length,
      sampleUpdate: payload.updates[0]
    });

    // If no valid updates after transformation, don't proceed
    if (!payload.updates || payload.updates.length === 0) {

      return await getVendorRatingMatrix(nominationId, vendorId);
    }

    VendorRatingDataTransformer.validateDto(payload);

    const response = await apiClient.put(
      `/supplier-nominations/${nominationId}/vendors/${vendorId}/rating-matrix/batch`,
      payload
    );

    apiLogger.logApiResponse('PUT', `/supplier-nominations/${nominationId}/vendors/${vendorId}/rating-matrix/batch`,
      response, { updateCount: payload.updates.length });

    // The batch update endpoint returns data directly as an array
    const responseData = Array.isArray(response) ? response : [];

    if (responseData.length > 0) {
      const transformedData = responseData.map((item: any) => ({
        id: item.id,
        nominationEvaluationId: item.nominationEvaluationId,
        vendorId: item.vendorId,
        sNo: item.sNo,
        category: item.category,
        assessmentAspects: item.assessmentAspects,
        sectionWiseCapabilityPercent: item.sectionWiseCapabilityPercent !== undefined ? item.sectionWiseCapabilityPercent : 0,
        riskMitigationPercent: item.riskMitigationPercent !== undefined ? item.riskMitigationPercent : 0,
        minorNC: item.minorNc !== undefined ? item.minorNc : 0,
        majorNC: item.majorNc !== undefined ? item.majorNc : 0,
        sortOrder: item.sortOrder,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      }));

      apiLogger.info('Batch update completed successfully', {
        updateCount: payload.updates.length,
        returnedRecords: transformedData.length
      });

      return transformedData;
    }

    // Fallback: fetch fresh data if no response data
    return getVendorRatingMatrix(nominationId, vendorId);

  } catch (error) {
    // Enhanced error logging to capture the actual problem
    const err = error as any;
    const status = err?.response?.status;
    const statusText = err?.response?.statusText;
    const message = err?.response?.data?.message || err?.message || "Unknown error";
    const responseData = err?.response?.data;

    console.error('Batch update failed:', {
      status,
      statusText,
      message,
      responseData,
      error: error,
      nominationId,
      vendorId,
      updateCount: updates.length,
      payloadUpdates: payload?.updates?.length || 0
    });

    apiLogger.logApiError('PUT', `/supplier-nominations/${nominationId}/vendors/${vendorId}/rating-matrix/batch`, error, {
      status,
      statusText,
      errorMessage: message,
      responseData,
      updateCount: updates.length,
      nominationId,
      vendorId
    });

    throw error;
  }
}

/**
 * Get calculated overall scores
 */
export async function getVendorRatingOverallScores(
  nominationId: string,
  vendorId: string
): Promise<VendorRatingOverallScores> {
  if (!nominationId || !vendorId) {
    return {
      sectionWiseCapability: 0,
      riskMitigation: 0,
      totalMinorNC: 0,
      totalMajorNC: 0,
      totalRecords: 0
    };
  }

  try {
    const response = await apiClient.get(`/supplier-nominations/${nominationId}/vendors/${vendorId}/rating-matrix/overall-scores`);

    // API client returns data directly, not wrapped in .data
    const data = response;
    if (data) {
      const d = data as any;
      return {
        sectionWiseCapability: d.sectionWiseCapability || 0,
        riskMitigation: d.riskMitigation || 0,
        totalMinorNC: d.totalMinorNC || 0,
        totalMajorNC: d.totalMajorNC || 0,
        totalRecords: d.totalRecords || 0
      };
    }

    return {
      sectionWiseCapability: 0,
      riskMitigation: 0,
      totalMinorNC: 0,
      totalMajorNC: 0,
      totalRecords: 0
    };
  } catch (error) {
    const err = error as any;
    const status = err?.response?.status;

    apiLogger.logApiError('GET', `/supplier-nominations/${nominationId}/vendors/${vendorId}/rating-matrix/overall-scores`, error, {
      status,
      nominationId,
      vendorId
    });

    // Always return valid default scores instead of throwing
    return {
      sectionWiseCapability: 0,
      riskMitigation: 0,
      totalMinorNC: 0,
      totalMajorNC: 0,
      totalRecords: 0
    };
  }
}