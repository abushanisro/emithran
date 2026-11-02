/**
 * The one sanitizer for text that comes from the database (or any user-editable source) and goes into a model's context: part
 * names, materials, warnings, machine names, saved preferences, VAVE BOM fields.
 *
 * Such text is data, never instructions, and the prompts say so; this makes the claim structural:
 * - control characters (newlines, tabs, carriage returns, C0/C1) and Unicode line/paragraph separators become a space, so stored
 *   text cannot start a line that looks like a new instruction, a fake "User:" turn or a heading;
 * - invisible format characters (zero-width, bidirectional overrides) are removed, so what the model reads is what a person sees;
 * - < and > are removed, so stored text cannot close or open the <part_context> style tags the data is wrapped in;
 * - runs of whitespace collapse, and the result is clipped to `max` characters.
 */
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
const INVISIBLE = /\p{Cf}/gu;
const TAG_CHARS = /[<>]/g;

export function modelText(value: unknown, max: number): string {
  const text = String(value ?? '')
    .replace(CONTROL, ' ')
    .replace(INVISIBLE, '')
    .replace(TAG_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Longest single string that modelData() lets through; longer ones are clipped with an ellipsis. */
export const MODEL_DATA_MAX_STRING = 3_000;

/**
 * modelText() applied to every string inside a JSON-like value (tool results, structured prompt data). Numbers, booleans and null
 * pass through; object keys are code-defined and kept.
 */
export function modelData(value: unknown, maxString = MODEL_DATA_MAX_STRING): unknown {
  if (typeof value === 'string') return modelText(value, maxString);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => modelData(v, maxString));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, modelData(v, maxString)]));
  }
  return value;
}
