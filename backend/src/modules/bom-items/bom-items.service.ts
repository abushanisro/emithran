import { Injectable, Logger, NotFoundException, InternalServerErrorException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateBOMItemDto, UpdateBOMItemDto } from './dto/bom-items.dto';
import { BOMItemResponseDto, BOMItemListResponseDto } from './dto/bom-item-response.dto';

@Injectable()
export class BOMItemsService {
  private readonly logger = new Logger(BOMItemsService.name);

  // Cached field mapping for performance (avoids runtime object creation)
  private static readonly FIELD_MAPPING: Record<string, string> = Object.freeze({
    bomId: 'bom_id',
    partNumber: 'part_number',
    itemType: 'item_type',
    parentItemId: 'parent_item_id',
    annualVolume: 'annual_volume',
    materialGrade: 'material_grade',
    makeBuy: 'make_buy',
    unitCost: 'unit_cost',
    sortOrder: 'sort_order',
    file3dPath: 'file_3d_path',
    file2dPath: 'file_2d_path',
    materialId: 'material_id',
    weight: 'weight',
    maxLength: 'max_length',
    maxWidth: 'max_width',
    maxHeight: 'max_height',
    surfaceArea: 'surface_area',
  });

  constructor(private readonly supabaseService: SupabaseService) { }

