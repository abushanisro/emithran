import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const projectsGroup: ResourceGroup = {
  id: 'projects',
  label: 'Projects',
  description: 'Manage manufacturing and costing projects. Projects are the top-level container for BOMs, processes, and cost analysis.',
  icon: 'FolderKanban',
  endpoints: [
    {
      id: 'list-projects',
      method: 'GET',
      path: '/v1/api/projects',
      summary: 'List all projects',
      description: 'Returns a paginated list of all projects for the authenticated user. Projects are ordered by creation date descending.',
      parameters: [
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number (1-based)', default: 1, example: 1 },
        { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Results per page (max 100)', default: 20, example: 20 },
        { name: 'status', in: 'query', type: 'string', required: false, description: 'Filter by status', enum: ['draft', 'active', 'completed', 'on_hold', 'cancelled'] },
        { name: 'search', in: 'query', type: 'string', required: false, description: 'Search by project name', example: 'Engine Block' },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'Projects retrieved successfully',
          example: {
            success: true,
            data: {
              projects: [
                { id: 'proj-uuid', name: 'Engine Block MFG', status: 'active', industry: 'automotive', createdAt: '2025-01-15T10:00:00Z' },
              ],
              total: 42,
              page: 1,
              limit: 20,
            },
          },
        },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid or missing authentication token' },
      ],
      examples: [
        {
          language: 'curl',
          label: 'cURL',
          code: `curl -G ${BASE_URL}/v1/api/projects \\
  -H "Authorization: Bearer {token}" \\
  -d "page=1" \\
  -d "limit=20" \\
  -d "status=active"`,
        },
        {
          language: 'javascript',
          label: 'JavaScript',
          code: `const params = new URLSearchParams({ page: '1', limit: '20', status: 'active' });
const response = await fetch(\`${BASE_URL}/v1/api/projects?\${params}\`, {
  headers: { Authorization: \`Bearer \${token}\` },
});
const { data } = await response.json();`,
        },
        {
          language: 'python',
          label: 'Python',
          code: `import requests

response = requests.get(
    '${BASE_URL}/v1/api/projects',
    headers={'Authorization': f'Bearer {token}'},
    params={'page': 1, 'limit': 20, 'status': 'active'},
)
projects = response.json()['data']['projects']`,
        },
        {
          language: 'go',
          label: 'Go',
          code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/projects?page=1&limit=20", nil)
req.Header.Set("Authorization", "Bearer "+token)
resp, err := http.DefaultClient.Do(req)`,
        },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-project',
      method: 'POST',
      path: '/v1/api/projects',
      summary: 'Create a project',
      description: 'Creates a new manufacturing project. A project is the top-level container for BOMs, processes, and all associated cost analysis data.',
      parameters: [],
      requestBody: {
        description: 'Project data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: true, description: 'Project name (must be unique per user)', example: 'Engine Block Manufacturing' },
            { name: 'description', type: 'string', required: false, description: 'Project description', example: 'Cost analysis for V6 engine block' },
            { name: 'status', type: 'string', required: false, description: 'Initial project status', enum: ['draft', 'active'], default: 'draft' },
            { name: 'industry', type: 'string', required: false, description: 'Industry vertical', example: 'automotive' },
            { name: 'estimatedAnnualVolume', type: 'integer', required: false, description: 'Annual production volume in units', example: 10000 },
            { name: 'targetBomCost', type: 'number', required: false, description: 'Target per-unit BOM cost', example: 450.00 },
            { name: 'targetBomCostCurrency', type: 'string', required: false, description: 'Currency code', example: 'USD' },
          ],
        },
        example: {
          name: 'Engine Block Manufacturing',
          description: 'V6 engine block cost analysis',
          status: 'draft',
          industry: 'automotive',
          estimatedAnnualVolume: 10000,
          targetBomCost: 450.00,
          targetBomCostCurrency: 'USD',
        },
      },
      responses: [
        {
          statusCode: 201,
          description: 'Project created',
          example: {
            success: true,
            data: {
              id: 'proj-uuid',
              name: 'Engine Block Manufacturing',
              status: 'draft',
              createdAt: '2025-01-15T10:00:00Z',
            },
          },
        },
      ],
      errors: [
        { statusCode: 400, code: 'VALIDATION_ERROR', description: 'Missing required fields or invalid data' },
        { statusCode: 409, code: 'CONFLICT', description: 'A project with this name already exists' },
      ],
      examples: [
        {
          language: 'curl',
          label: 'cURL',
          code: `curl -X POST ${BASE_URL}/v1/api/projects \\
  -H "Authorization: Bearer {token}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Engine Block Manufacturing",
    "description": "V6 engine block cost analysis",
    "status": "draft",
    "industry": "automotive",
    "estimatedAnnualVolume": 10000,
    "targetBomCost": 450.00
  }'`,
        },
        {
          language: 'javascript',
          label: 'JavaScript',
          code: `const response = await fetch('${BASE_URL}/v1/api/projects', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${token}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'Engine Block Manufacturing',
    status: 'draft',
    industry: 'automotive',
    estimatedAnnualVolume: 10000,
  }),
});
const { data: project } = await response.json();`,
        },
        {
          language: 'python',
          label: 'Python',
          code: `response = requests.post(
    '${BASE_URL}/v1/api/projects',
    headers={'Authorization': f'Bearer {token}'},
    json={
        'name': 'Engine Block Manufacturing',
        'status': 'draft',
        'industry': 'automotive',
        'estimatedAnnualVolume': 10000,
    },
)
project = response.json()['data']`,
        },
        {
          language: 'go',
          label: 'Go',
          code: `payload := \`{"name":"Engine Block Manufacturing","status":"draft","industry":"automotive"}\`
req, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/projects", strings.NewReader(payload))
req.Header.Set("Authorization", "Bearer "+token)
req.Header.Set("Content-Type", "application/json")`,
        },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-project',
      method: 'GET',
      path: '/v1/api/projects/{id}',
      summary: 'Retrieve a project',
      description: 'Retrieves the details of an existing project by ID.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Project UUID', format: 'uuid', example: 'proj-uuid' },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'Project retrieved',
          example: {
            success: true,
            data: { id: 'proj-uuid', name: 'Engine Block Manufacturing', status: 'active', industry: 'automotive' },
          },
        },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Project not found or access denied' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/projects/{project_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/projects/\${id}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});\nconst { data: project } = await response.json();` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/projects/{project_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/projects/"+id, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-project',
      method: 'PUT',
      path: '/v1/api/projects/{id}',
      summary: 'Update a project',
      description: 'Updates an existing project. Only provide the fields you want to change.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Project UUID', format: 'uuid', example: 'proj-uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: false, description: 'New project name' },
            { name: 'status', type: 'string', required: false, description: 'New status', enum: ['draft', 'active', 'completed', 'on_hold', 'cancelled'] },
            { name: 'description', type: 'string', required: false, description: 'New description' },
          ],
        },
        example: { status: 'active', description: 'Updated description' },
      },
      responses: [{ statusCode: 200, description: 'Project updated', example: { success: true, data: { id: 'proj-uuid', status: 'active' } } }],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Project not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Project name already in use' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/projects/{project_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"status": "active"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/projects/\${id}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ status: 'active' }),\n});` },
        { language: 'python', label: 'Python', code: `requests.put(\n    f'${BASE_URL}/v1/api/projects/{project_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'status': 'active'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/projects/"+id, strings.NewReader(\`{"status":"active"}\`))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-project',
      method: 'DELETE',
      path: '/v1/api/projects/{id}',
      summary: 'Delete a project',
      description: 'Permanently deletes a project and all associated BOMs, cost analysis data, and production plans. This action cannot be undone.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Project UUID', format: 'uuid', example: 'proj-uuid' },
      ],
      responses: [{ statusCode: 200, description: 'Project deleted', example: { success: true, data: { message: 'Project deleted successfully' } } }],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Project not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/projects/{project_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/projects/\${id}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `requests.delete(\n    f'${BASE_URL}/v1/api/projects/{project_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/projects/"+id, nil)\nreq.Header.Set("Authorization", "Bearer "+token)\nhttp.DefaultClient.Do(req)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-project-cost-analysis',
      method: 'GET',
      path: '/v1/api/projects/{id}/cost-analysis',
      summary: 'Get project cost analysis',
      description: 'Returns a comprehensive cost analysis for all BOMs and items within the project, including material, process, and tooling cost breakdowns.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Project UUID', format: 'uuid', example: 'proj-uuid' },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'Cost analysis retrieved',
          example: {
            success: true,
            data: {
              projectId: 'proj-uuid',
              totalCost: 182160,
              costPerUnit: 364.32,
              breakdown: { material: 110250, process: 42150, tooling: 6000, overhead: 23760 },
              boms: [{ bomId: 'bom-uuid', name: 'Engine Assembly v1', totalCost: 182160 }],
            },
          },
        },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Project not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/projects/{project_id}/cost-analysis \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/projects/\${id}/cost-analysis\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/projects/{project_id}/cost-analysis',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/projects/"+id+"/cost-analysis", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'list-project-team',
      method: 'GET',
      path: '/v1/api/projects/{id}/team',
      summary: 'List project team members',
      description: 'Returns all team members assigned to the project with their roles.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Project UUID', format: 'uuid', example: 'proj-uuid' },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'Team retrieved',
          example: {
            success: true,
            data: [
              { id: 'member-uuid', userId: 'user-uuid', email: 'engineer@company.com', role: 'editor', addedAt: '2025-01-15T10:00:00Z' },
            ],
          },
        },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Project not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/projects/{project_id}/team \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/projects/\${id}/team\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/projects/{project_id}/team',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/projects/"+id+"/team", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'add-project-team-member',
      method: 'POST',
      path: '/v1/api/projects/{id}/team',
      summary: 'Add team member',
      description: 'Adds a user to the project team with a specified role.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Project UUID', format: 'uuid', example: 'proj-uuid' },
      ],
      requestBody: {
        description: 'Team member data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'userId', type: 'string', required: true, description: 'User UUID to add', format: 'uuid' },
            { name: 'role', type: 'string', required: true, description: 'Team role', enum: ['viewer', 'editor', 'admin'] },
          ],
        },
        example: { userId: 'user-uuid', role: 'editor' },
      },
      responses: [{ statusCode: 201, description: 'Member added', example: { success: true, data: { id: 'member-uuid', userId: 'user-uuid', role: 'editor' } } }],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Project or user not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'User is already a team member' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/projects/{project_id}/team \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"userId":"user-uuid","role":"editor"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/projects/\${id}/team\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ userId: 'user-uuid', role: 'editor' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/projects/{project_id}/team',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'userId': 'user-uuid', 'role': 'editor'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"userId":"user-uuid","role":"editor"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/projects/"+id+"/team", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
  ],
};
