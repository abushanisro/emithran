// Material strengths — REAL services, real sign-in (the test account in
// ../.env.local), read-only. Expected values are read at test time from
// memory/Sheetmetal/rawmetrial/rawmetalusa.csv (the roadmap source), never
// typed in here.
//
// The reported bug: a sheet-metal part of "Aluminum, ANSI 6061" had a blank
// Press Brake UTS. Every domain has its own row for that material; material
// matching only looked at the grade column and so always found the Forging
// row (no strengths), never the sheet-metal row (name column, UTS 310).
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { SupabaseService } from '../src/common/supabase/supabase.service';
import { MaterialResolutionService } from '../src/modules/bom-items/services/material-resolution.service';

jest.setTimeout(120_000);

async function signIn(config: ConfigService): Promise<string> {
  const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env.local'), 'utf8'));
  if (!env.E2E_EMAIL || !env.E2E_PASSWORD) throw new Error('Add E2E_EMAIL / E2E_PASSWORD to .env.local');
  const anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
  const { data, error } = await anon.auth.signInWithPassword({ email: env.E2E_EMAIL, password: env.E2E_PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
  return data.session.access_token;
}

/** rawmetalusa.csv rows keyed by PrimaryID (quoted CSV). */
function readSheetMetalMaterials(): Map<string, { uts: number; shear: number; tys: number }> {
  const csv = fs.readFileSync(path.resolve(__dirname, '../../memory/Sheetmetal/rawmetrial/rawmetalusa.csv'), 'utf8');
  const parse = (line: string) => {
    const out: string[] = []; let cell = ''; let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { out.push(cell); cell = ''; }
      else cell += ch;
    }
    out.push(cell);
    return out;
  };
  const [header, ...lines] = csv.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const cols = parse(header);
  const at = (cells: string[], c: string) => cells[cols.indexOf(c)];
  return new Map(lines.map(parse).map((c) => [at(c, 'PrimaryID'), {
    uts: Number(at(c, 'UTS_MPa')), shear: Number(at(c, 'ShearStrength_MPa')), tys: Number(at(c, 'TYS_MPa')),
  }]));
}

describe('[e2e] material strengths — real DB, no mocks', () => {
  let resolver: MaterialResolutionService;
  let token: string;
  const source = readSheetMetalMaterials();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') })],
      providers: [SupabaseService, MaterialResolutionService],
    }).compile();
    resolver = moduleRef.get(MaterialResolutionService);
    token = await signIn(moduleRef.get(ConfigService));
  });

  it('a sheet-metal part of Aluminum, ANSI 6061 gets the sheet-metal row strengths (the reported part)', async () => {
    const expected = source.get('Aluminum, ANSI 6061')!;
    const s = await resolver.resolveMaterialStrengths(token, 'Aluminum, ANSI 6061', 'sheet_metal');
    expect(s.utsSource).toBe('db');
    expect(s.utsMpa).toBe(expected.uts);
    expect(s.shearStrengthMpa).toBe(expected.shear);
    expect(s.yieldStrengthMpa).toBe(expected.tys);
  });

  it('a family with no material-group link keeps the grade-column row (no change for it)', async () => {
    // "unknown" has no process group, so nothing narrows: the grade match
    // (Forging's row, which carries no strengths) is used, as before.
    const s = await resolver.resolveMaterialStrengths(token, 'Aluminum, ANSI 6061', 'unknown');
    expect(s.utsSource).not.toBe('db');
    expect(s.shearStrengthMpa).toBeNull();
  });

  it('an unknown grade yields nulls, never a guessed strength', async () => {
    const s = await resolver.resolveMaterialStrengths(token, 'No Such Material XYZ-0000', 'sheet_metal');
    expect(s).toEqual({ utsMpa: null, utsSource: 'unavailable', shearStrengthMpa: null, yieldStrengthMpa: null, materialName: null });
  });
});
