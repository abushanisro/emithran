import { apiClient } from './client';

export type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  rawKey?: string;
};

export type CreateApiKeyData = {
  name: string;
  scopes?: string[];
};

export type RequestLog = {
  id: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number | null;
  createdAt: string;
  errorCode: string | null;
};

export type LogsQuery = {
  page?: number;
  limit?: number;
  method?: string | undefined;
  statusMin?: number | undefined;
  statusMax?: number | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
};

export type LogStats = {
  total: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgDurationMs: number;
  topEndpoints: { path: string; count: number }[];
};

export const developerApi = {
  listApiKeys: (): Promise<ApiKey[]> =>
    apiClient.get<ApiKey[]>('/developer/api-keys'),

  createApiKey: (data: CreateApiKeyData): Promise<ApiKey> =>
    apiClient.post<ApiKey>('/developer/api-keys', data),

  revokeApiKey: (id: string): Promise<void> =>
    apiClient.delete<void>(`/developer/api-keys/${id}/revoke`),

  listLogs: (query?: LogsQuery): Promise<{ logs: RequestLog[]; total: number }> =>
    apiClient.get('/developer/logs', { params: query }),

  getStats: (): Promise<LogStats> =>
    apiClient.get<LogStats>('/developer/logs/stats'),
};
