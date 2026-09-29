"""
Face-coverage accounting for machining feature recognition.

Recognition is only as accurate as the part of the model it explains. This
module states that part exactly: every B-Rep face of the shape is either owned
by at least one recognized feature or listed as unclaimed, with its real
surface type and area. Faces owned by more than one feature are listed too --
each face should have exactly one owner, and a double claim means two
detectors disagree about the same geometry.

Face ids are TopExp_Explorer(shape, TopAbs_FACE) ordinals starting at 0, the
same convention every detector's `face_ids` and the STL face_map use.

Coverage is split in two. A face owned only by a generic surface region
(PlanarFace / CurvedWall / CurvedSurface -- face_classification.py's
catch-all for whatever no discrete detector claimed) is classified by surface
type, not recognized as a manufacturing feature; counting it as "explained"
would let the catch-all report 100% on any part. `discrete_*` counts only
faces owned by at least one discrete feature (hole, pocket, slot, groove, ...).

Nothing here decides what a face is; it only reports what the detectors did.
"""
from __future__ import annotations

from typing import Dict, Iterable, List, Sequence

# face_classification.py's catch-all surface regions: every face no discrete
# detector claimed lands in one of these by surface type alone.
GENERIC_REGION_TYPES = frozenset({"PlanarFace", "CurvedWall", "CurvedSurface"})

# GeomAbs_SurfaceType enum names, keyed by value, resolved lazily so importing
# this module does not require OCC.
_SURFACE_NAMES = (
    "Plane", "Cylinder", "Cone", "Sphere", "Torus", "BezierSurface",
    "BSplineSurface", "SurfaceOfRevolution", "SurfaceOfExtrusion",
    "OffsetSurface", "OtherSurface",
)


def _surface_name(geomabs_type) -> str:
    try:
        return _SURFACE_NAMES[int(geomabs_type)]
    except (ValueError, IndexError, TypeError):
        return "OtherSurface"


def enumerate_faces(shape) -> List[Dict]:
    """One entry per B-Rep face, in TopExp_Explorer order: id, surface type, area (mm^2)."""
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore

    out: List[Dict] = []
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    idx = 0
    while exp.More():
        face = topods.Face(exp.Current())
        props = GProp_GProps()
        brepgprop.SurfaceProperties(face, props)
        out.append({
            "face_id": idx,
            "surface_type": _surface_name(BRepAdaptor_Surface(face).GetType()),
            "area_mm2": round(props.Mass(), 3),
        })
        idx += 1
        exp.Next()
    return out


def account_face_coverage(
    faces: Sequence[Dict],
    features: Iterable,
) -> Dict:
    """
    Coverage of `faces` (from enumerate_faces) by `features` (objects with
    .id and .face_ids). Face ids outside the shape's range are ignored rather
    than counted, so a detector bug cannot inflate coverage.
    """
    valid = {f["face_id"] for f in faces}
    owners: Dict[int, List[str]] = {}
    discrete: set = set()
    for feat in features:
        is_generic = getattr(feat, "type", None) in GENERIC_REGION_TYPES
        for fid in set(feat.face_ids or []):
            if fid in valid:
                owners.setdefault(fid, []).append(feat.id)
                if not is_generic:
                    discrete.add(fid)

    unclaimed = [dict(f) for f in faces if f["face_id"] not in owners]
    multiply_claimed = [
        {"face_id": fid, "feature_ids": sorted(ids)}
        for fid, ids in sorted(owners.items())
        if len(ids) > 1
    ]
    total_area = sum(f["area_mm2"] for f in faces)
    claimed_area = sum(f["area_mm2"] for f in faces if f["face_id"] in owners)
    discrete_area = sum(f["area_mm2"] for f in faces if f["face_id"] in discrete)
    frac = (lambda a: round(a / total_area, 4) if total_area > 0 else None)
    return {
        "face_count": len(faces),
        "claimed_face_count": len(owners),
        "unclaimed_face_count": len(unclaimed),
        "claimed_area_fraction": frac(claimed_area),
        # Faces a discrete manufacturing feature owns (not the surface catch-all).
        "discrete_face_count": len(discrete),
        "discrete_area_fraction": frac(discrete_area),
        "unclaimed_faces": unclaimed,
        "multiply_claimed_faces": multiply_claimed,
    }
