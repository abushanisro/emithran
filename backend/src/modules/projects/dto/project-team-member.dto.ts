import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsUUID } from 'class-validator';

/**
 * Manufacturing Team Member Roles and Permissions
 * Based on industry-standard manufacturing project structure
 *
 * Legacy roles for backward compatibility:
 * OWNER: Project owner (mapped to PROJECT_MANAGER)
 * ADMIN: Administrator (mapped to PROJECT_MANAGER) 
 * MEMBER: Regular member (mapped to VIEWER)
 * VIEWER: Read-only access
 *
 * Manufacturing roles:
 * PROJECT_MANAGER: Overall coordination, full access
 * DESIGN_ENGINEER: Drawing & revision control, CAD access
 * MANUFACTURING_ENGINEER: Process planning, routing access  
 * PROCUREMENT_MANAGER: Supplier evaluation, vendor management
 * QUALITY_ENGINEER: Inspection & control plan access
 * FINANCE_ANALYST: Cost validation, financial analysis
 */
export enum TeamMemberRole {
  // Legacy roles (backward compatibility)
  OWNER = 'owner',
  ADMIN = 'admin', 
  MEMBER = 'member',
  VIEWER = 'viewer',
  
  // Manufacturing roles
  PROJECT_MANAGER = 'project_manager',
  DESIGN_ENGINEER = 'design_engineer', 
  MANUFACTURING_ENGINEER = 'manufacturing_engineer',
  PROCUREMENT_MANAGER = 'procurement_manager',
  QUALITY_ENGINEER = 'quality_engineer',
  FINANCE_ANALYST = 'finance_analyst',
}

export class AddTeamMemberDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ example: 'uuid' })
  @IsUUID()
  @IsOptional()
  userId?: string;

  @ApiProperty({ enum: TeamMemberRole, example: TeamMemberRole.MEMBER })
  @IsEnum(TeamMemberRole)
  @IsOptional()
  role?: TeamMemberRole;
}

export class UpdateTeamMemberDto {
  @ApiProperty({ enum: TeamMemberRole, example: TeamMemberRole.ADMIN })
  @IsEnum(TeamMemberRole)
  role: TeamMemberRole;
}

export class TeamMemberResponseDto {
  teamMember: {
    id: string;
    userId: string;
    email?: string;
    name?: string;
    role: TeamMemberRole;
    addedAt: string;
  };
  
  @ApiProperty({ example: 'Team member added successfully' })
  message?: string;

  static fromDatabase(row: any): TeamMemberResponseDto {
    const dto = new TeamMemberResponseDto();
    dto.teamMember = {
      id: row.id,
      userId: row.user_id || row.userId,
      email: row.email,
      name: row.name || undefined,
      role: row.role,
      addedAt: row.created_at || row.addedAt,
    };
    return dto;
  }
}

export class TeamMembersListResponseDto {
  @ApiProperty({ type: [TeamMemberResponseDto] })
  members: TeamMemberResponseDto[];

  @ApiProperty({ example: 5 })
  total: number;

  @ApiProperty({ example: 'Team members retrieved successfully' })
  message?: string;
}
