import type { ResourceGroup } from '../api-spec-types';
import { BASE_URL } from './_base';

export const vendorsGroup: ResourceGroup = {
  id: 'vendors',
  label: 'Vendors',
  description: 'Manage your supplier and vendor master data. Vendors can be linked to BOM items, RFQs, and production plans.',
  icon: 'Users',
  endpoints: [
    {
      id: 'list-vendors',
      method: 'GET',
      path: '/v1/api/vendors',
      summary: 'List vendors',
      description: 'Returns a paginated list of all vendors in your supplier master database.',
      parameters: [
        { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number', default: 1 },
        { name: 'limit', in: 'query', type: 'integer', required: false, description: 'Results per page', default: 20 },
        { name: 'search', in: 'query', type: 'string', required: false, description: 'Search by vendor name' },
        { name: 'category', in: 'query', type: 'string', required: false, description: 'Filter by vendor category' },
        { name: 'city', in: 'query', type: 'string', required: false, description: 'Filter by city' },
        { name: 'process', in: 'query', type: 'string', required: false, description: 'Filter by manufacturing process capability' },
      ],
      responses: [
        { statusCode: 200, description: 'Vendors retrieved', example: { success: true, data: { vendors: [{ id: 'vendor-uuid', name: 'Acme Machining Co.', category: 'machining', country: 'India', city: 'Pune', status: 'active' }], total: 48 } } },
      ],
      errors: [{ statusCode: 401, code: 'UNAUTHORIZED', description: 'Invalid token' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -G ${BASE_URL}/v1/api/vendors \\\n  -H "Authorization: Bearer {token}" \\\n  -d "page=1&limit=20&category=machining"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/vendors?page=1&category=machining\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `import requests\n\nresponse = requests.get(\n    '${BASE_URL}/v1/api/vendors',\n    headers={'Authorization': f'Bearer {token}'},\n    params={'page': 1, 'category': 'machining'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/vendors?page=1&category=machining", nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'create-vendor',
      method: 'POST',
      path: '/v1/api/vendors',
      summary: 'Create a vendor',
      description: 'Adds a new vendor to the supplier master database.',
      parameters: [],
      requestBody: {
        description: 'Vendor data',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: true, description: 'Vendor or company name', example: 'Acme Machining Co.' },
            { name: 'supplierCode', type: 'string', required: false, description: 'Internal supplier code', example: 'AMC-001' },
            { name: 'city', type: 'string', required: false, description: 'City of operation', example: 'Pune' },
            { name: 'state', type: 'string', required: false, description: 'State', example: 'Maharashtra' },
            { name: 'country', type: 'string', required: false, description: 'Country', default: 'India' },
            { name: 'companyEmail', type: 'string', required: false, description: 'Primary contact email', format: 'email' },
            { name: 'companyPhone', type: 'string', required: false, description: 'Contact phone number' },
            { name: 'process', type: 'array', required: false, description: 'List of manufacturing process capabilities', example: ['CNC Turning', 'Milling'] },
            { name: 'certifications', type: 'array', required: false, description: 'Quality certifications', example: ['ISO 9001', 'IATF 16949'] },
            { name: 'status', type: 'string', required: false, description: 'Vendor status', enum: ['active', 'inactive'], default: 'active' },
          ],
        },
        example: { name: 'Acme Machining Co.', supplierCode: 'AMC-001', city: 'Pune', country: 'India', companyEmail: 'contact@acme.com', process: ['CNC Turning'] },
      },
      responses: [{ statusCode: 201, description: 'Vendor created', example: { success: true, data: { id: 'vendor-uuid', name: 'Acme Machining Co.' } } }],
      errors: [{ statusCode: 409, code: 'CONFLICT', description: 'Vendor with this name already exists' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X POST ${BASE_URL}/v1/api/vendors \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Acme Machining Co.","supplierCode":"AMC-001","city":"Pune","country":"India"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch('${BASE_URL}/v1/api/vendors', {\n  method: 'POST',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ name: 'Acme Machining Co.', supplierCode: 'AMC-001', city: 'Pune' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.post(\n    '${BASE_URL}/v1/api/vendors',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'name': 'Acme Machining Co.', 'supplierCode': 'AMC-001', 'city': 'Pune'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"name":"Acme Machining Co.","supplierCode":"AMC-001","city":"Pune"}\`\nreq, _ := http.NewRequest("POST", "${BASE_URL}/v1/api/vendors", strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'get-vendor',
      method: 'GET',
      path: '/v1/api/vendors/{id}',
      summary: 'Retrieve a vendor',
      description: 'Returns full vendor details including contact information, capabilities, certifications, and equipment.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Vendor UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Vendor retrieved', example: { success: true, data: { id: 'vendor-uuid', name: 'Acme Machining Co.', city: 'Pune', country: 'India', process: ['CNC Turning'], certifications: ['ISO 9001'] } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Vendor not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl ${BASE_URL}/v1/api/vendors/{vendor_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/vendors/\${vendorId}\`, {\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.get(\n    f'${BASE_URL}/v1/api/vendors/{vendor_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("GET", "${BASE_URL}/v1/api/vendors/"+vendorID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
    {
      id: 'update-vendor',
      method: 'PUT',
      path: '/v1/api/vendors/{id}',
      summary: 'Update a vendor',
      description: 'Updates vendor contact details, capabilities, or status.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Vendor UUID', format: 'uuid' },
      ],
      requestBody: {
        description: 'Fields to update',
        required: true,
        schema: {
          name: 'body',
          type: 'object',
          properties: [
            { name: 'name', type: 'string', required: false, description: 'Vendor name' },
            { name: 'companyEmail', type: 'string', required: false, description: 'Contact email', format: 'email' },
            { name: 'companyPhone', type: 'string', required: false, description: 'Contact phone' },
            { name: 'status', type: 'string', required: false, description: 'Vendor status', enum: ['active', 'inactive'] },
            { name: 'process', type: 'array', required: false, description: 'Process capabilities' },
            { name: 'certifications', type: 'array', required: false, description: 'Quality certifications' },
          ],
        },
        example: { companyEmail: 'new-contact@acme.com', status: 'active' },
      },
      responses: [
        { statusCode: 200, description: 'Vendor updated', example: { success: true, data: { id: 'vendor-uuid', name: 'Acme Machining Co.', companyEmail: 'new-contact@acme.com' } } },
      ],
      errors: [{ statusCode: 404, code: 'NOT_FOUND', description: 'Vendor not found' }],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X PUT ${BASE_URL}/v1/api/vendors/{vendor_id} \\\n  -H "Authorization: Bearer {token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"companyEmail":"new-contact@acme.com","status":"active"}'` },
        { language: 'javascript', label: 'JavaScript', code: `const response = await fetch(\`${BASE_URL}/v1/api/vendors/\${vendorId}\`, {\n  method: 'PUT',\n  headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify({ companyEmail: 'new-contact@acme.com', status: 'active' }),\n});` },
        { language: 'python', label: 'Python', code: `response = requests.put(\n    f'${BASE_URL}/v1/api/vendors/{vendor_id}',\n    headers={'Authorization': f'Bearer {token}'},\n    json={'companyEmail': 'new-contact@acme.com', 'status': 'active'},\n)` },
        { language: 'go', label: 'Go', code: `payload := \`{"companyEmail":"new-contact@acme.com","status":"active"}\`\nreq, _ := http.NewRequest("PUT", "${BASE_URL}/v1/api/vendors/"+vendorID, strings.NewReader(payload))\nreq.Header.Set("Authorization", "Bearer "+token)\nreq.Header.Set("Content-Type", "application/json")` },
      ],
      requiresAuth: true,
    },
    {
      id: 'delete-vendor',
      method: 'DELETE',
      path: '/v1/api/vendors/{id}',
      summary: 'Delete a vendor',
      description: 'Removes a vendor from the supplier master database.',
      parameters: [
        { name: 'id', in: 'path', type: 'string', required: true, description: 'Vendor UUID', format: 'uuid' },
      ],
      responses: [
        { statusCode: 200, description: 'Vendor deleted', example: { success: true, message: 'Vendor deleted successfully' } },
      ],
      errors: [
        { statusCode: 404, code: 'NOT_FOUND', description: 'Vendor not found' },
        { statusCode: 409, code: 'CONFLICT', description: 'Vendor has active purchase orders' },
      ],
      examples: [
        { language: 'curl', label: 'cURL', code: `curl -X DELETE ${BASE_URL}/v1/api/vendors/{vendor_id} \\\n  -H "Authorization: Bearer {token}"` },
        { language: 'javascript', label: 'JavaScript', code: `await fetch(\`${BASE_URL}/v1/api/vendors/\${vendorId}\`, {\n  method: 'DELETE',\n  headers: { Authorization: \`Bearer \${token}\` },\n});` },
        { language: 'python', label: 'Python', code: `response = requests.delete(\n    f'${BASE_URL}/v1/api/vendors/{vendor_id}',\n    headers={'Authorization': f'Bearer {token}'},\n)` },
        { language: 'go', label: 'Go', code: `req, _ := http.NewRequest("DELETE", "${BASE_URL}/v1/api/vendors/"+vendorID, nil)\nreq.Header.Set("Authorization", "Bearer "+token)` },
      ],
      requiresAuth: true,
    },
  ],
};
