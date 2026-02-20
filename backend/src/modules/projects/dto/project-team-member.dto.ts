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

/**
 * Role Descriptions for UI Display
 */
export const ROLE_DESCRIPTIONS = {
  // Legacy roles
  [TeamMemberRole.OWNER]: 'Project owner with full access',
  [TeamMemberRole.ADMIN]: 'Administrator with full access',
  [TeamMemberRole.MEMBER]: 'Regular team member',
  [TeamMemberRole.VIEWER]: 'Read-only access to assigned modules',
  
  // Manufacturing roles
  [TeamMemberRole.PROJECT_MANAGER]: 'Overall coordination and project management',
  [TeamMemberRole.DESIGN_ENGINEER]: 'Drawing & revision control, CAD management',
  [TeamMemberRole.MANUFACTURING_ENGINEER]: 'Process planning and routing optimization',
  [TeamMemberRole.PROCUREMENT_MANAGER]: 'Supplier evaluation and vendor management',
  [TeamMemberRole.QUALITY_ENGINEER]: 'Inspection & control plan development',
  [TeamMemberRole.FINANCE_ANALYST]: 'Cost validation and financial analysis',
};

/**
 * Module Access Permissions by Role
 * Future implementation for role-based access control
 */
export const ROLE_PERMISSIONS = {
  // Legacy roles
  [TeamMemberRole.OWNER]: {
    projects: ['read', 'write', 'delete'],
    boms: ['read', 'write', 'delete'],
    processes: ['read', 'write', 'delete'],
    vendors: ['read', 'write', 'delete'],
    costing: ['read', 'write', 'delete'],
    team: ['read', 'write', 'delete'],
  },
  [TeamMemberRole.ADMIN]: {
    projects: ['read', 'write', 'delete'],
    boms: ['read', 'write', 'delete'],
    processes: ['read', 'write', 'delete'],
    vendors: ['read', 'write'],
    costing: ['read', 'write'],
    team: ['read', 'write', 'delete'],
  },
  [TeamMemberRole.MEMBER]: {
    projects: ['read'],
    boms: ['read'],
    processes: ['read'],
    vendors: ['read'],
    costing: ['read'],
    team: ['read'],
  },
  [TeamMemberRole.VIEWER]: {
    projects: ['read'],
    boms: ['read'],
    processes: ['read'],
    vendors: ['read'],
    costing: ['read'],
    team: ['read'],
  },
  
  // Manufacturing roles
  [TeamMemberRole.PROJECT_MANAGER]: {
    projects: ['read', 'write', 'delete'],
    boms: ['read', 'write', 'delete'],
    processes: ['read', 'write', 'delete'],
    vendors: ['read', 'write'],
    costing: ['read', 'write'],
    team: ['read', 'write', 'delete'],
  },
  [TeamMemberRole.DESIGN_ENGINEER]: {
    projects: ['read', 'write'],
    boms: ['read', 'write', 'delete'],
    processes: ['read'],
    vendors: ['read'],
    costing: ['read'],
    team: ['read'],
  },
  [TeamMemberRole.MANUFACTURING_ENGINEER]: {
    projects: ['read'],
    boms: ['read'],
    processes: ['read', 'write', 'delete'],
    vendors: ['read'],
    costing: ['read', 'write'],
    team: ['read'],
  },
  [TeamMemberRole.PROCUREMENT_MANAGER]: {
    projects: ['read'],
    boms: ['read'],
    processes: ['read'],
    vendors: ['read', 'write', 'delete'],
    costing: ['read', 'write'],
    team: ['read'],
  },
  [TeamMemberRole.QUALITY_ENGINEER]: {
    projects: ['read'],
    boms: ['read'],
    processes: ['read', 'write'],
    vendors: ['read'],
    costing: ['read'],
    team: ['read'],
  },
  [TeamMemberRole.FINANCE_ANALYST]: {
    projects: ['read'],
    boms: ['read'],
    processes: ['read'],
    vendors: ['read'],
    costing: ['read', 'write', 'delete'],
    team: ['read'],
  },
};

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
