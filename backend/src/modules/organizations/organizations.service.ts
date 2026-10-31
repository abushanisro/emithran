import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';

import { SupabaseService } from '../../common/supabase/supabase.service';
import { UserDirectory } from '../../common/supabase/user-directory';

import type { CreateOrganizationDto, InviteMemberDto, UpdateOrganizationDto, WorkspaceDto } from './dto/organization.dto';

/** Rows go back as stored; the global TransformInterceptor turns snake_case columns into the camelCase the client reads. */
export type OrganizationRow = { id: string; name: string; owner_id: string } & Record<string, unknown>;
export type WorkspaceRow = { id: string; organization_id: string } & Record<string, unknown>;
type MemberRow = { id: string; user_id: string | null; invited_email: string | null } & Record<string, unknown>;
export type MemberView = MemberRow & { email: string | null; display_name: string | null };

const ORGANIZATION_COLUMNS = {
  name: 'name',
  entityType: 'entity_type',
  country: 'country',
  stateProvince: 'state_province',
  city: 'city',
  addressLine1: 'address_line1',
  addressLine2: 'address_line2',
  postalCode: 'postal_code',
  taxId: 'tax_id',
  customerType: 'customer_type',
  apiUseCase: 'api_use_case',
  useTags: 'use_tags',
  legalMedicalFinancial: 'legal_medical_financial',
  under18: 'under_18',
  allowDefaultWorkspaceKeys: 'allow_default_workspace_keys',
} as const satisfies Record<keyof UpdateOrganizationDto, string>;

function columnsOf(dto: UpdateOrganizationDto): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(ORGANIZATION_COLUMNS)) {
    const value: unknown = dto[field as keyof UpdateOrganizationDto];
    if (value !== undefined) row[column] = value;
  }
  return row;
}

/** Postgres refusals keep their meaning at the edge: an RLS denial is 403, a duplicate is 409, anything else is a server error. */
function fail(error: PostgrestError): never {
  if (error.code === '42501') throw new ForbiddenException('Not allowed for this organization');
  if (error.code === '23505') throw new ConflictException(error.message);
  throw new Error(error.message);
}

function exactlyOne<T>(rows: T[] | null, what: string): T {
  const [row] = rows ?? [];
  if (!row) throw new NotFoundException(`${what} not found`);
  return row;
}

