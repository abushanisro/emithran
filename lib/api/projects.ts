/**
 * Projects API
 */

import { apiClient } from './client';

export type Project = {
  id: string;
  name: string;
  description?: string;
  country?: string;
  state?: string;
  city?: string;
  status: 'draft' | 'active' | 'completed' | 'on_hold' | 'cancelled';
  targetPrice?: number;
  shouldCost?: number;
  industry?: string;
  estimatedAnnualVolume?: number;
  targetBomCost?: number;
  targetBomCostCurrency?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateProjectData = {
  name: string;
  description?: string;
  country?: string;
  state?: string;
  city?: string;
  status?: Project['status'];
  targetPrice?: number;
  industry?: string;
  estimatedAnnualVolume?: number;
  targetBomCost?: number;
  targetBomCostCurrency?: string;
};

export type UpdateProjectData = Partial<CreateProjectData>;

export type ProjectQuery = {
  search?: string;
  status?: Project['status'];
  page?: number;
  limit?: number;
};

export type ProjectsResponse = {
  projects: Project[];
  total: number;
  page: number;
  limit: number;
};

export const projectsApi = {
  /**
   * Get all projects
   */
  getAll: async (query?: ProjectQuery): Promise<ProjectsResponse> => {
    const params = new URLSearchParams();
    if (query?.search) params.append('search', query.search);
    if (query?.status) params.append('status', query.status);
    if (query?.page) params.append('page', query.page.toString());
    if (query?.limit) params.append('limit', query.limit.toString());

    const queryString = params.toString();
    return apiClient.get<ProjectsResponse>(
      `/projects${queryString ? `?${queryString}` : ''}`,
    );
  },

  /**
   * Get project by ID
   */
  getById: async (id: string): Promise<Project> => {
    return apiClient.get<Project>(`/projects/${id}`);
  },

  /**
   * Create new project
   */
  create: async (data: CreateProjectData): Promise<Project> => {
    return apiClient.post<Project>('/projects', data);
  },

  /**
   * Update project
   */
  update: async (id: string, data: UpdateProjectData): Promise<Project> => {
    return apiClient.put<Project>(`/projects/${id}`, data);
  },

  /**
   * Delete project
   */
  delete: async (id: string): Promise<void> => {
    return apiClient.delete(`/projects/${id}`);
  },

  /**
   * Get project cost analysis
   */
  getCostAnalysis: async (id: string): Promise<any> => {
    return apiClient.get(`/projects/${id}/cost-analysis`);
  },
};
