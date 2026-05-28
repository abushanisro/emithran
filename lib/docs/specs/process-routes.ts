import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const processRoutesGroup: ResourceGroup = {
  id: 'process-routes',
  label: 'Process Routes',
  description: 'Define and manage manufacturing process routes. Routes link BOM items to ordered sequences of processes with approval workflows.',
  icon: 'GitMerge',
  endpoints: [
    {
      id: 'list-process-routes',
      method: 'GET',
      path: '/v1/api/process-routes',
      summary: 'List process routes',
      description: 'Returns all process routes with pagination and optional filtering.',
      parameters: [
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Results per page', default: 20 },
        { name: 'status', in: 'query', type: 'string', required: false, description: 'Filter by workflow status', enum: ['draft', 'under_review', 'approved', 'active', 'archived'] },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'Process routes retrieved',
          example: {
            success: true,
            data: [
              { id: 'route-uuid', name: 'Cylinder Block Machining Route v2', status: 'active', stepCount: 6, bomItemId: 'item-uuid' },
            ],
            metadata: { total: 12, page: 1, limit: 20 },
          },
        },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/process-routes \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/process-routes', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/process-routes',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/process-routes", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-process-route',
      method: 'POST',
      path: '/v1/api/process-routes',
      summary: 'Create process route',
      description: 'Creates a new process route definition. Routes start in draft status and must be submitted for review before activation.',
      parameters: [],
      requestBody: {
        description: 'Process route data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: true, description: 'Route name', example: 'Cylinder Block Machining Route v2' },
            { name: 'bomItemId', type: 'string', required: false, description: 'BOM item this route applies to', format: 'uuid' },
            { name: 'description', type: 'string', required: false, description: 'Route description' },
          ],
        },
        example: { name: 'Cylinder Block Machining Route v2', bomItemId: 'item-uuid' },
      },
      responses: [
        { statusCode: 201, description: 'Route created', example: { success: true, data: { id: 'route-uuid', name: 'Cylinder Block Machining Route v2', status: 'draft', stepCount: 0 } } },
      ],
      errors: [
        { statusCode: 400, code: 'VALIDATION_ERROR', description: 'Missing required fields' },
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/process-routes \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Cylinder Block Machining Route v2","bomItemId":"item-uuid"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/process-routes', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ name: 'Cylinder Block Machining Route v2', bomItemId: 'item-uuid' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/process-routes',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'name': 'Cylinder Block Machining Route v2', 'bomItemId': 'item-uuid'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"name":"Cylinder Block Machining Route v2","bomItemId":"item-uuid"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/process-routes", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-process-route',
      method: 'PUT',
      path: '/v1/api/process-routes/{id}',
      summary: 'Update process route',
      description: 'Updates the name or description of a process route. Only allowed in draft status.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Route UUID', format: 'uuid', example: 'route-uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: false, description: 'Updated route name' },
            { name: 'description', type: 'string', required: false, description: 'Updated description' },
          ],
        },
        example: { name: 'Cylinder Block Machining Route v3' },
      },
      responses: [
        { statusCode: 200, description: 'Route updated', example: { success: true, data: { id: 'route-uuid', name: 'Cylinder Block Machining Route v3', status: 'draft' } } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Route not found' },
        { statusCode: 422, code: 'INVALID_STATE', description: 'Cannot edit a route that is not in draft status' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/process-routes/{route_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Cylinder Block Machining Route v3"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/process-routes/\${routeId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ name: 'Cylinder Block Machining Route v3' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/process-routes/{route_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'name': 'Cylinder Block Machining Route v3'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/process-routes/"+routeID, strings.NewReader(\`{"name":"Cylinder Block Machining Route v3"}\`))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-process-route',
      method: 'DELETE',
      path: '/v1/api/process-routes/{id}',
      summary: 'Delete process route',
      description: 'Deletes a process route. Only allowed for draft routes.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Route UUID', format: 'uuid' },
      ],
      responses: [{ statusCode: 200, description: 'Route deleted', example: { success: true, message: 'Process route deleted' } }],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Route not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Cannot delete active or approved routes' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/process-routes/{route_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/process-routes/\${routeId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/process-routes/{route_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/process-routes/"+routeID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'submit-route-for-review',
      method: 'POST',
      path: '/v1/api/process-routes/{id}/workflow/submit-for-review',
      summary: 'Submit route for review',
      description: 'Transitions a draft process route to "under_review" status, triggering the approval workflow.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Route UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Route submitted for review', example: { success: true, data: { id: 'route-uuid', status: 'under_review', submittedAt: '2025-02-01T09:00:00Z' } } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Route not found' },
        { statusCode: 422, code: 'INVALID_TRANSITION', description: 'Route must be in draft status to submit' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/process-routes/{route_id}/workflow/submit-for-review \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/process-routes/\${routeId}/workflow/submit-for-review\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/process-routes/{route_id}/workflow/submit-for-review',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/process-routes/"+routeID+"/workflow/submit-for-review", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'approve-route',
      method: 'POST',
      path: '/v1/api/process-routes/{id}/workflow/approve',
      summary: 'Approve process route',
      description: 'Approves a process route that is under review.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Route UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Approval data',
        required: false,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'comments', type: 'string', required: false, description: 'Approver comments' },
          ],
        },
        example: { comments: 'Route verified and approved for production.' },
      },
      responses: [
        { statusCode: 200, description: 'Route approved', example: { success: true, data: { id: 'route-uuid', status: 'approved', approvedAt: '2025-02-02T10:00:00Z' } } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Route not found' },
        { statusCode: 422, code: 'INVALID_TRANSITION', description: 'Route must be under review to approve' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/process-routes/{route_id}/workflow/approve \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"comments":"Route verified and approved."}'` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/process-routes/\${routeId}/workflow/approve\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ comments: 'Route verified and approved.' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/process-routes/{route_id}/workflow/approve',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'comments': 'Route verified and approved.'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/process-routes/"+routeID+"/workflow/approve", strings.NewReader(\`{"comments":"Route verified."}\`))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'reject-route',
      method: 'POST',
      path: '/v1/api/process-routes/{id}/workflow/reject',
      summary: 'Reject process route',
      description: 'Rejects a process route and returns it to draft for rework.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Route UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Rejection reason',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'reason', type: 'string', required: true, description: 'Reason for rejection', example: 'Missing surface grinding step — add before heat treatment.' },
          ],
        },
        example: { reason: 'Missing surface grinding step — add before heat treatment.' },
      },
      responses: [
        { statusCode: 200, description: 'Route rejected', example: { success: true, data: { id: 'route-uuid', status: 'draft', rejectedAt: '2025-02-02T10:00:00Z' } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Route not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/process-routes/{route_id}/workflow/reject \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"reason":"Missing surface grinding step."}'` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/process-routes/\${routeId}/workflow/reject\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ reason: 'Missing surface grinding step.' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/process-routes/{route_id}/workflow/reject',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'reason': 'Missing surface grinding step.'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/process-routes/"+routeID+"/workflow/reject", strings.NewReader(\`{"reason":"Missing step."}\`))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-workflow-history',
      method: 'GET',
      path: '/v1/api/process-routes/{id}/workflow/history',
      summary: 'Get workflow history',
      description: 'Returns the complete audit trail of workflow state changes for a process route.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Route UUID', format: 'uuid' },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'Workflow history retrieved',
          example: {
            success: true,
            data: {
              events: [
                { action: 'created', actor: 'engineer@company.com', timestamp: '2025-01-28T09:00:00Z' },
                { action: 'submitted_for_review', actor: 'engineer@company.com', timestamp: '2025-02-01T09:00:00Z' },
                { action: 'approved', actor: 'manager@company.com', timestamp: '2025-02-02T10:00:00Z', comments: 'Route verified.' },
              ],
            },
          },
        },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Route not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/process-routes/{route_id}/workflow/history \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/process-routes/\${routeId}/workflow/history\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/process-routes/{route_id}/workflow/history',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/process-routes/"+routeID+"/workflow/history", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'list-route-steps',
      method: 'GET',
      path: '/v1/api/process-routes/{id}/steps',
      summary: 'List route steps',
      description: 'Returns all process steps in a route, ordered by step sequence.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Route UUID', format: 'uuid' },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'Steps retrieved',
          example: {
            success: true,
            data: [
              { id: 'step-uuid', stepOrder: 1, processId: 'proc-uuid', processName: 'CNC Turning', cycleTimeSeconds: 180, cost: 42.15 },
              { id: 'step-uuid-2', stepOrder: 2, processId: 'proc-uuid-2', processName: 'Surface Grinding', cycleTimeSeconds: 90, cost: 21.08 },
            ],
          },
        },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Route not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/process-routes/{route_id}/steps \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/process-routes/\${routeId}/steps\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/process-routes/{route_id}/steps',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/process-routes/"+routeID+"/steps", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-route-step',
      method: 'POST',
      path: '/v1/api/process-routes/{id}/steps',
      summary: 'Add step to route',
      description: 'Adds a process step to the route. New steps are appended at the end; use the reorder endpoint to change sequence.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Route UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Step data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'processId', type: 'string', required: true, description: 'Process UUID to add as a step', format: 'uuid' },
            { name: 'cycleTimeOverride', type: 'number', required: false, description: 'Override default cycle time in seconds' },
            { name: 'notes', type: 'string', required: false, description: 'Step-specific notes' },
          ],
        },
        example: { processId: 'proc-uuid', cycleTimeOverride: 200 },
      },
      responses: [
        { statusCode: 201, description: 'Step added', example: { success: true, data: { id: 'step-uuid', stepOrder: 3, processId: 'proc-uuid', processName: 'Heat Treatment' } } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Route or process not found' },
        { statusCode: 422, code: 'INVALID_STATE', description: 'Cannot add steps to an approved route' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/process-routes/{route_id}/steps \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"processId":"proc-uuid"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/process-routes/\${routeId}/steps\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ processId: 'proc-uuid' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/process-routes/{route_id}/steps',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'processId': 'proc-uuid'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/process-routes/"+routeID+"/steps", strings.NewReader(\`{"processId":"proc-uuid"}\`))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-route-cost-summary',
      method: 'GET',
      path: '/v1/api/process-routes/{id}/cost-summary',
      summary: 'Get route cost summary',
      description: 'Returns the total process cost for the route, broken down by each step.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Route UUID', format: 'uuid' },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'Cost summary retrieved',
          example: {
            success: true,
            data: {
              routeId: 'route-uuid',
              totalProcessCost: 84.30,
              currency: 'INR',
              steps: [
                { stepOrder: 1, processName: 'CNC Turning', machineCost: 42.15, laborCost: 21.08, totalCost: 63.23 },
                { stepOrder: 2, processName: 'Surface Grinding', machineCost: 14.05, laborCost: 7.02, totalCost: 21.07 },
              ],
            },
          },
        },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Route not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/process-routes/{route_id}/cost-summary \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/process-routes/\${routeId}/cost-summary\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/process-routes/{route_id}/cost-summary',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/process-routes/"+routeID+"/cost-summary", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
  ],
};
