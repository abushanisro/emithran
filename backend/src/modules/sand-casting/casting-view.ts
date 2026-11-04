// What the API shows of a casting analysis. The list never carries the result (a page polls it, and a result is large); one analysis does.
import { type CastingAnalysisRow } from "./casting-analysis.types";

export function analysisListView(row: CastingAnalysisRow) {
  return {
    id: row.id,
    bomItemId: row.bom_item_id,
    status: row.status,
    workerVersion: row.worker_version,
    schemaVersion: row.schema_version,
    /** The draw direction the analysis was run with: chosen by the worker (auto) or fixed by an engineer (x, y, z). */
    drawDirection: row.config?.drawDirection ?? "auto",
    attempts: row.attempts,
    errorCode: row.error_code,
    errorDetail: row.error_detail,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

export function analysisView(row: CastingAnalysisRow) {
  return { ...analysisListView(row), result: row.result };
}
