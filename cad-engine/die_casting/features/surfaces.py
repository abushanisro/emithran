"""
Die Casting PlanarFace / CurvedWall / CurvedSurface / SharpEdge.

Pure face-type classification over whatever faces no other detector (Base
Properties' parting-line faces, SimpleHole/MultiStepHole's bores, Void's
ceiling faces) has already claimed -- no threshold needed, only the real
OCC surface type (BRepAdaptor_Surface.GetType()):
  GeomAbs_Plane                          -> PlanarFace
  GeomAbs_Cylinder / GeomAbs_Cone         -> CurvedWall (ruled, wall-like
                                             surfaces -- draft walls, fillets)
  GeomAbs_Sphere / GeomAbs_Torus / other  -> CurvedSurface (free-form/blend)

SharpEdge: shared/edge_length.sharp_edge_length(shape, detail=True) -- the
same real continuity-based sharp-edge detector Machining already uses,
additively extended (2026-10, this phase) with a per-edge list for 3D
highlighting; the aggregate-only callers are unaffected.

memory/Die Casting/Lookup/tblMinEdgeRadius.csv is used only to ANNOTATE a
measured sharp edge against the real per-material minimum -- it never
filters which edges get reported (every real sharp edge is disclosed).
Material is not yet chosen in Phase 1 (process routing is deferred), so this
phase reports the real measured edge only; the annotation is left to a later
phase once a material/process is known.
"""
from __future__ import annotations

from typing import Any, Dict, List, Set

from shared.edge_length import sharp_edge_length


def classify_surfaces(shape: Any, claimed_face_ids: Set[int]) -> Dict[str, Any]:
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_REVERSED  # type: ignore
    from OCC.Core.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore

    planar: List[Dict[str, Any]] = []
    curved_wall: List[Dict[str, Any]] = []
    curved_surface: List[Dict[str, Any]] = []

    face_idx = 0
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        if face_idx in claimed_face_ids:
            face_idx += 1
            explorer.Next()
            continue
        try:
            face = topods.Face(explorer.Current())
            adaptor = BRepAdaptor_Surface(face)
            surf_type = adaptor.GetType()
            props = GProp_GProps()
            brepgprop.SurfaceProperties(face, props)
            cog = props.CentreOfMass()
            occ = {
                "recognition_status": "recognized",
                "face_ids": [face_idx],
                "centroid_mm": [round(float(cog.X()), 3), round(float(cog.Y()), 3), round(float(cog.Z()), 3)],
                "area_mm2": round(props.Mass(), 3),
            }
            if surf_type == GeomAbs_Plane:
                occ["recognition_evidence"] = "planar face"
                # Tool axis (approach vector): the face's outward normal, the
                # plane axis flipped when the face is reversed in the solid.
                d = adaptor.Plane().Axis().Direction()
                sign = -1.0 if face.Orientation() == TopAbs_REVERSED else 1.0
                occ["tool_axis"] = [round(sign * float(d.X()), 6), round(sign * float(d.Y()), 6), round(sign * float(d.Z()), 6)]
                planar.append(occ)
            elif surf_type in (GeomAbs_Cylinder, GeomAbs_Cone):
                occ["recognition_evidence"] = "ruled (cylindrical/conical) wall-like face"
                curved_wall.append(occ)
            else:
                occ["recognition_evidence"] = "free-form/blend surface"
                curved_surface.append(occ)
        except Exception:
            pass
        face_idx += 1
        explorer.Next()

    edges = sharp_edge_length(shape, detail=True)

    all_claimed = set(claimed_face_ids)
    all_claimed |= {o["face_ids"][0] for o in planar}
    all_claimed |= {o["face_ids"][0] for o in curved_wall}
    all_claimed |= {o["face_ids"][0] for o in curved_surface}

    return {
        "planar_face_count": len(planar),
        "planar_face_candidates": planar,
        "curved_wall_count": len(curved_wall),
        "curved_wall_candidates": curved_wall,
        "curved_surface_count": len(curved_surface),
        "curved_surface_candidates": curved_surface,
        "sharp_edge_count": edges["sharp_edge_count"],
        "sharp_edge_length_mm": edges["sharp_edge_length_mm"],
        "sharp_edges": edges["edges"],
        "all_claimed_face_ids": all_claimed,
    }
