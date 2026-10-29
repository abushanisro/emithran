// Runs once before the e2e suites. They create and delete real data, so they refuse to start against production.
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';

import { assertNotProduction } from '../../src/common/environment-guard';

export default function globalSetup(): void {
  // The same sources the app and the specs read: backend/.env, the repo's .env.local, then the process environment.
  const backendEnv = dotenv.config({ path: path.resolve(__dirname, '../../.env'), processEnv: {} }).parsed ?? {};
  const rootFile = path.resolve(__dirname, '../../../.env.local');
  const rootEnv = fs.existsSync(rootFile) ? parseEnv(fs.readFileSync(rootFile, 'utf8')) : {};
  assertNotProduction({ ...backendEnv, ...rootEnv, ...process.env });
}
