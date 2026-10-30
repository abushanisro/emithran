import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccessToken } from '../../common/decorators/access-token.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

import { CreateOrganizationDto, InviteMemberDto, UpdateOrganizationDto, WorkspaceDto } from './dto/organization.dto';
import { OrganizationsService, type MemberView, type OrganizationRow, type WorkspaceRow } from './organizations.service';

/** The browser's organization settings, which used to query these tables straight from Supabase. */
@ApiTags('Organizations')
@ApiBearerAuth()
@Controller({ path: 'api/organizations', version: '1' })
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('mine')
  @ApiOperation({ summary: 'The organization the signed-in user owns, or null' })
  mine(@CurrentUser('id') userId: string, @AccessToken() token: string): Promise<OrganizationRow | null> {
    return this.organizations.mine(userId, token);
  }

  @Post()
  @ApiOperation({ summary: 'Create an organization owned by the signed-in user, with its default workspace' })
  create(@Body() dto: CreateOrganizationDto, @CurrentUser('id') userId: string, @AccessToken() token: string): Promise<OrganizationRow> {
    return this.organizations.create(userId, dto, token);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
    @AccessToken() token: string,
  ): Promise<OrganizationRow> {
    return this.organizations.update(id, dto, token);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @AccessToken() token: string): Promise<void> {
    return this.organizations.remove(id, token);
  }

  @Get(':id/members')
  members(@Param('id', ParseUUIDPipe) id: string, @AccessToken() token: string): Promise<MemberView[]> {
    return this.organizations.members(id, token);
  }

  @Post(':id/members')
  @HttpCode(204)
  invite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InviteMemberDto,
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
  ): Promise<void> {
    return this.organizations.invite(id, userId, dto, token);
  }

  @Delete(':id/members/:memberId')
  @HttpCode(204)
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @AccessToken() token: string,
  ): Promise<void> {
    return this.organizations.removeMember(id, memberId, token);
  }

  @Get(':id/workspaces')
  workspaces(@Param('id', ParseUUIDPipe) id: string, @AccessToken() token: string): Promise<WorkspaceRow[]> {
    return this.organizations.workspaces(id, token);
  }

  @Post(':id/workspaces')
  createWorkspace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WorkspaceDto,
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
  ): Promise<WorkspaceRow> {
    return this.organizations.createWorkspace(id, userId, dto, token);
  }

  @Patch(':id/workspaces/:workspaceId')
  updateWorkspace(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: WorkspaceDto,
    @AccessToken() token: string,
  ): Promise<WorkspaceRow> {
    return this.organizations.updateWorkspace(id, workspaceId, dto, token);
  }

  @Delete(':id/workspaces/:workspaceId')
  @HttpCode(204)
  removeWorkspace(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @AccessToken() token: string,
  ): Promise<void> {
    return this.organizations.removeWorkspace(id, workspaceId, token);
  }
}
