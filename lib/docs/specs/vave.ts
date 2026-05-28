import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const vaveGroup: ResourceGroup = {
  id: 'vave',
  label: 'VAVE',
  description: 'Value Analysis and Value Engineering (VAVE) projects to identify cost reduction opportunities.',
  icon: 'Zap',
  endpoints: [
    {
      id: 'list-vave-projects',
      method: 'GET',
      path: '/v1/api/vave/projects',
      summary: 'List VAVE projects',
      description: 'Returns a paginated list of all VAVE projects.',
      parameters: [
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Results per page', default: 20 },
      ],
      responses: [
        { statusCode: 200, description: 'VAVE projects retrieved', example: { success: true, data: { projects: [{ id: 'vave-uuid', name: 'Engine Block Cost Reduction', status: 'active', targetSavingsPercent: 15, ideaCount: 8 }], total: 7 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/vave/projects \\\n  -H "Authorization: Bearer {token}" \\\n  -d "page=1&limit=20"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/vave/projects?page=1\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/vave/projects',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'page': 1, 'limit': 20},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/vave/projects?page=1&limit=20", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-vave-project',
      method: 'POST',
      path: '/v1/api/vave/projects',
      summary: 'Create a VAVE project',
      description: 'Creates a new VAVE project, optionally linked to a main production project.',
      parameters: [],
      requestBody: {
        description: 'VAVE project data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: true, description: 'VAVE project name', example: 'Engine Block Cost Reduction' },
            { name: 'description', type: 'string', required: false, description: 'Project description and objectives' },
            { name: 'projectId', type: 'string', required: false, description: 'Link to main production project UUID', format: 'uuid' },
            { name: 'targetSavingsPercent', type: 'number', required: false, description: 'Target cost savings percentage', example: 15 },
          ],
        },
        example: { name: 'Engine Block Cost Reduction', projectId: 'proj-uuid', targetSavingsPercent: 15 },
      },
      responses: [
        { statusCode: 201, description: 'VAVE project created', example: { success: true, data: { id: 'vave-uuid', name: 'Engine Block Cost Reduction', status: 'active', targetSavingsPercent: 15, ideaCount: 0 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Linked project not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/vave/projects \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Engine Block Cost Reduction","projectId":"proj-uuid","targetSavingsPercent":15}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/vave/projects', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ name: 'Engine Block Cost Reduction', projectId: 'proj-uuid', targetSavingsPercent: 15 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/vave/projects',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'name': 'Engine Block Cost Reduction', 'projectId': 'proj-uuid', 'targetSavingsPercent': 15},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"name":"Engine Block Cost Reduction","projectId":"proj-uuid","targetSavingsPercent":15}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/vave/projects", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-vave-project',
      method: 'GET',
      path: '/v1/api/vave/projects/{id}',
      summary: 'Retrieve a VAVE project',
      description: 'Returns full details for a VAVE project including idea count and savings summary.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'VAVE project UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'VAVE project retrieved', example: { success: true, data: { id: 'vave-uuid', name: 'Engine Block Cost Reduction', status: 'active', targetSavingsPercent: 15, ideaCount: 8 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'VAVE project not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/vave/projects/{vave_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/vave/projects/\${vaveId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/vave/projects/{vave_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/vave/projects/"+vaveID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-vave-project',
      method: 'PUT',
      path: '/v1/api/vave/projects/{id}',
      summary: 'Update a VAVE project',
      description: 'Updates the name, status, or target savings for a VAVE project.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'VAVE project UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: false, description: 'Updated project name' },
            { name: 'status', type: 'string', required: false, description: 'Updated project status', enum: ['active', 'completed', 'archived'] },
            { name: 'targetSavingsPercent', type: 'number', required: false, description: 'Updated target savings percentage' },
          ],
        },
        example: { status: 'completed', targetSavingsPercent: 18 },
      },
      responses: [
        { statusCode: 200, description: 'VAVE project updated', example: { success: true, data: { id: 'vave-uuid', status: 'completed', targetSavingsPercent: 18 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'VAVE project not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/vave/projects/{vave_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"status":"completed","targetSavingsPercent":18}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/vave/projects/\${vaveId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ status: 'completed', targetSavingsPercent: 18 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/vave/projects/{vave_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'status': 'completed', 'targetSavingsPercent': 18},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"status":"completed","targetSavingsPercent":18}\`\nreq, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/vave/projects/"+vaveID, strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-vave-project',
      method: 'DELETE',
      path: '/v1/api/vave/projects/{id}',
      summary: 'Delete a VAVE project',
      description: 'Permanently deletes a VAVE project and all associated BOM items and ideas.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'VAVE project UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'VAVE project deleted', example: { success: true, message: 'VAVE project deleted successfully' } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'VAVE project not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/vave/projects/{vave_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/vave/projects/\${vaveId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/vave/projects/{vave_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/vave/projects/"+vaveID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'list-vave-bom',
      method: 'GET',
      path: '/v1/api/vave/projects/{id}/bom',
      summary: 'List VAVE BOM items',
      description: 'Returns all BOM items added to the scope of a VAVE project, with their current and target costs.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'VAVE project UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'VAVE BOM items retrieved', example: { success: true, data: { items: [{ id: 'vave-item-uuid', bomItemId: 'item-uuid', currentCost: 220.50, targetCost: 187.50 }] } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'VAVE project not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/vave/projects/{vave_id}/bom \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/vave/projects/\${vaveId}/bom\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/vave/projects/{vave_id}/bom',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/vave/projects/"+vaveID+"/bom", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'add-vave-bom-item',
      method: 'POST',
      path: '/v1/api/vave/projects/{id}/bom',
      summary: 'Add BOM item to VAVE scope',
      description: 'Adds a BOM item to the VAVE project scope with current and target cost benchmarks.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'VAVE project UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'BOM item to add',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'bomItemId', type: 'string', required: true, description: 'BOM item UUID to add', format: 'uuid' },
            { name: 'currentCost', type: 'number', required: false, description: 'Current cost baseline', example: 220.50 },
            { name: 'targetCost', type: 'number', required: false, description: 'Target cost after VAVE', example: 187.50 },
          ],
        },
        example: { bomItemId: 'item-uuid', currentCost: 220.50, targetCost: 187.50 },
      },
      responses: [
        { statusCode: 201, description: 'BOM item added', example: { success: true, data: { id: 'vave-item-uuid', bomItemId: 'item-uuid', currentCost: 220.50, targetCost: 187.50 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'VAVE project or BOM item not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/vave/projects/{vave_id}/bom \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"bomItemId":"item-uuid","currentCost":220.50,"targetCost":187.50}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/vave/projects/\${vaveId}/bom\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ bomItemId: 'item-uuid', currentCost: 220.50, targetCost: 187.50 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/vave/projects/{vave_id}/bom',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'bomItemId': 'item-uuid', 'currentCost': 220.50, 'targetCost': 187.50},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"bomItemId":"item-uuid","currentCost":220.50,"targetCost":187.50}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/vave/projects/"+vaveID+"/bom", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-vave-bom-item',
      method: 'DELETE',
      path: '/v1/api/vave/projects/{id}/bom/{itemId}',
      summary: 'Remove BOM item from VAVE scope',
      description: 'Removes a BOM item from the VAVE project scope.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'VAVE project UUID', format: 'uuid' },
        { name: 'itemId', in: 'path', type: 'string', required: true, description: 'VAVE BOM item UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'BOM item removed', example: { success: true, message: 'BOM item removed from VAVE scope' } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'VAVE project or item not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/vave/projects/{vave_id}/bom/{item_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/vave/projects/\${vaveId}/bom/\${itemId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/vave/projects/{vave_id}/bom/{item_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/vave/projects/"+vaveID+"/bom/"+itemID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'list-vave-ideas',
      method: 'GET',
      path: '/v1/api/vave/projects/{id}/ideas',
      summary: 'List VAVE ideas',
      description: 'Returns all cost-reduction ideas for a VAVE project, optionally filtered by status.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'VAVE project UUID', format: 'uuid' },
        { name: 'status', in: 'query', type: 'string', required: false, description: 'Filter by idea status', enum: ['proposed', 'under_review', 'approved', 'rejected', 'implemented'] },
      ],
      responses: [
        { statusCode: 200, description: 'Ideas retrieved', example: { success: true, data: { ideas: [{ id: 'idea-uuid', title: 'Switch to cold-formed fasteners', category: 'process', savingsEstimate: 12.50, status: 'approved' }] } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'VAVE project not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/vave/projects/{vave_id}/ideas \\\n  -H "Authorization: Bearer {token}" \\\n  -d "status=approved"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/vave/projects/\${vaveId}/ideas?status=approved\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/vave/projects/{vave_id}/ideas',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'status': 'approved'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/vave/projects/"+vaveID+"/ideas?status=approved", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-vave-idea',
      method: 'POST',
      path: '/v1/api/vave/projects/{id}/ideas',
      summary: 'Create a VAVE idea',
      description: 'Submits a new cost-reduction idea for a VAVE project.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'VAVE project UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'VAVE idea data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'title', type: 'string', required: true, description: 'Short idea title', example: 'Switch to cold-formed fasteners' },
            { name: 'description', type: 'string', required: false, description: 'Detailed description of the idea' },
            { name: 'savingsEstimate', type: 'number', required: false, description: 'Estimated unit cost savings', example: 12.50 },
            { name: 'category', type: 'string', required: false, description: 'Idea category', enum: ['material', 'process', 'design', 'supplier'] },
            { name: 'bomItemId', type: 'string', required: false, description: 'BOM item this idea relates to', format: 'uuid' },
          ],
        },
        example: { title: 'Switch to cold-formed fasteners', category: 'process', savingsEstimate: 12.50, bomItemId: 'item-uuid' },
      },
      responses: [
        { statusCode: 201, description: 'Idea created', example: { success: true, data: { id: 'idea-uuid', title: 'Switch to cold-formed fasteners', category: 'process', savingsEstimate: 12.50, status: 'proposed' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'VAVE project not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/vave/projects/{vave_id}/ideas \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"Switch to cold-formed fasteners","category":"process","savingsEstimate":12.50}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/vave/projects/\${vaveId}/ideas\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ title: 'Switch to cold-formed fasteners', category: 'process', savingsEstimate: 12.50 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/vave/projects/{vave_id}/ideas',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'title': 'Switch to cold-formed fasteners', 'category': 'process', 'savingsEstimate': 12.50},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"title":"Switch to cold-formed fasteners","category":"process","savingsEstimate":12.50}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/vave/projects/"+vaveID+"/ideas", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-vave-idea',
      method: 'PUT',
      path: '/v1/api/vave/projects/{id}/ideas/{ideaId}',
      summary: 'Update a VAVE idea',
      description: 'Updates the details or status of a VAVE idea.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'VAVE project UUID', format: 'uuid' },
        { name: 'ideaId', in: 'path', type: 'string', required: true, description: 'Idea UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'title', type: 'string', required: false, description: 'Updated title' },
            { name: 'description', type: 'string', required: false, description: 'Updated description' },
            { name: 'status', type: 'string', required: false, description: 'Updated status', enum: ['proposed', 'under_review', 'approved', 'rejected', 'implemented'] },
            { name: 'savingsEstimate', type: 'number', required: false, description: 'Updated savings estimate' },
          ],
        },
        example: { status: 'approved', savingsEstimate: 14.00 },
      },
      responses: [
        { statusCode: 200, description: 'Idea updated', example: { success: true, data: { id: 'idea-uuid', title: 'Switch to cold-formed fasteners', category: 'process', savingsEstimate: 14.00, status: 'approved' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'VAVE project or idea not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/vave/projects/{vave_id}/ideas/{idea_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"status":"approved","savingsEstimate":14.00}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/vave/projects/\${vaveId}/ideas/\${ideaId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ status: 'approved', savingsEstimate: 14.00 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/vave/projects/{vave_id}/ideas/{idea_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'status': 'approved', 'savingsEstimate': 14.00},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"status":"approved","savingsEstimate":14.00}\`\nreq, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/vave/projects/"+vaveID+"/ideas/"+ideaID, strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-vave-idea',
      method: 'DELETE',
      path: '/v1/api/vave/projects/{id}/ideas/{ideaId}',
      summary: 'Delete a VAVE idea',
      description: 'Permanently removes a VAVE idea from the project.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'VAVE project UUID', format: 'uuid' },
        { name: 'ideaId', in: 'path', type: 'string', required: true, description: 'Idea UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Idea deleted', example: { success: true, message: 'VAVE idea deleted successfully' } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'VAVE project or idea not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/vave/projects/{vave_id}/ideas/{idea_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/vave/projects/\${vaveId}/ideas/\${ideaId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/vave/projects/{vave_id}/ideas/{idea_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/vave/projects/"+vaveID+"/ideas/"+ideaID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
  ],
};
