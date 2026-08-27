import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { 
  RfqTrackingResponseDto, 
  RfqTrackingStatsDto,
  RfqTrackingStatus 
} from '../dto/rfq-tracking.dto';

export interface CreateRfqTrackingData {
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
}


export interface UpdateVendorResponseData {
  responded: boolean;
  quoteAmount?: number;
  leadTimeDays?: number;
}

@Injectable()
export class RfqTrackingService {
  private readonly logger = new Logger(RfqTrackingService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Create RFQ tracking record when RFQ is sent
   * Industry Standard: Enforce project isolation
   */
  async createTracking(
    userId: string,
    accessToken: string,
    organizationId: string | undefined,
    data: CreateRfqTrackingData
  ): Promise<RfqTrackingResponseDto> {
    // Validate project_id is provided (security requirement)
    if (!data.projectId) {
      throw new BadRequestException('Project ID is required for RFQ tracking creation');
    }

    const client = this.supabaseService.getClient(accessToken);

    try {
      // Create main tracking record
      const { data: trackingRecord, error: trackingError } = await client
        .from('rfq_tracking')
        .insert({
          rfq_id: data.rfqId,
          user_id: userId,
          organization_id: organizationId ?? null,
          project_id: data.projectId,
          rfq_name: data.rfqName,
          rfq_number: data.rfqNumber,
          vendor_count: data.vendors.length,
          part_count: data.parts.length,
          status: 'sent'
        })
        .select()
        .single();

      if (trackingError) {
        throw new BadRequestException(`Failed to create RFQ tracking: ${trackingError.message}`);
      }

      // Insert vendor records
      if (data.vendors.length > 0) {
        const vendorRecords = data.vendors.map(vendor => ({
          rfq_tracking_id: trackingRecord.id,
          organization_id: organizationId ?? null,
          vendor_id: vendor.id,
          vendor_name: vendor.name,
          vendor_email: vendor.email
        }));

        const { error: vendorError } = await client
          .from('rfq_tracking_vendors')
          .insert(vendorRecords);

        if (vendorError) {
          throw new BadRequestException(`Failed to insert vendor tracking: ${vendorError.message}`);
        }
      }

      // Insert part records
      if (data.parts.length > 0) {
        const partRecords = data.parts.map(part => ({
          rfq_tracking_id: trackingRecord.id,
          organization_id: organizationId ?? null,
          bom_item_id: part.id,
          part_number: part.partNumber,
          description: part.description,
          process: part.process,
          quantity: part.quantity || 1,
          file_2d_path: part.file2dPath,
          file_3d_path: part.file3dPath
        }));

        const { error: partError } = await client
          .from('rfq_tracking_parts')
          .insert(partRecords);

        if (partError) {
          throw new BadRequestException(`Failed to insert part tracking: ${partError.message}`);
        }
      }

      // Fetch complete tracking record with relationships
      return this.getTrackingById(trackingRecord.id, userId, accessToken);

    } catch (error) {
      throw new BadRequestException(`Failed to create RFQ tracking: ${error.message}`);
    }
  }

  /**
   * Get RFQ tracking by ID with full details
   */
  async getTrackingById(
    trackingId: string,
    userId: string,
    accessToken: string
  ): Promise<RfqTrackingResponseDto> {
    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('rfq_tracking_summary')
      .select('*')
      .eq('id', trackingId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`RFQ tracking record not found: ${trackingId}`);
    }

    return this.mapToTrackingResponseDto(data);
  }

  /**
   * Get all RFQ tracking records for a user
   * Industry Standard: Always filter by project for data isolation
   */
  async getTrackingByUser(
    userId: string,
    accessToken: string,
    projectId: string  // Made mandatory for security
  ): Promise<RfqTrackingResponseDto[]> {
    // Validate inputs
    if (!projectId) {
      throw new BadRequestException('Project ID is required for data isolation');
    }

    this.logger.log(`Getting RFQ tracking for userId=${userId}, projectId=${projectId}`);

    const client = this.supabaseService.getClient(accessToken);

    // Filter by project_id — RLS already scopes visibility to the caller's org
    let query = client
      .from('rfq_tracking_summary')
      .select('*')
      .eq('project_id', projectId)
      .order('sent_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      this.logger.error(`Failed to fetch RFQ tracking: ${error.message}`);
      throw new BadRequestException(`Failed to fetch RFQ tracking: ${error.message}`);
    }

    this.logger.log(`RFQ tracking query returned ${(data || []).length} records`);
    
    if (data && data.length > 0) {
      this.logger.log(`First record: ${JSON.stringify(data[0])}`);
    }

    return (data || []).map(record => this.mapToTrackingResponseDto(record));
  }

