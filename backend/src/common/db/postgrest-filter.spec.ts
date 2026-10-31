import { quoteFilterValue } from './postgrest-filter';
import { buildMaterialSearchOrClause } from '../../modules/raw-materials/raw-materials.service';

// What PostgREST reads back out of a quoted value: a backslash escapes the next character. Checked against a real PostgREST.
function unquote(quoted: string): string {
  expect(quoted.startsWith('"') && quoted.endsWith('"')).toBe(true);
  return quoted.slice(1, -1).replace(/\\(.)/g, '$1');
}

describe('quoteFilterValue', () => {
  it.each([
    ['plain', 'Steel'],
    ['comma and parentheses', 'a,b (c)'],
    ['a double quote', 'say "hi"'],
    ['a trailing backslash', 'abc\\'],
    ['a LIKE escape', '10\\%'],
  ])('round-trips %s', (_label, value) => {
    expect(unquote(quoteFilterValue(value))).toBe(value);
  });

  it('cannot be closed early by the input', () => {
    // An unescaped quote inside would end the value; every quote in the body is preceded by an escaping backslash.
    const body = quoteFilterValue('x\\",grade.neq.y').slice(1, -1);
    expect(body).not.toMatch(/(^|[^\\])(\\\\)*"/);
  });
});

describe('buildMaterialSearchOrClause', () => {
  it('quotes each pattern whole, wildcards inside the quotes', () => {
    expect(buildMaterialSearchOrClause('ab\\')).toContain('grade.ilike."%ab\\\\%"');
  });
});
