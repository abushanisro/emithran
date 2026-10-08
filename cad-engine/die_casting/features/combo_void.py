"""
Die Casting Void / SlideBundle (ComboVoid deferred, see below).

Stage 1 candidate source: every real planar face whose normal has a
meaningful negative component along the part's own primary_setup_axis (faces
"backward" relative to the chosen pull direction, by more than
UNDERCUT_THRESHOLD_DEG), grouped into real connected components via
shared/face_adjacency.py's edge-adjacency (the same technique
sheet_metal/bend_relationships.py already uses). This is a deliberately
BROADER scan than shared/draft_angle_geometry.analyze_draft_angles's own
"wall face" classification -- that function excludes faces whose normal is
near-parallel/antiparallel to pull (|dot| > 0.259), which is correct for its
own thermoplastic-side-wall use case but would wrongly exclude a flat
horizontal ceiling/ overhang facing directly opposite the pull direction --
exactly the shape of the most common real die-casting undercut (a tunnel,
window, or boss on the underside of an overhang). This is only a CANDIDATE
either way: the angle test alone cannot tell whether the face is truly
unreachable, or whether it simply belongs to the mold/die's OTHER half (which
recedes in the opposite direction) -- draft_angle_geometry's own long-standing
comment names exactly this ambiguity; the real ray-cast below (Stage 2) is
what actually resolves it, so Stage 1 only needs to be a wide, honest net.

Stage 2 (real positive evidence, never a tuned angle): a real ray-cast
(OCC.Core.IntCurvesFace.IntCurvesFace_ShapeIntersector) from each candidate
component's centroid along BOTH +primary_setup_axis and -primary_setup_axis
(the only two directions a basic 2-plate die can retreat along). A component
that is blocked by the part's own solid material in EVERY direction a mold
half could retreat is genuinely unreachable by a straight pull -- "Void",
recognized. A component whose ray escapes cleanly in at least one direction
is reachable by that mold half after all (the Stage-1 angle flag was a false
positive for the OTHER half, exactly as draft_angle_geometry's own undercut
comment describes) and is correctly discarded here, not reported as a
feature.

SlideBundle: every recognized Void this phase is, by construction, tested
only against the same two directions (+/-primary_setup_axis), so Phase 1
cannot yet distinguish genuinely different slide/core retraction angles --
every recognized Void is reported as members of one SlideBundle. Finer
slide grouping (by each void's own real escape-ray direction, not just
+/-primary_setup_axis) is deferred, disclosed here rather than faked.

ComboVoid (a cavity combining a straight-pull-reachable pocket and a
side-action undercut in one contiguous region) is explicitly NOT detected
this phase: Stage 1's candidate set is built only from undercut-flagged
faces, which by construction excludes the straight-pull-reachable floor/
walls a real ComboVoid would also need grouped in. Building that needs
whole-cavity grouping (floor + walls together), not just undercut-face
grouping -- a real, disclosed gap, not a fabricated heuristic.

No memory/Die Casting/Lookup/*.csv threshold is needed here -- pure topology
plus a real ray intersection.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import math

from shared.face_adjacency import build_edge_face_adjacency

_AXIS_NAMES = ["x", "y", "z"]

# Same generic back-angle ceiling as base_properties.py (no distinct die-casting
# source gives a different generic value) -- a face whose normal opposes the
# pull direction by more than this many degrees is a real Stage-1 candidate.
UNDERCUT_THRESHOLD_DEG = 5.0


def _axis_index(axis: List[float]) -> int:
    return max(range(3), key=lambda i: abs(axis[i]))


def _backward_facing_planar_faces(shape: Any, pull: Tuple[float, float, float]) -> Dict[int, Tuple[float, float, float]]:
    """Every real planar face whose normal faces meaningfully backward
    relative to `pull` (dot < -sin(UNDERCUT_THRESHOLD_DEG)), by real OCC
    global face ordinal -> centroid. No wall-face-angle exclusion -- a flat
    ceiling facing directly opposite pull is included, unlike
    draft_angle_geometry's own wall-face-only scan (see module docstring)."""
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_REVERSED  # type: ignore
    from OCC.Core.GeomAbs import GeomAbs_Plane  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore

    threshold = -math.sin(math.radians(UNDERCUT_THRESHOLD_DEG))
    result: Dict[int, Tuple[float, float, float]] = {}
    face_idx = 0
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        try:
            face = topods.Face(explorer.Current())
            adaptor = BRepAdaptor_Surface(face)
            if adaptor.GetType() == GeomAbs_Plane:
                n = adaptor.Plane().Axis().Direction()
                nx, ny, nz = float(n.X()), float(n.Y()), float(n.Z())
                mag = math.sqrt(nx * nx + ny * ny + nz * nz)
                if mag > 1e-9:
                    nx, ny, nz = nx / mag, ny / mag, nz / mag
                    # BRepAdaptor_Surface.Plane() reports the underlying Geom_Plane's own
                    # canonical direction, NOT the face's true outward-facing normal -- a
                    # REVERSED TopoDS_Face has its real outward normal flipped relative to
                    # that canonical direction. Without this correction, two parallel faces
                    # on opposite sides of a cavity (e.g. a tunnel's floor and ceiling) can
                    # both report the SAME canonical normal despite facing opposite real
                    # directions (confirmed empirically building this module's own tests).
                    if face.Orientation() == TopAbs_REVERSED:
                        nx, ny, nz = -nx, -ny, -nz
                    dot = nx * pull[0] + ny * pull[1] + nz * pull[2]
                    if dot < threshold:
                        props = GProp_GProps()
                        brepgprop.SurfaceProperties(face, props)
                        cog = props.CentreOfMass()
                        result[face_idx] = (float(cog.X()), float(cog.Y()), float(cog.Z()))
        except Exception:
            pass
        face_idx += 1
        explorer.Next()
    return result


