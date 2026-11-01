import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// The production rule appears in the backend guard and in playwright.config.ts (which cannot import the backend). If they
// ever differ, one suite would stop protecting production.
const read = (file: string): string => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('production rule in the e2e guards', () => {
  it('both refuse APP_ENV=prd', () => {
    expect(read('backend/src/common/environment-guard.ts')).toMatch(/env\.APP_ENV === 'prd'/);
    expect(read('playwright.config.ts')).toMatch(/process\.env\.APP_ENV === 'prd'/);
  });
});
