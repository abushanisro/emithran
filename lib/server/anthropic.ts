/**
 * One place for the VAVE route handlers' Claude calls.
 *
 * - The model id is the one the backend uses (backend/src/modules/copilot/
 *   copilot.service.ts DEFAULT_MODEL); keep the two in step.
 * - A missing ANTHROPIC_API_KEY is reported as 503 "not configured" instead of
 *   sending a request with an empty key and failing obscurely.
 * - Every failure (upstream error, refusal, no text, unparseable JSON) is an
 *   explicit error result; callers must not substitute a computed or empty
 *   answer for it.
 */

export const VAVE_AI_MODEL = 'claude-sonnet-5-5';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
// Non-streaming request; thinking spends from this budget too, so it is not
// sized to the expected answer alone.
const MAX_TOKENS = 16000;

export type AiTextResult =
  | { ok: true; text: string }
  | { ok: false; status: number; error: string; details?: unknown };

export async function requestAiText(
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AiTextResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 503, error: 'AI is not configured: ANTHROPIC_API_KEY is not set on the server.' };
  }

  let response: Response;
  try {
    response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: VAVE_AI_MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: 'medium' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (error) {
    return { ok: false, status: 502, error: `AI service unreachable: ${error instanceof Error ? error.message : String(error)}` };
  }

  if (!response.ok) {
    const details: unknown = await response.json().catch(() => undefined);
    // 502, not the upstream status: an upstream 401 must not read as the
    // caller's own session having expired.
    return { ok: false, status: 502, error: `AI service error: ${response.status}`, details };
  }

  const data = (await response.json().catch(() => null)) as
    | { stop_reason?: string; content?: { type?: string; text?: string }[] }
    | null;
  if (data?.stop_reason === 'refusal') {
    return { ok: false, status: 502, error: 'AI service declined the request.' };
  }
  // With thinking on, the first content block is not necessarily the text.
  const text = (data?.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  if (!text.trim()) {
    return { ok: false, status: 502, error: 'AI service returned no text.' };
  }
  return { ok: true, text };
}

/** Parse the model's JSON answer, tolerating a ```json fence. Throws when it is not JSON. */
export function parseAiJson(text: string): unknown {
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}
