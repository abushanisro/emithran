"""
2-Model Machining: a finished part (the target) machined from a source component (an as-cast or as-forged blank, its own model).

The two models must be in one coordinate frame, as a CAD assembly exports them; then:

  aligned               the target lies inside the source: its volume outside the source is within the tolerance the factory's
                        cadModelMisalignmentSensitivity (0 to 100, memory/2 Mold Molding) allows. Two models that are not aligned are
                        reported with how far apart they are, and nothing else is measured: an alignment is never guessed.
  as_supplied_face_ids  the target's faces lying on the source's boundary: left as the source made them (the catalog's "Source
                        Component: As Supplied"), not machined. A face only partly on it is machined.
  machined_face_ids     every other face of the target: what the machining makes.
  removed_volume_mm3    the source's volume less the target's: the metal machined off.

These are measurements only; which features are machined and what that costs is decided in the backend. Face ids are the target's
TopExp_Explorer order, the numbering of the target's own analysis, with each face's stable id beside it.
"""
from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional, Sequence

from injection_molding.recognition.mesh import FaceMesh, tessellate_faces
from shared.casting_geometry import _faces
from shared.stable_face_id import build_stable_face_id_map

logger = logging.getLogger(__name__)

VERSION = "two-model-1"

# The default misalignment sensitivity (cadModelMisalignmentSensitivity, memory/2 Mold Molding digital_factory_variables).
DEFAULT_SENSITIVITY = 82.0
# How much of the target may lie outside the source at sensitivity 0 (the most lenient): a tenth of its volume. At 100 nothing may.
# The data gives the sensitivity's scale (0-100), not its tolerance: the line from 10 % to 0 is this module's reading of it.
MAX_OUTSIDE_FRACTION = 0.10
# Sample points per face (the face's own mesh vertices, which lie on the exact surface).
SAMPLES_PER_FACE = 24


def solid_volume(shape: Any) -> float:
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore

    props = GProp_GProps()
    brepgprop.VolumeProperties(shape, props)
    return abs(float(props.Mass()))


def allowed_outside_fraction(sensitivity: float) -> float:
    """The share of the target's volume that may lie outside the source at a sensitivity of 0 (lenient) to 100 (strict)."""
    s = min(100.0, max(0.0, float(sensitivity)))
    return MAX_OUTSIDE_FRACTION * (100.0 - s) / 100.0


def outside_volume(target: Any, source: Any) -> float:
    """The target's volume outside the source (the target cut by the source)."""
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # type: ignore

    cut = BRepAlgoAPI_Cut(target, source)
    cut.Build()
    if not cut.IsDone():
        raise RuntimeError("the boolean cut of the target by the source failed")
    return solid_volume(cut.Shape())


def _bbox(shape: Any) -> List[float]:
    from OCC.Core.Bnd import Bnd_Box  # type: ignore
    from OCC.Core.BRepBndLib import brepbndlib  # type: ignore

    box = Bnd_Box()
    brepbndlib.Add(shape, box)
    return [round(v, 3) for v in box.Get()]


def _boundary(shape: Any) -> Any:
    """The shape's faces as one compound: a distance to it is a distance to the boundary, not 0 inside the solid."""
    from OCC.Core.BRep import BRep_Builder  # type: ignore
    from OCC.Core.TopoDS import TopoDS_Compound  # type: ignore

    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    for f in _faces(shape):
        builder.Add(compound, f)
    return compound


