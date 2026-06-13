/**
 * DrawingBrief — extracted from the BOM item's 2D drawing PDF via Claude
 * vision. Cached on bom_items.drawing_extraction (JSONB) and fed into the
 * EngineeringBrief so the LLM can choose processes informed by the actual
 * tolerance + GD&T + surface-finish callouts on the drawing, not just the
 * BOM metadata.
 *
 * The "Why this matters" cheat sheet for the LLM:
 *   - Position/concentricity tolerance < 0.05  → add precision finish op
 *   - Ra ≤ 0.4 μm                              → grinding / lapping op
 *   - Tight bore diameter tolerance (H6/H7)    → bore finish op (boring/reaming)
 *   - Hardness ≥ 40 HRC                        → heat-treat op required
 *   - Threaded hole                            → tapping op
 *   - Counterbore/countersink                  → secondary milling op
 */

export interface DrawingDatum {
  label: string;       // "A", "B", "C"
  feature: string;     // free-text feature description
}

export interface DrawingDimension {
  balloon: number | null;
  label: string;       // "Hole Ø8", "Length 19", "Bore Ø6.35"
  nominal: number;
  unit: string;        // "mm" mostly
  upperTol: number | null;
  lowerTol: number | null;
  toleranceClass: string | null;   // "h7", "H8", "IT8", "k6"
  type: 'linear' | 'diameter' | 'radius' | 'angular';
}

export interface DrawingGdt {
  feature: string;
  symbol:
    | 'position'
    | 'concentricity'
    | 'circularity'
    | 'cylindricity'
    | 'flatness'
    | 'straightness'
    | 'perpendicularity'
    | 'parallelism'
    | 'angularity'
    | 'runout'
    | 'total_runout'
    | 'symmetry'
    | 'profile_line'
    | 'profile_surface'
    | string;          // fallback for symbols not in the enum
  tolerance: number;
  datumRefs: string[];
  modifier: string | null; // "M" (MMC), "L" (LMC), "P" (proj), etc.
}

export interface DrawingSurfaceFinish {
  feature: string;
  raMicrons: number | null;
  rzMicrons: number | null;
  directionSymbol: string | null; // "‖", "⊥", "X", etc.
}

export interface DrawingThread {
  feature: string;
  spec: string;        // "M6×1", "1/4-20 UNC-2B", "G1/4"
}

export interface DrawingHole {
  feature: string;
  diameter: number;
  depth: number | null;
  throughHole: boolean;
  counterbore: { diameter: number; depth: number } | null;
  countersink: { diameter: number; angle: number } | null;
}

export interface DrawingBrief {
  available: boolean;              // false if extraction not attempted or failed
  source: 'cache' | 'fresh' | 'unavailable';
  extractedAt: string | null;      // ISO timestamp
  extractionModel: string | null;
  sourceFilePath: string | null;

  drawingNumber: string | null;
  revision: string | null;
  title: string | null;
  scale: string | null;

  material: string | null;
  heatTreatment: string | null;
  surfaceTreatment: string | null;
  hardness: string | null;

  generalTolerance: string | null; // "ISO 2768-mK", "ASME Y14.5"
  datums: DrawingDatum[];

  dimensions: DrawingDimension[];
  gdt: DrawingGdt[];
  surfaceFinishes: DrawingSurfaceFinish[];
  threads: DrawingThread[];
  holes: DrawingHole[];
  notes: string[];

  extractionWarnings: string[];    // anything the model flagged as uncertain
}

export const UNAVAILABLE_DRAWING_BRIEF: DrawingBrief = {
  available: false,
  source: 'unavailable',
  extractedAt: null,
  extractionModel: null,
  sourceFilePath: null,
  drawingNumber: null,
  revision: null,
  title: null,
  scale: null,
  material: null,
  heatTreatment: null,
  surfaceTreatment: null,
  hardness: null,
  generalTolerance: null,
  datums: [],
  dimensions: [],
  gdt: [],
  surfaceFinishes: [],
  threads: [],
  holes: [],
  notes: [],
  extractionWarnings: [],
};
