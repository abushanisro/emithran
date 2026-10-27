import type { PanelConfig } from './panel';

// The manufacturing specification of a bare board: everything the cost depends on that a Gerber set cannot
// state (stack-up, copper weight, finish, panel, volumes, place of manufacture). Each field is supplied by a
// person or a drawing and carries who said it. Nothing is defaulted: a missing field is reported as missing and
// the cost engines turn that into a gap, never into a number.

export const SURFACE_FINISHES = ['hasl', 'osp', 'enig'] as const;
export type SurfaceFinish = (typeof SURFACE_FINISHES)[number];

export interface Supplied<T> {
  value: T;
  /** Who or what stated it (a drawing, a person, a quotation); stored as the field's provenance. */
  note: string;
}

// What a person has entered so far. Every field optional: the form saves partial work.
export interface BarePcbSpecDraft {
  layers?: Supplied<number>;
  finishedThicknessMm?: Supplied<number>;
  outerCopperOz?: Supplied<number>;
  /** Needed only when layers > 2. */
  innerCopperOz?: Supplied<number>;
  surfaceFinish?: Supplied<SurfaceFinish>;
  panel?: Supplied<PanelConfig>;
  batchSize?: Supplied<number>;
  annualVolume?: Supplied<number>;
  /** Manufacturing location, as named in mhr_records. */
  location?: Supplied<string>;
}

export interface BarePcbSpec {
  layers: Supplied<number>;
  finishedThicknessMm: Supplied<number>;
  outerCopperOz: Supplied<number>;
  innerCopperOz?: Supplied<number>;
  surfaceFinish: Supplied<SurfaceFinish>;
  panel: Supplied<PanelConfig>;
  batchSize: Supplied<number>;
  annualVolume: Supplied<number>;
  location: Supplied<string>;
}

export interface SpecProblem {
  field: string;
  reason: string;
}

export type SpecResolution =
  | { status: 'complete'; spec: BarePcbSpec }
  | { status: 'incomplete'; problems: SpecProblem[] };

const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isPositiveInt = (v: unknown): v is number => isPositive(v) && Number.isInteger(v);

// Copper weights the pcb_variables / raw-material data prices (oz/ft2): 0.5, 1, 1.5, 2. Anything else would have
// no price to read, so it is reported rather than rounded to the nearest.
export const SUPPORTED_COPPER_OZ = [0.5, 1, 1.5, 2] as const;

export function resolveBarePcbSpec(draft: BarePcbSpecDraft): SpecResolution {
  const problems: SpecProblem[] = [];
  const need = <T>(field: string, f: Supplied<T> | undefined, valid: (v: T) => boolean, reason: string): f is Supplied<T> => {
    if (f === undefined) {
      problems.push({ field, reason: 'not supplied' });
      return false;
    }
    if (typeof f.note !== 'string' || f.note.trim() === '') {
      problems.push({ field, reason: 'say who stated it (a note is required)' });
      return false;
    }
    if (!valid(f.value)) {
      problems.push({ field, reason });
      return false;
    }
    return true;
  };

  need('layers', draft.layers, isPositiveInt, 'must be a whole number of at least 1');
  need('finishedThicknessMm', draft.finishedThicknessMm, isPositive, 'must be greater than 0');
  need('outerCopperOz', draft.outerCopperOz, (v) => SUPPORTED_COPPER_OZ.includes(v as 0.5), `must be one of ${SUPPORTED_COPPER_OZ.join(', ')} oz`);
  if (draft.layers && isPositiveInt(draft.layers.value) && draft.layers.value > 2) {
    need('innerCopperOz', draft.innerCopperOz, (v) => SUPPORTED_COPPER_OZ.includes(v as 0.5), `must be one of ${SUPPORTED_COPPER_OZ.join(', ')} oz`);
  }
  need('surfaceFinish', draft.surfaceFinish, (v) => (SURFACE_FINISHES as readonly string[]).includes(v), `must be one of ${SURFACE_FINISHES.join(', ')}`);
  need(
    'panel',
    draft.panel,
    (p) => isPositive(p.lengthMm) && isPositive(p.widthMm) && Number.isFinite(p.borderMm) && p.borderMm >= 0 && Number.isFinite(p.spacingMm) && p.spacingMm >= 0,
    'length and width must be greater than 0; border and spacing zero or more',
  );
  need('batchSize', draft.batchSize, isPositiveInt, 'must be a whole number of at least 1');
  need('annualVolume', draft.annualVolume, isPositiveInt, 'must be a whole number of at least 1');
  need('location', draft.location, (v) => typeof v === 'string' && v.trim() !== '', 'must name a manufacturing location');

  if (problems.length > 0) return { status: 'incomplete', problems };
  return { status: 'complete', spec: draft as BarePcbSpec };
}
