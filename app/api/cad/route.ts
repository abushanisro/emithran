import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/server/auth';
import { refuseCrossOrigin } from '@/lib/server/bff/origin';
import { MAX_REQUEST_BODY_BYTES } from '@/lib/server/body-limits';
import { readFormDataBody } from '@/lib/server/read-body';
import { settingWithDevDefault } from '@/lib/utils/required-setting';

// Resolved per request: localhost only outside production.
const cadEngineUrl = () => settingWithDevDefault(process.env.CAD_ENGINE_URL, 'CAD_ENGINE_URL', 'http://localhost:5055');
const CAD_ENGINE_API_KEY = process.env.CAD_ENGINE_API_KEY ?? '';

/**
 * Server-side proxy for CAD engine /convert/step-to-stl-base64.
 *
 * The CAD engine requires X-API-Key which is a server secret and must never
 * be exposed to the browser. The frontend calls POST /api/cad and this route
 * forwards the multipart body with the key attached. The body is capped at the
 * upload limit (the engine refuses larger files anyway).
 */
export async function POST(req: NextRequest) {
  try {
    const refused = refuseCrossOrigin(req);
    if (refused) return refused;
    const auth = await requireUser();
    if (!auth.ok) return auth.response;

    const form = await readFormDataBody(req, MAX_REQUEST_BODY_BYTES);
    if (!form.ok) return form.response;
    const formData = form.value;

    const headers: Record<string, string> = {};
    if (CAD_ENGINE_API_KEY) {
      headers['X-API-Key'] = CAD_ENGINE_API_KEY;
    }

    const cadResponse = await fetch(
      `${cadEngineUrl()}/convert/step-to-stl-base64`,
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
