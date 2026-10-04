"""
Die Casting SimpleHole / MultiStepHole.

Stage 1 candidate source: shared/machining_geometry.collect_cylinders — the
same domain-agnostic cylinder collector Sheet Metal already reuses (imported
from shared/, never from the machining package, so Die Casting gains no
Machining dependency). Its kind classification (through_hole / blind_hole,
via a real envelope-span test) IS the real Stage-2 evidence for a plain
SimpleHole — not re-guessed here.

MultiStepHole: shared/machining_geometry.detect_multistep_holes groups
coaxial bores and rejects any group whose diameters are not strictly
monotonic (a real tie means it is not one genuine tapered sequence) — that
rejection IS its own Stage-2 test, run before any bore is considered a plain
SimpleHole (per detect_multistep_holes' own docstring: must run first so a
genuine 3-step hole is never also reported as overlapping 2-way pairs).

Real sourced threshold used: memory/Die Casting/Lookup/tblDTCLimits.csv's one
generic (process "Other", i.e. material/process-agnostic) blind-hole L/D
ceiling of 2.00 — the only Die Casting hole threshold that does not first
require a material/process choice (every other Lookup table is split by
Material Type and/or Process Name, which Phase 1 deliberately does not
select; see the Die Casting Phase 1 plan's "Explicitly out of scope"). This
Phase 1 annotates the real measured L/D against that one generic ceiling as
a disclosed fact, never a pass/fail verdict.

Not yet implemented in this phase (disclosed, not silently dropped): Ring and
RingedHole, also real catalog feature types, are deferred — any geometry that
would need them is left to fall through to NotSupported this phase.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from shared.machining_geometry import collect_cylinders, detect_multistep_holes, part_bounding_box

# memory/Die Casting/Lookup/tblDTCLimits.csv: Process="Other" (generic, not
# material/process-specific), Name="Blind Hole LD Ratio", Limit=2.00.
BLIND_HOLE_LD_CEILING = 2.00


class _BoreStub:
    """Minimal duck-typed object matching what detect_counterbores/
    detect_multistep_holes expect (.id/.params/.face_ids) — plain data, no
    Machining-package class."""

    __slots__ = ("id", "params", "face_ids")

    def __init__(self, id_: str, params: Dict[str, Any], face_ids: List[int]):
        self.id = id_
        self.params = params
        self.face_ids = face_ids


def detect_holes(
    shape: Any,
    bbox_minmax: Optional[Dict[str, float]],
    primary_setup_axis: Optional[List[float]],
) -> Dict[str, Any]:
    main_axis: Tuple[float, float, float] = (
        tuple(primary_setup_axis) if primary_setup_axis else (0.0, 0.0, 1.0)
    )
    bbox = bbox_minmax if bbox_minmax else part_bounding_box(shape)
    cylinders = collect_cylinders(shape, main_axis, bbox)
    bores = [c for c in cylinders if c["kind"] in ("through_hole", "blind_hole")]

    bore_features: List[_BoreStub] = []
    bore_id_to_cyl: Dict[str, Dict] = {}
    for idx, cyl in enumerate(bores):
        fid = f"dc_bore_{idx}"
        diameter_mm = round(cyl["radius"] * 2.0, 3)
        depth_mm = round(cyl["length"], 3)
        bore_features.append(_BoreStub(
            fid, {"diameter_mm": diameter_mm, "depth_mm": depth_mm}, list(cyl.get("face_indices", [])),
        ))
        bore_id_to_cyl[fid] = cyl

    # MultiStepHole groups FIRST (detect_multistep_holes' own tie-rejection is
    # its Stage-2 test) -- claimed bores are excluded from the plain-hole pass.
    multistep_groups = detect_multistep_holes(bore_features, bore_id_to_cyl)
    claimed_ids = {bid for ids, _params in multistep_groups for bid in ids}

    multi_step_hole_candidates: List[Dict[str, Any]] = []
    for ids, params in multistep_groups:
        centroid = params.get("centroid")
        multi_step_hole_candidates.append({
            "recognition_status": "recognized",
            "recognition_evidence": (
                f"{params['step_count']} coaxial bores, strictly monotonic diameters "
                f"{[s['diameter_mm'] for s in params['steps']]}"
            ),
            "member_bore_ids": ids,
            "face_ids": params.get("face_ids", []),
            "centroid_mm": list(centroid) if centroid else None,
            "steps": params["steps"],
            "step_count": params["step_count"],
            "max_diameter_mm": max(s["diameter_mm"] for s in params["steps"]),
            "min_diameter_mm": min(s["diameter_mm"] for s in params["steps"]),
            "monotonic": True,
        })

    simple_hole_candidates: List[Dict[str, Any]] = []
    for bore in bore_features:
        if bore.id in claimed_ids:
            continue
        cyl = bore_id_to_cyl[bore.id]
        is_through = cyl["kind"] == "through_hole"
        diameter_mm = bore.params["diameter_mm"]
        depth_mm = bore.params["depth_mm"]
        ld_ratio = round(depth_mm / diameter_mm, 2) if diameter_mm > 0 else None
        occ: Dict[str, Any] = {
            "recognition_status": "recognized",
            "recognition_evidence": (
                "through-hole: envelope broken on both ends" if is_through
                else "blind hole: real distinct floor face"
            ),
            "face_ids": bore.face_ids,
            "centroid_mm": list(cyl["centroid"]),
            # Unit direction of the bore axis: with the centroid it locates the
            # axis line (hole-to-hole wall thickness for castability).
            "axis": [round(v, 6) for v in cyl["axis"]],
            "diameter_mm": diameter_mm,
            "depth_mm": depth_mm,
            "ld_ratio": ld_ratio,
            "blind": not is_through,
            "variant": "through" if is_through else "blind",
        }
        if not is_through and ld_ratio is not None:
            occ["exceeds_blind_hole_ld_ceiling"] = ld_ratio > BLIND_HOLE_LD_CEILING
            occ["blind_hole_ld_ceiling"] = BLIND_HOLE_LD_CEILING
        occ.update(_hole_tool_axis(shape, bore.face_ids, cyl["axis"], depth_mm, is_through))
        simple_hole_candidates.append(occ)

    return {
        "simple_hole_candidates": simple_hole_candidates,
        "simple_hole_count": len(simple_hole_candidates),
        "multi_step_hole_candidates": multi_step_hole_candidates,
        "multi_step_hole_count": len(multi_step_hole_candidates),
        # Every bore's own face ids -- the base extractor subtracts this set
        # when building the NotSupported bucket.
        "claimed_face_ids": [fid for b in bore_features for fid in b.face_ids],
    }


def _hole_tool_axis(shape: Any, face_ids: List[int], axis, depth_mm: float, is_through: bool) -> Dict[str, Any]:
    """Tool axis of a hole (feature_graph_v2 contract, setup-axis-rule.ts):
    a through hole is reachable from either end (bidirectional, along its
    axis); a blind hole only from its open end. The open end is the one a ray
    from the hole centre along the axis leaves without meeting a face within
    half the depth (the other end meets the real floor face). Neither or both
    ends open on a blind hole: no single tool axis, so none is given."""
    ax = [float(v) for v in axis]
    if is_through:
        return {"tool_axis": [round(v, 6) for v in ax], "tool_axis_bidirectional": True}
    centroid = _faces_centroid(shape, face_ids)
    if centroid is None:
        return {}
    reach = depth_mm / 2.0 + 1.0
    open_pos = _clear_within(shape, centroid, ax, reach)
    open_neg = _clear_within(shape, centroid, [-v for v in ax], reach)
    if open_pos == open_neg:
        return {}
    d = ax if open_pos else [-v for v in ax]
    return {"tool_axis": [round(v, 6) for v in d], "tool_axis_bidirectional": False}


def _clear_within(shape: Any, origin, direction, dist: float) -> bool:
    """True when a ray from `origin` along `direction` meets no face of
    `shape` within `dist` mm."""
    from OCC.Core.IntCurvesFace import IntCurvesFace_ShapeIntersector  # type: ignore
    from OCC.Core.gp import gp_Lin, gp_Pnt, gp_Dir  # type: ignore

    intersector = IntCurvesFace_ShapeIntersector()
    intersector.Load(shape, 1e-6)
    intersector.Perform(gp_Lin(gp_Pnt(*[float(v) for v in origin]), gp_Dir(*direction)), 1e-3, dist)
    return bool(intersector.IsDone()) and intersector.NbPnt() == 0


def _faces_centroid(shape: Any, face_ids: List[int]):
    """Area centroid of the bore faces: on the hole axis, halfway along it."""
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore

    wanted = set(face_ids)
    if not wanted:
        return None
    props = GProp_GProps()
    idx = 0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        if idx in wanted:
            brepgprop.SurfaceProperties(exp.Current(), props)
        idx += 1
        exp.Next()
    if props.Mass() <= 0:
        return None
    c = props.CentreOfMass()
    return (c.X(), c.Y(), c.Z())
