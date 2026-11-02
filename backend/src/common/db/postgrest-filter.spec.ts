import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { escapeLikePattern, ilikeContains, orIlikeContains, quoteFilterValue } from './postgrest-filter';
import { buildMaterialSearchOrClause } from '../../modules/raw-materials/raw-materials.service';

// What PostgREST reads back out of a quoted value: a backslash escapes the next character. Checked against a real PostgREST
// (test/postgrest/smoke.ts runs these helpers through one).
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

describe('ilikeContains / orIlikeContains', () => {
  it('keeps an injected filter inside the one quoted value', () => {
    expect(orIlikeContains(['name', 'grade'], ',id.not.is.null')).toBe('name.ilike."%,id.not.is.null%",grade.ilike."%,id.not.is.null%"');
  });

  it('escapes LIKE wildcards in the text, keeps its own', () => {
    expect(unquote(ilikeContains('50%_x'))).toBe('%50\\%\\_x%');
    expect(escapeLikePattern('6061_T6')).toBe('6061\\_T6');
  });
});

describe('buildMaterialSearchOrClause', () => {
  it('quotes each pattern whole, wildcards inside the quotes, input backslash escaped for LIKE and for PostgREST', () => {
    expect(buildMaterialSearchOrClause('ab\\')).toContain('grade.ilike."%ab\\\\\\\\%"');
  });
});

// Source scan: a PostgREST `.or()` filter built by interpolating text into a template literal is how request and model text
// injected filters (`,id.not.is.null`). Every interpolation inside an `.or(` argument must go through a quoting helper; text
// searches use orIlikeContains, which needs no template at all.
const QUOTING_HELPERS = /^(quoteFilterValue|ilikeContains|orIlikeContains)\(/;
const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [p] : [];
  });
}

/** The text of the call argument starting at `open` (just after the `(`), up to the matching `)`. */
function callArgument(src: string, open: number): string {
  let depth = 1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open, i);
  }
  return src.slice(open);
}

/** The `${...}` expressions in `text`, with nested braces balanced. */
function interpolations(text: string): string[] {
  const out: string[] = [];
  for (let i = text.indexOf('${'); i !== -1; i = text.indexOf('${', i + 2)) {
    let depth = 1;
    let j = i + 2;
    for (; j < text.length && depth > 0; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
    }
    out.push(text.slice(i + 2, j - 1).trim());
    i = j - 2;
  }
  return out;
}

function unquotedOrInterpolations(src: string): string[] {
  const found: string[] = [];
  for (let at = src.indexOf('.or('); at !== -1; at = src.indexOf('.or(', at + 4)) {
    for (const expr of interpolations(callArgument(src, at + 4))) {
      if (!QUOTING_HELPERS.test(expr)) found.push(expr);
    }
  }
  return found;
}

describe('every .or() filter quotes what it interpolates', () => {
  it('catches a raw interpolation (the scan works)', () => {
    expect(unquotedOrInterpolations('q.or(`name.ilike.%${query.search}%,d.ilike.%${query.search}%`)')).toEqual(['query.search', 'query.search']);
    expect(unquotedOrInterpolations('q.or(`a.eq.${quoteFilterValue(x)}`).or(orIlikeContains([\'a\'], y))')).toEqual([]);
  });

  it('finds none in backend/src', () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      unquotedOrInterpolations(readFileSync(file, 'utf8')).map((expr) => `${relative(SRC, file)}: \${${expr}}`),
    );
    expect(offenders).toEqual([]);
  });
});
