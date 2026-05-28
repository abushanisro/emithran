import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const productionPlanningGroup: ResourceGroup = {
  id: 'production-planning',
  label: 'Production Planning',
  description: 'Create and manage production lots. Track manufacturing execution, vendor assignments, materials, and quality control.',
  icon: 'Factory',
  endpoints: [
    {
      id: 'list-lots',
      method: 'GET',
      path: '/v1/api/production-planning/lots',
      summary: 'List production lots',
      description: 'Returns all production lots with their status, quantity, and schedule.',
      parameters: [
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Results per page', default: 20 },
        { name: 'status', in: 'query', type: 'string', required: false, description: 'Filter by lot status', enum: ['planned', 'in_progress', 'completed', 'cancelled'] },
        { name: 'bomId', in: 'query', type: 'string', required: false, description: 'Filter by BOM UUID' },
      ],
      responses: [
        { statusCode: 200, description: 'Lots retrieved', example: { success: true, data: { lots: [{ id: 'lot-uuid', lotNumber: 'LOT-2025-001', quantity: 500, status: 'planned', scheduledStart: '2025-02-01' }], total: 18 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/production-planning/lots \\\n  -H "Authorization: Bearer {token}" \\\n  -d "status=planned"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/production-planning/lots?status=planned\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/production-planning/lots',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'status': 'planned'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/production-planning/lots?status=planned", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-lot',
      method: 'POST',
      path: '/v1/api/production-planning/lots',
      summary: 'Create a production lot',
      description: 'Creates a new production lot for manufacturing execution.',
      parameters: [],
      requestBody: {
        description: 'Lot data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'bomId', type: 'string', required: true, description: 'BOM to produce', format: 'uuid' },
            { name: 'quantity', type: 'integer', required: true, description: 'Production quantity', example: 500 },
            { name: 'scheduledStart', type: 'string', required: false, description: 'Scheduled start date (ISO 8601)', format: 'date', example: '2025-02-01' },
            { name: 'scheduledEnd', type: 'string', required: false, description: 'Scheduled end date (ISO 8601)', format: 'date', example: '2025-02-28' },
            { name: 'priority', type: 'string', required: false, description: 'Lot priority', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
            { name: 'notes', type: 'string', required: false, description: 'Additional notes' },
          ],
        },
        example: { bomId: 'bom-uuid', quantity: 500, scheduledStart: '2025-02-01', scheduledEnd: '2025-02-28' },
      },
      responses: [{ statusCode: 201, description: 'Lot created', example: { success: true, data: { id: 'lot-uuid', lotNumber: 'LOT-2025-001', status: 'planned', quantity: 500 } } }],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'BOM not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/production-planning/lots \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"bomId":"bom-uuid","quantity":500,"scheduledStart":"2025-02-01","scheduledEnd":"2025-02-28"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/production-planning/lots', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ bomId: 'bom-uuid', quantity: 500, scheduledStart: '2025-02-01' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/production-planning/lots',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'bomId': 'bom-uuid', 'quantity': 500, 'scheduledStart': '2025-02-01'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"bomId":"bom-uuid","quantity":500,"scheduledStart":"2025-02-01"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/production-planning/lots", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-lot',
      method: 'GET',
      path: '/v1/api/production-planning/lots/{id}',
      summary: 'Retrieve a production lot',
      description: 'Returns full details for a production lot including BOM, schedule, status history, and cost breakdown.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Lot UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Lot retrieved', example: { success: true, data: { id: 'lot-uuid', lotNumber: 'LOT-2025-001', quantity: 500, status: 'in_progress', scheduledStart: '2025-02-01', actualStart: '2025-02-01' } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Lot not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/production-planning/lots/{lot_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/production-planning/lots/\${lotId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/production-planning/lots/{lot_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/production-planning/lots/"+lotID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-lot',
      method: 'PUT',
      path: '/v1/api/production-planning/lots/{id}',
      summary: 'Update a production lot',
      description: 'Updates the status, schedule, quantity, or notes for an existing production lot.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Lot UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'status', type: 'string', required: false, description: 'New lot status', enum: ['planned', 'in_progress', 'completed', 'cancelled'] },
            { name: 'quantity', type: 'integer', required: false, description: 'Updated production quantity' },
            { name: 'scheduledEnd', type: 'string', required: false, description: 'Updated scheduled end date', format: 'date' },
            { name: 'notes', type: 'string', required: false, description: 'Status change notes' },
          ],
        },
        example: { status: 'in_progress', notes: 'Production started on Line 3' },
      },
      responses: [
        { statusCode: 200, description: 'Lot updated', example: { success: true, data: { id: 'lot-uuid', status: 'in_progress', updatedAt: '2025-02-01T08:00:00Z' } } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Lot not found' },
        { statusCode: 422, code: 'INVALID_TRANSITION', description: 'Invalid status transition' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/production-planning/lots/{lot_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"status":"in_progress","notes":"Started on Line 3"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/production-planning/lots/\${lotId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ status: 'in_progress', notes: 'Started on Line 3' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/production-planning/lots/{lot_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'status': 'in_progress', 'notes': 'Started on Line 3'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"status":"in_progress","notes":"Started on Line 3"}\`\nreq, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/production-planning/lots/"+lotID, strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-lot',
      method: 'DELETE',
      path: '/v1/api/production-planning/lots/{id}',
      summary: 'Delete a production lot',
      description: 'Permanently deletes a production lot and all associated tracking data.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Lot UUID', format: 'uuid' },
      ],
      responses: [{ statusCode: 200, description: 'Lot deleted', example: { success: true, message: 'Production lot deleted' } }],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Lot not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Cannot delete an in-progress lot' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/production-planning/lots/{lot_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/production-planning/lots/\${lotId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/production-planning/lots/{lot_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/production-planning/lots/"+lotID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-lot-gantt',
      method: 'GET',
      path: '/v1/api/production-planning/lots/{lotId}/gantt',
      summary: 'Get Gantt chart data',
      description: 'Returns structured Gantt chart data for a production lot including process timelines, milestones, and completion percentages.',
      parameters: [
        { name: 'lotId', in: 'path', type: 'string', required: true, description: 'Lot UUID', format: 'uuid', example: 'lot-uuid' },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'Gantt data retrieved',
          example: {
            success: true,
            data: {
              lotId: 'lot-uuid',
              startDate: '2025-02-01',
              endDate: '2025-02-28',
              tasks: [
                { id: 'task-1', name: 'CNC Turning', start: '2025-02-01', end: '2025-02-10', progress: 100, dependencies: [] },
                { id: 'task-2', name: 'Surface Grinding', start: '2025-02-10', end: '2025-02-20', progress: 60, dependencies: ['task-1'] },
              ],
            },
          },
        },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Lot not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/production-planning/lots/{lot_id}/gantt \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/production-planning/lots/\${lotId}/gantt\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/production-planning/lots/{lot_id}/gantt',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/production-planning/lots/"+lotID+"/gantt", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-production-dashboard',
      method: 'GET',
      path: '/v1/api/production-planning/dashboard',
      summary: 'Get production dashboard',
      description: 'Returns an aggregated production dashboard with KPIs, lot status summary, and upcoming milestones for the authenticated user.',
      parameters: [],
      responses: [
        {
          statusCode: 200,
          description: 'Dashboard data retrieved',
          example: {
            success: true,
            data: {
              summary: { total: 24, planned: 8, inProgress: 12, completed: 4 },
              upcomingDeadlines: [{ lotId: 'lot-uuid', lotNumber: 'LOT-2025-001', dueDate: '2025-02-28', daysRemaining: 7 }],
              recentActivity: [],
            },
          },
        },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/production-planning/dashboard \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/production-planning/dashboard', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    '${BASE_URL}/v1/api/production-planning/dashboard',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/production-planning/dashboard", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
  ],
};
