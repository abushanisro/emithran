/**
 * Text made safe to place inside HTML element content or a quoted attribute.
 * Use for every user, database or LLM value interpolated into an HTML string
 * (innerHTML, document.write, print windows); part names, materials and notes
 * are user-editable and must never become markup.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Markup built by the `html` template below: the only thing `html` inserts without escaping. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/**
 * Builds markup with every interpolated value escaped by escapeHtml, so no value can be forgotten. Fragments built by `html`
 * itself (and arrays of them) are inserted as they are, which is how rows and cells compose.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  const part = (v: unknown): string =>
    v instanceof SafeHtml ? v.value : Array.isArray(v) ? v.map(part).join('') : escapeHtml(v);
  return new SafeHtml(strings.reduce((out, s, i) => out + s + (i < values.length ? part(values[i]) : ''), ''));
}