def _samples(mesh: FaceMesh, n: int) -> List[tuple]:
    """
    Up to n points of the face, each with how far it may lie off the exact surface: its mesh vertices (on the surface) and its triangles'
    centroids (inside the face, off a curved surface by at most the mesh deflection). Vertices alone are not enough: a hole's wall has
    them only on its two rims, which lie on the source's faces, so the wall would read as supplied.
    """
    vertices: Dict[tuple, Sequence[float]] = {}
    for t in mesh.triangles:
        for v in t.vertices:
            vertices.setdefault((round(v[0], 6), round(v[1], 6), round(v[2], 6)), v)
    centroids = [t.centroid for t in mesh.triangles]

    def spread(points: List[Sequence[float]], k: int) -> List[Sequence[float]]:
        if len(points) <= k:
            return points
        step = len(points) / k
        return [points[int(i * step)] for i in range(k)]

    half = max(1, n // 2)
    return [(p, False) for p in spread(list(vertices.values()), half)] + [(p, True) for p in spread(centroids, n - half)]


def as_supplied_faces(target: Any, source: Any, tol_mm: float, deflection: float) -> Dict[int, bool]:
    """For each target face (TopExp_Explorer order): True when all its sample points lie on the source's boundary within tol_mm."""
    from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakeVertex  # type: ignore
    from OCC.Core.BRepExtrema import BRepExtrema_DistShapeShape  # type: ignore
    from OCC.Core.gp import gp_Pnt  # type: ignore

    boundary = _boundary(source)
    out: Dict[int, bool] = {}
    for mesh in tessellate_faces(target, linear_deflection=deflection):
        points = _samples(mesh, SAMPLES_PER_FACE)
        if not points:
            out[mesh.index] = False
            continue
        on = True
        for p, interior in points:
            vertex = BRepBuilderAPI_MakeVertex(gp_Pnt(*p)).Vertex()
            dist = BRepExtrema_DistShapeShape(vertex, boundary)
            if not dist.IsDone() or dist.Value() > tol_mm + (deflection if interior else 0.0):
                on = False
                break
        out[mesh.index] = on
    return out


def compare_models(target: Any, source: Any, sensitivity: float = DEFAULT_SENSITIVITY) -> Dict[str, Any]:
    """The comparison of the finished part with its source component; see the module's docstring."""
    target_volume = solid_volume(target)
    source_volume = solid_volume(source)
    base: Dict[str, Any] = {
        "comparison_version": VERSION,
        "target_volume_mm3": round(target_volume, 3),
        "source_volume_mm3": round(source_volume, 3),
        "target_bbox": _bbox(target),
        "source_bbox": _bbox(source),
        "sensitivity": sensitivity,
    }
    if target_volume <= 0 or source_volume <= 0:
        return {**base, "aligned": False, "misalignment": "a model has no volume (not a closed solid)"}

    outside = outside_volume(target, source)
    allowed = allowed_outside_fraction(sensitivity)
    fraction = outside / target_volume
    base.update({"outside_volume_mm3": round(outside, 3), "outside_fraction": round(fraction, 6), "allowed_outside_fraction": round(allowed, 6)})
    if fraction > allowed:
        logger.info(f"[TwoModel] not aligned: {fraction:.4%} of the target outside the source (allowed {allowed:.4%})")
        return {
            **base, "aligned": False,
            "misalignment": (
                f"{fraction:.2%} of the finished part lies outside the source component (at most {allowed:.2%} at sensitivity {sensitivity:g}): "
                "the two models are not in one coordinate frame, or the source is not this part's blank. Export both from the same assembly."
            ),
        }

    diagonal = math.dist(base["target_bbox"][:3], base["target_bbox"][3:])
    deflection = max(0.05, diagonal * 0.001)
    tol = max(0.01, diagonal * 1e-5)
    supplied = as_supplied_faces(target, source, tol, deflection)
    stable: Dict[int, str] = {}
    try:
        stable = build_stable_face_id_map(target)
    except Exception as e:  # the ids only serve matching; the comparison stands without them
        logger.warning(f"[TwoModel] stable_face_id build failed: {e}")
    as_supplied = sorted(i for i, on in supplied.items() if on)
    machined = sorted(i for i, on in supplied.items() if not on)
    logger.info(f"[TwoModel] aligned: {len(as_supplied)} faces as supplied, {len(machined)} machined, removed {source_volume - target_volume:.1f} mm3")
    return {
        **base,
        "aligned": True,
        "misalignment": None,
        "face_tolerance_mm": round(tol, 4),
        "as_supplied_face_ids": as_supplied,
        "machined_face_ids": machined,
        "stable_face_ids": {str(i): s for i, s in stable.items()},
        "removed_volume_mm3": round(max(0.0, source_volume - target_volume), 3),
        "measurements": {
            "as_supplied": {"value": len(as_supplied), "unit": "faces", "method": "target faces on the source's boundary",
                            "occurrences": [{"face_ids": as_supplied}], "reconciles": True},
            "machined": {"value": len(machined), "unit": "faces", "method": "target faces not on the source's boundary",
                         "occurrences": [{"face_ids": machined}], "reconciles": True},
        },
    }
