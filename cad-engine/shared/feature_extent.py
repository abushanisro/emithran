"""
Feature extent: the nominal size a tolerance on the feature is graded by.

ISO 286-1 grades a tolerance against the nominal size of the feature it is on.
A hole has one (its diameter, reported by the hole detectors). A face, a wall,
an edge or a void does not, so every feature_graph_v2 occurrence gets
`extent_mm`: the longest side of the oriented bounding box of its own faces,
and `extents_mm`: all three sides, longest first.
An oriented box (Bnd_OBB) does not depend on how the part sits in the model's
axes, unlike an axis-aligned box, which grows when a face is rotated.

Measured from the B-Rep faces the occurrence names (face_ids, the
TopExp_Explorer ordinals every detector uses), never from the part bounding
box. An occurrence whose faces cannot be measured gets no extent_mm.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

_LINEAR_DEFLECTION_MM = 0.1


def _faces_by_ordinal(shape: Any) -> List[Any]:
    from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore

    faces = []
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        faces.append(topods.Face(exp.Current()))
        exp.Next()
    return faces


def faces_extents_mm(faces: Iterable[Any]) -> Optional[List[float]]:
    """The three sides (mm, longest first) of the oriented bounding box around the given faces."""
    from OCC.Core.BRep import BRep_Builder  # type: ignore
    from OCC.Core.BRepBndLib import brepbndlib  # type: ignore
    from OCC.Core.Bnd import Bnd_OBB  # type: ignore
    from OCC.Core.TopoDS import TopoDS_Compound  # type: ignore

    faces = list(faces)
    if not faces:
        return None
    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    for f in faces:
        builder.Add(compound, f)
    # Built from the triangulation: the exact-geometry box is not tight on a
    # face with inner wires (an 80 mm face with cored holes measured 80.97).
    # The mesh is the same 0.1 mm deflection casting_geometry.py measures with;
    # an already meshed face is not re-meshed.
    from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh  # type: ignore
    BRepMesh_IncrementalMesh(compound, _LINEAR_DEFLECTION_MM, False, 0.5, True).Perform()
    obb = Bnd_OBB()
    brepbndlib.AddOBB(compound, obb, True, True, False)
    if obb.IsVoid():
        return None
    return sorted((2.0 * obb.XHSize(), 2.0 * obb.YHSize(), 2.0 * obb.ZHSize()), reverse=True)


def faces_extent_mm(faces: Iterable[Any]) -> Optional[float]:
    """Longest side (mm) of the oriented bounding box around the given faces."""
    sides = faces_extents_mm(faces)
    return sides[0] if sides else None


def annotate_occurrence_extents(shape: Any, features: Iterable[Dict[str, Any]]) -> None:
    """Add extent_mm to every occurrence of every feature_graph_v2 entry, in place."""
    try:
        faces = _faces_by_ordinal(shape)
    except Exception as e:  # pragma: no cover - only on a broken shape
        logger.warning(f"[feature_extent] face enumeration failed: {e}")
        return
    for group in features:
        for occ in group.get("occurrences", []) or []:
            ids = [i for i in (occ.get("face_ids") or []) if isinstance(i, int) and 0 <= i < len(faces)]
            if not ids:
                continue
            try:
                sides = faces_extents_mm(faces[i] for i in ids)
            except Exception as e:
                logger.warning(f"[feature_extent] extent failed for faces {ids[:5]}: {e}")
                continue
            if sides and sides[0] > 0:
                occ["extent_mm"] = round(sides[0], 3)
                # All three sides, longest first: a planar face's length and
                # width (its third side is ~0), what surface grinding is timed by.
                occ["extents_mm"] = [round(x, 3) for x in sides]
