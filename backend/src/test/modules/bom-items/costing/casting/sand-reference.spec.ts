import { join } from 'path';
import { readdirSync } from 'fs';
import {
  lookupName,
  resolveSandReference,
  SAND_CASTING_SOURCE_VERSION,
  stagedLookupKey,
} from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import { SandReferenceService } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference.service';

// Real data only, read from memory/ with the staging CSV reader (the same rows migration 853 stages).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const SAND_DIR = join(__dirname, '../../../../../../../memory/Sand casting');
const rowsOf = (rel: string): Array<Record<string, any>> => readCsv(join(SAND_DIR, rel)).rows;

// Staged as text: machining_reference_data.value is TEXT, so a number in the CSV arrives as its string.
const variableRows = rowsOf('sand_casting_variables.csv').map((r) => ({
  key: String(r['Variable Name']),
  value: r['String Value'] == null ? null : String(r['String Value']),
  unit_type: r['Unit Type Name'] || null,
}));
const lookupFiles = readdirSync(join(SAND_DIR, 'Lookup')).filter((f) => f.endsWith('.csv'));
const lookupRows = lookupFiles.map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: rowsOf(`Lookup/${f}`) } }));
const reference = resolveSandReference({ variables: variableRows, lookups: lookupRows });

describe('resolveSandReference (memory/Sand casting)', () => {
  it('holds every variable and every lookup table of the folder, by name', () => {
    expect(reference.variableCount).toBe(variableRows.length);
    expect(reference.variableCount).toBeGreaterThan(100);
    expect(reference.tableNames).toHaveLength(lookupFiles.length);
    expect(reference.tableNames).toContain('tblWallThickness');
    expect(reference.tableNames).not.toContain('lookupTables_Component_tblWallThickness');
  });

  it('reads numeric variables as numbers with their unit, and enums as text', () => {
    expect(reference.number('finishAllowance')).toBe(0.5);
    expect(reference.unit('finishAllowance')).toBe('Length');
    expect(reference.number('partPatternAllowance')).toBe(25.4);
    expect(reference.text('autoCoreboxCalcMode')).toBe('Opportunistic');
    expect(reference.number('autoCoreboxCalcMode')).toBeNull(); // an enum is not a number
  });

  it('gives a table\'s rows as staged', () => {
    const rows = reference.table('tblMinHoleDiameter');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r['Process Name'] === 'Sand Casting')).toBe(true);
    expect(reference.table('tblNoSuchTable')).toEqual([]);
  });

  it('names what a step needs and the data lacks, and nothing else', () => {
    expect(reference.absent({ numbers: ['finishAllowance'], texts: ['autoCoreboxCalcMode'], tables: ['tblWallThickness'] })).toEqual([]);
    expect(reference.absent({ numbers: ['finishAllowance', 'noSuchVariable', 'autoCoreboxCalcMode'], tables: ['tblNoSuchTable'] })).toEqual([
      'sand variable noSuchVariable',
      'sand variable autoCoreboxCalcMode',
      'sand lookup tblNoSuchTable (not staged, migration 853)',
    ]);
  });

  it('ignores a lookup that is not staged as a row table', () => {
    const r = resolveSandReference({ variables: [], lookups: [{ key: stagedLookupKey('tblX'), raw: null }, { key: stagedLookupKey('tblY'), raw: { rows: 'x' } }] });
    expect(r.tableNames).toEqual([]);
  });

  it('maps staged lookup keys to short names and back', () => {
    expect(lookupName('lookupTables_Component_tblGatingRatios')).toBe('tblGatingRatios');
    expect(stagedLookupKey('tblGatingRatios')).toBe('lookupTables_Component_tblGatingRatios');
    expect(lookupName('plainName')).toBe('plainName');
  });
});

describe('SandReferenceService', () => {
  function service(answer: (category: string, filters: Record<string, unknown>) => { data: unknown; error: null | { message: string } }) {
    const calls: Array<Record<string, unknown>> = [];
    const client = {
      from: () => {
        const filters: Record<string, unknown> = {};
        const chain: any = {
          select: () => chain,
          eq: (c: string, v: unknown) => ((filters[c] = v), chain),
          then: (resolve: (r: unknown) => unknown) => {
            calls.push({ ...filters });
            return Promise.resolve(answer(String(filters['category']), filters)).then(resolve);
          },
        };
        return chain;
      },
    };
    return { svc: new SandReferenceService({ getPrivilegedClient: () => client } as never), calls };
  }

  it('reads variables and lookups of the sand source version once and caches the result', async () => {
    const { svc, calls } = service((category) => ({ data: category === 'variable' ? variableRows : lookupRows, error: null }));
    const first = await svc.get();
    await svc.get();
    expect(first.missing).toEqual([]);
    expect(first.reference!.number('finishAllowance')).toBe(0.5);
    expect(calls).toHaveLength(2); // variables and lookups, once
    expect(calls.every((c) => c['source_version'] === SAND_CASTING_SOURCE_VERSION)).toBe(true);
  });

  it('reports a read error and an unstaged set, and caches neither', async () => {
    let mode: 'error' | 'empty' | 'ok' = 'error';
    const { svc } = service((category) =>
      mode === 'error' ? { data: null, error: { message: 'down' } } : { data: mode === 'empty' ? [] : category === 'variable' ? variableRows : lookupRows, error: null },
    );
    expect((await svc.get()).missing[0]).toMatch(/down/);
    mode = 'empty';
    expect((await svc.get()).missing[0]).toMatch(/not staged/);
    mode = 'ok';
    expect((await svc.get()).reference).not.toBeNull();
  });
});
