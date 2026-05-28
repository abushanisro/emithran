import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const vendorQuotesGroup: ResourceGroup = {
  id: 'vendor-quotes',
  label: 'Vendor Quotes',
  description: 'Manage vendor quotations for supplier nominations. Track line items, workflow approvals, and comparative analysis.',
  icon: 'BarChart3',
  endpoints: [
    {
      id: 'list-quotes-by-nomination',
      method: 'GET',
      path: '/v1/vendor-quotes/nomination/{nominationId}',
      summary: 'List quotes for a nomination',
      description: 'Returns all vendor quotes submitted for a specific supplier nomination.',
      parameters: [
        { name: 'nominationId', in: 'path', type: 'string', required: true, description: 'Nomination UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Quotes retrieved', example: { success: true, data: { quotes: [{ id: 'quote-uuid', nominationId: 'nom-uuid', vendorId: 'vendor-uuid', vendorName: 'Acme Co.', status: 'submitted', currency: 'INR', lineItemCount: 3 }] } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Nomination not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/vendor-quotes/nomination/{nomination_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/vendor-quotes/nomination/\${nominationId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    f'${BASE_URL}/v1/vendor-quotes/nomination/{nomination_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/vendor-quotes/nomination/"+nominationID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-quote',
      method: 'POST',
      path: '/v1/vendor-quotes',
      summary: 'Create a vendor quote',
      description: 'Creates a new vendor quote record for a nomination, to be filled with line items.',
      parameters: [],
      requestBody: {
        description: 'Quote data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'nominationId', type: 'string', required: true, description: 'Nomination UUID', format: 'uuid' },
            { name: 'vendorId', type: 'string', required: true, description: 'Vendor UUID', format: 'uuid' },
            { name: 'currency', type: 'string', required: false, description: 'Quote currency', example: 'INR', default: 'INR' },
            { name: 'validUntil', type: 'string', required: false, description: 'Quote validity date (ISO 8601)', format: 'date', example: '2025-04-30' },
          ],
        },
        example: { nominationId: 'nom-uuid', vendorId: 'vendor-uuid', currency: 'INR', validUntil: '2025-04-30' },
      },
      responses: [
        { statusCode: 201, description: 'Quote created', example: { success: true, data: { id: 'quote-uuid', nominationId: 'nom-uuid', vendorId: 'vendor-uuid', vendorName: 'Acme Co.', status: 'draft', currency: 'INR', lineItemCount: 0 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Nomination or vendor not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/vendor-quotes \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"nominationId":"nom-uuid","vendorId":"vendor-uuid","currency":"INR","validUntil":"2025-04-30"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/vendor-quotes', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ nominationId: 'nom-uuid', vendorId: 'vendor-uuid', currency: 'INR', validUntil: '2025-04-30' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/vendor-quotes',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'nominationId': 'nom-uuid', 'vendorId': 'vendor-uuid', 'currency': 'INR', 'validUntil': '2025-04-30'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"nominationId":"nom-uuid","vendorId":"vendor-uuid","currency":"INR","validUntil":"2025-04-30"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/vendor-quotes", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-quote',
      method: 'GET',
      path: '/v1/vendor-quotes/{id}',
      summary: 'Retrieve a quote',
      description: 'Returns full details for a vendor quote including all line items.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Quote UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Quote retrieved', example: { success: true, data: { id: 'quote-uuid', nominationId: 'nom-uuid', vendorId: 'vendor-uuid', vendorName: 'Acme Co.', status: 'submitted', currency: 'INR', lineItemCount: 3 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Quote not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/vendor-quotes/{quote_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/vendor-quotes/\${quoteId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/vendor-quotes/{quote_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/vendor-quotes/"+quoteID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-quote',
      method: 'PUT',
      path: '/v1/vendor-quotes/{id}',
      summary: 'Update a quote',
      description: 'Updates currency, validity date, or notes for a vendor quote.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Quote UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'currency', type: 'string', required: false, description: 'Updated currency' },
            { name: 'validUntil', type: 'string', required: false, description: 'Updated validity date (ISO 8601)', format: 'date' },
            { name: 'notes', type: 'string', required: false, description: 'Additional notes' },
          ],
        },
        example: { validUntil: '2025-05-31', notes: 'Price subject to steel index adjustment.' },
      },
      responses: [
        { statusCode: 200, description: 'Quote updated', example: { success: true, data: { id: 'quote-uuid', validUntil: '2025-05-31', currency: 'INR' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Quote not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/vendor-quotes/{quote_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"validUntil":"2025-05-31","notes":"Price subject to steel index adjustment."}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/vendor-quotes/\${quoteId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ validUntil: '2025-05-31', notes: 'Price subject to steel index adjustment.' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/vendor-quotes/{quote_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'validUntil': '2025-05-31', 'notes': 'Price subject to steel index adjustment.'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"validUntil":"2025-05-31","notes":"Price subject to steel index adjustment."}\`\nreq, _ := http.NewRequest("PUT", "${BASE_URL}/v1/vendor-quotes/"+quoteID, strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-quote',
      method: 'DELETE',
      path: '/v1/vendor-quotes/{id}',
      summary: 'Delete a quote',
      description: 'Permanently deletes a vendor quote and all its line items.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Quote UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Quote deleted', example: { success: true, message: 'Vendor quote deleted successfully' } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Quote not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/vendor-quotes/{quote_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/vendor-quotes/\${quoteId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/vendor-quotes/{quote_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/vendor-quotes/"+quoteID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'add-line-item',
      method: 'POST',
      path: '/v1/vendor-quotes/{id}/line-items',
      summary: 'Add a line item',
      description: 'Adds a quoted price for a BOM item to the vendor quote.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Quote UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Line item data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'bomItemId', type: 'string', required: true, description: 'BOM item UUID', format: 'uuid' },
            { name: 'unitPrice', type: 'number', required: true, description: 'Quoted unit price', example: 380.00 },
            { name: 'quantity', type: 'integer', required: false, description: 'Quoted quantity', example: 500 },
            { name: 'leadTimeDays', type: 'integer', required: false, description: 'Quoted lead time in days', example: 30 },
            { name: 'moq', type: 'integer', required: false, description: 'Minimum order quantity', example: 50 },
          ],
        },
        example: { bomItemId: 'item-uuid', unitPrice: 380.00, quantity: 500, leadTimeDays: 30, moq: 50 },
      },
      responses: [
        { statusCode: 201, description: 'Line item added', example: { success: true, data: { id: 'line-item-uuid', bomItemId: 'item-uuid', unitPrice: 380.00, leadTimeDays: 30 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Quote or BOM item not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/vendor-quotes/{quote_id}/line-items \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"bomItemId":"item-uuid","unitPrice":380.00,"leadTimeDays":30,"moq":50}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/vendor-quotes/\${quoteId}/line-items\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ bomItemId: 'item-uuid', unitPrice: 380.00, leadTimeDays: 30, moq: 50 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/vendor-quotes/{quote_id}/line-items',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'bomItemId': 'item-uuid', 'unitPrice': 380.00, 'leadTimeDays': 30, 'moq': 50},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"bomItemId":"item-uuid","unitPrice":380.00,"leadTimeDays":30,"moq":50}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/vendor-quotes/"+quoteID+"/line-items", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-line-item',
      method: 'PUT',
      path: '/v1/vendor-quotes/{id}/line-items/{lineItemId}',
      summary: 'Update a line item',
      description: 'Updates pricing, quantity, or lead time for a quote line item.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Quote UUID', format: 'uuid' },
        { name: 'lineItemId', in: 'path', type: 'string', required: true, description: 'Line item UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'unitPrice', type: 'number', required: false, description: 'Updated unit price' },
            { name: 'leadTimeDays', type: 'integer', required: false, description: 'Updated lead time' },
            { name: 'moq', type: 'integer', required: false, description: 'Updated minimum order quantity' },
          ],
        },
        example: { unitPrice: 365.00, leadTimeDays: 25 },
      },
      responses: [
        { statusCode: 200, description: 'Line item updated', example: { success: true, data: { id: 'line-item-uuid', unitPrice: 365.00, leadTimeDays: 25 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Quote or line item not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/vendor-quotes/{quote_id}/line-items/{line_item_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"unitPrice":365.00,"leadTimeDays":25}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/vendor-quotes/\${quoteId}/line-items/\${lineItemId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ unitPrice: 365.00, leadTimeDays: 25 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/vendor-quotes/{quote_id}/line-items/{line_item_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'unitPrice': 365.00, 'leadTimeDays': 25},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"unitPrice":365.00,"leadTimeDays":25}\`\nreq, _ := http.NewRequest("PUT", "${BASE_URL}/v1/vendor-quotes/"+quoteID+"/line-items/"+lineItemID, strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-line-item',
      method: 'DELETE',
      path: '/v1/vendor-quotes/{id}/line-items/{lineItemId}',
      summary: 'Delete a line item',
      description: 'Removes a line item from a vendor quote.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Quote UUID', format: 'uuid' },
        { name: 'lineItemId', in: 'path', type: 'string', required: true, description: 'Line item UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Line item deleted', example: { success: true, message: 'Line item removed from quote' } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Quote or line item not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/vendor-quotes/{quote_id}/line-items/{line_item_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/vendor-quotes/\${quoteId}/line-items/\${lineItemId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/vendor-quotes/{quote_id}/line-items/{line_item_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/vendor-quotes/"+quoteID+"/line-items/"+lineItemID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'submit-quote',
      method: 'POST',
      path: '/v1/vendor-quotes/{id}/submit',
      summary: 'Submit a quote for review',
      description: 'Transitions a vendor quote from draft to under_review, locking line items for review.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Quote UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Quote submitted', example: { success: true, data: { id: 'quote-uuid', status: 'under_review', submittedAt: '2025-03-05T10:00:00Z' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Quote not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Quote must be in draft status to submit' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/vendor-quotes/{quote_id}/submit \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/vendor-quotes/\${quoteId}/submit\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/vendor-quotes/{quote_id}/submit',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("POST", "${BASE_URL}/v1/vendor-quotes/"+quoteID+"/submit", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'approve-quote',
      method: 'POST',
      path: '/v1/vendor-quotes/{id}/approve',
      summary: 'Approve a quote',
      description: 'Approves a vendor quote that is under review.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Quote UUID', format: 'uuid' },
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
        example: { approverNotes: 'Competitive pricing and acceptable lead time. Approved.' },
      },
      responses: [
        { statusCode: 200, description: 'Quote approved', example: { success: true, data: { id: 'quote-uuid', status: 'approved', approvedAt: '2025-03-06T09:00:00Z' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Quote not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Quote must be under_review to approve' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/vendor-quotes/{quote_id}/approve \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"approverNotes":"Competitive pricing. Approved."}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/vendor-quotes/\${quoteId}/approve\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ approverNotes: 'Competitive pricing. Approved.' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/vendor-quotes/{quote_id}/approve',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'approverNotes': 'Competitive pricing. Approved.'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"approverNotes":"Competitive pricing. Approved."}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/vendor-quotes/"+quoteID+"/approve", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'reject-quote',
      method: 'POST',
      path: '/v1/vendor-quotes/{id}/reject',
      summary: 'Reject a quote',
      description: 'Rejects a vendor quote with a required rejection reason.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Quote UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Rejection data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'rejectionReason', type: 'string', required: true, description: 'Reason for rejecting the quote' },
          ],
        },
        example: { rejectionReason: 'Unit price exceeds budget by 22%. Please resubmit with revised pricing.' },
      },
      responses: [
        { statusCode: 200, description: 'Quote rejected', example: { success: true, data: { id: 'quote-uuid', status: 'rejected', rejectionReason: 'Unit price exceeds budget.' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Quote not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/vendor-quotes/{quote_id}/reject \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"rejectionReason":"Unit price exceeds budget."}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/vendor-quotes/\${quoteId}/reject\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ rejectionReason: 'Unit price exceeds budget.' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/vendor-quotes/{quote_id}/reject',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'rejectionReason': 'Unit price exceeds budget.'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"rejectionReason":"Unit price exceeds budget."}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/vendor-quotes/"+quoteID+"/reject", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'compare-quotes',
      method: 'GET',
      path: '/v1/vendor-quotes/comparison/{nominationId}/{bomItemId}',
      summary: 'Compare quotes side by side',
      description: 'Returns a side-by-side comparison of all vendor quotes for a specific BOM item within a nomination.',
      parameters: [
        { name: 'nominationId', in: 'path', type: 'string', required: true, description: 'Nomination UUID', format: 'uuid' },
        { name: 'bomItemId', in: 'path', type: 'string', required: true, description: 'BOM item UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Comparison retrieved', example: { success: true, data: { bomItemId: 'item-uuid', quotes: [{ vendorName: 'Acme Co.', unitPrice: 380, leadTimeDays: 30, totalScore: 87 }] } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Nomination or BOM item not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/vendor-quotes/comparison/{nomination_id}/{bom_item_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/vendor-quotes/comparison/\${nominationId}/\${bomItemId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/vendor-quotes/comparison/{nomination_id}/{bom_item_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/vendor-quotes/comparison/"+nominationID+"/"+bomItemID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-quote-dashboard',
      method: 'GET',
      path: '/v1/vendor-quotes/dashboard/nomination/{nominationId}',
      summary: 'Get quote dashboard',
      description: 'Returns a comprehensive summary dashboard for all quotes within a nomination including submission rates and score distribution.',
      parameters: [
        { name: 'nominationId', in: 'path', type: 'string', required: true, description: 'Nomination UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Dashboard retrieved', example: { success: true, data: { nominationId: 'nom-uuid', totalVendors: 4, submitted: 3, approved: 1, avgScore: 82.5 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Nomination not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/vendor-quotes/dashboard/nomination/{nomination_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/vendor-quotes/dashboard/nomination/\${nominationId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/vendor-quotes/dashboard/nomination/{nomination_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/vendor-quotes/dashboard/nomination/"+nominationID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
  ],
};
