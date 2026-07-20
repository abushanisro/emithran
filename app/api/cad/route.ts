import { NextRequest, NextResponse } from 'next/server';

const CAD_ENGINE_URL = process.env.CAD_ENGINE_URL ?? 'http://localhost:5000';
const CAD_ENGINE_API_KEY = process.env.CAD_ENGINE_API_KEY ?? '';

/**
 * Server-side proxy for CAD engine /convert/step-to-stl-base64.
 *
 * The CAD engine requires X-API-Key which is a server secret and must never
 * be exposed to the browser. The frontend calls POST /api/cad and this route
 * forwards the multipart body with the key attached.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const headers: Record<string, string> = {};
    if (CAD_ENGINE_API_KEY) {
      headers['X-API-Key'] = CAD_ENGINE_API_KEY;
    }

    const cadResponse = await fetch(
      `${CAD_ENGINE_URL}/convert/step-to-stl-base64`,
      { method: 'POST', body: formData, headers },
    );

    const data = await cadResponse.json();

    return NextResponse.json(data, { status: cadResponse.status });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message ?? 'CAD proxy error' },
      { status: 502 },
    );
  }
}
