import { Injectable, NotFoundException, BadRequestException, Logger, InternalServerErrorException, ConflictException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { RfqRecord, RfqSummary, RfqStatus } from './dto/rfq-response.dto';
import { RfqEmailService } from './services/rfq-email.service';
import { RfqTrackingService } from './services/rfq-tracking.service';

@Injectable()
export class RfqService {
  private readonly logger = new Logger(RfqService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly rfqEmailService: RfqEmailService,
    private readonly rfqTrackingService: RfqTrackingService
  ) { }

  async create(userId: string, createRfqDto: CreateRfqDto): Promise<RfqRecord> {
    const {
      rfqName,
      projectId,
      bomItemIds,
      vendorIds,
      quoteDeadline,
      selectionType,
      buyerName,
      emailBody,
      emailSubject
    } = createRfqDto;

    // Generate RFQ number
    const rfqNumber = await this.generateRfqNumber();

    // Validate BOM items and vendors exist
    await this.validateBomItems(bomItemIds);
    await this.validateVendors(vendorIds);


    const { data, error } = await this.supabaseService.client
      .from('rfq_records')
      .insert({
        user_id: userId,
        project_id: projectId,
        rfq_name: rfqName,
        rfq_number: rfqNumber,
        bom_item_ids: bomItemIds,
        vendor_ids: vendorIds,
        quote_deadline: quoteDeadline,
        selection_type: selectionType,
        buyer_name: buyerName,
        email_body: emailBody,
        email_subject: emailSubject,
        status: RfqStatus.DRAFT
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating RFQ: ${error.message}`, 'RfqService');
      
      // Handle duplicate RFQ number constraint
      if (error.message.includes('duplicate key') && error.message.includes('rfq_number')) {
        throw new ConflictException('An RFQ with this number already exists. Please try again.');
      }
      
      // Handle foreign key constraints
      if (error.message.includes('violates foreign key constraint')) {
        if (error.message.includes('project_id')) {
          throw new BadRequestException('The specified project does not exist or you do not have access to it.');
        }
        if (error.message.includes('user_id')) {
          throw new BadRequestException('User account is not valid. Please log in again.');
        }
      }
      
      // Handle validation constraints
      if (error.message.includes('violates check constraint')) {
        if (error.message.includes('quote_deadline_future')) {
          throw new BadRequestException('Quote deadline must be set to a future date.');
        }
        if (error.message.includes('vendor_ids_not_empty')) {
          throw new BadRequestException('At least one vendor must be selected for the RFQ.');
        }
        if (error.message.includes('bom_item_ids_not_empty')) {
          throw new BadRequestException('At least one BOM item must be selected for the RFQ.');
        }
      }
      
      throw new InternalServerErrorException('Failed to create RFQ. Please check your input and try again.');
    }

    return this.mapToRfqRecord(data);
  }

  async findByUser(userId: string, projectId?: string): Promise<RfqSummary[]> {
    let query = this.supabaseService.client
      .from('rfq_records')
      .select(`
        id,
        rfq_name,
        rfq_number,
        status,
        bom_item_ids,
        vendor_ids,
        created_at,
        sent_at
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (projectId) {
      query = query.eq('project_id', projectId);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error(`Error fetching RFQs: ${error.message}`, 'RfqService');
      
      // Handle access permissions
      if (error.message.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access these RFQs.');
      }
      
      throw new InternalServerErrorException('Unable to retrieve RFQs. Please try again later.');
    }

    return (data || []).map((row: any) => this.mapToRfqSummary(row));
  }

  async findOne(id: string, userId: string): Promise<RfqRecord> {
    const { data, error } = await this.supabaseService.client
      .from('rfq_records')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) {
      this.logger.error(`Error fetching RFQ ${id}: ${error.message}`, 'RfqService');
      
      if (error.message.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access this RFQ.');
      }
      
      if (error.message.includes('invalid input syntax for type uuid')) {
        throw new BadRequestException('Invalid RFQ ID format provided.');
      }
      
      throw new InternalServerErrorException('Unable to retrieve RFQ details. Please try again later.');
    }
    
    if (!data) {
      throw new NotFoundException(`RFQ with ID ${id} was not found or you do not have access to it.`);
    }

    return this.mapToRfqRecord(data);
  }

  async sendRfq(id: string, userId: string, accessToken?: string): Promise<void> {
    this.logger.log(`Sending RFQ ${id} for user ${userId}, accessToken provided: ${!!accessToken}`);
    
    // First validate the RFQ exists and belongs to the user
    const rfq = await this.findOne(id, userId);
    this.logger.log(`RFQ details: ${JSON.stringify({ id: rfq.id, projectId: rfq.projectId, status: rfq.status })}`);

    if (rfq.status !== RfqStatus.DRAFT) {
      if (rfq.status === 'sent') {
        throw new BadRequestException('This RFQ has already been sent to vendors. You cannot send it again.');
      }
      if (rfq.status === 'closed') {
        throw new BadRequestException('This RFQ has been closed and cannot be sent.');
      }
      throw new BadRequestException(`RFQ status is '${rfq.status}' and cannot be sent. Only draft RFQs can be sent.`);
    }
    
    // Validate RFQ has required data for sending
    if (!rfq.vendorIds || rfq.vendorIds.length === 0) {
      throw new BadRequestException('Cannot send RFQ without any vendors selected.');
    }
    
    if (!rfq.bomItemIds || rfq.bomItemIds.length === 0) {
      throw new BadRequestException('Cannot send RFQ without any BOM items selected.');
    }
    
    if (!rfq.quoteDeadline) {
      throw new BadRequestException('Cannot send RFQ without a quote deadline.');
    }
    
    if (new Date(rfq.quoteDeadline) <= new Date()) {
      throw new BadRequestException('Cannot send RFQ with a deadline that has already passed.');
    }

    // Use the database function to mark as sent
    const { error } = await this.supabaseService.client
      .rpc('send_rfq', { p_rfq_id: id, p_user_id: userId });

    if (error) {
      this.logger.error(`Error sending RFQ ${id}: ${error.message}`, 'RfqService');
      
      if (error.message.includes('not found')) {
        throw new NotFoundException('The RFQ to send was not found.');
      }
      
      if (error.message.includes('already sent')) {
        throw new ConflictException('This RFQ has already been sent to vendors.');
      }
      
      throw new InternalServerErrorException('Failed to send RFQ. Please try again later.');
    }

    this.logger.log(`RFQ ${id} marked as sent in database`);

    // Send RFQ emails to all vendors
    await this.rfqEmailService.sendRfqEmails(rfq);

    // Create tracking record if access token provided
    if (accessToken) {
      try {
        this.logger.log(`Creating tracking record for RFQ ${rfq.id} in project ${rfq.projectId}`);
        await this.createRfqTrackingRecord(rfq, userId, accessToken);
        this.logger.log(`RFQ tracking record created successfully for RFQ ${rfq.id} in project ${rfq.projectId}`);
      } catch (error) {
        this.logger.error(`Failed to create RFQ tracking record for RFQ ${rfq.id}: ${error.message}`, error.stack);
        // Don't throw here to prevent blocking the RFQ send process
      }
    } else {
      this.logger.warn(`No access token provided for RFQ ${rfq.id} - tracking record will not be created`);
    }
  }

  async closeRfq(id: string, userId: string): Promise<void> {
    // Validate ownership first
    await this.findOne(id, userId);

    const { error } = await this.supabaseService.client
      .rpc('close_rfq', { p_rfq_id: id, p_user_id: userId });

    if (error) {
      this.logger.error(`Error closing RFQ ${id}: ${error.message}`, 'RfqService');
      
      if (error.message.includes('not found')) {
        throw new NotFoundException('The RFQ to close was not found.');
      }
      
      if (error.message.includes('already closed')) {
        throw new ConflictException('This RFQ has already been closed.');
      }
      
      if (error.message.includes('not sent')) {
        throw new BadRequestException('Cannot close an RFQ that has not been sent to vendors yet.');
      }
      
      throw new InternalServerErrorException('Failed to close RFQ. Please try again later.');
    }
  }

  private async generateRfqNumber(): Promise<string> {
    const date = new Date();
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');

    const prefix = `RFQ-${year}${month}`;
    const { count, error } = await this.supabaseService.client
      .from('rfq_records')
      .select('*', { count: 'exact', head: true })
      .like('rfq_number', `${prefix}%`);

    if (error) {
      this.logger.error(`Error generating RFQ number: ${error.message}`, 'RfqService');
      throw new InternalServerErrorException('Unable to generate RFQ number. Please try again later.');
    }

    const nextNumber = (count || 0) + 1;
    return `${prefix}-${nextNumber.toString().padStart(3, '0')}`;
  }

  private async validateBomItems(bomItemIds: string[]): Promise<void> {
    const { count, error } = await this.supabaseService.client
      .from('bom_items')
      .select('*', { count: 'exact', head: true })
      .in('id', bomItemIds);

    if (error) {
      this.logger.error(`Error validating BOM items: ${error.message}`, 'RfqService');
      
      if (error.message.includes('invalid input syntax for type uuid')) {
        throw new BadRequestException('One or more BOM item IDs have an invalid format.');
      }
      
      throw new InternalServerErrorException('Unable to validate BOM items. Please try again later.');
    }

    if ((count || 0) !== bomItemIds.length) {
      const foundCount = count || 0;
      const missingCount = bomItemIds.length - foundCount;
      throw new BadRequestException(
        `${missingCount} of the selected BOM items ${missingCount === 1 ? 'does' : 'do'} not exist or ${missingCount === 1 ? 'is' : 'are'} no longer available. Please refresh your selection and try again.`
      );
    }
  }

  private async validateVendors(vendorIds: string[]): Promise<void> {
    const { count, error } = await this.supabaseService.client
      .from('vendors')
      .select('*', { count: 'exact', head: true })
      .in('id', vendorIds);

    if (error) {
      this.logger.error(`Error validating vendors: ${error.message}`, 'RfqService');
      
      if (error.message.includes('invalid input syntax for type uuid')) {
        throw new BadRequestException('One or more vendor IDs have an invalid format.');
      }
      
      throw new InternalServerErrorException('Unable to validate vendors. Please try again later.');
    }

    if ((count || 0) !== vendorIds.length) {
      const foundCount = count || 0;
      const missingCount = vendorIds.length - foundCount;
      throw new BadRequestException(
        `${missingCount} of the selected vendors ${missingCount === 1 ? 'does' : 'do'} not exist or ${missingCount === 1 ? 'is' : 'are'} no longer available. Please refresh your vendor list and try again.`
      );
    }
  }

  private mapToRfqRecord(row: any): RfqRecord {
    return {
      id: row.id,
      userId: row.user_id,
      projectId: row.project_id,
      rfqName: row.rfq_name,
      rfqNumber: row.rfq_number,
      bomItemIds: row.bom_item_ids,
      vendorIds: row.vendor_ids,
      quoteDeadline: row.quote_deadline,
      selectionType: row.selection_type,
      buyerName: row.buyer_name,
      emailBody: row.email_body,
      emailSubject: row.email_subject,
      status: row.status,
      sentAt: row.sent_at,
      closedAt: row.closed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapToRfqSummary(row: any): RfqSummary {
    return {
      id: row.id,
      rfqName: row.rfq_name,
      rfqNumber: row.rfq_number,
      status: row.status,
      itemCount: Array.isArray(row.bom_item_ids) ? row.bom_item_ids.length :
        (row.item_count ? parseInt(row.item_count) : 0),
      vendorCount: Array.isArray(row.vendor_ids) ? row.vendor_ids.length :
        (row.vendor_count ? parseInt(row.vendor_count) : 0),
      responseCount: row.response_count ? parseInt(row.response_count) : 0,
      createdAt: row.created_at,
      sentAt: row.sent_at,
    };
  }

  /**
   * Create RFQ tracking record
   */
  private async createRfqTrackingRecord(rfq: RfqRecord, userId: string, accessToken: string): Promise<void> {
    // Ensure project_id is set - critical for data isolation
    if (!rfq.projectId) {
      throw new BadRequestException(
        'This RFQ cannot be tracked as it is not associated with a project. Please ensure the RFQ is created within a project context.'
      );
    }

    // Get vendor and BOM details
    const [vendorDetails, bomDetails] = await Promise.allSettled([
      this.getVendorDetails(rfq.vendorIds, accessToken),
      this.getBomItemDetails(rfq.bomItemIds, accessToken)
    ]);

    const vendors = vendorDetails.status === 'fulfilled' 
      ? vendorDetails.value 
      : rfq.vendorIds.map(id => ({ id, name: 'Unknown Vendor' }));

    const parts = bomDetails.status === 'fulfilled' 
      ? bomDetails.value 
      : rfq.bomItemIds.map(id => ({
          id,
          partNumber: 'Unknown Part',
          description: 'Part details unavailable',
          process: 'Unknown Process'
        }));

    // Create tracking record
    await this.rfqTrackingService.createTracking(userId, accessToken, {
      rfqId: rfq.id,
      projectId: rfq.projectId,
      rfqName: rfq.rfqName,
      rfqNumber: rfq.rfqNumber,
      vendors,
      parts
    });
  }


  /**
   * Get vendor details for tracking
   */
  private async getVendorDetails(vendorIds: string[], accessToken: string): Promise<Array<{
    id: string;
    name: string;
    email?: string;
  }>> {
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendors')
      .select('id, name, company_email')
      .in('id', vendorIds);

    if (error) {
      return vendorIds.map(id => ({ id, name: 'Unknown Vendor' }));
    }

    return data.map(vendor => ({
      id: vendor.id,
      name: vendor.name,
      email: vendor.company_email
    }));
  }

  /**
   * Get BOM item details for tracking
   */
  private async getBomItemDetails(bomItemIds: string[], accessToken: string): Promise<Array<{
    id: string;
    partNumber: string;
    description: string;
    process: string;
    quantity?: number;
    file2dPath?: string;
    file3dPath?: string;
  }>> {
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_items')
      .select('id, name, part_number, description, item_type, quantity, file_3d_path, file_2d_path')
      .in('id', bomItemIds);

    if (error) {
      return bomItemIds.map(id => ({
        id,
        partNumber: 'Unknown Part',
        description: 'Part details unavailable',
        process: 'Unknown Process'
      }));
    }

    return data.map(item => {
      // Map item_type to process
      const processMapping: Record<string, string> = {
        'assembly': 'Assembly',
        'sub_assembly': 'Machining', 
        'child_part': 'Casting'
      };
      
      return {
        id: item.id,
        partNumber: item.part_number || item.name || 'Unknown Part',
        description: item.description || item.name || 'No description available',
        process: processMapping[item.item_type] || 'Manufacturing',
        quantity: item.quantity || 1,
        file2dPath: item.file_2d_path,
        file3dPath: item.file_3d_path
      };
    });
  }
}