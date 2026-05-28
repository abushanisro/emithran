import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const rawMaterialsGroup: ResourceGroup = {
  id: 'raw-materials',
  label: 'Raw Materials',
  description: 'Manage the raw material cost database. Materials are linked to BOM items and used in cost roll-up calculations.',
  icon: 'Database',
  endpoints: [
    {
      id: 'list-raw-materials',
      method: 'GET',
      path: '/v1/api/raw-materials',
      summary: 'List raw materials',
      description: 'Returns the raw material cost database with pricing, density, and specification data.',
      parameters: [
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Results per page', default: 20 },
        { name: 'search', in: 'query', type: 'string', required: false, description: 'Search by material name or grade' },
        { name: 'category', in: 'query', type: 'string', required: false, description: 'Material category', enum: ['steel', 'aluminium', 'copper', 'plastic', 'rubber', 'other'] },
      ],
      responses: [
        { statusCode: 200, description: 'Materials retrieved', example: { success: true, data: { materials: [{ id: 'mat-uuid', name: 'EN8 Steel', grade: 'EN8', density: 7.85, pricePerKg: 85.50, currency: 'INR' }], total: 120 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/raw-materials \\\n  -H "Authorization: Bearer {token}" \\\n  -d "category=steel&search=EN8"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/raw-materials?category=steel\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/raw-materials',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'category': 'steel'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/raw-materials?category=steel", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-raw-material',
      method: 'POST',
      path: '/v1/api/raw-materials',
      summary: 'Create a raw material',
      description: 'Adds a new material to the raw material cost database with pricing, density, and specification data.',
      parameters: [],
      requestBody: {
        description: 'Material data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: true, description: 'Material name', example: 'EN8 Steel' },
            { name: 'grade', type: 'string', required: true, description: 'Material grade/specification', example: 'EN8' },
            { name: 'category', type: 'string', required: true, description: 'Category', example: 'steel' },
            { name: 'density', type: 'number', required: true, description: 'Density in g/cm³', example: 7.85 },
            { name: 'pricePerKg', type: 'number', required: true, description: 'Price per kilogram', example: 85.50 },
            { name: 'currency', type: 'string', required: false, description: 'Currency code', example: 'INR' },
          ],
        },
        example: { name: 'EN8 Steel', grade: 'EN8', category: 'steel', density: 7.85, pricePerKg: 85.50, currency: 'INR' },
      },
      responses: [
        { statusCode: 201, description: 'Material created', example: { success: true, data: { id: 'mat-uuid', name: 'EN8 Steel', grade: 'EN8', pricePerKg: 85.50 } } },
      ],
      errors: [{ statusCode: 409, code: 'CONFLICT', description: 'Material with this name and grade already exists' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/raw-materials \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"EN8 Steel","grade":"EN8","category":"steel","density":7.85,"pricePerKg":85.50}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/raw-materials', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ name: 'EN8 Steel', grade: 'EN8', category: 'steel', density: 7.85, pricePerKg: 85.50 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/raw-materials',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'name': 'EN8 Steel', 'grade': 'EN8', 'category': 'steel', 'density': 7.85, 'pricePerKg': 85.50},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"name":"EN8 Steel","grade":"EN8","category":"steel","density":7.85,"pricePerKg":85.50}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/raw-materials", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-raw-material',
      method: 'GET',
      path: '/v1/api/raw-materials/{id}',
      summary: 'Retrieve a raw material',
      description: 'Returns full specification and pricing details for a single raw material record.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Material UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Material retrieved', example: { success: true, data: { id: 'mat-uuid', name: 'EN8 Steel', grade: 'EN8', density: 7.85, pricePerKg: 85.50, currency: 'INR', updatedAt: '2025-01-15T10:00:00Z' } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Material not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/raw-materials/{material_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/raw-materials/\${materialId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/raw-materials/{material_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/raw-materials/"+materialID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-raw-material',
      method: 'PUT',
      path: '/v1/api/raw-materials/{id}',
      summary: 'Update a raw material',
      description: 'Updates the pricing, density, or specification of an existing raw material.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Material UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'pricePerKg', type: 'number', required: false, description: 'Updated price per kg', example: 90.00 },
            { name: 'density', type: 'number', required: false, description: 'Updated density in g/cm³' },
          ],
        },
        example: { pricePerKg: 90.00 },
      },
      responses: [
        { statusCode: 200, description: 'Material updated', example: { success: true, data: { id: 'mat-uuid', pricePerKg: 90.00, updatedAt: '2025-05-01T12:00:00Z' } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Material not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/raw-materials/{material_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"pricePerKg":90.00}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/raw-materials/\${materialId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ pricePerKg: 90.00 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/raw-materials/{material_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'pricePerKg': 90.00},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/raw-materials/"+materialID, strings.NewReader(\`{"pricePerKg":90.00}\`))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'calculate-material-cost',
      method: 'POST',
      path: '/v1/api/raw-materials/calculate',
      summary: 'Calculate material cost',
      description: 'Calculates the raw material cost for a part based on weight, density, scrap rate, and current material price.',
      parameters: [],
      requestBody: {
        description: 'Calculation inputs',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'materialId', type: 'string', required: true, description: 'Material UUID', format: 'uuid' },
            { name: 'partWeight', type: 'number', required: true, description: 'Finished part weight in kg', example: 2.5 },
            { name: 'scrapRate', type: 'number', required: false, description: 'Scrap/yield loss percentage (0-100)', example: 15 },
            { name: 'quantity', type: 'integer', required: false, description: 'Number of parts', default: 1 },
          ],
        },
        example: { materialId: 'mat-uuid', partWeight: 2.5, scrapRate: 15, quantity: 100 },
      },
      responses: [
        { statusCode: 200, description: 'Cost calculated', example: { success: true, data: { materialCostPerUnit: 246.33, totalMaterialCost: 24633, grossWeight: 2.875, materialName: 'EN8 Steel' } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Material not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/raw-materials/calculate \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"materialId":"mat-uuid","partWeight":2.5,"scrapRate":15,"quantity":100}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/raw-materials/calculate', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ materialId: 'mat-uuid', partWeight: 2.5, scrapRate: 15, quantity: 100 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/raw-materials/calculate',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'materialId': 'mat-uuid', 'partWeight': 2.5, 'scrapRate': 15, 'quantity': 100},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"materialId":"mat-uuid","partWeight":2.5,"scrapRate":15,"quantity":100}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/raw-materials/calculate", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
  ],
};