def _ray_escapes(shape: Any, origin: Tuple[float, float, float], direction: Tuple[float, float, float], max_dist: float) -> bool:
    """True when a ray from `origin` along `direction` reaches `max_dist`
    without hitting any face of `shape` -- i.e. a real, unobstructed escape
    path for a straight-pulling mold/die half. A small positive pinf keeps the
    ray from immediately re-intersecting the face it originates from."""
    from OCC.Core.IntCurvesFace import IntCurvesFace_ShapeIntersector  # type: ignore
    from OCC.Core.gp import gp_Lin, gp_Pnt, gp_Dir  # type: ignore

    intersector = IntCurvesFace_ShapeIntersector()
    intersector.Load(shape, 1e-6)
    line = gp_Lin(gp_Pnt(*origin), gp_Dir(*direction))
    intersector.Perform(line, 0.5, max_dist)
    if not intersector.IsDone():
        return False  # cannot prove escape -- treat as blocked, never a guessed pass
    return intersector.NbPnt() == 0


def detect_voids(
    shape: Any,
    bbox_dims: List[float],
    primary_setup_axis: Optional[List[float]],
) -> Dict[str, Any]:
    if not primary_setup_axis:
        return {
            "void_count": 0, "void_candidates": [],
            "combo_void_count": 0, "combo_void_candidates": [],
            "slide_bundle_count": 0, "slide_bundle_candidates": [],
            "claimed_face_ids": [],
            "note": "no primary_setup_axis recognized -- void/slide detection needs a real pull direction to test against",
        }

    axis_idx = _axis_index(primary_setup_axis)
    pull = tuple(primary_setup_axis)
    centroid_by_id = _backward_facing_planar_faces(shape, pull)
    if not centroid_by_id:
        return {
            "void_count": 0, "void_candidates": [],
            "combo_void_count": 0, "combo_void_candidates": [],
            "slide_bundle_count": 0, "slide_bundle_candidates": [],
            "claimed_face_ids": [],
        }

    undercut_face_ids = set(centroid_by_id.keys())

    _faces, adjacency = build_edge_face_adjacency(shape)

    # Connected components, restricted to undercut-flagged faces only.
    visited: set = set()
    components: List[List[int]] = []
    for fid in undercut_face_ids:
        if fid in visited:
            continue
        stack = [fid]
        comp: List[int] = []
        visited.add(fid)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for nb in adjacency.get(cur, set()):
                if nb in undercut_face_ids and nb not in visited:
                    visited.add(nb)
                    stack.append(nb)
        components.append(comp)

    max_dist = 2.0 * max(bbox_dims) if bbox_dims and max(bbox_dims) > 0 else 1000.0
    direction_pos = tuple(primary_setup_axis)
    direction_neg = tuple(-v for v in primary_setup_axis)

    void_candidates: List[Dict[str, Any]] = []
    for comp in components:
        pts = [centroid_by_id[fid] for fid in comp if fid in centroid_by_id]
        if not pts:
            continue
        origin = tuple(sum(p[i] for p in pts) / len(pts) for i in range(3))

        escapes_pos = _ray_escapes(shape, origin, direction_pos, max_dist)
        escapes_neg = _ray_escapes(shape, origin, direction_neg, max_dist)
        if escapes_pos or escapes_neg:
            # Reachable by at least one mold/die half's straight pull -- the
            # Stage-1 angle flag was a false positive for that half; this is
            # not a real feature.
            continue

        void_candidates.append({
            "recognition_status": "recognized",
            "recognition_evidence": (
                f"ray cast from component centroid along +/-{_AXIS_NAMES[axis_idx]} "
                f"(the part's own primary pull axis) is blocked by solid material "
                f"in both directions -- unreachable by either mold/die half's straight pull"
            ),
            "face_ids": comp,
            "centroid_mm": [round(v, 3) for v in origin],
            "retraction_axis_name": _AXIS_NAMES[axis_idx],
        })

    slide_bundle_candidates: List[Dict[str, Any]] = []
    if void_candidates:
        slide_bundle_candidates.append({
            "recognition_status": "recognized",
            "recognition_evidence": (
                f"{len(void_candidates)} recognized Void occurrence(s) sharing the same "
                f"tested retraction axis ({_AXIS_NAMES[axis_idx]}) -- Phase 1 tests only "
                f"+/-primary_setup_axis, so finer per-void retraction-direction grouping "
                f"is not yet distinguished (disclosed gap, see module docstring)"
            ),
            "member_count": len(void_candidates),
            "retraction_axis_name": _AXIS_NAMES[axis_idx],
            # The faces the slide forms (its member voids), so the bundle gets
            # a measured extent (shared/feature_extent.py) to size the slide.
            "face_ids": sorted({fid for v in void_candidates for fid in v["face_ids"]}),
            "centroid_mm": [
                round(sum(v["centroid_mm"][i] for v in void_candidates) / len(void_candidates), 3) for i in range(3)
            ],
        })

    claimed = [fid for v in void_candidates for fid in v["face_ids"]]
    return {
        "void_count": len(void_candidates),
        "void_candidates": void_candidates,
        # ComboVoid deliberately not detected this phase -- see module docstring.
        "combo_void_count": 0,
        "combo_void_candidates": [],
        "slide_bundle_count": len(slide_bundle_candidates),
        "slide_bundle_candidates": slide_bundle_candidates,
        "claimed_face_ids": claimed,
    }
