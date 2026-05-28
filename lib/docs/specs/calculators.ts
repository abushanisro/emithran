import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const calculatorsGroup: ResourceGroup = {
  id: 'calculators',
  label: 'Calculators',
  description: 'Multi-purpose manufacturing cost calculators for overhead, amortization, tooling, and should-cost analysis.',
  icon: 'Sigma',
  endpoints: [
    {
      id: 'should-cost',
      method: 'POST',
      path: '/v1/api/calculators/should-cost',
      summary: 'Should-cost analysis',
      description: 'Runs a complete should-cost calculation for a BOM, rolling up material, process, tooling, and overhead costs.',
      parameters: [],
      requestBody: {
        description: 'Should-cost inputs',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'bomId', type: 'string', required: true, description: 'BOM UUID to analyze', format: 'uuid' },
            { name: 'quantity', type: 'integer', required: true, description: 'Production quantity for amortization', example: 1000 },
            { name: 'overheadRate', type: 'number', required: false, description: 'Overhead rate percentage', example: 15 },
            { name: 'profitMargin', type: 'number', required: false, description: 'Target profit margin percentage', example: 20 },
          ],
        },
        example: { bomId: 'bom-uuid', quantity: 1000, overheadRate: 15, profitMargin: 20 },
      },
      responses: [
        {
          statusCode: 200,
          description: 'Should-cost calculated',
          example: {
            success: true,
            data: {
              materialCost: 220.50,
              processCost: 84.30,
              toolingCost: 12.00,
              overheadCost: 47.52,
              totalCost: 364.32,
              targetSellingPrice: 437.18,
            },
          },
        },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'BOM not found' }],
      examples: [
        {
          language: 'curl',
          label: 'cURL',
          code: `curl -X POST ${BASE_URL}/v1/api/calculators/should-cost \\
  -H "Authorization: Bearer {token}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "bomId": "bom-uuid",
    "quantity": 1000,
    "overheadRate": 15,
    "profitMargin": 20
  }'`,
        },
        {
          language: 'javascript',
          label: 'JavaScript',
          code: `const response = await fetch('${BASE_URL}/v1/api/calculators/should-cost', {
  method: 'POST',
  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ bomId: 'bom-uuid', quantity: 1000, overheadRate: 15, profitMargin: 20 }),
});
const { data } = await response.json();
console.log('Total cost per unit:', data.totalCost);`,
        },
        {
          language: 'python',
          label: 'Python',
          code: `import requests

response = requests.post(
    '${BASE_URL}/v1/api/calculators/should-cost',
    headers={'Authorization': f'Bearer {token}'},
    json={
        'bomId': 'bom-uuid',
        'quantity': 1000,
        'overheadRate': 15,
        'profitMargin': 20,
    },
)
result = response.json()['data']
print(f"Total cost: {result['totalCost']}")`,
        },
        {
          language: 'go',
          label: 'Go',
          code: `payload := \`{"bomId":"bom-uuid","quantity":1000,"overheadRate":15,"profitMargin":20}\`
req, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/calculators/should-cost", strings.NewReader(payload))
req.Header.Set("Authorization", "Bearer "+token)
req.Header.Set("Content-Type", "application/json")`,
        },
      ],
      requiresAuth: true,
    },
    {
      id: 'overhead-calculator',
      method: 'POST',
      path: '/v1/api/calculators/overhead',
      summary: 'Calculate overhead cost',
      description: 'Calculates factory overhead allocation for a part based on direct costs and an overhead absorption rate.',
      parameters: [],
      requestBody: {
        description: 'Overhead calculation inputs',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'directMaterialCost', type: 'number', required: true, description: 'Direct material cost per unit', example: 220.50 },
            { name: 'directLaborCost', type: 'number', required: true, description: 'Direct labor cost per unit', example: 42.00 },
            { name: 'overheadRate', type: 'number', required: true, description: 'Overhead absorption rate percentage', example: 15 },
          ],
        },
        example: { directMaterialCost: 220.50, directLaborCost: 42.00, overheadRate: 15 },
      },
      responses: [
        { statusCode: 200, description: 'Overhead calculated', example: { success: true, data: { directCost: 262.50, overheadCost: 39.38, totalCostWithOverhead: 301.88 } } },
      ],
      errors: [],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/calculators/overhead \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"directMaterialCost":220.50,"directLaborCost":42.00,"overheadRate":15}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/calculators/overhead', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ directMaterialCost: 220.50, directLaborCost: 42.00, overheadRate: 15 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/calculators/overhead',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'directMaterialCost': 220.50, 'directLaborCost': 42.00, 'overheadRate': 15},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"directMaterialCost":220.50,"directLaborCost":42.00,"overheadRate":15}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/calculators/overhead", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'weight-calculator',
      method: 'POST',
      path: '/v1/api/calculators/weight',
      summary: 'Calculate part weight',
      description: 'Estimates part weight from volume and material density. Supports box, cylinder, sphere, and hollow-tube geometries.',
      parameters: [],
      requestBody: {
        description: 'Part geometry inputs',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'geometry', type: 'string', required: true, description: 'Shape type', enum: ['box', 'cylinder', 'sphere', 'hollow_tube'] },
            { name: 'dimensions', type: 'object', required: true, description: 'Geometry dimensions in mm' },
            { name: 'density', type: 'number', required: true, description: 'Material density in g/cm³', example: 7.85 },
            { name: 'scrapRate', type: 'number', required: false, description: 'Scrap/machining allowance percentage', example: 20 },
          ],
        },
        example: { geometry: 'cylinder', dimensions: { diameter: 80, height: 120 }, density: 7.85, scrapRate: 20 },
      },
      responses: [
        { statusCode: 200, description: 'Weight calculated', example: { success: true, data: { volumeCm3: 603.19, finishedWeightKg: 4.74, grossWeightKg: 5.68, density: 7.85 } } },
      ],
      errors: [{ statusCode: 400, code: 'INVALID_GEOMETRY', description: 'Invalid geometry or missing required dimensions' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/calculators/weight \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"geometry":"cylinder","dimensions":{"diameter":80,"height":120},"density":7.85,"scrapRate":20}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/calculators/weight', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ geometry: 'cylinder', dimensions: { diameter: 80, height: 120 }, density: 7.85, scrapRate: 20 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/calculators/weight',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'geometry': 'cylinder', 'dimensions': {'diameter': 80, 'height': 120}, 'density': 7.85, 'scrapRate': 20},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"geometry":"cylinder","dimensions":{"diameter":80,"height":120},"density":7.85,"scrapRate":20}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/calculators/weight", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'piece-part-cost',
      method: 'POST',
      path: '/v1/api/calculators/piece-part',
      summary: 'Piece-part cost summary',
      description: 'Aggregates material, process, tooling, packaging, and overhead into a complete piece-part cost summary for a given BOM item.',
      parameters: [],
      requestBody: {
        description: 'Piece-part cost inputs',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'bomItemId', type: 'string', required: true, description: 'BOM item UUID', format: 'uuid' },
            { name: 'quantity', type: 'integer', required: true, description: 'Production quantity', example: 1000 },
            { name: 'overheadRate', type: 'number', required: false, description: 'Overhead rate %', example: 12 },
            { name: 'profitMargin', type: 'number', required: false, description: 'Target profit margin %', example: 18 },
          ],
        },
        example: { bomItemId: 'item-uuid', quantity: 1000, overheadRate: 12, profitMargin: 18 },
      },
      responses: [
        { statusCode: 200, description: 'Piece-part cost calculated', example: { success: true, data: { materialCost: 246.33, processCost: 84.30, toolingCost: 25.00, packagingCost: 41.75, overheadCost: 39.68, totalCost: 437.06, sellingPrice: 515.73 } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'BOM item not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/calculators/piece-part \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"bomItemId":"item-uuid","quantity":1000,"overheadRate":12,"profitMargin":18}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/calculators/piece-part', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ bomItemId: 'item-uuid', quantity: 1000, overheadRate: 12, profitMargin: 18 }),\n});\nconst { data } = await response.json();` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/calculators/piece-part',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'bomItemId': 'item-uuid', 'quantity': 1000, 'overheadRate': 12, 'profitMargin': 18},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"bomItemId":"item-uuid","quantity":1000,"overheadRate":12,"profitMargin":18}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/calculators/piece-part", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
  ],
};
