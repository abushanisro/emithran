import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger, ForbiddenException, ConflictException } from '@nestjs/common';
import { UuidValidator } from '@/common/validators/uuid.validator';
import { SupabaseService } from '@/common/supabase/supabase.service';
import {
  CreateProductionLotDto,
  UpdateProductionLotDto,
  ProductionLotResponseDto,
} from './dto/production-lot.dto';
import {
  CreateLotVendorAssignmentDto,
  UpdateLotVendorAssignmentDto,
  BulkVendorAssignmentDto,
} from './dto/vendor-assignment.dto';
import {
  CreateProductionProcessDto,
  UpdateProductionProcessDto,
  CreateProcessSubtaskDto,
  UpdateProcessSubtaskDto,
} from './dto/production-process.dto';
import {
  CreateDailyProductionEntryDto,
  UpdateDailyProductionEntryDto,
  DailyProductionEntryResponseDto,
  ProductionSummaryDto,
} from './dto/daily-production.dto';

interface ProcessTemplate {
  id: string;
  name: string;
  description: string;
  estimatedDuration: number;
  category: string;
}

@Injectable()
export class ProductionPlanningService {
  private readonly logger = new Logger(ProductionPlanningService.name);

  constructor(private readonly supabaseService: SupabaseService) { }

  // ============================================================================
  // PRODUCTION LOTS METHODS
  // ============================================================================

  async createProductionLot(
    createDto: CreateProductionLotDto,
    userId: string,
  ): Promise<ProductionLotResponseDto> {
    const supabase = this.supabaseService.getClient();

    // Verify user owns the BOM
    const { data: bomCheck } = await supabase
      .from('boms')
      .select('id, user_id')
      .eq('id', createDto.bomId)
      .eq('user_id', userId)
      .single();

    if (!bomCheck) {
      throw new NotFoundException('The specified BOM was not found or you do not have permission to access it. Please verify the BOM ID and try again.');
    }

    // Check if lot number is unique
    const { data: existingLot } = await supabase
      .from('production_lots')
      .select('id')
      .eq('lot_number', createDto.lotNumber)
      .single();

    if (existingLot) {
      throw new ConflictException(
        `Production lot number '${createDto.lotNumber}' already exists. Please choose a different lot number.`
      );
    }

    // Calculate total estimated cost based on BOM
    const totalEstimatedCost = await this.calculateEstimatedLotCost(
      createDto.bomId,
      createDto.productionQuantity,
    );

    // Create production lot
    const { data: lotData, error } = await supabase
      .from('production_lots')
      .insert({
        bom_id: createDto.bomId,
        lot_number: createDto.lotNumber,
        production_quantity: createDto.productionQuantity,
        planned_start_date: createDto.plannedStartDate,
        planned_end_date: createDto.plannedEndDate,
        priority: createDto.priority,
        lot_type: createDto.lotType,
        total_estimated_cost: totalEstimatedCost,
        remarks: createDto.remarks,
        created_by: userId,
      })
      .select('*')
      .single();

    if (error) {
      this.logger.error(`Error creating production lot: ${error.message}`, 'ProductionPlanningService');
      
      // Handle foreign key constraints
      if (error.message.includes('violates foreign key constraint')) {
        if (error.message.includes('bom_id')) {
          throw new BadRequestException('The specified BOM does not exist or has been deleted.');
        }
        if (error.message.includes('created_by')) {
          throw new BadRequestException('User account is not valid. Please log in again.');
        }
      }
      
      // Handle validation constraints
      if (error.message.includes('violates check constraint')) {
        if (error.message.includes('production_quantity_positive')) {
          throw new BadRequestException('Production quantity must be greater than zero.');
        }
        if (error.message.includes('planned_dates_valid')) {
          throw new BadRequestException('Planned end date must be after the planned start date.');
        }
      }
      
      // Handle duplicate constraints
      if (error.message.includes('duplicate key') && error.message.includes('lot_number')) {
        throw new ConflictException(
          `Production lot number '${createDto.lotNumber}' already exists. Please choose a different lot number.`
        );
      }
      
      throw new InternalServerErrorException('Failed to create production lot. Please check your input and try again.');
    }

    // If specific BOM items are selected, create records for them
    if (createDto.selectedBomItemIds && createDto.selectedBomItemIds.length > 0) {
      this.logger.log(`Creating lot with ${createDto.selectedBomItemIds.length} selected BOM items: ${createDto.selectedBomItemIds.join(', ')}`);
      
      const lotBomItems = createDto.selectedBomItemIds.map(itemId => ({
        production_lot_id: lotData.id,
        bom_item_id: itemId,
      }));

      const { error: itemsError } = await supabase
        .from('production_lot_bom_items')
        .insert(lotBomItems);

      if (itemsError) {
        // If table doesn't exist, just log warning and continue
        if (itemsError.message.includes('schema cache') || itemsError.message.includes('does not exist')) {
          this.logger.warn('production_lot_bom_items table not available, skipping BOM item association');
        } else {
          // If inserting lot items fails for other reasons, we should clean up the lot
          this.logger.error(`Failed to insert selected BOM items: ${itemsError.message}`, itemsError);
          await supabase.from('production_lots').delete().eq('id', lotData.id);
          throw new BadRequestException(`Failed to associate BOM items: ${itemsError.message}`);
        }
      } else {
        this.logger.log(`Successfully associated ${createDto.selectedBomItemIds.length} BOM items with lot ${lotData.id}`);
      }
    } else {
      this.logger.warn(`No BOM items selected for lot ${lotData.id} - will show all BOM items as fallback`);
    }

    // Auto-create the 4 standard production processes for the new lot
    await this.createDefaultProcessesForLot(lotData.id, createDto.plannedStartDate, createDto.plannedEndDate);

    // Try to fetch the complete lot data with BOM info and selected items
    let data, fetchError;
    try {
      const result = await supabase
        .from('production_lots')
        .select(`
          *,
          bom:boms(
            id, 
            name, 
            version,
            items:bom_items(
              id,
              name,
              part_number,
              description,
              quantity,
              unit,
              item_type,
              material,
              material_grade,
              unit_cost_inr,
              total_cost_inr,
              make_buy
            )
          )
        `)
        .eq('id', lotData.id)
        .single();
      
      data = result.data;
      fetchError = result.error;
    } catch (relationshipError) {
      // Fallback: fetch without relationships if they don't exist
      this.logger.warn('Failed to fetch with relationships, falling back to basic query', relationshipError);
      
      const fallbackResult = await supabase
        .from('production_lots')
        .select(`
          *,
          bom:boms(
            id, 
            name, 
            version
          )
        `)
        .eq('id', lotData.id)
        .single();
      
      data = fallbackResult.data;
      fetchError = fallbackResult.error;

      // Fetch BOM items separately
      if (data && data.bom) {
        const { data: bomItems } = await supabase
          .from('bom_items')
          .select(`
            id,
            name,
            part_number,
            description,
            quantity,
            unit,
            item_type,
            material,
            material_grade,
            unit_cost_inr,
            total_cost_inr,
            make_buy
          `)
          .eq('bom_id', data.bom.id)
          .order('level_in_bom', { ascending: true });

        if (bomItems) {
          data.bom.items = bomItems;
        }
      }
    }

    if (fetchError) {
      throw new BadRequestException(`Failed to fetch production lot: ${fetchError.message}`);
    }

    return this.mapToProductionLotResponse(data);
  }

