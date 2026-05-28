import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const supplierEvaluationGroup: ResourceGroup = {
  id: 'supplier-evaluation',
  label: 'Supplier Evaluation',
  description: 'Conduct structured supplier evaluations using configurable scoring criteria. Approved evaluations create immutable audit records for compliance.',
  icon: 'Star',
  endpoints: [
    {
      id: 'list-evaluations',
      method: 'GET',
      path: '/v1/api/supplier-evaluations',
      summary: 'List supplier evaluations',
      description: 'Returns all supplier evaluations with optional filters by vendor, project, or status.',
      parameters: [
        { name: 'vendorId', in: 'query', type: 'string', required: false, description: 'Filter by vendor UUID' },
        { name: 'projectId', in: 'query', type: 'string', required: false, description: 'Filter by project UUID' },
        { name: 'status', in: 'query', type: 'string', required: false, description: 'Filter by evaluation status', enum: ['draft', 'in_progress', 'completed', 'approved'] },
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Results per page', default: 20 },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'Evaluations retrieved',
          example: {
            success: true,
            data: [
              { id: 'eval-uuid', vendorId: 'vendor-uuid', vendorName: 'Acme Co.', status: 'completed', overallScore: 82.5, maxScore: 100, evaluatedAt: '2025-03-01T10:00:00Z' },
            ],
            metadata: { total: 15, page: 1, limit: 20 },
          },
        },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/supplier-evaluations \\\n  -H "Authorization: Bearer {token}" \\\n  -d "status=completed&vendorId=vendor-uuid"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/supplier-evaluations?status=completed\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/supplier-evaluations',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'status': 'completed'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/supplier-evaluations?status=completed", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-evaluation',
      method: 'POST',
      path: '/v1/api/supplier-evaluations',
      summary: 'Create supplier evaluation',
      description: 'Creates a new supplier evaluation with configurable scoring criteria and weights.',
      parameters: [],
      requestBody: {
        description: 'Evaluation data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'vendorId', type: 'string', required: true, description: 'Vendor UUID to evaluate', format: 'uuid' },
            { name: 'projectId', type: 'string', required: false, description: 'Associated project UUID', format: 'uuid' },
            { name: 'evaluationType', type: 'string', required: false, description: 'Evaluation type', enum: ['annual', 'new_vendor', 'project_specific', 'audit'] },
            { name: 'criteria', type: 'array', required: false, description: 'Scoring criteria', properties: [
              { name: 'name', type: 'string', required: true, description: 'Criterion name', example: 'Quality' },
              { name: 'weight', type: 'number', required: true, description: 'Weight (0-100)', example: 30 },
              { name: 'score', type: 'number', required: false, description: 'Score (0-10)', example: 8 },
            ]},
          ],
        },
        example: {
          vendorId: 'vendor-uuid',
          evaluationType: 'annual',
          criteria: [
            { name: 'Quality', weight: 30, score: 8 },
            { name: 'Delivery', weight: 25, score: 7 },
            { name: 'Pricing', weight: 20, score: 9 },
            { name: 'Technical Capability', weight: 25, score: 8 },
          ],
        },
      },
      responses: [
        { statusCode: 201, description: 'Evaluation created', example: { success: true, data: { id: 'eval-uuid', vendorId: 'vendor-uuid', vendorName: 'Acme Co.', status: 'draft', overallScore: 80.0 } } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Vendor not found' },
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Token missing or invalid' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/supplier-evaluations \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"vendorId":"vendor-uuid","evaluationType":"annual","criteria":[{"name":"Quality","weight":30,"score":8}]}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/supplier-evaluations', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    vendorId: 'vendor-uuid',\n    evaluationType: 'annual',\n    criteria: [{ name: 'Quality', weight: 30, score: 8 }],\n  }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/supplier-evaluations',\n    headers={'Authorization': f'Bearer {token}'},\n    json={\n        'vendorId': 'vendor-uuid',\n        'evaluationType': 'annual',\n        'criteria': [{'name': 'Quality', 'weight': 30, 'score': 8}],\n    },\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"vendorId":"vendor-uuid","evaluationType":"annual"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/supplier-evaluations", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-evaluation',
      method: 'GET',
      path: '/v1/api/supplier-evaluations/{id}',
      summary: 'Get supplier evaluation',
      description: 'Returns full details of a supplier evaluation including all criteria scores and calculated overall score.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Evaluation UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Evaluation retrieved', example: { success: true, data: { id: 'eval-uuid', vendorName: 'Acme Co.', status: 'completed', overallScore: 82.5, criteria: [{ name: 'Quality', weight: 30, score: 8, weightedScore: 24 }] } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Evaluation not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/supplier-evaluations/{eval_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/supplier-evaluations/\${evalId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/supplier-evaluations/{eval_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/supplier-evaluations/"+evalID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-evaluation',
      method: 'PUT',
      path: '/v1/api/supplier-evaluations/{id}',
      summary: 'Update supplier evaluation',
      description: 'Updates criteria scores or notes for an evaluation in draft or in-progress status.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Evaluation UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Updated evaluation fields',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'criteria', type: 'array', required: false, description: 'Updated criteria scores' },
            { name: 'notes', type: 'string', required: false, description: 'Evaluation notes' },
          ],
        },
        example: { criteria: [{ name: 'Quality', score: 9 }], notes: 'Score updated after re-audit.' },
      },
      responses: [
        { statusCode: 200, description: 'Evaluation updated', example: { success: true, data: { id: 'eval-uuid', overallScore: 85.0, updatedAt: '2025-05-01T10:00:00Z' } } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Evaluation not found' },
        { statusCode: 422, code: 'INVALID_STATE', description: 'Cannot update an approved evaluation' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/supplier-evaluations/{eval_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"criteria":[{"name":"Quality","score":9}]}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/supplier-evaluations/\${evalId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ criteria: [{ name: 'Quality', score: 9 }] }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/supplier-evaluations/{eval_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'criteria': [{'name': 'Quality', 'score': 9}]},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/supplier-evaluations/"+evalID, strings.NewReader(\`{"criteria":[{"name":"Quality","score":9}]}\`))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'complete-evaluation',
      method: 'POST',
      path: '/v1/api/supplier-evaluations/{id}/complete',
      summary: 'Complete evaluation',
      description: 'Marks an evaluation as complete, locking all scores. Triggers a review notification to the approver.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Evaluation UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Evaluation completed', example: { success: true, data: { id: 'eval-uuid', status: 'completed', completedAt: '2025-03-01T10:00:00Z', overallScore: 82.5 } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Evaluation not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/supplier-evaluations/{eval_id}/complete \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/supplier-evaluations/\${evalId}/complete\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/supplier-evaluations/{eval_id}/complete',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/supplier-evaluations/"+evalID+"/complete", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'approve-evaluation',
      method: 'POST',
      path: '/v1/api/supplier-evaluations/{id}/approve',
      summary: 'Approve evaluation',
      description: 'Approves a completed evaluation, creating an immutable audit snapshot. Approved evaluations cannot be modified.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Evaluation UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Approval data',
        required: false,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'approverNotes', type: 'string', required: false, description: 'Notes from the approver' },
          ],
        },
        example: { approverNotes: 'Evaluation reviewed and approved. Vendor meets quality standards.' },
      },
      responses: [
        { statusCode: 200, description: 'Evaluation approved', example: { success: true, data: { id: 'eval-uuid', status: 'approved', approvedAt: '2025-03-05T14:00:00Z', snapshotId: 'snap-uuid' } } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Evaluation not found' },
        { statusCode: 422, code: 'INVALID_STATE', description: 'Only completed evaluations can be approved' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/supplier-evaluations/{eval_id}/approve \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"approverNotes":"Vendor meets quality standards."}'` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/supplier-evaluations/\${evalId}/approve\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ approverNotes: 'Vendor meets quality standards.' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/supplier-evaluations/{eval_id}/approve',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'approverNotes': 'Vendor meets quality standards.'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/supplier-evaluations/"+evalID+"/approve", strings.NewReader(\`{"approverNotes":"Approved."}\`))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-evaluation',
      method: 'DELETE',
      path: '/v1/api/supplier-evaluations/{id}',
      summary: 'Delete an evaluation',
      description: 'Permanently deletes a supplier evaluation. Approved evaluations cannot be deleted.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Evaluation UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Evaluation deleted', example: { success: true, message: 'Supplier evaluation deleted successfully' } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Evaluation not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Approved evaluations cannot be deleted' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/supplier-evaluations/{eval_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/supplier-evaluations/\${evalId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/supplier-evaluations/{eval_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/supplier-evaluations/"+evalID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'list-evaluation-groups',
      method: 'GET',
      path: '/v1/api/supplier-evaluation-groups',
      summary: 'List evaluation groups',
      description: 'Returns all supplier evaluation groups, optionally filtered by project.',
      parameters: [
        { name: 'projectId', in: 'query', type: 'string', required: false, description: 'Filter by project UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Evaluation groups retrieved', example: { success: true, data: { groups: [{ id: 'group-uuid', name: 'Q1 Supplier Audit', projectId: 'proj-uuid', evaluationCount: 5 }] } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/supplier-evaluation-groups \\\n  -H "Authorization: Bearer {token}" \\\n  -d "projectId=proj-uuid"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/supplier-evaluation-groups?projectId=proj-uuid\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    '${BASE_URL}/v1/api/supplier-evaluation-groups',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'projectId': 'proj-uuid'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/supplier-evaluation-groups?projectId=proj-uuid", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-evaluation-group',
      method: 'POST',
      path: '/v1/api/supplier-evaluation-groups',
      summary: 'Create an evaluation group',
      description: 'Creates a new evaluation group to batch multiple supplier evaluations under a shared set of criteria.',
      parameters: [],
      requestBody: {
        description: 'Evaluation group data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: true, description: 'Group name', example: 'Q1 Supplier Audit' },
            { name: 'projectId', type: 'string', required: true, description: 'Project UUID', format: 'uuid' },
            { name: 'criteria', type: 'array', required: false, description: 'Shared evaluation criteria template', example: [{ name: 'Quality Management System', weight: 30 }] },
          ],
        },
        example: { name: 'Q1 Supplier Audit', projectId: 'proj-uuid', criteria: [{ name: 'Quality Management System', weight: 30 }, { name: 'On-Time Delivery', weight: 25 }] },
      },
      responses: [
        { statusCode: 201, description: 'Evaluation group created', example: { success: true, data: { id: 'group-uuid', name: 'Q1 Supplier Audit', projectId: 'proj-uuid', evaluationCount: 0 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Project not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/supplier-evaluation-groups \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Q1 Supplier Audit","projectId":"proj-uuid","criteria":[{"name":"Quality Management System","weight":30}]}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/supplier-evaluation-groups', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ name: 'Q1 Supplier Audit', projectId: 'proj-uuid', criteria: [{ name: 'Quality Management System', weight: 30 }] }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/supplier-evaluation-groups',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'name': 'Q1 Supplier Audit', 'projectId': 'proj-uuid', 'criteria': [{'name': 'Quality Management System', 'weight': 30}]},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"name":"Q1 Supplier Audit","projectId":"proj-uuid"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/supplier-evaluation-groups", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
  ],
};
