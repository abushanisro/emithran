import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateProjectDto, UpdateProjectDto, QueryProjectsDto } from './dto/projects.dto';
import { ProjectResponseDto, ProjectListResponseDto } from './dto/project-response.dto';
import { AddTeamMemberDto, UpdateTeamMemberDto, TeamMemberResponseDto, TeamMembersListResponseDto } from './dto/project-team-member.dto';
import { validate as isValidUUID } from 'uuid';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {}

  async findAll(query: QueryProjectsDto, userId: string, accessToken: string): Promise<ProjectListResponseDto> {
    this.logger.log('Fetching all projects', 'ProjectsService');

    const page = query.page || 1;
    const limit = Math.min(query.limit || 10, 100); // Cap at 100 for performance
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('projects')
      .select('id, name, description, country, state, city, status, target_price, user_id, created_at, updated_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    // Apply search filter
    if (query.search) {
      queryBuilder = queryBuilder.ilike('name', `%${query.search}%`);
    }

    // Apply status filter
    if (query.status) {
      queryBuilder = queryBuilder.eq('status', query.status);
    }

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching projects: ${error.message}`, 'ProjectsService');
      throw new InternalServerErrorException('Unable to retrieve projects. Please try again later.');
    }

    // Transform using static DTO method (type-safe)
    const projects = (data || []).map(row => ProjectResponseDto.fromDatabase(row));

    return {
      projects,
      total: count || 0,
      page,
      limit,
    };
  }

  async findOne(id: string, userId: string, accessToken: string): Promise<ProjectResponseDto> {
    this.logger.log(`Fetching project: ${id}`, 'ProjectsService');

    // Validate UUID format
    if (!this.isValidUUID(id)) {
      this.logger.warn(`Invalid UUID format provided: ${id}`, 'ProjectsService');
      throw new BadRequestException('Please provide a valid project ID.');
    }

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('projects')
      .select('id, name, description, country, state, city, status, target_price, user_id, created_at, updated_at')
      .eq('id', id)
      .single();

    if (error || !data) {
      // Distinguish between different error types
      if (error?.code === 'PGRST116') {
        // PostgreSQL "no rows returned" error
        this.logger.warn(`Project not found: ${id}`, 'ProjectsService');
      } else if (error) {
        this.logger.error(`Database error while fetching project ${id}: ${error.message}`, 'ProjectsService');
      } else {
        this.logger.warn(`Project not found (no data): ${id}`, 'ProjectsService');
      }
      throw new NotFoundException('The requested project could not be found or you do not have access to it.');
    }

    return ProjectResponseDto.fromDatabase(data);
  }

  /**
   * Validate UUID format to prevent invalid queries
   */
  private isValidUUID(id: string): boolean {
    try {
      return isValidUUID(id);
    } catch {
      return false;
    }
  }

  async create(createProjectDto: CreateProjectDto, userId: string, accessToken: string): Promise<ProjectResponseDto> {
    this.logger.log(`Creating project for user: ${userId}`, 'ProjectsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('projects')
      .insert({
        name: createProjectDto.name,
        description: createProjectDto.description,
        country: createProjectDto.country,
        state: createProjectDto.state,
        city: createProjectDto.city,
        status: createProjectDto.status || 'draft',
        target_price: createProjectDto.targetPrice,
        user_id: userId,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating project: ${error.message}`, 'ProjectsService');
      // Check for specific database errors
      if (error.message.includes('duplicate key') && error.message.includes('projects_name')) {
        throw new BadRequestException('A project with this name already exists. Please choose a different name.');
      }
      throw new InternalServerErrorException('Unable to create the project. Please try again later.');
    }

    if (!data) {
      this.logger.error('Project creation returned no data', 'ProjectsService');
      throw new InternalServerErrorException('Unable to create the project. Please try again later.');
    }

    return ProjectResponseDto.fromDatabase(data);
  }

  async update(id: string, updateProjectDto: UpdateProjectDto, userId: string, accessToken: string): Promise<ProjectResponseDto> {
    this.logger.log(`Updating project: ${id}`, 'ProjectsService');

    // Validate UUID format early
    if (!this.isValidUUID(id)) {
      this.logger.warn(`Invalid UUID format for update: ${id}`, 'ProjectsService');
      throw new BadRequestException('Please provide a valid project ID.');
    }

    // Verify project exists and belongs to user (RLS enforces ownership)
    await this.findOne(id, userId, accessToken);

    const updateData: any = {};
    if (updateProjectDto.name !== undefined) updateData.name = updateProjectDto.name;
    if (updateProjectDto.description !== undefined) updateData.description = updateProjectDto.description;
    if (updateProjectDto.country !== undefined) updateData.country = updateProjectDto.country;
    if (updateProjectDto.state !== undefined) updateData.state = updateProjectDto.state;
    if (updateProjectDto.city !== undefined) updateData.city = updateProjectDto.city;
    if (updateProjectDto.status !== undefined) updateData.status = updateProjectDto.status;
    if (updateProjectDto.targetPrice !== undefined) updateData.target_price = updateProjectDto.targetPrice;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('projects')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating project: ${error.message}`, 'ProjectsService');
      // Check for specific database errors
      if (error.message.includes('duplicate key') && error.message.includes('projects_name')) {
        throw new BadRequestException('A project with this name already exists. Please choose a different name.');
      }
      throw new InternalServerErrorException('Unable to update the project. Please try again later.');
    }

    return ProjectResponseDto.fromDatabase(data);
  }

  async remove(id: string, userId: string, accessToken: string) {
    this.logger.log(`Deleting project: ${id}`, 'ProjectsService');

    // Validate UUID format early
    if (!this.isValidUUID(id)) {
      this.logger.warn(`Invalid UUID format for delete: ${id}`, 'ProjectsService');
      throw new BadRequestException('Please provide a valid project ID.');
    }

    // Verify project exists and belongs to user (RLS enforces ownership)
    await this.findOne(id, userId, accessToken);

    try {
      // Try database function first (more reliable)
      this.logger.log(`Using database function for safe project deletion: ${id}`, 'ProjectsService');
      
      const adminClient = this.supabaseService.getAdminClient();
      const { data: dbResult, error: dbError } = await adminClient
        .rpc('safe_delete_project', { project_id_input: id });

      if (dbError) {
        this.logger.warn(`Database function deletion failed: ${dbError.message}, falling back to manual deletion`, 'ProjectsService');
        // Fallback to intelligent cascade delete
        const result = await this.performProjectCascadeDelete(id, userId);
        
        this.logger.log(`Successfully deleted project with manual cascade cleanup: ${id}`, 'ProjectsService');
        return { 
          message: 'Project deleted successfully (manual cascade)',
          details: result 
        };
      }

      // Parse the text result from database function
      const resultText = dbResult as string;
      if (resultText?.startsWith('ERROR|')) {
        const errorParts = resultText.split('|');
        this.logger.warn(`Database function failed: ${errorParts[1]}, falling back to manual deletion`, 'ProjectsService');
        
        // Fallback to intelligent cascade delete
        const result = await this.performProjectCascadeDelete(id, userId);
        
        this.logger.log(`Successfully deleted project with manual cascade fallback: ${id}`, 'ProjectsService');
        return { 
          message: 'Project deleted successfully (manual cascade fallback)',
          details: result 
        };
      }

      // Parse success result: "SUCCESS|bom_item_costs:0|production_lot_materials:0|..."
      const parsedResult = this.parseDbFunctionResult(resultText);
      
      this.logger.log(`Successfully deleted project with database function: ${JSON.stringify(parsedResult)}`, 'ProjectsService');
      return { 
        message: 'Project deleted successfully',
        details: parsedResult
      };
    } catch (error) {
      this.logger.error(`Unexpected error during project deletion: ${error.message}`, 'ProjectsService');
      throw new InternalServerErrorException('Unable to delete the project. Please try again later.');
    }
  }

  /**
   * Intelligent cascade delete for projects - handles all dependent records in correct order
   * Similar to the BOM item cascade delete pattern
   */
  private async performProjectCascadeDelete(projectId: string, userId: string): Promise<any> {
    const adminClient = this.supabaseService.getAdminClient();
    const results: { deleted_tables: Record<string, number>, total_records: number } = { 
      deleted_tables: {}, 
      total_records: 0 
    };

    this.logger.log(`Starting intelligent cascade delete for project: ${projectId}`, 'ProjectsService');

    try {
      // Step 0: Clean up any orphaned records first
      await this.cleanupOrphanedRecords(adminClient, projectId);

      // Step 1: Delete RFQ tracking records
      const { error: rfqError, count: rfqCount } = await adminClient
        .from('rfq_tracking')
        .delete({ count: 'exact' })
        .eq('project_id', projectId);

      if (rfqError && rfqError.code !== 'PGRST116') { // Ignore "no rows" error
        throw new Error(`Failed to delete RFQ tracking: ${rfqError.message}`);
      }
      results.deleted_tables['rfq_tracking'] = rfqCount || 0;
      results.total_records += results.deleted_tables['rfq_tracking'];

      // Step 2: Get all BOMs for this project
      const { data: boms, error: bomFetchError } = await adminClient
        .from('boms')
        .select('id')
        .eq('project_id', projectId);

      if (bomFetchError) {
        throw new Error(`Failed to fetch BOMs: ${bomFetchError.message}`);
      }

      // Step 3: Get ALL BOM items for this project at once
      let allBomItemIds: string[] = [];
      if (boms && boms.length > 0) {
        const bomIds = boms.map(bom => bom.id);
        
        const { data: allBomItems, error: allItemsError } = await adminClient
          .from('bom_items')
          .select('id')
          .in('bom_id', bomIds);

        if (allItemsError) {
          throw new Error(`Failed to fetch all BOM items: ${allItemsError.message}`);
        }

        allBomItemIds = (allBomItems || []).map(item => item.id);
      }

      // Step 4: Delete ALL dependencies for this project in one go
      let totalCostRecords = 0;
      let totalProductionMaterials = 0;
      let totalBomItems = 0;

      // Step 4: Manual comprehensive cleanup - delete ALL dependent records
      this.logger.log(`Step 4: Manual comprehensive cleanup for project ${projectId}`, 'ProjectsService');
      
      // Delete ALL bom_item_costs for all BOM items in this project
      if (allBomItemIds.length > 0) {
        this.logger.log(`Deleting all BOM item costs for ${allBomItemIds.length} items`, 'ProjectsService');
        
        const { error: costError, count: costCount } = await adminClient
          .from('bom_item_costs')
          .delete({ count: 'exact' })
          .in('bom_item_id', allBomItemIds);

        if (costError && costError.code !== 'PGRST116') {
          this.logger.error(`BOM item costs deletion failed: ${costError.message}`, 'ProjectsService');
          // Don't throw - continue with deletion
        }
        totalCostRecords = costCount || 0;
        this.logger.log(`Deleted ${totalCostRecords} BOM item cost records`, 'ProjectsService');

        // Delete ALL production materials for this project
        this.logger.log(`Deleting all production materials for ${allBomItemIds.length} items`, 'ProjectsService');
        
        const { error: prodError, count: prodCount } = await adminClient
          .from('production_lot_materials')
          .delete({ count: 'exact' })
          .in('bom_item_id', allBomItemIds);

        if (prodError && prodError.code !== 'PGRST116') {
          this.logger.error(`Production materials deletion failed: ${prodError.message}`, 'ProjectsService');
          // Don't throw - continue with deletion
        }
        totalProductionMaterials = prodCount || 0;
        this.logger.log(`Deleted ${totalProductionMaterials} production material records`, 'ProjectsService');

        // Clean up any orphaned records that may exist
        this.logger.log(`Cleaning up any orphaned records...`, 'ProjectsService');
        
        await adminClient.from('bom_item_costs').delete().is('bom_item_id', null);
        await adminClient.from('production_lot_materials').delete().is('bom_item_id', null);
      }

      // Delete BOM items using database function that handles constraint violations
      if (allBomItemIds.length > 0) {
        this.logger.log(`Step 5: Deleting ${allBomItemIds.length} BOM items using safe database function`, 'ProjectsService');
        
        try {
          // Use database function to safely delete BOM items
          const { data: deletedCount, error: funcError } = await adminClient
            .rpc('safe_delete_bom_items', { bom_item_ids_input: allBomItemIds });

          if (funcError) {
            this.logger.warn(`Database function failed: ${funcError.message}, falling back to retry logic`, 'ProjectsService');
            
            // Fallback to retry logic
            let retryCount = 0;
            const maxRetries = 3;
            let success = false;
            
            while (!success && retryCount < maxRetries) {
              retryCount++;
              this.logger.log(`BOM deletion fallback attempt ${retryCount}/${maxRetries}`, 'ProjectsService');
              
              // Clean up any NULL records
              await adminClient.from('bom_item_costs').delete().is('bom_item_id', null);
              await adminClient.from('production_lot_materials').delete().is('bom_item_id', null);
              
              try {
                const { error: itemsError, count: itemsCount } = await adminClient
                  .from('bom_items')
                  .delete({ count: 'exact' })
                  .in('id', allBomItemIds);

                if (itemsError && itemsError.code !== 'PGRST116') {
                  if (retryCount >= maxRetries) {
                    throw new Error(`Failed to delete BOM items after ${maxRetries} fallback attempts: ${itemsError.message}`);
                  }
                  await new Promise(resolve => setTimeout(resolve, 200 * retryCount));
                } else {
                  totalBomItems = itemsCount || 0;
                  success = true;
                  this.logger.log(`Successfully deleted ${totalBomItems} BOM items via fallback attempt ${retryCount}`, 'ProjectsService');
                }
              } catch (error) {
                if (retryCount >= maxRetries) {
                  throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 200 * retryCount));
              }
            }
          } else {
            totalBomItems = deletedCount || 0;
            this.logger.log(`Successfully deleted ${totalBomItems} BOM items via database function`, 'ProjectsService');
          }
        } catch (error) {
          this.logger.error(`All BOM deletion methods failed: ${error.message}`, 'ProjectsService');
          throw error;
        }
      }

      results.deleted_tables['bom_item_costs'] = totalCostRecords;
      results.deleted_tables['production_lot_materials'] = totalProductionMaterials;
      results.deleted_tables['bom_items'] = totalBomItems;
      results.total_records += totalCostRecords + totalProductionMaterials + totalBomItems;

      // Step 4: Delete BOMs using safe database function
      this.logger.log(`Step 6: Deleting BOMs using safe database function`, 'ProjectsService');
      
      try {
        // Use database function to safely delete BOMs
        const { data: deletedBomCount, error: bomFuncError } = await adminClient
          .rpc('safe_delete_boms', { bom_ids_input: boms?.map(bom => bom.id) || [] });

        if (bomFuncError) {
          this.logger.warn(`BOM database function failed: ${bomFuncError.message}, falling back to direct deletion`, 'ProjectsService');
          
          // Fallback to direct deletion with cleanup
          await adminClient.from('bom_item_costs').delete().is('bom_item_id', null);
          await adminClient.from('production_lot_materials').delete().is('bom_item_id', null);
          
          const { error: bomDeleteError, count: bomCount } = await adminClient
            .from('boms')
            .delete({ count: 'exact' })
            .eq('project_id', projectId);

          if (bomDeleteError) {
            throw new Error(`Failed to delete BOMs: ${bomDeleteError.message}`);
          }
          results.deleted_tables['boms'] = bomCount || 0;
        } else {
          results.deleted_tables['boms'] = deletedBomCount || 0;
          this.logger.log(`Successfully deleted ${deletedBomCount || 0} BOMs via database function`, 'ProjectsService');
        }
      } catch (error) {
        this.logger.error(`BOM deletion failed: ${error.message}`, 'ProjectsService');
        throw error;
      }
      
      results.total_records += results.deleted_tables['boms'];

      // Step 5: Delete project team members
      const { error: teamError, count: teamCount } = await adminClient
        .from('project_team_members')
        .delete({ count: 'exact' })
        .eq('project_id', projectId);

      if (teamError && teamError.code !== 'PGRST116') {
        throw new Error(`Failed to delete team members: ${teamError.message}`);
      }
      results.deleted_tables['project_team_members'] = teamCount || 0;
      results.total_records += results.deleted_tables['project_team_members'];

      // Step 7: Finally delete the project with constraint handling
      this.logger.log(`Step 7: Deleting project with constraint handling`, 'ProjectsService');
      
      let projectDeleted = 0;
      let attemptCount = 0;
      const maxAttempts = 3;
      
      while (projectDeleted === 0 && attemptCount < maxAttempts) {
        attemptCount++;
        this.logger.log(`Project deletion attempt ${attemptCount}/${maxAttempts}`, 'ProjectsService');
        
        try {
          // Clean up any NULL records before project deletion
          await adminClient.from('bom_item_costs').delete().is('bom_item_id', null);
          await adminClient.from('production_lot_materials').delete().is('bom_item_id', null);
          
          const { error: projectError } = await adminClient
            .from('projects')
            .delete()
            .eq('id', projectId);

          if (projectError && projectError.code !== 'PGRST116') {
            throw new Error(`Failed to delete project: ${projectError.message}`);
          }
          
          projectDeleted = 1;
          this.logger.log(`Successfully deleted project on attempt ${attemptCount}`, 'ProjectsService');
          
          // Final cleanup after project deletion
          await adminClient.from('bom_item_costs').delete().is('bom_item_id', null);
          await adminClient.from('production_lot_materials').delete().is('bom_item_id', null);
          
        } catch (error) {
          this.logger.warn(`Project deletion attempt ${attemptCount} failed: ${error.message}`, 'ProjectsService');
          
          if (attemptCount >= maxAttempts) {
            throw new Error(`Failed to delete project after ${maxAttempts} attempts: ${error.message}`);
          }
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 200 * attemptCount));
        }
      }
      
      results.deleted_tables['projects'] = projectDeleted;
      results.total_records += projectDeleted;

      this.logger.log(`Project cascade delete completed: ${JSON.stringify(results)}`, 'ProjectsService');
      return results;

    } catch (error) {
      this.logger.error(`Cascade delete failed for project ${projectId}: ${error.message}`, 'ProjectsService');
      throw error;
    }
  }

  /**
   * Clean up orphaned records that might cause constraint violations
   */
  private async cleanupOrphanedRecords(adminClient: any, projectId: string): Promise<void> {
    this.logger.log(`Cleaning up orphaned records for project: ${projectId}`, 'ProjectsService');

    try {
      // Clean up bom_item_costs with NULL bom_item_id
      const { error: costCleanupError, count: costCleanupCount } = await adminClient
        .from('bom_item_costs')
        .delete({ count: 'exact' })
        .is('bom_item_id', null);

      if (costCleanupError && costCleanupError.code !== 'PGRST116') {
        this.logger.warn(`Could not clean up orphaned cost records: ${costCleanupError.message}`, 'ProjectsService');
      } else {
        this.logger.log(`Cleaned up ${costCleanupCount || 0} orphaned cost records`, 'ProjectsService');
      }

      // Clean up production_lot_materials with NULL bom_item_id  
      const { error: prodCleanupError, count: prodCleanupCount } = await adminClient
        .from('production_lot_materials')
        .delete({ count: 'exact' })
        .is('bom_item_id', null);

      if (prodCleanupError && prodCleanupError.code !== 'PGRST116') {
        this.logger.warn(`Could not clean up orphaned production materials: ${prodCleanupError.message}`, 'ProjectsService');
      } else {
        this.logger.log(`Cleaned up ${prodCleanupCount || 0} orphaned production materials`, 'ProjectsService');
      }

      // Also clean up any bom_item_costs that might reference non-existent BOM items
      // Skip this for now due to query complexity - will be handled by the main deletion process
      this.logger.log(`Skipping orphaned cost reference cleanup - will be handled in main deletion`, 'ProjectsService');

      this.logger.log(`Orphaned record cleanup completed for project: ${projectId}`, 'ProjectsService');
    } catch (error) {
      this.logger.warn(`Orphaned record cleanup failed, continuing anyway: ${error.message}`, 'ProjectsService');
    }
  }

  /**
   * Parse database function result text into structured object
   */
  private parseDbFunctionResult(resultText: string): any {
    if (!resultText || !resultText.startsWith('SUCCESS|')) {
      return { error: 'Invalid result format', raw: resultText };
    }

    const parts = resultText.split('|');
    const result = {
      success: true,
      deleted_tables: {} as Record<string, number>,
      total_records: 0
    };

    // Parse each part: "table_name:count"
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.includes(':')) {
        const [key, value] = part.split(':');
        const count = parseInt(value, 10) || 0;
        
        if (key === 'total') {
          result.total_records = count;
        } else {
          result.deleted_tables[key] = count;
        }
      }
    }

    return result;
  }

  async getCostAnalysis(id: string, userId: string, accessToken: string) {
    this.logger.log(`Getting cost analysis for project: ${id}`, 'ProjectsService');

    // Validate UUID format early
    if (!this.isValidUUID(id)) {
      this.logger.warn(`Invalid UUID format for cost analysis: ${id}`, 'ProjectsService');
      throw new BadRequestException('Please provide a valid project ID.');
    }

    // Verify user owns this project
    const project = await this.findOne(id, userId, accessToken);

    // Single optimized query using database function
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .rpc('get_project_cost_analysis', { project_id_input: id });

    if (error) {
      this.logger.error(`Error fetching cost analysis: ${error.message}`, 'ProjectsService');
      throw new InternalServerErrorException('Unable to retrieve cost analysis. Please try again later.');
    }

    // RPC returns array with single row
    const analysis = Array.isArray(data) ? data[0] : data;

    return {
      projectId: project.id,
      projectName: project.name,
      totalBOMs: Number(analysis?.total_boms || 0),
      totalItems: Number(analysis?.total_items || 0),
      estimatedCost: Number(analysis?.estimated_cost || 0),
      targetPrice: project.targetPrice || 0,
      costDifference: (project.targetPrice || 0) - Number(analysis?.estimated_cost || 0),
    };
  }

  // ============================================================================
  // TEAM MEMBER MANAGEMENT
  // ============================================================================

  async getTeamMembers(projectId: string, userId: string, accessToken: string): Promise<TeamMembersListResponseDto> {
    this.logger.log(`Getting team members for project: ${projectId}`, 'ProjectsService');

    if (!this.isValidUUID(projectId)) {
      throw new BadRequestException('Please provide a valid project ID.');
    }

    // Verify user has access to this project
    await this.findOne(projectId, userId, accessToken);

    // Query team members
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('project_team_members')
      .select('id, user_id, role, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error(`Error fetching team members: ${error.message}`, 'ProjectsService');
      throw new InternalServerErrorException('Unable to retrieve team members. Please try again later.');
    }

    // Fetch user details using admin client
    const adminClient = this.supabaseService.getAdminClient();
    const members = await Promise.all(
      (data || []).map(async (row) => {
        const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(row.user_id);

        if (userError) {
          this.logger.warn(`Failed to fetch user ${row.user_id}: ${userError.message}`);
        }

        return TeamMemberResponseDto.fromDatabase({
          id: row.id,
          user_id: row.user_id,
          email: userData?.user?.email || 'unknown@example.com',
          name: userData?.user?.user_metadata?.name || userData?.user?.user_metadata?.full_name,
          role: row.role,
          created_at: row.created_at,
        });
      })
    );

    return {
      members,
      total: members.length,
    };
  }

  async addTeamMember(projectId: string, dto: AddTeamMemberDto, userId: string, accessToken: string): Promise<TeamMemberResponseDto> {
    this.logger.log(`Adding team member to project: ${projectId}`, 'ProjectsService');

    if (!this.isValidUUID(projectId)) {
      throw new BadRequestException('Please provide a valid project ID.');
    }

    // Verify user owns this project
    await this.findOne(projectId, userId, accessToken);

    // Find user by email using admin client
    const adminClient = this.supabaseService.getAdminClient();
    const { data: usersData, error: userError } = await adminClient.auth.admin.listUsers();

    if (userError) {
      this.logger.error(`Error listing users: ${userError.message}`, 'ProjectsService');
      throw new InternalServerErrorException('Unable to search for users. Please try again later.');
    }

    const targetUser = usersData.users.find(u => u.email === dto.email);
    if (!targetUser) {
      throw new NotFoundException(`No user found with email address ${dto.email}. Please check the email and try again.`);
    }

    // Add team member
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('project_team_members')
      .insert({
        project_id: projectId,
        user_id: targetUser.id,
        role: dto.role || 'member',
        added_by: userId,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        throw new BadRequestException('This user is already a member of this project.');
      }
      this.logger.error(`Error adding team member: ${error.message}`, 'ProjectsService');
      throw new InternalServerErrorException('Unable to add team member. Please try again later.');
    }

    return TeamMemberResponseDto.fromDatabase({
      id: data.id,
      user_id: targetUser.id,
      email: targetUser.email,
      name: targetUser.user_metadata?.name || targetUser.user_metadata?.full_name,
      role: data.role,
      created_at: data.created_at,
    });
  }

  async updateTeamMember(projectId: string, memberId: string, dto: UpdateTeamMemberDto, userId: string, accessToken: string): Promise<TeamMemberResponseDto> {
    this.logger.log(`Updating team member ${memberId} in project: ${projectId}`, 'ProjectsService');

    if (!this.isValidUUID(projectId) || !this.isValidUUID(memberId)) {
      throw new BadRequestException('Please provide valid project and member IDs.');
    }

    // Verify user owns this project
    await this.findOne(projectId, userId, accessToken);

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('project_team_members')
      .update({ role: dto.role })
      .eq('id', memberId)
      .eq('project_id', projectId)
      .select('id, user_id, role, created_at')
      .single();

    if (error) {
      this.logger.error(`Error updating team member: ${error.message}`, 'ProjectsService');
      throw new InternalServerErrorException('Unable to update team member. Please try again later.');
    }

    // Get user details using admin client
    const adminClient = this.supabaseService.getAdminClient();
    const { data: userData, error: userError } = await adminClient.auth.admin.getUserById(data.user_id);

    if (userError) {
      this.logger.warn(`Failed to fetch user ${data.user_id}: ${userError.message}`);
    }

    return TeamMemberResponseDto.fromDatabase({
      id: data.id,
      user_id: data.user_id,
      email: userData?.user?.email || 'unknown@example.com',
      name: userData?.user?.user_metadata?.name || userData?.user?.user_metadata?.full_name,
      role: data.role,
      created_at: data.created_at,
    });
  }

  async removeTeamMember(projectId: string, memberId: string, userId: string, accessToken: string): Promise<{ message: string }> {
    this.logger.log(`Removing team member ${memberId} from project: ${projectId}`, 'ProjectsService');

    if (!this.isValidUUID(projectId) || !this.isValidUUID(memberId)) {
      throw new BadRequestException('Please provide valid project and member IDs.');
    }

    // Verify user owns this project
    await this.findOne(projectId, userId, accessToken);

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('project_team_members')
      .delete()
      .eq('id', memberId)
      .eq('project_id', projectId);

    if (error) {
      this.logger.error(`Error removing team member: ${error.message}`, 'ProjectsService');
      throw new InternalServerErrorException('Unable to remove team member. Please try again later.');
    }

    return { message: 'Team member removed successfully' };
  }
}