  /**
   * Update vendor response information
   */
  async updateVendorResponse(
    trackingId: string,
    vendorId: string,
    userId: string,
    accessToken: string,
    responseData: UpdateVendorResponseData
  ): Promise<void> {
    const client = this.supabaseService.getClient(accessToken);

    // Verify this RFQ tracking record is accessible (RLS enforces org scope)
    const { data: tracking, error: trackingError } = await client
      .from('rfq_tracking')
      .select('id')
      .eq('id', trackingId)
      .single();

    if (trackingError || !tracking) {
      throw new NotFoundException(`RFQ tracking record not found: ${trackingId}`);
    }

    // Update vendor response
    const updateData: any = {
      responded: responseData.responded,
      updated_at: new Date().toISOString()
    };

    if (responseData.responded) {
      updateData.response_received_at = new Date().toISOString();
      if (responseData.quoteAmount) {
        updateData.quote_amount = responseData.quoteAmount;
      }
      if (responseData.leadTimeDays) {
        updateData.lead_time_days = responseData.leadTimeDays;
      }
    }

    const { error: updateError } = await client
      .from('rfq_tracking_vendors')
      .update(updateData)
      .eq('rfq_tracking_id', trackingId)
      .eq('vendor_id', vendorId);

    if (updateError) {
      throw new BadRequestException(`Failed to update vendor response: ${updateError.message}`);
    }

    // Update response counts and timestamps in main tracking record
    await this.updateTrackingStats(trackingId, accessToken);
  }

  /**
   * Update RFQ tracking status
   */
  async updateTrackingStatus(
    trackingId: string,
    userId: string,
    accessToken: string,
    status: 'sent' | 'responded' | 'evaluated' | 'completed' | 'cancelled'
  ): Promise<void> {
    const client = this.supabaseService.getClient(accessToken);

    const updateData: any = {
      status,
      updated_at: new Date().toISOString()
    };

    if (status === 'completed') {
      updateData.completed_at = new Date().toISOString();
    }

    const { error } = await client
      .from('rfq_tracking')
      .update(updateData)
      .eq('id', trackingId);

    if (error) {
      throw new BadRequestException(`Failed to update tracking status: ${error.message}`);
    }
  }

  /**
   * Delete RFQ tracking record (for cancel operation)
   */
  async deleteTracking(
    trackingId: string,
    userId: string,
    accessToken: string
  ): Promise<void> {
    const client = this.supabaseService.getClient(accessToken);

    // First verify this tracking record is accessible (RLS enforces org scope)
    const { data: tracking, error: findError } = await client
      .from('rfq_tracking')
      .select('id')
      .eq('id', trackingId)
      .single();

    if (findError || !tracking) {
      throw new NotFoundException(`RFQ tracking record not found: ${trackingId}`);
    }

    // Delete the tracking record (cascading will delete related vendor and part records)
    const { error: deleteError } = await client
      .from('rfq_tracking')
      .delete()
      .eq('id', trackingId);

    if (deleteError) {
      throw new BadRequestException(`Failed to delete RFQ tracking: ${deleteError.message}`);
    }

    // Verify the record was actually deleted
    const { data: verificationResult, error: verifyError } = await client
      .rpc('verify_rfq_tracking_deleted', { tracking_id: trackingId });

    if (verifyError) {
      this.logger.error(`Failed to verify deletion of RFQ tracking ${trackingId}: ${verifyError.message}`);
      throw new BadRequestException(`Failed to verify deletion: ${verifyError.message}`);
    }

    if (!verificationResult) {
      this.logger.error(`RFQ tracking record ${trackingId} still exists after delete operation`);
      throw new BadRequestException(`Delete operation failed - record still exists`);
    }

    this.logger.log(`RFQ tracking record successfully deleted: ${trackingId}`);
  }

