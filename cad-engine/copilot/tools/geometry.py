"""Geometry and DFM tools — all read from the pre-supplied context dict."""

from __future__ import annotations
from typing import Any
from copilot.registry import register_tool


async def _get_part_geometry(ctx: dict, **_) -> dict[str, Any]:
    part = ctx.get("part", {})
    geometry = ctx.get("geometry", {})
    return {
        "name": part.get("name"),
        "family": part.get("family"),
        "confidence": part.get("confidence"),
        "dimensions_mm": part.get("dimensions"),
        "volume_mm3": part.get("volume"),
        "surface_area_mm2": geometry.get("surfaceArea") or part.get("surfaceArea"),
        "weight_kg": part.get("weight"),
        "material": part.get("material"),
        "source": "context.part + context.geometry",
    }


async def _get_features(ctx: dict, **_) -> dict[str, Any]:
    geometry = ctx.get("geometry", {})
    return {
        "holeGroups": geometry.get("holeGroups"),
        "bends": geometry.get("bends"),
        "ribs": geometry.get("ribs"),
        "bosses": geometry.get("bosses"),
        "undraftedFaces": geometry.get("undraftedFaces"),
        "wallThickness_mm": geometry.get("wallThickness"),
        "cutLength_mm": geometry.get("cutLength"),
        "threads": geometry.get("threads"),
        "complexity": geometry.get("complexity"),
        "source": "context.geometry",
    }


async def _get_dfm_analysis(ctx: dict, **_) -> dict[str, Any]:
    dfm = ctx.get("dfm", {})
    return {
        "manufacturabilityScore": dfm.get("score"),
        "difficultyLevel": dfm.get("difficulty"),
        "warningCount": len(dfm.get("warnings", [])),
        "topWarnings": dfm.get("warnings", [])[:5],
        "source": "context.dfm",
    }


async def _get_dfm_warnings(ctx: dict, **_) -> dict[str, Any]:
    dfm = ctx.get("dfm", {})
    warnings = dfm.get("warnings", [])
    critical = [w for w in warnings if w.get("severity") in ("critical", "error")]
    moderate = [w for w in warnings if w.get("severity") == "warning"]
    info = [w for w in warnings if w.get("severity") == "info"]
    return {
        "total": len(warnings),
        "critical": critical,
        "moderate": moderate,
        "info": info,
        "source": "context.dfm.warnings",
    }


register_tool(
    name="get_part_geometry",
    description=(
        "Returns the part's dimensions, volume, surface area, weight, and material. "
        "Use this for any question about part size, mass, or basic geometry."
    ),
    parameters={
        "type": "object",
        "properties": {},
        "required": [],
    },
    handler=_get_part_geometry,
)

register_tool(
    name="get_features",
    description=(
        "Returns manufacturing features: hole groups, bends, ribs, bosses, "
        "undrafted faces, wall thickness, threads, and complexity score."
    ),
    parameters={
        "type": "object",
        "properties": {},
        "required": [],
    },
    handler=_get_features,
)

register_tool(
    name="get_dfm_analysis",
    description=(
        "Returns the DFM manufacturability score, difficulty level, "
        "and top 5 DFM warnings. Use for general DFM questions."
    ),
    parameters={
        "type": "object",
        "properties": {},
        "required": [],
    },
    handler=_get_dfm_analysis,
)

register_tool(
    name="get_dfm_warnings",
    description=(
        "Returns all DFM warnings categorised by severity: critical, moderate, info. "
        "Use when the user asks about design issues or redesign suggestions."
    ),
    parameters={
        "type": "object",
        "properties": {},
        "required": [],
    },
    handler=_get_dfm_warnings,
)
