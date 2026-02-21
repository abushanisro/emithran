import { Injectable, Logger, NotFoundException, InternalServerErrorException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '@/common/supabase/supabase.service';
import { CreateProjectDto, UpdateProjectDto, QueryProjectsDto } from './dto/projects.dto';
import { ProjectResponseDto, ProjectListResponseDto } from './dto/project-response.dto';
import { AddTeamMemberDto, UpdateTeamMemberDto, TeamMemberResponseDto, TeamMembersListResponseDto, TeamMemberRole } from './dto/project-team-member.dto';
import { ProjectsRepository, ProjectEntity } from './projects.repository';
import { Logger as CustomLogger } from '@/common/logger/logger.service';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly projectsRepository: ProjectsRepository,
    private readonly customLogger: CustomLogger,
  ) {}

  async findAll(query: QueryProjectsDto, userId: string, accessToken?: string): Promise<ProjectListResponseDto> {
    if (!userId) {
      throw new BadRequestException('User authentication is required to access projects.');
    }

    try {
      this.logger.log(`Fetching projects for user: ${userId}`);
      
      const client = this.supabase.getClient(accessToken);
      const options = {
        page: query.page || 1,
        limit: query.limit || 10,
        orderBy: 'updated_at',
        ascending: false,
      };

      let result;

      if (query.search && query.status) {
        // Combined search and status filter
        const searchResult = await this.projectsRepository.findBySearch(client, query.search, options);
        result = {
          ...searchResult,
          data: searchResult.data.filter(project => project.status === query.status)
        };
        result.total = result.data.length;
      } else if (query.search) {
        // Search filter only
        result = await this.projectsRepository.findBySearch(client, query.search, options);
      } else if (query.status) {
        // Status filter only
        result = await this.projectsRepository.findByStatus(client, query.status, options);
      } else {
        // No filters
        result = await this.projectsRepository.findAll(client, options);
      }

      const projects = result.data.map(row => ProjectResponseDto.fromDatabase(row));

      return {
        projects,
        total: result.total,
        page: result.page,
        limit: result.limit,
      };
    } catch (error) {
      this.logger.error('Error fetching projects:', error.message);
      
      if (error.message?.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access projects.');
      }
      
      if (error instanceof BadRequestException || error instanceof ForbiddenException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Unable to retrieve projects. Please try again or contact support if the problem persists.');
    }
  }

  async findOne(id: string, userId: string, accessToken?: string): Promise<ProjectResponseDto> {
    if (!this.isValidUUID(id)) {
      throw new BadRequestException('Please provide a valid project ID.');
    }

    if (!userId) {
      throw new BadRequestException('User authentication is required to access project details.');
    }

    try {
      this.logger.log(`Fetching project: ${id} for user: ${userId}`);
      
      const client = this.supabase.getClient(accessToken);
      const project = await this.projectsRepository.findById(client, id);

      return ProjectResponseDto.fromDatabase(project);
    } catch (error) {
      this.logger.error(`Error fetching project ${id}:`, error.message);
      
      if (error.message?.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access this project.');
      }
      
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Unable to retrieve project details. Please try again or contact support if the problem persists.');
    }
  }

  async create(createProjectDto: CreateProjectDto, userId: string, accessToken?: string): Promise<ProjectResponseDto> {
    if (!userId) {
      throw new BadRequestException('User authentication is required to create a project.');
    }

    try {
      this.logger.log(`Creating project for user: ${userId}`);

      const client = this.supabase.getClient(accessToken);

      // Check if project name already exists
      const nameExists = await this.projectsRepository.isNameExists(client, createProjectDto.name);
      if (nameExists) {
        throw new ConflictException('A project with this name already exists. Please choose a different name.');
      }

      // Auto-set currency based on country
      const getCurrencyByCountry = (country?: string): string => {
        if (!country) return 'USD';
        const countryLower = country.toLowerCase();
        
        if (countryLower.includes('india')) return 'INR';
        if (countryLower.includes('united states') || countryLower.includes('usa')) return 'USD';
        if (countryLower.includes('united kingdom') || countryLower.includes('uk')) return 'GBP';
        // European countries
        if (['germany', 'france', 'italy', 'spain', 'netherlands', 'belgium', 'austria', 'portugal', 'finland', 'ireland', 'luxembourg', 'slovenia', 'slovakia', 'estonia', 'latvia', 'lithuania', 'malta', 'cyprus'].some(eu => countryLower.includes(eu))) {
          return 'EUR';
        }
        
        return 'USD'; // Default fallback
      };

      const projectData = {
        name: createProjectDto.name,
        description: createProjectDto.description,
        status: createProjectDto.status || 'draft',
        country: createProjectDto.country,
        state: createProjectDto.state,
        city: createProjectDto.city,
        industry: createProjectDto.industry,
        estimated_annual_volume: createProjectDto.estimatedAnnualVolume,
        target_bom_cost: createProjectDto.targetBomCost,
        target_bom_cost_currency: createProjectDto.targetBomCostCurrency || getCurrencyByCountry(createProjectDto.country),
      };

      const project = await this.projectsRepository.create(client, projectData, userId);
      return ProjectResponseDto.fromDatabase(project);
    } catch (error) {
      this.logger.error('Error creating project:', error.message);
      
      if (error.message?.includes('duplicate key value')) {
        throw new ConflictException('A project with this name already exists. Please choose a different name.');
      }
      
      if (error.message?.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to create projects.');
      }
      
      if (error instanceof ConflictException || error instanceof BadRequestException || error instanceof ForbiddenException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Unable to create project. Please try again or contact support if the problem persists.');
    }
  }

  async update(id: string, updateProjectDto: UpdateProjectDto, userId: string, accessToken?: string): Promise<ProjectResponseDto> {
    if (!this.isValidUUID(id)) {
      throw new BadRequestException('Please provide a valid project ID.');
    }

    if (!userId) {
      throw new BadRequestException('User authentication is required to update a project.');
    }

    try {
      this.logger.log(`Updating project: ${id} for user: ${userId}`);

      const client = this.supabase.getClient(accessToken);

      // Check if updating name and it conflicts with existing project
      if (updateProjectDto.name) {
        const nameExists = await this.projectsRepository.isNameExists(client, updateProjectDto.name, id);
        if (nameExists) {
          throw new ConflictException('A project with this name already exists. Please choose a different name.');
        }
      }

      // Auto-set currency based on country if not explicitly provided
      const getCurrencyByCountry = (country?: string): string => {
        if (!country) return 'USD';
        const countryLower = country.toLowerCase();
        
        if (countryLower.includes('india')) return 'INR';
        if (countryLower.includes('united states') || countryLower.includes('usa')) return 'USD';
        if (countryLower.includes('united kingdom') || countryLower.includes('uk')) return 'GBP';
        // European countries
        if (['germany', 'france', 'italy', 'spain', 'netherlands', 'belgium', 'austria', 'portugal', 'finland', 'ireland', 'luxembourg', 'slovenia', 'slovakia', 'estonia', 'latvia', 'lithuania', 'malta', 'cyprus'].some(eu => countryLower.includes(eu))) {
          return 'EUR';
        }
        
        return 'USD'; // Default fallback
      };

      const updateData = {
        name: updateProjectDto.name,
        description: updateProjectDto.description,
        status: updateProjectDto.status,
        country: updateProjectDto.country,
        state: updateProjectDto.state,
        city: updateProjectDto.city,
        industry: updateProjectDto.industry,
        estimated_annual_volume: updateProjectDto.estimatedAnnualVolume,
        target_bom_cost: updateProjectDto.targetBomCost,
        target_bom_cost_currency: updateProjectDto.targetBomCostCurrency || (updateProjectDto.country ? getCurrencyByCountry(updateProjectDto.country) : undefined),
        updated_at: new Date().toISOString(),
      };

      // Remove undefined values
      Object.keys(updateData).forEach(key => {
        if ((updateData as any)[key] === undefined) {
          delete (updateData as any)[key];
        }
      });

      const project = await this.projectsRepository.update(client, id, updateData);
      return ProjectResponseDto.fromDatabase(project);
    } catch (error) {
      this.logger.error(`Error updating project ${id}:`, error.message);
      
      if (error.message?.includes('duplicate key value')) {
        throw new ConflictException('A project with this name already exists. Please choose a different name.');
      }
      
      if (error.message?.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to update this project.');
      }
      
      if (error instanceof NotFoundException || error instanceof ConflictException || error instanceof BadRequestException || error instanceof ForbiddenException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Unable to update project. Please try again or contact support if the problem persists.');
    }
  }

  async remove(id: string, userId: string, accessToken?: string) {
    if (!this.isValidUUID(id)) {
      throw new BadRequestException('Please provide a valid project ID.');
    }

    if (!userId) {
      throw new BadRequestException('User authentication is required to delete a project.');
    }

    try {
      this.logger.log(`Deleting project: ${id} for user: ${userId}`);

      const client = this.supabase.getClient(accessToken);
      await this.projectsRepository.delete(client, id);

      return { message: 'Project and all associated data have been permanently deleted.' };
    } catch (error) {
      this.logger.error(`Error deleting project ${id}:`, error.message);
      
      if (error.message?.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to delete this project.');
      }
      
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Unable to delete project. Please try again or contact support if the problem persists.');
    }
  }

  async getCostAnalysis(id: string, userId: string, accessToken?: string) {
    if (!this.isValidUUID(id)) {
      throw new BadRequestException('Please provide a valid project ID.');
    }

    if (!userId) {
      throw new BadRequestException('User authentication is required to access cost analysis.');
    }

    try {
      this.logger.log(`Fetching cost analysis for project: ${id} for user: ${userId}`);

      const client = this.supabase.getClient(accessToken);
      const project = await this.projectsRepository.findById(client, id);

      // Get BOM data for the project
      const { data: bomData, error: bomError } = await client
        .from('boms')
        .select(`
          total_material_cost,
          total_material_cost_inr,
          total_labor_cost,
          total_overhead_cost
        `)
        .eq('project_id', id)
        .maybeSingle();

      if (bomError) {
        this.logger.warn(`Error fetching BOM data for cost analysis: ${bomError.message}`);
      }

      const targetCost = project.target_bom_cost || 0;
      const actualCost = bomData?.total_material_cost || 0;
      const currency = project.target_bom_cost_currency || 'USD';

      return {
        projectId: id,
        targetBomCost: targetCost,
        actualBomCost: actualCost,
        costVariance: actualCost - targetCost,
        costVariancePercentage: targetCost > 0 ? ((actualCost - targetCost) / targetCost * 100).toFixed(2) : '0',
        currency,
        estimatedAnnualVolume: project.estimated_annual_volume || 0,
        costBreakdown: {
          materials: bomData?.total_material_cost || 0,
          labor: bomData?.total_labor_cost || 0,
          overhead: bomData?.total_overhead_cost || 0,
        },
        message: 'Cost analysis retrieved successfully'
      };
    } catch (error) {
      this.logger.error(`Error getting cost analysis for project ${id}:`, error.message);
      
      if (error.message?.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access cost analysis for this project.');
      }
      
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Unable to retrieve cost analysis. Please try again or contact support if the problem persists.');
    }
  }

  async getTeamMembers(id: string, userId: string, accessToken?: string): Promise<TeamMembersListResponseDto> {
    if (!this.isValidUUID(id)) {
      throw new BadRequestException('Please provide a valid project ID.');
    }

    if (!userId) {
      throw new BadRequestException('User authentication is required to access team members.');
    }

    try {
      this.logger.log(`Fetching team members for project: ${id} for user: ${userId}`);

      const client = this.supabase.getClient(accessToken);
      
      // Verify project exists and user has access
      await this.projectsRepository.findById(client, id);

      // Check if project_team_members table exists, if not return empty team
      let teamMembers = [];
      let error = null;
      
      try {
        // Try to select with email column, fallback if column doesn't exist
        let result;
        try {
          result = await client
            .from('project_team_members')
            .select(`
              id,
              user_id,
              role,
              created_at,
              email
            `)
            .eq('project_id', id);
        } catch (emailColumnError) {
          this.logger.warn('Email column not found, selecting without email column');
          result = await client
            .from('project_team_members')
            .select(`
              id,
              user_id,
              role,
              created_at
            `)
            .eq('project_id', id);
        }
          
        teamMembers = result.data || [];
        error = result.error;
      } catch (tableError) {
        this.logger.error(`project_team_members table not found: ${tableError.message}`);
        throw new InternalServerErrorException('Unable to retrieve team members. Please ensure the project team members table exists.');
      }

      if (error) {
        this.logger.error(`Error fetching team members: ${error.message}`);
        throw new InternalServerErrorException('Unable to retrieve team members.');
      }

      // Get user details separately to avoid relationship issues
      const userIds = (teamMembers || []).map(m => m.user_id).filter(Boolean);
      let userDetails: Record<string, any> = {};
      
      if (userIds.length > 0) {
        const { data: users } = await client.auth.admin.listUsers();
        const usersList = users?.users || [];
        for (const user of usersList) {
          userDetails[user.id] = user;
        }
      }

      const formattedMembers = (teamMembers || []).map(member => {
        const user = userDetails[member.user_id];
        const email = user?.email || (member as any).email || 'unknown@example.com';
        const name = user?.user_metadata?.full_name || email?.split('@')[0] || 'Team Member';
        
        return {
          id: member.id,
          userId: member.user_id,
          email: email,
          name: name,
          role: member.role,
          addedAt: member.created_at,
        };
      });

      return {
        members: formattedMembers as any[],
        total: formattedMembers.length,
        message: 'Team members retrieved successfully'
      };
    } catch (error) {
      this.logger.error(`Error getting team members for project ${id}:`, error.message);
      
      if (error.message?.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access team members for this project.');
      }
      
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Unable to retrieve team members. Please try again or contact support if the problem persists.');
    }
  }

  async addTeamMember(id: string, dto: AddTeamMemberDto, userId: string, accessToken?: string): Promise<TeamMemberResponseDto> {
    if (!this.isValidUUID(id)) {
      throw new BadRequestException('Please provide a valid project ID.');
    }

    if (!userId) {
      throw new BadRequestException('User authentication is required to add team members.');
    }

    if (!dto.email && !dto.userId) {
      throw new BadRequestException('Either email or user ID must be provided to add a team member.');
    }

    try {
      this.logger.log(`Adding team member to project: ${id} for user: ${userId}`);

      const client = this.supabase.getClient(accessToken);
      
      // Verify project exists and user has access
      await this.projectsRepository.findById(client, id);

      let targetUserId = dto.userId;

      // If email provided, try to find user in auth system, otherwise create placeholder
      if (dto.email && !targetUserId) {
        try {
          // Try to find user in Supabase auth
          const { data: authUsers } = await client.auth.admin.listUsers();
          const authUser = authUsers?.users?.find((u: any) => u.email === dto.email);
          
          if (authUser) {
            targetUserId = authUser.id;
          } else {
            // For MVP: Create a placeholder UUID for pending user (using crypto.randomUUID if available)
            if (typeof crypto !== 'undefined' && crypto.randomUUID) {
              targetUserId = crypto.randomUUID();
            } else {
              // Fallback UUID v4 format
              targetUserId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
              });
            }
            this.logger.log(`Creating placeholder team member for ${dto.email}`);
          }
        } catch (authError) {
          this.logger.warn(`Could not check auth users: ${authError.message}`);
          // Fallback: create placeholder UUID
          if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            targetUserId = crypto.randomUUID();
          } else {
            // Fallback UUID v4 format
            targetUserId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
              const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
              return v.toString(16);
            });
          }
        }
      }

      // Check if user is already a team member (skip for MVP as table may not exist)
      try {
        const { data: existingMember, error: existingError } = await client
          .from('project_team_members')
          .select('id')
          .eq('project_id', id)
          .eq('user_id', targetUserId)
          .maybeSingle();

        if (existingError) {
          this.logger.warn(`Error checking existing team member (table may not exist): ${existingError.message}`);
        } else if (existingMember) {
          throw new ConflictException('This person is already a member of this project.');
        }
      } catch (tableError) {
        this.logger.warn(`project_team_members table may not exist: ${tableError.message}`);
        // Continue with MVP flow
      }

      // Add team member (MVP: handle missing table gracefully)
      try {
        // Try to insert with email, fallback without email if column doesn't exist
        let newMember, insertError;
        try {
          const result = await client
            .from('project_team_members')
            .insert({
              project_id: id,
              user_id: targetUserId,
              role: dto.role || TeamMemberRole.VIEWER,
              email: dto.email,
            })
            .select(`
              id,
              user_id,
              role,
              created_at,
              email
            `)
            .single();
          newMember = result.data;
          insertError = result.error;
        } catch (emailColumnError) {
          this.logger.warn('Email column not found during insert, inserting without email');
          const result = await client
            .from('project_team_members')
            .insert({
              project_id: id,
              user_id: targetUserId,
              role: dto.role || TeamMemberRole.VIEWER,
            })
            .select(`
              id,
              user_id,
              role,
              created_at
            `)
            .single();
          newMember = result.data;
          insertError = result.error;
        }

        if (insertError) {
          this.logger.error(`Error adding team member: ${insertError.message}`);
          throw new InternalServerErrorException('Unable to add team member.');
        }

        return {
          teamMember: {
            id: newMember?.id,
            userId: newMember?.user_id,
            email: (newMember as any)?.email || dto.email,
            name: ((newMember as any)?.email || dto.email)?.split('@')[0] || 'Team Member',
            role: newMember?.role,
            addedAt: newMember?.created_at,
          },
          message: 'Team member added successfully'
        };
      } catch (tableError) {
        this.logger.error(`Error adding team member: ${tableError.message}`);
        throw new InternalServerErrorException('Unable to add team member. Please ensure the project team members table exists.');
      }
    } catch (error) {
      this.logger.error(`Error adding team member to project ${id}:`, error.message);
      
      if (error.message?.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to add team members to this project.');
      }
      
      if (error instanceof NotFoundException || error instanceof ConflictException || error instanceof BadRequestException || error instanceof ForbiddenException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Unable to add team member. Please try again or contact support if the problem persists.');
    }
  }

  async updateTeamMember(id: string, memberId: string, dto: UpdateTeamMemberDto, userId: string, accessToken?: string): Promise<TeamMemberResponseDto> {
    if (!this.isValidUUID(id) || !this.isValidUUID(memberId)) {
      throw new BadRequestException('Please provide valid project and member IDs.');
    }

    if (!userId) {
      throw new BadRequestException('User authentication is required to update team members.');
    }

    try {
      this.logger.log(`Updating team member ${memberId} for project: ${id} for user: ${userId}`);

      const client = this.supabase.getClient(accessToken);
      
      // Verify project exists and user has access
      await this.projectsRepository.findById(client, id);

      // Update team member
      const { data: updatedMember, error } = await client
        .from('project_team_members')
        .update({ role: dto.role })
        .eq('id', memberId)
        .eq('project_id', id)
        .select(`
          id,
          user_id,
          role,
          created_at
        `)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          throw new NotFoundException('Team member not found or you don\'t have permission to update them.');
        }
        this.logger.error(`Error updating team member: ${error.message}`);
        throw new InternalServerErrorException('Unable to update team member.');
      }

      // Get user details from auth separately if needed
      let userEmail = '';
      let userName = '';
      
      try {
        if (updatedMember.user_id && !updatedMember.user_id.startsWith('pending-')) {
          const { data: authUsers } = await client.auth.admin.listUsers();
          const authUser = authUsers?.users?.find((u: any) => u.id === updatedMember.user_id);
          if (authUser) {
            userEmail = authUser.email || '';
            userName = authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || '';
          }
        }
      } catch (authError) {
        this.logger.warn(`Could not fetch user details: ${authError.message}`);
      }

      return {
        teamMember: {
          id: updatedMember.id,
          userId: updatedMember.user_id,
          email: userEmail,
          name: userName,
          role: updatedMember.role,
          addedAt: updatedMember.created_at,
        },
        message: 'Team member role updated successfully'
      };
    } catch (error) {
      this.logger.error(`Error updating team member ${memberId}:`, error.message);
      
      if (error.message?.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to update team members for this project.');
      }
      
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Unable to update team member. Please try again or contact support if the problem persists.');
    }
  }

  async removeTeamMember(id: string, memberId: string, userId: string, accessToken?: string) {
    if (!this.isValidUUID(id) || !this.isValidUUID(memberId)) {
      throw new BadRequestException('Please provide valid project and member IDs.');
    }

    if (!userId) {
      throw new BadRequestException('User authentication is required to remove team members.');
    }

    try {
      this.logger.log(`Removing team member ${memberId} from project: ${id} for user: ${userId}`);

      const client = this.supabase.getClient(accessToken);
      
      // Verify project exists and user has access
      await this.projectsRepository.findById(client, id);

      // Remove team member
      const { error } = await client
        .from('project_team_members')
        .delete()
        .eq('id', memberId)
        .eq('project_id', id);

      if (error) {
        this.logger.error(`Error removing team member: ${error.message}`);
        throw new InternalServerErrorException('Unable to remove team member.');
      }

      return { message: 'Team member removed from project successfully' };
    } catch (error) {
      this.logger.error(`Error removing team member ${memberId}:`, error.message);
      
      if (error.message?.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to remove team members from this project.');
      }
      
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof ForbiddenException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Unable to remove team member. Please try again or contact support if the problem persists.');
    }
  }

  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }
}