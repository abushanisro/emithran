/**
 * The file the casting worker measures. A STEP upload is stored twice: the STEP itself (`file_step_path`) and its STL conversion for the
 * viewer (`file_3d_path`). The worker reads STEP only, so the STEP wins; an item uploaded as STEP from the start has only `file_3d_path`.
 * The same rule CAD re-analysis uses (bom-item-reanalysis.service.ts).
 */
export const CASTING_SOURCE_COLUMNS = "file_3d_path, file_step_path";

export function castingSourcePath(item: { file_3d_path?: string | null; file_step_path?: string | null }): string | null {
  return item.file_step_path || item.file_3d_path || null;
}
