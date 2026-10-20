/**
 * Electronics costing API: board and harness uploads, extraction results, quotes.
 * Routes: /v1/api/electronics/* (the client base URL already ends in /v1/api).
 */

import { apiClient } from './client';

export interface BoardFileRole {
  extension: string;
  role: string;
  family: 'gerber' | 'excellon' | 'report';
  sourceUrl: string;
}

export interface FileFormats {
  boardFiles: BoardFileRole[];
  tabular: string[];
  documents: string[];
  images: string[];
  archives: string[];
}

export type Basis = 'measured' | 'supplied' | 'derived';

export interface FieldProvenance {
  basis: Basis;
  confidence: 'high' | 'medium' | 'low';
  source?: { file?: string; reference?: string; note?: string };
  derivedFrom?: string[];
}

export interface Finding { field?: string; severity: 'info' | 'warning'; message: string }
export interface Unresolved { field: string; reason: string }

interface GraphEnvelope {
  contractVersion: string;
  inputTier: string;
  reviewStatus: 'needs_review' | 'confirmed';
  sourceFiles?: string[];
  extraction?: { parserId: string; parserVersion: string };
  findings?: Finding[];
  provenance: Record<string, FieldProvenance>;
  unresolved: Unresolved[];
}

export type BoardGraph = GraphEnvelope & {
  kind: 'board';
  outline: { lengthMm: number; widthMm: number; thicknessMm?: number; areaMm2?: number };
  layers: number;
  sidesPopulated?: ('top' | 'bottom')[];
  panel?: { boardsPerPanel: number; panelLengthMm?: number; panelWidthMm?: number };
  placements: { side: 'top' | 'bottom'; packageClass: string; count: number; footprint?: string }[];
  holes?: { diameterMm: number; plated: boolean; count: number }[];
  thtParts: { label: string; count: number; jointsPerPart: number }[];
  testPoints?: number;
  pasteAreaMm2?: { top?: number; bottom?: number };
};

export type HarnessGraph = GraphEnvelope & {
  kind: 'harness';
  circuits: { id: string; awg: number; lengthMm: number; colour?: string; terminalCount: number; sealCount: number }[];
  connectors: { id: string; cavities: number }[];
  sleeveLengthMm?: number;
  grommetCount?: number;
  spliceCount?: number;
  branchCount?: number;
  labelCount?: number;
};

export type FeatureGraph = BoardGraph | HarnessGraph;

export interface FileReportRow { name: string; role: string; status: 'used' | 'reference' | 'ignored'; note: string }

export interface UploadFeatures {
  upload: {
    id: string;
    kind: 'board' | 'harness';
    tier: string;
    status: 'uploaded' | 'parsing' | 'needs_review' | 'confirmed' | 'failed';
    failure: { code: string; message: string } | null;
    revisionId: string | null;
    supplied: Record<string, { value: number; note: string }>;
    files: { name: string; sizeBytes: number; format: string; role: string | null }[];
  };
  extraction: { documents: Record<string, unknown>; filesReport: FileReportRow[] } | null;
  featureGraph: { id: string; reviewStatus: 'needs_review' | 'confirmed'; graph: FeatureGraph } | null;
}

export interface SceneComponent {
  designator: string;
  comment: string;
  footprint: string;
  side: 'top' | 'bottom';
  xMm: number;
  yMm: number;
  rotationDeg: number;
}

export interface SceneHole { xMm: number; yMm: number; diameterMm: number; plated: boolean }

// The layers on one frame, and the parts and holes positioned on that frame (all measured from the files).
export interface BoardPreview {
  bounds: { minXMm: number; minYMm: number; widthMm: number; heightMm: number };
  layers: { name: string; role: string; color: string; opacity: number; svg: string }[];
  components: SceneComponent[];
  /** Why the parts cannot be shown; the layers are drawn regardless. */
  componentsError: string | null;
  holes: SceneHole[];
  /** When the drawing was made, and whether it is an older one served because the extraction engine could not be reached. */
  meta?: { renderedAt: string; stale: boolean };
}

export interface StartUploadResult {
  uploadId: string;
  jobId: string;
  designId: string;
  revisionId: string;
  revision: string;
  reused: boolean;
}

/** What a folder upload returns: the top item it became and each part uploaded, with what was left out and why. */
export interface StartAssemblyResult {
  designId: string;
  items: (StartUploadResult & { path: string })[];
  skipped: { path: string; reason: string }[];
  unplaced: string[];
}

export const isAssemblyResult = (r: StartUploadResult | StartAssemblyResult): r is StartAssemblyResult => 'items' in r;

export interface JobStatus {
  jobId: string;
  jobType: 'parse' | 'quote';
  uploadId: string;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'expired';
  attempts: number;
  error?: string;
  featureGraphId?: string;
  costResultId?: string;
}

export interface CostResult {
  id: string;
  uploadId: string;
  revisionId: string | null;
  rateVersion: string | null;
  ratesUsed: unknown[] | null;
  batchSize: number;
  assemblyCostPerUnit: number | null;
  complete: boolean;
  result: {
    gaps: { gapType: string; process: string; reason?: string; requiredCapability?: string }[];
    lines: unknown[];
  };
}