  async getProductionLots(
    userId: string,
    filters: { status?: string; bomId?: string; priority?: string },
  ): Promise<ProductionLotResponseDto[]> {
    const supabase = this.supabaseService.getClient();

    // Try to fetch with relationships first
    let data, error;
    try {
      let query = supabase
        .from('production_lots')
        .select(`
          *,
          bom:boms(
            id, 
            name, 
            version,
            items:bom_items(
              id,
              name,
              part_number,
              description,
              quantity,
              unit,
              item_type,
              material,
              material_grade,
              unit_cost_inr,
              total_cost_inr,
              make_buy
            )
          )
        `)
        .eq('boms.user_id', userId)
        .order('created_at', { ascending: false });

      if (filters.status) {
        query = query.eq('status', filters.status);
      }
      if (filters.bomId) {
        query = query.eq('bom_id', filters.bomId);
      }
      if (filters.priority) {
        query = query.eq('priority', filters.priority);
      }

      const result = await query;
      data = result.data;
      error = result.error;
    } catch (relationshipError) {
      // Fallback to basic query without relationships
      this.logger.warn('Failed to fetch lots with relationships, using fallback', relationshipError);
      
      let fallbackQuery = supabase
        .from('production_lots')
        .select(`
          *,
          bom:boms(
            id, 
            name, 
            version
          )
        `)
        .eq('boms.user_id', userId)
        .order('created_at', { ascending: false });

      if (filters.status) {
        fallbackQuery = fallbackQuery.eq('status', filters.status);
      }
      if (filters.bomId) {
        fallbackQuery = fallbackQuery.eq('bom_id', filters.bomId);
      }
      if (filters.priority) {
        fallbackQuery = fallbackQuery.eq('priority', filters.priority);
      }

      const fallbackResult = await fallbackQuery;
      data = fallbackResult.data;
      error = fallbackResult.error;

      // Fetch BOM items separately for each lot
      if (data && data.length > 0) {
        for (const lot of data) {
          if (lot.bom) {
            const { data: bomItems } = await supabase
              .from('bom_items')
              .select(`
                id,
                name,
                part_number,
                description,
                quantity,
                unit,
                item_type,
                material,
                material_grade,
                unit_cost_inr,
                total_cost_inr,
                make_buy
              `)
              .eq('bom_id', lot.bom.id)
              .order('level_in_bom', { ascending: true });

            if (bomItems) {
              lot.bom.items = bomItems;
            }
          }
        }
      }
    }

    if (error) {
      throw new BadRequestException(`Failed to get production lots: ${error.message}`);
    }

    return (data || []).map((lot) => this.mapToProductionLotResponse(lot));
  }

