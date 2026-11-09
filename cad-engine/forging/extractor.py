"""
Forging geometry extractor: one B-Rep solid in, one versioned JSON-ready payload out (contract/forging_geometry.schema.json).

It measures and never judges: no staged DFM threshold is applied here and no cost is computed. The backend reads the
payload and applies memory/Forging thresholds (draft by material, fillet and corner minimums, thin section by shadow area).
It is not wired into the upload pipeline.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional, Sequence

from shared.casting_geometry import wall_thickness_profile

from .blends import analyze_blends
from .classification import holes, revolution_fractions, shape_measures
from .constants import (
    DEFAULT_LINEAR_DEFLECTION_MM, DEFAULT_MAX_RAYS_PER_AXIS, DEFAULT_MAX_SAMPLES_PER_FACE, DEFAULT_SECTION_STATIONS,
    DRAFT_THRESHOLD_DEG, EXTRACTOR_NAME, EXTRACTOR_VERSION, SCHEMA_VERSION,
)
from .pull_analysis import analyze_pull_axes
from .sampling import sample_shape
from .sections import section_curve

logger = logging.getLogger(__name__)


def extract_forging_geometry(
    shape: Any,
    *,
    linear_deflection_mm: float = DEFAULT_LINEAR_DEFLECTION_MM,
    draft_thresholds_deg: Sequence[float] = (),
    section_axis: str = "auto",
    section_stations: int = DEFAULT_SECTION_STATIONS,
    max_samples_per_face: int = DEFAULT_MAX_SAMPLES_PER_FACE,
    max_rays_per_axis: int = DEFAULT_MAX_RAYS_PER_AXIS,
    include_faces: bool = True,
    include_wall_thickness: bool = True,
) -> Dict[str, Any]:
    """`draft_thresholds_deg` are extra thresholds (for example the staged 5 and 7 degree Majors) for which the area below
    each is reported; the 0.01 degree Critical threshold is always included. They are inputs, never defaults."""
    warnings = []

    measures = shape_measures(shape)
    faces = sample_shape(shape, linear_deflection_mm, max_samples_per_face, max_rays_per_axis)
    if not faces or not any(f.samples for f in faces):
        raise ValueError("the shape has no tessellated faces")

    axes, choice = analyze_pull_axes(shape, faces, linear_deflection_mm, draft_thresholds_deg, include_faces)
    chosen = next(a for a in axes if a["axis"] == choice["chosen_axis"])
    sil = chosen["silhouette"]

    blends = analyze_blends(shape, faces, chosen["direction"])

    wall: Optional[Dict[str, Any]] = None
    if include_wall_thickness:
        try:
            wall = dict(wall_thickness_profile(shape, linear_deflection_mm))
            # staged ThinSection is banded by "Solid Shadow Area". The shadow of the solid along the pull is the
            # silhouette area; whether that is the aPriori definition is open item D8, so both are named.
            wall["solid_shadow_area_mm2"] = sil["projected_area_mm2"]
            wall["solid_shadow_area_basis"] = "projected area along the chosen pull axis (open item D8: how a part's area selects a band)"
        except Exception as e:  # OCCT errors surface as RuntimeError
            logger.warning("forging wall thickness failed: %s", e)
            warnings.append(f"wall thickness not measured: {e}")

    sections = section_curve(shape, section_axis, section_stations, measures["_volume"])
    if sections.get("volume_check_ratio") is not None and abs(sections["volume_check_ratio"] - 1.0) > 0.02:
        warnings.append(
            f"A(x) integrates to {sections['volume_check_ratio']:.3f} of the exact volume: a step falls inside a station cell "
            "or the tessellation is coarse; raise section_stations or lower linear_deflection_mm"
        )

    part = {k: v for k, v in measures.items() if not k.startswith("_")}
    payload: Dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "extractor": {"name": EXTRACTOR_NAME, "version": EXTRACTOR_VERSION},
        "units": {"length": "mm", "area": "mm2", "volume": "mm3", "angle": "degrees"},
        "parameters": {
            "linear_deflection_mm": linear_deflection_mm,
            "draft_threshold_deg": DRAFT_THRESHOLD_DEG,
            "extra_draft_thresholds_deg": sorted({float(t) for t in draft_thresholds_deg}),
            "max_samples_per_face": max_samples_per_face,
            "max_rays_per_axis": max_rays_per_axis,
            "section_stations": section_stations,
        },
        "part": part,
        "pull": {**choice, "axes": axes},
        "selected": {
            "axis": chosen["axis"],
            "direction": chosen["direction"],
            "projected_area_mm2": sil["projected_area_mm2"],
            "parting_perimeter_mm": sil["parting_perimeter_mm"],
            "footprint_mm": sil["footprint_mm"],
            "pull_extent_mm": sil["pull_extent_mm"],
            "has_die_lock": chosen["die_lock"]["has_die_lock"],
            "locked_area_mm2": chosen["die_lock"]["locked_area_mm2"],
            "zero_draft_area_mm2": chosen["draft"]["zero_draft_area_mm2"],
        },
        "blends": blends,
        "holes": holes(shape, chosen["direction"]),
        "revolution": revolution_fractions(shape, faces, measures["_centre"]),
        "wall_thickness": wall,
        "sections": sections,
        "warnings": warnings,
    }
    return payload


def extract_forging_geometry_from_step(path: str, **kwargs: Any) -> Dict[str, Any]:
    from shared.services import StepReader
    return extract_forging_geometry(StepReader().read(path), **kwargs)
