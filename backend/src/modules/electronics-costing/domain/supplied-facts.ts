// Facts about a board that no Gerber set can state and a person or a document supplies: thickness (fabrication
// drawing), the layer count the documents state (cross-checked against the copper files), and how many boards sit on a
// panel. Each carries who said it. Nothing else may be supplied: the engine measures everything the files hold.

export interface SuppliedFact {
  value: number;
  /** Who or what stated it (a document name, a person); shown beside the value and stored as its provenance. */
  note: string;
}

export type SuppliedFacts = Record<string, SuppliedFact>;

interface FactRule {
  key: string;
  integer: boolean;
  max: number;
}

export const SUPPLIABLE_FACTS: readonly FactRule[] = [
  { key: 'outline.thicknessMm', integer: false, max: 50 },
  { key: 'layers', integer: true, max: 64 },
  { key: 'panel.boardsPerPanel', integer: true, max: 10_000 },
];

export const MAX_NOTE_LENGTH = 200;

export type SuppliedValidation = { ok: true; facts: SuppliedFacts } | { ok: false; message: string };

export function validateSuppliedFacts(input: unknown): SuppliedValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, message: 'supplied must be an object' };
  const facts: SuppliedFacts = {};
  for (const [key, raw] of Object.entries(input)) {
    const rule = SUPPLIABLE_FACTS.find((r) => r.key === key);
    if (!rule) return { ok: false, message: `"${key}" cannot be supplied; allowed: ${SUPPLIABLE_FACTS.map((r) => r.key).join(', ')}` };
    const fact = raw as { value?: unknown; note?: unknown };
    if (typeof fact?.value !== 'number' || !Number.isFinite(fact.value) || fact.value <= 0 || fact.value > rule.max) {
      return { ok: false, message: `${key}: value must be a number greater than 0 and at most ${rule.max}` };
    }
    if (rule.integer && !Number.isInteger(fact.value)) return { ok: false, message: `${key}: value must be a whole number` };
    if (typeof fact.note !== 'string' || fact.note.trim() === '' || fact.note.length > MAX_NOTE_LENGTH) {
      return { ok: false, message: `${key}: say who stated it (a note of 1 to ${MAX_NOTE_LENGTH} characters)` };
    }
    facts[key] = { value: fact.value, note: fact.note.trim() };
  }
  return { ok: true, facts };
}
