"""Production scenario, material info, and NRE investment tools."""

from __future__ import annotations
from typing import Any
from copilot.registry import register_tool


async def _get_production_scenario(ctx: dict, **_) -> dict[str, Any]:
    prod = ctx.get("production", {})
    part = ctx.get("part", {})
    return {
        "annualVolume": prod.get("annualVolume") or part.get("annualVolume"),
        "batchSize": prod.get("batchSize") or part.get("batchSize"),
        "productionLifeYears": prod.get("productionLifeYears"),
        "lifetimeVolume": prod.get("lifetimeVolume"),
        "factory": prod.get("factory"),
        "source": "context.production + context.part",
    }


async def _get_material_info(ctx: dict, **_) -> dict[str, Any]:
    cost = ctx.get("cost", {})
    part = ctx.get("part", {})
    mat = cost.get("material") or {}
    return {
        "grade": mat.get("grade") or part.get("material"),
        "grossWeightKg": mat.get("grossWeightKg"),
        "netWeightKg": mat.get("netWeightKg"),
        "costPerKg": mat.get("costPerKg"),
        "densityGCm3": mat.get("densityGCm3"),
        "source_flag": mat.get("source"),
        "source": "context.cost.material",
    }


async def _get_investment_nre(ctx: dict, **_) -> dict[str, Any]:
    inv = ctx.get("investment", {})
    cost = ctx.get("cost", {})
    tooling = cost.get("tooling") or {}
    return {
        "nreTotal": inv.get("nreTotal"),
        "amortizedPerUnit": inv.get("amortizedPerUnit"),
        "amortizedPct": inv.get("amortizedPct"),
        "toolingCost": tooling.get("moldCost") or tooling.get("totalCost"),
        "toolingAmortizedPerPart": tooling.get("amortizedPerPart"),
        "toolingLifetimeParts": tooling.get("lifetimeParts"),
        "breakdown": inv.get("breakdown"),
        "source": "context.investment + context.cost.tooling",
    }


register_tool(
    name="get_production_scenario",
    description=(
        "Returns the current production scenario: annual volume, batch size, "
        "production life, and factory location."
    ),
    parameters={"type": "object", "properties": {}, "required": []},
    handler=_get_production_scenario,
)

register_tool(
    name="get_material_info",
    description=(
        "Returns the current material grade, density, cost per kg, gross weight, "
        "and the source of the material price data."
    ),
    parameters={"type": "object", "properties": {}, "required": []},
    handler=_get_material_info,
)

register_tool(
    name="get_investment_nre",
    description=(
        "Returns NRE (non-recurring engineering) investment: total NRE, amortized cost per part, "
        "tooling cost, mold lifetime, and breakdown by category (fixture, programming, tooling, inspection)."
    ),
    parameters={"type": "object", "properties": {}, "required": []},
    handler=_get_investment_nre,
)