  async getProductionLotById(id: string, userId: string): Promise<ProductionLotResponseDto> {
    UuidValidator.validateUuid(id, 'Production lot ID');
    UuidValidator.validateUuid(userId, 'User ID');

    const supabase = this.supabaseService.getClient();

    // Industry Best Practice: Use explicit queries instead of complex nested relationships
    // Step 1: Get production lot basic data
    const { data: lotData, error: lotError } = await supabase
      .from('production_lots')
      .select('*')
      .eq('id', id)
      .eq('created_by', userId)
      .single();

    if (lotError) {
      this.logger.error('Database error fetching production lot', {
        error: lotError.message,
        lotId: id,
        userId
      });
      throw new InternalServerErrorException('Failed to fetch production lot');
    }

    if (!lotData) {
      this.logger.warn('Production lot not found', { lotId: id, userId });
      throw new NotFoundException(`Production lot with ID ${id} not found or access denied`);
    }

    // Step 2: Get BOM data separately
    const { data: bomData } = await supabase
      .from('boms')
      .select(`
        id, 
        name, 
        version
      `)
      .eq('id', lotData.bom_id)
      .single();

    // Step 3: Get selected BOM items separately (with error handling)
    let selectedBomItems: any[] = [];
    try {
      const { data: selectedBomItemsRaw, error: bomItemsError } = await supabase
        .from('production_lot_bom_items')
        .select('bom_item_id')
        .eq('production_lot_id', id);

      if (bomItemsError) {
        this.logger.warn(`production_lot_bom_items table issue: ${bomItemsError.message}`);
      } else if (selectedBomItemsRaw && selectedBomItemsRaw.length > 0) {
        // Get full BOM item details for selected items
        const bomItemIds = selectedBomItemsRaw.map(item => item.bom_item_id);
        const { data: bomItemDetails } = await supabase
          .from('bom_items')
          .select(`
            id,
            name,
            part_number,
            description,
            quantity,
            unit,
            item_type,
            material,
            material_grade,
            unit_cost_inr,
            total_cost_inr,
            make_buy
          `)
          .in('id', bomItemIds);

        selectedBomItems = bomItemDetails?.map((item: any) => ({
          bom_item_id: item.id,
          bom_item: item
        })) || [];
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch selected BOM items: ${error.message}`);
    }

    // Step 5: Combine all data
    const data = {
      ...lotData,
      bom: bomData,
      selected_bom_items: selectedBomItems
    };

    this.logger.log(`Successfully fetched lot ${id} with ${selectedBomItems.length} selected BOM items`);

    // Fetch related data separately and handle gracefully if they don't exist
    let processes: any[] = [];
    let vendorAssignments: any[] = [];

    // Temporarily disable production processes query due to schema relationship error
    // try {
    //   processes = await this.getProductionProcessesByLotId(id);
    // } catch (error) {
    //   this.logger.warn('No production processes found for lot', { lotId: id, error: error.message });
    // }

    // Temporarily disable vendor assignments query due to potential schema issues
    // try {
    //   vendorAssignments = await this.getLotVendorAssignments(id);
    // } catch (error) {
    //   this.logger.warn('No vendor assignments found for lot', { lotId: id, error: error.message });
    // }

    return this.mapToProductionLotResponse({
      ...data,
      processes,
      vendor_assignments: vendorAssignments
    });
  }

  async getProductionLotBomItems(id: string, userId: string): Promise<any[]> {
    UuidValidator.validateUuid(id, 'Production lot ID');
    UuidValidator.validateUuid(userId, 'User ID');

    const supabase = this.supabaseService.getClient();

    // First verify the production lot exists and user has access
    const { data: lot, error: lotError } = await supabase
      .from('production_lots')
      .select('bom_id')
      .eq('id', id)
      .eq('created_by', userId)
      .single();

    if (lotError || !lot) {
      throw new NotFoundException('Production lot not found or access denied');
    }

    // Get BOM items for this lot
    const { data, error } = await supabase
      .from('bom_items')
      .select(`
        id,
        name,
        part_number,
        description,
        quantity,
        unit,
        item_type,
        material,
        material_grade,
        unit_cost,
        make_buy
      `)
      .eq('bom_id', lot.bom_id);

    if (error) {
      this.logger.error('Failed to fetch BOM items for production lot', {
        error: error.message,
        lotId: id,
        bomId: lot.bom_id
      });
      throw new InternalServerErrorException('Failed to fetch BOM items');
    }

    return data || [];
  }

  async getProductionLotVendorAssignments(lotId: string, userId: string): Promise<any[]> {
    UuidValidator.validateUuid(lotId, 'Production lot ID');
    UuidValidator.validateUuid(userId, 'User ID');

    const supabase = this.supabaseService.getClient();

    // First verify the production lot exists and user has access
    const { data: lot, error: lotError } = await supabase
      .from('production_lots')
      .select('id')
      .eq('id', lotId)
      .eq('created_by', userId)
      .single();

    if (lotError || !lot) {
      throw new NotFoundException('Production lot not found or access denied');
    }

    // Get vendor assignments for this lot
    const { data, error } = await supabase
      .from('lot_vendor_assignments')
      .select(`
        id,
        bom_item_id,
        vendor_id,
        required_quantity,
        unit_cost,
        total_cost,
        delivery_status,
        expected_delivery_date,
        actual_delivery_date,
        quality_status,
        remarks,
        created_at,
        updated_at
      `)
      .eq('production_lot_id', lotId);

    if (error) {
      this.logger.error('Failed to fetch vendor assignments for production lot', {
        error: error.message,
        lotId
      });
      throw new InternalServerErrorException('Failed to fetch vendor assignments');
    }

    // Enhance with vendor and BOM item details
    const enrichedAssignments = [];
    for (const assignment of data || []) {
      try {
        // Get vendor details
        const { data: vendor } = await supabase
          .from('vendors')
          .select('id, name, company_email, contact_person')
          .eq('id', assignment.vendor_id)
          .single();

        // Get BOM item details  
        const { data: bomItem } = await supabase
          .from('bom_items')
          .select('id, name, part_number, description')
          .eq('id', assignment.bom_item_id)
          .single();

        enrichedAssignments.push({
          ...assignment,
          vendor,
          bom_item: bomItem
        });
      } catch (enrichError) {
        this.logger.warn('Failed to enrich vendor assignment', {
          assignmentId: assignment.id,
          error: enrichError.message
        });
        enrichedAssignments.push(assignment);
      }
    }

    return enrichedAssignments;
  }



  async updateProductionLot(
    id: string,
    updateDto: UpdateProductionLotDto,
    userId: string,
  ): Promise<ProductionLotResponseDto> {
    const supabase = this.supabaseService.getClient();

    // Get existing lot to check current status for validation
    const { data: existingLot } = await supabase
      .from('production_lots')
      .select('id, status, boms!inner(user_id)')
      .eq('id', id)
      .eq('boms.user_id', userId)
      .single();

    if (!existingLot) {
      throw new NotFoundException('Production lot not found');
    }

    // Validate status transitions if status is being updated
    if (updateDto.status !== undefined) {
      this.validateStatusTransition(existingLot.status, updateDto.status);
    }

    // Transform camelCase DTO fields to snake_case database fields
    const updateData: any = { updated_at: new Date().toISOString() };

    // Handle field name transformations
    if (updateDto.lotNumber !== undefined) updateData.lot_number = updateDto.lotNumber;
    if (updateDto.productionQuantity !== undefined) updateData.production_quantity = updateDto.productionQuantity;
    if (updateDto.status !== undefined) updateData.status = updateDto.status;
    if (updateDto.plannedStartDate !== undefined) updateData.planned_start_date = updateDto.plannedStartDate;
    if (updateDto.plannedEndDate !== undefined) updateData.planned_end_date = updateDto.plannedEndDate;
    if (updateDto.actualStartDate !== undefined) updateData.actual_start_date = updateDto.actualStartDate;
    if (updateDto.actualEndDate !== undefined) updateData.actual_end_date = updateDto.actualEndDate;

    const { data, error } = await supabase
      .from('production_lots')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        bom:boms(id, name, version)
      `)
      .single();

    if (error) {
      throw new BadRequestException(`Failed to update production lot: ${error.message}`);
    }

    return this.mapToProductionLotResponse(data);
  }

  async deleteProductionLot(id: string, userId: string): Promise<void> {
    const supabase = this.supabaseService.getClient();

    // Verify ownership through BOM
    const { data: existingLot } = await supabase
      .from('production_lots')
      .select('id, boms!inner(user_id)')
      .eq('id', id)
      .eq('boms.user_id', userId)
      .single();

    if (!existingLot) {
      throw new NotFoundException('Production lot not found');
    }

    const { error } = await supabase.from('production_lots').delete().eq('id', id);

    if (error) {
      throw new BadRequestException(`Failed to delete production lot: ${error.message}`);
    }
  }

  // ============================================================================
  // VENDOR ASSIGNMENT METHODS
  // ============================================================================

  async createVendorAssignment(
    createDto: CreateLotVendorAssignmentDto,
    userId: string,
  ): Promise<any> {
    const supabase = this.supabaseService.getClient();

    // Verify lot ownership
    await this.verifyLotOwnership(createDto.productionLotId, userId);

    const totalCost = createDto.unitCost ? createDto.requiredQuantity * createDto.unitCost : 0;

    // Check if assignment already exists for this vendor and BOM item
    const { data: existingAssignment } = await supabase
      .from('lot_vendor_assignments')
      .select('id')
      .eq('production_lot_id', createDto.productionLotId)
      .eq('bom_item_id', createDto.bomItemId)
      .eq('vendor_id', createDto.vendorId)
      .single();

    if (existingAssignment) {
      throw new BadRequestException('Vendor assignment already exists for this BOM item and vendor. Please update the existing assignment instead.');
    }

    // Create new assignment (allowing multiple vendors per BOM item)
    const { data, error } = await supabase
      .from('lot_vendor_assignments')
      .insert({
        production_lot_id: createDto.productionLotId,
        bom_item_id: createDto.bomItemId,
        vendor_id: createDto.vendorId,
        required_quantity: createDto.requiredQuantity,
        unit_cost: createDto.unitCost || 0,
        total_cost: totalCost,
        expected_delivery_date: createDto.expectedDeliveryDate,
        remarks: createDto.remarks,
      })
      .select(`
        *,
        bom_item:bom_items(id, part_number, description),
        vendor:vendors(id, name, company_email)
      `)
      .single();

    if (error) {
      throw new BadRequestException(`Failed to create vendor assignment: ${error.message}`);
    }

    return data;
  }

  async bulkCreateVendorAssignments(
    bulkDto: BulkVendorAssignmentDto,
    userId: string,
  ): Promise<any[]> {
    const supabase = this.supabaseService.getClient();

    // Verify lot ownership
    await this.verifyLotOwnership(bulkDto.productionLotId, userId);

    const assignments = bulkDto.assignments.map((assignment) => ({
      production_lot_id: bulkDto.productionLotId,
      bom_item_id: assignment.bomItemId,
      vendor_id: assignment.vendorId,
      required_quantity: assignment.requiredQuantity,
      unit_cost: assignment.unitCost || 0,
      total_cost: assignment.unitCost
        ? assignment.requiredQuantity * assignment.unitCost
        : 0,
      expected_delivery_date: assignment.expectedDeliveryDate,
      remarks: assignment.remarks,
    }));

    const { data, error } = await supabase
      .from('lot_vendor_assignments')
      .insert(assignments)
      .select(`
        *,
        bom_item:bom_items(id, part_number, description),
        vendor:vendors(id, name, company_email)
      `);

    if (error) {
      throw new BadRequestException(`Failed to create vendor assignments: ${error.message}`);
    }

    return data;
  }

  async getVendorAssignments(lotId: string, userId: string): Promise<any[]> {
    const supabase = this.supabaseService.getClient();

    // Verify lot ownership
    await this.verifyLotOwnership(lotId, userId);

    const { data, error } = await supabase
      .from('lot_vendor_assignments')
      .select(`
        *,
        bom_item:bom_items(id, part_number, description),
        vendor:vendors(id, name, company_email)
      `)
      .eq('production_lot_id', lotId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new BadRequestException(`Failed to get vendor assignments: ${error.message}`);
    }

    return data;
  }

  async updateVendorAssignment(
    id: string,
    updateDto: UpdateLotVendorAssignmentDto,
    userId: string,
  ): Promise<any> {
    const supabase = this.supabaseService.getClient();

    // Verify ownership
    const { data: assignment } = await supabase
      .from('lot_vendor_assignments')
      .select('production_lot_id')
      .eq('id', id)
      .single();

    if (!assignment) {
      throw new NotFoundException('Vendor assignment not found');
    }

    await this.verifyLotOwnership(assignment.production_lot_id, userId);

    // Convert camelCase DTO fields to snake_case for database
    let updateData: any = {};
    if (updateDto.requiredQuantity !== undefined) updateData.required_quantity = updateDto.requiredQuantity;
    if (updateDto.unitCost !== undefined) updateData.unit_cost = updateDto.unitCost;
    if (updateDto.deliveryStatus !== undefined) updateData.delivery_status = updateDto.deliveryStatus;
    if (updateDto.expectedDeliveryDate !== undefined) updateData.expected_delivery_date = updateDto.expectedDeliveryDate;
    if (updateDto.actualDeliveryDate !== undefined) updateData.actual_delivery_date = updateDto.actualDeliveryDate;
    if (updateDto.qualityStatus !== undefined) updateData.quality_status = updateDto.qualityStatus;
    if (updateDto.remarks !== undefined) updateData.remarks = updateDto.remarks;

    // Calculate total cost if unit cost or quantity is updated
    if (updateDto.unitCost !== undefined || updateDto.requiredQuantity !== undefined) {
      const { data: currentAssignment } = await supabase
        .from('lot_vendor_assignments')
        .select('unit_cost, required_quantity')
        .eq('id', id)
        .single();

      const unitCost = updateDto.unitCost ?? currentAssignment?.unit_cost ?? 0;
      const quantity = updateDto.requiredQuantity ?? currentAssignment?.required_quantity ?? 0;
      updateData.total_cost = unitCost * quantity;
    }

    const { data, error } = await supabase
      .from('lot_vendor_assignments')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        bom_item:bom_items(id, part_number, description),
        vendor:vendors(id, name, company_email)
      `)
      .single();

    if (error) {
      throw new BadRequestException(`Failed to update vendor assignment: ${error.message}`);
    }

    return data;
  }

  async deleteVendorAssignment(id: string, userId: string): Promise<void> {
    const supabase = this.supabaseService.getClient();

    // Verify ownership
    const { data: assignment } = await supabase
      .from('lot_vendor_assignments')
      .select('production_lot_id')
      .eq('id', id)
      .single();

    if (!assignment) {
      throw new NotFoundException('Vendor assignment not found');
    }

    await this.verifyLotOwnership(assignment.production_lot_id, userId);

    const { error } = await supabase.from('lot_vendor_assignments').delete().eq('id', id);

    if (error) {
      throw new BadRequestException(`Failed to delete vendor assignment: ${error.message}`);
    }
  }

  // ============================================================================
  // PRODUCTION PROCESS METHODS
  // ============================================================================

  async createProductionProcess(
    createDto: CreateProductionProcessDto,
    userId: string,
  ): Promise<any> {
    const supabase = this.supabaseService.getClient();

    // Verify lot ownership
    await this.verifyLotOwnership(createDto.production_lot_id, userId);

    // Get the next sequence number for this production lot
    const { data: existingProcesses } = await supabase
      .from('production_processes')
      .select('process_sequence')
      .eq('production_lot_id', createDto.production_lot_id)
      .order('process_sequence', { ascending: false })
      .limit(1);

    const nextSequence = existingProcesses && existingProcesses.length > 0
      ? (existingProcesses[0].process_sequence || 0) + 1
      : 1;

    const { data, error } = await supabase
      .from('production_processes')
      .insert({
        production_lot_id: createDto.production_lot_id,
        process_id: createDto.process_id,
        process_sequence: nextSequence,
        process_name: createDto.process_name,
        description: createDto.description,
        assigned_department: createDto.assigned_department,
        responsible_person: createDto.responsible_person,
        machine_allocation: createDto.machineAllocation ? JSON.stringify(createDto.machineAllocation) : null,
        depends_on_process_id: createDto.dependsOnProcessId,
        quality_check_required: createDto.qualityCheckRequired,
        remarks: createDto.remarks,
      })
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(`Failed to create production process: ${error.message}`);
    }

    return data;
  }

  async getProductionProcesses(
    lotId: string,
    userId: string,
    filters: { status?: string },
  ): Promise<any[]> {
    const supabase = this.supabaseService.getClient();

    // Verify lot ownership
    await this.verifyLotOwnership(lotId, userId);

    let query = supabase
      .from('production_processes')
      .select(`
        *,
        subtasks:process_subtasks(
          *,
          bom_requirements:subtask_bom_requirements(
            id,
            bom_item_id,
            required_quantity,
            unit,
            requirement_status,
            bom_item:bom_items(
              id,
              part_number,
              name,
              description
            )
          )
        )
      `)
      .eq('production_lot_id', lotId)
      .order('process_sequence', { ascending: true });

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    const { data, error } = await query;

    if (error) {
      throw new BadRequestException(`Failed to get production processes: ${error.message}`);
    }


    return data;
  }

  async updateProductionProcess(
    id: string,
    updateDto: UpdateProductionProcessDto,
    userId: string,
  ): Promise<any> {
    const supabase = this.supabaseService.getClient();

    // TODO: Re-enable ownership verification once auth system is stable
    // const { data: process } = await supabase
    //   .from('production_processes')
    //   .select('production_lot_id')
    //   .eq('id', id)
    //   .single();
    //
    // if (!process) {
    //   throw new NotFoundException('Production process not found');
    // }
    //
    // await this.verifyLotOwnership(process.production_lot_id, userId);

    let updateData: any = { ...updateDto };
    if (updateDto.machineAllocation) {
      updateData.machine_allocation = JSON.stringify(updateDto.machineAllocation);
    }

    // Map camelCase DTO fields to snake_case database columns
    if ('plannedStartDate' in updateDto) {
      updateData.planned_start_date = updateDto.plannedStartDate;
      delete updateData.plannedStartDate;
    }
    if ('plannedEndDate' in updateDto) {
      updateData.planned_end_date = updateDto.plannedEndDate;
      delete updateData.plannedEndDate;
    }
    if ('actualStartDate' in updateDto) {
      updateData.actual_start_date = updateDto.actualStartDate;
      delete updateData.actualStartDate;
    }
    if ('actualEndDate' in updateDto) {
      updateData.actual_end_date = updateDto.actualEndDate;
      delete updateData.actualEndDate;
    }

    const { data, error } = await supabase
      .from('production_processes')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(`Failed to update production process: ${error.message}`);
    }

    return data;
  }

  async deleteProductionProcess(
    id: string,
    userId: string,
  ): Promise<void> {
    const supabase = this.supabaseService.getClient();

    // Simple delete without ownership verification for now
    const { error } = await supabase
      .from('production_processes')
      .delete()
      .eq('id', id);

    if (error) {
      throw new BadRequestException(`Failed to delete production process: ${error.message}`);
    }
  }

  // ============================================================================
  // PROCESS SUBTASK METHODS
  // ============================================================================

  async createProcessSubtask(createDto: CreateProcessSubtaskDto, userId: string): Promise<any> {
    const supabase = this.supabaseService.getClient();

    // Verify process ownership
    await this.verifyProcessOwnership(createDto.productionProcessId, userId);

    // Extract and filter BOM parts
    const rawBomParts = createDto.bomParts || [];
    
    // Filter out empty or invalid BOM parts
    const bomParts = rawBomParts.filter(part => 
      part && 
      part.bom_item_id && 
      typeof part.required_quantity === 'number' && 
      part.required_quantity > 0 &&
      part.unit
    );
    

    // Use the database function for comprehensive subtask creation with BOM parts
    const { data, error } = await supabase.rpc('create_subtask_with_bom_parts', {
      p_production_process_id: createDto.productionProcessId,
      p_task_name: createDto.taskName,
      p_created_by: userId,
      p_description: createDto.description || null,
      p_assigned_operator: createDto.assignedOperator || null,
      p_planned_start_date: createDto.plannedStartDate ? new Date(createDto.plannedStartDate).toISOString() : null,
      p_planned_end_date: createDto.plannedEndDate ? new Date(createDto.plannedEndDate).toISOString() : null,
      p_status: 'pending',
      p_bom_parts: bomParts
    });

    if (error) {
      throw new BadRequestException(`Failed to create process subtask: ${error.message}`);
    }

    if (!data || data.length === 0) {
      throw new BadRequestException('No data returned from subtask creation');
    }

    const result = data[0];
    if (!result.success) {
      throw new BadRequestException(`Subtask creation failed: ${result.message}`);
    }

    // Return the subtask details by fetching the created subtask
    const { data: subtaskData, error: fetchError } = await supabase
      .from('process_subtasks')
      .select('*')
      .eq('id', result.subtask_id)
      .single();

    if (fetchError) {
      // Subtask was created but we couldn't fetch details - return basic info
      return {
        id: result.subtask_id,
        task_name: createDto.taskName,
        success: true,
        message: result.message,
        bom_requirements_created: result.bom_requirements_created
      };
    }

    return subtaskData;
  }

  async getProcessSubtasks(processId: string, userId: string): Promise<any[]> {
    const supabase = this.supabaseService.getClient();

    // Verify process ownership
    await this.verifyProcessOwnership(processId, userId);

    const { data, error } = await supabase
      .from('process_subtasks')
      .select('*')
      .eq('production_process_id', processId)
      .order('task_sequence', { ascending: true });

    if (error) {
      throw new BadRequestException(`Failed to get process subtasks: ${error.message}`);
    }

    return data;
  }

  async updateProcessSubtask(
    id: string,
    updateDto: UpdateProcessSubtaskDto,
    userId: string,
  ): Promise<any> {
    const supabase = this.supabaseService.getClient();

    // Verify ownership
    const { data: subtask } = await supabase
      .from('process_subtasks')
      .select('production_process_id')
      .eq('id', id)
      .single();

    if (!subtask) {
      throw new NotFoundException('Process subtask not found');
    }

    await this.verifyProcessOwnership(subtask.production_process_id, userId);

    const { data, error } = await supabase
      .from('process_subtasks')
      .update(updateDto)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(`Failed to update process subtask: ${error.message}`);
    }

    return data;
  }

  async deleteProcessSubtask(id: string, userId: string): Promise<void> {
    const supabase = this.supabaseService.getClient();

    // Verify ownership
    const { data: subtask } = await supabase
      .from('process_subtasks')
      .select('production_process_id')
      .eq('id', id)
      .single();

    if (!subtask) {
      throw new NotFoundException('Process subtask not found');
    }

    await this.verifyProcessOwnership(subtask.production_process_id, userId);

    const { error } = await supabase
      .from('process_subtasks')
      .delete()
      .eq('id', id);

    if (error) {
      throw new BadRequestException(`Failed to delete process subtask: ${error.message}`);
    }
  }

  // ============================================================================
  // DAILY PRODUCTION ENTRY METHODS
  // ============================================================================

  async createDailyProductionEntry(
    createDto: CreateDailyProductionEntryDto,
    userId: string,
  ): Promise<DailyProductionEntryResponseDto> {
    const supabase = this.supabaseService.getClient();

    // Verify lot ownership
    await this.verifyLotOwnership(createDto.productionLotId, userId);

    // Calculate efficiency percentage
    const efficiencyPercentage = createDto.plannedQuantity
      ? Math.round((createDto.actualQuantity / createDto.plannedQuantity) * 100)
      : 0;

    const { data, error } = await supabase
      .from('daily_production_entries')
      .insert({
        production_lot_id: createDto.productionLotId,
        production_process_id: createDto.productionProcessId,
        entry_date: createDto.entryDate,
        entry_type: createDto.entryType,
        planned_quantity: createDto.plannedQuantity,
        actual_quantity: createDto.actualQuantity,
        rejected_quantity: createDto.rejectedQuantity,
        rework_quantity: createDto.reworkQuantity,
        downtime_hours: createDto.downtimeHours,
        downtime_reason: createDto.downtimeReason,
        shift: createDto.shift,
        operators_count: createDto.operatorsCount,
        supervisor: createDto.supervisor,
        remarks: createDto.remarks,
        issues_encountered: createDto.issuesEncountered,
        efficiency_percentage: efficiencyPercentage,
        entered_by: userId,
      })
      .select(`
        *,
        production_lot:production_lots(id, lot_number, production_quantity),
        production_process:production_processes(id, process_name, status)
      `)
      .single();

    if (error) {
      throw new BadRequestException(`Failed to create daily production entry: ${error.message}`);
    }

    return data;
  }

  async getDailyProductionEntries(
    lotId: string,
    userId: string,
    filters: { startDate?: string; endDate?: string; entryType?: string },
  ): Promise<DailyProductionEntryResponseDto[]> {
    const supabase = this.supabaseService.getClient();

    // Verify lot ownership
    await this.verifyLotOwnership(lotId, userId);

    let query = supabase
      .from('daily_production_entries')
      .select(`
        *,
        production_lot:production_lots(id, lot_number, production_quantity),
        production_process:production_processes(id, process_name, status)
      `)
      .eq('production_lot_id', lotId)
      .order('entry_date', { ascending: false });

    if (filters.startDate) {
      query = query.gte('entry_date', filters.startDate);
    }
    if (filters.endDate) {
      query = query.lte('entry_date', filters.endDate);
    }
    if (filters.entryType) {
      query = query.eq('entry_type', filters.entryType);
    }

    const { data, error } = await query;

    if (error) {
      throw new BadRequestException(`Failed to get daily production entries: ${error.message}`);
    }

    return data;
  }

  async updateDailyProductionEntry(
    id: string,
    updateDto: UpdateDailyProductionEntryDto,
    userId: string,
  ): Promise<DailyProductionEntryResponseDto> {
    const supabase = this.supabaseService.getClient();

    // Verify ownership
    const { data: entry } = await supabase
      .from('daily_production_entries')
      .select('production_lot_id')
      .eq('id', id)
      .single();

    if (!entry) {
      throw new NotFoundException('Daily production entry not found');
    }

    await this.verifyLotOwnership(entry.production_lot_id, userId);

    // Recalculate efficiency if quantities are updated
    let updateData: any = { ...updateDto };
    if (updateDto.actualQuantity !== undefined || updateDto.plannedQuantity !== undefined) {
      const { data: currentEntry } = await supabase
        .from('daily_production_entries')
        .select('planned_quantity, actual_quantity')
        .eq('id', id)
        .single();

      const plannedQuantity = updateDto.plannedQuantity ?? currentEntry?.planned_quantity ?? 0;
      const actualQuantity = updateDto.actualQuantity ?? currentEntry?.actual_quantity ?? 0;

      updateData.efficiency_percentage = plannedQuantity
        ? Math.round((actualQuantity / plannedQuantity) * 100)
        : 0;
    }

    const { data, error } = await supabase
      .from('daily_production_entries')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        production_lot:production_lots(id, lot_number, production_quantity),
        production_process:production_processes(id, process_name, status)
      `)
      .single();

    if (error) {
      throw new BadRequestException(`Failed to update daily production entry: ${error.message}`);
    }

    return data;
  }

