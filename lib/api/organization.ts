import { apiClient } from './client';

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

// ─── Organization API ─────────────────────────────────────────
// Served by the backend (/organizations), which runs every query as the signed-in user so the database's RLS rules apply.
const orgPath = (orgId: string) => `/organizations/${encodeURIComponent(orgId)}`;

export const organizationApi = {
  getMyOrganization: () => apiClient.get<Organization | null>('/organizations/mine'),

  createOrganization: (data: CreateOrgData) => apiClient.post<Organization>('/organizations', data),

  updateOrganization: (id: string, data: UpdateOrgData) => apiClient.patch<Organization>(orgPath(id), data),

  async deleteOrganization(id: string): Promise<void> {
    await apiClient.delete(orgPath(id));
  },

  // ─── Members ───────────────────────────────────────────────
  getMembers: (orgId: string) => apiClient.get<OrgMember[]>(`${orgPath(orgId)}/members`),

  async inviteMember(orgId: string, email: string, role: OrgMember['role']): Promise<void> {
    await apiClient.post(`${orgPath(orgId)}/members`, { email, role });
  },

  async removeMember(orgId: string, memberId: string): Promise<void> {
    await apiClient.delete(`${orgPath(orgId)}/members/${encodeURIComponent(memberId)}`);
  },

  // ─── Workspaces ────────────────────────────────────────────
  getWorkspaces: (orgId: string) => apiClient.get<Workspace[]>(`${orgPath(orgId)}/workspaces`),

  createWorkspace: (orgId: string, name: string, description?: string) =>
    apiClient.post<Workspace>(`${orgPath(orgId)}/workspaces`, { name, description }),

  updateWorkspace: (orgId: string, id: string, name: string, description?: string) =>
    apiClient.patch<Workspace>(`${orgPath(orgId)}/workspaces/${encodeURIComponent(id)}`, { name, description }),

  async deleteWorkspace(orgId: string, id: string): Promise<void> {
    await apiClient.delete(`${orgPath(orgId)}/workspaces/${encodeURIComponent(id)}`);
  },
};
