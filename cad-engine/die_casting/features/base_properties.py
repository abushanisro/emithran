"""
Die Casting Base Properties / Parting Line / Setup Axes.

Not a per-occurrence feature in the feature_graph_v2 sense — a once-per-part
computation every later detector (holes, voids/slides) consumes, the same
role sheet_metal's dominant_normal/sheet_thickness play in
SheetMetalFeatureExtractor.extract().

Stage 1 (candidate, "ambiguous"): for each of the 3 canonical axes, run the
shared draft-angle geometry (shared/draft_angle_geometry.analyze_draft_angles)
FORCED to that axis. The candidate with the fewest undrafted+undercut wall
faces is the best-guess pull axis — cheapest real signal, not yet proven.

Stage 2 (real positive evidence, "recognized"): that candidate axis ALSO has
zero true undercut faces (a real, already-measured geometric fact — a single
pull vector with no face whose normal backs away from it by more than
undercut_threshold_deg genuinely admits a clean 2-plate die opening; any
real undercut means this axis needs a slide/core, which is exactly the
"Slides" operation group the real catalog (memory/Die Casting/Processes/
operations.csv) names as a SEPARATE path from "As Cast"/"No Coring"/
"No Side Pull"). This is never a bare threshold alone — it is the same
analyze_draft_angles evidence already computed, read for its own topological
meaning (zero back-angle faces), not re-guessed.

No memory/Die Casting/Lookup/*.csv threshold is needed here — pure topology.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from shared.draft_angle_geometry import analyze_draft_angles

# Draft/undercut thresholds for Phase 1's axis search are intentionally the
# tightest real sourced values in memory/Die Casting/Lookup/tblDraftAngle.csv
# (Zinc/HPDC = 0.50 deg undrafted ceiling is tighter than Aluminum's 0.25 deg
# only in the other direction -- Aluminum/HPDC's own 0.25 deg is in fact the
# tightest undrafted ceiling in the real table) -- using the tightest real
# value here means a face this test calls "undrafted" would be flagged
# undrafted under EVERY real material/process combination in the catalog, so
# the axis search never under-counts a real problem face regardless of which
# material gets chosen in a later phase. The undercut/draft-range ceiling
# (5 deg) matches Injection Molding's own industry-standard value, since no
# memory/Die Casting source gives a distinct generic back-angle ceiling.
UNDRAFTED_THRESHOLD_DEG = 0.25
UNDERCUT_THRESHOLD_DEG = 5.0

_AXIS_NAMES = ["x", "y", "z"]
_AXIS_VECTORS = [(1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)]


def _face_centroids_along_axis(shape: Any, axis_idx: int) -> List[float]:
    """Every face's own centroid, projected onto the candidate axis. Used to find
    the real median parting-plane offset -- not a fabricated split point."""
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore

    projections: List[float] = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        try:
            props = GProp_GProps()
            brepgprop.SurfaceProperties(explorer.Current(), props)
            cog = props.CentreOfMass()
            coords = [float(cog.X()), float(cog.Y()), float(cog.Z())]
            projections.append(coords[axis_idx])
        except Exception:
            pass
        explorer.Next()
    return projections


def _face_ids_near_offset(shape: Any, axis_idx: int, offset: float, band: float) -> List[int]:
    """Real faces whose centroid sits within `band` of the parting-plane offset —
    the real candidates for the part's own parting-line boundary."""
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore

    ids: List[int] = []
    face_idx = 0
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        try:
            props = GProp_GProps()
            brepgprop.SurfaceProperties(explorer.Current(), props)
            cog = props.CentreOfMass()
            coords = [float(cog.X()), float(cog.Y()), float(cog.Z())]
            if abs(coords[axis_idx] - offset) <= band:
                ids.append(face_idx)
        except Exception:
            pass
        face_idx += 1
        explorer.Next()
    return ids


