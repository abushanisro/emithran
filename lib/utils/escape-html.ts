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
