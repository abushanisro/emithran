import { createHash } from "node:crypto";

// Shared by the service and the runner. The three constants below are part of an analysis's identity (migration 955): a new
// worker, a new result contract or a new configuration is a new analysis, never a rewrite of an old one.

/** The `worker_version` the deployed casting worker reports (casting-worker/src/main.cpp). Raise it together with the worker. */
export const CASTING_WORKER_VERSION = "0.19.0";
/** The `schema_version` of casting-worker/result.schema.json that this backend reads. */
export const CASTING_SCHEMA_VERSION = 1;
/** Where a BOM item's STEP file is kept (the same bucket cad-uploads writes to). */
export const CASTING_SOURCE_BUCKET = "bom-files";

export type CastingAnalysisStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed";

/** The draw direction an analysis was run with: chosen by the worker, or fixed to an axis by an engineer (migration 957). */
export const DRAW_DIRECTIONS = ["auto", "x", "y", "z"] as const;
export type DrawDirection = (typeof DRAW_DIRECTIONS)[number];
/** An engineer's choice: an axis (never "auto", which is no choice). */
export type DrawAxis = Exclude<DrawDirection, "auto">;
export const isDrawAxis = (v: unknown): v is DrawAxis => v === "x" || v === "y" || v === "z";

/** What the analysis is told to do besides reading the file. */
export interface CastingAnalysisConfig {
  drawDirection: DrawDirection;
}
export const DEFAULT_CASTING_CONFIG: CastingAnalysisConfig = { drawDirection: "auto" };

/** The configuration of a stored row; null when it is not one this backend knows (never guessed). */
export function parseCastingConfig(raw: unknown): CastingAnalysisConfig | null {
  const d = (raw as { drawDirection?: unknown } | null)?.drawDirection;
  return d === "auto" || isDrawAxis(d) ? { drawDirection: d } : null;
}

/** The configuration an item's draw-direction override (or the lack of one) asks for. */
export const configForAxis = (axis: DrawAxis | null): CastingAnalysisConfig => ({ drawDirection: axis ?? "auto" });

/** Stable digest of a configuration (keys sorted), so equal configurations always give the same cache key. */
export function configHash(config: CastingAnalysisConfig): string {
  const sorted = Object.fromEntries(
    Object.entries(config).sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 16);
}

export interface CastingAnalysisRow {
  id: string;
  organization_id: string;
  bom_item_id: string;
  requested_by: string;
  input_sha256: string;
  /** The BOM item's 3D file path when the analysis was asked for (null for rows made before it existed). */
  source_path: string | null;
  worker_version: string;
  schema_version: number;
  config_hash: string;
  /** What the analysis was run with (its digest is config_hash). */
  config: CastingAnalysisConfig;
  status: CastingAnalysisStatus;
  attempts: number;
  error_code: string | null;
  error_detail: string | null;
  result: unknown;
  output_prefix: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}
