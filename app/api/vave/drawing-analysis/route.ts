import { NextRequest, NextResponse } from 'next/server';

import { getAuthenticatedUser } from '@/lib/database/supabase-server';
import {
  isTrustedStorageUrl,
  parseBomItemStoragePath,
  resolveBomItemFileUrl,
} from '@/lib/utils/storage-file-url';

const CAD_ENGINE_URL = process.env.CAD_ENGINE_URL ?? process.env.NEXT_PUBLIC_CAD_ENGINE_URL ?? 'http://localhost:5000';
const CAD_ENGINE_API_KEY = process.env.CAD_ENGINE_API_KEY ?? '';

/**
 * Thin proxy — all drawing analysis logic (PDF rendering, Groq vision) lives
 * in the CAD engine's POST /drawing/analyze endpoint.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();

    if (!body.imageBase64 && !body.imageUrl) {
      return NextResponse.json({ error: 'imageBase64 or imageUrl is required' }, { status: 400 });
    }

    // If caller passed a URL instead of base64, fetch and convert here.
    // VAVE items store either a trusted storage URL or the BOM item's storage
    // path; a path is signed by the backend under the caller's permissions.
    if (body.imageUrl && !body.imageBase64) {
      const imageRef = String(body.imageUrl);
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

      // A trusted host must not redirect us to a private destination.
      const imgRes = await fetch(fileUrl, { redirect: 'manual' });
      if (imgRes.status >= 300 && imgRes.status < 400) {
        return NextResponse.json({ error: 'Storage redirects are not allowed' }, { status: 502 });
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
      const buffer = await imgRes.arrayBuffer();
      body.imageBase64 = Buffer.from(buffer).toString('base64');
      body.mediaType = mediaType;
      delete body.imageUrl;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (CAD_ENGINE_API_KEY) {
      headers['X-API-Key'] = CAD_ENGINE_API_KEY;
    }

    const cadRes = await fetch(`${CAD_ENGINE_URL}/drawing/analyze`, {
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
