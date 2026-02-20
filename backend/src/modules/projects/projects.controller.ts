interface User { id: string; email: string; [key: string]: any; }
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseFilters,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiBody } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, UpdateProjectDto, QueryProjectsDto } from './dto/projects.dto';
import { ProjectResponseDto, ProjectListResponseDto } from './dto/project-response.dto';
import { AddTeamMemberDto, UpdateTeamMemberDto, TeamMemberResponseDto, TeamMembersListResponseDto } from './dto/project-team-member.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';

@ApiTags('Projects')
@ApiBearerAuth()
@Controller({ path: 'api/projects', version: '1' })
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all projects with pagination' })
  @ApiResponse({ status: 200, description: 'Projects retrieved successfully', type: ProjectListResponseDto })
  async findAll(@Query() query: QueryProjectsDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<ProjectListResponseDto> {
    return this.projectsService.findAll(query, user.id, token);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project by ID' })
  @ApiParam({ name: 'id', description: 'Project ID', example: '123e4567-e89b-12d3-a456-426614174000' })
  @ApiResponse({ status: 200, description: 'Project retrieved successfully', type: ProjectResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid project ID format' })
  @ApiResponse({ status: 404, description: 'Project not found or access denied' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async findOne(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<ProjectResponseDto> {
    return this.projectsService.findOne(id, user.id, token);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new project' })
  @ApiBody({ type: CreateProjectDto })
  @ApiResponse({ status: 201, description: 'Project created successfully', type: ProjectResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input data or project name already exists' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async create(@Body() createProjectDto: CreateProjectDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<ProjectResponseDto> {
    return this.projectsService.create(createProjectDto, user.id, token);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update project' })
  @ApiParam({ name: 'id', description: 'Project ID', example: '123e4567-e89b-12d3-a456-426614174000' })
  @ApiBody({ type: UpdateProjectDto })
  @ApiResponse({ status: 200, description: 'Project updated successfully', type: ProjectResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input data, project ID format, or project name already exists' })
  @ApiResponse({ status: 404, description: 'Project not found or access denied' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async update(@Param('id') id: string, @Body() updateProjectDto: UpdateProjectDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<ProjectResponseDto> {
    return this.projectsService.update(id, updateProjectDto, user.id, token);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete project and all associated data' })
  @ApiParam({ name: 'id', description: 'Project ID', example: '123e4567-e89b-12d3-a456-426614174000' })
  @ApiResponse({ status: 200, description: 'Project deleted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid project ID format' })
  @ApiResponse({ status: 404, description: 'Project not found or access denied' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async remove(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.projectsService.remove(id, user.id, token);
  }

  @Get(':id/cost-analysis')
  @ApiOperation({ summary: 'Get project cost analysis' })
  @ApiResponse({ status: 200, description: 'Cost analysis retrieved successfully' })
  async getCostAnalysis(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.projectsService.getCostAnalysis(id, user.id, token);
  }

  // ============================================================================
  // TEAM MEMBER ENDPOINTS
  // ============================================================================

  @Get(':id/team')
  @ApiOperation({ summary: 'Get project team members' })
  @ApiResponse({ status: 200, description: 'Team members retrieved successfully', type: TeamMembersListResponseDto })
  async getTeamMembers(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<TeamMembersListResponseDto> {
    return this.projectsService.getTeamMembers(id, user.id, token);
  }

  @Post(':id/team')
  @ApiOperation({ summary: 'Add team member to project' })
  @ApiResponse({ status: 201, description: 'Team member added successfully', type: TeamMemberResponseDto })
  async addTeamMember(@Param('id') id: string, @Body() dto: AddTeamMemberDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<TeamMemberResponseDto> {
    return this.projectsService.addTeamMember(id, dto, user.id, token);
  }

  @Put(':id/team/:memberId')
  @ApiOperation({ summary: 'Update team member role' })
  @ApiResponse({ status: 200, description: 'Team member updated successfully', type: TeamMemberResponseDto })
  async updateTeamMember(@Param('id') id: string, @Param('memberId') memberId: string, @Body() dto: UpdateTeamMemberDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<TeamMemberResponseDto> {
    return this.projectsService.updateTeamMember(id, memberId, dto, user.id, token);
  }

  @Delete(':id/team/:memberId')
  @ApiOperation({ summary: 'Remove team member from project' })
  @ApiResponse({ status: 200, description: 'Team member removed successfully' })
  async removeTeamMember(@Param('id') id: string, @Param('memberId') memberId: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.projectsService.removeTeamMember(id, memberId, user.id, token);
  }
}
