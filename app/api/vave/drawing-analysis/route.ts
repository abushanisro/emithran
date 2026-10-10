import { NextRequest, NextResponse } from 'next/server';
import { requireUserForAi } from '@/lib/server/auth';
import { fetchTrustedFile, PayloadTooLargeError, readLimited, UntrustedUrlError } from '@/lib/server/safe-fetch';

const CAD_ENGINE_URL = process.env.CAD_ENGINE_URL ?? process.env.NEXT_PUBLIC_CAD_ENGINE_URL ?? 'http://localhost:5000';

/**
 * Thin proxy — all drawing analysis logic (PDF rendering, Groq vision) lives
 * in the CAD engine's POST /drawing/analyze endpoint.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUserForAi('vave-drawing-analysis');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    if (!body.imageBase64 && !body.imageUrl) {
      return NextResponse.json({ error: 'imageBase64 or imageUrl is required' }, { status: 400 });
    }

    // If caller passed a URL instead of base64, fetch and convert here
    if (body.imageUrl && !body.imageBase64) {
      let imgRes: Response;
      try {
        imgRes = await fetchTrustedFile(String(body.imageUrl));
      } catch (e) {
        if (e instanceof UntrustedUrlError) return NextResponse.json({ error: 'imageUrl is not on the trusted storage host' }, { status: 400 });
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
        buffer = await readLimited(imgRes, 15 * 1024 * 1024);
      } catch (e) {
        if (e instanceof PayloadTooLargeError) return NextResponse.json({ error: 'Drawing image is too large' }, { status: 413 });
        throw e;
      }
      body.imageBase64 = buffer.toString('base64');
      body.mediaType = mediaType;
      delete body.imageUrl;
    }

    const cadRes = await fetch(`${CAD_ENGINE_URL}/drawing/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
