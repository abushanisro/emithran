// The versioned feature-graph contract. Engines read these types only, never the raw
// upload. The canonical definition is the JSON Schema in ecad-engine/contract/schemas;
// these interfaces mirror it and a fixture spec keeps the two honest.

// The version the extractor emits. 1.2 added `fabrication`; every addition is optional, so a stored 1.1 graph stays valid.
export const FEATURE_GRAPH_CONTRACT_VERSION = '1.2' as const;
export type BoardContractVersion = '1.1' | '1.2';
export type HarnessContractVersion = '1.1';

export type InputTier = 'A' | 'B' | 'C' | 'D';
export type ReviewStatus = 'needs_review' | 'confirmed';
export type BoardSide = 'top' | 'bottom';

export type PackageClass =
  | 'chip_0402'
  | 'chip_0603'
  | 'chip_0805'
  | 'chip_1206'
  | 'sot'
  | 'sod'
  | 'qfn'
  | 'htssop'
  | 'dpak'
  | 'smd_electrolytic'
  | 'unknown';

export type BoardFlag = 'fine_pitch' | 'bga' | 'qfn_under_body' | 'tall' | 'heavy';

// A cross-check or warning recorded during extraction, for the reviewer.
export interface Finding {
  field?: string;
  severity: 'info' | 'warning';
  message: string;
}

export interface UnresolvedField {
  field: string;
  reason: string;
}

export type ProvenanceBasis = 'measured' | 'supplied' | 'derived';
export type Confidence = 'high' | 'medium' | 'low';

// Where one field of a graph came from. measured: read from a source file by a parser;
// supplied: stated by a person or a drawing; derived: computed from other graph fields.
export interface FieldProvenance {
  basis: ProvenanceBasis;
  confidence: Confidence;
  source?: { file?: string; reference?: string; note?: string };
  derivedFrom?: string[];
}

// The parser behind the measured fields; the same inputs and parserVersion give the same graph.
export interface ExtractionInfo {
  parserId: string;
  parserVersion: string;
}

export interface BoardFeatureGraph {
  contractVersion: BoardContractVersion;
  kind: 'board';
  inputTier: InputTier;
  reviewStatus: ReviewStatus;
  outline: { lengthMm: number; widthMm: number; thicknessMm?: number; areaMm2?: number };
  layers: number;
  sidesPopulated?: BoardSide[];
  panel?: {
    boardsPerPanel: number;
    panelLengthMm?: number;
    panelWidthMm?: number;
    depanel?: 'router' | 'v_score' | 'none';
    depanelLengthMm?: number;
  };
  placements: { side: BoardSide; packageClass: PackageClass; count: number; footprint?: string }[];
  holes?: { diameterMm: number; plated: boolean; count: number }[];
  /** Bare-board facts a Gerber set can state (contract 1.2). Finish, colour, copper weight and stack-up are supplied, never here. */
  fabrication?: {
    soldermask?: { top?: boolean; bottom?: boolean };
    silkscreen?: { top?: boolean; bottom?: boolean };
    minHoleMm?: number;
    minTraceWidthMm?: number;
  };
  thtParts: { label: string; count: number; jointsPerPart: number }[];
  uniquePartNumbers?: number;
  flags?: BoardFlag[];
  pasteAreaMm2?: { top?: number; bottom?: number };
  testPoints?: number;
  coating?: { coatAreaMm2?: number; pottingVolumeMl?: number };
  sourceFiles?: string[];
  extraction?: ExtractionInfo;
  findings?: Finding[];
  /** One entry per data field present, keyed by top-level field name. */
  provenance: Record<string, FieldProvenance>;
  unresolved: UnresolvedField[];
}

export interface HarnessFeatureGraph {
  contractVersion: HarnessContractVersion;
  kind: 'harness';
  inputTier: InputTier;
  reviewStatus: ReviewStatus;
  circuits: {
    id: string;
    awg: number;
    lengthMm: number;
    colour?: string;
    terminalCount: number;
    sealCount: number;
  }[];
  connectors: { id: string; cavities: number }[];
  sleeveLengthMm?: number;
  grommetCount?: number;
  spliceCount?: number;
  branchCount?: number;
  labelCount?: number;
  sourceFiles?: string[];
  extraction?: ExtractionInfo;
  findings?: Finding[];
  provenance: Record<string, FieldProvenance>;
  unresolved: UnresolvedField[];
}

export type ElectronicsFeatureGraph = BoardFeatureGraph | HarnessFeatureGraph;