export interface EngineCoverage {
  id: string;
  label: string;
  family: 'pcba' | 'harness';
  readiness: 'gap' | 'pending_confirmation' | 'ready';
  inputs: { key: string; unit: string; requiredSource: string; status: 'gap' | 'pending_confirmation' | 'sourced'; scopes: string[] }[];
}

export interface ReferenceCoverage {
  engines: EngineCoverage[];
  summary: { ready: number; pendingConfirmation: number; gap: number };
  orphanKeys: string[];
}

export interface RevisionView {
  id: string;
  revision: string;
  createdAt: string;
  uploadId: string | null;
  status: UploadFeatures['upload']['status'] | null;
  /** Why the files could not be read, when the revision failed. */
  failure: { code: string; message: string } | null;
}

export type GraphSummary =
  | { kind: 'board'; assembled: boolean; layers: number; lengthMm: number; widthMm: number; thicknessMm: number | null; holeCount: number; placementCount: number; unresolvedCount: number }
  | { kind: 'harness'; circuitCount: number; connectorCount: number; unresolvedCount: number };

export type ItemType = 'assembly' | 'sub_assembly' | 'child_part';

export interface DesignView {
  id: string;
  name: string;
  /** 'assembly' for a container (assembly or sub-assembly); a child part is a board or a harness. */
  kind: 'board' | 'harness' | 'assembly';
  itemType: ItemType;
  /** The container this design sits in; null at the top level. */
  parentId: string | null;
  projectId: string | null;
  createdAt: string;
  revisions: RevisionView[];
  summary: GraphSummary | null;
}

export type SuppliedFacts = Record<string, { value: number; note: string }>;

export interface DeleteResult { designs: number; revisions: number; files: number; fileRemovalFailed: boolean }

export const electronicsApi = {
  createContainer: (args: { itemType: 'assembly' | 'sub_assembly'; name: string; projectId?: string; parentDesignId?: string }) =>
    apiClient.post<DesignView>('/electronics/designs', args),
  deleteDesign: (designId: string) => apiClient.delete<DeleteResult>(`/electronics/designs/${designId}`),
  deleteRevision: (designId: string, revisionId: string) => apiClient.delete<DeleteResult>(`/electronics/designs/${designId}/revisions/${revisionId}`),
  reparse: (uploadId: string) => apiClient.post<{ jobId: string }>(`/electronics/uploads/${uploadId}/reparse`, {}),

  fileFormats: () => apiClient.get<FileFormats>('/electronics/file-formats', { retry: false }),

  startUpload(args: {
    files: File[];
    // Omitted for a file upload: the server decides board or harness from the files.
    kind?: 'board' | 'harness';
    tier?: 'A' | 'B' | 'C' | 'D';
    designName?: string;
    designId?: string;
    projectId?: string;
    parentDesignId?: string;
    /** One relative path per file when a folder was chosen: the structure becomes assembly, sub-assembly and child parts. */
    paths?: string[];
    revision?: string;
    supplied?: SuppliedFacts;
  }): Promise<StartUploadResult | StartAssemblyResult> {
    const form = new FormData();
    if (args.kind) form.append('kind', args.kind);
    if (args.tier) form.append('tier', args.tier);
    if (args.designName) form.append('designName', args.designName);
    if (args.designId) form.append('designId', args.designId);
    if (args.projectId) form.append('projectId', args.projectId);
    if (args.parentDesignId) form.append('parentDesignId', args.parentDesignId);
    if (args.paths) form.append('paths', JSON.stringify(args.paths));
    if (args.revision) form.append('revision', args.revision);
    if (args.supplied && Object.keys(args.supplied).length > 0) form.append('supplied', JSON.stringify(args.supplied));
    for (const file of args.files) form.append('files', file, file.name);
    return apiClient.uploadFiles<StartUploadResult | StartAssemblyResult>('/electronics/uploads', form, { timeout: 120_000 });
  },

  designs: (projectId: string) => apiClient.get<DesignView[]>(`/electronics/designs?projectId=${encodeURIComponent(projectId)}`, { retry: false }),
  design: (designId: string) => apiClient.get<DesignView>(`/electronics/designs/${designId}`, { retry: false }),
  job: (jobId: string) => apiClient.get<JobStatus>(`/electronics/jobs/${jobId}`, { retry: false }),
  preview: (uploadId: string) => apiClient.get<BoardPreview>(`/electronics/uploads/${uploadId}/preview`, { retry: false }),
  /** A small SVG of the board for list cards, read from storage by the platform (svg is null when none can be shown). */
  thumbnail: (uploadId: string) => apiClient.get<{ svg: string | null }>(`/electronics/uploads/${uploadId}/thumbnail`, { retry: false }),
  features: (uploadId: string) => apiClient.get<UploadFeatures>(`/electronics/uploads/${uploadId}/features`, { retry: false }),
  requestQuote: (uploadId: string, batchSize: number) => apiClient.post<{ jobId: string }>('/electronics/quotes', { uploadId, batchSize }),
  result: (resultId: string) => apiClient.get<CostResult>(`/electronics/results/${resultId}`, { retry: false }),
  coverage: () => apiClient.get<ReferenceCoverage>('/electronics/reference-coverage', { retry: false }),
};
