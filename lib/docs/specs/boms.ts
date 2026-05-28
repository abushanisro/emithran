import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const bomsGroup: ResourceGroup = {
  id: 'bom',
  label: 'Bill of Materials',
  description: 'Create and manage hierarchical Bills of Materials. A BOM represents the complete assembly structure of a product.',
  icon: 'FileText',
  endpoints: [
    {
      id: 'list-boms',
      method: 'GET',
      path: '/v1/api/boms',
      summary: 'List BOMs',
      description: 'Returns all BOMs for the authenticated user, optionally filtered by project.',
      parameters: [
        { name: 'projectId', in: 'query', type: 'string', required: false, description: 'Filter by project UUID', format: 'uuid' },
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Results per page', default: 20 },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'BOMs retrieved',
          example: {
            success: true,
            data: { boms: [{ id: 'bom-uuid', name: 'Assembly BOM v1', projectId: 'proj-uuid', itemCount: 24 }], total: 5 },
          },
        },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/boms \\\n  -H "Authorization: Bearer {token}" \\\n  -d "projectId=proj-uuid"` },
        { language: 'javascript', label: 'JavaScript', code: `const params = new URLSearchParams({ projectId: 'proj-uuid' });\nconst response = await fetch(\`${BASE_URL}/v1/api/boms?\${params}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/boms',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'projectId': 'proj-uuid'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/boms?projectId=proj-uuid", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-bom',
      method: 'POST',
      path: '/v1/api/boms',
      summary: 'Create a BOM',
      description: 'Creates a new Bill of Materials. A BOM can be a standalone assembly or linked to a project.',
      parameters: [],
      requestBody: {
        description: 'BOM data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: true, description: 'BOM name', example: 'Engine Assembly v1' },
            { name: 'projectId', type: 'string', required: false, description: 'Link to a project UUID', format: 'uuid' },
            { name: 'description', type: 'string', required: false, description: 'BOM description' },
            { name: 'currency', type: 'string', required: false, description: 'Currency for cost calculations', default: 'USD' },
            { name: 'quantity', type: 'integer', required: false, description: 'Top-level assembly quantity', default: 1 },
          ],
        },
        example: { name: 'Engine Assembly v1', projectId: 'proj-uuid', currency: 'USD', quantity: 1 },
      },
      responses: [
        { statusCode: 201, description: 'BOM created', example: { success: true, data: { id: 'bom-uuid', name: 'Engine Assembly v1', createdAt: '2025-01-15T10:00:00Z' } } },
      ],
      errors: [
        { statusCode: 400, code: 'VALIDATION_ERROR', description: 'Invalid input data' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Project not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/boms \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Engine Assembly v1","projectId":"proj-uuid","currency":"USD","quantity":1}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/boms', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ name: 'Engine Assembly v1', projectId: 'proj-uuid', currency: 'USD' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/boms',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'name': 'Engine Assembly v1', 'projectId': 'proj-uuid', 'currency': 'USD'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"name":"Engine Assembly v1","projectId":"proj-uuid","currency":"USD"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/boms", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-bom',
      method: 'GET',
      path: '/v1/api/boms/{id}',
      summary: 'Retrieve a BOM',
      description: 'Retrieves a BOM with its full hierarchical structure including all items and sub-assemblies.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'BOM UUID', format: 'uuid', example: 'bom-uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'BOM retrieved', example: { success: true, data: { id: 'bom-uuid', name: 'Engine Assembly v1', items: [] } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'BOM not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/boms/{bom_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/boms/\${bomId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/boms/{bom_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/boms/"+bomID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-bom',
      method: 'PATCH',
      path: '/v1/api/boms/{id}',
      summary: 'Update a BOM',
      description: 'Updates the name, description, or status of an existing BOM.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'BOM UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: false, description: 'BOM name', example: 'Engine Assembly v2' },
            { name: 'description', type: 'string', required: false, description: 'BOM description' },
            { name: 'status', type: 'string', required: false, description: 'BOM status', enum: ['draft', 'active', 'archived'] },
          ],
        },
        example: { name: 'Engine Assembly v2', status: 'active' },
      },
      responses: [
        { statusCode: 200, description: 'BOM updated', example: { success: true, data: { id: 'bom-uuid', name: 'Engine Assembly v2', status: 'active' } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'BOM not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PATCH ${BASE_URL}/v1/api/boms/{bom_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Engine Assembly v2","status":"active"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/boms/\${bomId}\`, {\n  method: 'PATCH',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ name: 'Engine Assembly v2', status: 'active' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.patch(\n    f'${BASE_URL}/v1/api/boms/{bom_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'name': 'Engine Assembly v2', 'status': 'active'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"name":"Engine Assembly v2","status":"active"}\`\nreq, _ := http.NewRequest("PATCH", "${BASE_URL}/v1/api/boms/"+bomID, strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-bom',
      method: 'DELETE',
      path: '/v1/api/boms/{id}',
      summary: 'Delete a BOM',
      description: 'Permanently deletes a BOM and all its associated items. This action cannot be undone.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'BOM UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'BOM deleted', example: { success: true, message: 'BOM deleted successfully' } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'BOM not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'BOM is referenced by active production lots' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/boms/{bom_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/boms/\${bomId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/boms/{bom_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/boms/"+bomID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-bom-cost-summary',
      method: 'GET',
      path: '/v1/api/boms/{id}/cost-summary',
      summary: 'Get BOM cost summary',
      description: 'Returns an aggregated cost summary for the entire BOM, broken down by cost category across all items.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'BOM UUID', format: 'uuid', example: 'bom-uuid' },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'Cost summary retrieved',
          example: {
            success: true,
            data: {
              bomId: 'bom-uuid',
              itemCount: 24,
              totalMaterialCost: 110250,
              totalProcessCost: 42150,
              totalToolingCost: 6000,
              totalPackagingCost: 8760,
              grandTotal: 167160,
              currency: 'INR',
            },
          },
        },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'BOM not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/boms/{bom_id}/cost-summary \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/boms/\${bomId}/cost-summary\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/boms/{bom_id}/cost-summary',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/boms/"+bomID+"/cost-summary", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'recalculate-bom-costs',
      method: 'POST',
      path: '/v1/api/boms/{id}/recalculate-all-costs',
      summary: 'Recalculate all BOM costs',
      description: 'Triggers a full recalculation of all cost components across all items in the BOM. Use this after updating material prices, MHR, or LSR rates.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'BOM UUID', format: 'uuid', example: 'bom-uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Recalculation complete', example: { success: true, data: { bomId: 'bom-uuid', itemsRecalculated: 24, totalCost: 167160, recalculatedAt: '2025-05-01T12:00:00Z' } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'BOM not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/boms/{bom_id}/recalculate-all-costs \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/boms/\${bomId}/recalculate-all-costs\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/boms/{bom_id}/recalculate-all-costs',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/boms/"+bomID+"/recalculate-all-costs", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
  ],
};
