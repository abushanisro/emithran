// Splits a migration into top-level statements and says what each one does, without a SQL parser: comments, quoted strings,
// quoted identifiers and dollar-quoted bodies (functions, DO blocks) are skipped as opaque, so an INSERT inside a function body or
// a ';' inside a string never counts. Good enough to tell schema changes from data, which is all it is for.

export type StatementKind = 'schema' | 'data' | 'procedural' | 'other';

export interface Statement {
  kind: StatementKind;
  /** For data statements: the table written (schema-qualified as written, lower-cased, quotes removed). */
  table?: string;
  /** For data statements: INSERT, COPY, UPDATE, DELETE or TRUNCATE. */
  verb?: string;
  /** For INSERT ... VALUES: how many row tuples it carries (0 for INSERT ... SELECT). */
  rows?: number;
}

/** The statements of `sql`, with comments removed and bodies kept opaque. A trailing statement without ';' is included. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') (depth++, (i += 2));
        else if (sql[i] === '*' && sql[i + 1] === '/') (depth--, (i += 2));
        else i++;
      }
      current += ' ';
      continue;
    }
    if (c === "'" || c === '"') {
      // '' and "" escape the quote; E'...' backslash escapes are handled by skipping the escaped character.
      const escapes = c === "'" && /[eE]$/.test(current);
      let j = i + 1;
      while (j < n) {
        if (escapes && sql[j] === '\\') j += 2;
        else if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) break;
        else j++;
      }
      current += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 64));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? n : end + tag[0].length;
        current += ' $body$ ';
        i = stop;
        continue;
      }
    }
    if (c === ';') {
      if (current.trim()) out.push(current.trim());
      current = '';
      i++;
      continue;
    }
    current += c;
    i++;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const IDENT = String.raw`((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)`;
const normalise = (name: string) => name.replace(/"/g, '').replace(/\s+/g, '').toLowerCase();

/** What one statement (from splitStatements) does. Psql meta-commands and SET/BEGIN/COMMIT are 'other'. */
export function classifyStatement(statement: string): Statement {
  // A leading WITH (CTE) is skipped to the verb that follows it.
  const text = statement.replace(/^\s*with\s+[\s\S]*?\)\s*(?=(insert|update|delete)\b)/i, '');
  let m: RegExpExecArray | null;
  if ((m = new RegExp(String.raw`^insert\s+into\s+${IDENT}`, 'i').exec(text))) {
    const values = /\bvalues\b([\s\S]*)$/i.exec(text);
    return { kind: 'data', verb: 'INSERT', table: normalise(m[1]!), rows: values ? countTuples(values[1]!) : 0 };
  }
  if ((m = new RegExp(String.raw`^copy\s+${IDENT}`, 'i').exec(text))) return { kind: 'data', verb: 'COPY', table: normalise(m[1]!) };
  if ((m = new RegExp(String.raw`^update\s+(?:only\s+)?${IDENT}`, 'i').exec(text))) return { kind: 'data', verb: 'UPDATE', table: normalise(m[1]!) };
  if ((m = new RegExp(String.raw`^delete\s+from\s+(?:only\s+)?${IDENT}`, 'i').exec(text))) return { kind: 'data', verb: 'DELETE', table: normalise(m[1]!) };
  if ((m = new RegExp(String.raw`^truncate\s+(?:table\s+)?(?:only\s+)?${IDENT}`, 'i').exec(text))) return { kind: 'data', verb: 'TRUNCATE', table: normalise(m[1]!) };
  if (/^(do|select|perform|call)\b/i.test(text)) return { kind: 'procedural' };
  if (/^(create|alter|drop|grant|revoke|comment|reindex|cluster|refresh|security\s+label)\b/i.test(text)) return { kind: 'schema' };
  return { kind: 'other' };
}

/** Top-level parenthesised tuples in a VALUES list: `(1,'a'),(2,'b')` is 2. Nested parentheses are inside a tuple. */
function countTuples(valuesList: string): number {
  let depth = 0;
  let tuples = 0;
  for (const c of valuesList) {
    if (c === '(') {
      if (depth === 0) tuples++;
      depth++;
    } else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[A-Za-z]/.test(c)) break; // ON CONFLICT, RETURNING: the list is over
  }
  return tuples;
}
