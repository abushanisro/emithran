"""
Scenario Engine — runs multiple what-if cost simulations concurrently
against the NestJS backend and returns a Pareto-ranked result set.

Each scenario overrides one or more production parameters:
  material, annualVolume, batchSize, factory

The engine calls GET /bom-items/:id/cost-summary with query params
and collects the resulting CostSummaryDto for each scenario.
"""

from __future__ import annotations
import asyncio
import logging
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_SCENARIO_TIMEOUT_S = 8.0


@dataclass
class ScenarioSpec:
    label: str
    params: dict[str, Any]
    # e.g. {"materialGrade": "ABS", "annualVolume": 10000, "factory": "India"}


@dataclass
class ScenarioOutcome:
    label: str
    params: dict[str, Any]
    total_cost: float | None
    material_cost: float | None
    process_cost: float | None
    co2_kg: float | None
    cycle_time_min: float | None
    currency_symbol: str
    feasible: bool
    error: str | None = None

    @property
    def savings_vs(self):
        """Returns a callable: savings_vs(baseline_cost) -> float | None."""
        def _calc(baseline: float) -> float | None:
            if self.total_cost is None or baseline is None or baseline == 0:
                return None
            return round((baseline - self.total_cost) / baseline * 100, 1)
        return _calc


async def _fetch_scenario(
    bom_item_id: str,
    spec: ScenarioSpec,
    backend_url: str,
    auth_token: str,
    current_batch_size: int,
    current_annual_volume: int,
    current_factory: str,
) -> ScenarioOutcome:
    params = {
        "batchSize": current_batch_size,
        "annualVolume": current_annual_volume,
        "factory": current_factory,
    }
    params.update(spec.params)

    headers = {"Authorization": f"Bearer {auth_token}"}
    url = f"{backend_url.rstrip('/')}/bom-items/{bom_item_id}/cost-summary"

    try:
        async with httpx.AsyncClient(timeout=_SCENARIO_TIMEOUT_S) as client:
            resp = await client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()

        sustain = data.get("sustainability") or {}
        cycle_times = data.get("cycleTimes") or {}
        total_cycle = sum(cycle_times.values()) if isinstance(cycle_times, dict) else None

        return ScenarioOutcome(
            label=spec.label,
            params=spec.params,
            total_cost=data.get("totalCost"),
            material_cost=data.get("material", {}).get("cost") if isinstance(data.get("material"), dict) else None,
            process_cost=data.get("totalProcessCost"),
            co2_kg=sustain.get("totalCo2Kg"),
            cycle_time_min=total_cycle,
            currency_symbol=data.get("currencySymbol", "$"),
            feasible=True,
        )
    except httpx.HTTPStatusError as e:
        logger.warning(f"Scenario '{spec.label}' returned HTTP {e.response.status_code}")
        return ScenarioOutcome(
            label=spec.label, params=spec.params,
            total_cost=None, material_cost=None, process_cost=None,
            co2_kg=None, cycle_time_min=None, currency_symbol="$",
            feasible=False, error=f"HTTP {e.response.status_code}",
        )
    except Exception as e:
        logger.warning(f"Scenario '{spec.label}' failed: {e}")
        return ScenarioOutcome(
            label=spec.label, params=spec.params,
            total_cost=None, material_cost=None, process_cost=None,
            co2_kg=None, cycle_time_min=None, currency_symbol="$",
            feasible=False, error=str(e),
        )


async def run_scenario_comparison(
    bom_item_id: str,
    scenarios: list[ScenarioSpec],
    backend_url: str,
    auth_token: str,
    baseline_cost: float | None = None,
    current_batch_size: int = 250,
    current_annual_volume: int = 1000,
    current_factory: str = "USA",
) -> dict[str, Any]:
    """
    Run all scenarios concurrently and return a ranked comparison dict
    ready to be returned as a tool result to Groq.
    """
    tasks = [
        _fetch_scenario(
            bom_item_id, spec, backend_url, auth_token,
            current_batch_size, current_annual_volume, current_factory,
        )
        for spec in scenarios
    ]
    outcomes: list[ScenarioOutcome] = await asyncio.gather(*tasks)

    # Rank feasible scenarios by total cost (lowest first)
    feasible = sorted(
        [o for o in outcomes if o.feasible and o.total_cost is not None],
        key=lambda o: o.total_cost,  # type: ignore[arg-type]
    )
    infeasible = [o for o in outcomes if not o.feasible]

    def _format(o: ScenarioOutcome, rank: int) -> dict[str, Any]:
        savings_pct = o.savings_vs(baseline_cost) if baseline_cost else None
        return {
            "rank": rank,
            "label": o.label,
            "params": o.params,
            "totalCost": o.total_cost,
            "materialCost": o.material_cost,
            "processCost": o.process_cost,
            "co2Kg": o.co2_kg,
            "cycleTimeMin": o.cycle_time_min,
            "currencySymbol": o.currency_symbol,
            "savingsVsBaselinePct": savings_pct,
        }

    return {
        "baseline_cost": baseline_cost,
        "ranked_scenarios": [_format(o, i + 1) for i, o in enumerate(feasible)],
        "infeasible_scenarios": [{"label": o.label, "error": o.error} for o in infeasible],
        "best_cost": feasible[0].total_cost if feasible else None,
        "best_label": feasible[0].label if feasible else None,
    }
