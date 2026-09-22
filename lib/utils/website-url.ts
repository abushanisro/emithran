// Vendor "Website" values come straight from imported supplier CSVs and are
// not validated at import time -- some rows carry a real domain with no
// protocol (e.g. "www.acme.com"), others carry a literal placeholder string
// (e.g. "Not Specified") instead of being left blank. Rendered directly as
// an <a href>, a placeholder string is a relative link, so the browser
// resolves it against the current page (e.g. localhost:3000/Not%20Specified)
// and 404s instead of opening an external site.
const PLACEHOLDER_VALUES = new Set([
  'not specified', 'not available', 'n/a', 'na', 'none', 'nil', 'tbd', '-', '--', 'unknown',
]);

/**
 * Returns a safe, absolute URL to link to, or null when the raw value is
 * empty, a known placeholder, or not shaped like a domain (so it can't be
 * safely turned into a link at all).
 */
export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  if (PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // A real domain has no spaces and at least one dot; anything else (free
  // text, a placeholder phrase not in the known set) can't be safely linked.
  if (/\s/.test(trimmed) || !trimmed.includes('.')) return null;
  return `https://${trimmed}`;
}
