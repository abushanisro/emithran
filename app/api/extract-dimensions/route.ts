import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pdfUrl, extractionConfig } = body;

    if (!pdfUrl) {
      return NextResponse.json({ error: 'PDF URL is required' }, { status: 400 });
    }

    // Fetch the PDF from the provided URL (Supabase storage)
    const pdfResponse = await fetch(pdfUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PDF-Processor/1.0)',
      }
    });
    
    if (!pdfResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch PDF from storage' }, { status: 400 });
    }

    const pdfArrayBuffer = await pdfResponse.arrayBuffer();
    const pdfBuffer = Buffer.from(pdfArrayBuffer);
    
    
    // Validate PDF buffer
    if (!pdfBuffer || pdfBuffer.length === 0) {
      return NextResponse.json({ error: 'Downloaded PDF is empty' }, { status: 400 });
    }

    // Forward to backend PDF processing service for full dimension extraction
    const backendResponse = await fetch(`http://localhost:4000/v1/pdf-processing/extract-dimensions`, {
      method: 'POST',
      headers: {
        'Authorization': request.headers.get('Authorization') || '',
      },
      body: (() => {
        const formData = new FormData();
        formData.append('pdf', new Blob([pdfBuffer], { type: 'application/pdf' }));
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
    const dimensions = (actualData.dimensions || []).map(dim => ({
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