def analyze_base_properties(shape: Any, bbox_dims: List[float]) -> Dict[str, Any]:
    """
    Returns setup_axis_candidates (one per canonical axis), primary_setup_axis
    (the recognized candidate's unit vector, or None when no axis is
    recognized), parting_line_face_ids, and base_properties (volume/bbox).
    """
    candidates: List[Dict[str, Any]] = []
    for axis_idx in range(3):
        draft = analyze_draft_angles(
            shape, bbox_dims,
            undrafted_threshold_deg=UNDRAFTED_THRESHOLD_DEG,
            undercut_threshold_deg=UNDERCUT_THRESHOLD_DEG,
            forced_axis_idx=axis_idx,
        )
        total_wall = draft.get("total_wall_face_count", 0) or 0
        undrafted = draft.get("undrafted_face_count", 0) or 0
        undercut = draft.get("undercut_face_count", 0) or 0

        projections = _face_centroids_along_axis(shape, axis_idx)
        parting_plane_offset_mm: Optional[float] = None
        if projections:
            sorted_proj = sorted(projections)
            mid = len(sorted_proj) // 2
            parting_plane_offset_mm = (
                sorted_proj[mid] if len(sorted_proj) % 2
                else (sorted_proj[mid - 1] + sorted_proj[mid]) / 2.0
            )
            parting_plane_offset_mm = round(parting_plane_offset_mm, 3)

        # Real topological fact, never a guess: zero genuine back-angle faces
        # against this single pull vector means the part is cleanly openable
        # along this one axis with no slide/core needed.
        recognized = total_wall > 0 and undercut == 0
        evidence = (
            f"{total_wall} wall face(s) measured against axis {_AXIS_NAMES[axis_idx]}: "
            f"{undercut} genuine back-angle (undercut) face(s), {undrafted} undrafted face(s)"
            if total_wall > 0 else "no measurable planar wall faces against this axis"
        )

        candidates.append({
            "axis": list(_AXIS_VECTORS[axis_idx]),
            "axis_name": _AXIS_NAMES[axis_idx],
            "recognition_status": "recognized" if recognized else "ambiguous",
            "recognition_evidence": evidence,
            "undrafted_face_count": undrafted,
            "undercut_face_count": undercut,
            "total_wall_face_count": total_wall,
            "parting_plane_offset_mm": parting_plane_offset_mm,
        })

    # Stage 1 pick: fewest problem faces overall (informational even when no
    # candidate is later recognized).
    ranked = sorted(candidates, key=lambda c: (c["undercut_face_count"], c["undrafted_face_count"]))
    best = ranked[0] if ranked else None

    recognized_candidates = [c for c in candidates if c["recognition_status"] == "recognized"]
    primary: Optional[Dict[str, Any]] = None
    if recognized_candidates:
        # Among real candidates (all proven slide-free), prefer fewest undrafted
        # faces, then the shortest real bbox dimension -- a die/mold conventionally
        # opens along its shortest span to minimize draw length (the same real
        # fallback convention Injection Molding's own pull-axis detection already
        # uses when no single axis has dominant planar area).
        primary = sorted(
            recognized_candidates,
            key=lambda c: (c["undrafted_face_count"], bbox_dims[_AXIS_NAMES.index(c["axis_name"])]),
        )[0]

    parting_line_face_ids: List[int] = []
    if primary is not None and primary["parting_plane_offset_mm"] is not None:
        axis_idx = _AXIS_NAMES.index(primary["axis_name"])
        band = max(1.0, 0.02 * min(d for d in bbox_dims if d > 0)) if any(d > 0 for d in bbox_dims) else 1.0
        parting_line_face_ids = _face_ids_near_offset(
            shape, axis_idx, primary["parting_plane_offset_mm"], band,
        )

    volume_mm3: Optional[float] = None
    try:
        from OCC.Core.BRepGProp import brepgprop  # type: ignore
        from OCC.Core.GProp import GProp_GProps  # type: ignore
        vol_props = GProp_GProps()
        brepgprop.VolumeProperties(shape, vol_props)
        volume_mm3 = round(vol_props.Mass(), 2)
    except Exception:
        pass

    return {
        "setup_axis_candidates": candidates,
        "primary_setup_axis": primary["axis"] if primary else None,
        "primary_setup_axis_name": primary["axis_name"] if primary else None,
        "parting_plane_offset_mm": primary["parting_plane_offset_mm"] if primary else None,
        "parting_line_face_ids": parting_line_face_ids,
        "base_properties": {
            "volume_mm3": volume_mm3,
            "bbox_mm": {"x": bbox_dims[0] if len(bbox_dims) > 0 else None,
                        "y": bbox_dims[1] if len(bbox_dims) > 1 else None,
                        "z": bbox_dims[2] if len(bbox_dims) > 2 else None},
            "primary_setup_axis_confidence": 0.65 if primary else 0.0,
            "best_candidate_axis_name": best["axis_name"] if best else None,
        },
    }
