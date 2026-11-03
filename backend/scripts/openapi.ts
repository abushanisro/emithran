// Writes the OpenAPI document of the real app to ../openapi/openapi.json, or with --check compares it to the committed file.
//   npm run openapi         regenerate (commit the result with the API change)
//   npm run openapi:check   fail if the committed file is out of date (CI)
// No database, no credentials: the app is built, never started, and nothing is connected to. The configuration is fixed
// below (placeholders), so the environment of the machine cannot change the output.
process.env.ALLOW_DEV_AUTH_BYPASS = 'false';
process.env.ELECTRONICS_QUEUE_DRIVER = 'memory';
// The app refuses to build without its configuration (config/env.validation.ts). Placeholders satisfy that; none is ever
// contacted or used to sign anything, and they are set unconditionally so neither CI secrets nor a developer's .env matter.
Object.assign(process.env, {
  POSTGREST_URL: 'http://postgrest.invalid',
  DB_JWT_SECRET: 'openapi-generation-placeholder-not-a-secret',
  S3_BUCKET: 'openapi',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'openapi',
  S3_SECRET_ACCESS_KEY: 'openapi',
  AUTH0_DOMAIN: 'openapi.invalid',
  AUTH0_AUDIENCE: 'https://openapi.invalid',
  AUTH0_CLAIM_NAMESPACE: 'https://openapi.invalid/',
  AUTH0_TRUSTED_CONNECTIONS: 'google-oauth2',
});

import * as fs from 'fs';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApiPrefix } from '../src/common/http/api-prefix';
import { createOpenApiDocument } from '../src/common/http/openapi';

const FILE = path.resolve(__dirname, '../../openapi/openapi.json');

/** Keys sorted at every level, so the order Nest happens to register things in never shows up as a diff. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, sorted(v)]));
  }
  return value;
}

async function main(): Promise<void> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApiPrefix(app);
  await app.init();
  const generated = JSON.stringify(sorted(createOpenApiDocument(app)), null, 2) + '\n';
  await app.close();

  if (process.argv.includes('--check')) {
    const committed = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
    if (committed !== generated) {
      console.error('openapi/openapi.json is out of date with the code.\nRegenerate it and commit it with your change:\n  cd backend && npm run openapi');
      process.exit(1);
    }
    console.log('openapi/openapi.json is up to date');
    return;
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, generated);
  console.log(`wrote ${path.relative(process.cwd(), FILE)}`);
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
