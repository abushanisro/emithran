import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const bomItemsGroup: ResourceGroup = {
  id: 'bom-items',
  label: 'BOM Items',
  description: 'Manage individual components and sub-assemblies within a BOM. Each item tracks part numbers, quantities, and cost data.',
  icon: 'List',
  endpoints: [
    {
      id: 'list-bom-items',
      method: 'GET',
      path: '/v1/api/bom-items',
      summary: 'List BOM items',
      description: 'Returns all items for a specific BOM, including cost roll-up data.',
      parameters: [
        { name: 'bomId', in: 'query', type: 'string', required: true, description: 'Parent BOM UUID', format: 'uuid' },
        { name: 'parentItemId', in: 'query', type: 'string', required: false, description: 'Filter by parent item (for sub-assemblies)' },
      ],
      responses: [
        {
          statusCode: 200,
          description: 'BOM items retrieved',
          example: { success: true, data: { items: [{ id: 'item-uuid', partNumber: 'ENG-001', description: 'Cylinder Block', quantity: 1, unitCost: 220.50 }] } },
        },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'BOM not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/bom-items \\\n  -H "Authorization: Bearer {token}" \\\n  -d "bomId=bom-uuid"` },
        { language: 'javascript', label: 'JavaScript', code: `const params = new URLSearchParams({ bomId: 'bom-uuid' });\nconst response = await fetch(\`${BASE_URL}/v1/api/bom-items?\${params}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/bom-items',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'bomId': 'bom-uuid'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/bom-items?bomId=bom-uuid", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-bom-item',
      method: 'POST',
      path: '/v1/api/bom-items',
      summary: 'Add a BOM item',
      description: 'Adds a component or sub-assembly to a BOM. Set parentItemId to nest items within a sub-assembly.',
      parameters: [],
      requestBody: {
        description: 'BOM item data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'bomId', type: 'string', required: true, description: 'Parent BOM UUID', format: 'uuid' },
            { name: 'partNumber', type: 'string', required: true, description: 'Part number or SKU', example: 'ENG-001' },
            { name: 'description', type: 'string', required: true, description: 'Part description', example: 'Cylinder Block' },
            { name: 'quantity', type: 'number', required: true, description: 'Quantity per assembly', example: 1 },
            { name: 'unit', type: 'string', required: false, description: 'Unit of measure', example: 'EA' },
            { name: 'parentItemId', type: 'string', required: false, description: 'Parent item UUID for sub-assemblies' },
            { name: 'materialId', type: 'string', required: false, description: 'Link to raw material UUID' },
          ],
        },
        example: { bomId: 'bom-uuid', partNumber: 'ENG-001', description: 'Cylinder Block', quantity: 1, unit: 'EA' },
      },
      responses: [{ statusCode: 201, description: 'Item added', example: { success: true, data: { id: 'item-uuid', partNumber: 'ENG-001', quantity: 1 } } }],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'BOM or parent item not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/bom-items \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"bomId":"bom-uuid","partNumber":"ENG-001","description":"Cylinder Block","quantity":1,"unit":"EA"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/bom-items', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ bomId: 'bom-uuid', partNumber: 'ENG-001', description: 'Cylinder Block', quantity: 1 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/bom-items',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'bomId': 'bom-uuid', 'partNumber': 'ENG-001', 'description': 'Cylinder Block', 'quantity': 1},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"bomId":"bom-uuid","partNumber":"ENG-001","description":"Cylinder Block","quantity":1}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/bom-items", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-bom-item',
      method: 'GET',
      path: '/v1/api/bom-items/{id}',
      summary: 'Retrieve a BOM item',
      description: 'Returns a single BOM item with its cost breakdown and child items.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'BOM item UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Item retrieved', example: { success: true, data: { id: 'item-uuid', partNumber: 'ENG-001', description: 'Cylinder Block', quantity: 1, unitCost: 220.50, children: [] } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'BOM item not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/bom-items/{item_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/bom-items/\${itemId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/bom-items/{item_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/bom-items/"+itemID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-bom-item',
      method: 'PATCH',
      path: '/v1/api/bom-items/{id}',
      summary: 'Update a BOM item',
      description: 'Updates part data, quantity, or cost overrides for an existing BOM item.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'BOM item UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'quantity', type: 'number', required: false, description: 'Updated quantity', example: 2 },
            { name: 'unitCost', type: 'number', required: false, description: 'Manual cost override per unit', example: 215.00 },
            { name: 'description', type: 'string', required: false, description: 'Updated part description' },
          ],
        },
        example: { quantity: 2, unitCost: 215.00 },
      },
      responses: [
        { statusCode: 200, description: 'Item updated', example: { success: true, data: { id: 'item-uuid', quantity: 2, unitCost: 215.00 } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'BOM item not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PATCH ${BASE_URL}/v1/api/bom-items/{item_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"quantity":2,"unitCost":215.00}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/bom-items/\${itemId}\`, {\n  method: 'PATCH',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ quantity: 2, unitCost: 215.00 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.patch(\n    f'${BASE_URL}/v1/api/bom-items/{item_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'quantity': 2, 'unitCost': 215.00},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"quantity":2,"unitCost":215.00}\`\nreq, _ := http.NewRequest("PATCH", "${BASE_URL}/v1/api/bom-items/"+itemID, strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-bom-item',
      method: 'DELETE',
      path: '/v1/api/bom-items/{id}',
      summary: 'Remove a BOM item',
      description: 'Removes a component from the BOM. Child items are also removed recursively.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'BOM item UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Item removed', example: { success: true, message: 'BOM item removed' } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'BOM item not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/bom-items/{item_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/bom-items/\${itemId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/bom-items/{item_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/bom-items/"+itemID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'analyze-bom-item-cad',
      method: 'POST',
      path: '/v1/api/bom-items/{id}/analyze-cad',
      summary: 'Analyze CAD file for BOM item',
      description: 'Runs advanced CAD analysis on a STEP file associated with a BOM item. Extracts geometry, volume, surface area, and dimensional data to assist with cost estimation.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'BOM item UUID', format: 'uuid', example: 'item-uuid' },
      ],
      requestBody: {
        description: 'CAD analysis options',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'strategy', type: 'string', required: false, description: 'Analysis strategy', enum: ['basic', 'detailed', 'full'], default: 'basic' },
            { name: 'extractFeatures', type: 'boolean', required: false, description: 'Extract manufacturing features', default: false },
          ],
        },
        example: { strategy: 'detailed', extractFeatures: true },
      },
      responses: [
        {
          statusCode: 200,
          description: 'CAD analysis complete',
          example: {
            success: true,
            data: {
              itemId: 'item-uuid',
              volumeCm3: 603.19,
              surfaceAreaCm2: 1248.6,
              boundingBox: { x: 80, y: 120, z: 45 },
              estimatedWeight: 4.74,
              features: { holes: 12, threads: 4, pockets: 2 },
            },
          },
        },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'BOM item not found or no CAD file attached' },
        { statusCode: 422, code: 'PROCESSING_ERROR', description: 'CAD file could not be processed' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/bom-items/{item_id}/analyze-cad \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"strategy":"detailed","extractFeatures":true}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/bom-items/\${itemId}/analyze-cad\`, {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ strategy: 'detailed', extractFeatures: true }),\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.post(\n    f'${BASE_URL}/v1/api/bom-items/{item_id}/analyze-cad',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'strategy': 'detailed', 'extractFeatures': True},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"strategy":"detailed","extractFeatures":true}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/bom-items/"+itemID+"/analyze-cad", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'process-step-file',
      method: 'POST',
      path: '/v1/api/bom-items/process-step-file',
      summary: 'Process STEP file',
      description: 'Uploads and processes a STEP file to generate an assembly tree. Automatically creates BOM items from the STEP assembly hierarchy.',
      parameters: [],
      contentType: 'multipart/form-data',
      requestBody: {
        description: 'STEP file upload',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'file', type: 'string', required: true, description: 'STEP (.step or .stp) file', format: 'binary' },
            { name: 'bomId', type: 'string', required: true, description: 'Target BOM UUID to import into', format: 'uuid' },
          ],
        },
        example: { bomId: 'bom-uuid' },
      },
      responses: [
        {
          statusCode: 200,
          description: 'STEP file processed',
          example: {
            success: true,
            data: {
              bomId: 'bom-uuid',
              itemsCreated: 12,
              assemblyTree: [{ partNumber: 'ASSY-001', description: 'Main Assembly', children: [] }],
            },
          },
        },
      ],
      errors: [
        { statusCode: 400, code: 'INVALID_FILE', description: 'File is not a valid STEP format' },
        { statusCode: 404, code: 'NOT_FOUND', description: 'BOM not found' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/bom-items/process-step-file \\\n  -H "Authorization: Bearer {token}" \\\n  -F "file=@assembly.step" \\\n  -F "bomId=bom-uuid"` },
        { language: 'javascript', label: 'JavaScript', code: `const formData = new FormData();\nformData.append('file', stepFile);\nformData.append('bomId', 'bom-uuid');\nconst response = await fetch('${BASE_URL}/v1/api/bom-items/process-step-file', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\` },\n  body: formData,\n});` },
        { language: 'python', label: 'Python', code: `with open('assembly.step', 'rb') as f:\n    response = requests.post(\n        '${BASE_URL}/v1/api/bom-items/process-step-file',\n        headers={'Authorization': f'Bearer {token}'},\n        files={'file': f},\n        data={'bomId': 'bom-uuid'},\n    )` },
        { language: 'go', label: 'Go', code: `// Use multipart form\nbody := &bytes.Buffer{}\nwriter := multipart.NewWriter(body)\npart, _ := writer.CreateFormFile("file", "assembly.step")\n// copy file content to part\nwriter.WriteField("bomId", "bom-uuid")\nwriter.Close()\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/bom-items/process-step-file", body)\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", writer.FormDataContentType())` },
      ],
      requiresAuth: true,
    },
  ],
};
