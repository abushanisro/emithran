import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const qualityControlGroup: ResourceGroup = {
  id: 'quality-control',
  label: 'Quality Control',
  description: 'Manage quality inspections throughout the production lifecycle. Track inspection results, measurements, and approval workflows.',
  icon: 'CheckSquare',
  endpoints: [
    {
      id: 'list-inspections',
      method: 'GET',
      path: '/v1/api/quality-control/inspections',
      summary: 'List inspections',
      description: 'Returns a paginated list of quality inspections, optionally filtered by project and status.',
      parameters: [
        { name: 'projectId', in: 'query', type: 'string', required: false, description: 'Filter by project UUID', format: 'uuid' },
        { name: 'status', in: 'query', type: 'string', required: false, description: 'Filter by inspection status', enum: ['pending', 'in_progress', 'completed', 'approved', 'rejected'] },
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Results per page', default: 20 },
      ],
      responses: [
        { statusCode: 200, description: 'Inspections retrieved', example: { success: true, data: { inspections: [{ id: 'insp-uuid', projectId: 'proj-uuid', status: 'pending', inspectionType: 'dimensional', createdAt: '2025-02-01T10:00:00Z' }], total: 42 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/quality-control/inspections \\\n  -H "Authorization: Bearer {token}" \\\n  -d "projectId=proj-uuid&status=pending"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/quality-control/inspections?projectId=proj-uuid&status=pending\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/quality-control/inspections',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'projectId': 'proj-uuid', 'status': 'pending'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/quality-control/inspections?projectId=proj-uuid&status=pending", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-inspection',
      method: 'POST',
      path: '/v1/api/quality-control/inspections',
      summary: 'Create an inspection',
      description: 'Creates a new quality inspection record linked to a project and optionally a BOM item.',
      parameters: [],
      requestBody: {
        description: 'Inspection data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'projectId', type: 'string', required: true, description: 'Project UUID', format: 'uuid' },
            { name: 'bomItemId', type: 'string', required: false, description: 'BOM item UUID to inspect', format: 'uuid' },
            { name: 'inspectionType', type: 'string', required: false, description: 'Type of inspection', enum: ['dimensional', 'visual', 'functional', 'final'] },
            { name: 'notes', type: 'string', required: false, description: 'Pre-inspection notes or instructions' },
          ],
        },
        example: { projectId: 'proj-uuid', bomItemId: 'item-uuid', inspectionType: 'dimensional', notes: 'Check bore tolerances per drawing rev B.' },
      },
      responses: [
        { statusCode: 201, description: 'Inspection created', example: { success: true, data: { id: 'insp-uuid', projectId: 'proj-uuid', status: 'pending', inspectionType: 'dimensional', createdAt: '2025-02-01T10:00:00Z' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Project or BOM item not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/quality-control/inspections \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"projectId":"proj-uuid","bomItemId":"item-uuid","inspectionType":"dimensional"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/quality-control/inspections', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ projectId: 'proj-uuid', bomItemId: 'item-uuid', inspectionType: 'dimensional' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/quality-control/inspections',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'projectId': 'proj-uuid', 'bomItemId': 'item-uuid', 'inspectionType': 'dimensional'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"projectId":"proj-uuid","bomItemId":"item-uuid","inspectionType":"dimensional"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/quality-control/inspections", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-inspection',
      method: 'GET',
      path: '/v1/api/quality-control/inspections/{id}',
      summary: 'Retrieve an inspection',
      description: 'Returns full details for a single quality inspection including status, measurements, and audit trail.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Inspection UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Inspection retrieved', example: { success: true, data: { id: 'insp-uuid', projectId: 'proj-uuid', status: 'pending', inspectionType: 'dimensional', createdAt: '2025-02-01T10:00:00Z' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Inspection not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/quality-control/inspections/{inspection_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/quality-control/inspections/\${inspectionId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/quality-control/inspections/{inspection_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/quality-control/inspections/"+inspectionID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-inspection',
      method: 'PUT',
      path: '/v1/api/quality-control/inspections/{id}',
      summary: 'Update an inspection',
      description: 'Updates the notes or status of an existing inspection. Status transitions must follow the defined workflow.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Inspection UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'notes', type: 'string', required: false, description: 'Updated notes' },
            { name: 'status', type: 'string', required: false, description: 'Updated status', enum: ['pending', 'in_progress', 'completed', 'approved', 'rejected'] },
          ],
        },
        example: { notes: 'Re-inspect after rework completed.' },
      },
      responses: [
        { statusCode: 200, description: 'Inspection updated', example: { success: true, data: { id: 'insp-uuid', notes: 'Re-inspect after rework completed.', status: 'pending' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Inspection not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/quality-control/inspections/{inspection_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"notes":"Re-inspect after rework completed."}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/quality-control/inspections/\${inspectionId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ notes: 'Re-inspect after rework completed.' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/quality-control/inspections/{inspection_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'notes': 'Re-inspect after rework completed.'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"notes":"Re-inspect after rework completed."}\`\nreq, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/quality-control/inspections/"+inspectionID, strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-inspection',
      method: 'DELETE',
      path: '/v1/api/quality-control/inspections/{id}',
      summary: 'Delete an inspection',
      description: 'Permanently removes an inspection record. Only inspections in pending status can be deleted.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Inspection UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Inspection deleted', example: { success: true, message: 'Inspection deleted successfully' } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Inspection not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Cannot delete an inspection that is not in pending status' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/quality-control/inspections/{inspection_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/quality-control/inspections/\${inspectionId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/quality-control/inspections/{inspection_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/quality-control/inspections/"+inspectionID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'start-inspection',
      method: 'POST',
      path: '/v1/api/quality-control/inspections/{id}/start',
      summary: 'Start an inspection',
      description: 'Transitions an inspection from pending to in_progress, recording the start time.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Inspection UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Inspection started', example: { success: true, data: { id: 'insp-uuid', status: 'in_progress', startedAt: '2025-02-01T11:00:00Z' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Inspection not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Inspection is not in pending status' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/quality-control/inspections/{inspection_id}/start \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/quality-control/inspections/\${inspectionId}/start\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/quality-control/inspections/{inspection_id}/start',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/quality-control/inspections/"+inspectionID+"/start", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'complete-inspection',
      method: 'POST',
      path: '/v1/api/quality-control/inspections/{id}/complete',
      summary: 'Complete an inspection',
      description: 'Marks an inspection as completed with a summary of findings and an overall pass/fail/conditional result.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Inspection UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Completion data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'findings', type: 'string', required: true, description: 'Summary of inspection findings' },
            { name: 'overallResult', type: 'string', required: true, description: 'Overall inspection result', enum: ['pass', 'fail', 'conditional'] },
          ],
        },
        example: { findings: 'All bore diameters within tolerance. Minor surface scratch on flange.', overallResult: 'conditional' },
      },
      responses: [
        { statusCode: 200, description: 'Inspection completed', example: { success: true, data: { id: 'insp-uuid', status: 'completed', overallResult: 'conditional', completedAt: '2025-02-01T14:00:00Z' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Inspection not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Inspection is not in_progress' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/quality-control/inspections/{inspection_id}/complete \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"findings":"All bores in tolerance.","overallResult":"pass"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/quality-control/inspections/\${inspectionId}/complete\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ findings: 'All bores in tolerance.', overallResult: 'pass' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/quality-control/inspections/{inspection_id}/complete',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'findings': 'All bores in tolerance.', 'overallResult': 'pass'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"findings":"All bores in tolerance.","overallResult":"pass"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/quality-control/inspections/"+inspectionID+"/complete", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'approve-inspection',
      method: 'POST',
      path: '/v1/api/quality-control/inspections/{id}/approve',
      summary: 'Approve an inspection',
      description: 'Approves a completed inspection, moving it to approved status. Optionally attaches approver notes.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Inspection UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Approval data',
        required: false,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'approverNotes', type: 'string', required: false, description: 'Optional notes from the approver' },
          ],
        },
        example: { approverNotes: 'Reviewed measurement report. Approved for shipment.' },
      },
      responses: [
        { statusCode: 200, description: 'Inspection approved', example: { success: true, data: { id: 'insp-uuid', status: 'approved', approvedAt: '2025-02-02T09:00:00Z' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Inspection not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Inspection must be completed before approval' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/quality-control/inspections/{inspection_id}/approve \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"approverNotes":"Approved for shipment."}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/quality-control/inspections/\${inspectionId}/approve\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ approverNotes: 'Approved for shipment.' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/quality-control/inspections/{inspection_id}/approve',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'approverNotes': 'Approved for shipment.'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"approverNotes":"Approved for shipment."}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/quality-control/inspections/"+inspectionID+"/approve", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'reject-inspection',
      method: 'POST',
      path: '/v1/api/quality-control/inspections/{id}/reject',
      summary: 'Reject an inspection',
      description: 'Rejects a completed inspection and records the rejection reason and required corrective action.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Inspection UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Rejection data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'rejectionReason', type: 'string', required: true, description: 'Reason for rejection' },
            { name: 'correctiveAction', type: 'string', required: false, description: 'Required corrective action before re-inspection' },
          ],
        },
        example: { rejectionReason: 'Bore diameter out of tolerance on 3 of 10 samples.', correctiveAction: 'Rework and re-bore to drawing spec.' },
      },
      responses: [
        { statusCode: 200, description: 'Inspection rejected', example: { success: true, data: { id: 'insp-uuid', status: 'rejected', rejectionReason: 'Bore diameter out of tolerance on 3 of 10 samples.' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Inspection not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Inspection must be completed before rejection' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/quality-control/inspections/{inspection_id}/reject \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"rejectionReason":"Bore out of tolerance.","correctiveAction":"Rework and re-bore."}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/quality-control/inspections/\${inspectionId}/reject\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ rejectionReason: 'Bore out of tolerance.', correctiveAction: 'Rework and re-bore.' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/quality-control/inspections/{inspection_id}/reject',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'rejectionReason': 'Bore out of tolerance.', 'correctiveAction': 'Rework and re-bore.'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"rejectionReason":"Bore out of tolerance.","correctiveAction":"Rework and re-bore."}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/quality-control/inspections/"+inspectionID+"/reject", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-inspection-results',
      method: 'POST',
      path: '/v1/api/quality-control/inspections/{id}/results',
      summary: 'Record inspection results',
      description: 'Submits a set of measurement results for an inspection. Each measurement includes nominal, actual, and tolerance values.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Inspection UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Measurement results',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            {
              name: 'measurements',
              type: 'array',
              required: true,
              description: 'Array of measurement records',
              items: {
                name: 'measurement',
                type: 'object',
                properties: [
                  { name: 'parameterName', type: 'string', required: true, description: 'Name of the measured parameter', example: 'Bore Diameter' },
                  { name: 'nominalValue', type: 'number', required: true, description: 'Design nominal value', example: 50.00 },
                  { name: 'actualValue', type: 'number', required: true, description: 'Measured actual value', example: 50.02 },
                  { name: 'tolerance', type: 'number', required: true, description: 'Allowable tolerance (±)', example: 0.05 },
                  { name: 'unit', type: 'string', required: true, description: 'Unit of measurement', example: 'mm' },
                  { name: 'result', type: 'string', required: true, description: 'Pass/fail result for this measurement', enum: ['pass', 'fail'] },
                ],
              },
            },
          ],
        },
        example: { measurements: [{ parameterName: 'Bore Diameter', nominalValue: 50.00, actualValue: 50.02, tolerance: 0.05, unit: 'mm', result: 'pass' }] },
      },
      responses: [
        { statusCode: 201, description: 'Results recorded', example: { success: true, data: { measurements: [{ parameterName: 'Bore Diameter', nominalValue: 50.00, actualValue: 50.02, tolerance: 0.05, unit: 'mm', result: 'pass' }] } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Inspection not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/quality-control/inspections/{inspection_id}/results \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"measurements":[{"parameterName":"Bore Diameter","nominalValue":50.00,"actualValue":50.02,"tolerance":0.05,"unit":"mm","result":"pass"}]}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/quality-control/inspections/\${inspectionId}/results\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ measurements: [{ parameterName: 'Bore Diameter', nominalValue: 50.00, actualValue: 50.02, tolerance: 0.05, unit: 'mm', result: 'pass' }] }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/quality-control/inspections/{inspection_id}/results',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'measurements': [{'parameterName': 'Bore Diameter', 'nominalValue': 50.00, 'actualValue': 50.02, 'tolerance': 0.05, 'unit': 'mm', 'result': 'pass'}]},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"measurements":[{"parameterName":"Bore Diameter","nominalValue":50.00,"actualValue":50.02,"tolerance":0.05,"unit":"mm","result":"pass"}]}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/quality-control/inspections/"+inspectionID+"/results", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-inspection-results',
      method: 'GET',
      path: '/v1/api/quality-control/inspections/{id}/results',
      summary: 'Get inspection results',
      description: 'Returns all recorded measurement results for an inspection.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Inspection UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Results retrieved', example: { success: true, data: { measurements: [{ parameterName: 'Bore Diameter', nominalValue: 50.00, actualValue: 50.02, tolerance: 0.05, unit: 'mm', result: 'pass' }] } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Inspection not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/quality-control/inspections/{inspection_id}/results \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/quality-control/inspections/\${inspectionId}/results\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/quality-control/inspections/{inspection_id}/results',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/quality-control/inspections/"+inspectionID+"/results", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-quality-metrics',
      method: 'GET',
      path: '/v1/api/quality-control/projects/{projectId}/metrics',
      summary: 'Get quality metrics',
      description: 'Returns aggregated quality metrics for a project including pass rate, fail rate, defect density, and inspection count.',
      parameters: [
        { name: 'projectId', in: 'path', type: 'string', required: true, description: 'Project UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Metrics retrieved', example: { success: true, data: { passRate: 94.5, failRate: 5.5, inspectionCount: 128, defectDensity: 0.055 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Project not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/quality-control/projects/{project_id}/metrics \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/quality-control/projects/\${projectId}/metrics\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/quality-control/projects/{project_id}/metrics',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/quality-control/projects/"+projectID+"/metrics", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-quality-dashboard',
      method: 'GET',
      path: '/v1/api/quality-control/projects/{projectId}/dashboard',
      summary: 'Get quality dashboard',
      description: 'Returns a comprehensive quality dashboard for a project, including recent inspections, trend data, and top defect categories.',
      parameters: [
        { name: 'projectId', in: 'path', type: 'string', required: true, description: 'Project UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Dashboard data retrieved', example: { success: true, data: { summary: { passRate: 94.5, inspectionCount: 128 }, recentInspections: [], trendData: [] } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Project not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/quality-control/projects/{project_id}/dashboard \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/quality-control/projects/\${projectId}/dashboard\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/quality-control/projects/{project_id}/dashboard',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/quality-control/projects/"+projectID+"/dashboard", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
  ],
};
