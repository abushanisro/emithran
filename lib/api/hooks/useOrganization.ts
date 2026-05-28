import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { organizationApi, type CreateOrgData, type UpdateOrgData } from '../organization';
import { toast } from 'sonner';

export const orgKeys = {
  org:        ['organization']                    as const,
  members:    (id: string) => ['org-members', id] as const,
  workspaces: (id: string) => ['workspaces', id]  as const,
};

// ─── Organization ─────────────────────────────────────────────
export function useMyOrganization() {
  return useQuery({
    queryKey: orgKeys.org,
    queryFn:  () => organizationApi.getMyOrganization(),
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateOrgData) => organizationApi.createOrganization(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orgKeys.org });
      toast.success('Organization created');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateOrgData }) =>
      organizationApi.updateOrganization(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orgKeys.org });
      toast.success('Organization updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => organizationApi.deleteOrganization(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orgKeys.org });
      toast.success('Organization deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Members ──────────────────────────────────────────────────
export function useOrgMembers(orgId: string | undefined) {
  return useQuery({
    queryKey: orgKeys.members(orgId ?? ''),
    queryFn:  () => organizationApi.getMembers(orgId!),
    enabled: !!orgId,
    staleTime: 1000 * 60 * 2,
  });
}

export function useInviteMember(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: 'admin' | 'member' | 'viewer' }) =>
      organizationApi.inviteMember(orgId, email, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orgKeys.members(orgId) });
      toast.success('Invitation sent');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRemoveMember(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => organizationApi.removeMember(memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orgKeys.members(orgId) });
      toast.success('Member removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Workspaces ───────────────────────────────────────────────
export function useWorkspaces(orgId: string | undefined) {
  return useQuery({
    queryKey: orgKeys.workspaces(orgId ?? ''),
    queryFn:  () => organizationApi.getWorkspaces(orgId!),
    enabled: !!orgId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateWorkspace(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      organizationApi.createWorkspace(orgId, name, description),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orgKeys.workspaces(orgId) });
      toast.success('Workspace created');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteWorkspace(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => organizationApi.deleteWorkspace(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orgKeys.workspaces(orgId) });
      toast.success('Workspace deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
