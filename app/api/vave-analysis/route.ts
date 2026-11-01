import { type NextRequest, NextResponse } from 'next/server';

import { requestAiText } from '@/lib/server/anthropic';
import { requireUserForAi } from '@/lib/server/auth';
import { refuseCrossOrigin } from '@/lib/server/bff/origin';
import { readJsonBody } from '@/lib/server/read-body';
import { buildVaveAnalysisPrompt, parseVaveAnalysisInput } from '@/lib/vave/bom-vave-prompt';

// Structured metrics for at most 50 items: small.
const MAX_BODY_BYTES = 256 * 1024;

/**
 * VAVE insights for one benchmark BOM. The prompt is built here from the structured metrics in the body (lib/vave/bom-vave-prompt);
 * the browser never sends prompt text, so this is not a general-purpose proxy to the AI provider.
 */
export async function POST(request: NextRequest) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  const auth = await requireUserForAi('vave-analysis');
  if (!auth.ok) return auth.response;

  try {
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const input = parseVaveAnalysisInput(body.value);
    if (!input) {
      return NextResponse.json({ error: 'bom is required' }, { status: 400 });
    }

    const ai = await requestAiText(buildVaveAnalysisPrompt(input));
    if (!ai.ok) {
      return NextResponse.json({ error: ai.error, details: ai.details }, { status: ai.status });
    }
    return NextResponse.json({ text: ai.text });
  } catch (error) {
    console.error('VAVE analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze BOM data' },
      { status: 500 }
    );
  }
}
