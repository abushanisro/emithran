export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type ParameterLocation = 'path' | 'query' | 'body' | 'header';
export type CodeLanguage = 'curl' | 'javascript' | 'python' | 'go';

export interface SchemaProperty {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  example?: unknown;
  properties?: SchemaProperty[];
  items?: SchemaProperty;
  enum?: string[];
  format?: string;
  default?: unknown;
}

export interface Parameter {
  name: string;
  in: ParameterLocation;
  type: string;
  required: boolean;
  description: string;
  example?: unknown;
  schema?: SchemaProperty;
  default?: unknown;
  enum?: string[];
  format?: string;
}

export interface ResponseSchema {
  statusCode: number;
  description: string;
  schema?: SchemaProperty;
  example?: Record<string, unknown>;
}

export interface ErrorCode {
  statusCode: number;
  code?: string;
  description: string;
}

export interface CodeExample {
  language: CodeLanguage;
  label: string;
  code: string;
}

export interface Endpoint {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  parameters: Parameter[];
  requestBody?: {
    description: string;
    required: boolean;
    schema: SchemaProperty;
    example?: Record<string, unknown>;
  };
  responses: ResponseSchema[];
  errors: ErrorCode[];
  examples: CodeExample[];
  requiresAuth: boolean;
  deprecated?: boolean;
  contentType?: 'application/json' | 'multipart/form-data';
}

export interface ResourceGroup {
  id: string;
  label: string;
  description: string;
  icon?: string;
  endpoints: Endpoint[];
}

export interface ApiSpec {
  title: string;
  version: string;
  baseUrl: string;
  description: string;
  authenticationMethods: {
    jwt: { description: string; header: string };
    apiKey: { description: string; header: string };
  };
  groups: ResourceGroup[];
}
