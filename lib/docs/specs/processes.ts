import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const processesGroup: ResourceGroup = {
  id: 'processes',
  label: 'Processes',
  description: 'Define and manage manufacturing processes. Each process captures cycle time, machine hour rates, and labor costs.',
  icon: 'Settings',
  endpoints: [
    {
      id: 'list-processes',
      method: 'GET',
      path: '/v1/api/processes',
      summary: 'List processes',
      description: 'Returns all manufacturing processes in the process library.',
      parameters: [
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'search', in: 'query', type: 'string', required: false, description: 'Search by process name' },
        { name: 'type', in: 'query', type: 'string', required: false, description: 'Filter by process type' },
      ],
      responses: [
        { statusCode: 200, description: 'Processes retrieved', example: { success: true, data: { processes: [{ id: 'proc-uuid', name: 'CNC Turning', type: 'machining', cycleTimeSeconds: 180 }], total: 35 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/processes \\\n  -H "Authorization: Bearer {token}" \\\n  -d "type=machining"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/processes?type=machining\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/processes',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'type': 'machining'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/processes?type=machining", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-process',
      method: 'POST',
      path: '/v1/api/processes',
      summary: 'Create a process',
      description: 'Adds a new manufacturing process to the process library with cycle time and machine assignment.',
      parameters: [],
      requestBody: {
        description: 'Process definition',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: true, description: 'Process name', example: 'CNC Turning' },
            { name: 'type', type: 'string', required: true, description: 'Process type', example: 'machining' },
            { name: 'cycleTimeSeconds', type: 'number', required: true, description: 'Cycle time per unit in seconds', example: 180 },
            { name: 'mhrId', type: 'string', required: false, description: 'Default Machine Hour Rate UUID', format: 'uuid' },
            { name: 'lhrId', type: 'string', required: false, description: 'Default Labour Hour Rate UUID', format: 'uuid' },
            { name: 'description', type: 'string', required: false, description: 'Process description' },
          ],
        },
        example: { name: 'CNC Turning', type: 'machining', cycleTimeSeconds: 180 },
      },
      responses: [
        { statusCode: 201, description: 'Process created', example: { success: true, data: { id: 'proc-uuid', name: 'CNC Turning', type: 'machining', cycleTimeSeconds: 180 } } },
      ],
      errors: [{ statusCode: 409, code: 'CONFLICT', description: 'Process with this name already exists' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/processes \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"CNC Turning","type":"machining","cycleTimeSeconds":180}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/processes', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ name: 'CNC Turning', type: 'machining', cycleTimeSeconds: 180 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/processes',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'name': 'CNC Turning', 'type': 'machining', 'cycleTimeSeconds': 180},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"name":"CNC Turning","type":"machining","cycleTimeSeconds":180}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/processes", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-process',
      method: 'GET',
      path: '/v1/api/processes/{id}',
      summary: 'Retrieve a process',
      description: 'Returns full process details including assigned MHR, LHR, and historical cost data.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Process UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Process retrieved', example: { success: true, data: { id: 'proc-uuid', name: 'CNC Turning', type: 'machining', cycleTimeSeconds: 180, mhr: { machineName: 'CNC Lathe', hourlyRate: 850 } } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Process not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/processes/{process_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/processes/\${processId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/processes/{process_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/processes/"+processID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-process',
      method: 'PATCH',
      path: '/v1/api/processes/{id}',
      summary: 'Update a process',
      description: 'Updates cycle time, assigned rates, or other process parameters.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Process UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'cycleTimeSeconds', type: 'number', required: false, description: 'Updated cycle time in seconds', example: 200 },
            { name: 'mhrId', type: 'string', required: false, description: 'Updated MHR UUID', format: 'uuid' },
            { name: 'lhrId', type: 'string', required: false, description: 'Updated LHR UUID', format: 'uuid' },
          ],
        },
        example: { cycleTimeSeconds: 200 },
      },
      responses: [
        { statusCode: 200, description: 'Process updated', example: { success: true, data: { id: 'proc-uuid', cycleTimeSeconds: 200 } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Process not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PATCH ${BASE_URL}/v1/api/processes/{process_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"cycleTimeSeconds":200}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/processes/\${processId}\`, {\n  method: 'PATCH',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ cycleTimeSeconds: 200 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.patch(\n    f'${BASE_URL}/v1/api/processes/{process_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'cycleTimeSeconds': 200},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("PATCH", "${BASE_URL}/v1/api/processes/"+processID, strings.NewReader(\`{"cycleTimeSeconds":200}\`))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-process',
      method: 'DELETE',
      path: '/v1/api/processes/{id}',
      summary: 'Delete a process',
      description: 'Removes a process from the process library.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Process UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Process deleted', example: { success: true, message: 'Process deleted successfully' } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Process not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Process is in use by active process routes' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/processes/{process_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/processes/\${processId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/processes/{process_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/processes/"+processID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'calculate-process-cost',
      method: 'POST',
      path: '/v1/api/processes/{id}/cost',
      summary: 'Calculate process cost',
      description: 'Calculates the manufacturing cost for a specific process based on cycle time, machine hour rate (MHR), and labor rate (LHR).',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Process UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Cost calculation parameters',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'quantity', type: 'integer', required: true, description: 'Number of parts', example: 1000 },
            { name: 'cycleTimeOverride', type: 'number', required: false, description: 'Override cycle time in seconds' },
            { name: 'mhrId', type: 'string', required: false, description: 'Override Machine Hour Rate UUID' },
            { name: 'lhrId', type: 'string', required: false, description: 'Override Labour Hour Rate UUID' },
          ],
        },
        example: { quantity: 1000 },
      },
      responses: [
        { statusCode: 200, description: 'Cost calculated', example: { success: true, data: { processCostPerUnit: 12.45, machineCost: 8.20, laborCost: 4.25, totalCost: 12450 } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Process not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/processes/{process_id}/cost \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"quantity":1000}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/processes/\${processId}/cost\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ quantity: 1000 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/processes/{process_id}/cost',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'quantity': 1000},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/processes/"+id+"/cost", strings.NewReader(\`{"quantity":1000}\`))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
  ],
};
