import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const mhrGroup: ResourceGroup = {
  id: 'mhr',
  label: 'Machine Hour Rates',
  description: 'Manage Machine Hour Rate (MHR) records. MHR captures the fully-loaded hourly cost of operating a machine including depreciation, power, maintenance, and overhead.',
  icon: 'Cpu',
  endpoints: [
    {
      id: 'list-mhr-records',
      method: 'GET',
      path: '/v1/api/mhr',
      summary: 'List MHR records',
      description: 'Returns all Machine Hour Rate records with pagination and optional search.',
      parameters: [
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Results per page', default: 20 },
        { name: 'search', in: 'query', type: 'string', required: false, description: 'Search by machine name' },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'MHR records retrieved',
          example: {
            success: true,
            data: [
              { id: 'mhr-uuid', machineName: 'CNC Lathe 40T', machineCode: 'CNC-LAT-01', hourlyRate: 850, currency: 'INR', category: 'CNC Machining' },
              { id: 'mhr-uuid-2', machineName: 'VMC 500', machineCode: 'VMC-001', hourlyRate: 1100, currency: 'INR', category: 'CNC Machining' },
            ],
            metadata: { total: 24, page: 1, limit: 20 },
          },
        },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/mhr \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/mhr', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});\nconst { data: mhrRecords } = await response.json();` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/mhr',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/mhr", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-mhr',
      method: 'GET',
      path: '/v1/api/mhr/{id}',
      summary: 'Get MHR record',
      description: 'Returns a single Machine Hour Rate record with full cost breakdown details.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'MHR UUID', format: 'uuid', example: 'mhr-uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'MHR record retrieved', example: { success: true, data: { id: 'mhr-uuid', machineName: 'CNC Lathe 40T', machineCode: 'CNC-LAT-01', hourlyRate: 850, currency: 'INR', powerCostPerHr: 120, maintenanceCostPerHr: 85, depreciationPerHr: 200 } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'MHR record not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/mhr/{mhr_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/mhr/\${mhrId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/mhr/{mhr_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/mhr/"+mhrID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-mhr',
      method: 'POST',
      path: '/v1/api/mhr',
      summary: 'Create MHR record',
      description: 'Creates a new Machine Hour Rate record.',
      parameters: [],
      requestBody: {
        description: 'MHR data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'machineName', type: 'string', required: true, description: 'Machine name', example: 'CNC Lathe 40T' },
            { name: 'machineCode', type: 'string', required: false, description: 'Internal machine code', example: 'CNC-LAT-01' },
            { name: 'hourlyRate', type: 'number', required: true, description: 'Total fully-loaded hourly rate', example: 850 },
            { name: 'currency', type: 'string', required: false, description: 'Currency code', default: 'INR' },
            { name: 'category', type: 'string', required: false, description: 'Machine category', example: 'CNC Machining' },
            { name: 'powerCostPerHr', type: 'number', required: false, description: 'Power cost per hour', example: 120 },
            { name: 'maintenanceCostPerHr', type: 'number', required: false, description: 'Maintenance cost per hour', example: 85 },
            { name: 'depreciationPerHr', type: 'number', required: false, description: 'Depreciation per hour', example: 200 },
          ],
        },
        example: { machineName: 'CNC Lathe 40T', machineCode: 'CNC-LAT-01', hourlyRate: 850, currency: 'INR', category: 'CNC Machining' },
      },
      responses: [
        { statusCode: 201, description: 'MHR record created', example: { success: true, data: { id: 'mhr-uuid', machineName: 'CNC Lathe 40T', hourlyRate: 850 } } },
      ],
      errors: [
        { statusCode: 409, code: 'CONFLICT', description: 'A MHR record with this machine code already exists' },
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/mhr \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"machineName":"CNC Lathe 40T","machineCode":"CNC-LAT-01","hourlyRate":850,"currency":"INR"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/mhr', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ machineName: 'CNC Lathe 40T', machineCode: 'CNC-LAT-01', hourlyRate: 850, currency: 'INR' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/mhr',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'machineName': 'CNC Lathe 40T', 'machineCode': 'CNC-LAT-01', 'hourlyRate': 850, 'currency': 'INR'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"machineName":"CNC Lathe 40T","machineCode":"CNC-LAT-01","hourlyRate":850,"currency":"INR"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/mhr", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-mhr',
      method: 'PUT',
      path: '/v1/api/mhr/{id}',
      summary: 'Update MHR record',
      description: 'Updates an existing Machine Hour Rate record.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'MHR UUID', format: 'uuid', example: 'mhr-uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'hourlyRate', type: 'number', required: false, description: 'Updated hourly rate', example: 900 },
            { name: 'machineName', type: 'string', required: false, description: 'Updated machine name' },
          ],
        },
        example: { hourlyRate: 900 },
      },
      responses: [
        { statusCode: 200, description: 'MHR record updated', example: { success: true, data: { id: 'mhr-uuid', machineName: 'CNC Lathe 40T', hourlyRate: 900, updatedAt: '2025-05-01T10:00:00Z' } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'MHR record not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/mhr/{mhr_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"hourlyRate":900}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/mhr/\${mhrId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ hourlyRate: 900 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/mhr/{mhr_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'hourlyRate': 900},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/mhr/"+mhrID, strings.NewReader(\`{"hourlyRate":900}\`))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-mhr',
      method: 'DELETE',
      path: '/v1/api/mhr/{id}',
      summary: 'Delete MHR record',
      description: 'Deletes a Machine Hour Rate record. Cannot delete records referenced by active processes.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'MHR UUID', format: 'uuid', example: 'mhr-uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'MHR record deleted', example: { success: true, message: 'MHR record deleted successfully' } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'MHR record not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'MHR record is referenced by active processes' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/mhr/{mhr_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/mhr/\${mhrId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/mhr/{mhr_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/mhr/"+mhrID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
  ],
};
