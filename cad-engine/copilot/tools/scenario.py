"""
Scenario comparison tool — calls the Scenario Engine which hits the NestJS backend
concurrently for each scenario.
"""

from __future__ import annotations
import json
import logging
from typing import Any
from copilot.registry import register_tool
from copilot.scenario_engine import ScenarioSpec, run_scenario_comparison

logger = logging.getLogger(__name__)

_VALID_PARAMS = {"materialGrade", "annualVolume", "batchSize", "factory"}


async def _run_scenario_comparison(
    ctx: dict,
    backend_url: str,
    auth_token: str,
    bom_item_id: str,
    scenarios_json: str = "[]",
    **_,
) -> dict[str, Any]:
    # Parse scenarios from JSON string (Groq passes tool args as strings)
    try:
        raw = json.loads(scenarios_json) if isinstance(scenarios_json, str) else scenarios_json
    except Exception:
        return {"error": "scenarios_json must be a valid JSON array of scenario objects."}

    if not isinstance(raw, list) or not raw:
        return {"error": "Provide at least one scenario. Example: [{\"label\":\"ABS\",\"params\":{\"materialGrade\":\"ABS\"}}]"}

    specs: list[ScenarioSpec] = []
    for item in raw[:6]:  # cap at 6 scenarios
        if not isinstance(item, dict):
            continue
        label = item.get("label", "Scenario")
        params = {k: v for k, v in item.get("params", {}).items() if k in _VALID_PARAMS}
        if params:
            specs.append(ScenarioSpec(label=label, params=params))

    if not specs:
        return {"error": "No valid scenario params. Use keys: materialGrade, annualVolume, batchSize, factory."}

    prod = ctx.get("production", {})
    cost = ctx.get("cost", {})
    part = ctx.get("part", {})

    baseline = cost.get("totalCost")
    batch = prod.get("batchSize") or part.get("batchSize") or 250
    annual = prod.get("annualVolume") or part.get("annualVolume") or 1000
    factory = prod.get("factory") or "USA"

    return await run_scenario_comparison(
        bom_item_id=bom_item_id,
        scenarios=specs,
        backend_url=backend_url,
        auth_token=auth_token,
        baseline_cost=baseline,
        current_batch_size=int(batch),
        current_annual_volume=int(annual),
        current_factory=factory,
    )


register_tool(
    name="run_scenario_comparison",
    description=(
        "Runs multiple what-if manufacturing scenarios concurrently and returns them ranked "
        "by total cost with savings % vs current. "
        "Pass scenarios_json as a JSON string array, e.g.: "
        '[{"label":"ABS","params":{"materialGrade":"ABS"}}, '
        '{"label":"India factory","params":{"factory":"India"}}, '
        '{"label":"10k volume","params":{"annualVolume":10000}}]'
        "\nValid params keys: materialGrade, annualVolume, batchSize, factory."
    ),
    parameters={
        "type": "object",
        "properties": {
            "scenarios_json": {
                "type": "string",
                "description": (
                    'JSON string array of scenario objects, each with "label" and "params". '
                    'Params keys: materialGrade (string), annualVolume (int), batchSize (int), factory (string).'
                ),
            }
        },
        "required": ["scenarios_json"],
    },
    handler=_run_scenario_comparison,
)