  // ============================================================================
  // DASHBOARD & REPORTING METHODS
  // ============================================================================

  async getProductionSummary(lotId: string, userId: string): Promise<ProductionSummaryDto> {
    const supabase = this.supabaseService.getClient();

    // Verify lot ownership
    await this.verifyLotOwnership(lotId, userId);

    // Get production entries data
    const { data: entries } = await supabase
      .from('daily_production_entries')
      .select('*')
      .eq('production_lot_id', lotId);

    // Get process data
    const { data: processes } = await supabase
      .from('production_processes')
      .select('status')
      .eq('production_lot_id', lotId);

    // Calculate summary metrics
    const totalPlannedQuantity = entries?.reduce((sum, entry) => sum + entry.planned_quantity, 0) || 0;
    const totalActualQuantity = entries?.reduce((sum, entry) => sum + entry.actual_quantity, 0) || 0;
    const totalRejectedQuantity = entries?.reduce((sum, entry) => sum + entry.rejected_quantity, 0) || 0;
    const totalReworkQuantity = entries?.reduce((sum, entry) => sum + entry.rework_quantity, 0) || 0;

    const overallEfficiency = totalPlannedQuantity
      ? Math.round((totalActualQuantity / totalPlannedQuantity) * 100)
      : 0;

    const totalDowntime = entries?.reduce((sum, entry) => sum + entry.downtime_hours, 0) || 0;

    const activeProcesses = processes?.filter(p => p.status === 'in_progress').length || 0;
    const completedProcesses = processes?.filter(p => p.status === 'completed').length || 0;

    // Daily production trend
    const dailyProduction = entries?.map(entry => ({
      date: entry.entry_date,
      plannedQuantity: entry.planned_quantity,
      actualQuantity: entry.actual_quantity,
      efficiency: entry.efficiency_percentage,
    })) || [];

    // Quality metrics
    const totalProduced = totalActualQuantity + totalRejectedQuantity + totalReworkQuantity;
    const acceptanceRate = totalProduced ? Math.round((totalActualQuantity / totalProduced) * 100) : 0;
    const rejectionRate = totalProduced ? Math.round((totalRejectedQuantity / totalProduced) * 100) : 0;
    const reworkRate = totalProduced ? Math.round((totalReworkQuantity / totalProduced) * 100) : 0;
    const firstPassYield = totalProduced ? Math.round(((totalActualQuantity + totalReworkQuantity) / totalProduced) * 100) : 0;

    return {
      totalPlannedQuantity,
      totalActualQuantity,
      totalRejectedQuantity,
      totalReworkQuantity,
      overallEfficiency,
      totalDowntime,
      activeProcesses,
      completedProcesses,
      dailyProduction,
      qualityMetrics: {
        acceptanceRate,
        rejectionRate,
        reworkRate,
        firstPassYield,
      },
    };
  }

