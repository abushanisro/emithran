import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createLinter } = require('../../../../../scripts/lint-electronics-boundary');

const DOMAIN_FILE = join(__dirname, '../../domain/engines/probe-under-test.ts');

async function violations(source: string, filePath = DOMAIN_FILE): Promise<string[]> {
  const [result] = await createLinter().lintText(source, { filePath });
  // A file no config block matches yields a ruleId-less 'ignored' notice, not a violation.
  return result.messages.filter((m: { ruleId: string | null }) => m.ruleId).map((m: { ruleId: string }) => m.ruleId);
}

// The rule has to actually fire: a boundary that has never been seen to fail protects nothing.
describe('electronics domain import boundary', () => {
  it.each([
    ["import { Injectable } from '@nestjs/common';"],
    ["import { createClient } from '@supabase/supabase-js';"],
    ["import PgBoss from 'pg-boss';"],
    ["import { Pool } from 'pg';"],
    ["import fs from 'node:fs';"],
    ["import axios from 'axios';"],
    ["import { x } from '../../infrastructure/repositories/electronics.repository';"],
    ["import { x } from '../../application/start-upload.use-case';"],
    ["import { x } from '../../api/electronics.controller';"],
    ["import { DatabaseService } from '../../../../common/database/database.service';"],
    ["import { MACHINE_REGISTRY } from '../../../bom-items/costing/shared/core/default-rates.constants';"],
  ])('rejects: %s', async (source) => {
    expect(await violations(`${source}\nexport const used = 1;\n`)).toContain('@typescript-eslint/no-restricted-imports');
  });

  it.each([['console.log("x");'], ['void fetch("http://x");'], ['export const k = process.env.KEY;']])(
    'rejects the global in: %s',
    async (source) => {
      expect(await violations(`${source}\n`)).toContain('no-restricted-globals');
    },
  );

  it('allows the cost-kernel types, ajv and node:crypto', async () => {
    const source = [
      "import type { ProcessLineCost } from '../../../bom-items/dto/cost-breakdown.dto';",
      "import Ajv from 'ajv8';",
      "import { randomUUID } from 'node:crypto';",
      'export const used = [typeof randomUUID, Ajv, (null as unknown as ProcessLineCost | null)];',
    ].join('\n');
    expect(await violations(source)).toEqual([]);
  });

  it('does not apply outside domain/', async () => {
    const infra = join(__dirname, '../../infrastructure/queue/some-adapter.ts');
    expect(await violations("import PgBoss from 'pg-boss';\nexport const used = PgBoss;\n", infra)).toEqual([]);
  });
});
