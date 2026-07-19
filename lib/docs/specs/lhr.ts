import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const lhrGroup: ResourceGroup = {
  id: 'lhr',
  label: 'Labour Hour Rates',
  description: 'Manage Labour Hour Rate (LHR) records. LHR captures the hourly cost for each labour grade including wages, benefits, and overhead contributions.',
  icon: 'ClipboardList',
  endpoints: [
    {
      id: 'list-lhr-records',
      method: 'GET',
      path: '/v1/api/lhr',
      summary: 'List LHR records',
      description: 'Returns all Labour Hour Rate records with pagination and optional search by labour code or grade.',
      parameters: [
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Results per page', default: 20 },
        { name: 'search', in: 'query', type: 'string', required: false, description: 'Search by labour code or description' },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'LHR records retrieved',
          example: {
            success: true,
            data: [
              { id: 'lhr-uuid', labourCode: 'SK-01', description: 'Skilled Operator', hourlyRate: 280, currency: 'INR', effectiveDate: '2025-01-01' },
              { id: 'lhr-uuid-2', labourCode: 'SS-01', description: 'Semi-Skilled Operator', hourlyRate: 180, currency: 'INR', effectiveDate: '2025-01-01' },
            ],
            metadata: { total: 12, page: 1, limit: 20 },
          },
        },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/lhr \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/lhr', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});\nconst { data: lhrRecords } = await response.json();` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/lhr',\n    headers={'Authorization': f'Bearer {token}'},\n)\nlhr_records = response.json()['data']` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/lhr", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-lhr-by-code',
      method: 'GET',
      path: '/v1/api/lhr/code/{labourCode}',
      summary: 'Get LHR by labour code',
      description: 'Returns the LHR record matching a specific labour code. Useful for looking up rates by the code used in process routes.',
      parameters: [
        { name: 'labourCode', in: 'path', type: 'string', required: true, description: 'Labour code (e.g. SK-01)', example: 'SK-01' },
      ],
      responses: [
        { statusCode: 200, description: 'LHR record retrieved', example: { success: true, data: { id: 'lhr-uuid', labourCode: 'SK-01', description: 'Skilled Operator', hourlyRate: 280, currency: 'INR' } } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'No LHR record found for this labour code' },
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/lhr/code/SK-01 \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/lhr/code/SK-01\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    '${BASE_URL}/v1/api/lhr/code/SK-01',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/lhr/code/SK-01", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-lhr',
      method: 'GET',
      path: '/v1/api/lhr/{id}',
      summary: 'Get LHR record',
      description: 'Returns a single LHR record by its UUID.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'LHR UUID', format: 'uuid', example: 'lhr-uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'LHR record retrieved', example: { success: true, data: { id: 'lhr-uuid', labourCode: 'SK-01', description: 'Skilled Operator', hourlyRate: 280, currency: 'INR', effectiveDate: '2025-01-01' } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'LHR record not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/lhr/{lhr_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/lhr/\${lhrId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/lhr/{lhr_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/lhr/"+lhrId, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-lhr',
      method: 'POST',
      path: '/v1/api/lhr',
      summary: 'Create LHR record',
      description: 'Creates a new Labour Hour Rate record for a specific labour grade.',
      parameters: [],
      requestBody: {
        description: 'LHR data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'labourCode', type: 'string', required: true, description: 'Unique labour code', example: 'SK-01' },
            { name: 'description', type: 'string', required: true, description: 'Labour grade description', example: 'Skilled Operator' },
            { name: 'hourlyRate', type: 'number', required: true, description: 'Hourly labour rate', example: 280 },
            { name: 'currency', type: 'string', required: false, description: 'Currency code', default: 'INR', example: 'INR' },
            { name: 'effectiveDate', type: 'string', required: false, description: 'Rate effective date (ISO 8601)', format: 'date', example: '2025-01-01' },
            { name: 'overheadRate', type: 'number', required: false, description: 'Overhead burden rate %', example: 25 },
          ],
        },
        example: { labourCode: 'SK-01', description: 'Skilled Operator', hourlyRate: 280, currency: 'INR', effectiveDate: '2025-01-01' },
      },
      responses: [
        { statusCode: 201, description: 'LHR record created', example: { success: true, data: { id: 'lhr-uuid', labourCode: 'SK-01', hourlyRate: 280 } } },
      ],
      errors: [
        { statusCode: 409, code: 'CONFLICT', description: 'An LHR record with this labour code already exists' },
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/lhr \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"labourCode":"SK-01","description":"Skilled Operator","hourlyRate":280,"currency":"INR"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/lhr', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ labourCode: 'SK-01', description: 'Skilled Operator', hourlyRate: 280, currency: 'INR' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/lhr',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'labourCode': 'SK-01', 'description': 'Skilled Operator', 'hourlyRate': 280, 'currency': 'INR'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"labourCode":"SK-01","description":"Skilled Operator","hourlyRate":280,"currency":"INR"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/lhr", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-lhr',
      method: 'PUT',
      path: '/v1/api/lhr/{id}',
      summary: 'Update LHR record',
      description: 'Updates the hourly rate, description, or other fields of an existing LHR record.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'LHR UUID', format: 'uuid', example: 'lhr-uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'hourlyRate', type: 'number', required: false, description: 'Updated hourly rate', example: 300 },
            { name: 'description', type: 'string', required: false, description: 'Updated description' },
            { name: 'effectiveDate', type: 'string', required: false, description: 'New effective date', format: 'date' },
          ],
        },
        example: { hourlyRate: 300, effectiveDate: '2025-04-01' },
      },
      responses: [
        { statusCode: 200, description: 'LHR record updated', example: { success: true, data: { id: 'lhr-uuid', labourCode: 'SK-01', hourlyRate: 300, updatedAt: '2025-05-01T10:00:00Z' } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'LHR record not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/lhr/{lhr_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"hourlyRate":300,"effectiveDate":"2025-04-01"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/lhr/\${lhrId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ hourlyRate: 300, effectiveDate: '2025-04-01' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/lhr/{lhr_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'hourlyRate': 300, 'effectiveDate': '2025-04-01'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"hourlyRate":300,"effectiveDate":"2025-04-01"}\`\nreq, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/lhr/"+lhrId, strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-lhr',
      method: 'DELETE',
      path: '/v1/api/lhr/{id}',
      summary: 'Delete LHR record',
      description: 'Deletes an LHR record. Cannot delete records referenced by active processes.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'LHR UUID', format: 'uuid', example: 'lhr-uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'LHR record deleted', example: { success: true, message: 'LHR record deleted successfully' } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'LHR record not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'LHR record is referenced by active processes' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/lhr/{lhr_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/lhr/\${lhrId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/lhr/{lhr_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/lhr/"+lhrId, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'bulk-create-lhr',
      method: 'POST',
      path: '/v1/api/lhr/bulk',
      summary: 'Bulk create LHR records',
      description: 'Creates multiple LHR records in a single request. Existing records (matched by labourCode) are updated; new codes are inserted.',
      parameters: [],
      requestBody: {
        description: 'Array of LHR records',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'records', type: 'array', required: true, description: 'Array of LHR records to create or update' },
          ],
        },
        example: {
          records: [
            { labourCode: 'SK-01', description: 'Skilled Operator', hourlyRate: 280 },
            { labourCode: 'SS-01', description: 'Semi-Skilled Operator', hourlyRate: 180 },
          ],
        },
      },
      responses: [
        { statusCode: 200, description: 'Bulk operation complete', example: { success: true, data: { created: 2, updated: 0, errors: [] } } },
      ],
      errors: [
        { statusCode: 400, code: 'VALIDATION_ERROR', description: 'One or more records have invalid data' },
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/lhr/bulk \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"records":[{"labourCode":"SK-01","description":"Skilled Operator","hourlyRate":280},{"labourCode":"SS-01","description":"Semi-Skilled Operator","hourlyRate":180}]}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/lhr/bulk', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    records: [\n      { labourCode: 'SK-01', description: 'Skilled Operator', hourlyRate: 280 },\n      { labourCode: 'SS-01', description: 'Semi-Skilled Operator', hourlyRate: 180 },\n    ],\n  }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/lhr/bulk',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'records': [\n        {'labourCode': 'SK-01', 'description': 'Skilled Operator', 'hourlyRate': 280},\n        {'labourCode': 'SS-01', 'description': 'Semi-Skilled Operator', 'hourlyRate': 180},\n    ]},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"records":[{"labourCode":"SK-01","description":"Skilled Operator","hourlyRate":280}]}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/lhr/bulk", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
  ],
};
