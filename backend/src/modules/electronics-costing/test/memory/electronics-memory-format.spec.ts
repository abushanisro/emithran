import { resolve } from 'node:path';

import { BOARD_FEATURE_GRAPH_SCHEMA } from '../../domain/feature-graph/schemas.generated';
import { PLANNED_ENGINES } from '../../domain/reference/engine-inputs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const format = require('../../../../../scripts/lib/electronics-memory-format');

interface Column {
  name: string;
  type: string;
  required: boolean;
  values?: string[];
}
interface Spec {
  file: string;
  inputKeys: string[];
  columns: Column[];
  uniqueKey: string[];
}

const TODAY = '2026-10-16';
const specs: Spec[] = format.fileSpecs();
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}
const specNamed = (file: string) => must(specs.find((s) => s.file === file), file);

// A row that satisfies every column rule, built from the format itself. A column whose value has its own
// shape (a file extension) is given one valid value here.
const SHAPED: Record<string, Record<string, string>> = { 'gerber_file_roles.csv': { extension: 'gtl' } };
function validRow(spec: Spec): Record<string, string> {
  const sample: Record<string, string> = { url: 'https://example.com/datasheet.pdf', date: '2026-01-15', positive: '5', nonNegative: '0', integer: '2', text: 'sample' };
  const row = Object.fromEntries(spec.columns.map((c) => [c.name, c.type === 'enum' ? must(c.values, `${c.name} values`)[0] : sample[c.type]]));
  return { ...row, ...(SHAPED[spec.file] ?? {}) };
}
const csv = (spec: Spec, rows: Record<string, string>[]) =>
  `${[spec.columns.map((c) => c.name).join(','), ...rows.map((r) => spec.columns.map((c) => r[c.name]).join(','))].join('\n')  }\n`;
const messages = (spec: Spec, rows: Record<string, string>[]) =>
  format.validateFile(spec, csv(spec, rows), TODAY).map((p: { message: string }) => p.message);

