import { apiClient } from './client';

// The backend's CAD upload API (backend/src/modules/cad-uploads). The result's report follows
// cad-engine/contract/assembly.schema.json, but the API camel-cases every key, so `quantity_total` arrives as `quantityTotal`.
export type CadUploadStatus = 'queued' | 'running' | 'done' | 'failed';

export interface AssemblyNode {
  definition: string;
  name: string;
  kind: 'part' | 'assembly' | 'empty_assembly';
  quantity: number;
  file: string;
  children: AssemblyNode[];
}

export interface AssemblyReport {
  status: 'complete' | 'partial';
  inputs: { file: string; status: 'ok' | 'unreadable'; inside: string | null }[];
  assembly: AssemblyNode[];
  parts: { id: string; name: string; quantityTotal: number }[];
  problems: { part: string; code: string }[];
}

export interface CadUpload {
  id: string;
  bomId: string;
  fileName: string;
  status: CadUploadStatus;
  attempts: number;
  errorCode: string | null;
  errorDetail: string | null;
  createdItemIds: string[];
  result: { report: AssemblyReport; skipped: { path: string; reason: string }[] } | null;
  /** True when these exact bytes were already uploaded to this BOM and the existing upload is returned. */
  duplicate?: boolean;
}

export const cadUploadsApi = {
  /** Stores the file and queues it; the answer is quick, the work happens in the background. */
  start(bomId: string, file: File): Promise<CadUpload> {
    const form = new FormData();
    form.append('file', file);
    form.append('bomId', bomId);
    // Not shorter than the server's real time for a 100 MB body.
    return apiClient.uploadFiles<CadUpload>('/cad-uploads', form, { timeout: 180_000 });
  },
  get(id: string): Promise<CadUpload> {
    return apiClient.get<CadUpload>(`/cad-uploads/${id}`);
  },
};
