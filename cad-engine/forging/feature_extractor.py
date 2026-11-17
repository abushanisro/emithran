"""
What a closed-die forging's cost and manufacturability rest on, measured from the solid.

A closed-die forging is pressed between two die halves that close along one direction (the die direction). Everything here follows from that
direction:

  die_direction         the direction the dies close along: the one that leaves the least surface covered from its own die half (an undercut cannot
                        be forged), and of equal ones the one with the larger projected area. The engineer's own direction is used when given.
  projected_area_mm2    the part's outline on the parting plane: with the flow stress it sets the forging load.
  parting_perimeter_mm  the length of that outline: flash forms along it, and the trim die shears along it.
  die_depth_mm          the part's extent along the die direction: how deep the two impressions are together.
  plan                  the long and cross directions of the part in the parting plane and its extent along each: the bar lies along the long one.
  section_profile       the cross-section area at stations along the long direction (shared.section_profile): the bar size and how the metal has
                        to be distributed before the finishing blow.
  draft                 per face, the angle its wall makes with the die direction, and how much of it is covered (undercut).
  section_thickness     per face, the thickness of the metal behind it (largest ball that fits): thin webs and ribs chill and do not fill.
  holes                 holes with their angle to the die direction: one along it can be pierced, any other is machined.
  radii                 fillets (inside corners) and corners (outside corners) with their radius, and the sharp edges that have none.
  trapped_volumes       air closed in by metal on both sides along the die direction: no die half can form it.

These are measurements only. Which draft, radius or thickness is acceptable, what can be pierced and what the forging costs are decided in the
backend from the staged forging reference data; this module holds no such limit. Every number comes from functions the molding and casting
analyses already use; nothing is re-implemented here except the plan directions and the radii.
"""
from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from injection_molding.recognition.draft import analyze_draft
from injection_molding.recognition.holes import FULL_SWEEP_DEG, cylinders, recognize_holes
from injection_molding.recognition.mesh import FaceMesh, tessellate_faces
from injection_molding.recognition.parting import parting_line
from injection_molding.recognition.pull_direction import choose_pull_direction
from injection_molding.recognition.vec import Vec, cross, dot, scale, sub, unit
from injection_molding.recognition.wall_thickness import measure_wall_thickness
from shared.casting_geometry import _faces, parting_plane_silhouette
from shared.core_geometry import trapped_cores
from shared.edge_length import sharp_edge_length
from shared.section_profile import section_area_profile
from shared.stable_face_id import build_stable_face_id_map

logger = logging.getLogger(__name__)

VERSION = "forging_measurements_v1"
# Geometric, not a design rule: a surface within this of parallel to the die direction is a side wall (it is neither facing a die half nor covered).
# The same number the molding and casting analyses use for the same question.
SIDE_WALL_DEG = 0.3


def plan_directions(meshes: Sequence[FaceMesh], die: Vec) -> Dict[str, Any]:
    """
    The part's long and cross directions in the parting plane (the principal directions of its surface, area-weighted, seen along the die direction)
    and its extent along each. A part as long as it is wide (a disc, a square) has no long direction: the two extents are then equal and either
    direction serves.
    """
    die = unit(die)
    helper = (1.0, 0.0, 0.0) if abs(die[0]) < 0.9 else (0.0, 1.0, 0.0)
    e1 = unit(cross(die, helper))
    e2 = cross(die, e1)
    tris = [t for f in meshes for t in f.triangles]
    total = sum(t.area for t in tris)
    if total <= 0:
        return {"long_axis": None, "cross_axis": None, "length_mm": 0.0, "width_mm": 0.0}
    mu = sum(dot(t.centroid, e1) * t.area for t in tris) / total
    mv = sum(dot(t.centroid, e2) * t.area for t in tris) / total
    suu = sum((dot(t.centroid, e1) - mu) ** 2 * t.area for t in tris)
    svv = sum((dot(t.centroid, e2) - mv) ** 2 * t.area for t in tris)
    suv = sum((dot(t.centroid, e1) - mu) * (dot(t.centroid, e2) - mv) * t.area for t in tris)
    theta = 0.5 * math.atan2(2.0 * suv, suu - svv)  # the direction of largest spread
    a = unit((e1[0] * math.cos(theta) + e2[0] * math.sin(theta), e1[1] * math.cos(theta) + e2[1] * math.sin(theta), e1[2] * math.cos(theta) + e2[2] * math.sin(theta)))
    b = cross(die, a)

    def extent(axis: Vec) -> float:
        values = [dot(v, axis) for t in tris for v in t.vertices]
        return max(values) - min(values)

    ea, eb = extent(a), extent(b)
    long_axis, cross_axis, length, width = (a, b, ea, eb) if ea >= eb else (b, a, eb, ea)
    return {
        "long_axis": [round(c, 5) for c in long_axis], "cross_axis": [round(c, 5) for c in cross_axis],
        "length_mm": round(length, 3), "width_mm": round(width, 3),
    }


