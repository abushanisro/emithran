// Shared by the upload service and the runner, which must not import each other's modules for these.
export const CAD_BUCKET = 'bom-files';

export interface CadUploadRow {
  id: string;
  organization_id: string;
  created_by: string;
  bom_id: string;
  project_id: string | null;
  file_name: string;
  sha256: string;
  size_bytes: number;
  storage_path: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  error_code: string | null;
  error_detail: string | null;
  result: unknown;
  created_item_ids: string[];
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** Set when the stored original was removed to save space; the row and its hash stay. */
  source_deleted_at: string | null;
}
