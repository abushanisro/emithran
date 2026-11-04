import { castingProcessOfFamily } from './costing/casting/casting-cost-summary';

// The one place that says whether a BOM item has been analysed well enough to cost. It is derived from what is already stored
// (the feature graph, the drawing, the casting-analysis rows), never kept in a column of its own, so it cannot drift from them.
// Pure: the callers read the data, this decides. "Analysed" is separate from "feasible" (the process fits the part) and from
// "may be applied" (every check for that operation passed): this answers only the first.

/** none: never run. running: queued or in progress. ready: finished and current. stale: finished by an older engine. failed: the last run failed. */
export type AnalysisKindStatus = 'none' | 'running' | 'ready' | 'stale' | 'failed';

/** An analysis the item does not need (no 3D file, no drawing, a family without a casting analysis). */
export type AnalysisKindStatusOrNotRequired = AnalysisKindStatus | 'not_required';

export type MissingAnalysis = 'cad_features' | 'casting_analysis';

/** What to tell the user to run, for each missing analysis. */
export const MISSING_ANALYSIS_TEXT: Readonly<Record<MissingAnalysis, string>> = {
  cad_features: 'run Refresh Analysis to extract the CAD features',
  casting_analysis: 'the casting analysis must finish',
};

export interface AnalysisStatus {
  /** CAD feature extraction: the feature graph and the part family. */
  cad: AnalysisKindStatusOrNotRequired;
  /** The 2D drawing's intelligence. Informational: a drawing is optional, so it never blocks. */
  drawing: AnalysisKindStatusOrNotRequired;
  /** The casting worker's analysis, for the families that have one (sand casting). */
  casting: AnalysisKindStatusOrNotRequired;
  /** Every required analysis is finished and current. */
  ready: boolean;
  /** What to run, in order, when not ready. */
  missing: MissingAnalysis[];
}

/** The status of an item's casting analysis for its current file and draw direction, from the stored rows' statuses (any order). */
export function castingStatusOf(rowStatuses: readonly string[]): AnalysisKindStatus {
  // A finished analysis answers the question even when a newer request is queued: it is the one the cost route measures by.
  if (rowStatuses.some((s) => s === 'succeeded' || s === 'partial')) return 'ready';
  if (rowStatuses.some((s) => s === 'queued' || s === 'running')) return 'running';
  if (rowStatuses.includes('failed')) return 'failed';
  return 'none';
}

/** The feature-graph version the CAD engine currently writes. */
export function currentFeatureGraphVersion(): number {
  return parseInt(process.env.FEATURE_GRAPH_VERSION ?? '4', 10);
}

export interface AnalysisStatusInput {
  file3dPath?: string | null;
  file2dPath?: string | null;
  featureGraph?: { classification?: { family?: string | null } | null; feature_graph_version?: number | null } | null;
  drawingIntelligence?: unknown;
  familyClassification?: string | null;
  manufacturingFamilyOverride?: string | null;
}

/**
 * @param casting the item's casting-analysis status, read by the caller; only consulted for a family that has a casting analysis.
 * @param currentVersion the feature-graph version the engine writes now (see currentFeatureGraphVersion).
 */
export function deriveAnalysisStatus(
  item: AnalysisStatusInput,
  casting: AnalysisKindStatus,
  currentVersion: number,
): AnalysisStatus {
  const family = (item.manufacturingFamilyOverride ?? '').trim()
    || item.featureGraph?.classification?.family
    || item.familyClassification
    || null;

  // A part with no 3D file has nothing to extract features from: it is costed from what was entered, and that is not blocked here.
  const hasModel = !!item.file3dPath;
  let cad: AnalysisKindStatusOrNotRequired = 'not_required';
  if (hasModel) {
    // A featureGraph without a classification (geometry only, or a cache) is not an analysis.
    if (!item.featureGraph?.classification?.family) cad = 'none';
    else cad = (item.featureGraph.feature_graph_version ?? 0) < currentVersion ? 'stale' : 'ready';
  }

  const needsCasting = hasModel && !!family && castingProcessOfFamily(family) === 'sand_casting';
  const castingStatus: AnalysisKindStatusOrNotRequired = needsCasting ? casting : 'not_required';

  const drawing: AnalysisKindStatusOrNotRequired = item.file2dPath ? (item.drawingIntelligence ? 'ready' : 'none') : 'not_required';

  const missing: MissingAnalysis[] = [];
  if (cad !== 'ready' && cad !== 'not_required') missing.push('cad_features');
  if (castingStatus !== 'ready' && castingStatus !== 'not_required') missing.push('casting_analysis');

  return { cad, drawing, casting: castingStatus, ready: missing.length === 0, missing };
}
