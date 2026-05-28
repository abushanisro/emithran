import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const profileGroup: ResourceGroup = {
  id: 'profile',
  label: 'Profile',
  description: 'View and update the authenticated user\'s profile information.',
  icon: 'User',
  endpoints: [
    {
      id: 'get-profile',
      method: 'GET',
      path: '/v1/api/profile',
      summary: 'Get user profile',
      description: 'Returns the full profile of the currently authenticated user including display name, email, role, and organization details.',
      parameters: [],
      responses: [
        {
          statusCode: 200,
          description: 'Profile retrieved',
          example: {
            success: true,
            data: {
              id: 'user-uuid',
              email: 'engineer@company.com',
              displayName: 'Alex Engineer',
              role: 'engineer',
              organization: 'ACME Manufacturing',
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-04-01T10:00:00Z',
            },
          },
        },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/profile \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/profile', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});\nconst { data: profile } = await response.json();` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/profile',\n    headers={'Authorization': f'Bearer {token}'},\n)\nprofile = response.json()['data']` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/profile", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-profile',
      method: 'PATCH',
      path: '/v1/api/profile',
      summary: 'Update user profile',
      description: 'Updates the authenticated user\'s profile fields. Only provided fields are changed.',
      parameters: [],
      requestBody: {
        description: 'Profile fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'displayName', type: 'string', required: false, description: 'User display name', example: 'Alex Engineer' },
            { name: 'organization', type: 'string', required: false, description: 'Organization name', example: 'ACME Manufacturing' },
            { name: 'phone', type: 'string', required: false, description: 'Contact phone number', example: '+91-9999999999' },
            { name: 'timezone', type: 'string', required: false, description: 'User timezone', example: 'Asia/Kolkata' },
          ],
        },
        example: { displayName: 'Alex Engineer', organization: 'ACME Manufacturing' },
      },
      responses: [
        { statusCode: 200, description: 'Profile updated', example: { success: true, data: { id: 'user-uuid', displayName: 'Alex Engineer', updatedAt: '2025-05-01T10:00:00Z' } } },
      ],
      errors: [
        { statusCode: 400, code: 'VALIDATION_ERROR', description: 'Invalid field values' },
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PATCH ${BASE_URL}/v1/api/profile \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"displayName":"Alex Engineer","organization":"ACME Manufacturing"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/profile', {\n  method: 'PATCH',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ displayName: 'Alex Engineer' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.patch(\n    '${BASE_URL}/v1/api/profile',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'displayName': 'Alex Engineer'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"displayName":"Alex Engineer"}\`\nreq, _ := http.NewRequest("PATCH", "${BASE_URL}/v1/api/profile", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
  ],
};
