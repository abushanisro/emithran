import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// The production host appears in the backend guard and in playwright.config.ts (which cannot import the backend). If they
// ever differ, one suite would stop protecting production.
const hostIn = (file: string): string | undefined =>
  /['"`]([a-z0-9]+\.supabase\.co)['"`]/.exec(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'))?.[1];

describe('production host in the e2e guards', () => {
  it('is the same in the backend guard and the Playwright config', () => {
    const backend = hostIn('backend/src/common/environment-guard.ts');
    expect(backend).toMatch(/\.supabase\.co$/);
    expect(hostIn('playwright.config.ts')).toBe(backend);
  });
});
