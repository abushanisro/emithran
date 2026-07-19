"""
Manufacturing Copilot Agent — orchestrates the Groq agentic loop.

Flow per request:
  1. Planner classifies the question into data buckets
  2. Context Builder trims the full context JSON
  3. Knowledge Layer fetches relevant standards / rules
  4. Engineering Memory is loaded for this user/project
  5. System prompt is rendered with mode + memory + knowledge
  6. Groq tool-calling loop runs (max 6 iterations, non-streaming)
  7. Final answer is streamed back as SSE token deltas
"""

from __future__ import annotations
import json
import logging
import os
from typing import Any, AsyncIterator

import httpx
import certifi
from openai import AsyncOpenAI

from copilot import planner, context_builder, knowledge, memory as mem_module, prompts
from copilot.registry import get_openai_tools, TOOL_REGISTRY

# Import all tools so they self-register
import copilot.tools  # noqa: F401

logger = logging.getLogger(__name__)

_GROQ_BASE_URL = "https://api.groq.com/openai/v1"
_GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
# Tool loop uses the fast 8b model (20k TPM free tier vs 12k for 70b)
_GROQ_TOOL_MODEL = os.getenv("GROQ_TOOL_MODEL", "llama-3.1-8b-instant")
_MAX_TOOL_ITERATIONS = 4
# Hard cap tool results to prevent context explosion on free-tier TPM limits
_MAX_TOOL_RESULT_CHARS = 2000
# Tighter cap for the 8b tool-loop model (6k token limit on free tier)
_MAX_TOOL_RESULT_CHARS_LOOP = 600
# Max conversation turns kept in the streaming context (older turns dropped)
_MAX_HISTORY_TURNS = 3

# Intents that need the agentic tool loop (run_scenario_comparison etc.)
# All other intents go straight to streaming after mandatory pre-exec.
_AGENTIC_KEYWORDS = [
    "optimize", "reduce cost", "cheaper", "top 3", "top three", "cut cost", "save",
    "simulate", "scenario", "what if", "alternative material", "2-cavity", "two-cavity",
    "lower-cost factory", "lower cost factory", "rank by",
    # Vendor queries always need a live tool call — context doesn't carry vendor data
    "vendor", "supplier", "rfq", "who can make", "sourcing", "who is good",
    "best vendor", "best supplier", "recommend vendor", "good vendor",
]

# Workflow: mandatory tools that MUST run before Groq answers, keyed by intent keywords
_WORKFLOW: list[tuple[list[str], list[str]]] = [
    (["explain", "breakdown", "why expensive", "why is this", "cost breakdown", "each process"],
     ["get_cost_breakdown", "get_machine_selection"]),
    (["optimize", "reduce cost", "cheaper", "top 3", "top three", "cut cost", "save"],
     ["get_cost_breakdown"]),
    (["compare", "routes", "feasible route", "manufacturing route"],
     ["get_route_comparison"]),
    (["simulate", "scenario", "what if", "alternative material", "2-cavity", "two-cavity",
      "lower-cost factory", "lower cost factory", "rank by"],
     ["get_cost_breakdown"]),
    (["redesign", "dfm", "design issue", "design change", "fix the", "wall thickness", "draft"],
     ["get_dfm_analysis", "get_dfm_warnings"]),
    (["executive summary", "quote", "summary", "biggest risk", "recommended action"],
     ["get_cost_breakdown", "get_machine_selection"]),
    (["machine", "press", "clamp", "500t", "200t", "cycle time", "molder"],
     ["get_cost_breakdown", "get_machine_selection"]),
    # Vendor queries: cost context gives part name + route; vendor tool gives live network data
    (["vendor", "supplier", "rfq", "who can make", "sourcing", "who is good",
      "best vendor", "best supplier", "recommend vendor", "good vendor"],
     ["get_cost_breakdown", "get_vendor_recommendations"]),
]
_DEFAULT_MANDATORY = ["get_cost_breakdown"]


def _mandatory_tools_for(message: str) -> list[str]:
    lower = message.lower()
    for keywords, tools in _WORKFLOW:
        if any(kw in lower for kw in keywords):
            return tools
    return _DEFAULT_MANDATORY


