// Rapid Prototyping's cleaning, timed per feature (memory/Rapid prototyping rapid_prototyping_variables.csv, the cleaning* variables). Pure.
//
// The loose powder or uncured resin left in a hole or void takes a base time of its type to clear, times a multiplier of its size (a hole's
// diameter, a void's volume: a small one is harder to reach, a large one quicker per its size) and one of its depth (a deep one longer):
//   size  < Small limit -> Small multiplier;  > Large limit -> Large multiplier;  else Medium multiplier
//   depth < Small limit -> Small multiplier;  > Large limit -> Large multiplier;  else Medium multiplier
// The part's cleaning is cleaningBaseTime plus every feature's time (Rapid Prototyping - Cleaning). The features are the cad-engine's
// (additive/feature_extractor.py holes, additive/voids.py voids); each type has its own variables.

/** A hole or void cleaning reads (auto-fill's additiveBuild holes and voids). */
export interface CleaningFeature {
  id: string;
  type: CleaningType;
  /** A hole's diameter (mm; a ComplexHole's equivalent diameter) or a void's volume (mm³), as its type is sized. */
  size: number;
  depthMm: number;
}

export type CleaningType = 'SimpleHole' | 'MultiStepHole' | 'RingedHole' | 'ComplexHole' | 'Void' | 'Ring' | 'ComplexVoid';

/** The variable names one feature type's time is read from. */
export interface CleaningRule {
  label: string;
  /** What the size is: a diameter (mm) or a volume (mm³). */
  measure: 'diameter' | 'volume';
  base: string;
  size: { smallLimit: string; largeLimit: string; small: string; medium: string; large: string };
  depth: { smallLimit: string; largeLimit: string; small: string; medium: string; large: string };
}

const HOLE_DEPTH = {
  smallLimit: 'cleaningDepthSmallLimit', largeLimit: 'cleaningDepthLargeLimit',
  small: 'cleaningDepthSmallMultiplier', medium: 'cleaningDepthMediumMultiplier', large: 'cleaningDepthLargeMultiplier',
};
const sizeVars = (stem: string, limitStem = stem) => ({
  smallLimit: `cleaningSmall${limitStem}Limit`, largeLimit: `cleaningLarge${limitStem}Limit`,
  small: `cleaningSmall${stem}Multiplier`, medium: `cleaningMedium${stem}Multiplier`, large: `cleaningLarge${stem}Multiplier`,
});
const depthVars = (stem: string) => ({
  smallLimit: `cleaningSmall${stem}DepthLimit`, largeLimit: `cleaningLarge${stem}DepthLimit`,
  small: `cleaningSmall${stem}DepthMultiplier`, medium: `cleaningMedium${stem}DepthMultiplier`, large: `cleaningLarge${stem}DepthMultiplier`,
});

/** Each feature type's variables, as memory/Rapid prototyping names them. */
export const CLEANING_RULES: Readonly<Record<CleaningType, CleaningRule>> = {
  SimpleHole: { label: 'Simple hole', measure: 'diameter', base: 'cleaningSimpleHoleBase', size: sizeVars('Hole'), depth: HOLE_DEPTH },
  MultiStepHole: { label: 'Multi-step hole', measure: 'diameter', base: 'cleaningMultiHoleBase', size: sizeVars('Multi'), depth: HOLE_DEPTH },
  RingedHole: { label: 'Ringed hole', measure: 'diameter', base: 'cleaningRingedHoleBase', size: sizeVars('RingHole'), depth: HOLE_DEPTH },
  ComplexHole: { label: 'Complex hole', measure: 'diameter', base: 'cleaningComplexHoleBase', size: sizeVars('Complex'), depth: HOLE_DEPTH },
  Void: { label: 'Void', measure: 'volume', base: 'cleaningSimpleVoidBase', size: sizeVars('Void'), depth: depthVars('Void') },
  Ring: { label: 'Ringed void', measure: 'volume', base: 'cleaningRingBase', size: sizeVars('Ring'), depth: depthVars('Ring') },
  ComplexVoid: { label: 'Complex void', measure: 'volume', base: 'cleaningComplexVoidBase', size: sizeVars('ComplexVoid'), depth: depthVars('ComplexVoid') },
};

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** The holes and voids of an additiveBuild as cleaning reads them; null when the analysis predates the voids (Refresh analysis). */
export function cleaningFeatures(build: { holes?: unknown; voids?: unknown } | null | undefined): CleaningFeature[] | null {
  if (!build || !Array.isArray(build.voids) || !Array.isArray(build.holes)) return null;
  const out: CleaningFeature[] = [];
  for (const h of build.holes as Array<Record<string, unknown>>) {
    const type = h.feature_type ?? h.featureType ?? 'SimpleHole';
    const size = num(h.diameter_mm ?? h.diameterMm);
    const depth = num(h.depth_mm ?? h.depthMm);
    if ((type === 'SimpleHole' || type === 'MultiStepHole' || type === 'RingedHole') && size != null && depth != null) {
      out.push({ id: String(h.id), type, size, depthMm: depth });
    }
  }
  for (const v of build.voids as Array<Record<string, unknown>>) {
    const ftype = v.feature_type ?? v.featureType;
    const depth = num(v.depth_mm ?? v.depthMm);
    if (depth == null) continue;
    if (ftype === 'ComplexHole') {
      const d = num(v.equivalent_diameter_mm ?? v.equivalentDiameterMm);
      if (d != null) out.push({ id: String(v.id), type: 'ComplexHole', size: d, depthMm: depth });
      continue;
    }
    const volume = num(v.volume_mm3 ?? v.volumeMm3);
    if (volume == null) continue;
    if (ftype === 'Ring') out.push({ id: String(v.id), type: 'Ring', size: volume, depthMm: depth });
    else if (ftype === 'Void') out.push({ id: String(v.id), type: v.variant === 'complex' ? 'ComplexVoid' : 'Void', size: volume, depthMm: depth });
  }
  return out;
}
