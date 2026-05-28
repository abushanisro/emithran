import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const developerGroup: ResourceGroup = {
  id: 'developer',
  label: 'Developer',
  description: 'Manage API keys and inspect request logs for your integrations.',
  icon: 'Key',
  endpoints: [
    {
      id: 'list-api-keys',
      method: 'GET',
      path: '/v1/api/developer/api-keys',
      summary: 'List API keys',
      description: 'Returns all active API keys for the authenticated user. Note: raw key values are never returned after initial creation.',
      parameters: [],
      responses: [
        {
          statusCode: 200,
          description: 'API keys retrieved',
          example: {
            success: true,
            data: [
              {
                id: 'key-uuid',
                name: 'Production Integration',
                prefix: 'mk_live_abc',
                scopes: ['read', 'write'],
                createdAt: '2025-01-15T10:00:00Z',
                lastUsedAt: '2025-05-01T08:30:00Z',
              },
            ],
          },
        },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/developer/api-keys \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/developer/api-keys', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});\nconst { data: keys } = await response.json();` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/developer/api-keys',\n    headers={'Authorization': f'Bearer {token}'},\n)\nkeys = response.json()['data']` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/developer/api-keys", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-api-key',
      method: 'POST',
      path: '/v1/api/developer/api-keys',
      summary: 'Create API key',
      description: 'Creates a new API key. The raw key value is returned only once in this response — store it securely. Subsequent requests will only show the key prefix.',
      parameters: [],
      requestBody: {
        description: 'API key configuration',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: true, description: 'Descriptive name for this key', example: 'Production Integration' },
            { name: 'scopes', type: 'array', required: false, description: 'Permission scopes', enum: ['read', 'write'], default: ['read'] },
          ],
        },
        example: { name: 'Production Integration', scopes: ['read', 'write'] },
      },
      responses: [
        {
          statusCode: 201,
          description: 'API key created — save the rawKey now',
          example: {
            success: true,
            data: {
              id: 'key-uuid',
              name: 'Production Integration',
              rawKey: 'mk_live_abcdefghijklmnopqrstuvwxyz1234567890',
              prefix: 'mk_live_abc',
              scopes: ['read', 'write'],
              createdAt: '2025-05-01T10:00:00Z',
            },
          },
        },
      ],
      errors: [
        { statusCode: 400, code: 'VALIDATION_ERROR', description: 'Invalid scope or name' },
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/developer/api-keys \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Production Integration","scopes":["read","write"]}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/developer/api-keys', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ name: 'Production Integration', scopes: ['read', 'write'] }),\n});\nconst { data } = await response.json();\nconsole.log('Save this key:', data.rawKey);` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/developer/api-keys',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'name': 'Production Integration', 'scopes': ['read', 'write']},\n)\nraw_key = response.json()['data']['rawKey']  # Save this!` },
        { language: 'go', label: 'Go', code: `payload := \`{"name":"Production Integration","scopes":["read","write"]}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/developer/api-keys", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'revoke-api-key',
      method: 'DELETE',
      path: '/v1/api/developer/api-keys/{id}/revoke',
      summary: 'Revoke API key',
      description: 'Permanently revokes an API key. Any requests using this key will immediately return 401. This action cannot be undone.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'API key UUID', format: 'uuid', example: 'key-uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Key revoked', example: { success: true, message: 'API key revoked successfully' } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'API key not found' },
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/developer/api-keys/{key_id}/revoke \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/developer/api-keys/\${keyId}/revoke\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/developer/api-keys/{key_id}/revoke',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/developer/api-keys/"+keyID+"/revoke", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'list-request-logs',
      method: 'GET',
      path: '/v1/api/developer/logs',
      summary: 'List request logs',
      description: 'Returns a paginated log of all API requests made by the authenticated user within the last 30 days.',
      parameters: [
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Results per page (max 100)', default: 50 },
        { name: 'method', in: 'query', type: 'string', required: false, description: 'Filter by HTTP method', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        { name: 'status', in: 'query', type: 'string', required: false, description: 'Filter by status class', enum: ['2xx', '4xx', '5xx'] },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'Logs retrieved',
          example: {
            success: true,
            data: {
              logs: [
                { id: 'log-uuid', method: 'GET', path: '/v1/api/projects', statusCode: 200, durationMs: 45, timestamp: '2025-05-01T08:30:00Z' },
              ],
              total: 1240,
              page: 1,
              limit: 50,
            },
          },
        },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/developer/logs \\\n  -H "Authorization: Bearer {token}" \\\n  -d "page=1&limit=50&status=4xx"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/developer/logs?page=1&limit=50\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    '${BASE_URL}/v1/api/developer/logs',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'page': 1, 'limit': 50},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/developer/logs?page=1&limit=50", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-log-stats',
      method: 'GET',
      path: '/v1/api/developer/logs/stats',
      summary: 'Get request statistics',
      description: 'Returns aggregated statistics for API usage over the last 30 days: total requests, success rate, average response time, and top endpoints.',
      parameters: [],
      responses: [
        {
          statusCode: 200,
          description: 'Statistics retrieved',
          example: {
            success: true,
            data: {
              totalRequests: 12480,
              successRate: 98.7,
              avgResponseMs: 62,
              errorRate: 1.3,
              topEndpoints: [
                { path: '/v1/api/projects', count: 3240, avgMs: 45 },
                { path: '/v1/api/boms', count: 2180, avgMs: 38 },
              ],
            },
          },
        },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/developer/logs/stats \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/developer/logs/stats', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    '${BASE_URL}/v1/api/developer/logs/stats',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/developer/logs/stats", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
  ],
};
