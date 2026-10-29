// Runs once before the e2e suites. They create and delete real data, so they refuse to start against production.
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';

import { assertNotProduction } from '../../src/common/environment-guard';

export default function globalSetup(): void {
  // The same sources the app and the specs read: the repo-root .env, then the process environment.
  const rootFile = path.resolve(__dirname, '../../../.env');
  const rootEnv = fs.existsSync(rootFile) ? parseEnv(fs.readFileSync(rootFile, 'utf8')) : {};
  assertNotProduction({ ...rootEnv, ...process.env });
}
