import { supabase } from '@/lib/supabase/client';

// ─── Types ───────────────────────────────────────────────────
export type Organization = {
  id: string;
  name: string;
  entityType: string | null;
  country: string | null;
  stateProvince: string | null;
  city: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  taxId: string | null;
  customerType: string | null;
  apiUseCase: string | null;
  useTags: string[];
  legalMedicalFinancial: boolean;
  under18: boolean;
  allowDefaultWorkspaceKeys: boolean;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

export type OrgMember = {
  id: string;
  organizationId: string;
  userId: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  invitedEmail: string | null;
  status: 'active' | 'invited' | 'suspended';
  joinedAt: string;
  email?: string;
  displayName?: string;
};

export type Workspace = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateOrgData = {
  name: string;
  entityType?: string;
  country?: string;
  customerType?: string;
  apiUseCase?: string;
  useTags?: string[];
  legalMedicalFinancial?: boolean;
  under18?: boolean;
};

export type UpdateOrgData = Partial<Omit<CreateOrgData, 'name'> & {
  name: string;
  stateProvince: string;
  city: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  taxId: string;
  allowDefaultWorkspaceKeys: boolean;
}>;

// ─── Helpers ─────────────────────────────────────────────────
function mapOrg(row: any): Organization {
  return {
    id: row.id,
    name: row.name,
    entityType: row.entity_type,
    country: row.country,
    stateProvince: row.state_province,
    city: row.city,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    postalCode: row.postal_code,
    taxId: row.tax_id,
    customerType: row.customer_type,
    apiUseCase: row.api_use_case,
    useTags: row.use_tags ?? [],
    legalMedicalFinancial: row.legal_medical_financial ?? false,
    under18: row.under_18 ?? false,
    allowDefaultWorkspaceKeys: row.allow_default_workspace_keys ?? true,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMember(row: any): OrgMember {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role,
    invitedEmail: row.invited_email,
    status: row.status,
    joinedAt: row.joined_at,
    email: row.email,
    displayName: row.display_name,
  };
}

function mapWorkspace(row: any): Workspace {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    isDefault: row.is_default,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Organization API ─────────────────────────────────────────
export const organizationApi = {
  async getMyOrganization(): Promise<Organization | null> {
    if (!supabase) return null;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from('organizations')
      .select('*')
      .eq('owner_id', user.id)
      .single();

    return data ? mapOrg(data) : null;
  },

  async createOrganization(orgData: CreateOrgData): Promise<Organization> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data: org, error } = await supabase
      .from('organizations')
      .insert({
        name: orgData.name,
        entity_type: orgData.entityType,
        country: orgData.country,
        customer_type: orgData.customerType,
        api_use_case: orgData.apiUseCase,
        use_tags: orgData.useTags ?? [],
        legal_medical_financial: orgData.legalMedicalFinancial ?? false,
        under_18: orgData.under18 ?? false,
        owner_id: user.id,
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);

    // Auto-create owner member row
    await supabase.from('organization_members').insert({
      organization_id: org.id,
      user_id: user.id,
      role: 'owner',
      status: 'active',
    });

    // Auto-create Default workspace
    await supabase.from('workspaces').insert({
      organization_id: org.id,
      name: 'Default',
      description: 'Default workspace',
      is_default: true,
      created_by: user.id,
    });

    return mapOrg(org);
  },

  async updateOrganization(id: string, data: UpdateOrgData): Promise<Organization> {
    if (!supabase) throw new Error('Supabase not configured');

    const patch: Record<string, any> = {};
    if (data.name !== undefined)                       patch.name = data.name;
    if (data.entityType !== undefined)                 patch.entity_type = data.entityType;
    if (data.country !== undefined)                    patch.country = data.country;
    if (data.stateProvince !== undefined)              patch.state_province = data.stateProvince;
    if (data.city !== undefined)                       patch.city = data.city;
    if (data.addressLine1 !== undefined)               patch.address_line1 = data.addressLine1;
    if (data.addressLine2 !== undefined)               patch.address_line2 = data.addressLine2;
    if (data.postalCode !== undefined)                 patch.postal_code = data.postalCode;
    if (data.taxId !== undefined)                      patch.tax_id = data.taxId;
    if (data.customerType !== undefined)               patch.customer_type = data.customerType;
    if (data.apiUseCase !== undefined)                 patch.api_use_case = data.apiUseCase;
    if (data.useTags !== undefined)                    patch.use_tags = data.useTags;
    if (data.allowDefaultWorkspaceKeys !== undefined)  patch.allow_default_workspace_keys = data.allowDefaultWorkspaceKeys;

    const { data: updated, error } = await supabase
      .from('organizations').update(patch).eq('id', id).select('*').single();

    if (error) throw new Error(error.message);
    return mapOrg(updated);
  },

  async deleteOrganization(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.from('organizations').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // ─── Members ───────────────────────────────────────────────
  async getMembers(orgId: string): Promise<OrgMember[]> {
    if (!supabase) return [];
    const { data } = await supabase
      .from('organization_members')
      .select(`
        *,
        user_profiles!left(display_name),
        auth_users:user_id(email)
      `)
      .eq('organization_id', orgId)
      .order('joined_at');

    return (data ?? []).map((row: any) => ({
      ...mapMember(row),
      email: row.auth_users?.email ?? row.invited_email,
      displayName: row.user_profiles?.display_name,
    }));
  },

  async inviteMember(orgId: string, email: string, role: OrgMember['role']): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('organization_members').insert({
      organization_id: orgId,
      invited_email: email,
      role,
      status: 'invited',
      invited_by: user?.id,
    });
    if (error) throw new Error(error.message);
  },

  async removeMember(memberId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.from('organization_members').delete().eq('id', memberId);
    if (error) throw new Error(error.message);
  },

  // ─── Workspaces ────────────────────────────────────────────
  async getWorkspaces(orgId: string): Promise<Workspace[]> {
    if (!supabase) return [];
    const { data } = await supabase
      .from('workspaces')
      .select('*')
      .eq('organization_id', orgId)
      .order('is_default', { ascending: false })
      .order('created_at');
    return (data ?? []).map(mapWorkspace);
  },

  async createWorkspace(orgId: string, name: string, description?: string): Promise<Workspace> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('workspaces')
      .insert({ organization_id: orgId, name, description: description ?? null, is_default: false, created_by: user.id })
      .select('*').single();
    if (error) throw new Error(error.message);
    return mapWorkspace(data);
  },

  async updateWorkspace(id: string, name: string, description?: string): Promise<Workspace> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('workspaces').update({ name, description: description ?? null }).eq('id', id).select('*').single();
    if (error) throw new Error(error.message);
    return mapWorkspace(data);
  },

  async deleteWorkspace(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.from('workspaces').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};
