"""
Draft-angle / pull-axis geometry — shared, family-agnostic OCC analysis.

Extracted verbatim from injection_molding/feature_extractor.py's
_analyze_draft_angles (2026-10 Die Casting Phase 1 prerequisite refactor): the
pull-axis-by-dominant-planar-area detection and per-wall-face draft-angle
measurement are pure B-Rep geometry with no thermoplastic-specific assumption
except the two threshold VALUES, which are now parameters instead of hardcoded
constants. Injection Molding's own call site passes its existing 0.3°/5.0°
values, so its behavior is unchanged byte-for-byte. Die Casting calls the same
function with its own real, sourced per-material thresholds
(memory/Die Casting/Lookup/tblDraftAngle.csv) instead of guessing new ones.
"""

import logging
import math
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def analyze_draft_angles(
    shape: Any,
    bbox_dims: List[float],
    undrafted_threshold_deg: float = 0.3,
    undercut_threshold_deg: float = 5.0,
    forced_axis_idx: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Measure per-face draft angles on "wall faces" — planar faces whose normal
    is roughly perpendicular to the mold/die pull direction.

    Pull direction = the canonical axis (x/y/z) with the most planar face area
    aligned to it (the parting-surface normal), falling back to the shortest
    bounding-box dimension when no clearly dominant axis exists. Pass
    forced_axis_idx to measure draft against a SPECIFIC candidate axis instead
    (used by Die Casting's base_properties.py to evaluate every candidate pull
    axis, not just the single auto-picked one).

    For a wall face with unit normal n and pull unit vector p:
      draft_angle = arcsin(|dot(n, p)|)
      (When dot = 0: face is exactly perpendicular to pull -> 0 degree draft.
       When dot = sin(2 deg): face has 2 degree draft.)

    Classification:
      undrafted:   draft_angle < undrafted_threshold_deg — straight-pull surface, ejection risk
      drafted:     undrafted_threshold_deg <= angle <= undercut_threshold_deg
      overdrafted: angle > undercut_threshold_deg
      undercut:    dot(n, p) < -sin(undercut_threshold_deg) — face normal opposes
                   pull direction; requires a slide/lifter/core or redesign

    parting_complexity (0-1): ratio of undrafted + undercut faces to total wall
    faces, undercut weighted fully, undrafted weighted at half.

    Confidence is 0.65 — a V1 heuristic on a single-body assumption. Molds/dies
    with multiple parting surfaces or unsupported side actions may show false
    undrafts on the action faces. Tune against real parts before raising
    confidence.
    """
    _FALLBACK = {
        "undrafted_face_count": 0,
        "drafted_face_count": 0,
        "overdrafted_face_count": 0,
        "undercut_face_count": 0,
        "total_wall_face_count": 0,
        "avg_draft_angle_deg": None,
        "parting_complexity": None,
        "pull_axis": None,
        "draft_confidence": 0.0,
    }
    try:
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
        from OCC.Core.GeomAbs import GeomAbs_Plane  # type: ignore
        from OCC.Core.TopoDS import topods  # type: ignore
        from OCC.Core.BRepGProp import brepgprop  # type: ignore
        from OCC.Core.GProp import GProp_GProps  # type: ignore
    except ImportError:
        logger.warning("[draft_angle_geometry] OCC unavailable for draft analysis")
        return _FALLBACK

    # ── Pull axis: dominant planar face normal (or forced_axis_idx) ───────────
    pull_axis_names = ["x", "y", "z"]
    if forced_axis_idx is not None:
        pull_axis_idx = forced_axis_idx
    else:
        axis_area = [0.0, 0.0, 0.0]
        _pre_exp = TopExp_Explorer(shape, TopAbs_FACE)
        while _pre_exp.More():
            try:
                _f = topods.Face(_pre_exp.Current())
                _adp = BRepAdaptor_Surface(_f)
                if _adp.GetType() == GeomAbs_Plane:
                    _n = _adp.Plane().Axis().Direction()
                    _comps = [abs(float(_n.X())), abs(float(_n.Y())), abs(float(_n.Z()))]
                    _dom = max(range(3), key=lambda i: _comps[i])
                    if _comps[_dom] >= 0.70:  # clearly aligned to one axis
                        _gp = GProp_GProps()
                        brepgprop.SurfaceProperties(_f, _gp)
                        axis_area[_dom] += _gp.Mass()
            except Exception:
                pass
            _pre_exp.Next()

        if max(axis_area) >= 1.0:
            pull_axis_idx = int(max(range(3), key=lambda i: axis_area[i]))
        else:
            pull_axis_idx = min(range(len(bbox_dims)), key=lambda i: bbox_dims[i])

    pull: Tuple[float, float, float] = (
        1.0 if pull_axis_idx == 0 else 0.0,
        1.0 if pull_axis_idx == 1 else 0.0,
        1.0 if pull_axis_idx == 2 else 0.0,
    )

    # Wall faces: normal roughly perpendicular to pull -> |dot(n, pull)| < cos(75deg).
    # Base/top/parting faces (normal ~= pull) are excluded — they don't need draft.
    WALL_FACE_COS_THRESHOLD = 0.259  # cos(75 deg)
    MIN_FACE_AREA_MM2 = 10.0

    undercut_neg_dot_threshold = -math.sin(math.radians(undercut_threshold_deg))
    undrafted_abs_dot_threshold = math.sin(math.radians(undrafted_threshold_deg))

    undrafted_count = 0
    drafted_count = 0
    overdrafted_count = 0
    undercut_count = 0
    draft_angles: List[float] = []

    # Collect wall face plane equations for reuse (e.g. Injection Molding's rib
    # detection): (nx, ny, nz, plane_offset, area, cx, cy, cz).
    wall_face_planes: List[Tuple] = []

    # DFM face groups for 3D highlighting: face_index = global OCC ordinal,
    # matching the face_map ordinal every other detector in this codebase uses.
    undercut_dfm: List[Dict[str, Any]] = []
    undrafted_dfm: List[Dict[str, Any]] = []
    all_draft_faces_hm: List[Dict[str, Any]] = []

    face_index = 0
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        try:
            face = topods.Face(explorer.Current())
            current_face_index = face_index
            face_index += 1

            adaptor = BRepAdaptor_Surface(face)
            if adaptor.GetType() != GeomAbs_Plane:
                explorer.Next()
                continue

            plane = adaptor.Plane()
            n = plane.Axis().Direction()
            p = plane.Location()
            nx, ny, nz = float(n.X()), float(n.Y()), float(n.Z())
            mag = math.sqrt(nx * nx + ny * ny + nz * nz)
            if mag < 1e-9:
                explorer.Next()
                continue
            nx, ny, nz = nx / mag, ny / mag, nz / mag

            dot = nx * pull[0] + ny * pull[1] + nz * pull[2]

            if abs(dot) > WALL_FACE_COS_THRESHOLD:
                explorer.Next()
                continue

            props = GProp_GProps()
            brepgprop.SurfaceProperties(face, props)
            area = props.Mass()
            if area < MIN_FACE_AREA_MM2:
                explorer.Next()
                continue

            try:
                cog = props.CentreOfMass()
                centroid = [round(float(cog.X()), 2), round(float(cog.Y()), 2), round(float(cog.Z()), 2)]
            except Exception:
                centroid = [round(float(p.X()), 2), round(float(p.Y()), 2), round(float(p.Z()), 2)]

            draft_deg = math.degrees(math.asin(min(1.0, abs(dot))))
            draft_angles.append(round(draft_deg, 2))

            offset = float(p.X()) * nx + float(p.Y()) * ny + float(p.Z()) * nz
            wall_face_planes.append((nx, ny, nz, offset, area, centroid[0], centroid[1], centroid[2]))

            if dot < undercut_neg_dot_threshold:
                undercut_count += 1
                undercut_dfm.append({"face_id": current_face_index, "centroid": centroid, "back_angle_deg": round(draft_deg, 2)})
                all_draft_faces_hm.append({"centroid": centroid, "draft_deg": round(draft_deg, 2), "classification": "undercut"})
            elif abs(dot) < undrafted_abs_dot_threshold:
                undrafted_count += 1
                undrafted_dfm.append({"face_id": current_face_index, "centroid": centroid, "angle_deg": round(draft_deg, 2)})
                all_draft_faces_hm.append({"centroid": centroid, "draft_deg": round(draft_deg, 2), "classification": "undrafted"})
            elif draft_deg <= undercut_threshold_deg:
                drafted_count += 1
                all_draft_faces_hm.append({"centroid": centroid, "draft_deg": round(draft_deg, 2), "classification": "drafted"})
            else:
                overdrafted_count += 1
                all_draft_faces_hm.append({"centroid": centroid, "draft_deg": round(draft_deg, 2), "classification": "overdrafted"})
        except Exception:
            pass
        explorer.Next()

    total = undrafted_count + drafted_count + overdrafted_count + undercut_count
    if total == 0:
        return _FALLBACK

    raw = (undercut_count + undrafted_count * 0.5) / total
    parting_complexity = round(min(0.95, raw), 3)
    avg_draft = round(sum(draft_angles) / len(draft_angles), 2) if draft_angles else None

    logger.info(
        f"[draft_angle_geometry] pull={pull_axis_names[pull_axis_idx]} "
        f"total_wall={total} drafted={drafted_count} undrafted={undrafted_count} "
        f"undercut={undercut_count} parting_complexity={parting_complexity}"
    )

    return {
        "undrafted_face_count": undrafted_count,
        "drafted_face_count": drafted_count,
        "overdrafted_face_count": overdrafted_count,
        "undercut_face_count": undercut_count,
        "total_wall_face_count": total,
        "avg_draft_angle_deg": avg_draft,
        "parting_complexity": parting_complexity,
        "pull_axis": pull_axis_names[pull_axis_idx],
        "pull_axis_idx": pull_axis_idx,
        "draft_confidence": 0.65,
        # Internal: reused by Injection Molding's rib detection to avoid a second face scan.
        "_wall_face_planes": wall_face_planes,
        "_pull_axis_idx": pull_axis_idx,
        "_dfm_face_groups": {
            "undercut": undercut_dfm,
            "undrafted": undrafted_dfm,
            "_all_draft_faces": all_draft_faces_hm,
        },
    }