def _torus_radii(shape: Any, meshes: Sequence[FaceMesh]) -> List[Dict[str, Any]]:
    """Each torus face (a blend swept round a curved edge) with its tube radius, and whether the metal is inside the tube (a corner) or outside it (a fillet)."""
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore

    torus_meshes = {f.index: f for f in meshes if f.surface == "torus"}
    if not torus_meshes:
        return []
    faces = _faces(shape)
    out: List[Dict[str, Any]] = []
    for index, mesh in torus_meshes.items():
        torus = BRepAdaptor_Surface(faces[index]).Torus()
        location, direction = torus.Axis().Location(), torus.Axis().Direction()
        origin: Vec = (float(location.X()), float(location.Y()), float(location.Z()))
        axis: Vec = (float(direction.X()), float(direction.Y()), float(direction.Z()))
        major = float(torus.MajorRadius())
        outward = 0.0
        for t in mesh.triangles:
            rel = sub(t.centroid, origin)
            radial = sub(rel, scale(axis, dot(rel, axis)))
            m = math.sqrt(dot(radial, radial))
            if m < 1e-9:
                continue
            # The centre of the tube nearest this triangle: the point of the torus's centre circle in the triangle's own radial direction.
            ring = scale(radial, major / m)
            tube_centre = (origin[0] + ring[0], origin[1] + ring[1], origin[2] + ring[2])
            outward += dot(t.normal, sub(t.centroid, tube_centre)) * t.area
        out.append({"kind": "corner" if outward > 0 else "fillet", "radius_mm": round(float(torus.MinorRadius()), 3), "surface": "torus", "face_ids": [index]})
    return out


def measure_radii(shape: Any, meshes: Sequence[FaceMesh]) -> List[Dict[str, Any]]:
    """
    The rounded edges of the part: a partial cylinder (a blend along a straight edge) or a torus (a blend round a curved edge). `fillet` is an inside
    corner (the metal is outside the round), `corner` an outside one. A cylinder that wraps nearly all the way round is a hole or a boss, not a blend.
    """
    arcs = [
        {"kind": "fillet" if c.concave else "corner", "radius_mm": round(c.radius_mm, 3), "surface": "cylinder", "face_ids": list(c.face_ids)}
        for c in cylinders(meshes) if c.kind == "cylinder" and c.sweep_deg < FULL_SWEEP_DEG
    ]
    return sorted(arcs + _torus_radii(shape, meshes), key=lambda r: (r["kind"], r["radius_mm"], r["face_ids"]))


def _section_thickness(meshes: Sequence[FaceMesh], wall: Dict[str, Any]) -> Dict[str, Any]:
    """
    The part's thinnest, usual (area-weighted median) and thickest section. A face's thickness is the largest ball found behind it: near any outside
    edge of the face a ball is squeezed to nothing by the neighbouring face, so the smallest ball of a face says where its edge is, not how thick the
    metal is, and is not reported.
    """
    area = {f.index: f.area for f in meshes}
    faces = [{"face_id": f["face_id"], "thickness_mm": f["thickness_mm"]} for f in wall["faces"]]
    if not faces:
        return {"min_mm": None, "nominal_mm": None, "max_mm": None, "resolution_mm": wall["resolution_mm"], "faces": []}
    ordered = sorted(faces, key=lambda f: f["thickness_mm"])
    half = sum(area.get(f["face_id"], 0.0) for f in ordered) / 2.0
    running = 0.0
    nominal = ordered[-1]["thickness_mm"]
    for f in ordered:
        running += area.get(f["face_id"], 0.0)
        if running >= half:
            nominal = f["thickness_mm"]
            break
    return {
        "min_mm": ordered[0]["thickness_mm"], "nominal_mm": nominal, "max_mm": ordered[-1]["thickness_mm"],
        "resolution_mm": wall["resolution_mm"], "faces": faces,
    }


def _sharp_edges(shape: Any) -> Dict[str, Any]:
    edges = sharp_edge_length(shape, detail=True, concavity=True).get("edges", [])
    internal = [e for e in edges if e.get("concavity") == "internal"]
    external = [e for e in edges if e.get("concavity") == "external"]
    return {
        "internal_count": len(internal), "internal_length_mm": round(sum(e["length_mm"] for e in internal), 3),
        "external_count": len(external), "external_length_mm": round(sum(e["length_mm"] for e in external), 3),
        "unknown_count": len(edges) - len(internal) - len(external),
        # An inside corner with no radius is where a die would need a knife edge: the faces are kept so it can be shown.
        "internal_edges": [{"length_mm": round(e["length_mm"], 3), "face_ids": e["face_ids"]} for e in internal],
    }


