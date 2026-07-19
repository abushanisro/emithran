"""Vendor recommendation tool — queries the NestJS /vendors/match endpoint."""

from __future__ import annotations
import logging
from typing import Any

import httpx
import certifi

from copilot.registry import register_tool

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


# Maps backend processLine short names → vendor map canonical keys
_PROCESS_NAME_ALIASES: dict[str, str] = {
    "Laser Cutting":     "Fiber Laser Cutting",
    "Fiber Laser":       "Fiber Laser Cutting",
    "CO2 Laser":         "CO2 Laser Cutting",
    "Press Brake":       "CNC Press Brake",
    "CNC Bending":       "CNC Press Brake",
    "CMM Inspection":    "Inspection",
    "CMM":               "Inspection",
    "Quality Inspection":"Inspection",
    "Welding":           "MIG Welding",
}


def _extract_processes(ctx: dict) -> list[str]:
    """Pull unique primary process names from cost.processLines."""
    cost = ctx.get("cost", {})
    lines = cost.get("processLines", [])
    seen: set[str] = set()
    result: list[str] = []
    for line in lines:
        if not isinstance(line, dict):
            continue
        raw = line.get("process") or line.get("processName") or line.get("name")
        if not raw:
            continue
        # Normalise to the canonical vendor-map key
        proc = _PROCESS_NAME_ALIASES.get(raw, raw)
        if proc not in seen:
            seen.add(proc)
            result.append(proc)
    return result


_PLACEHOLDER_MATERIALS = frozenset({
    "not specified", "n/a", "unknown", "-", "", "none", "tbd", "select material",
})


def _extract_material(ctx: dict) -> str | None:
    cost = ctx.get("cost", {})
    mat = cost.get("material")
    if isinstance(mat, str) and mat:
        candidate = mat
    elif isinstance(mat, dict):
        candidate = mat.get("grade") or ""
    else:
        candidate = ""

    if not candidate:
        # Flat materialGrade field on the CostSummaryDto
        candidate = cost.get("materialGrade") or ""

    if not candidate:
        part = ctx.get("part") or {}
        candidate = part.get("materialGrade") or part.get("material") or ""

    if not candidate or candidate.strip().lower() in _PLACEHOLDER_MATERIALS:
        return None
    return candidate


def _slim_vendor(v: dict) -> dict:
    """Trim a vendor record to only name, score, tier, and top 2 reasons."""
    return {
        "name": v.get("name"),
        "supplierCode": v.get("supplierCode"),
        "score": v.get("overallScore"),
        "tier": v.get("classification"),
        "reasons": (v.get("whyBest") or [])[:2],
    }


async def _get_vendor_recommendations(
    ctx: dict,
    backend_url: str,
    auth_token: str,
    process_filter: str = "",
    **_,
) -> dict[str, Any]:
    processes = _extract_processes(ctx)
    material = _extract_material(ctx)

    if not processes:
        return {
            "error": "No process route found in context. Generate a process plan first.",
            "hint": "Ask the system to calculate the process route for this part.",
        }

    payload: dict[str, Any] = {"processes": processes}
    if material:
        payload["material"] = material

    headers = {"Content-Type": "application/json"}
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"

    url = f"{backend_url.rstrip('/')}/vendors/match"

    try:
        async with httpx.AsyncClient(verify=certifi.where(), timeout=_TIMEOUT) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            # The NestJS TransformInterceptor wraps every response:
            # { success: true, data: [...], metadata: {...} }
            raw = resp.json()
            groups: list[dict] = raw.get("data", raw) if isinstance(raw, dict) else raw
    except httpx.HTTPStatusError as e:
        logger.warning(f"[vendor_tool] HTTP {e.response.status_code}: {e.response.text[:200]}")
        return {"error": f"Vendor API returned {e.response.status_code}. Check backend connectivity."}
    except Exception as e:
        logger.warning(f"[vendor_tool] request failed: {e}")
        return {"error": f"Could not reach vendor service: {e}"}

    if not groups:
        return {
            "processes": processes,
            "material": material,
            "message": "No vendors matched in your network for these processes.",
            "suggestion": "Import vendors via the Vendors page to populate the network.",
        }

    # Slim down to stay within LLM token budget
    slim_groups = []
    for g in groups:
        label = g.get("categoryLabel", "")
        # If the user asked about a specific process, filter to that group
        if process_filter and process_filter.lower() not in label.lower():
            # Still include if merged names match
            merged = [m.lower() for m in (g.get("mergedProcessNames") or [])]
            if not any(process_filter.lower() in m for m in merged):
                continue

        vendors = g.get("vendors") or []
        slim_groups.append({
            "category": label,
            "operations": g.get("mergedProcessNames", []),
            "totalVendorsFound": g.get("totalFound", len(vendors)),
            "topVendors": [_slim_vendor(v) for v in vendors[:5]],
        })

    return {
        "processes": processes,
        "material": material,
        "vendorGroups": slim_groups,
        "totalGroups": len(slim_groups),
        "source": "backend /vendors/match",
    }


register_tool(
    name="get_vendor_recommendations",
    description=(
        "Queries the live vendor network and returns ranked suppliers for this part's "
        "process route. Groups vendors by operation category (Sheet Metal Fabrication, "
        "CNC Machining, Quality, etc.) with scores, certifications, and reasons. "
        "Use for ANY question about vendors, suppliers, RFQ targets, who can make this part, "
        "best supplier, or sourcing recommendations."
    ),
    parameters={
        "type": "object",
        "properties": {
            "process_filter": {
                "type": "string",
                "description": (
                    "Optional: filter results to a specific operation category. "
                    "E.g. 'Laser Cutting', 'Sheet Metal', 'Quality'. Leave empty to show all."
                ),
            }
        },
        "required": [],
    },
    handler=_get_vendor_recommendations,
)
