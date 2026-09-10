"""
Formed-feature (dimple/emboss) RECOGNITION — the positive test forming_spike.py
was missing.

WHY THIS EXISTS

forming_spike.py's own honest finding: a genuine formed dimple and an ordinary
shallow blind hole (e.g. an undersized tapped-hole pilot bore) produce the
IDENTICAL cylinder-candidate shape (kind='blind_hole', a thickness-relative
depth) -- nothing in that candidate's own data distinguishes "material
displaced" from "material removed". That module names the missing signal
explicitly: "confirmation of a genuine paired offset-wall structure".

THE SIGNAL, AND WHY IT IS REAL TOPOLOGY, NOT A GUESSED THRESHOLD

A blind hole (material REMOVED) leaves the sheet's OPPOSITE face completely
untouched: the panel's back planar face is one single, uninterrupted surface
at that XY location. A genuine dimple/emboss (material DISPLACED by a punch)
moves material on BOTH faces at once: the back face is no longer flat there
either -- a physically separate face (the back side of the same displaced
patch) occupies that footprint, which shows up in the B-Rep as an INNER WIRE
(a hole) in the back panel's own face boundary, at the same XY position as the
front cavity.

So the question this module answers is purely topological: does the sheet's
BACK planar face (the one antiparallel to `dominant_face`, ~sheet_thickness
away -- the exact pairing _identify_panels already performs, just scoped here
to the one face we need instead of the whole panel list it discards the
pairing to build) have its own local void at the candidate's footprint? If
yes, the material there was worked from both sides -- a real, confident
'recognized' detection. If no, the back is flat and undisturbed -- a real
'ambiguous' (stays exactly as forming_spike.py already reports it).

WHAT THIS DELIBERATELY DOES NOT DO

It does not extend forming_spike.py's own candidate scope (cylindrical blind
cavities, depth 0.2-0.9x thickness). A genuinely DEEP formed feature (depth >
1x thickness, the more common real dimple/boss) is architecturally out of
reach of the same reason forming_spike.py already gave: `_collect_cylinders`
only classifies a face as 'blind_hole' up to the through-hole boundary, and a
deep paired-offset structure does not present as a simple cylindrical blind
cavity at all. This module promotes candidates WITHIN that existing scope from
'ambiguous' to 'recognized' when the back-void evidence is present; it does
not claim to solve formed-feature detection generally.

It does not attempt cones, elongated beads, or louvers -- same scope
limitation forming_spike.py already disclosed (cylindrical candidates only).

SOURCED CLASSIFICATION, NOT A RECOGNITION GATE

Once a candidate is confidently 'recognized' by the topological test above,
its depth is classified against real reference-data multipliers (licensed
source, staged at memory/sheetmetal/sheet_metal_variables.json -- NOT
fabricated, and NOT used to decide recognition, only to describe an
already-confirmed feature):
  - shallowEmbossDepthMultiplier = 1   -> `is_shallow` at depth <= 1x thickness
  - deepDimpleMultiplier          = 4   -> `exceeds_typical_dimple_depth` at
    depth > 4x thickness (always False today: forming_spike.py's own depth
    ceiling of 0.9x thickness is already far inside this bound, so the field
    is honest but currently inert -- kept for when the deep case above is
    ever built, not deleted as dead code).
"""

import math
from typing import Any, Dict, List, Optional, Tuple

from sheet_metal.features.forming_spike import detect_candidate_formed_features

# Sourced from memory/sheetmetal/sheet_metal_variables.json (real licensed
# reference data). Classification labels only -- see module docstring.
SHALLOW_EMBOSS_DEPTH_MULTIPLE = 1.0
DEEP_DIMPLE_MAX_DEPTH_MULTIPLE = 4.0

# Same tolerance _identify_panels already uses to pair antiparallel planar
# faces ~sheet_thickness apart -- reused, not reinvented.
_PANEL_PAIR_TOL_ABSOLUTE_MM = 0.15
_PANEL_PAIR_TOL_THICKNESS_MULTIPLE = 0.15