  /**
   * Transform camelCase DTO properties to snake_case database columns
   * Optimized with cached mapping and type safety
   */
  private transformDtoToDb(dto: Record<string, any>): Record<string, any> {
    const transformed: Record<string, any> = {};

    // Optimized transformation using cached mapping
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        const dbKey = BOMItemsService.FIELD_MAPPING[key] ?? key;
        transformed[dbKey] = value;
      }
    }

    return transformed;
  }

  async findAll(
    bomId?: string,
    search?: string,
    itemType?: string,
    page = 1,
    limit = 50,
    userId?: string,
    accessToken?: string,
  ): Promise<BOMItemListResponseDto> {
    this.logger.log('Fetching BOM items', 'BOMItemsService');

    const client = this.supabaseService.getClient(accessToken);

    let query = client
      .from('bom_items')
      .select('*, bom:bom_id(name, description)')
      .order('created_at', { ascending: false });

    // Apply filters
    if (bomId) {
      query = query.eq('bom_id', bomId);
      this.logger.log(`Filtering BOM items for BOM ID: ${bomId}`, 'BOMItemsService');
    }
    if (search) {
      query = query.or(`part_number.ilike.%${search}%,description.ilike.%${search}%`);
    }
    if (itemType) {
      query = query.eq('item_type', itemType);
    }

    // Get total count with same filters
    let countQuery = client
      .from('bom_items')
      .select('*', { count: 'exact', head: true });

    if (bomId) countQuery = countQuery.eq('bom_id', bomId);
    if (search) countQuery = countQuery.or(`part_number.ilike.%${search}%,description.ilike.%${search}%`);
    if (itemType) countQuery = countQuery.eq('item_type', itemType);

    const { count } = await countQuery;

    // Apply pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    this.logger.log(`Query results: Found ${data?.length || 0} BOM items for BOM ID: ${bomId}`, 'BOMItemsService');
    
    // Additional debug: Check if the BOM exists but has no items
    if (bomId && (!data || data.length === 0)) {
      const { data: bomCheck } = await client.from('boms').select('id, name').eq('id', bomId).single();
      if (bomCheck) {
        this.logger.log(`BOM exists but has no items: ${bomCheck.name} (${bomCheck.id})`, 'BOMItemsService');
      } else {
        this.logger.log(`BOM not found with ID: ${bomId}`, 'BOMItemsService');
      }
    }
    
    if (error) {
      this.logger.error(`Error fetching BOM items: ${error.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to fetch BOM items: ${error.message}`);
    }

    // Transform database rows to DTOs
    const transformedItems = (data || []).map(row => BOMItemResponseDto.fromDatabase(row));

    return {
      items: transformedItems,
      total: count || 0,
      page,
      limit,
    } as BOMItemListResponseDto;
  }

  async findOne(
    id: string,
    userId?: string,
    accessToken?: string,
  ): Promise<BOMItemResponseDto> {
    this.logger.log(`Fetching BOM item with ID: ${id}`, 'BOMItemsService');

    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('bom_items')
      .select('*, bom:bom_id(name, description)')
      .eq('id', id)
      .single();

    if (error) {
      this.logger.error(`Error fetching BOM item: ${error.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to fetch BOM item: ${error.message}`);
    }

    if (!data) {
      throw new NotFoundException(`BOM item with ID ${id} not found`);
    }

    return BOMItemResponseDto.fromDatabase(data);
  }

  async create(
    createBOMItemDto: CreateBOMItemDto,
    userId?: string,
    accessToken?: string,
  ): Promise<BOMItemResponseDto> {
    this.logger.log(
      `Creating BOM item: ${createBOMItemDto.partNumber}`,
      'BOMItemsService',
    );

    const client = this.supabaseService.getClient(accessToken);

    // Transform camelCase DTO to snake_case database columns
    const dbData = this.transformDtoToDb(createBOMItemDto);

    const { data, error } = await client
      .from('bom_items')
      .insert({
        ...dbData,
        user_id: userId,
      })
      .select('*, bom:bom_id(name, description)')
      .single();

    if (error) {
      this.logger.error(`Error creating BOM item: ${error.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to create BOM item: ${error.message}`);
    }

    return BOMItemResponseDto.fromDatabase(data);
  }

  async update(
    id: string,
    updateBOMItemDto: UpdateBOMItemDto,
    userId?: string,
    accessToken?: string,
  ): Promise<BOMItemResponseDto> {
    this.logger.log(`Updating BOM item with ID: ${id}`, 'BOMItemsService');

    const client = this.supabaseService.getClient(accessToken);

    // Transform camelCase DTO to snake_case database columns
    const dbData = this.transformDtoToDb(updateBOMItemDto);

    const { data, error } = await client
      .from('bom_items')
      .update({
        ...dbData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*, bom:bom_id(name, description)')
      .single();

    if (error) {
      this.logger.error(`Error updating BOM item: ${error.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to update BOM item: ${error.message}`);
    }

    if (!data) {
      throw new NotFoundException(`BOM item with ID ${id} not found`);
    }

    return BOMItemResponseDto.fromDatabase(data);
  }

  async updateSortOrder(
    items: Array<{ id: string; sortOrder: number }>,
    userId?: string,
    accessToken?: string,
  ): Promise<{ updated: number }> {
    this.logger.log(`Updating sort order for ${items.length} BOM items`, 'BOMItemsService');

    const client = this.supabaseService.getClient(accessToken);
    
    // Use batch update with single query instead of N+1 pattern
    try {
      // Create case-when statements for batch update
      const caseStatements = items.map(item => 
        `WHEN id = '${item.id}' THEN ${item.sortOrder}`
      ).join(' ');
      
      const itemIds = items.map(item => `'${item.id}'`).join(',');
      
      const { error, count } = await client.rpc('batch_update_sort_order', {
        case_statements: caseStatements,
        item_ids: itemIds
      });

      if (error) {
        this.logger.error(`Error batch updating sort order: ${error.message}`, 'BOMItemsService');
        return { updated: 0 };
      }

      return { updated: count || items.length };
    } catch (error) {
      this.logger.error(`Error in batch sort order update: ${error}`, 'BOMItemsService');
      return { updated: 0 };
    }
  }

  async getFileUrl(
    id: string,
    fileType: '2d' | '3d',
    userId?: string,
    accessToken?: string,
  ): Promise<{ url: string }> {
    this.logger.log(`Getting ${fileType} file URL for BOM item: ${id}`, 'BOMItemsService');

    const bomItem = await this.findOne(id, userId, accessToken);

    if (fileType === '2d' && bomItem.file2dPath) {
      const { data } = await this.supabaseService
        .getClient(accessToken)
        .storage
        .from('bom-files')
        .createSignedUrl(bomItem.file2dPath, 3600);
      return { url: data?.signedUrl || '' };
    }

    if (fileType === '3d' && bomItem.file3dPath) {
      const { data } = await this.supabaseService
        .getClient(accessToken)
        .storage
        .from('bom-files')
        .createSignedUrl(bomItem.file3dPath, 3600);
      return { url: data?.signedUrl || '' };
    }

    throw new NotFoundException(`${fileType} file not found for BOM item ${id}`);
  }


  async remove(
    id: string,
    userId?: string,
    accessToken?: string,
  ): Promise<void> {
    this.logger.log(`Removing BOM item with ID: ${id}`, 'BOMItemsService');

    const client = this.supabaseService.getClient(accessToken);

    try {
      // Use cascade delete to automatically clean up all references
      const { data, error } = await client.rpc('cascade_delete_bom_item', {
        item_id: id
      });

      if (error && error.code === '42883') {
        // Function doesn't exist, fall back to manual cascade delete
        this.logger.warn('Cascade delete function not available, using manual cascade delete', 'BOMItemsService');
        return await this.manualCascadeDelete(id, userId, accessToken);
      }

      if (error) {
        // Handle constraint violations from the database function itself
        if (error.message && error.message.includes('production_lot_materials_bom_item_id_fkey')) {
          // Fallback to manual cascade delete if the function fails
          this.logger.warn('Database function cascade failed, trying manual cascade', 'BOMItemsService');
          return await this.manualCascadeDelete(id, userId, accessToken);
        }
        
        this.logger.error(`Error in safe delete function: ${error.message}`, 'BOMItemsService');
        throw new InternalServerErrorException(`Failed to delete BOM item: ${error.message}`);
      }

      if (!data || data.length === 0) {
        throw new NotFoundException(`BOM item with ID ${id} not found`);
      }

      const result = data[0];
      
      if (!result.success) {
        // If cascade delete failed, try manual cascade
        this.logger.warn(`Database cascade delete failed, trying manual approach`, 'BOMItemsService');
        return await this.manualCascadeDelete(id, userId, accessToken);
      }

      this.logger.log(`Successfully removed BOM item with cascade cleanup: ${result.message}`, 'BOMItemsService');
    } catch (error) {
      if (error instanceof NotFoundException || 
          error instanceof BadRequestException || 
          error instanceof ForbiddenException) {
        throw error;
      }
      
      this.logger.error(`Unexpected error removing BOM item ${id}: ${error}`, 'BOMItemsService');
      throw new InternalServerErrorException('An unexpected error occurred while removing the BOM item');
    }
  }

  /**
   * Fallback direct delete method with constraint handling
   */
  private async directDelete(
    id: string,
    userId?: string,
    accessToken?: string,
  ): Promise<void> {
    const client = this.supabaseService.getClient(accessToken);

    // First, check if the item exists
    const { data: existingItem, error: fetchError } = await client
      .from('bom_items')
      .select('id, part_number')
      .eq('id', id)
      .single();

    if (fetchError && fetchError.code === 'PGRST116') {
      throw new NotFoundException(`BOM item with ID ${id} not found`);
    }

    if (fetchError) {
      this.logger.error(`Error fetching BOM item: ${fetchError.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to fetch BOM item: ${fetchError.message}`);
    }

    // Attempt to delete
    const { error: deleteError } = await client
      .from('bom_items')
      .delete()
      .eq('id', id);

    if (deleteError) {
      if (deleteError.code === '23503') {
        // Handle specific foreign key constraints
        let errorMessage = `Cannot delete BOM item "${existingItem?.part_number || id}". `;
        
        if (deleteError.message.includes('production_lot_materials_bom_item_id_fkey')) {
          errorMessage += 'This item is used in production planning materials. Please remove it from production lots first.';
        } else if (deleteError.message.includes('process_routes')) {
          errorMessage += 'This item has associated process routes. Please remove the process routes first.';
        } else if (deleteError.message.includes('parent_item_id')) {
          errorMessage += 'This item has child items. Please remove child items first.';
        } else {
          errorMessage += 'This item is referenced by other data. Please remove related references first.';
        }
        
        throw new BadRequestException(errorMessage);
      }
      
      if (deleteError.code === '42501') {
        throw new ForbiddenException('Insufficient permissions to delete this BOM item');
      }

      this.logger.error(`Error removing BOM item: ${deleteError.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to remove BOM item: ${deleteError.message}`);
    }
  }

  /**
   * Manual cascade delete - removes all references then deletes the item
   */
  private async manualCascadeDelete(
    id: string,
    userId?: string,
    accessToken?: string,
  ): Promise<void> {
    this.logger.log(`Performing manual cascade delete for BOM item: ${id}`, 'BOMItemsService');
    
    const client = this.supabaseService.getClient(accessToken);
    
    try {
      // Get item info first
      const { data: itemData, error: fetchError } = await client
        .from('bom_items')
        .select('part_number')
        .eq('id', id)
        .single();

      if (fetchError && fetchError.code === 'PGRST116') {
        throw new NotFoundException(`BOM item with ID ${id} not found`);
      }

      const itemName = itemData?.part_number || 'Unknown';
      let cleanupCount = 0;

      // 1. Remove from production lot materials
      // First check if there are any to delete (with detailed diagnostics)
      this.logger.log(`Checking for production materials with user context`, 'BOMItemsService');
      
      const { data: prodMaterials, error: prodCheckError } = await client
        .from('production_lot_materials')
        .select('id, production_lot_id')
        .eq('bom_item_id', id);
      
      // Also try with admin client to see if RLS is the issue
      const adminClient = this.supabaseService.getAdminClient ? this.supabaseService.getAdminClient() : null;
      let adminProdMaterials = null;
      
      if (adminClient) {
        const { data: adminData } = await adminClient
          .from('production_lot_materials')
          .select('id, production_lot_id')
          .eq('bom_item_id', id);
        adminProdMaterials = adminData;
        this.logger.log(`Admin client sees ${adminData?.length || 0} production materials`, 'BOMItemsService');
      }
      
      this.logger.log(`User client sees ${prodMaterials?.length || 0} production materials`, 'BOMItemsService');

      if (prodCheckError) {
        this.logger.warn(`Could not check production materials: ${prodCheckError.message}`, 'BOMItemsService');
      }
      
      // Try to delete with admin client if available and user client found nothing
      if (adminClient && adminProdMaterials && adminProdMaterials.length > 0 && (!prodMaterials || prodMaterials.length === 0)) {
        this.logger.log(`Using admin client to delete ${adminProdMaterials.length} production materials (RLS bypass)`, 'BOMItemsService');
        
        const { error: adminProdError, count: adminProdCount } = await adminClient
          .from('production_lot_materials')
          .delete()
          .eq('bom_item_id', id);
        
        if (adminProdError) {
          this.logger.error(`Admin delete failed: ${adminProdError.message}`, 'BOMItemsService');
        } else {
          const actualCount = adminProdCount || adminProdMaterials.length;
          cleanupCount += actualCount;
          this.logger.log(`Admin client successfully removed ${actualCount} production material references`, 'BOMItemsService');
        }
      } else if (prodMaterials && prodMaterials.length > 0) {
        this.logger.log(`Found ${prodMaterials.length} production material references to clean up`, 'BOMItemsService');
        
        const { error: prodError, count: prodCount } = await client
          .from('production_lot_materials')
          .delete()
          .eq('bom_item_id', id);

        if (prodError) {
          this.logger.error(`Failed to clean up production materials: ${prodError.message}`, 'BOMItemsService');
          throw new InternalServerErrorException(`Failed to clean up production planning references: ${prodError.message}`);
        } else {
          const actualCount = prodCount || prodMaterials.length;
          cleanupCount += actualCount;
          this.logger.log(`Successfully removed ${actualCount} production material references`, 'BOMItemsService');
        }
      } else {
        this.logger.log('No production material references found with current user permissions', 'BOMItemsService');
        
        // If admin client shows materials but user client doesn't, it's an RLS issue
        if (adminProdMaterials && adminProdMaterials.length > 0) {
          this.logger.warn(`RLS Policy Issue: Admin sees ${adminProdMaterials.length} materials but user sees 0`, 'BOMItemsService');
        }
      }

      // 2. Remove from process route steps (if any process routes reference this item)
      // First get the process route IDs
      const { data: processRoutes } = await client
        .from('process_routes')
        .select('id')
        .eq('bom_item_id', id);

      let stepsCount = 0;
      let stepsError = null;
      
      if (processRoutes && processRoutes.length > 0) {
        const routeIds = processRoutes.map(route => route.id);
        const stepsResult = await client
          .from('process_route_steps')
          .delete()
          .in('process_route_id', routeIds);
        
        stepsError = stepsResult.error;
        stepsCount = stepsResult.count || 0;
      }

      if (stepsError) {
        this.logger.warn(`Could not clean up process steps: ${stepsError.message}`, 'BOMItemsService');
      } else if (stepsCount) {
        cleanupCount += stepsCount;
        this.logger.log(`Removed ${stepsCount} process route steps`, 'BOMItemsService');
      }

      // 3. Remove process routes
      const { error: routesError, count: routesCount } = await client
        .from('process_routes')
        .delete()
        .eq('bom_item_id', id);

      if (routesError) {
        this.logger.warn(`Could not clean up process routes: ${routesError.message}`, 'BOMItemsService');
      } else if (routesCount) {
        cleanupCount += routesCount;
        this.logger.log(`Removed ${routesCount} process routes`, 'BOMItemsService');
      }

      // 4. Update child items to remove parent reference
      const { error: childError, count: childCount } = await client
        .from('bom_items')
        .update({ parent_item_id: null })
        .eq('parent_item_id', id);

      if (childError) {
        this.logger.warn(`Could not orphan child items: ${childError.message}`, 'BOMItemsService');
      } else if (childCount) {
        cleanupCount += childCount;
        this.logger.log(`Orphaned ${childCount} child items`, 'BOMItemsService');
      }

      // 5. Finally delete the BOM item
      this.logger.log(`Attempting to delete BOM item after cleaning up ${cleanupCount} references`, 'BOMItemsService');
      
      // Double-check that production materials are really gone
      const { data: remainingProd, error: checkError } = await client
        .from('production_lot_materials')
        .select('id')
        .eq('bom_item_id', id);
      
      if (!checkError && remainingProd && remainingProd.length > 0) {
        this.logger.error(`Still ${remainingProd.length} production material references exist!`, 'BOMItemsService');
        // Try one more time to delete them
        await client.from('production_lot_materials').delete().eq('bom_item_id', id);
      }
      
      const { error: deleteError } = await client
        .from('bom_items')
        .delete()
        .eq('id', id);

      if (deleteError) {
        this.logger.error(`Failed to delete BOM item after cleanup: ${deleteError.message}`, 'BOMItemsService');
        
        // If it's still the same constraint error, the cleanup didn't work
        if (deleteError.message.includes('production_lot_materials_bom_item_id_fkey')) {
          throw new InternalServerErrorException(
            `Unable to remove all production planning references for BOM item "${itemName}". ` +
            `This may be due to database permissions or concurrent modifications. ` +
            `Please try again or contact an administrator.`
          );
        }
        
        throw new InternalServerErrorException(
          `Cleaned up ${cleanupCount} references but failed to delete BOM item: ${deleteError.message}`
        );
      }

      this.logger.log(
        `Successfully deleted BOM item "${itemName}" with cascade cleanup (${cleanupCount} references removed)`, 
        'BOMItemsService'
      );
      
    } catch (error) {
      if (error instanceof NotFoundException || 
          error instanceof BadRequestException || 
          error instanceof ForbiddenException ||
          error instanceof InternalServerErrorException) {
        throw error;
      }
      
      this.logger.error(`Unexpected error in manual cascade delete: ${error}`, 'BOMItemsService');
      throw new InternalServerErrorException('Failed to delete BOM item with cascade cleanup');
    }
  }

  async getBOMIdForItem(
    itemId: string,
    userId?: string,
    accessToken?: string,
  ): Promise<string> {
    this.logger.log(`Getting BOM ID for item: ${itemId}`, 'BOMItemsService');

    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('bom_items')
      .select('bom_id')
      .eq('id', itemId)
      .single();

    if (error) {
      this.logger.error(`Error fetching BOM ID for item: ${error.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to fetch BOM ID: ${error.message}`);
    }

    if (!data) {
      throw new NotFoundException(`BOM item with ID ${itemId} not found`);
    }

    return data.bom_id;
  }

  async checkDeleteDependencies(
    id: string,
    userId?: string,
    accessToken?: string,
  ): Promise<{ canDelete: boolean; blockers: string[]; itemName: string }> {
    this.logger.log(`Checking delete dependencies for BOM item: ${id}`, 'BOMItemsService');

    const client = this.supabaseService.getClient(accessToken);
    const blockers: string[] = [];
    
    // Get item info
    const { data: itemData, error: fetchError } = await client
      .from('bom_items')
      .select('part_number')
      .eq('id', id)
      .single();

    if (fetchError) {
      throw new NotFoundException(`BOM item with ID ${id} not found`);
    }

    const itemName = itemData?.part_number || 'Unknown';

    // Check production lot materials
    const { count: prodCount } = await client
      .from('production_lot_materials')
      .select('*', { count: 'exact', head: true })
      .eq('bom_item_id', id);

    if (prodCount && prodCount > 0) {
      blockers.push(`${prodCount} production lot material(s)`);
    }

    // Check process routes
    const { count: routeCount } = await client
      .from('process_routes')
      .select('*', { count: 'exact', head: true })
      .eq('bom_item_id', id);

    if (routeCount && routeCount > 0) {
      blockers.push(`${routeCount} process route(s)`);
    }

    // Check child items
    const { count: childCount } = await client
      .from('bom_items')
      .select('*', { count: 'exact', head: true })
      .eq('parent_item_id', id);

    if (childCount && childCount > 0) {
      blockers.push(`${childCount} child item(s)`);
    }

    return {
      canDelete: blockers.length === 0,
      blockers,
      itemName
    };
  }

  async getProjectIdForBOM(
    bomId: string,
    userId?: string,
    accessToken?: string,
  ): Promise<string> {
    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('boms')
      .select('project_id')
      .eq('id', bomId)
      .single();

    if (error) {
      this.logger.error(`Error fetching project ID for BOM: ${error.message}`, 'BOMItemsService');
      throw new InternalServerErrorException(`Failed to fetch project ID: ${error.message}`);
    }

    if (!data) {
      throw new NotFoundException(`BOM with ID ${bomId} not found`);
    }

    return data.project_id;
  }
}