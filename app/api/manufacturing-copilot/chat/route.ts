import { NextRequest } from "next/server";

const CAD_ENGINE_URL = process.env.CAD_ENGINE_URL ?? "http://localhost:5000";
const CAD_ENGINE_API_KEY = process.env.CAD_ENGINE_API_KEY ?? "";
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.bomItemId) {
      return new Response(JSON.stringify({ error: "bomItemId is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Forward the auth token so the CAD engine can call the NestJS backend
    // for scenario simulation tools. The JWT is the same one the frontend uses.
    const authToken = request.headers.get("Authorization")?.replace("Bearer ", "") ?? "";

    const cadPayload = {
      ...body,
      backendUrl: BACKEND_URL,
      authToken,
    };

    const cadResponse = await fetch(`${CAD_ENGINE_URL}/copilot/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": CAD_ENGINE_API_KEY,
      },
      body: JSON.stringify(cadPayload),
    });

    if (!cadResponse.ok) {
      const errorText = await cadResponse.text();
      return new Response(
        JSON.stringify({ error: `Copilot service error: ${cadResponse.status}`, detail: errorText }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    // Pipe the SSE stream from the CAD engine back to the client
    return new Response(cadResponse.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: "Manufacturing Copilot unavailable", detail: message }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}
