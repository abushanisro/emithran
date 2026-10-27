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

export const developerApi = {
  listApiKeys: (): Promise<ApiKey[]> =>
    apiClient.get<ApiKey[]>('/developer/api-keys'),

  createApiKey: (data: CreateApiKeyData): Promise<ApiKey> =>
    apiClient.post<ApiKey>('/developer/api-keys', data),

  revokeApiKey: (id: string): Promise<void> =>
    apiClient.delete<void>(`/developer/api-keys/${id}/revoke`),
};
