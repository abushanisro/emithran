"""Cost, machine selection, and route comparison tools."""

from __future__ import annotations
from typing import Any
from copilot.registry import register_tool


async def _get_cost_breakdown(ctx: dict, **_) -> dict[str, Any]:
    cost = ctx.get("cost", {})
    mat = cost.get("material") or {}
    total = cost.get("totalCost") or 0
    mat_cost = mat.get("cost") or 0
    return {
        "totalCost": cost.get("totalCost"),
        "currencySymbol": cost.get("currencySymbol", "$"),
        "material": {
            "grade": mat.get("grade"),
            "grossWeightKg": mat.get("grossWeightKg"),
            "costPerKg": mat.get("costPerKg"),
            "cost": mat_cost,
            "pct": round(mat_cost / total * 100, 1) if total else None,
        },
        "totalProcessCost": cost.get("totalProcessCost"),
        "processLines": cost.get("processLines", []),
        "tooling": cost.get("tooling"),
        "injectionMolding": cost.get("injectionMolding"),
        "warnings": cost.get("warnings", []),
        "batchSize": cost.get("batchSize"),
        "source": "context.cost",
    }


async def _get_machine_selection(ctx: dict, **_) -> dict[str, Any]:
    cost = ctx.get("cost", {})
    lines = cost.get("processLines", [])
    machines = []
    for line in lines:
        if isinstance(line, dict) and line.get("machineSelection"):
            ms = line["machineSelection"]
            machines.append({
                "process": line.get("process"),
                "machineName": line.get("machineName") or ms.get("selected", {}).get("name"),
                "hourlyRate": line.get("hourlyRate"),
                "rateSource": line.get("rateSource"),
                "cycleTimeMin": line.get("cycleTimeMin"),
                "selection": ms,
            })
    return {
        "machines": machines,
        "source": "context.cost.processLines[].machineSelection",
    }


async def _get_route_comparison(ctx: dict, **_) -> dict[str, Any]:
    routes = ctx.get("routes", {})
    route_list = routes.get("routes", [])
    feasible = [r for r in route_list if r.get("isFeasible")]
    infeasible = [r for r in route_list if not r.get("isFeasible")]
    # Return slim summaries only — full processLines would blow the TPM budget
    def _slim(r: dict) -> dict:
        return {
            "routeId": r.get("routeId"),
            "routeLabel": r.get("routeLabel"),
            "totalCost": r.get("totalCost"),
            "cycleTimes": r.get("cycleTimes"),
            "badges": r.get("badges"),
            "warnings": (r.get("warnings") or [])[:2],
        }
    return {
        "baselineMaterialCost": routes.get("materialCost"),
        "materialGrade": routes.get("materialGrade"),
        "feasibleRoutes": [_slim(r) for r in feasible[:3]],
        "infeasibleRoutes": [
            {"routeId": r.get("routeId"), "routeLabel": r.get("routeLabel"),
             "warnings": (r.get("warnings") or [])[:1]}
            for r in infeasible[:3]
        ],
        "comparisonWarnings": (routes.get("comparisonWarnings") or [])[:3],
        "source": "context.routes",
    }


register_tool(
    name="get_cost_breakdown",
    description=(
        "Returns the full cost breakdown: total cost, material cost, process costs "
        "per operation, tooling, and warnings. Use for any cost question."
    ),
    parameters={"type": "object", "properties": {}, "required": []},
    handler=_get_cost_breakdown,
)

register_tool(
    name="get_machine_selection",
    description=(
        "Returns which machines were selected for each process step, their hourly rates, "
        "cycle times, and selection rationale. Use for machine or cycle time questions."
    ),
    parameters={"type": "object", "properties": {}, "required": []},
    handler=_get_machine_selection,
)

register_tool(
    name="get_route_comparison",
    description=(
        "Returns all feasible and infeasible manufacturing routes with costs, "
        "cycle times, CO2, badges (lowest cost/fastest/best quality), and capability warnings. "
        "Use for route comparison or 'can this be made on a different machine' questions."
    ),
    parameters={"type": "object", "properties": {}, "required": []},
    handler=_get_route_comparison,
)
