import { readFileSync } from 'fs';
import { join } from 'path';

// The injection-molding reference package (plastic-molding/reference/*.csv): the costing engineer's open-source research, kept as cited data
// before the cost model reads any of it. Every row says how far it can be trusted (source_backed / engineering_estimate / provisional /
// unresolved), where it came from, whether its source was checked here, and whether it needs review. Nothing is labelled verified: the
// values were relayed, not read from the datasheets here; a row whose source is not checked must be marked for review.
const DIR = join(__dirname, '../../../../../modules/bom-items/costing/plastic-molding/reference');

/** RFC 4180: quoted fields, "" for a quote inside one. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function load(file: string) {
  const [header, ...body] = parseCsv(readFileSync(join(DIR, file), 'utf8'));
  return { header: header!, rows: body.map((r) => ({ cells: r.length, ...Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ''])) }) as Record<string, string> & { cells: number }) };
}

const CITED = ['material-drying-reference.csv', 'dryer-equipment-reference.csv', 'mold-steel-treatment-reference.csv', 'mold-design-reference.csv', 'quality-inspection-reference.csv'];
const CONFIDENCE = new Set(['source_backed', 'engineering_estimate', 'provisional', 'unresolved']);
const num = (s: string) => (s === '' ? null : Number(s));

describe('injection-molding reference package', () => {
  it.each(CITED)('%s: every row is complete and says how far it can be trusted and where it came from', (file) => {
    const { header, rows } = load(file);
    for (const col of ['confidence', 'source_name', 'source_url', 'source_checked', 'review_required', 'retrieved']) expect(header).toContain(col);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.cells).toBe(header.length);
      expect(CONFIDENCE.has(r.confidence!)).toBe(true);
      expect(['true', 'false']).toContain(r.source_checked);
      expect(['true', 'false']).toContain(r.review_required);
      expect(r.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // a value with a confidence other than unresolved names its source
      if (r.confidence !== 'unresolved') expect(r.source_name).not.toBe('');
      // a source not checked here is reviewed before use; a checked one has a link or is our own staged memory/ file
      if (r.source_checked === 'false') expect(r.review_required).toBe('true');
      else expect(r.source_url !== '' || r.source_name!.startsWith('memory/')).toBe(true);
      if (r.source_url) expect(r.source_url).toMatch(/^https:\/\//);
    }
  });

  it('nothing is labelled verified: the research was relayed, not read from the datasheets here', () => {
    for (const file of CITED) for (const r of load(file).rows) expect(r.confidence).not.toBe('verified');
  });

  it('drying: one row per resin, ranges in order, PA6 GF provisional (transferred from PA6), ABS grade-dependent, PA66 not inheriting PA6', () => {
    const rows = load('material-drying-reference.csv').rows;
    expect(rows.map((r) => r.material)).toEqual(['PA6', 'PA6 GF', 'PC', 'PBT', 'PET', 'ABS']);
    for (const r of rows) {
      expect(num(r.drying_temp_c_min!)!).toBeLessThanOrEqual(num(r.drying_temp_c_max!)!);
      expect(num(r.drying_time_h_min!)!).toBeLessThanOrEqual(num(r.drying_time_h_max!)!);
      expect(r.dryer_type).toBe('desiccant');
    }
    expect(rows.find((r) => r.material === 'PA6 GF')).toMatchObject({ confidence: 'provisional', applicability: 'transferred_from_PA6' });
    expect(rows.find((r) => r.material === 'ABS')?.applicability).toBe('grade_dependent');
    expect(rows.some((r) => r.material === 'PA66')).toBe(false);
  });

  it('dryer equipment: ranges in order; the dryer hourly rate and loading labour are unresolved, with no value', () => {
    const rows = load('dryer-equipment-reference.csv').rows;
    for (const r of rows.filter((x) => x.value_min && x.value_max)) expect(num(r.value_min!)!).toBeLessThanOrEqual(num(r.value_max!)!);
    for (const p of ['dryer_hourly_rate', 'loading_labour']) expect(rows.find((r) => r.parameter === p)).toMatchObject({ confidence: 'unresolved', value_min: '', value_max: '' });
  });

  it('steel: P20 is supplied pre-hardened, so hardening is not charged by default', () => {
    const p20 = load('mold-steel-treatment-reference.csv').rows.find((r) => r.steel_grade === 'AISI P20');
    expect(p20).toMatchObject({ heat_treatment_required: 'false', initial_hardness_hrc_min: '28', initial_hardness_hrc_max: '34' });
  });

  it('weight check uses the engineer defaults (10 s, 1 in 1,000, press operator); the scale rate is unresolved', () => {
    const rows = load('quality-inspection-reference.csv').rows.filter((r) => r.operation === 'weight_check');
    expect(rows.find((r) => r.parameter === 'time_per_check')).toMatchObject({ value: '10', unit: 's', confidence: 'engineering_estimate' });
    expect(rows.find((r) => r.parameter === 'sampling_interval')?.value).toBe('1000');
    expect(rows.find((r) => r.parameter === 'scale_hourly_rate')).toMatchObject({ value: '', confidence: 'unresolved' });
  });

  it('lists what stays unresolved, each with what it needs', () => {
    const { rows } = load('unresolved-costing-gaps.csv');
    expect(rows.map((r) => r.item)).toEqual(['dryer_hourly_rate', 'scale_hourly_rate', 'cooling_circuits_per_mold', 'baffle_count', 'texture_price_per_m2', 'rib_insert_threshold', 'slide_motion_overlap']);
    for (const r of rows) expect(r.needs).not.toBe('');
  });
});
