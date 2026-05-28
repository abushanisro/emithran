import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const lsrGroup: ResourceGroup = {
  id: 'lsr',
  label: 'Labour Standard Rates',
  description: 'Manage Labour Standard Rate (LSR) records. LSR captures the hourly cost for each labour grade including wages, benefits, and overhead contributions.',
  icon: 'ClipboardList',
  endpoints: [
    {
      id: 'list-lsr-records',
      method: 'GET',
      path: '/v1/api/lsr',
      summary: 'List LSR records',
      description: 'Returns all Labour Standard Rate records with pagination and optional search by labour code or grade.',
      parameters: [
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Results per page', default: 20 },
        { name: 'search', in: 'query', type: 'string', required: false, description: 'Search by labour code or description' },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'LSR records retrieved',
          example: {
            success: true,
            data: [
              { id: 'lsr-uuid', labourCode: 'SK-01', description: 'Skilled Operator', hourlyRate: 280, currency: 'INR', effectiveDate: '2025-01-01' },
              { id: 'lsr-uuid-2', labourCode: 'SS-01', description: 'Semi-Skilled Operator', hourlyRate: 180, currency: 'INR', effectiveDate: '2025-01-01' },
            ],
            metadata: { total: 12, page: 1, limit: 20 },
          },
        },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/lsr \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/lsr', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});\nconst { data: lsrRecords } = await response.json();` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/lsr',\n    headers={'Authorization': f'Bearer {token}'},\n)\nlsr_records = response.json()['data']` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/lsr", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-lsr-by-code',
      method: 'GET',
      path: '/v1/api/lsr/code/{labourCode}',
      summary: 'Get LSR by labour code',
      description: 'Returns the LSR record matching a specific labour code. Useful for looking up rates by the code used in process routes.',
      parameters: [
        { name: 'labourCode', in: 'path', type: 'string', required: true, description: 'Labour code (e.g. SK-01)', example: 'SK-01' },
      ],
      responses: [
        { statusCode: 200, description: 'LSR record retrieved', example: { success: true, data: { id: 'lsr-uuid', labourCode: 'SK-01', description: 'Skilled Operator', hourlyRate: 280, currency: 'INR' } } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'No LSR record found for this labour code' },
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/lsr/code/SK-01 \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/lsr/code/SK-01\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    '${BASE_URL}/v1/api/lsr/code/SK-01',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/lsr/code/SK-01", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-lsr',
      method: 'GET',
      path: '/v1/api/lsr/{id}',
      summary: 'Get LSR record',
      description: 'Returns a single LSR record by its UUID.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'LSR UUID', format: 'uuid', example: 'lsr-uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'LSR record retrieved', example: { success: true, data: { id: 'lsr-uuid', labourCode: 'SK-01', description: 'Skilled Operator', hourlyRate: 280, currency: 'INR', effectiveDate: '2025-01-01' } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'LSR record not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/lsr/{lsr_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/lsr/\${lsrId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/lsr/{lsr_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/lsr/"+lsrID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-lsr',
      method: 'POST',
      path: '/v1/api/lsr',
      summary: 'Create LSR record',
      description: 'Creates a new Labour Standard Rate record for a specific labour grade.',
      parameters: [],
      requestBody: {
        description: 'LSR data',
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
        { statusCode: 201, description: 'LSR record created', example: { success: true, data: { id: 'lsr-uuid', labourCode: 'SK-01', hourlyRate: 280 } } },
      ],
      errors: [
        { statusCode: 409, code: 'CONFLICT', description: 'An LSR record with this labour code already exists' },
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/lsr \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"labourCode":"SK-01","description":"Skilled Operator","hourlyRate":280,"currency":"INR"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/lsr', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ labourCode: 'SK-01', description: 'Skilled Operator', hourlyRate: 280, currency: 'INR' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/lsr',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'labourCode': 'SK-01', 'description': 'Skilled Operator', 'hourlyRate': 280, 'currency': 'INR'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"labourCode":"SK-01","description":"Skilled Operator","hourlyRate":280,"currency":"INR"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/lsr", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-lsr',
      method: 'PUT',
      path: '/v1/api/lsr/{id}',
      summary: 'Update LSR record',
      description: 'Updates the hourly rate, description, or other fields of an existing LSR record.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'LSR UUID', format: 'uuid', example: 'lsr-uuid' },
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
        { statusCode: 200, description: 'LSR record updated', example: { success: true, data: { id: 'lsr-uuid', labourCode: 'SK-01', hourlyRate: 300, updatedAt: '2025-05-01T10:00:00Z' } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'LSR record not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/lsr/{lsr_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"hourlyRate":300,"effectiveDate":"2025-04-01"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/lsr/\${lsrId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ hourlyRate: 300, effectiveDate: '2025-04-01' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/lsr/{lsr_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'hourlyRate': 300, 'effectiveDate': '2025-04-01'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"hourlyRate":300,"effectiveDate":"2025-04-01"}\`\nreq, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/lsr/"+lsrID, strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-lsr',
      method: 'DELETE',
      path: '/v1/api/lsr/{id}',
      summary: 'Delete LSR record',
      description: 'Deletes an LSR record. Cannot delete records referenced by active processes.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'LSR UUID', format: 'uuid', example: 'lsr-uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'LSR record deleted', example: { success: true, message: 'LSR record deleted successfully' } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'LSR record not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'LSR record is referenced by active processes' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/lsr/{lsr_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/lsr/\${lsrId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/lsr/{lsr_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/lsr/"+lsrID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'bulk-create-lsr',
      method: 'POST',
      path: '/v1/api/lsr/bulk',
      summary: 'Bulk create LSR records',
      description: 'Creates multiple LSR records in a single request. Existing records (matched by labourCode) are updated; new codes are inserted.',
      parameters: [],
      requestBody: {
        description: 'Array of LSR records',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'records', type: 'array', required: true, description: 'Array of LSR records to create or update' },
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
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/lsr/bulk \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"records":[{"labourCode":"SK-01","description":"Skilled Operator","hourlyRate":280},{"labourCode":"SS-01","description":"Semi-Skilled Operator","hourlyRate":180}]}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/lsr/bulk', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    records: [\n      { labourCode: 'SK-01', description: 'Skilled Operator', hourlyRate: 280 },\n      { labourCode: 'SS-01', description: 'Semi-Skilled Operator', hourlyRate: 180 },\n    ],\n  }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/lsr/bulk',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'records': [\n        {'labourCode': 'SK-01', 'description': 'Skilled Operator', 'hourlyRate': 280},\n        {'labourCode': 'SS-01', 'description': 'Semi-Skilled Operator', 'hourlyRate': 180},\n    ]},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"records":[{"labourCode":"SK-01","description":"Skilled Operator","hourlyRate":280}]}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/lsr/bulk", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
  ],
};
