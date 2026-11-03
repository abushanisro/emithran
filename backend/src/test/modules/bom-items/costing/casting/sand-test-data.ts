// The real memory/Sand casting data as the staged rows migration 853 stores (text values, lookup rows), for the sand tests. Never a copy of
// reference values in a test: everything is read from the folder.
import { readdirSync } from 'fs';
import { join } from 'path';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
export const SAND_DIR = join(__dirname, '../../../../../../../memory/Sand casting');
export const sandRows = (rel: string): Array<Record<string, any>> => readCsv(join(SAND_DIR, rel)).rows;

export const stagedVariables = sandRows('sand_casting_variables.csv').map((r) => ({
  key: String(r['Variable Name']),
  value: r['String Value'] == null ? null : String(r['String Value']), // staged as text: machining_reference_data.value is TEXT
  unit_type: r['Unit Type Name'] || null,
}));
export const lookupFiles = readdirSync(join(SAND_DIR, 'Lookup')).filter((f) => f.endsWith('.csv'));
export const stagedLookups = lookupFiles.map((f) => ({ key: f.replace(/\.csv$/, ''), raw: { rows: sandRows(`Lookup/${f}`) } }));

export const realSandReference = () => resolveSandReference({ variables: stagedVariables, lookups: stagedLookups });
/** The sand raw materials (Raw Material/raw_materials.csv), as rows keyed by the CSV headers. */
export const sandMaterials = () => sandRows('Raw Material/raw_materials.csv');
