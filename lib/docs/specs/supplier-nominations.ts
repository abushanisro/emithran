import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const supplierNominationsGroup: ResourceGroup = {
  id: 'supplier-nominations',
  label: 'Supplier Nominations',
  description: 'Run structured supplier nomination processes with multi-criteria evaluation, factor weights, and ranking calculations.',
  icon: 'Award',
  endpoints: [
    {
      id: 'list-nominations',
      method: 'GET',
      path: '/v1/api/supplier-nominations/project/{projectId}',
      summary: 'List supplier nominations',
      description: 'Returns all supplier nominations for a project, optionally filtered by status.',
      parameters: [
        { name: 'projectId', in: 'path', type: 'string', required: true, description: 'Project UUID', format: 'uuid' },
        { name: 'status', in: 'query', type: 'string', required: false, description: 'Filter by nomination status' },
      ],
      responses: [
        { statusCode: 200, description: 'Nominations retrieved', example: { success: true, data: { nominations: [{ id: 'nom-uuid', partName: 'Cylinder Block', projectId: 'proj-uuid', status: 'in_progress', vendorCount: 4 }] } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Project not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/supplier-nominations/project/{project_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/supplier-nominations/project/\${projectId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    f'${BASE_URL}/v1/api/supplier-nominations/project/{project_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/supplier-nominations/project/"+projectID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-nomination',
      method: 'POST',
      path: '/v1/api/supplier-nominations',
      summary: 'Create a supplier nomination',
      description: 'Creates a new supplier nomination process for a part, with optional evaluation criteria.',
      parameters: [],
      requestBody: {
        description: 'Nomination data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'projectId', type: 'string', required: true, description: 'Project UUID', format: 'uuid' },
            { name: 'partName', type: 'string', required: true, description: 'Name of the part being nominated for', example: 'Cylinder Block' },
            { name: 'bomItemId', type: 'string', required: false, description: 'BOM item UUID', format: 'uuid' },
            { name: 'evaluationCriteria', type: 'array', required: false, description: 'List of evaluation criteria names', example: ['price', 'quality', 'lead_time', 'capacity'] },
          ],
        },
        example: { projectId: 'proj-uuid', partName: 'Cylinder Block', bomItemId: 'item-uuid', evaluationCriteria: ['price', 'quality', 'lead_time'] },
      },
      responses: [
        { statusCode: 201, description: 'Nomination created', example: { success: true, data: { id: 'nom-uuid', partName: 'Cylinder Block', projectId: 'proj-uuid', status: 'in_progress', vendorCount: 0 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Project or BOM item not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/supplier-nominations \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"projectId":"proj-uuid","partName":"Cylinder Block","evaluationCriteria":["price","quality","lead_time"]}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/supplier-nominations', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ projectId: 'proj-uuid', partName: 'Cylinder Block', evaluationCriteria: ['price', 'quality', 'lead_time'] }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/supplier-nominations',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'projectId': 'proj-uuid', 'partName': 'Cylinder Block', 'evaluationCriteria': ['price', 'quality', 'lead_time']},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"projectId":"proj-uuid","partName":"Cylinder Block","evaluationCriteria":["price","quality","lead_time"]}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/supplier-nominations", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-nomination',
      method: 'GET',
      path: '/v1/api/supplier-nominations/{id}',
      summary: 'Retrieve a nomination',
      description: 'Returns full details for a supplier nomination including vendors and evaluation status.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Nomination UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Nomination retrieved', example: { success: true, data: { id: 'nom-uuid', partName: 'Cylinder Block', projectId: 'proj-uuid', status: 'in_progress', vendorCount: 4 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Nomination not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/supplier-nominations/{nomination_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/supplier-nominations/\${nominationId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/supplier-nominations/{nomination_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/supplier-nominations/"+nominationID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-nomination',
      method: 'PUT',
      path: '/v1/api/supplier-nominations/{id}',
      summary: 'Update a nomination',
      description: 'Updates the details or criteria of a supplier nomination.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Nomination UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'partName', type: 'string', required: false, description: 'Updated part name' },
            { name: 'evaluationCriteria', type: 'array', required: false, description: 'Updated evaluation criteria' },
          ],
        },
        example: { partName: 'Cylinder Block Rev2', evaluationCriteria: ['price', 'quality', 'lead_time', 'capacity'] },
      },
      responses: [
        { statusCode: 200, description: 'Nomination updated', example: { success: true, data: { id: 'nom-uuid', partName: 'Cylinder Block Rev2', status: 'in_progress' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Nomination not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/supplier-nominations/{nomination_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"partName":"Cylinder Block Rev2"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/supplier-nominations/\${nominationId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ partName: 'Cylinder Block Rev2' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/supplier-nominations/{nomination_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'partName': 'Cylinder Block Rev2'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"partName":"Cylinder Block Rev2"}\`\nreq, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/supplier-nominations/"+nominationID, strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-nomination',
      method: 'DELETE',
      path: '/v1/api/supplier-nominations/{id}',
      summary: 'Delete a nomination',
      description: 'Permanently deletes a supplier nomination and all associated vendor evaluations.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Nomination UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Nomination deleted', example: { success: true, message: 'Supplier nomination deleted successfully' } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Nomination not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/supplier-nominations/{nomination_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/supplier-nominations/\${nominationId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/supplier-nominations/{nomination_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/supplier-nominations/"+nominationID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'complete-nomination',
      method: 'POST',
      path: '/v1/api/supplier-nominations/{id}/complete',
      summary: 'Complete a nomination',
      description: 'Finalizes the supplier nomination process, locking in the vendor selection.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Nomination UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Nomination completed', example: { success: true, data: { id: 'nom-uuid', status: 'completed', completedAt: '2025-03-20T14:00:00Z' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Nomination not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Nomination cannot be completed in its current state' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/supplier-nominations/{nomination_id}/complete \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/supplier-nominations/\${nominationId}/complete\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/supplier-nominations/{nomination_id}/complete',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/supplier-nominations/"+nominationID+"/complete", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'add-vendors-to-nomination',
      method: 'POST',
      path: '/v1/api/supplier-nominations/{id}/vendors',
      summary: 'Add vendors to nomination',
      description: 'Adds one or more vendors to the nomination process for evaluation.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Nomination UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Vendors to add',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'vendorIds', type: 'array', required: true, description: 'Array of vendor UUIDs to add', example: ['vendor-uuid-1', 'vendor-uuid-2'] },
          ],
        },
        example: { vendorIds: ['vendor-uuid-1', 'vendor-uuid-2', 'vendor-uuid-3'] },
      },
      responses: [
        { statusCode: 200, description: 'Vendors added', example: { success: true, data: { nominationId: 'nom-uuid', vendorsAdded: 3, vendorCount: 4 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Nomination or vendor not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/supplier-nominations/{nomination_id}/vendors \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"vendorIds":["vendor-uuid-1","vendor-uuid-2"]}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/supplier-nominations/\${nominationId}/vendors\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ vendorIds: ['vendor-uuid-1', 'vendor-uuid-2'] }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/supplier-nominations/{nomination_id}/vendors',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'vendorIds': ['vendor-uuid-1', 'vendor-uuid-2']},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"vendorIds":["vendor-uuid-1","vendor-uuid-2"]}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/supplier-nominations/"+nominationID+"/vendors", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-factor-weights',
      method: 'GET',
      path: '/v1/api/supplier-nominations/{nominationId}/factor-weights',
      summary: 'Get factor weights',
      description: 'Returns the current factor weight configuration for the nomination\'s ranking algorithm.',
      parameters: [
        { name: 'nominationId', in: 'path', type: 'string', required: true, description: 'Nomination UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Factor weights retrieved', example: { success: true, data: { weights: { price: 40, quality: 30, lead_time: 20, capacity: 10 } } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Nomination not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/supplier-nominations/{nomination_id}/factor-weights \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/supplier-nominations/\${nominationId}/factor-weights\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/supplier-nominations/{nomination_id}/factor-weights',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/supplier-nominations/"+nominationID+"/factor-weights", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-factor-weights',
      method: 'PUT',
      path: '/v1/api/supplier-nominations/{nominationId}/factor-weights',
      summary: 'Update factor weights',
      description: 'Updates the weight assigned to each evaluation factor. Weights must sum to 100.',
      parameters: [
        { name: 'nominationId', in: 'path', type: 'string', required: true, description: 'Nomination UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Factor weight configuration',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'weights', type: 'object', required: true, description: 'Mapping of factor name to weight (0-100). Weights should sum to 100.', example: { price: 40, quality: 30, lead_time: 20, capacity: 10 } },
          ],
        },
        example: { weights: { price: 40, quality: 30, lead_time: 20, capacity: 10 } },
      },
      responses: [
        { statusCode: 200, description: 'Factor weights updated', example: { success: true, data: { weights: { price: 40, quality: 30, lead_time: 20, capacity: 10 } } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Nomination not found' },
        { statusCode: 422, code: 'VALIDATION_ERROR', description: 'Weights do not sum to 100' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/supplier-nominations/{nomination_id}/factor-weights \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"weights":{"price":40,"quality":30,"lead_time":20,"capacity":10}}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/supplier-nominations/\${nominationId}/factor-weights\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ weights: { price: 40, quality: 30, lead_time: 20, capacity: 10 } }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/supplier-nominations/{nomination_id}/factor-weights',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'weights': {'price': 40, 'quality': 30, 'lead_time': 20, 'capacity': 10}},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"weights":{"price":40,"quality":30,"lead_time":20,"capacity":10}}\`\nreq, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/supplier-nominations/"+nominationID+"/factor-weights", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'calculate-rankings',
      method: 'POST',
      path: '/v1/api/supplier-nominations/{nominationId}/calculate-rankings',
      summary: 'Calculate vendor rankings',
      description: 'Runs the weighted ranking algorithm across all vendors in the nomination and returns an ordered ranking list.',
      parameters: [
        { name: 'nominationId', in: 'path', type: 'string', required: true, description: 'Nomination UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Rankings calculated', example: { success: true, data: { rankings: [{ rank: 1, vendorId: 'vendor-uuid', vendorName: 'Acme Co.', totalScore: 87.5 }, { rank: 2, vendorId: 'vendor-uuid-2', vendorName: 'Beta Machining', totalScore: 82.1 }] } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Nomination not found' },
        { statusCode: 422, code: 'UNPROCESSABLE', description: 'Insufficient data to calculate rankings' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/supplier-nominations/{nomination_id}/calculate-rankings \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/supplier-nominations/\${nominationId}/calculate-rankings\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/supplier-nominations/{nomination_id}/calculate-rankings',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/supplier-nominations/"+nominationID+"/calculate-rankings", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
  ],
};
