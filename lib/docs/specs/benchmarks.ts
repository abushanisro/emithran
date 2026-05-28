import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const benchmarksGroup: ResourceGroup = {
  id: 'benchmarks',
  label: 'Benchmarks',
  description: 'Create and manage cost benchmarking sessions to compare target costs against actual supplier quotes.',
  icon: 'GitCompare',
  endpoints: [
    {
      id: 'list-benchmark-sessions',
      method: 'GET',
      path: '/v1/api/benchmark-sessions',
      summary: 'List benchmark sessions',
      description: 'Returns all benchmarking sessions with comparison summary data.',
      parameters: [
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'projectId', in: 'query', type: 'string', required: false, description: 'Filter by project UUID' },
      ],
      responses: [
        { statusCode: 200, description: 'Sessions retrieved', example: { success: true, data: { sessions: [{ id: 'session-uuid', name: 'Q1 2025 Benchmark', projectId: 'proj-uuid', vendorCount: 5 }], total: 12 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/benchmark-sessions \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/benchmark-sessions', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/benchmark-sessions',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/benchmark-sessions", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-benchmark-session',
      method: 'POST',
      path: '/v1/api/benchmark-sessions',
      summary: 'Create a benchmark session',
      description: 'Creates a new benchmarking session linking a project BOM to target cost and vendor comparison data.',
      parameters: [],
      requestBody: {
        description: 'Session data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: true, description: 'Session name', example: 'Q1 2025 Engine Block Benchmark' },
            { name: 'projectId', type: 'string', required: true, description: 'Project UUID', format: 'uuid' },
            { name: 'bomId', type: 'string', required: false, description: 'BOM UUID to benchmark', format: 'uuid' },
            { name: 'targetCostPerUnit', type: 'number', required: false, description: 'Internal target cost per unit', example: 350.00 },
          ],
        },
        example: { name: 'Q1 2025 Engine Block Benchmark', projectId: 'proj-uuid', targetCostPerUnit: 350.00 },
      },
      responses: [
        { statusCode: 201, description: 'Session created', example: { success: true, data: { id: 'session-uuid', name: 'Q1 2025 Engine Block Benchmark', status: 'open' } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Project or BOM not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/benchmark-sessions \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Q1 2025 Benchmark","projectId":"proj-uuid","targetCostPerUnit":350.00}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/benchmark-sessions', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ name: 'Q1 2025 Benchmark', projectId: 'proj-uuid', targetCostPerUnit: 350.00 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/benchmark-sessions',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'name': 'Q1 2025 Benchmark', 'projectId': 'proj-uuid', 'targetCostPerUnit': 350.00},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"name":"Q1 2025 Benchmark","projectId":"proj-uuid","targetCostPerUnit":350.00}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/benchmark-sessions", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-benchmark-session',
      method: 'GET',
      path: '/v1/api/benchmark-sessions/{id}',
      summary: 'Retrieve a benchmark session',
      description: 'Returns a benchmark session with all vendor quotes, variance analysis, and comparison results.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Session UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Session retrieved', example: { success: true, data: { id: 'session-uuid', name: 'Q1 2025 Engine Block Benchmark', targetCostPerUnit: 350.00, vendorQuotes: [{ vendor: 'Acme Co.', quotedPrice: 380.00, variance: 8.57 }] } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Session not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/benchmark-sessions/{session_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/benchmark-sessions/\${sessionId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/benchmark-sessions/{session_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/benchmark-sessions/"+sessionID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'add-benchmark-result',
      method: 'POST',
      path: '/v1/api/benchmark-sessions/{id}/results',
      summary: 'Add vendor quote to benchmark',
      description: 'Adds a vendor quote to a benchmarking session. The system automatically calculates variance against the target cost.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Session UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Vendor quote',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'vendorId', type: 'string', required: true, description: 'Vendor UUID', format: 'uuid' },
            { name: 'quotedPricePerUnit', type: 'number', required: true, description: 'Vendor quoted price per unit', example: 380.00 },
            { name: 'leadTimeDays', type: 'integer', required: false, description: 'Vendor quoted lead time in days', example: 30 },
            { name: 'moq', type: 'integer', required: false, description: 'Minimum order quantity', example: 100 },
            { name: 'notes', type: 'string', required: false, description: 'Additional notes' },
          ],
        },
        example: { vendorId: 'vendor-uuid', quotedPricePerUnit: 380.00, leadTimeDays: 30, moq: 100 },
      },
      responses: [
        { statusCode: 201, description: 'Quote added', example: { success: true, data: { id: 'result-uuid', vendorName: 'Acme Machining Co.', quotedPricePerUnit: 380.00, variancePercent: 8.57 } } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Session or vendor not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Quote already exists for this vendor in this session' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/benchmark-sessions/{session_id}/results \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"vendorId":"vendor-uuid","quotedPricePerUnit":380.00,"leadTimeDays":30,"moq":100}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/benchmark-sessions/\${sessionId}/results\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ vendorId: 'vendor-uuid', quotedPricePerUnit: 380.00, leadTimeDays: 30, moq: 100 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/benchmark-sessions/{session_id}/results',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'vendorId': 'vendor-uuid', 'quotedPricePerUnit': 380.00, 'leadTimeDays': 30, 'moq': 100},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"vendorId":"vendor-uuid","quotedPricePerUnit":380.00,"leadTimeDays":30,"moq":100}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/benchmark-sessions/"+sessionID+"/results", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-benchmark-session',
      method: 'PUT',
      path: '/v1/api/benchmark-sessions/{id}',
      summary: 'Update a benchmark session',
      description: 'Updates session name, target cost, or status.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Session UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: false, description: 'Session name' },
            { name: 'targetCostPerUnit', type: 'number', required: false, description: 'Updated target cost per unit' },
            { name: 'status', type: 'string', required: false, description: 'Session status', enum: ['open', 'closed'] },
          ],
        },
        example: { targetCostPerUnit: 340.00, status: 'closed' },
      },
      responses: [
        { statusCode: 200, description: 'Session updated', example: { success: true, data: { id: 'session-uuid', targetCostPerUnit: 340.00, status: 'closed' } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Session not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/benchmark-sessions/{session_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"targetCostPerUnit":340.00,"status":"closed"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/benchmark-sessions/\${sessionId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ targetCostPerUnit: 340.00, status: 'closed' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/benchmark-sessions/{session_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'targetCostPerUnit': 340.00, 'status': 'closed'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"targetCostPerUnit":340.00,"status":"closed"}\`\nreq, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/benchmark-sessions/"+sessionID, strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
  ],
};
