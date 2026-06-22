/**
 * Normalise national tolerance standard variants to their ISO 2768 canonical form.
 * Keys are regex-safe prefix strings; matching is case-insensitive.
 *
 * Usage:
 *   import { normaliseToleranceStandard } from '@/lib/manufacturing-kb/tolerance-standards';
 *   normaliseToleranceStandard('UNI EN 22768/2 wH') // → 'ISO 2768-mH'
 */

export const TOLERANCE_STANDARD_MAP: Record<string, string> = {
  // Italian UNI
  'UNI EN 22768': 'ISO 2768',
  // German DIN
  'DIN ISO 2768': 'ISO 2768',
  'DIN EN 22768': 'ISO 2768',
  'DIN 2768':     'ISO 2768',
  // British BS
  'BS EN 22768':  'ISO 2768',
  'BS ISO 2768':  'ISO 2768',
  // Japanese JIS
  'JIS B 0405':   'ISO 2768',
  'JIS B 0419':   'ISO 2768',
  // French NF
  'NF EN 22768':  'ISO 2768',
  // ISO itself (passthrough aliases)
  'ISO 22768':    'ISO 2768',
};

/**
 * Given an extracted general_tolerances string, return its canonical ISO 2768 form
 * if it maps to one, otherwise return the original string unchanged.
 */
export function normaliseToleranceStandard(raw: string): string {
  if (!raw) return raw;
  const upper = raw.toUpperCase();
  for (const [prefix, canonical] of Object.entries(TOLERANCE_STANDARD_MAP)) {
    if (upper.startsWith(prefix.toUpperCase())) {
      // Preserve any suffix after the matched prefix (e.g. '/2 wH' → append to canonical)
      const suffix = raw.slice(prefix.length).trim();
      return suffix ? `${canonical} ${suffix}` : canonical;
    }
  }
  return raw;
}
