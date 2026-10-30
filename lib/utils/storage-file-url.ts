/**
 * Server-side boundary for fetching stored CAD/drawing files.
 *
 * API routes that fetch file bytes on the server must only reach trusted
 * storage, and must resolve stored object paths through the backend so access
 * is decided by the caller's own BOM item permissions.
 */

import { isTrustedStorageUrl } from '@/lib/server/safe-fetch';

// One trusted-storage rule for every server route (lib/server/safe-fetch): the
// project's own storage host (plus TRUSTED_STORAGE_HOSTS), https, no
// credentials. A generic wildcard allowlist would accept any bucket.
export { isTrustedStorageUrl };

// On the server this is the private backend (API_URL); in the browser API_URL is undefined and the public URL is used.
const BACKEND_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1/api';

// Matches FileStorageService.generateStoragePath:
// `${userId}/${projectId}/bom-items/${bomItemId}/${fileType}/${timestamp}_${filename}`
const BOM_ITEM_STORAGE_PATH =
  /^[^/]+\/[^/]+\/bom-items\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(2d|3d)\/[^/]+$/i;

export function parseBomItemStoragePath(
  path: string,
): { bomItemId: string; fileType: '2d' | '3d' } | null {
  const [, bomItemId, fileType] = BOM_ITEM_STORAGE_PATH.exec(path) ?? [];
  if (!bomItemId || !fileType) return null;
  return { bomItemId, fileType: fileType.toLowerCase() as '2d' | '3d' };
}

interface SignedUrlResponse {
  url?: string;
  downloadUrl?: string;
  fileUrl?: string;
  signedUrl?: string;
  data?: { url?: string };
}

export type BomItemFileUrlResult =
  | { ok: true; url: string }
  | { ok: false; status: number; error: string; details?: string };

/**
 * Asks the backend for a signed URL of a BOM item's stored file, as the caller.
 * The backend loads the item under the caller's permissions and signs its own
 * stored path, so the caller can only reach files of items they can access.
 */
export async function resolveBomItemFileUrl(
  bomItemId: string,
  fileType: '2d' | '3d',
  authorization: string,
): Promise<BomItemFileUrlResult> {
  const res = await fetch(
    `${BACKEND_URL}/bom-items/${encodeURIComponent(bomItemId)}/file-url/${fileType}`,
    {
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
    },
  );

  if (!res.ok) {
    const details = await res.text().catch(() => res.statusText);
    return { ok: false, status: res.status, error: `Backend returned ${String(res.status)}`, details };
  }

  const data = (await res.json()) as SignedUrlResponse | null;
  const url =
    data?.url ?? data?.downloadUrl ?? data?.fileUrl ?? data?.signedUrl ?? data?.data?.url;

  if (!url) {
    return { ok: false, status: 502, error: 'Backend did not return a file URL' };
  }
  if (!isTrustedStorageUrl(url)) {
    return { ok: false, status: 502, error: 'Backend returned an untrusted storage URL' };
  }
  return { ok: true, url };
}