/**
 * Organizations, members and workspaces for the signed-in user. Every query runs with the caller's own token, so the RLS policies of
 * migration 125 decide what each person may read or change; this service adds no privileged access.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly directory: UserDirectory,
  ) {}

  async mine(userId: string, token: string): Promise<OrganizationRow | null> {
    const { data, error } = await this.supabase
      .getClient(token)
      .from('organizations')
      .select('*')
      .eq('owner_id', userId)
      .maybeSingle<OrganizationRow>();
    if (error) fail(error);
    return data;
  }

  /**
   * Organization, owner membership, then default workspace. PostgREST cannot wrap the three in one transaction, so each step stops on
   * error and the owner can still reach (and delete) an organization whose later steps failed; the Kysely port makes it atomic.
   */
  async create(userId: string, dto: CreateOrganizationDto, token: string): Promise<OrganizationRow> {
    const client = this.supabase.getClient(token);
    const { data, error } = await client
      .from('organizations')
      .insert({ ...columnsOf(dto), owner_id: userId })
      .select('*')
      .overrideTypes<OrganizationRow[], { merge: false }>();
    if (error) fail(error);
    const organization = exactlyOne(data, 'Organization');

    const member = await client
      .from('organization_members')
      .insert({ organization_id: organization.id, user_id: userId, role: 'owner', status: 'active' });
    if (member.error) fail(member.error);

    const workspace = await client.from('workspaces').insert({
      organization_id: organization.id,
      name: 'Default',
      description: 'Default workspace',
      is_default: true,
      created_by: userId,
    });
    if (workspace.error) fail(workspace.error);

    return organization;
  }

  async update(id: string, dto: UpdateOrganizationDto, token: string): Promise<OrganizationRow> {
    const { data, error } = await this.supabase
      .getClient(token)
      .from('organizations')
      .update(columnsOf(dto))
      .eq('id', id)
      .select('*')
      .overrideTypes<OrganizationRow[], { merge: false }>();
    if (error) fail(error);
    return exactlyOne(data, 'Organization');
  }

  async remove(id: string, token: string): Promise<void> {
    const { data, error } = await this.supabase.getClient(token).from('organizations').delete().eq('id', id).select('id');
    if (error) fail(error);
    exactlyOne(data, 'Organization');
  }

  async members(organizationId: string, token: string): Promise<MemberView[]> {
    const client = this.supabase.getClient(token);
    const { data, error } = await client
      .from('organization_members')
      .select('*')
      .eq('organization_id', organizationId)
      .order('joined_at', { ascending: true })
      .overrideTypes<MemberRow[], { merge: false }>();
    if (error) fail(error);
    const rows = data;

    const userIds = rows.flatMap((row) => (row.user_id ? [row.user_id] : []));
    const [people, profiles] = await Promise.all([this.directory.findByIds(userIds), this.displayNames(client, userIds)]);

    return rows.map((row) => ({
      ...row,
      email: (row.user_id ? people.get(row.user_id)?.email : null) ?? row.invited_email,
      display_name: (row.user_id ? profiles.get(row.user_id) : null) ?? null,
    }));
  }

  async invite(organizationId: string, invitedBy: string, dto: InviteMemberDto, token: string): Promise<void> {
    const { error } = await this.supabase.getClient(token).from('organization_members').insert({
      organization_id: organizationId,
      invited_email: dto.email.trim().toLowerCase(),
      role: dto.role,
      status: 'invited',
      invited_by: invitedBy,
    });
    if (error) fail(error);
  }

  async removeMember(organizationId: string, memberId: string, token: string): Promise<void> {
    const { data, error } = await this.supabase
      .getClient(token)
      .from('organization_members')
      .delete()
      .eq('id', memberId)
      .eq('organization_id', organizationId)
      .select('id');
    if (error) fail(error);
    exactlyOne(data, 'Member');
  }

  async workspaces(organizationId: string, token: string): Promise<WorkspaceRow[]> {
    const { data, error } = await this.supabase
      .getClient(token)
      .from('workspaces')
      .select('*')
      .eq('organization_id', organizationId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .overrideTypes<WorkspaceRow[], { merge: false }>();
    if (error) fail(error);
    return data;
  }

  async createWorkspace(organizationId: string, createdBy: string, dto: WorkspaceDto, token: string): Promise<WorkspaceRow> {
    const { data, error } = await this.supabase
      .getClient(token)
      .from('workspaces')
      .insert({ organization_id: organizationId, name: dto.name, description: dto.description ?? null, is_default: false, created_by: createdBy })
      .select('*')
      .overrideTypes<WorkspaceRow[], { merge: false }>();
    if (error) fail(error);
    return exactlyOne(data, 'Workspace');
  }

  async updateWorkspace(organizationId: string, workspaceId: string, dto: WorkspaceDto, token: string): Promise<WorkspaceRow> {
    const { data, error } = await this.supabase
      .getClient(token)
      .from('workspaces')
      .update({ name: dto.name, description: dto.description ?? null })
      .eq('id', workspaceId)
      .eq('organization_id', organizationId)
      .select('*')
      .overrideTypes<WorkspaceRow[], { merge: false }>();
    if (error) fail(error);
    return exactlyOne(data, 'Workspace');
  }

  async removeWorkspace(organizationId: string, workspaceId: string, token: string): Promise<void> {
    const { data, error } = await this.supabase
      .getClient(token)
      .from('workspaces')
      .delete()
      .eq('id', workspaceId)
      .eq('organization_id', organizationId)
      .select('id');
    if (error) fail(error);
    exactlyOne(data, 'Workspace');
  }

  private async displayNames(client: ReturnType<SupabaseService['getClient']>, userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const { data, error } = await client
      .from('user_profiles')
      .select('user_id, display_name')
      .in('user_id', userIds)
      .overrideTypes<{ user_id: string; display_name: string | null }[], { merge: false }>();
    if (error) fail(error);
    return new Map(data.flatMap((p) => (p.display_name ? [[p.user_id, p.display_name] as const] : [])));
  }
}
