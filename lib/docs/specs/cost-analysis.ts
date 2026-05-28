import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const costAnalysisGroup: ResourceGroup = {
  id: 'cost-analysis',
  label: 'Cost Analysis',
  description: 'Access Machine Hour Rate (MHR), Labor Standard Rate (LSR), tooling, and packaging cost engines.',
  icon: 'Calculator',
  endpoints: [
    {
      id: 'list-mhr',
      method: 'GET',
      path: '/v1/api/mhr',
      summary: 'List machine hour rates',
      description: 'Returns all Machine Hour Rate (MHR) records. MHR represents the hourly cost of operating a specific machine including depreciation, power, and overheads.',
      parameters: [
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'search', in: 'query', type: 'string', required: false, description: 'Search by machine name' },
      ],
      responses: [
        { statusCode: 200, description: 'MHR records retrieved', example: { success: true, data: { records: [{ id: 'mhr-uuid', machineName: 'CNC Lathe', hourlyRate: 850, currency: 'INR' }], total: 24 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/mhr \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/mhr', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/mhr',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/mhr", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'list-lsr',
      method: 'GET',
      path: '/v1/api/lsr',
      summary: 'List labor standard rates',
      description: 'Returns all Labour Standard Rate (LSR) records. LSR represents the hourly cost of different labor grades including wages, benefits, and overheads.',
      parameters: [
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'grade', in: 'query', type: 'string', required: false, description: 'Filter by labor grade' },
      ],
      responses: [
        { statusCode: 200, description: 'LSR records retrieved', example: { success: true, data: { records: [{ id: 'lsr-uuid', grade: 'Skilled', hourlyRate: 280, currency: 'INR' }], total: 12 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/lsr \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/lsr', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    '${BASE_URL}/v1/api/lsr',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/lsr", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'calculate-mhr',
      method: 'POST',
      path: '/v1/api/mhr/calculate',
      summary: 'Calculate machine cost',
      description: 'Calculates the machine cost for a given operation based on cycle time and a specific Machine Hour Rate.',
      parameters: [],
      requestBody: {
        description: 'Calculation inputs',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'mhrId', type: 'string', required: true, description: 'Machine Hour Rate UUID', format: 'uuid' },
            { name: 'cycleTimeSeconds', type: 'number', required: true, description: 'Cycle time per unit in seconds', example: 180 },
            { name: 'quantity', type: 'integer', required: false, description: 'Number of parts', default: 1 },
          ],
        },
        example: { mhrId: 'mhr-uuid', cycleTimeSeconds: 180, quantity: 1000 },
      },
      responses: [
        { statusCode: 200, description: 'Machine cost calculated', example: { success: true, data: { machineCostPerUnit: 42.50, totalMachineCost: 42500, cycleTimeMinutes: 3, hourlyRate: 850 } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'MHR record not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/mhr/calculate \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"mhrId":"mhr-uuid","cycleTimeSeconds":180,"quantity":1000}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/mhr/calculate', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ mhrId: 'mhr-uuid', cycleTimeSeconds: 180, quantity: 1000 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/mhr/calculate',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'mhrId': 'mhr-uuid', 'cycleTimeSeconds': 180, 'quantity': 1000},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"mhrId":"mhr-uuid","cycleTimeSeconds":180,"quantity":1000}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/mhr/calculate", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'calculate-lsr',
      method: 'POST',
      path: '/v1/api/lsr/calculate',
      summary: 'Calculate labor cost',
      description: 'Calculates the labor cost for an operation based on standard time and a specific Labour Standard Rate.',
      parameters: [],
      requestBody: {
        description: 'Calculation inputs',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'lsrId', type: 'string', required: true, description: 'Labour Standard Rate UUID', format: 'uuid' },
            { name: 'standardTimeSeconds', type: 'number', required: true, description: 'Standard time per unit in seconds', example: 120 },
            { name: 'quantity', type: 'integer', required: false, description: 'Number of parts', default: 1 },
          ],
        },
        example: { lsrId: 'lsr-uuid', standardTimeSeconds: 120, quantity: 1000 },
      },
      responses: [
        { statusCode: 200, description: 'Labor cost calculated', example: { success: true, data: { laborCostPerUnit: 9.33, totalLaborCost: 9330, standardTimeMinutes: 2, hourlyRate: 280 } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'LSR record not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/lsr/calculate \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"lsrId":"lsr-uuid","standardTimeSeconds":120,"quantity":1000}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/lsr/calculate', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ lsrId: 'lsr-uuid', standardTimeSeconds: 120, quantity: 1000 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/lsr/calculate',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'lsrId': 'lsr-uuid', 'standardTimeSeconds': 120, 'quantity': 1000},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"lsrId":"lsr-uuid","standardTimeSeconds":120,"quantity":1000}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/lsr/calculate", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'list-tooling-costs',
      method: 'GET',
      path: '/v1/api/tooling-costs',
      summary: 'List tooling costs',
      description: 'Returns all tooling cost records including dies, jigs, fixtures, and gauges with amortization data.',
      parameters: [
        { name: 'bomId', in: 'query', type: 'string', required: false, description: 'Filter by BOM UUID' },
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
      ],
      responses: [
        { statusCode: 200, description: 'Tooling costs retrieved', example: { success: true, data: { records: [{ id: 'tool-uuid', toolName: 'Progressive Die', cost: 250000, amortizedCostPerUnit: 25.00, amortizationQty: 10000 }], total: 8 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/tooling-costs \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/tooling-costs', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    '${BASE_URL}/v1/api/tooling-costs',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/tooling-costs", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'calculate-tooling-amortization',
      method: 'POST',
      path: '/v1/api/tooling-costs/calculate',
      summary: 'Calculate tooling amortization',
      description: 'Calculates the per-unit amortized tooling cost based on total tooling investment and production lifetime quantity.',
      parameters: [],
      requestBody: {
        description: 'Tooling amortization inputs',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'toolingCost', type: 'number', required: true, description: 'Total tooling investment', example: 250000 },
            { name: 'lifetimeQty', type: 'integer', required: true, description: 'Tool lifetime in units', example: 10000 },
            { name: 'productionQty', type: 'integer', required: false, description: 'Current production quantity for total cost', default: 1 },
          ],
        },
        example: { toolingCost: 250000, lifetimeQty: 10000, productionQty: 500 },
      },
      responses: [
        { statusCode: 200, description: 'Amortization calculated', example: { success: true, data: { amortizedCostPerUnit: 25.00, totalToolingForBatch: 12500, remainingLifetimeQty: 9500 } } },
      ],
      errors: [],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/tooling-costs/calculate \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"toolingCost":250000,"lifetimeQty":10000,"productionQty":500}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/tooling-costs/calculate', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ toolingCost: 250000, lifetimeQty: 10000, productionQty: 500 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/tooling-costs/calculate',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'toolingCost': 250000, 'lifetimeQty': 10000, 'productionQty': 500},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"toolingCost":250000,"lifetimeQty":10000,"productionQty":500}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/tooling-costs/calculate", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'list-packaging-costs',
      method: 'GET',
      path: '/v1/api/packaging-logistics-costs',
      summary: 'List packaging & logistics costs',
      description: 'Returns all packaging and logistics cost configurations including carton dimensions, freight rates, and per-unit packaging costs.',
      parameters: [
        { name: 'bomId', in: 'query', type: 'string', required: false, description: 'Filter by BOM UUID' },
      ],
      responses: [
        { statusCode: 200, description: 'Packaging costs retrieved', example: { success: true, data: { records: [{ id: 'pkg-uuid', packagingCostPerUnit: 12.50, freightCostPerUnit: 8.00, totalLogisticsCost: 20.50 }], total: 4 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/packaging-logistics-costs \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/packaging-logistics-costs', {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    '${BASE_URL}/v1/api/packaging-logistics-costs',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/packaging-logistics-costs", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'calculate-packaging-cost',
      method: 'POST',
      path: '/v1/api/packaging-logistics-costs/calculate',
      summary: 'Calculate packaging & logistics cost',
      description: 'Calculates per-unit packaging, handling, and freight cost based on part dimensions, weight, and delivery distance.',
      parameters: [],
      requestBody: {
        description: 'Packaging calculation inputs',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'partWeightKg', type: 'number', required: true, description: 'Part weight in kilograms', example: 2.5 },
            { name: 'partsPerCarton', type: 'integer', required: true, description: 'Parts packed per carton', example: 20 },
            { name: 'freightRatePerKg', type: 'number', required: false, description: 'Freight rate per kg', example: 15 },
            { name: 'packagingCostPerCarton', type: 'number', required: false, description: 'Carton + packing material cost', example: 85 },
            { name: 'quantity', type: 'integer', required: false, description: 'Total production quantity', default: 1 },
          ],
        },
        example: { partWeightKg: 2.5, partsPerCarton: 20, freightRatePerKg: 15, packagingCostPerCarton: 85, quantity: 500 },
      },
      responses: [
        { statusCode: 200, description: 'Packaging cost calculated', example: { success: true, data: { packagingCostPerUnit: 4.25, freightCostPerUnit: 37.50, totalLogisticsCostPerUnit: 41.75 } } },
      ],
      errors: [],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/packaging-logistics-costs/calculate \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"partWeightKg":2.5,"partsPerCarton":20,"freightRatePerKg":15,"packagingCostPerCarton":85}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/packaging-logistics-costs/calculate', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ partWeightKg: 2.5, partsPerCarton: 20, freightRatePerKg: 15, packagingCostPerCarton: 85 }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/packaging-logistics-costs/calculate',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'partWeightKg': 2.5, 'partsPerCarton': 20, 'freightRatePerKg': 15, 'packagingCostPerCarton': 85},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"partWeightKg":2.5,"partsPerCarton":20,"freightRatePerKg":15,"packagingCostPerCarton":85}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/packaging-logistics-costs/calculate", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
  ],
};
