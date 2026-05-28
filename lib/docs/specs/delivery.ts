import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const deliveryGroup: ResourceGroup = {
  id: 'delivery',
  label: 'Delivery & Invoicing',
  description: 'Manage delivery orders, shipment tracking, and invoice generation for production lots.',
  icon: 'Truck',
  endpoints: [
    {
      id: 'list-delivery-orders',
      method: 'GET',
      path: '/v1/api/delivery/orders',
      summary: 'List delivery orders',
      description: 'Returns a paginated list of delivery orders, optionally filtered by status and project.',
      parameters: [
        { name: 'status', in: 'query', type: 'string', required: false, description: 'Filter by delivery status', enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'] },
        { name: 'projectId', in: 'query', type: 'string', required: false, description: 'Filter by project UUID', format: 'uuid' },
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Results per page', default: 20 },
      ],
      responses: [
        { statusCode: 200, description: 'Delivery orders retrieved', example: { success: true, data: { orders: [{ id: 'order-uuid', orderNumber: 'DO-2025-001', status: 'confirmed', deliveryDate: '2025-03-15', totalItems: 5 }], total: 34 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/delivery/orders \\\n  -H "Authorization: Bearer {token}" \\\n  -d "status=confirmed&projectId=proj-uuid"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/delivery/orders?status=confirmed&projectId=proj-uuid\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/delivery/orders',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'status': 'confirmed', 'projectId': 'proj-uuid'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/delivery/orders?status=confirmed&projectId=proj-uuid", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-delivery-order',
      method: 'POST',
      path: '/v1/api/delivery/orders',
      summary: 'Create a delivery order',
      description: 'Creates a new delivery order for a project lot, specifying items and quantities to be delivered.',
      parameters: [],
      requestBody: {
        description: 'Delivery order data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'projectId', type: 'string', required: true, description: 'Project UUID', format: 'uuid' },
            { name: 'lotId', type: 'string', required: false, description: 'Production lot UUID', format: 'uuid' },
            { name: 'vendorId', type: 'string', required: false, description: 'Vendor UUID', format: 'uuid' },
            { name: 'deliveryDate', type: 'string', required: false, description: 'Scheduled delivery date (ISO 8601)', format: 'date', example: '2025-03-15' },
            {
              name: 'items',
              type: 'array',
              required: false,
              description: 'Line items to deliver',
              items: {
                name: 'item',
                type: 'object',
                properties: [
                  { name: 'bomItemId', type: 'string', required: true, description: 'BOM item UUID', format: 'uuid' },
                  { name: 'quantity', type: 'integer', required: true, description: 'Quantity to deliver', example: 100 },
                ],
              },
            },
          ],
        },
        example: { projectId: 'proj-uuid', lotId: 'lot-uuid', deliveryDate: '2025-03-15', items: [{ bomItemId: 'item-uuid', quantity: 100 }] },
      },
      responses: [
        { statusCode: 201, description: 'Delivery order created', example: { success: true, data: { id: 'order-uuid', orderNumber: 'DO-2025-001', status: 'pending', deliveryDate: '2025-03-15', totalItems: 1 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Project, lot, or BOM item not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/delivery/orders \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"projectId":"proj-uuid","lotId":"lot-uuid","deliveryDate":"2025-03-15","items":[{"bomItemId":"item-uuid","quantity":100}]}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/delivery/orders', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ projectId: 'proj-uuid', lotId: 'lot-uuid', deliveryDate: '2025-03-15', items: [{ bomItemId: 'item-uuid', quantity: 100 }] }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/delivery/orders',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'projectId': 'proj-uuid', 'lotId': 'lot-uuid', 'deliveryDate': '2025-03-15', 'items': [{'bomItemId': 'item-uuid', 'quantity': 100}]},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"projectId":"proj-uuid","lotId":"lot-uuid","deliveryDate":"2025-03-15","items":[{"bomItemId":"item-uuid","quantity":100}]}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/delivery/orders", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-delivery-order',
      method: 'GET',
      path: '/v1/api/delivery/orders/{id}',
      summary: 'Retrieve a delivery order',
      description: 'Returns full details for a single delivery order including line items and tracking events.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Delivery order UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Delivery order retrieved', example: { success: true, data: { id: 'order-uuid', orderNumber: 'DO-2025-001', status: 'confirmed', deliveryDate: '2025-03-15', totalItems: 5 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Delivery order not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/delivery/orders/{order_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/delivery/orders/\${orderId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/delivery/orders/{order_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/delivery/orders/"+orderID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-delivery-order',
      method: 'PUT',
      path: '/v1/api/delivery/orders/{id}',
      summary: 'Update a delivery order',
      description: 'Updates the status, delivery date, or notes for a delivery order.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Delivery order UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'status', type: 'string', required: false, description: 'Updated status', enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'] },
            { name: 'deliveryDate', type: 'string', required: false, description: 'Updated delivery date (ISO 8601)', format: 'date' },
            { name: 'notes', type: 'string', required: false, description: 'Additional notes' },
          ],
        },
        example: { status: 'confirmed', deliveryDate: '2025-03-20' },
      },
      responses: [
        { statusCode: 200, description: 'Delivery order updated', example: { success: true, data: { id: 'order-uuid', status: 'confirmed', deliveryDate: '2025-03-20' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Delivery order not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/delivery/orders/{order_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"status":"confirmed","deliveryDate":"2025-03-20"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/delivery/orders/\${orderId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ status: 'confirmed', deliveryDate: '2025-03-20' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/delivery/orders/{order_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'status': 'confirmed', 'deliveryDate': '2025-03-20'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"status":"confirmed","deliveryDate":"2025-03-20"}\`\nreq, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/delivery/orders/"+orderID, strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'cancel-delivery-order',
      method: 'DELETE',
      path: '/v1/api/delivery/orders/{id}',
      summary: 'Cancel a delivery order',
      description: 'Cancels and removes a delivery order. Only orders in pending or confirmed status can be cancelled.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Delivery order UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Delivery order cancelled', example: { success: true, message: 'Delivery order cancelled successfully' } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Delivery order not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Cannot cancel an order that has already been shipped or delivered' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/delivery/orders/{order_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/delivery/orders/\${orderId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/delivery/orders/{order_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/delivery/orders/"+orderID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-available-items',
      method: 'GET',
      path: '/v1/api/delivery/available-items/{projectId}',
      summary: 'Get available items for delivery',
      description: 'Returns BOM items for a project that are ready for delivery (production complete, not yet delivered).',
      parameters: [
        { name: 'projectId', in: 'path', type: 'string', required: true, description: 'Project UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Available items retrieved', example: { success: true, data: { items: [{ bomItemId: 'item-uuid', partNumber: 'ENG-001', availableQty: 500, unit: 'EA' }] } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Project not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/delivery/available-items/{project_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/delivery/available-items/\${projectId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/delivery/available-items/{project_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/delivery/available-items/"+projectID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'add-tracking-event',
      method: 'POST',
      path: '/v1/api/delivery/tracking',
      summary: 'Add tracking event',
      description: 'Records a shipment tracking event for a delivery order.',
      parameters: [],
      requestBody: {
        description: 'Tracking event data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'orderId', type: 'string', required: true, description: 'Delivery order UUID', format: 'uuid' },
            { name: 'event', type: 'string', required: true, description: 'Tracking event type', enum: ['dispatched', 'in_transit', 'out_for_delivery', 'delivered'] },
            { name: 'notes', type: 'string', required: false, description: 'Event notes or description' },
            { name: 'location', type: 'string', required: false, description: 'Current location of the shipment', example: 'Mumbai Port' },
          ],
        },
        example: { orderId: 'order-uuid', event: 'in_transit', notes: 'Package in transit via road freight.', location: 'Mumbai Port' },
      },
      responses: [
        { statusCode: 201, description: 'Tracking event recorded', example: { success: true, data: { id: 'track-uuid', orderId: 'order-uuid', event: 'in_transit', location: 'Mumbai Port', timestamp: '2025-03-12T08:00:00Z' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Delivery order not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/delivery/tracking \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"orderId":"order-uuid","event":"in_transit","location":"Mumbai Port"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/delivery/tracking', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ orderId: 'order-uuid', event: 'in_transit', location: 'Mumbai Port' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/delivery/tracking',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'orderId': 'order-uuid', 'event': 'in_transit', 'location': 'Mumbai Port'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"orderId":"order-uuid","event":"in_transit","location":"Mumbai Port"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/delivery/tracking", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-delivery-metrics',
      method: 'GET',
      path: '/v1/api/delivery/metrics',
      summary: 'Get delivery metrics',
      description: 'Returns aggregated delivery performance metrics including on-time delivery rate and average lead time.',
      parameters: [],
      responses: [
        { statusCode: 200, description: 'Delivery metrics retrieved', example: { success: true, data: { onTimeDeliveryRate: 92.5, avgLeadTimeDays: 18 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/delivery/metrics \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/delivery/metrics', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    '${BASE_URL}/v1/api/delivery/metrics',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/delivery/metrics", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-invoice',
      method: 'POST',
      path: '/v1/api/delivery/invoices/from-delivery/{deliveryOrderId}',
      summary: 'Generate invoice from delivery order',
      description: 'Automatically generates an invoice from a delivered order, pulling line items and prices.',
      parameters: [
        { name: 'deliveryOrderId', in: 'path', type: 'string', required: true, description: 'Delivery order UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 201, description: 'Invoice generated', example: { success: true, data: { id: 'inv-uuid', invoiceNumber: 'INV-2025-001', amount: 182160, currency: 'INR', status: 'draft', dueDate: '2025-04-01' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Delivery order not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Invoice already exists for this delivery order' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/delivery/invoices/from-delivery/{delivery_order_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/delivery/invoices/from-delivery/\${deliveryOrderId}\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/delivery/invoices/from-delivery/{delivery_order_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/delivery/invoices/from-delivery/"+deliveryOrderID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'list-invoices',
      method: 'GET',
      path: '/v1/api/invoices',
      summary: 'List invoices',
      description: 'Returns a paginated list of invoices, optionally filtered by project and payment status.',
      parameters: [
        { name: 'projectId', in: 'query', type: 'string', required: false, description: 'Filter by project UUID', format: 'uuid' },
        { name: 'status', in: 'query', type: 'string', required: false, description: 'Filter by invoice status', enum: ['draft', 'sent', 'paid', 'overdue'] },
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Results per page', default: 20 },
      ],
      responses: [
        { statusCode: 200, description: 'Invoices retrieved', example: { success: true, data: { invoices: [{ id: 'inv-uuid', invoiceNumber: 'INV-2025-001', amount: 182160, currency: 'INR', status: 'sent', dueDate: '2025-04-01' }], total: 45 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/invoices \\\n  -H "Authorization: Bearer {token}" \\\n  -d "projectId=proj-uuid&status=sent"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/invoices?projectId=proj-uuid&status=sent\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    '${BASE_URL}/v1/api/invoices',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'projectId': 'proj-uuid', 'status': 'sent'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/invoices?projectId=proj-uuid&status=sent", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-invoice-status',
      method: 'PUT',
      path: '/v1/api/invoices/{id}/status',
      summary: 'Update invoice status',
      description: 'Updates the status of an invoice (e.g., from draft to sent, or to mark as overdue).',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Invoice UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Status update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'status', type: 'string', required: true, description: 'New invoice status', enum: ['draft', 'sent', 'paid', 'overdue'] },
          ],
        },
        example: { status: 'sent' },
      },
      responses: [
        { statusCode: 200, description: 'Invoice status updated', example: { success: true, data: { id: 'inv-uuid', status: 'sent' } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Invoice not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/invoices/{invoice_id}/status \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"status":"sent"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/invoices/\${invoiceId}/status\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ status: 'sent' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/invoices/{invoice_id}/status',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'status': 'sent'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"status":"sent"}\`\nreq, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/invoices/"+invoiceID+"/status", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'record-payment',
      method: 'POST',
      path: '/v1/api/invoices/{id}/payment',
      summary: 'Record invoice payment',
      description: 'Records a payment against an invoice, including amount, date, and payment method.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Invoice UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Payment data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'amount', type: 'number', required: true, description: 'Payment amount', example: 182160 },
            { name: 'paymentDate', type: 'string', required: true, description: 'Date payment was received (ISO 8601)', format: 'date', example: '2025-03-28' },
            { name: 'paymentMethod', type: 'string', required: false, description: 'Payment method', example: 'NEFT' },
            { name: 'reference', type: 'string', required: false, description: 'Payment reference or transaction ID', example: 'TXN2025032800123' },
          ],
        },
        example: { amount: 182160, paymentDate: '2025-03-28', paymentMethod: 'NEFT', reference: 'TXN2025032800123' },
      },
      responses: [
        { statusCode: 200, description: 'Payment recorded', example: { success: true, data: { id: 'inv-uuid', status: 'paid', paidAt: '2025-03-28', paidAmount: 182160 } } },
      ],
      errors: [
        { statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'Invoice not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/invoices/{invoice_id}/payment \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"amount":182160,"paymentDate":"2025-03-28","paymentMethod":"NEFT","reference":"TXN2025032800123"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/invoices/\${invoiceId}/payment\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ amount: 182160, paymentDate: '2025-03-28', paymentMethod: 'NEFT', reference: 'TXN2025032800123' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    f'${BASE_URL}/v1/api/invoices/{invoice_id}/payment',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'amount': 182160, 'paymentDate': '2025-03-28', 'paymentMethod': 'NEFT', 'reference': 'TXN2025032800123'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"amount":182160,"paymentDate":"2025-03-28","paymentMethod":"NEFT","reference":"TXN2025032800123"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/invoices/"+invoiceID+"/payment", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-invoice-metrics',
      method: 'GET',
      path: '/v1/api/invoices/metrics/summary',
      summary: 'Get invoice metrics',
      description: 'Returns a summary of invoice financials including outstanding amounts, paid count, and overdue count.',
      parameters: [],
      responses: [
        { statusCode: 200, description: 'Invoice metrics retrieved', example: { success: true, data: { total_outstanding: 4820000, paid_count: 38, overdue_count: 3 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/invoices/metrics/summary \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/invoices/metrics/summary', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    '${BASE_URL}/v1/api/invoices/metrics/summary',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/invoices/metrics/summary", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
  ],
};
