/**
 * A value for a PostgREST filter string (`.or()`, `.filter()`), double-quoted so commas, dots and parentheses inside it stay literal.
 * Inside the quotes PostgREST reads a backslash as escaping the next character, so both `\` and `"` are escaped: otherwise a
 * trailing backslash in user input escapes the closing quote, and a LIKE escape such as `\%` arrives as a bare wildcard.
 * Apply any LIKE escaping (escapeLikePattern) BEFORE this, and put wildcards meant as wildcards in `value` as plain `%`.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

/** Escapes LIKE/ILIKE metacharacters so a grade like "6061_T6" or a search for "50%" matches literally. */
export function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** A quoted ILIKE pattern matching `text` anywhere, literally: user or model text can add neither filters nor wildcards. */
export function ilikeContains(text: string): string {
  return quoteFilterValue(`%${escapeLikePattern(text)}%`);
}

/** An `.or()` filter: any of `columns` contains `text` (case-insensitive, literal). The way to build a text search from input. */
export function orIlikeContains(columns: readonly string[], text: string): string {
  const pattern = ilikeContains(text);
  return columns.map((column) => `${column}.ilike.${pattern}`).join(',');
}
