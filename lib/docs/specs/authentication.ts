import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const authenticationGroup: ResourceGroup = {
  id: 'authentication',
  label: 'Authentication',
  description: 'Obtain and manage API tokens for authenticating requests.',
  icon: 'Shield',
  endpoints: [
    {
      id: 'get-token',
      method: 'POST',
      path: '/v1/api/auth/token',
      summary: 'Obtain access token',
      description:
        'Exchange your email and password credentials for a JWT access token. The token expires in 1 hour. Use the refresh endpoint to obtain a new token without re-entering credentials.',
      parameters: [],
      requestBody: {
        description: 'User credentials',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'email', type: 'string', required: true, description: 'User email address', format: 'email', example: 'engineer@company.com' },
            { name: 'password', type: 'string', required: true, description: 'User password', example: 'your-password' },
          ],
        },
        example: { email: 'engineer@company.com', password: 'your-password' },
      },
      responses: [
        {
          statusCode: 200,
          description: 'Token issued successfully',
          example: {
            access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            token_type: 'bearer',
            expires_in: 3600,
          },
        },
      ],
      errors: [
        { statusCode: 400, code: 'INVALID_CREDENTIALS', description: 'Email or password is incorrect' },
        { statusCode: 429, code: 'RATE_LIMITED', description: 'Too many login attempts' },
      ],
      examples: [
        {
          language: 'curl',
          label: 'cURL',
          code: `curl -X POST ${BASE_URL}/v1/api/auth/token \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "engineer@company.com",
    "password": "your-password"
  }'`,
        },
        {
          language: 'javascript',
          label: 'JavaScript',
          code: `const response = await fetch('${BASE_URL}/v1/api/auth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'engineer@company.com',
    password: 'your-password',
  }),
});
const { access_token } = await response.json();`,
        },
        {
          language: 'python',
          label: 'Python',
          code: `import requests

response = requests.post(
    '${BASE_URL}/v1/api/auth/token',
    json={
        'email': 'engineer@company.com',
        'password': 'your-password',
    }
)
token = response.json()['access_token']`,
        },
        {
          language: 'go',
          label: 'Go',
          code: `body := strings.NewReader(\`{"email":"engineer@company.com","password":"your-password"}\`)
resp, err := http.Post(
    "${BASE_URL}/v1/api/auth/token",
    "application/json",
    body,
)`,
        },
      ],
      requiresAuth: false,
    },
    {
      id: 'refresh-token',
      method: 'POST',
      path: '/v1/api/auth/refresh',
      summary: 'Refresh access token',
      description: 'Exchange a refresh token for a new JWT access token without re-entering credentials.',
      parameters: [],
      requestBody: {
        description: 'Refresh token',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'refreshToken', type: 'string', required: true, description: 'Refresh token from the original token response' },
          ],
        },
        example: { refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
      },
      responses: [
        { statusCode: 200, description: 'New token issued', example: { access_token: 'eyJhbGci...', token_type: 'bearer', expires_in: 3600 } },
      ],
      errors: [
        { statusCode: 401, code: 'INVALID_TOKEN', description: 'Refresh token is invalid or expired' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/auth/refresh \\\n  -H "Content-Type: application/json" \\\n  -d '{"refreshToken":"your-refresh-token"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/auth/refresh', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({ refreshToken }),\n});\nconst { access_token } = await response.json();` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/auth/refresh',\n    json={'refreshToken': refresh_token},\n)\ntoken = response.json()['access_token']` },
        { language: 'go', label: 'Go', code: `body := strings.NewReader(\`{"refreshToken":"your-refresh-token"}\`)\nresp, _ := http.Post("${BASE_URL}/v1/api/auth/refresh", "application/json", body)` },
      ],
      requiresAuth: false,
    },
    {
      id: 'get-profile',
      method: 'GET',
      path: '/v1/api/auth/me',
      summary: 'Get current user',
      description: 'Returns the authenticated user\'s profile including email, role, and organization details.',
      parameters: [],
      responses: [
        { statusCode: 200, description: 'Profile retrieved', example: { success: true, data: { id: 'user-uuid', email: 'engineer@company.com', role: 'engineer', createdAt: '2025-01-01T00:00:00Z' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/auth/me \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/auth/me', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});\nconst { data: user } = await response.json();` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    '${BASE_URL}/v1/api/auth/me',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/auth/me", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
  ],
};
