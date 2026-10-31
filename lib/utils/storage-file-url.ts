/**
 * Server-side boundary for fetching stored CAD/drawing files.
 *
 * API routes that fetch file bytes on the server must only reach trusted
 * storage, and must resolve stored object paths through the backend so access
 * is decided by the caller's own BOM item permissions.
 */

import { isTrustedStorageUrl } from '@/lib/server/safe-fetch';
import { settingWithDevDefault } from '@/lib/utils/required-setting';

// One trusted-storage rule for every server route (lib/server/safe-fetch): the
// project's own storage host (plus TRUSTED_STORAGE_HOSTS), https, no
// credentials. A generic wildcard allowlist would accept any bucket.
export { isTrustedStorageUrl };

// On the server this is the private backend (API_URL); in the browser API_URL is undefined and the public URL is used.
// Resolved per request: localhost only outside production; a missing setting
// in production throws naming the variable.
const backendUrl = () =>
  settingWithDevDefault(process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL, 'API_URL', 'http://localhost:4000/v1/api');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // bomItemId comes from the request. The host is fixed by configuration, but
  // an id such as ".." would still move the request to another backend path
  // (encodeURIComponent leaves dots alone), carrying the caller's token, so
  // only a UUID goes into the URL (fileType is already "2d" | "3d").
  if (!UUID.test(bomItemId)) {
    return { ok: false, status: 400, error: 'itemId must be a UUID' };
  }
  const res = await fetch(
    `${backendUrl()}/bom-items/${bomItemId}/file-url/${fileType}`,
    {
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      // The backend answers directly; never follow a redirect with the caller's token.
      redirect: 'error',
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