  /**
   * Get RFQ tracking statistics for dashboard
   * Industry Standard: Always scoped to specific project
   */
  async getTrackingStats(
    userId: string,
    accessToken: string,
    projectId: string  // Made mandatory for security
  ): Promise<RfqTrackingStatsDto> {
    // Validate inputs
    if (!projectId) {
      throw new BadRequestException('Project ID is required for data isolation');
    }

    const client = this.supabaseService.getClient(accessToken);

    // Filter by project_id — RLS already scopes visibility to the caller's org
    let query = client
      .from('rfq_tracking')
      .select('status, sent_at, first_response_at')
      .eq('project_id', projectId);

    const { data, error } = await query;

    if (error) {
      throw new BadRequestException(`Failed to fetch tracking stats: ${error.message}`);
    }

    const totalSent = (data || []).length;
    const totalResponded = (data || []).filter(r => r.first_response_at).length;
    const totalCompleted = (data || []).filter(r => r.status === 'completed').length;

    // Calculate average response time
    const respondedRecords = (data || []).filter(r => r.first_response_at);
    const avgResponseTime = respondedRecords.length > 0
      ? respondedRecords.reduce((acc, record) => {
          const sentDate = new Date(record.sent_at);
          const responseDate = new Date(record.first_response_at);
          const diffDays = (responseDate.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24);
          return acc + diffDays;
        }, 0) / respondedRecords.length
      : 0;

    // Count recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentActivity = (data || []).filter(r => new Date(r.sent_at) >= sevenDaysAgo).length;

    return {
      totalSent,
      totalResponded,
      totalCompleted,
      avgResponseTime: Math.round(avgResponseTime * 10) / 10, // Round to 1 decimal
      recentActivity
    };
  }

  /**
   * Private helper to update tracking statistics
   */
  private async updateTrackingStats(trackingId: string, accessToken: string): Promise<void> {
    const client = this.supabaseService.getClient(accessToken);

    // Get response statistics
    const { data: responseStats } = await client
      .from('rfq_tracking_vendors')
      .select('responded, response_received_at')
      .eq('rfq_tracking_id', trackingId);

    if (!responseStats) return;

    const responseCount = responseStats.filter(r => r.responded).length;
    const responseDates = responseStats
      .filter(r => r.response_received_at)
      .map(r => new Date(r.response_received_at))
      .sort();

    const updateData: any = {
      response_count: responseCount,
      updated_at: new Date().toISOString()
    };

    if (responseDates.length > 0) {
      updateData.first_response_at = responseDates[0].toISOString();
      updateData.last_response_at = responseDates[responseDates.length - 1].toISOString();
    }

    await client
      .from('rfq_tracking')
      .update(updateData)
      .eq('id', trackingId);
  }

  /**
   * Private helper to map database record to DTO
   */
  private mapToTrackingResponseDto(data: any): RfqTrackingResponseDto {
    return {
      id: data.id,
      rfqId: data.rfq_id,
      userId: data.user_id,
      projectId: data.project_id,
      rfqName: data.rfq_name,
      rfqNumber: data.rfq_number,
      status: data.status as RfqTrackingStatus,
      vendorCount: data.vendor_count,
      partCount: data.part_count,
      responseCount: data.response_count,
      sentAt: new Date(data.sent_at),
      firstResponseAt: data.first_response_at ? new Date(data.first_response_at) : undefined,
      lastResponseAt: data.last_response_at ? new Date(data.last_response_at) : undefined,
      completedAt: data.completed_at ? new Date(data.completed_at) : undefined,
      vendors: Array.isArray(data.vendors) ? data.vendors.map((v: any) => ({
        id: v.vendor_id,
        name: v.vendor_name,
        email: v.vendor_email,
        responded: v.responded || false,
        responseReceivedAt: v.response_received_at ? new Date(v.response_received_at) : undefined,
        quoteAmount: v.quote_amount,
        leadTimeDays: v.lead_time_days
      })) : [],
      parts: Array.isArray(data.parts) ? data.parts.map((p: any) => ({
        id: p.bom_item_id,
        partNumber: p.part_number,
        description: p.description,
        process: p.process,
        quantity: p.quantity || 1,
        file2dPath: p.file_2d_path,
        file3dPath: p.file_3d_path,
        has2dFile: !!p.file_2d_path,
        has3dFile: !!p.file_3d_path
      })) : []
    };
  }
}