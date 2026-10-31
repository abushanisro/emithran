/**
 * A value for a PostgREST filter string (`.or()`, `.filter()`), double-quoted so commas, dots and parentheses inside it stay literal.
 * Inside the quotes PostgREST reads a backslash as escaping the next character, so both `\` and `"` are escaped: otherwise a
 * trailing backslash in user input escapes the closing quote, and a LIKE escape such as `\%` arrives as a bare wildcard.
 * Apply any LIKE escaping (escapeLikePattern) BEFORE this, and put wildcards meant as wildcards in `value` as plain `%`.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}