class ForgingFeatureExtractor:
    def extract(
        self,
        shape: Any,
        bbox_dims: Sequence[float],
        face_map: Optional[List[Any]] = None,
        face_map_tri_total: int = 0,
        die_direction_override: Optional[Tuple[float, float, float]] = None,
    ) -> Dict[str, Any]:
        diagonal = math.sqrt(sum(float(x) ** 2 for x in bbox_dims))
        deflection = max(0.1, diagonal * 0.001)
        meshes = tessellate_faces(shape, linear_deflection=deflection)
        die = choose_pull_direction(meshes, SIDE_WALL_DEG, die_direction_override)
        silhouette = parting_plane_silhouette(shape, die.vector, deflection)
        # 90 deg as the upper limit: every wall is reported with its angle, none is set aside as "too much draft" (that is a molding notion).
        draft = analyze_draft(meshes, die.vector, SIDE_WALL_DEG, 90.0)
        wall = measure_wall_thickness(meshes, deflection)
        holes = recognize_holes(meshes, die.vector)
        trapped = trapped_cores(shape, die.vector, linear_deflection=deflection)
        plan = plan_directions(meshes, die.vector)
        profile = section_area_profile(shape, plan["long_axis"], linear_deflection=deflection) if plan["long_axis"] else None

        stable_face_ids: Dict[int, str] = {}
        try:
            stable_face_ids = build_stable_face_id_map(shape)
        except Exception as e:  # the ids only serve highlighting; a part that cannot be hashed is still measured
            logger.warning(f"[Forging] stable_face_id build failed: {e}")

        logger.info(
            f"[Forging] die={[round(c, 3) for c in die.vector]} ({die.source}) projected_area={silhouette['area_mm2']:.1f}mm2 "
            f"perimeter={silhouette['parting_perimeter_mm']:.1f}mm undercut_area={die.undercut_area_mm2:.1f}mm2 "
            f"holes={len(holes['holes'])} trapped_volumes={trapped['core_count']}"
        )
        return {
            "extraction_version": VERSION,
            "die_direction": {
                "vector": [round(c, 5) for c in die.vector],
                "source": die.source,
                "axis": die.nearest_axis(),
                "undercut_area_mm2": round(die.undercut_area_mm2, 2),
                "alternatives": [{"vector": [round(c, 5) for c in a.direction], "undercut_area_mm2": round(a.undercut_area_mm2, 2)} for a in die.alternatives],
            },
            "projected_area_mm2": round(silhouette["area_mm2"], 2),
            "parting_footprint_mm": [round(x, 3) for x in silhouette["footprint_mm"]],
            "parting_perimeter_mm": round(silhouette["parting_perimeter_mm"], 2),
            "die_depth_mm": round(silhouette["pull_extent_mm"], 3),
            "parting_line": parting_line(meshes, die.vector, SIDE_WALL_DEG),
            "plan": plan,
            "section_profile": profile,
            "draft": {
                "wall_area_mm2": draft["wall_area_mm2"],
                "undercut_area_mm2": draft["area_by_class_mm2"]["undercut"],
                "avg_draft_angle_deg": draft["avg_draft_angle_deg"],
                "faces": [
                    {"face_id": f["face_id"], "surface": f["surface"], "draft_deg": f["judged_draft_deg"], "draft_basis": f["draft_basis"],
                     "wall_area_mm2": f["wall_area_mm2"], "undercut_fraction": f["undercut_fraction"]}
                    for f in draft["faces"]
                ],
            },
            "section_thickness": _section_thickness(meshes, wall),
            "holes": [
                {"id": h["id"], "variant": h["variant"], "diameter_mm": h["diameter_mm"], "depth_mm": h["depth_mm"], "depth_to_diameter": h["depth_to_diameter"],
                 "angle_to_die_deg": h["angle_to_pull_deg"], "axis": h["axis"], "face_ids": h["face_ids"]}
                for h in holes["holes"]
            ],
            "radii": measure_radii(shape, meshes),
            "sharp_edges": _sharp_edges(shape),
            "trapped_volumes": {"count": trapped["core_count"], "volumes": trapped["cores"]},
            # No forging feature types: the forging reference data has no feature catalog to name them from. The face map is what highlighting needs.
            "feature_graph_v2": {
                "metadata": {"face_map": face_map or [], "stl_tri_total": face_map_tri_total or None, "stable_face_ids": stable_face_ids},
                "features": [],
                "conditions": [],
            },
        }
