"""
Context Builder — trims the full frontend context JSON to only the fields
needed for the current question, keeping the Groq prompt well under 6k tokens.
"""

from __future__ import annotations
from typing import Any
import json

# Maps each bucket to the top-level context keys it needs
BUCKET_FIELDS: dict[str, list[str]] = {
    "cost":     ["cost", "routes", "production"],
    "geometry": ["part", "geometry"],
    "dfm":      ["dfm", "geometry"],
    "machine":  ["cost", "routes"],
    "sustain":  ["sustainability", "production"],
    "invest":   ["investment", "cost"],
    "scenario": ["cost", "routes", "production", "part"],
    "knowledge": ["part", "geometry", "dfm"],
}

# Maximum warnings and process lines to include (avoid context explosion)
_MAX_DFM_WARNINGS = 5
_MAX_PROCESS_LINES = 6
_MAX_ROUTES = 3
_MAX_DESC_CHARS = 60

# Rough token budget target — keep well under 3k tokens so tool results
# can be added without blowing the 12k free-tier TPM limit
_TOKEN_BUDGET_CHARS = 8_000


def build_context(full_ctx: dict[str, Any], buckets: list[str]) -> dict[str, Any]:
    """
    Return a trimmed copy of full_ctx containing only the fields needed
    for the given buckets, with hard caps on noisy list fields.
    """
    needed_keys: set[str] = set()
    for bucket in buckets:
        needed_keys.update(BUCKET_FIELDS.get(bucket, []))

    ctx: dict[str, Any] = {}

    for key in needed_keys:
        if key not in full_ctx:
            continue
        value = full_ctx[key]
        if key == "dfm" and isinstance(value, dict):
            value = _trim_dfm(value)
        elif key == "cost" and isinstance(value, dict):
            value = _trim_cost(value)
        elif key == "routes" and isinstance(value, dict):
            value = _trim_routes(value)
        ctx[key] = value

    # Safety: if context is still very large, trim aggressively
    if len(json.dumps(ctx)) > _TOKEN_BUDGET_CHARS:
        ctx = _emergency_trim(ctx)

    return ctx


def _trim_dfm(dfm: dict[str, Any]) -> dict[str, Any]:
    out = dict(dfm)
    if "warnings" in out and isinstance(out["warnings"], list):
        out["warnings"] = out["warnings"][:_MAX_DFM_WARNINGS]
    return out


def _trim_cost(cost: dict[str, Any]) -> dict[str, Any]:
    out = dict(cost)
    if "processLines" in out and isinstance(out["processLines"], list):
        lines = out["processLines"][:_MAX_PROCESS_LINES]
        # Truncate long description strings
        for line in lines:
            if isinstance(line, dict) and "description" in line:
                line["description"] = line["description"][:_MAX_DESC_CHARS]
        out["processLines"] = lines
    # Drop raw processTree (it duplicates processLines but is larger)
    out.pop("processTree", None)
    return out


def _trim_routes(routes: dict[str, Any]) -> dict[str, Any]:
    out = dict(routes)
    if "routes" in out and isinstance(out["routes"], list):
        trimmed = []
        for r in out["routes"][:_MAX_ROUTES]:
            if isinstance(r, dict):
                slim = {k: r[k] for k in (
                    "routeId", "routeLabel", "totalCost", "isFeasible",
                    "cycleTimes", "badges", "warnings", "sustainability",
                    "machineCapabilityWarnings",
                ) if k in r}
                # trim route processLines too
                if "processLines" in r:
                    slim["processLines"] = r["processLines"][:6]
                trimmed.append(slim)
        out["routes"] = trimmed
    return out


def _emergency_trim(ctx: dict[str, Any]) -> dict[str, Any]:
    """Last-resort: drop sustainability and investment detail if still huge."""
    ctx.pop("sustainability", None)
    ctx.pop("investment", None)
    if "routes" in ctx:
        ctx["routes"] = _trim_routes(ctx["routes"])
    return ctx
