import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

/**
 * The one definition of the OpenAPI document: the running app serves it at /docs (main.ts) and
 * scripts/openapi.ts writes the same document to openapi/openapi.json, which CI keeps in step with the code.
 */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('mithran API Gateway')
    .setDescription('Manufacturing One-Stop Solution - API Gateway')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Authentication')
    .addTag('Projects')
    .addTag('Vendors')
    .addTag('MHR', 'Machine Hour Rate calculations')
    .addTag('LHR', 'Labour Hour Rate database')
    .addTag('Health')
    .build();
  return SwaggerModule.createDocument(app, config);
}