def _groq_client() -> AsyncOpenAI:
    api_key = os.getenv("GROQ_API_KEY", "")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY environment variable is not set")
    # Use certifi cert bundle + 30s timeout to handle Windows DNS blips
    http_client = httpx.AsyncClient(
        verify=certifi.where(),
        timeout=httpx.Timeout(30.0, connect=10.0),
    )
    return AsyncOpenAI(api_key=api_key, base_url=_GROQ_BASE_URL, http_client=http_client)


async def _execute_tool_call(
    tool_name: str,
    tool_args: dict[str, Any],
    ctx: dict[str, Any],
    backend_url: str,
    auth_token: str,
    bom_item_id: str,
) -> str:
    tool_def = TOOL_REGISTRY.get(tool_name)
    if not tool_def:
        return json.dumps({"error": f"Unknown tool: {tool_name}"})
    try:
        result = await tool_def.handler(
            ctx=ctx,
            backend_url=backend_url,
            auth_token=auth_token,
            bom_item_id=bom_item_id,
            **tool_args,
        )
        return json.dumps(result, default=str)
    except Exception as e:
        logger.warning(f"Tool '{tool_name}' raised: {e}", exc_info=True)
        return json.dumps({"error": str(e)})


async def run(
    bom_item_id: str,
    messages: list[dict[str, Any]],
    full_context: dict[str, Any],
    mode: str,
    backend_url: str,
    auth_token: str,
    user_id: str,
    project_id: str,
) -> AsyncIterator[str]:
    """
    Async generator that yields SSE-formatted token strings.
    Each yielded value is a raw string ready to be written to the SSE stream.
    """
    # Detect and persist engineering memory updates from the latest user message
    last_user = next(
        (m["content"] for m in reversed(messages) if m.get("role") == "user"),
        "",
    )
    eng_memory, mem_updated = mem_module.update_from_message(user_id, project_id, last_user)

    # Planner — determine which buckets are needed
    buckets = planner.classify(last_user)
    logger.info(f"[copilot] buckets={buckets} mode={mode}")

    # Context Builder — trim context
    trimmed_ctx = context_builder.build_context(full_context, buckets)

    # Knowledge Layer — fetch relevant chunks
    kb_chunks = knowledge.search(last_user, top_k=4)
    kb_text = knowledge.format_for_prompt(kb_chunks)

    # System prompt
    system_prompt = prompts.render(
        mode=mode,
        memory_text=eng_memory.to_prompt_text(),
        knowledge_text=kb_text,
    )

    client = _groq_client()
    tools = get_openai_tools()

    # ── Mandatory workflow pre-execution ──────────────────────────────────
    # Run the deterministic tools BEFORE Groq sees the question so that it
    # always has real engine numbers and cannot hallucinate.
    mandatory = _mandatory_tools_for(last_user)
    engine_blocks: list[str] = []
    seen_tools: set[str] = set()
    pre_exec_cache: dict[str, str] = {}
    for tool_name in mandatory:
        if tool_name in seen_tools:
            continue
        seen_tools.add(tool_name)
        result = await _execute_tool_call(
            tool_name, {}, trimmed_ctx, backend_url, auth_token, bom_item_id
        )
        if len(result) > _MAX_TOOL_RESULT_CHARS:
            result = result[:_MAX_TOOL_RESULT_CHARS] + '…"}'
        pre_exec_cache[tool_name] = result
        engine_blocks.append(f"--- {tool_name} ---\n{result}")
        logger.info(f"[copilot] pre-exec tool={tool_name} chars={len(result)}")

    # Inject engine data as the last user turn so Groq sees it right before answering
    engine_data_msg = (
        "[ENGINE DATA — AUTHORITATIVE. USE ONLY THESE NUMBERS. DO NOT INVENT.]\n"
        + "\n\n".join(engine_blocks)
        + "\n[END ENGINE DATA]"
    )

    # Cap conversation history to prevent token explosion across multi-turn sessions.
    # Older turns are dropped; the engine data block always carries current facts.
    history = messages[:-1]
    if len(history) > _MAX_HISTORY_TURNS * 2:
        history = history[-(_MAX_HISTORY_TURNS * 2):]

    current_msg = messages[-1] if messages else {"role": "user", "content": last_user}

    # Full message list for the 70b streaming call (has history for conversational context)
    stream_messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        *history,
        {"role": "user", "content": engine_data_msg},
        {"role": "assistant", "content": "✓ Engine data loaded. Answering using only these figures."},
        current_msg,
    ]
    if mem_updated:
        stream_messages.insert(-1, {
            "role": "assistant",
            "content": f"✓ Noted — I'll keep that in mind: {last_user.strip()}",
        })

    # ── Agentic tool-calling loop (only for scenario/optimize intents) ───────
    # The 8b model has a 6k token/request limit on free tier, so we use a
    # minimal message list (NO history) to stay well under the cap.
    lower_msg = last_user.lower()
    needs_tool_loop = any(kw in lower_msg for kw in _AGENTIC_KEYWORDS)

    # Exclude tools already run as mandatory pre-exec from the loop's tool list.
    # This prevents the LLM from re-calling them and wasting free-tier TPM quota.
    loop_tools = [t for t in tools if t["function"]["name"] not in seen_tools]

    if needs_tool_loop and loop_tools:
        # Minimal messages for the tool loop — just enough to decide which tool to call
        tool_loop_messages: list[dict[str, Any]] = [
            {"role": "system", "content": (
                "You are a tool orchestrator. The engine data below is already loaded. "
                "Call additional tools only if the user question needs data NOT already "
                "in the engine data block. Otherwise respond with finish_reason=stop."
            )},
            {"role": "user", "content": engine_data_msg},
            {"role": "assistant", "content": "✓ Engine data loaded."},
            current_msg,
        ]

        for iteration in range(_MAX_TOOL_ITERATIONS):
            response = await client.chat.completions.create(
                model=_GROQ_TOOL_MODEL,
                messages=tool_loop_messages,
                tools=loop_tools,
                tool_choice="auto",
                stream=False,
                temperature=0.2,
                max_tokens=512,
            )

            choice = response.choices[0]
            msg = choice.message

            if choice.finish_reason == "tool_calls" and msg.tool_calls:
                tool_loop_messages.append({
                    "role": "assistant",
                    "content": msg.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                        }
                        for tc in msg.tool_calls
                    ],
                })

                for tc in msg.tool_calls:
                    fn_name = tc.function.name
                    try:
                        fn_args = json.loads(tc.function.arguments or "{}") or {}
                    except json.JSONDecodeError:
                        fn_args = {}

                    logger.info(f"[copilot] iter={iteration} tool={fn_name} args={list(fn_args.keys())}")
                    # Return cached pre-exec result rather than re-calling the backend API.
                    if fn_name in pre_exec_cache:
                        tool_result = pre_exec_cache[fn_name]
                        logger.info(f"[copilot] iter={iteration} cache-hit tool={fn_name}")
                    else:
                        tool_result = await _execute_tool_call(
                            fn_name, fn_args, trimmed_ctx, backend_url, auth_token, bom_item_id
                        )
                    # Tighter cap for the 8b tool loop to stay under 6k token limit
                    if len(tool_result) > _MAX_TOOL_RESULT_CHARS_LOOP:
                        tool_result = tool_result[:_MAX_TOOL_RESULT_CHARS_LOOP] + '…"}'
                    tool_loop_messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": tool_result,
                    })
                    # Mirror tool result into stream_messages so 70b sees it
                    stream_messages.insert(-1, {
                        "role": "user",
                        "content": f"[TOOL RESULT: {fn_name}]\n{tool_result}",
                    })
            else:
                break

    # ── Stream final answer ────────────────────────────────────────────────
    stream = await client.chat.completions.create(
        model=_GROQ_MODEL,
        messages=stream_messages,
        stream=True,
        temperature=0.2,
        max_tokens=2048,
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            yield delta
