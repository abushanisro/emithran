import { apiClient } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BenchmarkSession {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'archived';
  ownerId: string;
  selectedProjects: { id: string; name: string; targetPrice?: number }[];
  selectedBoms: {
    id: string;
    name: string;
    projectId: string;
    projectName: string;
    version?: string;
    status?: string;
  }[];
  bomCount: number;
  savedInsights: any | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBenchmarkSession {
  name: string;
  description?: string;
}

export interface UpdateBenchmarkSession {
  name?: string;
  description?: string;
  status?: 'draft' | 'active' | 'archived';
  selectedProjects?: BenchmarkSession['selectedProjects'];
  selectedBoms?: BenchmarkSession['selectedBoms'];
  bomCount?: number;
  savedInsights?: any;
}

// ─── API client ───────────────────────────────────────────────────────────────

export const benchmarkSessionsApi = {
  getSessions: () =>
    apiClient.get<BenchmarkSession[]>('/benchmark-sessions'),

  getSession: (id: string) =>
    apiClient.get<BenchmarkSession>(`/benchmark-sessions/${id}`),

  createSession: (data: CreateBenchmarkSession) =>
    apiClient.post<BenchmarkSession>('/benchmark-sessions', data),

  updateSession: (id: string, data: UpdateBenchmarkSession) =>
    apiClient.put<BenchmarkSession>(`/benchmark-sessions/${id}`, data),

  deleteSession: (id: string) =>
    apiClient.delete(`/benchmark-sessions/${id}`),
};
