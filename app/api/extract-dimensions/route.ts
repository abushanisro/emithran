import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { refuseCrossOrigin } from '@/lib/server/bff/origin';
import { readJsonBody } from '@/lib/server/read-body';
import { fetchTrustedFile, PayloadTooLargeError, readLimited, UntrustedUrlError } from '@/lib/server/safe-fetch';
import { settingWithDevDefault } from '@/lib/utils/required-setting';

interface BackendDimensionEntry {
  balloonId: string;
  dimension: {
    value: number;
    unit: string;
    type: string;
    tolerance: unknown;
  };
  position: unknown;
  confidence: number;
}

export async function POST(request: NextRequest) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    // The body only names the PDF: a small JSON object.
    const body = await readJsonBody<{ pdfUrl?: unknown } | null>(request, 16 * 1024);
    if (!body.ok) return body.response;
    const pdfUrl = body.value?.pdfUrl;

    if (typeof pdfUrl !== 'string' || !pdfUrl) {
      return NextResponse.json({ error: 'PDF URL is required' }, { status: 400 });
    }

    // Fetch the PDF from the provided URL (a signed file-store link)
    let pdfBuffer: Buffer;
    try {
      const pdfResponse = await fetchTrustedFile(pdfUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PDF-Processor/1.0)' } });
      if (!pdfResponse.ok) {
        return NextResponse.json({ error: 'Failed to fetch PDF from storage' }, { status: 400 });
      }
      pdfBuffer = await readLimited(pdfResponse, 25 * 1024 * 1024);
    } catch (e) {
      if (e instanceof UntrustedUrlError) return NextResponse.json({ error: 'PDF URL is not on the trusted storage host' }, { status: 400 });
      if (e instanceof PayloadTooLargeError) return NextResponse.json({ error: 'PDF is too large' }, { status: 413 });
      throw e;
    }
    
    
    // Validate PDF buffer
    if (!pdfBuffer || pdfBuffer.length === 0) {
      return NextResponse.json({ error: 'Downloaded PDF is empty' }, { status: 400 });
    }

    // Forward to backend PDF processing service for full dimension extraction
    const backendResponse = await fetch(`${settingWithDevDefault(process.env.NEXT_PUBLIC_API_GATEWAY_URL, 'NEXT_PUBLIC_API_GATEWAY_URL', 'http://localhost:4000')}/v1/pdf-processing/extract-dimensions`, {
      method: 'POST',
      headers: {
        // The session's token: under the BFF the browser holds none to forward.
        Authorization: `Bearer ${auth.accessToken}`,
      },
      // The backend answers directly; never follow a redirect with the caller's token.
      redirect: 'error',
      body: (() => {
        const formData = new FormData();
        formData.append('pdf', new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }));
        return formData;
      })(),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      throw new Error(`Backend processing failed: ${backendResponse.status} - ${errorText}`);
    }

    const result = await backendResponse.json();
    
    // Handle nested response structure
    const actualData = result.data?.data || result.data || result;
    
    if (!result.success) {
      return NextResponse.json({ 
        error: 'Dimension extraction failed', 
        details: actualData?.errors || []
      }, { status: 400 });
    }

    // Transform the result to match the expected format
    const dimensions = (actualData.dimensions || []).map((dim: BackendDimensionEntry) => ({
      id: dim.balloonId,
      value: dim.dimension.value,
      unit: dim.dimension.unit,
      position: dim.position,
      type: dim.dimension.type,
      tolerance: dim.dimension.tolerance,
      confidence: Math.round(dim.confidence * 100)
    }));

    return NextResponse.json(dimensions);

  } catch (error) {
    return NextResponse.json(
      { error: 'Dimension extraction failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}