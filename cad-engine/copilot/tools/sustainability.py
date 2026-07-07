"""Sustainability tool."""

from __future__ import annotations
from typing import Any
from copilot.registry import register_tool


async def _get_sustainability(ctx: dict, **_) -> dict[str, Any]:
    sustain = ctx.get("sustainability", {})
    return {
        "netWeightKg": sustain.get("netWeightKg"),
        "scrapKg": sustain.get("scrapKg"),
        "materialUtilizationPct": sustain.get("materialUtilizationPct"),
        "totalCo2Kg": sustain.get("totalCo2Kg"),
        "co2PerKgPart": sustain.get("co2PerKgPart"),
        "totalProcessEnergyKwh": sustain.get("totalProcessEnergyKwh"),
        "recyclabilityPct": sustain.get("recyclabilityPct"),
        "sustainabilityScore": sustain.get("sustainabilityScore"),
        "scoreBreakdown": sustain.get("scoreBreakdown"),
        "co2Contributors": sustain.get("co2Contributors"),
        "opportunities": sustain.get("opportunities"),
        "source": "context.sustainability",
    }


register_tool(
    name="get_sustainability",
    description=(
        "Returns sustainability metrics: CO2 footprint, energy consumption, material "
        "utilization, scrap, recyclability score, and improvement opportunities."
    ),
    parameters={"type": "object", "properties": {}, "required": []},
    handler=_get_sustainability,
)
