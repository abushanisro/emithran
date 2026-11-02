import { type NextRequest } from "next/server";

import { requireUser } from "@/lib/server/auth";
import { refuseCrossOrigin } from "@/lib/server/bff/origin";
import { readBodyBytes } from "@/lib/server/read-body";
import { settingWithDevDefault } from '@/lib/utils/required-setting';

// Server-side: the private backend address (API_URL, which already ends in /v1/api, the NestJS global prefix), so this call
// never leaves the host through the public hostname (where Cloudflare Access would stop it).
// Resolved per request: localhost only outside production; a missing setting
// in production throws naming the variable.
const backendUrl = () =>
  settingWithDevDefault(process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL, 'API_URL', 'http://localhost:4000/v1/api');
const MAX_BODY_BYTES = 64 * 1024;

export const runtime = "nodejs";
export const maxDuration = 60;

/** The backend's AI budget codes (backend/src/common/ai/ai-budget.service.ts); anything else is not passed on. */
const AI_ERROR_CODES = new Set(["AI_BUDGET_EXHAUSTED", "AI_TOO_MANY_REQUESTS", "AI_DISABLED", "AI_NOT_CONFIGURED"]);
function aiErrorCode(body: string): string | null {
  try {
    const code = (JSON.parse(body) as { error?: { code?: unknown } }).error?.code;
    return typeof code === "string" && AI_ERROR_CODES.has(code) ? code : null;
  } catch {
    return null;
  }
}

const json = (body: unknown, status: number, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/**
 * Authenticated pass-through to the NestJS copilot. The browser session is
 * verified here; the backend verifies the forwarded token again and runs every
 * data read as that user. Nothing identity-related is read from the body.
 */
export async function POST(request: NextRequest) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  // The AI budget (daily tokens, concurrent requests, rate) is enforced by the backend, the one place that holds the AI key.
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  // Capped while reading, not after: the body is never buffered past the limit.
  const body = await readBodyBytes(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const raw = body.value;
  const organization = request.headers.get("x-organization-id");

  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl()}/copilot/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gate.accessToken}`,
        // Which organization the request acts for (the AI spend is charged to it); the backend checks membership.
        ...(organization && { "X-Organization-Id": organization }),
      },
      body: raw,
      signal: request.signal,
    });
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("[manufacturing-copilot] backend unreachable:", err instanceof Error ? err.name : "unknown");
    return json({ error: "Manufacturing Copilot unavailable" }, 502);
  }

  if (!upstream.ok || !upstream.body) {
    // Upstream text can carry internal detail: log the status, return a fixed message. The one exception is the AI budget's
    // code, which the panel needs to say why (daily allowance used up, too many requests running, AI switched off).
    const detail = await upstream.text().catch(() => "");
    console.error(`[manufacturing-copilot] backend responded ${upstream.status}: ${detail.slice(0, 300)}`);
    const code = aiErrorCode(detail);
    if (upstream.status === 400) return json({ error: "Invalid request" }, 400);
    if (upstream.status === 404) return json({ error: "Part not found" }, 404);
    if (upstream.status === 429) return json({ error: "Too many requests", ...(code && { code }) }, 429, { "Retry-After": upstream.headers.get("Retry-After") ?? "30" });
    if (upstream.status === 503) return json({ error: "Manufacturing Copilot is not available", ...(code && { code }) }, 503);
    return json({ error: "Manufacturing Copilot unavailable" }, 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
