import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '@/common/supabase/supabase.service';
import { 
  CreateDeliveryOrderDto, 
  UpdateDeliveryOrderDto, 
  DeliveryOrderQueryDto,
  DeliveryOrderResponseDto,
  CreateDeliveryAddressDto,
  CreateTrackingEventDto,
  DeliveryStatus,
  QualityApprovedItemDto
} from './dto/delivery.dto';

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly supabase: SupabaseService
  ) {}

  /**
   * Get available quality-approved items for delivery by project
   * Uses the quality_approved_items table with proper joins and filters
   */
  async getAvailableItemsForDelivery(projectId: string, userId: string): Promise<QualityApprovedItemDto[]> {
    try {
      this.logger.debug(`Fetching available items for delivery - Project: ${projectId}, User: ${userId}`);
      
      // Query quality approved items that are not already in delivery orders
      // First get all already used quality approved item IDs - handle missing table gracefully
      let usedItemIds: string[] = [];
      try {
        const { data: usedItems, error: usedError } = await this.supabase.client
          .from('delivery_items')
          .select('quality_approved_item_id')
          .not('quality_approved_item_id', 'is', null);

        if (usedError) {
          this.logger.error(`Database error fetching used items: ${usedError.message}`, usedError);
          throw new BadRequestException('Failed to retrieve used items');
        }

        usedItemIds = (usedItems || []).map(item => item.quality_approved_item_id);
        this.logger.log(`Found ${usedItemIds.length} already used items`);
      } catch (error: any) {
        this.logger.warn(`Could not fetch used items (delivery_items table may not exist): ${error.message}`);
        this.logger.warn('Proceeding with empty used items list. Please run migration 205_fix_delivery_schema.sql');
        usedItemIds = [];
      }

      // Now get available quality approved items for the project
      let query = this.supabase.client
        .from('quality_approved_items')
        .select(`
          id,
          bom_item_id,
          approved_quantity,
          approval_status,
          approval_notes,
          approved_at,
          approved_by,
          qc_certificate_number,
          delivery_ready,
          batch_number,
          bom_items!inner (
            id,
            part_number,
            description,
            material,
            unit,
            unit_cost_inr,
            boms!inner (
              project_id
            )
          )
        `)
        .eq('approval_status', 'approved')
        .eq('delivery_ready', true)
        .eq('bom_items.boms.project_id', projectId)
        .order('approved_at', { ascending: false });

      // Filter out already used items
      if (usedItemIds.length > 0) {
        query = query.not('id', 'in', `(${usedItemIds.map(id => `"${id}"`).join(',')})`);
      }

      const { data: availableItems, error } = await query;

      this.logger.log(`Database query result for project ${projectId}: ${availableItems?.length || 0} items found`);
      if (error) {
        this.logger.error(`Database error fetching available items: ${error.message}`, error);
        throw new BadRequestException('Failed to retrieve available items for delivery');
      }

      if (!availableItems || availableItems.length === 0) {
        this.logger.log(`No available items found for project ${projectId}. This could mean:`);
        this.logger.log(`1. No quality inspections have been approved yet`);
        this.logger.log(`2. Database migration 201_quality_delivery_integration.sql hasn't been applied`);
        this.logger.log(`3. Quality approved items haven't been created properly`);
        return [];
      }

      // Transform to DTO format
      return availableItems.map(item => ({
        id: item.id,
        inspectionId: 'quality-approved', // Static value since we don't have inspection mapping in this query
        bomItemId: item.bom_item_id,
        approvedQuantity: item.approved_quantity,
        approvalStatus: item.approval_status,
        approvalNotes: item.approval_notes,
        approvedAt: item.approved_at,
        approvedBy: item.approved_by,
        qcCertificateNumber: item.qc_certificate_number,
        deliveryReady: item.delivery_ready,
        bomItem: {
          id: item.bom_item_id,
          partNumber: (item.bom_items as any)?.part_number || 'Unknown',
          description: (item.bom_items as any)?.description || 'No description',
          material: (item.bom_items as any)?.material || 'Unknown',
          unitOfMeasure: (item.bom_items as any)?.unit || 'pcs',
          unitCost: (item.bom_items as any)?.unit_cost_inr || 0
        },
        inspection: {
          id: 'quality-approved',
          name: 'Quality Approved',
          projectId: projectId,
          status: 'completed',
          type: 'quality_control'
        }
      }));

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`Unexpected error fetching available items: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve available items for delivery');
    }
  }

  /**
   * Create a new delivery order with comprehensive validation
   */
  async createDeliveryOrder(createDeliveryOrderDto: CreateDeliveryOrderDto, userId: string): Promise<DeliveryOrderResponseDto> {
    try {
      this.logger.log(`Creating delivery order for project ${createDeliveryOrderDto.projectId} by user ${userId}`);

      // Start transaction
      const { data: orderData, error: transactionError } = await this.supabase.client.rpc('create_delivery_order_transaction', {
        order_data: {
          project_id: createDeliveryOrderDto.projectId,
          inspection_id: createDeliveryOrderDto.inspectionId,
          delivery_address_id: createDeliveryOrderDto.deliveryAddressId,
          billing_address_id: createDeliveryOrderDto.billingAddressId,
          carrier_id: createDeliveryOrderDto.carrierId,
          priority: createDeliveryOrderDto.priority || 'standard',
          requested_delivery_date: createDeliveryOrderDto.requestedDeliveryDate,
          delivery_window_start: createDeliveryOrderDto.deliveryWindowStart,
          delivery_window_end: createDeliveryOrderDto.deliveryWindowEnd,
          package_count: createDeliveryOrderDto.packageCount || 1,
          special_handling_requirements: createDeliveryOrderDto.specialHandlingRequirements,
          delivery_instructions: createDeliveryOrderDto.deliveryInstructions,
          delivery_cost_inr: createDeliveryOrderDto.deliveryCostInr || 0,
          insurance_cost_inr: createDeliveryOrderDto.insuranceCostInr || 0,
          handling_cost_inr: createDeliveryOrderDto.handlingCostInr || 0,
          notes: createDeliveryOrderDto.notes,
          created_by: userId
        },
        items_data: createDeliveryOrderDto.items.map(item => ({
          quality_approved_item_id: item.qualityApprovedItemId,
          bom_item_id: item.bomItemId,
          approved_quantity: item.approvedQuantity,
          delivery_quantity: item.deliveryQuantity,
          unit_weight_kg: item.unitWeightKg,
          unit_dimensions_cm: item.unitDimensionsCm,
          packaging_type: item.packagingType,
          packaging_instructions: item.packagingInstructions,
          hazmat_classification: item.hazmatClassification,
          qc_certificate_number: item.qcCertificateNumber,
          batch_number: item.batchNumber,
          serial_numbers: item.serialNumbers,
          unit_value_inr: item.unitValueInr
        }))
      });

      if (transactionError) {
        this.logger.error(`Transaction error creating delivery order: ${transactionError.message}`, transactionError);
        throw new BadRequestException(transactionError.message || 'Failed to create delivery order');
      }

      this.logger.log(`Delivery order created successfully: ${orderData.order_number}`);
      
      // Return the created order with full details
      return await this.getDeliveryOrderById(orderData.id, userId);

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`Unexpected error creating delivery order: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to create delivery order');
    }
  }

  /**
   * Get delivery order by ID with comprehensive details
   */
  async getDeliveryOrderById(id: string, userId: string): Promise<DeliveryOrderResponseDto> {
    try {
      this.logger.debug(`Fetching delivery order ${id} for user ${userId}`);

      const { data: deliveryOrder, error: orderError } = await this.supabase.client
        .from('delivery_orders')
        .select(`
          *,
          delivery_addresses!fk_delivery_orders_delivery_address (
            id,
            company_name,
            contact_person,
            contact_phone,
            contact_email,
            address_line1,
            address_line2,
            city,
            state_province,
            postal_code,
            country,
            special_instructions
          ),
          carriers (
            id,
            name,
            code,
            contact_email,
            contact_phone
          ),
          projects (
            id,
            name
          )
        `)
        .eq('id', id)
        .single();

      if (orderError || !deliveryOrder) {
        this.logger.warn(`Delivery order not found: ${id}`);
        throw new NotFoundException('Delivery order not found');
      }

      // Get delivery items with comprehensive details
      const { data: deliveryItems, error: itemsError } = await this.supabase.client
        .from('delivery_items')
        .select(`
          *,
          bom_items (
            part_number,
            description,
            material,
            unit_of_measure,
            unit_cost_inr
          ),
          quality_approved_items (
            qc_certificate_number,
            approval_notes,
            batch_number,
            quality_grade,
            actual_weight_kg,
            actual_dimensions_cm
          )
        `)
        .eq('delivery_order_id', id)
        .order('created_at');

      if (itemsError) {
        this.logger.error(`Error fetching delivery items: ${itemsError.message}`, itemsError);
        throw new BadRequestException('Failed to retrieve delivery items');
      }

      // Get tracking events
      const { data: trackingEvents, error: trackingError } = await this.supabase.client
        .from('delivery_tracking')
        .select('*')
        .eq('delivery_order_id', id)
        .order('event_timestamp', { ascending: false });

      if (trackingError) {
        this.logger.error(`Error fetching tracking events: ${trackingError.message}`, trackingError);
        throw new BadRequestException('Failed to retrieve tracking events');
      }

      // Transform to response DTO
      return this.transformToDeliveryOrderResponse(deliveryOrder, deliveryItems || [], trackingEvents || []);

    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`Unexpected error fetching delivery order: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve delivery order');
    }
  }

  /**
   * Get delivery orders with advanced filtering and pagination
   */
  async getDeliveryOrders(queryDto: DeliveryOrderQueryDto, userId: string): Promise<{ 
    data: DeliveryOrderResponseDto[], 
    total: number, 
    page: number, 
    limit: number 
  }> {
    try {
      this.logger.debug(`Fetching delivery orders with filters: ${JSON.stringify(queryDto)}`);

      // Build query with filters
      let query = this.supabase.client
        .from('delivery_orders')
        .select(`
          *,
          delivery_addresses!fk_delivery_orders_delivery_address (
            company_name,
            contact_person,
            city,
            country
          ),
          carriers (
            id,
            name,
            code
          ),
          projects (
            id,
            name
          )
        `, { count: 'exact' });

      // Apply filters
      if (queryDto.projectId) {
        query = query.eq('project_id', queryDto.projectId);
      }

      if (queryDto.status) {
        if (Array.isArray(queryDto.status)) {
          query = query.in('status', queryDto.status);
        } else {
          query = query.eq('status', queryDto.status);
        }
      }

      if (queryDto.priority) {
        if (Array.isArray(queryDto.priority)) {
          query = query.in('priority', queryDto.priority);
        } else {
          query = query.eq('priority', queryDto.priority);
        }
      }

      if (queryDto.carrierId) {
        query = query.eq('carrier_id', queryDto.carrierId);
      }

      // Apply date range filters
      if (queryDto.startDate) {
        query = query.gte('created_at', queryDto.startDate);
      }

      if (queryDto.endDate) {
        query = query.lte('created_at', queryDto.endDate);
      }

      // Apply search functionality
      if (queryDto.search) {
        query = query.or(
          `order_number.ilike.%${queryDto.search}%,` +
          `tracking_number.ilike.%${queryDto.search}%,` +
          `delivery_addresses!fk_delivery_orders_delivery_address.company_name.ilike.%${queryDto.search}%,` +
          `notes.ilike.%${queryDto.search}%`
        );
      }

      // Apply sorting
      const sortBy = queryDto.sortBy || 'created_at';
      const sortOrder = queryDto.sortOrder === 'asc' ? true : false;
      query = query.order(sortBy, { ascending: sortOrder });

      // Apply pagination
      const page = Math.max(1, queryDto.page || 1);
      const limit = Math.min(100, Math.max(1, queryDto.limit || 20));
      const offset = (page - 1) * limit;
      
      query = query.range(offset, offset + limit - 1);

      const { data: deliveryOrders, error, count } = await query;

      if (error) {
        this.logger.error(`Error fetching delivery orders: ${error.message}`, error);
        throw new BadRequestException('Failed to retrieve delivery orders');
      }

      const total = count || 0;

      // Transform to response format (simplified for list view)
      const data = (deliveryOrders || []).map(order => this.transformToSimplifiedDeliveryOrderResponse(order)) as DeliveryOrderResponseDto[];

      return {
        data,
        total,
        page,
        limit
      };

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`Unexpected error fetching delivery orders: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve delivery orders');
    }
  }

  /**
   * Update delivery order with proper validation
   */
  async updateDeliveryOrder(id: string, updateDto: UpdateDeliveryOrderDto, userId: string): Promise<DeliveryOrderResponseDto> {
    try {
      this.logger.log(`Updating delivery order ${id} by user ${userId}`);

      // First check if order exists and user has permission
      const existingOrder = await this.getDeliveryOrderById(id, userId);
      
      // Prevent updates to delivered or cancelled orders unless it's status change
      if (['delivered', 'cancelled'].includes(existingOrder.status) && updateDto.status !== 'cancelled') {
        throw new ForbiddenException('Cannot update delivered or cancelled orders');
      }

      // Prepare update data
      const updateData = {
        ...updateDto,
        updated_at: new Date().toISOString(),
        updated_by: userId
      };

      // Calculate total cost if individual costs are updated
      if (updateDto.deliveryCostInr !== undefined || 
          updateDto.insuranceCostInr !== undefined || 
          updateDto.handlingCostInr !== undefined) {
        
        (updateData as any).total_delivery_cost_inr = 
          (updateDto.deliveryCostInr ?? (existingOrder.totalDeliveryCostInr || 0)) +
          (updateDto.insuranceCostInr ?? 0) +
          (updateDto.handlingCostInr ?? 0);
      }

      // Update the order
      const { data: updatedOrder, error: updateError } = await this.supabase.client
        .from('delivery_orders')
        .update(updateData)
        .eq('id', id)
        .select('*')
        .single();

      if (updateError) {
        this.logger.error(`Error updating delivery order: ${updateError.message}`, updateError);
        throw new BadRequestException('Failed to update delivery order');
      }

      // Create tracking events for significant changes
      await this.createTrackingEventsForUpdate(id, existingOrder, updateDto, userId);

      this.logger.log(`Delivery order updated successfully: ${updatedOrder.order_number}`);

      // Return updated order with full details
      return await this.getDeliveryOrderById(id, userId);

    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException || error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`Unexpected error updating delivery order: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to update delivery order');
    }
  }

  /**
   * Add tracking event with validation
   */
  async addTrackingEvent(trackingDto: CreateTrackingEventDto, userId: string): Promise<void> {
    try {
      this.logger.debug(`Adding tracking event for order ${trackingDto.deliveryOrderId}`);

      // Verify order exists and user has access
      await this.getDeliveryOrderById(trackingDto.deliveryOrderId, userId);

      const { error: insertError } = await this.supabase.client
        .from('delivery_tracking')
        .insert({
          delivery_order_id: trackingDto.deliveryOrderId,
          event_type: trackingDto.eventType,
          event_description: trackingDto.eventDescription,
          event_timestamp: trackingDto.eventTimestamp,
          location_name: trackingDto.locationName,
          location_address: trackingDto.locationAddress,
          latitude: trackingDto.latitude,
          longitude: trackingDto.longitude,
          carrier_status_code: trackingDto.carrierStatusCode,
          internal_notes: trackingDto.internalNotes || `Added by user ${userId}`,
          proof_of_delivery: trackingDto.proofOfDelivery,
          created_by: userId
        });

      if (insertError) {
        this.logger.error(`Error adding tracking event: ${insertError.message}`, insertError);
        throw new BadRequestException('Failed to add tracking event');
      }

      // Auto-update delivery order status based on tracking event
      await this.updateOrderStatusFromTracking(trackingDto.deliveryOrderId, trackingDto.eventType, trackingDto.eventTimestamp.toISOString(), userId);

      this.logger.log(`Tracking event added successfully for order ${trackingDto.deliveryOrderId}`);

    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`Unexpected error adding tracking event: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to add tracking event');
    }
  }

  /**
   * Get comprehensive delivery metrics
   */
  async getDeliveryMetrics(projectId?: string, startDate?: Date, endDate?: Date, userId?: string): Promise<any> {
    try {
      this.logger.debug(`Fetching delivery metrics - Project: ${projectId}, Date range: ${startDate} to ${endDate}`);

      // Use the materialized view for better performance
      const { data: qualityMetrics, error: qualityError } = await this.supabase.client
        .from('delivery_quality_metrics')
        .select('*')
        .eq(projectId ? 'project_id' : 'true', projectId || true);

      if (qualityError) {
        this.logger.error(`Error fetching quality metrics: ${qualityError.message}`, qualityError);
      }

      // Get delivery performance metrics
      let deliveryQuery = this.supabase.client
        .from('delivery_orders')
        .select('status, created_at, total_delivery_cost_inr, requested_delivery_date, actual_delivery_date, carrier_id');

      if (projectId) {
        deliveryQuery = deliveryQuery.eq('project_id', projectId);
      }

      if (startDate && endDate) {
        deliveryQuery = deliveryQuery
          .gte('created_at', startDate.toISOString())
          .lte('created_at', endDate.toISOString());
      }

      const { data: deliveryData, error: deliveryError } = await deliveryQuery;

      if (deliveryError) {
        this.logger.error(`Error fetching delivery metrics: ${deliveryError.message}`, deliveryError);
        throw new BadRequestException('Failed to retrieve delivery metrics');
      }

      // Calculate metrics
      const totalDeliveries = deliveryData?.length || 0;
      const deliveredCount = deliveryData?.filter(d => d.status === 'delivered').length || 0;
      const onTimeDeliveries = deliveryData?.filter(d => 
        d.status === 'delivered' && 
        d.actual_delivery_date && 
        d.requested_delivery_date &&
        new Date(d.actual_delivery_date) <= new Date(d.requested_delivery_date)
      ).length || 0;

      const avgDeliveryCost = deliveryData?.length > 0 
        ? deliveryData.reduce((sum, d) => sum + (d.total_delivery_cost_inr || 0), 0) / deliveryData.length
        : 0;

      const avgDelayDays = deliveryData?.filter(d => 
        d.status === 'delivered' && d.actual_delivery_date && d.requested_delivery_date
      ).reduce((sum, d, _, arr) => {
        const delay = Math.ceil((new Date(d.actual_delivery_date).getTime() - new Date(d.requested_delivery_date).getTime()) / (1000 * 60 * 60 * 24));
        return sum + delay / arr.length;
      }, 0) || 0;

      return {
        totalDeliveries,
        deliveredCount,
        onTimeDeliveries,
        deliverySuccessRate: totalDeliveries > 0 ? ((deliveredCount / totalDeliveries) * 100).toFixed(2) : '0',
        onTimeDeliveryRate: deliveredCount > 0 ? ((onTimeDeliveries / deliveredCount) * 100).toFixed(2) : '0',
        avgDeliveryCost: parseFloat(avgDeliveryCost.toFixed(2)),
        avgDelayDays: parseFloat(avgDelayDays.toFixed(1)),
        totalDeliveryCost: deliveryData?.reduce((sum, d) => sum + (d.total_delivery_cost_inr || 0), 0) || 0,
        qualityMetrics: qualityMetrics?.[0] || {}
      };

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`Unexpected error fetching delivery metrics: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve delivery metrics');
    }
  }

  /**
   * Create delivery address with validation
   */
  async createDeliveryAddress(addressDto: CreateDeliveryAddressDto, userId: string): Promise<any> {
    try {
      this.logger.debug(`Creating delivery address for project ${addressDto.projectId}`);

      const { data: address, error } = await this.supabase.client
        .from('delivery_addresses')
        .insert({
          project_id: addressDto.projectId,
          address_type: addressDto.addressType || 'shipping',
          company_name: addressDto.companyName,
          contact_person: addressDto.contactPerson,
          contact_phone: addressDto.contactPhone,
          contact_email: addressDto.contactEmail,
          address_line1: addressDto.addressLine1,
          address_line2: addressDto.addressLine2,
          city: addressDto.city,
          state_province: addressDto.stateProvince,
          postal_code: addressDto.postalCode,
          country: addressDto.country || 'India',
          latitude: addressDto.latitude,
          longitude: addressDto.longitude,
          special_instructions: addressDto.specialInstructions,
          is_default: addressDto.isDefault || false
        })
        .select('*')
        .single();

      if (error) {
        this.logger.error(`Error creating delivery address: ${error.message}`, error);
        throw new BadRequestException('Failed to create delivery address');
      }

      if (!address) {
        this.logger.error('No address data returned from database');
        throw new BadRequestException('Failed to create delivery address - no data returned');
      }

      this.logger.log(`Delivery address created for project: ${addressDto.projectId}`, address);
      return address;

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`Unexpected error creating delivery address: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to create delivery address');
    }
  }

  /**
   * Get delivery addresses for a project
   */
  async getDeliveryAddresses(projectId: string, userId: string): Promise<any[]> {
    try {
      const { data: addresses, error } = await this.supabase.client
        .from('delivery_addresses')
        .select('*')
        .eq('project_id', projectId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        this.logger.error(`Error fetching delivery addresses: ${error.message}`, error);
        throw new BadRequestException('Failed to retrieve delivery addresses');
      }

      this.logger.log(`Found ${addresses?.length || 0} delivery addresses for project: ${projectId}`, addresses);
      return addresses || [];

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`Unexpected error fetching delivery addresses: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve delivery addresses');
    }
  }

  /**
   * Get available carriers
   */
  async getCarriers(): Promise<any[]> {
    try {
      const { data: carriers, error } = await this.supabase.client
        .from('carriers')
        .select('id, name, code, contact_email, contact_phone, service_areas, capabilities, performance_metrics')
        .eq('active', true)
        .order('name');

      if (error) {
        this.logger.error(`Error fetching carriers: ${error.message}`, error);
        throw new BadRequestException('Failed to retrieve carriers');
      }

      return carriers || [];

    } catch (error) {
      this.logger.error(`Unexpected error fetching carriers: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to retrieve carriers');
    }
  }

  /**
   * Cancel delivery order
   */
  async cancelDeliveryOrder(id: string, reason: string, userId: string): Promise<DeliveryOrderResponseDto> {
    try {
      this.logger.log(`Cancelling delivery order ${id} by user ${userId}, reason: ${reason}`);

      // Update order status to cancelled
      const updatedOrder = await this.updateDeliveryOrder(
        id, 
        { 
          status: 'cancelled' as DeliveryStatus,
          notes: `Cancelled: ${reason}`
        }, 
        userId
      );

      // Add tracking event
      await this.addTrackingEvent({
        deliveryOrderId: id,
        eventType: 'cancelled',
        eventDescription: `Order cancelled: ${reason}`,
        eventTimestamp: new Date(),
        internalNotes: `Cancelled by user ${userId}`
      }, userId);

      return updatedOrder;

    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException || error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`Unexpected error cancelling delivery order: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to cancel delivery order');
    }
  }

  // Private helper methods

  private transformToDeliveryOrderResponse(order: any, items: any[], tracking: any[]): DeliveryOrderResponseDto {
    return {
      id: order.id,
      orderNumber: order.order_number,
      projectId: order.project_id,
      projectName: order.projects?.name,
      inspectionId: order.inspection_id,
      status: order.status,
      priority: order.priority,
      requestedDeliveryDate: order.requested_delivery_date,
      estimatedDeliveryDate: order.estimated_delivery_date,
      actualDeliveryDate: order.actual_delivery_date,
      deliveryWindowStart: order.delivery_window_start,
      deliveryWindowEnd: order.delivery_window_end,
      totalWeightKg: order.total_weight_kg,
      totalVolumeM3: order.total_volume_m3,
      packageCount: order.package_count,
      specialHandlingRequirements: order.special_handling_requirements,
      deliveryInstructions: order.delivery_instructions,
      deliveryCostInr: order.delivery_cost_inr,
      insuranceCostInr: order.insurance_cost_inr,
      handlingCostInr: order.handling_cost_inr,
      totalDeliveryCostInr: order.total_delivery_cost_inr,
      trackingNumber: order.tracking_number,
      carrierReference: order.carrier_reference,
      pickupDate: order.pickup_date,
      notes: order.notes,
      deliveryAddress: order.delivery_addresses ? {
        id: order.delivery_address_id,
        companyName: order.delivery_addresses.company_name,
        contactPerson: order.delivery_addresses.contact_person,
        contactPhone: order.delivery_addresses.contact_phone,
        contactEmail: order.delivery_addresses.contact_email,
        addressLine1: order.delivery_addresses.address_line1,
        addressLine2: order.delivery_addresses.address_line2,
        city: order.delivery_addresses.city,
        stateProvince: order.delivery_addresses.state_province,
        postalCode: order.delivery_addresses.postal_code,
        country: order.delivery_addresses.country,
        specialInstructions: order.delivery_addresses.special_instructions
      } : null,
      carrier: order.carriers ? {
        id: order.carrier_id,
        name: order.carriers.name,
        code: order.carriers.code,
        contactEmail: order.carriers.contact_email,
        contactPhone: order.carriers.contact_phone
      } : null,
      items: (items || []).map(item => ({
        id: item.id,
        bomItemId: item.bom_item_id,
        qualityApprovedItemId: item.quality_approved_item_id,
        partNumber: item.bom_items?.part_number,
        description: item.bom_items?.description,
        material: item.bom_items?.material,
        unitOfMeasure: item.bom_items?.unit_of_measure,
        approvedQuantity: item.approved_quantity,
        deliveryQuantity: item.delivery_quantity,
        unitWeightKg: item.unit_weight_kg,
        totalWeightKg: item.total_weight_kg,
        unitDimensionsCm: item.unit_dimensions_cm,
        packagingType: item.packaging_type,
        packagingInstructions: item.packaging_instructions,
        hazmatClassification: item.hazmat_classification,
        qcCertificateNumber: item.qc_certificate_number || item.quality_approved_items?.qc_certificate_number,
        batchNumber: item.batch_number || item.quality_approved_items?.batch_number,
        serialNumbers: item.serial_numbers ? JSON.parse(item.serial_numbers) : [],
        unitValueInr: item.unit_value_inr,
        totalValueInr: item.total_value_inr,
        qualityGrade: item.quality_approved_items?.quality_grade,
        approvalNotes: item.quality_approved_items?.approval_notes
      })),
      tracking: (tracking || []).map(event => ({
        id: event.id,
        eventType: event.event_type,
        eventDescription: event.event_description,
        eventTimestamp: event.event_timestamp,
        locationName: event.location_name,
        locationAddress: event.location_address,
        latitude: event.latitude,
        longitude: event.longitude,
        carrierStatusCode: event.carrier_status_code,
        internalNotes: event.internal_notes,
        proofOfDelivery: event.proof_of_delivery,
        createdAt: event.created_at
      })),
      createdBy: order.created_by,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      approvedBy: order.approved_by,
      approvedAt: order.approved_at
    };
  }

  private transformToSimplifiedDeliveryOrderResponse(order: any): Partial<DeliveryOrderResponseDto> {
    return {
      id: order.id,
      orderNumber: order.order_number,
      projectId: order.project_id,
      projectName: order.projects?.name,
      status: order.status,
      priority: order.priority,
      requestedDeliveryDate: order.requested_delivery_date,
      estimatedDeliveryDate: order.estimated_delivery_date,
      actualDeliveryDate: order.actual_delivery_date,
      packageCount: order.package_count,
      totalDeliveryCostInr: order.total_delivery_cost_inr,
      trackingNumber: order.tracking_number,
      deliveryAddress: order.delivery_addresses ? {
        companyName: order.delivery_addresses.company_name,
        contactPerson: order.delivery_addresses.contact_person,
        city: order.delivery_addresses.city,
        country: order.delivery_addresses.country
      } : null,
      carrier: order.carriers ? {
        id: order.carrier_id,
        name: order.carriers.name,
        code: order.carriers.code
      } : null,
      createdAt: order.created_at,
      updatedAt: order.updated_at
    };
  }

  private async createTrackingEventsForUpdate(
    orderId: string, 
    existingOrder: DeliveryOrderResponseDto, 
    updateDto: UpdateDeliveryOrderDto, 
    userId: string
  ): Promise<void> {
    const trackingEvents = [];

    // Status change event
    if (updateDto.status && updateDto.status !== existingOrder.status) {
      trackingEvents.push({
        deliveryOrderId: orderId,
        eventType: 'status_change',
        eventDescription: `Status changed from ${existingOrder.status} to ${updateDto.status}`,
        eventTimestamp: new Date(),
        internalNotes: `Updated by user ${userId}`
      });
    }

    // Tracking number assignment
    if (updateDto.trackingNumber && updateDto.trackingNumber !== existingOrder.trackingNumber) {
      trackingEvents.push({
        deliveryOrderId: orderId,
        eventType: 'tracking_assigned',
        eventDescription: `Tracking number assigned: ${updateDto.trackingNumber}`,
        eventTimestamp: new Date(),
        internalNotes: `Updated by user ${userId}`
      });
    }

    // Carrier change
    if (updateDto.carrierId && updateDto.carrierId !== existingOrder.carrier?.id) {
      trackingEvents.push({
        deliveryOrderId: orderId,
        eventType: 'carrier_change',
        eventDescription: `Carrier updated`,
        eventTimestamp: new Date(),
        internalNotes: `Carrier changed by user ${userId}`
      });
    }

    // Create all tracking events
    for (const event of trackingEvents) {
      await this.addTrackingEvent(event, userId);
    }
  }

  private async updateOrderStatusFromTracking(
    orderId: string, 
    eventType: string, 
    eventTimestamp: string, 
    userId: string
  ): Promise<void> {
    const statusMapping: Record<string, DeliveryStatus> = {
      'picked_up': DeliveryStatus.IN_TRANSIT,
      'out_for_delivery': DeliveryStatus.OUT_FOR_DELIVERY,
      'delivered': DeliveryStatus.DELIVERED,
      'delivery_failed': DeliveryStatus.FAILED_DELIVERY,
      'returned': DeliveryStatus.RETURNED,
      'cancelled': DeliveryStatus.CANCELLED
    };

    const newStatus = statusMapping[eventType];
    if (!newStatus) return;

    const updateData: any = {
      status: newStatus,
      updated_at: new Date().toISOString(),
      updated_by: userId
    };

    // Set actual delivery date for delivered status
    if (newStatus === 'delivered') {
      updateData.actual_delivery_date = eventTimestamp;
    }

    const { error } = await this.supabase.client
      .from('delivery_orders')
      .update(updateData)
      .eq('id', orderId);

    if (error) {
      this.logger.error(`Error updating order status from tracking: ${error.message}`, error);
    }
  }
}