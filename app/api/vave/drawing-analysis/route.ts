import { NextRequest, NextResponse } from 'next/server';
import { requireUserForAi } from '@/lib/server/auth';
import { refuseCrossOrigin } from '@/lib/server/bff/origin';
import { readJsonBody } from '@/lib/server/read-body';
import { fetchTrustedFile, PayloadTooLargeError, readLimited, UntrustedUrlError } from '@/lib/server/safe-fetch';
import { settingWithDevDefault } from '@/lib/utils/required-setting';
import {
  isTrustedStorageUrl,
  parseBomItemStoragePath,
  resolveBomItemFileUrl,
} from '@/lib/utils/storage-file-url';

// Resolved per request: localhost only outside production.
const cadEngineUrl = () =>
  settingWithDevDefault(process.env.CAD_ENGINE_URL ?? process.env.NEXT_PUBLIC_CAD_ENGINE_URL, 'CAD_ENGINE_URL', 'http://localhost:5055');
const CAD_ENGINE_API_KEY = process.env.CAD_ENGINE_API_KEY ?? '';

// The same 15 MiB image limit as a fetched drawing, as base64 (4/3 larger), plus room for the other fields.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const MAX_BODY_BYTES = MAX_IMAGE_BASE64_CHARS + 256 * 1024;

/**
 * Thin proxy — all drawing analysis logic (PDF rendering, Groq vision) lives
 * in the CAD engine's POST /drawing/analyze endpoint.
 */
export async function POST(request: NextRequest) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  const auth = await requireUserForAi('vave-drawing-analysis');
  if (!auth.ok) return auth.response;

  try {
    const parsed = await readJsonBody<Record<string, unknown> | null>(request, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }
    const body = parsed.value;

    if (!body.imageBase64 && !body.imageUrl) {
      return NextResponse.json({ error: 'imageBase64 or imageUrl is required' }, { status: 400 });
    }
    if (body.imageBase64 !== undefined && (typeof body.imageBase64 !== 'string' || body.imageBase64.length > MAX_IMAGE_BASE64_CHARS)) {
      return NextResponse.json({ error: 'imageBase64 must be a base64 string of at most 15 MiB of image data' }, { status: 413 });
    }

    // If caller passed a URL instead of base64, fetch and convert here.
    // VAVE items store either a trusted storage URL or the BOM item's storage
    // path; a path is signed by the backend under the caller's permissions.
    if (typeof body.imageUrl === 'string' && body.imageUrl && !body.imageBase64) {
      const imageRef = body.imageUrl;
      let fileUrl: string;
      const storagePath = parseBomItemStoragePath(imageRef);
      if (storagePath) {
        const resolved = await resolveBomItemFileUrl(
          storagePath.bomItemId,
          storagePath.fileType,
          `Bearer ${auth.accessToken}`,
        );
        if (!resolved.ok) {
          return NextResponse.json(
            { error: 'Failed to resolve drawing file', details: resolved.details ?? resolved.error },
            { status: resolved.status },
          );
        }
        fileUrl = resolved.url;
      } else if (isTrustedStorageUrl(imageRef)) {
        fileUrl = imageRef;
      } else {
        return NextResponse.json(
          { error: 'imageUrl must be a stored BOM item drawing or an HTTPS URL on a trusted storage host' },
          { status: 400 },
        );
      }

      // Trusted host only, and a trusted host must not redirect us anywhere.
      let imgRes: Response;
      try {
        imgRes = await fetchTrustedFile(fileUrl, { maxRedirects: 0 });
      } catch (e) {
        if (e instanceof UntrustedUrlError) return NextResponse.json({ error: 'Storage redirects are not allowed' }, { status: 502 });
        throw e;
      }
      if (!imgRes.ok) {
        return NextResponse.json({ error: 'Failed to fetch drawing image' }, { status: 400 });
      }
      const contentType = imgRes.headers.get('content-type') ?? 'image/png';
      const mediaType = contentType.includes('pdf')
        ? 'application/pdf'
        : contentType.includes('jpeg') || contentType.includes('jpg')
          ? 'image/jpeg'
          : 'image/png';
      let buffer: Buffer;
      try {
        buffer = await readLimited(imgRes, MAX_IMAGE_BYTES);
      } catch (e) {
        if (e instanceof PayloadTooLargeError) return NextResponse.json({ error: 'Drawing image is too large' }, { status: 413 });
        throw e;
      }
      body.imageBase64 = buffer.toString('base64');
      body.mediaType = mediaType;
      delete body.imageUrl;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (CAD_ENGINE_API_KEY) {
      headers['X-API-Key'] = CAD_ENGINE_API_KEY;
    }

    const cadRes = await fetch(`${cadEngineUrl()}/drawing/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await cadRes.json();

    if (!cadRes.ok) {
      console.error('CAD engine drawing analysis error:', cadRes.status, data);
      return NextResponse.json(
        { error: data?.detail ?? 'Drawing analysis failed' },
        { status: cadRes.status },
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Drawing analysis proxy error:', error);
    return NextResponse.json({ error: 'Drawing analysis failed' }, { status: 500 });
  }
}