describe('memory/Electronics format', () => {
  it('the real folder is valid (header-only files pass) and holds exactly the specified files', () => {
    expect(format.validateDirectory(resolve(__dirname, '../../../../../../memory/Electronics'), TODAY)).toEqual([]);
  });

  it('every input key a file claims to close is a planned engine input', () => {
    const planned = new Set(PLANNED_ENGINES.flatMap((e) => e.inputs.map((i) => i.key)));
    for (const spec of specs) for (const key of spec.inputKeys) expect(planned.has(key)).toBe(true);
  });

  it('the package-class vocabulary is the contract vocabulary (minus unknown)', () => {
    const contract = BOARD_FEATURE_GRAPH_SCHEMA.properties.placements.items.properties.packageClass.enum.filter((c) => c !== 'unknown');
    expect(format.packageClasses()).toEqual(contract);
  });

  describe.each(specs.map((s) => [s.file, s] as const))('%s', (_file, spec) => {
    it('accepts a fully sourced row', () => {
      expect(messages(spec, [validRow(spec)])).toEqual([]);
    });

    it('rejects a row with no source_url, and one with a bad URL', () => {
      expect(messages(spec, [{ ...validRow(spec), source_url: '' }])).toEqual(['source_url is required']);
      expect(messages(spec, [{ ...validRow(spec), source_url: 'not a url' }])).toEqual(['source_url must be an http(s) URL']);
      expect(messages(spec, [{ ...validRow(spec), source_url: 'ftp://example.com/x' }])).toEqual(['source_url must be an http(s) URL']);
    });

    it('rejects a missing, malformed, impossible or future source_date', () => {
      const dateError = 'source_date must be a real ISO date (YYYY-MM-DD) not in the future';
      expect(messages(spec, [{ ...validRow(spec), source_date: '' }])).toEqual(['source_date is required']);
      for (const bad of ['15/01/2026', '2026-13-01', '2026-02-30', '2027-01-01']) {
        expect(messages(spec, [{ ...validRow(spec), source_date: bad }])).toEqual([dateError]);
      }
    });

    it('rejects a duplicate key and a header that differs from the format', () => {
      expect(messages(spec, [validRow(spec), validRow(spec)])).toEqual([expect.stringMatching(/^duplicate of line 2/)]);
      const wrongHeader = format.validateFile(spec, 'wrong,header\n', TODAY);
      expect(wrongHeader).toHaveLength(1);
      expect(wrongHeader[0].message).toMatch(/^header must be exactly/);
    });

    it('rejects a required column left empty', () => {
      const required = must(spec.columns.find((c) => c.required && !['source_url', 'source_date'].includes(c.name)), 'a required column');
      expect(messages(spec, [{ ...validRow(spec), [required.name]: '' }])).toEqual([`${required.name} is required`]);
    });

    it('rejects a number that is not positive, and a value outside an enum', () => {
      const num = spec.columns.find((c) => c.type === 'positive');
      if (num) expect(messages(spec, [{ ...validRow(spec), [num.name]: '0' }])).toEqual([`${num.name} must be a number greater than 0`]);
      const en = spec.columns.find((c) => c.type === 'enum');
      if (en) expect(messages(spec, [{ ...validRow(spec), [en.name]: 'bogus' }])).toEqual([expect.stringMatching(new RegExp(`^${en.name} must be one of`))]);
    });
  });

  describe('cross-column rules', () => {
    it('file roles: the extension is bare lower case, and the family agrees with the role', () => {
      const spec = specNamed('gerber_file_roles.csv');
      expect(messages(spec, [{ ...validRow(spec), extension: '.GTL' }])).toEqual(['extension must be lower case letters and digits only, without the dot']);
      expect(messages(spec, [{ ...validRow(spec), family: 'excellon', role: 'copper_top' }])).toEqual(['an excellon file has the role drill_data']);
      expect(messages(spec, [{ ...validRow(spec), family: 'report', role: 'copper_top' }])).toEqual(['a report file has the role drill_report']);
      expect(messages(spec, [{ ...validRow(spec), family: 'excellon', role: 'drill_data', extension: 'txt' }])).toEqual([]);
    });

    it('reflow: max conveyor speed cannot be below min', () => {
      const spec = specNamed('reflow_ovens.csv');
      expect(messages(spec, [{ ...validRow(spec), conveyor_speed_min_mm_per_min: '900', conveyor_speed_max_mm_per_min: '800' }])).toEqual([
        'conveyor_speed_max_mm_per_min is below conveyor_speed_min_mm_per_min',
      ]);
    });

    it('cut/strip: gauge and length ranges cannot be inverted', () => {
      const spec = specNamed('harness_cut_strip.csv');
      expect(messages(spec, [{ ...validRow(spec), awg_min: '20', awg_max: '10', length_min_mm: '50', length_max_mm: '10' }])).toEqual([
        'awg_max is below awg_min',
        'length_max_mm is below length_min_mm',
      ]);
    });

    it('crimp: an applicator price needs its currency', () => {
      const spec = specNamed('harness_crimp.csv');
      expect(messages(spec, [{ ...validRow(spec), applicator_nre: '1200', currency: '' }])).toEqual(['currency is required when applicator_nre is given']);
    });

    it('footprint lookup: smd needs a class, tht must not have one, and the class must be in the vocabulary', () => {
      const spec = specNamed('package_class_lookup.csv');
      expect(messages(spec, [{ ...validRow(spec), mount_type: 'smd', package_class: '' }])).toEqual(['package_class is required for an smd footprint']);
      expect(messages(spec, [{ ...validRow(spec), mount_type: 'tht', package_class: 'sot' }])).toEqual([
        'a tht footprint has no package_class (through-hole parts are not in the SMT vocabulary)',
      ]);
      expect(messages(spec, [{ ...validRow(spec), mount_type: 'tht', package_class: '', pin_count: '4' }])).toEqual([]);
      expect(messages(spec, [{ ...validRow(spec), package_class: 'unknown' }])).toEqual([expect.stringMatching(/^package_class must be one of/)]);
    });
  });
});
