import type { FeatureNodeV2, FeatureOccurrence } from '@/lib/types/manufacturing';

import { isBlankProfile } from './feature-graph';

type CutCategory = NonNullable<FeatureOccurrence['cut_category']>;

const CATEGORY_LABEL: Record<CutCategory, string> = {
  outer_profile: 'Outer profile',
  circular_holes: 'Round holes',
  internal_profiles: 'Internal cut-outs',
};

export interface CutLengthPart {
  category: CutCategory;
  label: string;
  lengthMm: number;
  highlight: FeatureNodeV2;
}

export interface CutLengthHighlight {
  /** Every cut face: what "Cut Length" as a whole highlights. */
  all: FeatureNodeV2;
  /** One row per measured category, each highlighting only its own faces. */
  parts: CutLengthPart[];
}

/**
 * The cut path the CAD engine measured (the Blank feature's per-category
 * occurrences, geo_v51+). Returns null for a part analysed before the cut
 * path carried its category, or with no cut faces: the row stays plain text
 * until the part is re-analysed.
 */
export function cutLengthHighlight(features: readonly FeatureNodeV2[]): CutLengthHighlight | null {
  const blank = features.find(isBlankProfile);
  if (!blank) return null;
  const node = (id: string, occurrences: FeatureOccurrence[]): FeatureNodeV2 => ({
    id, feature_type: blank.feature_type, occurrences,
  });
  const parts: CutLengthPart[] = blank.occurrences.flatMap((o) => {
    const category = o.cut_category;
    if (!category || o.face_ids.length === 0) return [];
    return [{
      category,
      label: CATEGORY_LABEL[category],
      lengthMm: o.length_mm ?? 0,
      highlight: node(`cut_length_${category}`, [o]),
    }];
  });
  if (parts.length === 0) return null;
  return { all: node('cut_length_all', parts.flatMap((p) => p.highlight.occurrences)), parts };
}
