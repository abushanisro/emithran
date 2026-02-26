import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pdfUrl } = body;

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
      console.error(`Failed to fetch PDF from ${pdfUrl}: ${pdfResponse.status} ${pdfResponse.statusText}`);
      return NextResponse.json({ error: 'Failed to fetch PDF from storage' }, { status: 400 });
    }

    const pdfArrayBuffer = await pdfResponse.arrayBuffer();
    const pdfBuffer = Buffer.from(pdfArrayBuffer);
    
    console.log(`Fetched PDF from Supabase: ${pdfBuffer.length} bytes`);
    
    // Validate PDF buffer
    if (!pdfBuffer || pdfBuffer.length === 0) {
      console.error('Downloaded PDF buffer is empty');
      return NextResponse.json({ error: 'Downloaded PDF is empty' }, { status: 400 });
    }

    // Forward to backend PDF processing service
    const backendResponse = await fetch(`http://localhost:4000/v1/pdf-processing/validate-pdf`, {
      method: 'POST',
      headers: {
        'Authorization': request.headers.get('Authorization') || '',
      },
      body: (() => {
        const formData = new FormData();
        formData.append('pdf', new Blob([pdfBuffer], { type: 'application/pdf' }));
        return formData;
      })(),
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error('Backend response error:', errorText);
      throw new Error(`Backend processing failed: ${backendResponse.status} - ${errorText}`);
    }

    const result = await backendResponse.json();
    console.log('Backend validation result:', JSON.stringify(result, null, 2));
    
    // Handle nested response structure from backend
    const actualData = result.data?.data || result.data || result;
    
    if (!result.success) {
      console.error('Backend validation failed:', result);
      return NextResponse.json({ 
        error: 'Backend validation failed', 
        details: actualData?.recommendations || []
      }, { status: 400 });
    }
    
    if (!actualData?.isValidPDF) {
      console.error('PDF marked as invalid:', actualData);
      return NextResponse.json({ 
        error: 'Invalid or unsupported PDF format', 
        details: actualData?.recommendations || []
      }, { status: 400 });
    }

    // For now, return a success response indicating the PDF is ready for processing
    return NextResponse.json({
      success: true,
      isVectorBased: actualData.isVectorBased,
      pageCount: actualData.pageCount,
      estimatedProcessingTime: actualData.estimatedProcessingTime
    });

  } catch (error) {
    console.error('PDF validation error:', error);
    return NextResponse.json(
      { error: 'PDF validation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}