def _find_back_face(shape: Any, dominant_face: Any, sheet_thickness_mm: float) -> Optional[Any]:
    """
    The planar face antiparallel to `dominant_face`, ~sheet_thickness_mm away
    -- the physical back of the SAME panel `dominant_face` is the front of.

    Exactly `_identify_panels`' own antiparallel-pair-at-thickness technique
    (same tolerance formula, same forward/reversed-orientation normal fix),
    scoped to just this one face's partner. Not a change to that shared
    function -- it deliberately keeps only ONE representative face per pair
    and discards the other, which is exactly the face object this module
    needs.
    """
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_FORWARD  # type: ignore
    from OCC.Core.GeomAbs import GeomAbs_Plane  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore

    if sheet_thickness_mm <= 0 or dominant_face is None:
        return None

    dom_adaptor = BRepAdaptor_Surface(dominant_face)
    if dom_adaptor.GetType() != GeomAbs_Plane:
        return None
    dom_plane = dom_adaptor.Plane()
    dn = dom_plane.Axis().Direction()
    dnx, dny, dnz = float(dn.X()), float(dn.Y()), float(dn.Z())
    if dominant_face.Orientation() != TopAbs_FORWARD:
        dnx, dny, dnz = -dnx, -dny, -dnz
    dloc = dom_plane.Location()
    d_dom = dnx * float(dloc.X()) + dny * float(dloc.Y()) + dnz * float(dloc.Z())

    tol = max(_PANEL_PAIR_TOL_ABSOLUTE_MM, sheet_thickness_mm * _PANEL_PAIR_TOL_THICKNESS_MULTIPLE)

    best_face, best_area = None, 0.0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = topods.Face(exp.Current())
        try:
            if not face.IsSame(dominant_face):
                adaptor = BRepAdaptor_Surface(face)
                if adaptor.GetType() == GeomAbs_Plane:
                    plane = adaptor.Plane()
                    n = plane.Axis().Direction()
                    nx, ny, nz = float(n.X()), float(n.Y()), float(n.Z())
                    if face.Orientation() != TopAbs_FORWARD:
                        nx, ny, nz = -nx, -ny, -nz
                    dot = dnx * nx + dny * ny + dnz * nz
                    if dot <= -0.92:
                        ploc = plane.Location()
                        d_j = nx * float(ploc.X()) + ny * float(ploc.Y()) + nz * float(ploc.Z())
                        if abs(abs(d_dom + d_j) - sheet_thickness_mm) <= tol:
                            props = GProp_GProps()
                            brepgprop.SurfaceProperties(face, props)
                            area = props.Mass()
                            if area > best_area:
                                best_area = area
                                best_face = face
        except Exception:
            pass
        exp.Next()
    return best_face


def _back_face_has_local_void(
    back_face: Any,
    candidate_centroid_mm: Tuple[float, float, float],
    candidate_radius_mm: float,
) -> bool:
    """
    True if `back_face`'s own boundary has an INNER wire (a hole in this face
    -- a different face occupies that spot) whose bounding box overlaps the
    candidate's own circular footprint.

    Wire index 0 = outer boundary, every wire after it = an inner wire (a
    hole) -- the exact convention `_face_breakdown` already uses in
    feature_extractor.py for the same face/wire enumeration, reused here
    rather than reinvented.

    The overlap test itself is literal circle-vs-bbox overlap (candidate
    radius + the void's own half-diagonal) -- not a tuned multiplier, just
    "do these two footprints occupy the same space".
    """
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_WIRE  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore
    from OCC.Core.Bnd import Bnd_Box  # type: ignore
    from OCC.Core.BRepBndLib import brepbndlib  # type: ignore

    cx, cy, cz = candidate_centroid_mm
    we = TopExp_Explorer(back_face, TopAbs_WIRE)
    wire_idx = 0
    while we.More():
        if wire_idx > 0:
            try:
                wire = topods.Wire(we.Current())
                box = Bnd_Box()
                brepbndlib.Add(wire, box)
                xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
                wx = (xmin + xmax) / 2.0
                wy = (ymin + ymax) / 2.0
                wz = (zmin + zmax) / 2.0
                half_diag = math.sqrt((xmax - xmin) ** 2 + (ymax - ymin) ** 2 + (zmax - zmin) ** 2) / 2.0
                dist = math.sqrt((wx - cx) ** 2 + (wy - cy) ** 2 + (wz - cz) ** 2)
                if dist <= candidate_radius_mm + half_diag:
                    return True
            except Exception:
                pass
        wire_idx += 1
        we.Next()
    return False


def detect_formed_features(
    shape: Any,
    dominant_face: Any,
    bbox_minmax: Dict[str, float],
    sheet_thickness_mm: float,
    known_hole_centroids_mm: Optional[List[Tuple[float, float, float]]] = None,
) -> List[Dict[str, Any]]:
    """
    Real-OCC entry point. Reuses forming_spike.py's candidate discovery
    unchanged, then promotes a candidate to 'recognized' when the sheet's
    back face has its own local void at that candidate's footprint -- see
    module docstring for why that is real topological evidence, not a guess.

    A candidate stays 'ambiguous' (exactly forming_spike.py's existing,
    honest result) when no back face can be found, or when the back face is
    flat and undisturbed at that location.
    """
    candidates = detect_candidate_formed_features(
        shape, dominant_face, bbox_minmax, sheet_thickness_mm, known_hole_centroids_mm,
    )
    if not candidates:
        return candidates

    back_face = _find_back_face(shape, dominant_face, sheet_thickness_mm)
    if back_face is None:
        return candidates

    for c in candidates:
        radius_mm = c["diameter_mm"] / 2.0
        if _back_face_has_local_void(back_face, tuple(c["centroid_mm"]), radius_mm):
            c["recognition_status"] = "recognized"
            c["recognition_evidence"] = (
                "the sheet's opposite face has its own local void at this footprint -- "
                "material was displaced on both faces (a real paired offset-wall "
                "structure), not merely removed from the front alone"
            )
            depth_to_t = c["depth_to_thickness_ratio"]
            c["is_shallow"] = depth_to_t <= SHALLOW_EMBOSS_DEPTH_MULTIPLE
            c["exceeds_typical_dimple_depth"] = depth_to_t > DEEP_DIMPLE_MAX_DEPTH_MULTIPLE

    return candidates


def count_recognized(candidates: List[Dict[str, Any]]) -> int:
    """Confident detections only -- 'ambiguous' candidates are never counted."""
    return sum(1 for c in candidates if c.get("recognition_status") == "recognized")
