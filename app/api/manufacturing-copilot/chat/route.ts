import { type NextRequest } from "next/server";

import { requireUserForAi } from "@/lib/server/auth";
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

const json = (body: unknown, status: number, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/**
 * Authenticated pass-through to the NestJS copilot. The browser session is
 * verified here; the backend verifies the forwarded token again and runs every
 * data read as that user. Nothing identity-related is read from the body.
 */
export async function POST(request: NextRequest) {
  const gate = await requireUserForAi("manufacturing-copilot");
  if (!gate.ok) return gate.response;

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413);

  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl()}/copilot/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${gate.accessToken}` },
      body: raw,
      signal: request.signal,
    });
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("[manufacturing-copilot] backend unreachable:", err instanceof Error ? err.name : "unknown");
    return json({ error: "Manufacturing Copilot unavailable" }, 502);
  }

  if (!upstream.ok || !upstream.body) {
    // Upstream text can carry internal detail: log the status, return a fixed message.
    console.error(`[manufacturing-copilot] backend responded ${upstream.status}: ${(await upstream.text().catch(() => "")).slice(0, 300)}`);
    if (upstream.status === 400) return json({ error: "Invalid request" }, 400);
    if (upstream.status === 404) return json({ error: "Part not found" }, 404);
    if (upstream.status === 429) return json({ error: "Too many requests" }, 429, { "Retry-After": upstream.headers.get("Retry-After") ?? "30" });
    if (upstream.status === 503) return json({ error: "Manufacturing Copilot is not configured" }, 503);
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
