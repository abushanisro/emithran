"""
FastAPI router for the Manufacturing Copilot.

POST /copilot/chat — accepts context JSON + conversation history,
runs the Groq agentic loop, and streams the answer as SSE.
"""

from __future__ import annotations
import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Security
from fastapi.responses import StreamingResponse
from fastapi.security.api_key import APIKeyHeader
from pydantic import BaseModel, Field

from copilot import agent

logger = logging.getLogger(__name__)

router = APIRouter()

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def _require_api_key(request: Request, api_key: str = Security(_api_key_header)):
    import os
    cad_key = os.getenv("CAD_ENGINE_API_KEY", "")
    if cad_key and api_key != cad_key:
        raise HTTPException(status_code=403, detail="Invalid or missing API key")


class CopilotMessage(BaseModel):
    role: str  # "user" | "assistant" | "system"
    content: str


class CopilotChatRequest(BaseModel):
    bomItemId: str
    userId: str = "anonymous"
    projectId: str = "default"
    mode: str = "manufacturing_engineer"
    messages: list[CopilotMessage] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)
    backendUrl: str = ""
    authToken: str = ""


_VALID_MODES = {
    "manufacturing_engineer", "designer", "purchasing",
    "supplier", "program_manager", "executive",
}


@router.post("/chat")
async def copilot_chat(
    body: CopilotChatRequest,
    request: Request,
    _auth: None = Security(_require_api_key),
):
    """
    Main copilot endpoint. Streams SSE token deltas.

    Each SSE event is:
        data: <token>\n\n

    The stream ends with:
        data: [DONE]\n\n
    """
    mode = body.mode if body.mode in _VALID_MODES else "manufacturing_engineer"
    messages = [{"role": m.role, "content": m.content} for m in body.messages]

    async def sse_generator():
        try:
            async for token in agent.run(
                bom_item_id=body.bomItemId,
                messages=messages,
                full_context=body.context,
                mode=mode,
                backend_url=body.backendUrl,
                auth_token=body.authToken,
                user_id=body.userId,
                project_id=body.projectId,
            ):
                # Escape newlines inside the SSE data payload
                escaped = token.replace("\n", "\\n")
                yield f"data: {escaped}\n\n"
        except RuntimeError as e:
            # GROQ_API_KEY missing or Groq unreachable
            logger.error(f"Copilot runtime error: {e}")
            err = json.dumps({"error": str(e)})
            yield f"data: {err}\n\n"
        except Exception as e:
            import os, traceback
            logger.error(f"Copilot unexpected error: {e}", exc_info=True)
            # In dev, surface the real exception so it's visible in the chat
            detail = f"{type(e).__name__}: {e}" if os.getenv("ENVIRONMENT") == "development" else "Copilot service error. Please try again."
            err = json.dumps({"error": detail, "trace": traceback.format_exc()[-500:] if os.getenv("ENVIRONMENT") == "development" else ""})
            yield f"data: {err}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
