import { readFileSync } from 'fs';
import { join } from 'path';

// The open-source sand-casting tolerance / machining-allowance guidance (reference/casting-tolerance-guidance.csv): grade ranges only, each
// with the source it was read from. It is guidance for an engineer choosing a grade, never a value the costing uses: copyrighted ISO
// tables (grade x size band -> mm) are not copied, a family without an open source says so instead of borrowing another's grades.
const FILE = join(__dirname, '../../../../../modules/bom-items/costing/casting/sand/reference/casting-tolerance-guidance.csv');

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

const [header, ...body] = parseCsv(readFileSync(FILE, 'utf8'));
const rows = body.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ''])));

// The material types of memory/Sand casting/Raw Material/raw_materials.csv (117 materials; three have no type and are listed as
// unmapped in the README, not guessed).
const FAMILIES = ['Aluminum', 'Aluminum Bronze', 'Brass', 'Bronze', 'Copper', 'Ductile Iron', 'Gray Iron', 'Magnesium', 'Malleable Cast Iron',
  'Manganese Bronze', 'Silicon Brass', 'Stainless Steel', 'Steel', 'Zinc', 'Zinc-Aluminum'];

describe('casting tolerance guidance', () => {
  it('has the expected columns and every row has all of them', () => {
    expect(header).toEqual(['family', 'moulding_method', 'ct_grade_range', 'rmag_grade_range', 'typical_allowance_mm', 'source_publisher',
      'source_url', 'iso_edition_referenced', 'evidence_quote', 'confidence', 'notes', 'retrieved']);
    for (const r of body) expect(r).toHaveLength(header!.length);
  });

  it('covers every material family of the raw-material list', () => {
    const covered = new Set(rows.flatMap((r) => r.family!.split('|')));
    for (const f of FAMILIES) expect(covered).toContain(f);
  });

  it('cites a source, its words and the retrieval date for every value; a row without a source carries no value', () => {
    for (const r of rows) {
      const hasValue = Boolean(r.ct_grade_range || r.rmag_grade_range || r.typical_allowance_mm);
      expect(r.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (r.confidence === 'none') {
        expect(hasValue).toBe(false);
        expect(r.notes).toMatch(/no open source found/);
      } else {
        expect(r.source_publisher).not.toBe('');
        expect(r.source_url).toMatch(/^https:\/\//);
        expect(r.evidence_quote).not.toBe('');
      }
    }
  });

  it('holds grade ranges only: CT/DCTG grades and RMAG letters A-K, never a size-band table', () => {
    for (const r of rows) {
      if (r.rmag_grade_range) expect(r.rmag_grade_range).toMatch(/^[A-K](-[A-K])?$/);
      if (r.ct_grade_range) expect(r.ct_grade_range).toMatch(/^(CT|DCTG) \d{1,2}(-\d{1,2})?/);
      // one typical range per row at most, never a list of size bands
      expect((r.typical_allowance_mm!.match(/\d+(\.\d+)?/g) ?? []).length).toBeLessThanOrEqual(2);
    }
  });
});
