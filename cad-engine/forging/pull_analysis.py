"""
Pull-direction analysis: for one candidate pull axis, the true silhouette, the draft of every sampled surface, and the
die-lock (undercut) test; then the choice among the three canonical axes.

Silhouette: shared.casting_geometry.parting_plane_silhouette, unchanged (mesh triangles projected and merged; the outer
boundary is the parting line, so through-openings are not counted in the perimeter).

Draft: the angle between a surface and the pull direction, from the exact outward normal n and the unit pull d:
    draft = asin(|n . d|)
0 means parallel to the pull (a wall with no draft), 90 means perpendicular to it (a floor or roof). It is unsigned: which
way a wall leans is decided by the visibility test below, which is the real question.

Die lock: a closed-die forging is formed by two dies that part along +d and -d. A surface point facing +d (n.d > e) is formed
by the +d die, so it must see open space along +d; one facing -d is formed by the -d die and must see open space along -d.
A point whose ray along its own facing direction hits the part again is locked: no die half can retract from it. A surface
parallel to the pull (|n.d| <= e) faces neither die and is not tested; it is a zero-draft surface, reported as such.
e = sin(DRAFT_THRESHOLD_DEG), the one threshold in this package (constants.py). The ray is cast against the exact B-Rep,
not the mesh, from just outside the surface, so the test does not depend on the tessellation and does not use the normal alone.
This is complete for a two-piece die: if every +d-facing point sees +d and every -d-facing point sees -d, each line parallel
to d crosses the part in one interval, so a parting surface exists.

Axis choice: lexicographic on (locked area, zero-draft area), smaller is better, ties kept in x, y, z order and reported.
Locked area comes first because a die lock makes the part unforgeable in that direction. Zero-draft area second because it
is the area that needs draft added, which the staged rule makes Critical below 0.01 degrees. Nothing else is weighed: no
sourced weight exists for silhouette area or die depth, so they are reported, not scored. The definition is part of the payload.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from shared.casting_geometry import parting_plane_silhouette

from .constants import (
    CANONICAL_AXES, DRAFT_THRESHOLD_DEG, RAY_MIN_HIT_MM, RAY_START_OFFSET_MM,
)
from .sampling import FaceRecord

SCORE_DEFINITION = (
    "lexicographic, smaller is better: (1) die-locked area mm2, (2) zero-draft area mm2 "
    "(surface within 0.01 degrees of parallel to the pull); equal axes keep x, y, z order"
)


class Visibility:
    """Exact-B-Rep ray test, loaded once per shape."""

    def __init__(self, shape: Any):
        from OCC.Core.IntCurvesFace import IntCurvesFace_ShapeIntersector  # type: ignore
        self._x = IntCurvesFace_ShapeIntersector()
        self._x.Load(shape, 1e-6)

    def blocked(self, start: Sequence[float], direction: Sequence[float]) -> bool:
        from OCC.Core.gp import gp_Dir, gp_Lin, gp_Pnt  # type: ignore
        self._x.Perform(gp_Lin(gp_Pnt(*start), gp_Dir(*direction)), RAY_MIN_HIT_MM, 1e9)
        return bool(self._x.IsDone() and self._x.NbPnt() > 0)


def _r(x: float, nd: int = 4) -> float:
    return round(float(x), nd)


def analyze_axis(
    shape: Any,
    faces: List[FaceRecord],
    name: str,
    direction: Sequence[float],
    visibility: Visibility,
    linear_deflection: float,
    draft_thresholds_deg: Sequence[float] = (),
    include_faces: bool = True,
) -> Dict[str, Any]:
    d = tuple(float(x) for x in direction)
    eps = math.sin(math.radians(DRAFT_THRESHOLD_DEG))
    thresholds = sorted({float(t) for t in draft_thresholds_deg} | {DRAFT_THRESHOLD_DEG})
    below = {t: 0.0 for t in thresholds}

    sil = parting_plane_silhouette(shape, d, linear_deflection)

    total = locked_area = zero_area = 0.0
    tested = locked_n = 0
    min_draft = 90.0
    per_face: List[Dict[str, Any]] = []
    locked_faces: List[int] = []

    for fr in faces:
        if not fr.samples:
            continue
        w_face = f_locked = 0.0
        d_lo, d_hi, d_sum = 90.0, 0.0, 0.0
        facing = set()
        for s in fr.samples:
            nd = s.normal[0] * d[0] + s.normal[1] * d[1] + s.normal[2] * d[2]
            draft = math.degrees(math.asin(min(1.0, abs(nd))))
            w = s.weight_mm2
            total += w
            w_face += w
            d_lo, d_hi, d_sum = min(d_lo, draft), max(d_hi, draft), d_sum + draft * w
            min_draft = min(min_draft, draft)
            for t in thresholds:
                if draft < t:
                    below[t] += w
            if abs(nd) <= eps:
                zero_area += w
                facing.add("parallel")
                continue
            side = 1.0 if nd > 0 else -1.0
            facing.add("pull" if side > 0 else "anti_pull")
            start = tuple(s.point[i] + s.normal[i] * RAY_START_OFFSET_MM for i in range(3))
            tested += 1
            if visibility.blocked(start, (side * d[0], side * d[1], side * d[2])):
                locked_n += 1
                locked_area += w
                f_locked += w
        if f_locked > 0:
            locked_faces.append(fr.index)
        if include_faces:
            per_face.append({
                "face_index": fr.index,
                "surface_type": fr.surface_type,
                "area_mm2": _r(fr.area_mm2),
                "draft_min_deg": _r(d_lo, 3),
                "draft_max_deg": _r(d_hi, 3),
                "draft_mean_deg": _r(d_sum / w_face, 3) if w_face else None,
                "locked_fraction": _r(f_locked / w_face, 4) if w_face else 0.0,
                "facing": "mixed" if len(facing) > 1 else (next(iter(facing)) if facing else "parallel"),
            })

    result: Dict[str, Any] = {
        "axis": name,
        "direction": [_r(x, 6) for x in d],
        "silhouette": {
            "projected_area_mm2": _r(sil["area_mm2"], 3),
            "parting_perimeter_mm": _r(sil["parting_perimeter_mm"], 3),
            "footprint_mm": [_r(sil["footprint_mm"][0], 3), _r(sil["footprint_mm"][1], 3)],
            "pull_extent_mm": _r(sil["pull_extent_mm"], 3),
        },
        "die_lock": {
            "has_die_lock": locked_n > 0,
            "locked_area_mm2": _r(locked_area, 3),
            "locked_fraction": _r(locked_area / total, 6) if total else 0.0,
            "locked_sample_count": locked_n,
            "tested_sample_count": tested,
            "locked_face_indices": locked_faces,
        },
        "draft": {
            "zero_draft_area_mm2": _r(zero_area, 3),
            "min_deg": _r(min_draft, 4),
            "area_below_deg": {f"{t:g}": _r(a, 3) for t, a in below.items()},
        },
        "sampled_area_mm2": _r(total, 3),
    }
    if include_faces:
        result["faces"] = per_face
    return result


def choose_axis(axes: List[Dict[str, Any]]) -> Dict[str, Any]:
    """The best of the analysed axes under SCORE_DEFINITION, with every axis's score and the ties."""
    def key(a: Dict[str, Any]) -> Tuple[float, float]:
        total = a["sampled_area_mm2"] or 1.0
        # compared as fractions of the part's area to 6 places, so float noise on equal axes does not break a tie
        return (round(a["die_lock"]["locked_area_mm2"] / total, 6), round(a["draft"]["zero_draft_area_mm2"] / total, 6))

    scores = [{"axis": a["axis"], "locked_area_mm2": a["die_lock"]["locked_area_mm2"], "zero_draft_area_mm2": a["draft"]["zero_draft_area_mm2"]} for a in axes]
    best = min(key(a) for a in axes)
    tied = [a["axis"] for a in axes if key(a) == best]
    return {
        "chosen_axis": tied[0],
        "tied_axes": tied if len(tied) > 1 else [],
        "score_definition": SCORE_DEFINITION,
        "scores": scores,
        "die_lock_free_axes": [a["axis"] for a in axes if not a["die_lock"]["has_die_lock"]],
    }


def analyze_pull_axes(
    shape: Any,
    faces: List[FaceRecord],
    linear_deflection: float,
    draft_thresholds_deg: Sequence[float] = (),
    include_faces: bool = True,
    axes: Optional[Dict[str, Sequence[float]]] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    visibility = Visibility(shape)
    candidates = axes or CANONICAL_AXES
    analysed = [
        analyze_axis(shape, faces, name, direction, visibility, linear_deflection, draft_thresholds_deg, include_faces)
        for name, direction in candidates.items()
    ]
    return analysed, choose_axis(analysed)
