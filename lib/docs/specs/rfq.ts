import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const rfqGroup: ResourceGroup = {
  id: 'rfq',
  label: 'Request for Quotation',
  description: 'Create and manage RFQs for procurement. Track vendor responses, compare quotes, and award contracts.',
  icon: 'FileText',
  endpoints: [
    {
      id: 'list-rfqs',
      method: 'GET',
      path: '/v1/api/rfq',
      summary: 'List RFQs',
      description: 'Returns a list of all RFQs, optionally filtered by project and status.',
      parameters: [
        { name: 'projectId', in: 'query', type: 'string', required: false, description: 'Filter by project UUID', format: 'uuid' },
        { name: 'status', in: 'query', type: 'string', required: false, description: 'Filter by RFQ status', enum: ['draft', 'sent', 'closed'] },
      ],
      responses: [
        { statusCode: 200, description: 'RFQs retrieved', example: { success: true, data: { rfqs: [{ id: 'rfq-uuid', title: 'Q2 2025 Engine Parts RFQ', projectId: 'proj-uuid', status: 'draft', vendorCount: 0, createdAt: '2025-03-01T10:00:00Z' }], total: 12 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/rfq \\\n  -H "Authorization: Bearer {token}" \\\n  -d "projectId=proj-uuid&status=draft"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/rfq?projectId=proj-uuid&status=draft\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/rfq',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'projectId': 'proj-uuid', 'status': 'draft'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/rfq?projectId=proj-uuid&status=draft", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-rfq',
      method: 'POST',
      path: '/v1/api/rfq',
      summary: 'Create an RFQ',
      description: 'Creates a new Request for Quotation for a project, optionally scoped to specific BOM items.',
      parameters: [],
      requestBody: {
        description: 'RFQ data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'projectId', type: 'string', required: true, description: 'Project UUID', format: 'uuid' },
            { name: 'title', type: 'string', required: true, description: 'RFQ title', example: 'Q2 2025 Engine Parts RFQ' },
            { name: 'bomItemIds', type: 'array', required: false, description: 'BOM item UUIDs to include in scope', example: ['item-uuid-1', 'item-uuid-2'] },
            { name: 'dueDate', type: 'string', required: false, description: 'Vendor response due date (ISO 8601)', format: 'date', example: '2025-03-15' },
            { name: 'notes', type: 'string', required: false, description: 'Additional notes for vendors' },
          ],
        },
        example: { projectId: 'proj-uuid', title: 'Q2 2025 Engine Parts RFQ', dueDate: '2025-03-15' },
      },
      responses: [
        { statusCode: 201, description: 'RFQ created', example: { success: true, data: { id: 'rfq-uuid', title: 'Q2 2025 Engine Parts RFQ', projectId: 'proj-uuid', status: 'draft', vendorCount: 0, createdAt: '2025-03-01T10:00:00Z' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Project not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/rfq \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"projectId":"proj-uuid","title":"Q2 2025 Engine Parts RFQ","dueDate":"2025-03-15"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/rfq', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ projectId: 'proj-uuid', title: 'Q2 2025 Engine Parts RFQ', dueDate: '2025-03-15' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/rfq',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'projectId': 'proj-uuid', 'title': 'Q2 2025 Engine Parts RFQ', 'dueDate': '2025-03-15'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"projectId":"proj-uuid","title":"Q2 2025 Engine Parts RFQ","dueDate":"2025-03-15"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/rfq", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-rfq',
      method: 'GET',
      path: '/v1/api/rfq/{id}',
      summary: 'Retrieve an RFQ',
      description: 'Returns full details for a single RFQ including scoped BOM items and vendor tracking summary.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'RFQ UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'RFQ retrieved', example: { success: true, data: { id: 'rfq-uuid', title: 'Q2 2025 Engine Parts RFQ', projectId: 'proj-uuid', status: 'draft', vendorCount: 0, createdAt: '2025-03-01T10:00:00Z' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'RFQ not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/rfq/{rfq_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/rfq/\${rfqId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/rfq/{rfq_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/rfq/"+rfqID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'send-rfq',
      method: 'PATCH',
      path: '/v1/api/rfq/{id}/send',
      summary: 'Send an RFQ',
      description: 'Transitions an RFQ from draft to sent status, making it visible to vendors for response.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'RFQ UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'RFQ sent', example: { success: true, data: { id: 'rfq-uuid', status: 'sent', sentAt: '2025-03-01T12:00:00Z' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'RFQ not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'RFQ is not in draft status' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PATCH ${BASE_URL}/v1/api/rfq/{rfq_id}/send \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/rfq/\${rfqId}/send\`, {\n  method: 'PATCH',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.patch(\n    f'${BASE_URL}/v1/api/rfq/{rfq_id}/send',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("PATCH", "${BASE_URL}/v1/api/rfq/"+rfqID+"/send", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'close-rfq',
      method: 'PATCH',
      path: '/v1/api/rfq/{id}/close',
      summary: 'Close an RFQ',
      description: 'Closes an RFQ, preventing further vendor responses. Typically done after a vendor is awarded.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'RFQ UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'RFQ closed', example: { success: true, data: { id: 'rfq-uuid', status: 'closed', closedAt: '2025-03-20T10:00:00Z' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'RFQ not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PATCH ${BASE_URL}/v1/api/rfq/{rfq_id}/close \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/rfq/\${rfqId}/close\`, {\n  method: 'PATCH',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.patch(\n    f'${BASE_URL}/v1/api/rfq/{rfq_id}/close',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("PATCH", "${BASE_URL}/v1/api/rfq/"+rfqID+"/close", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-rfq-tracking',
      method: 'POST',
      path: '/v1/api/rfq/tracking',
      summary: 'Create RFQ tracking',
      description: 'Associates one or more vendors with an RFQ for response tracking.',
      parameters: [],
      requestBody: {
        description: 'Tracking data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'rfqId', type: 'string', required: true, description: 'RFQ UUID', format: 'uuid' },
            { name: 'vendorIds', type: 'array', required: true, description: 'Array of vendor UUIDs to track', example: ['vendor-uuid-1', 'vendor-uuid-2'] },
          ],
        },
        example: { rfqId: 'rfq-uuid', vendorIds: ['vendor-uuid-1', 'vendor-uuid-2'] },
      },
      responses: [
        { statusCode: 201, description: 'Tracking created', example: { success: true, data: { id: 'track-uuid', rfqId: 'rfq-uuid', vendors: [{ vendorId: 'vendor-uuid', status: 'pending' }] } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'RFQ or vendor not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/rfq/tracking \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"rfqId":"rfq-uuid","vendorIds":["vendor-uuid-1","vendor-uuid-2"]}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/rfq/tracking', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ rfqId: 'rfq-uuid', vendorIds: ['vendor-uuid-1', 'vendor-uuid-2'] }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/rfq/tracking',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'rfqId': 'rfq-uuid', 'vendorIds': ['vendor-uuid-1', 'vendor-uuid-2']},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"rfqId":"rfq-uuid","vendorIds":["vendor-uuid-1","vendor-uuid-2"]}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/rfq/tracking", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'list-rfq-tracking',
      method: 'GET',
      path: '/v1/api/rfq/tracking',
      summary: 'List RFQ tracking records',
      description: 'Returns all RFQ tracking records for a given project.',
      parameters: [
        { name: 'projectId', in: 'query', type: 'string', required: true, description: 'Project UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Tracking records retrieved', example: { success: true, data: { tracking: [{ id: 'track-uuid', rfqId: 'rfq-uuid', vendors: [{ vendorId: 'vendor-uuid', status: 'pending' }] }] } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/rfq/tracking \\\n  -H "Authorization: Bearer {token}" \\\n  -d "projectId=proj-uuid"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/rfq/tracking?projectId=proj-uuid\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    '${BASE_URL}/v1/api/rfq/tracking',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'projectId': 'proj-uuid'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/rfq/tracking?projectId=proj-uuid", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-rfq-tracking-stats',
      method: 'GET',
      path: '/v1/api/rfq/tracking/stats',
      summary: 'Get RFQ tracking stats',
      description: 'Returns aggregated statistics across all vendor tracking records for a project.',
      parameters: [
        { name: 'projectId', in: 'query', type: 'string', required: false, description: 'Filter by project UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Stats retrieved', example: { success: true, data: { total: 24, pending: 8, responded: 12, declined: 2, awarded: 2 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/rfq/tracking/stats \\\n  -H "Authorization: Bearer {token}" \\\n  -d "projectId=proj-uuid"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/rfq/tracking/stats?projectId=proj-uuid\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    '${BASE_URL}/v1/api/rfq/tracking/stats',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'projectId': 'proj-uuid'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/rfq/tracking/stats?projectId=proj-uuid", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-rfq-tracking',
      method: 'GET',
      path: '/v1/api/rfq/tracking/{id}',
      summary: 'Retrieve a tracking record',
      description: 'Returns a single RFQ tracking record with full vendor response details.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Tracking record UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Tracking record retrieved', example: { success: true, data: { id: 'track-uuid', rfqId: 'rfq-uuid', vendors: [{ vendorId: 'vendor-uuid', status: 'pending' }] } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Tracking record not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/rfq/tracking/{tracking_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/rfq/tracking/\${trackingId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/rfq/tracking/{tracking_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/rfq/tracking/"+trackingID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-tracking-status',
      method: 'PATCH',
      path: '/v1/api/rfq/tracking/{id}/status',
      summary: 'Update tracking status',
      description: 'Updates the overall status of an RFQ tracking record.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Tracking record UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Status update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'status', type: 'string', required: true, description: 'New tracking status', enum: ['pending', 'responded', 'declined', 'awarded'] },
          ],
        },
        example: { status: 'awarded' },
      },
      responses: [
        { statusCode: 200, description: 'Status updated', example: { success: true, data: { id: 'track-uuid', status: 'awarded' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Tracking record not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PATCH ${BASE_URL}/v1/api/rfq/tracking/{tracking_id}/status \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"status":"awarded"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/rfq/tracking/\${trackingId}/status\`, {\n  method: 'PATCH',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ status: 'awarded' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.patch(\n    f'${BASE_URL}/v1/api/rfq/tracking/{tracking_id}/status',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'status': 'awarded'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"status":"awarded"}\`\nreq, _ := http.NewRequest("PATCH", "${BASE_URL}/v1/api/rfq/tracking/"+trackingID+"/status", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'record-vendor-response',
      method: 'PATCH',
      path: '/v1/api/rfq/tracking/{trackingId}/vendors/{vendorId}/response',
      summary: 'Record vendor response',
      description: 'Records a vendor\'s quoted price, lead time, and MOQ in response to an RFQ.',
      parameters: [
        { name: 'trackingId', in: 'path', type: 'string', required: true, description: 'Tracking record UUID', format: 'uuid' },
        { name: 'vendorId', in: 'path', type: 'string', required: true, description: 'Vendor UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Vendor response data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'quotedPrice', type: 'number', required: true, description: 'Vendor\'s quoted unit price', example: 380.00 },
            { name: 'leadTimeDays', type: 'integer', required: false, description: 'Quoted lead time in days', example: 30 },
            { name: 'moq', type: 'integer', required: false, description: 'Minimum order quantity', example: 50 },
            { name: 'notes', type: 'string', required: false, description: 'Vendor comments or conditions' },
          ],
        },
        example: { quotedPrice: 380.00, leadTimeDays: 30, moq: 50, notes: 'Price valid for 60 days.' },
      },
      responses: [
        { statusCode: 200, description: 'Response recorded', example: { success: true, data: { vendorId: 'vendor-uuid', quotedPrice: 380.00, leadTimeDays: 30, moq: 50, respondedAt: '2025-03-10T08:00:00Z' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Tracking record or vendor not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PATCH ${BASE_URL}/v1/api/rfq/tracking/{tracking_id}/vendors/{vendor_id}/response \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"quotedPrice":380.00,"leadTimeDays":30,"moq":50}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/rfq/tracking/\${trackingId}/vendors/\${vendorId}/response\`, {\n  method: 'PATCH',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ quotedPrice: 380.00, leadTimeDays: 30, moq: 50 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.patch(\n    f'${BASE_URL}/v1/api/rfq/tracking/{tracking_id}/vendors/{vendor_id}/response',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'quotedPrice': 380.00, 'leadTimeDays': 30, 'moq': 50},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"quotedPrice":380.00,"leadTimeDays":30,"moq":50}\`\nreq, _ := http.NewRequest("PATCH", "${BASE_URL}/v1/api/rfq/tracking/"+trackingID+"/vendors/"+vendorID+"/response", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
  ],
};