  async getDashboardData(
    userId: string,
    filters: { startDate?: string; endDate?: string },
  ): Promise<any> {
    const supabase = this.supabaseService.getClient();

    // Get lots with basic stats
    let query = supabase
      .from('production_lots')
      .select(`
        *,
        bom:boms!inner(user_id),
        processes:production_processes(status),
        entries:daily_production_entries(actual_quantity, rejected_quantity, efficiency_percentage)
      `)
      .eq('boms.user_id', userId);

    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate);
    }
    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate);
    }

    const { data: lots } = await query;

    // Calculate dashboard metrics
    const totalLots = lots?.length || 0;
    const activeLots = lots?.filter(lot => lot.status === 'in_production').length || 0;
    const completedLots = lots?.filter(lot => lot.status === 'completed').length || 0;
    const plannedLots = lots?.filter(lot => lot.status === 'planned').length || 0;

    // Overall production metrics
    const overallProduction = lots?.reduce((sum, lot) => {
      const lotProduction = lot.entries?.reduce((entrySum: number, entry: any) => entrySum + entry.actual_quantity, 0) || 0;
      return sum + lotProduction;
    }, 0) || 0;

    const overallRejected = lots?.reduce((sum, lot) => {
      const lotRejected = lot.entries?.reduce((entrySum: number, entry: any) => entrySum + entry.rejected_quantity, 0) || 0;
      return sum + lotRejected;
    }, 0) || 0;

    const averageEfficiency = lots?.length
      ? Math.round(lots.reduce((sum, lot) => {
        const lotEfficiency = lot.entries?.length
          ? lot.entries.reduce((entrySum: number, entry: any) => entrySum + entry.efficiency_percentage, 0) / lot.entries.length
          : 0;
        return sum + lotEfficiency;
      }, 0) / lots.length)
      : 0;

    return {
      summary: {
        totalLots,
        activeLots,
        completedLots,
        plannedLots,
        overallProduction,
        overallRejected,
        averageEfficiency,
      },
      lots: lots?.slice(0, 10) || [], // Recent 10 lots
    };
  }

  async getGanttData(lotId: string, userId: string): Promise<any> {
    const supabase = this.supabaseService.getClient();

    // Verify lot ownership
    await this.verifyLotOwnership(lotId, userId);

    const { data: processes } = await supabase
      .from('production_processes')
      .select(`
        *,
        subtasks:process_subtasks(*)
      `)
      .eq('production_lot_id', lotId)
      .order('process_sequence', { ascending: true });

    // Transform data for Gantt chart
    const ganttData = processes?.map(process => ({
      id: process.id,
      name: process.process_name,
      start: process.planned_start_date,
      end: process.planned_end_date,
      progress: process.completion_percentage,
      status: process.status,
      dependencies: process.depends_on_process_id ? [process.depends_on_process_id] : [],
      subtasks: process.subtasks?.map((subtask: any) => ({
        id: subtask.id,
        name: subtask.task_name,
        duration: subtask.estimated_duration_hours,
        status: subtask.status,
        assignedOperator: subtask.assigned_operator,
      })) || [],
    })) || [];

    return {
      processes: ganttData,
      timeline: {
        start: processes?.[0]?.planned_start_date,
        end: processes?.[processes.length - 1]?.planned_end_date,
      },
    };
  }


  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private async verifyLotOwnership(lotId: string, userId: string): Promise<void> {
    const supabase = this.supabaseService.getClient();

    const { data } = await supabase
      .from('production_lots')
      .select('id, boms!inner(user_id)')
      .eq('id', lotId)
      .eq('boms.user_id', userId)
      .single();

    if (!data) {
      throw new NotFoundException('Production lot not found or you do not have permission to access it');
    }
  }

  private async verifyProcessOwnership(processId: string, userId: string): Promise<void> {
    const supabase = this.supabaseService.getClient();

    // Step 1: Get the production process
    const { data: process, error: processError } = await supabase
      .from('production_processes')
      .select('id, production_lot_id')
      .eq('id', processId)
      .single();

    if (processError) {
      throw new NotFoundException(`Production process query failed: ${processError.message}`);
    }

    if (!process) {
      throw new NotFoundException(`Production process with ID ${processId} not found`);
    }

    // Step 2: Get the production lot and verify BOM ownership
    const { data: lot, error: lotError } = await supabase
      .from('production_lots')
      .select(`
        id,
        bom_id,
        boms!inner(
          id,
          user_id
        )
      `)
      .eq('id', process.production_lot_id)
      .single();

    if (lotError) {
      throw new NotFoundException(`Production lot query failed: ${lotError.message}`);
    }

    if (!lot) {
      throw new NotFoundException(`Production lot with ID ${process.production_lot_id} not found`);
    }

    // BOM check is optional - some production lots may not have BOMs yet
    if (lot.boms && lot.boms.length > 0) {
      const firstBom = lot.boms[0];
      if (firstBom) {
        // Skip user permission check if user_id is not available (for dev/legacy auth)
        if (userId && firstBom.user_id && firstBom.user_id !== userId) {
          throw new NotFoundException('You do not have permission to access this production process');
        }
      }
    }
    // If no BOM exists, we still allow the operation to proceed
  }

  private async calculateEstimatedLotCost(bomId: string, quantity: number): Promise<number> {
    const supabase = this.supabaseService.getClient();

    // Get BOM items total cost
    const { data: bomCost } = await supabase
      .rpc('calculate_bom_total_cost', { bom_id: bomId })
      .single();

    const cost = typeof bomCost === 'number' ? bomCost : Number(bomCost) || 0;
    return cost * quantity;
  }

  private async getProductionProcessesByLotId(lotId: string): Promise<any[]> {
    // NOTE: This method was causing schema relationship errors due to missing foreign key constraints
    // A migration (073_fix_production_processes_foreign_key.sql) has been created to fix this
    // Once the migration is applied, you can uncomment the code below

    try {
      const supabase = this.supabaseService.getClient();

      // Try a simple query first to check if the relationship works
      const { data, error } = await supabase
        .from('production_processes')
        .select(`
          id,
          process_sequence,
          process_name,
          description,
          status,
          planned_start_date,
          planned_end_date,
          actual_start_date,
          actual_end_date,
          completion_percentage,
          assigned_department,
          responsible_person,
          quality_status,
          remarks
        `)
        .eq('production_lot_id', lotId)
        .order('process_sequence');

      if (error) {
        this.logger.warn('Error fetching production processes - schema relationship issue', {
          error: error.message,
          lotId,
          hint: 'Run migration 073_fix_production_processes_foreign_key.sql to fix this'
        });
        return [];
      }

      return data || [];
    } catch (error) {
      this.logger.warn('Production processes query failed - returning empty array', {
        error: error.message,
        lotId,
        hint: 'This is likely due to missing foreign key constraints. Run migration 073.'
      });
      return [];
    }
  }

  private async getLotVendorAssignments(lotId: string): Promise<any[]> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('lot_vendor_assignments')
      .select(`
        id,
        bom_item_id,
        vendor_id,
        required_quantity,
        unit_cost,
        total_cost,
        delivery_status,
        expected_delivery_date,
        actual_delivery_date,
        quality_status,
        remarks
      `)
      .eq('production_lot_id', lotId);

    if (error) {
      this.logger.warn('Error fetching vendor assignments', { error: error.message, lotId });
      return [];
    }

    // If we have vendor assignments, fetch the related vendor and BOM item data separately
    if (data && data.length > 0) {
      for (const assignment of data) {
        try {
          // Fetch vendor data
          const { data: vendorData } = await supabase
            .from('vendors')
            .select('id, name, company_email, contact_person')
            .eq('id', assignment.vendor_id)
            .single();

          (assignment as any).vendor = vendorData;

          // Fetch BOM item data
          const { data: bomItemData } = await supabase
            .from('bom_items')
            .select('id, name, part_number, description')
            .eq('id', assignment.bom_item_id)
            .single();

          (assignment as any).bom_item = bomItemData;
        } catch (relatedDataError) {
          this.logger.warn('Error fetching related data for vendor assignment', {
            assignmentId: assignment.id,
            error: relatedDataError.message
          });
        }
      }
    }

    return data || [];
  }

  private mapToProductionLotResponse(data: any): ProductionLotResponseDto {
    // Transform BOM data to match DTO structure
    const bom = data.bom ? {
      id: data.bom.id,
      name: data.bom.name,
      version: data.bom.version,
      items: data.bom.items?.map((item: any) => ({
        id: item.id,
        partNumber: item.part_number,
        description: item.description,
        quantity: item.quantity,
        itemType: item.item_type,
        unitCost: item.unit_cost,
        materialGrade: item.material_grade,
        makeBuy: item.make_buy,
      })) || [],
    } : undefined;

    // Transform selected BOM items
    const selectedBomItems = data.selected_bom_items?.map((selectedItem: any) => ({
      id: selectedItem.bom_item.id,
      partNumber: selectedItem.bom_item.part_number,
      description: selectedItem.bom_item.description,
      quantity: selectedItem.bom_item.quantity,
      itemType: selectedItem.bom_item.item_type,
      unitCost: selectedItem.bom_item.unit_cost,
      materialGrade: selectedItem.bom_item.material_grade,
      makeBuy: selectedItem.bom_item.make_buy,
    })) || [];

    return {
      id: data.id,
      bomId: data.bom_id,
      lotNumber: data.lot_number,
      productionQuantity: data.production_quantity,
      status: data.status,
      plannedStartDate: data.planned_start_date,
      plannedEndDate: data.planned_end_date,
      actualStartDate: data.actual_start_date,
      actualEndDate: data.actual_end_date,
      priority: data.priority,
      lotType: data.lot_type,
      totalMaterialCost: data.total_material_cost,
      totalProcessCost: data.total_process_cost,
      totalEstimatedCost: data.total_estimated_cost,
      remarks: data.remarks,
      createdBy: data.created_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      bom: bom,
      selectedBomItems: selectedBomItems,
      vendorAssignments: data.vendor_assignments || [],
      processes: data.processes || [],
    };
  }

  async getSubtasksDirectByLot(lotId: string, userId: string): Promise<any[]> {
    const supabase = this.supabaseService.getClient();

    // Verify lot ownership
    await this.verifyLotOwnership(lotId, userId);

    // Debug: Check what's in the production_processes table for this lot
    const { data: processes, error: processError } = await supabase
      .from('production_processes')
      .select('*')
      .eq('production_lot_id', lotId);

    this.logger.log('🔍 DEBUG: Processes found for lot', { lotId, processCount: processes?.length || 0, processes, processError });

    // Also check if there are any subtasks at all in the database (regardless of lot)
    const { data: allSubtasks, error: allSubtasksError } = await supabase
      .from('process_subtasks')
      .select('id, production_process_id, task_name')
      .limit(10);

    this.logger.log('🔍 DEBUG: Sample subtasks in database', { 
      totalSubtasks: allSubtasks?.length || 0, 
      sampleSubtasks: allSubtasks,
      allSubtasksError 
    });

    if (processError || !processes || processes.length === 0) {
      this.logger.warn('No processes found for lot, checking for orphaned subtasks', { lotId, processError });
      
      // Try to find subtasks that might exist without proper processes
      const { data: orphanedSubtasks, error: orphanedError } = await supabase
        .from('process_subtasks')
        .select(`
          id,
          production_process_id,
          task_name,
          description,
          task_sequence,
          planned_start_date,
          planned_end_date,
          actual_start_date,
          actual_end_date,
          estimated_duration_hours,
          assigned_operator,
          operator_name,
          status,
          notes,
          created_at,
          updated_at
        `);

      this.logger.log('🔍 DEBUG: Orphaned subtasks check', { 
        orphanedCount: orphanedSubtasks?.length || 0, 
        orphanedSubtasks,
        orphanedError 
      });

      return orphanedSubtasks || [];
    }

    const processIds = processes.map(p => p.id);

    // Fetch subtasks directly using process IDs
    const { data: subtasks, error } = await supabase
      .from('process_subtasks')
      .select(`
        id,
        production_process_id,
        task_name,
        description,
        task_sequence,
        planned_start_date,
        planned_end_date,
        actual_start_date,
        actual_end_date,
        estimated_duration_hours,
        assigned_operator,
        operator_name,
        status,
        notes,
        created_at,
        updated_at
      `)
      .in('production_process_id', processIds)
      .order('task_sequence', { ascending: true });

    this.logger.log('🔍 DEBUG: Subtasks found for processes', { 
      processIds, 
      subtaskCount: subtasks?.length || 0, 
      subtasks,
      error 
    });

    if (error) {
      this.logger.error('Failed to fetch subtasks directly for lot', { error: error.message, lotId });
      throw new InternalServerErrorException(`Failed to fetch subtasks: ${error.message}`);
    }

    // Transform data to match expected structure
    return (subtasks || []).map(subtask => ({
      id: subtask.id,
      productionProcessId: subtask.production_process_id,
      taskName: subtask.task_name,
      description: subtask.description || '',
      taskSequence: subtask.task_sequence,
      plannedStartDate: subtask.planned_start_date,
      plannedEndDate: subtask.planned_end_date,
      actualStartDate: subtask.actual_start_date,
      actualEndDate: subtask.actual_end_date,
      assignedOperator: subtask.assigned_operator,
      operatorName: subtask.operator_name || '',
      status: subtask.status,
      notes: subtask.notes || '',
      createdAt: subtask.created_at,
      updatedAt: subtask.updated_at,
      bomRequirements: [] // Simplified for now - BOM requirements can be fetched separately if needed
    }));
  }

  // ============================================================================
  // PROCESS TEMPLATE METHODS
  // ============================================================================

  /**
   * Get default process templates for production planning
   */
  /**
   * Auto-create the 4 standard production processes for a new lot
   */
  private async createDefaultProcessesForLot(
    lotId: string, 
    plannedStartDate: string, 
    plannedEndDate: string
  ): Promise<void> {
    const supabase = this.supabaseService.getClient();

    // Define the 4 standard processes with correct names
    const standardProcesses = [
      {
        process_name: 'Raw Material',
        description: 'Raw material procurement, inspection, and preparation for production',
        process_sequence: 1,
        category: 'Material'
      },
      {
        process_name: 'Process Conversion', 
        description: 'Core manufacturing and processing operations',
        process_sequence: 2,
        category: 'Production'
      },
      {
        process_name: 'Inspection',
        description: 'Quality inspection, testing, and validation processes', 
        process_sequence: 3,
        category: 'Quality'
      },
      {
        process_name: 'Packing',
        description: 'Final packaging, labeling, and preparation for delivery',
        process_sequence: 4,
        category: 'Finishing'
      }
    ];

    // Calculate dates for each process (divide timeline equally)
    const startDate = new Date(plannedStartDate);
    const endDate = new Date(plannedEndDate);
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const daysPerProcess = Math.max(1, Math.floor(totalDays / 4));

    // Create processes with sequential dates
    const processesToCreate = standardProcesses.map((process, index) => {
      const processStart = new Date(startDate);
      processStart.setDate(startDate.getDate() + (index * daysPerProcess));
      
      const processEnd = new Date(processStart);
      processEnd.setDate(processStart.getDate() + daysPerProcess - 1);
      
      // Ensure last process ends on the lot end date
      if (index === standardProcesses.length - 1) {
        processEnd.setTime(endDate.getTime());
      }

      return {
        production_lot_id: lotId,
        process_id: null, // Let the database auto-generate UUID
        process_sequence: process.process_sequence,
        process_name: process.process_name,
        description: process.description,
        planned_start_date: processStart.toISOString(),
        planned_end_date: processEnd.toISOString(),
        status: 'pending',
        completion_percentage: 0,
        quality_check_required: true,
        quality_status: 'pending'
      };
    });

    const { error } = await supabase
      .from('production_processes')
      .insert(processesToCreate);

    if (error) {
      this.logger.error('Failed to create default processes for lot', error);
      throw new InternalServerErrorException(`Failed to create default processes: ${error.message}`);
    }

    this.logger.log(`Created ${standardProcesses.length} default processes for lot ${lotId}`);
  }

  async getDefaultProcessTemplates(userId: string): Promise<ProcessTemplate[]> {
    const supabase = this.supabaseService.getClient();

    // Try to get user's custom templates first
    const { data: userTemplates, error: userError } = await supabase
      .from('process_templates')
      .select('id, name, description, category, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (userError) {
      this.logger.warn('Failed to fetch user process templates', userError);
    }

    // If user has custom templates, return those
    if (userTemplates && userTemplates.length > 0) {
      return userTemplates.map(template => ({
        id: template.id,
        name: template.name,
        description: template.description || '',
        category: template.category || 'Production',
        estimatedDuration: 8 // Default duration, could be calculated from template steps
      }));
    }

    // Otherwise return system default templates
    return [
      {
        id: 'default-raw-material',
        name: 'Raw Material Preparation',
        description: 'Raw material procurement, inspection, and preparation for production',
        estimatedDuration: 8,
        category: 'Material'
      },
      {
        id: 'default-process-conversion',
        name: 'Manufacturing Process',
        description: 'Core manufacturing and processing operations',
        estimatedDuration: 16,
        category: 'Production'
      },
      {
        id: 'default-inspection',
        name: 'Quality Control',
        description: 'Quality inspection, testing, and validation processes',
        estimatedDuration: 4,
        category: 'Quality'
      },
      {
        id: 'default-packing',
        name: 'Packaging & Finishing',
        description: 'Final packaging, labeling, and preparation for delivery',
        estimatedDuration: 6,
        category: 'Finishing'
      }
    ];
  }

  /**
   * Create a custom process template
   */
  async createProcessTemplate(userId: string, templateData: {
    name: string;
    description?: string;
    category?: string;
  }): Promise<ProcessTemplate> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('process_templates')
      .insert({
        name: templateData.name,
        description: templateData.description,
        category: templateData.category || 'Custom',
        user_id: userId
      })
      .select('id, name, description, category')
      .single();

    if (error) {
      throw new BadRequestException(`Failed to create process template: ${error.message}`);
    }

    return {
      id: data.id,
      name: data.name,
      description: data.description || '',
      category: data.category || 'Custom',
      estimatedDuration: 8 // Default
    };
  }

  /**
   * Validate if a status transition is allowed
   */
  private validateStatusTransition(currentStatus: string, newStatus: string): void {
    const allowedTransitions: Record<string, string[]> = {
      'PLANNED': ['MATERIALS_ORDERED', 'CANCELLED', 'IN_PRODUCTION'],
      'MATERIALS_ORDERED': ['IN_PRODUCTION', 'ON_HOLD', 'CANCELLED'],
      'IN_PRODUCTION': ['COMPLETED', 'ON_HOLD', 'CANCELLED'],
      'ON_HOLD': ['IN_PRODUCTION', 'CANCELLED'],
      'COMPLETED': ['ON_HOLD'], // Allow reopening completed lots if needed
      'CANCELLED': ['PLANNED'] // Allow reactivating cancelled lots
    };

    const allowedNext = allowedTransitions[currentStatus] || [];
    
    if (!allowedNext.includes(newStatus)) {
      throw new BadRequestException(
        `Invalid status transition from ${currentStatus} to ${newStatus}. ` +
        `Allowed transitions: ${allowedNext.join(', ')}`
      );
    }
  }

  /**
   * Auto-update lot status based on progress
   */
  async updateLotStatusByProgress(lotId: string, userId: string): Promise<void> {
    const supabase = this.supabaseService.getClient();

    // Get current lot status and processes
    const { data: lot } = await supabase
      .from('production_lots')
      .select('id, status')
      .eq('id', lotId)
      .eq('created_by', userId)
      .single();

    if (!lot) return;

    // Get processes and their completion status
    const { data: processes } = await supabase
      .from('production_processes')
      .select('id, status')
      .eq('production_lot_id', lotId);

    if (!processes || processes.length === 0) return;

    const completedProcesses = processes.filter(p => p.status === 'COMPLETED').length;
    const totalProcesses = processes.length;
    const completionPercentage = (completedProcesses / totalProcesses) * 100;

    // Auto-transition status based on progress
    let newStatus = lot.status;

    if (lot.status === 'PLANNED' && completionPercentage > 0) {
      newStatus = 'IN_PRODUCTION';
    } else if (lot.status === 'IN_PRODUCTION' && completionPercentage === 100) {
      newStatus = 'COMPLETED';
    }

    // Update if status should change
    if (newStatus !== lot.status) {
      await this.updateProductionLot(lotId, { status: newStatus }, userId);
      this.logger.log(`Auto-updated lot ${lotId} status from ${lot.status} to ${newStatus} based on ${completionPercentage}% completion`);
    }
  }

  /**
   * Clean up production lot materials to only include selected BOM items
   */
  async cleanupProductionLotMaterials(lotId: string, userId: string): Promise<void> {
    const supabase = this.supabaseService.getClient();

    // Get the selected BOM items for this lot
    const { data: selectedBomItems } = await supabase
      .from('production_lot_bom_items')
      .select('bom_item_id')
      .eq('production_lot_id', lotId);

    if (selectedBomItems && selectedBomItems.length > 0) {
      const selectedBomItemIds = selectedBomItems.map(item => item.bom_item_id);
      
      // Delete materials that are not in the selected BOM items
      const { error } = await supabase
        .from('production_lot_materials')
        .delete()
        .eq('production_lot_id', lotId)
        .not('bom_item_id', 'in', `(${selectedBomItemIds.join(',')})`);

      if (error) {
        this.logger.error('Failed to cleanup production lot materials', error);
      } else {
        this.logger.log(`Cleaned up production lot ${lotId} materials to only include selected BOM items`);
      }
    }
  }
}