"""
What a blow molded or rotomolded part's cost rests on, measured from the solid.

Both processes make a hollow shell: a blow mold closes two halves on a parison and inflates it; a rotational mold tumbles powder in a heated
mold until it coats the walls. So the measures are a shell's (memory/Roto & blow molding):

  pull / parting   the direction the two mold halves open along (injection_molding.recognition.pull_direction), the parting line where they meet
                   (its length: the flash a blow mold pinches off, the clamps a roto mold is closed with) and the part's outline on that plane
                   (shared.casting_geometry.parting_plane_silhouette: its perimeter, the mold's footprint).
  envelope         the part's extents across the parting plane and along the pull: the mold size (cavities on a blow mold's platen, molds on a
                   carousel arm).
  wall             the shell's thickness, nominal (area weighted), min and max (injection_molding.recognition.wall_thickness).
  inside           the air the shell closes in (additive.voids, the largest void, open through one opening or enclosed): its volume (the air a
                   blow mold inflates) and faces. A part with none is not a hollow part.
  spout            a bore through the wall from the outside into the inside: the blow hole or fill opening (its diameter and length).
  features         the holes (SimpleHole, MultiStepHole), the other voids (Void, ComplexHole), the spout, the parting line and perimeter, and the
                   faces (PlanarFace, CurvedWall, CurvedSurface), as the catalog names them: each is molded, cored, inserted, trimmed, routed
                   or sawn by the backend's rules.

These are measurements only. Which operation each feature takes, the cycle and the cost are decided in the backend from the staged reference.
"""
from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from additive.feature_extractor import void_features
from additive.voids import find_voids
from forging.feature_extractor import face_features, hole_features, solid_volume
from injection_molding.recognition.holes import recognize_holes
from injection_molding.recognition.mesh import FaceMesh, tessellate_faces
from injection_molding.recognition.parting import parting_line
from injection_molding.recognition.pull_direction import choose_pull_direction
from injection_molding.recognition.vec import Vec, dot, unit
from injection_molding.recognition.wall_thickness import measure_wall_thickness
from shared.casting_geometry import parting_plane_silhouette
from shared.stable_face_id import build_stable_face_id_map

logger = logging.getLogger(__name__)

VERSION = "roto-blow-1"
# A face within this of parallel to the pull is a side wall (the plastic analysis's own threshold, injection_molding/feature_extractor.py).
UNDRAFTED_DEG = 0.3
# A recognised "bore" whose volume is this share of the inside or more is the inside's own round wall (a bottle's body), not a hole.
BODY_SHARE = 0.25
_FACE_TYPES = {"PlanarFace", "CurvedWall", "CurvedSurface"}


def _stable_occ(occ: Dict[str, Any], stable: Dict[int, str]) -> Dict[str, Any]:
    ids = [stable.get(f) for f in occ["face_ids"]]
    return {**occ, "source_face_stable_ids": ids} if ids and all(ids) else occ


def wall_summary(wall: Dict[str, Any], meshes: Sequence[FaceMesh]) -> Dict[str, Optional[float]]:
    """The shell's wall: the area-weighted median of the faces' thickness (nominal), the thinnest and the thickest."""
    area = {f.index: f.area for f in meshes}
    faces = [(float(f["thickness_mm"]), area.get(f["face_id"], 0.0), float(f["min_mm"])) for f in wall.get("faces", []) if f.get("thickness_mm")]
    if not faces:
        return {"nominal_mm": None, "min_mm": None, "max_mm": None}
    total = sum(a for _, a, _ in faces) or 1.0
    acc = 0.0
    nominal = faces[0][0]
    for t, a, _ in sorted(faces):
        acc += a
        if acc >= total / 2:
            nominal = t
            break
    return {"nominal_mm": round(nominal, 3), "min_mm": round(min(m for _, _, m in faces), 3), "max_mm": round(max(t for t, _, _ in faces), 3)}


def _step_volume(s: Dict[str, Any]) -> float:
    return math.pi * float(s.get("radius_mm", 0.0)) ** 2 * float(s.get("length_mm", 0.0)) if s.get("kind") == "cylinder" else 0.0


def without_body(holes: Sequence[Dict[str, Any]], inside_volume: float) -> List[Dict[str, Any]]:
    """
    The holes with the inside's own round wall taken out. The hole recogniser stacks a bottle's body and its neck into one stepped bore; a step
    holding BODY_SHARE of the inside or more is the body. What is left of a stack (the neck) is a bore of its own, open into the inside, so
    through; a stack that is all body is no hole.
    """
    if inside_volume <= 0:
        return list(holes)
    out: List[Dict[str, Any]] = []
    for h in holes:
        steps = h.get("steps", [])
        body = [s for s in steps if _step_volume(s) >= BODY_SHARE * inside_volume]
        if not body:
            out.append(h)
            continue
        rest = [s for s in steps if s not in body]
        cyl = [s for s in rest if s.get("kind") == "cylinder"]
        if not cyl:
            continue
        lo, hi = min(s["t_min"] for s in rest), max(s["t_max"] for s in rest)
        out.append({
            **h, "feature_type": "MultiStepHole" if len({round(s["diameter_mm"], 2) for s in cyl}) > 1 else "SimpleHole", "variant": "through",
            "diameter_mm": round(min(s["diameter_mm"] for s in cyl), 3), "depth_mm": round(hi - lo, 3), "steps": rest,
            "face_ids": sorted({f for s in rest for f in s.get("face_ids", [])}),
        })
    return out


def find_spouts(holes: Sequence[Dict[str, Any]], inside_id: Optional[str], void_at: Any, cell: float) -> List[Dict[str, Any]]:
    """The bores through the wall from the outside into the inside: one end leads into the inside void, the other into open air."""
    if not inside_id:
        return []
    out: List[Dict[str, Any]] = []
    for h in holes:
        axis, point = h.get("axis"), h.get("axis_point")
        steps = [s for s in h.get("steps", []) if "t_min" in s]
        if h.get("variant") != "through" or not axis or not point or not steps:
            continue
        t0, t1 = min(s["t_min"] for s in steps), max(s["t_max"] for s in steps)
        base = sum(point[a] * axis[a] for a in range(3))
        at = lambda t: [point[a] + axis[a] * (t - base) for a in range(3)]  # noqa: E731
        ends = [void_at(at(t0 - 2 * cell)), void_at(at(t1 + 2 * cell))]
        if set(ends) == {None, inside_id}:
            out.append({"id": f"spout-{len(out) + 1}", "hole_id": h["id"], "diameter_mm": h["diameter_mm"], "length_mm": h["depth_mm"], "face_ids": h["face_ids"]})
    return out


class RotoBlowFeatureExtractor:
    def extract(
        self,
        shape: Any,
        bbox_dims: Sequence[float],
        face_map: Optional[List[Any]] = None,
        face_map_tri_total: int = 0,
        pull_override: Optional[Tuple[float, float, float]] = None,
    ) -> Dict[str, Any]:
        diagonal = math.sqrt(sum(float(x) ** 2 for x in bbox_dims))
        resolution = max(0.1, diagonal * 0.001)
        meshes = tessellate_faces(shape, linear_deflection=resolution)
        pull = choose_pull_direction(meshes, UNDRAFTED_DEG, pull_override)
        p: Vec = unit(tuple(pull.vector))
        stable: Dict[int, str] = {}
        try:
            stable = build_stable_face_id_map(shape)
        except Exception as e:  # the ids only serve highlighting
            logger.warning(f"[RotoBlow] stable_face_id build failed: {e}")

        # The inside first, with no hole masked: a bottle's round body would otherwise read as a "hole" and hide the air it holds.
        holes_all = recognize_holes(meshes, p)["holes"]
        try:
            unmasked = find_voids(shape, meshes, [])
        except Exception as e:
            logger.warning(f"[RotoBlow] void recognition failed: {e}")
            unmasked = {"voids": [], "cell_mm": None, "void_at": lambda q: None}
        inside_volume = max((v["volume_mm3"] for v in unmasked["voids"] if v["feature_type"] == "Void" or v["feature_type"] == "Ring"), default=0.0)
        holes = without_body(holes_all, inside_volume)
        # Then every void with the real holes masked: the inside (the largest), and the pockets and cut-outs beside it.
        try:
            found = find_voids(shape, meshes, holes)
        except Exception as e:
            logger.warning(f"[RotoBlow] void recognition failed: {e}")
            found = {"voids": [], "cell_mm": None, "void_at": lambda q: None}
        candidates = [v for v in found["voids"] if v["feature_type"] in ("Void", "Ring")]
        inside = max(candidates, key=lambda v: v["volume_mm3"]) if candidates else None
        others = [v for v in found["voids"] if v is not inside]
        cell = float(found.get("cell_mm") or resolution)
        spouts = find_spouts(holes, inside["id"] if inside else None, found["void_at"], cell)
        spout_holes = {s["hole_id"] for s in spouts}

        wall = wall_summary(measure_wall_thickness(meshes, resolution), meshes)
        try:
            silhouette = parting_plane_silhouette(shape, p, linear_deflection=resolution, with_faces=True)
        except Exception as e:
            logger.warning(f"[RotoBlow] silhouette failed: {e}")
            silhouette = {}
        parting = parting_line(meshes, p, UNDRAFTED_DEG)
        perimeter = round(float(silhouette["parting_perimeter_mm"]), 3) if silhouette.get("parting_perimeter_mm") else None
        # The parting line where the halves meet; on walls with no draft the geometry does not show it, and the outline on the parting plane is it.
        parting_length = parting.get("length_mm") if parting.get("status") == "found" else perimeter
        extents = sorted([float(x) for x in silhouette.get("footprint_mm", [0.0, 0.0])], reverse=True)
        depth = float(silhouette.get("pull_extent_mm") or 0.0)
        volume = solid_volume(shape)

        claimed = [f for h in holes for f in h["face_ids"]] + [f for v in others for f in v["face_ids"]]
        features: List[Dict[str, Any]] = hole_features([h for h in holes if h["id"] not in spout_holes], stable) + void_features(others, stable)
        features += [{"id": s["id"], "feature_type": "Spout", "variant": "default", "occurrences": [
            _stable_occ({"face_ids": list(s["face_ids"]), "diameter_mm": s["diameter_mm"], "length_mm": s["length_mm"]}, stable)]} for s in spouts]
        if parting_length:
            features.append({"id": "parting-line", "feature_type": "PartingLine", "variant": parting.get("variant", "default") if parting.get("status") == "found" else "outline",
                             "occurrences": [_stable_occ({"face_ids": list(silhouette.get("parting_face_ids", [])), "length_mm": parting_length}, stable)]})
        if perimeter:
            features.append({"id": "perimeter", "feature_type": "Perimeter", "variant": "default",
                             "occurrences": [_stable_occ({"face_ids": list(silhouette.get("parting_face_ids", [])), "length_mm": perimeter}, stable)]})
        features += [f for f in face_features(shape, bbox_dims, p, claimed, stable, voids=False) if f["feature_type"] in _FACE_TYPES]

        all_faces = sorted(f.index for f in meshes)
        measurements: Dict[str, Any] = {
            "part_surface": {"value": round(sum(f.area for f in meshes), 3), "unit": "mm2", "method": "every face of the part", "occurrences": [{"face_ids": all_faces}], "reconciles": True},
        }
        if volume is not None:
            measurements["part_volume"] = {"value": round(volume, 3), "unit": "mm3", "method": "the solid's volume", "occurrences": [{"face_ids": all_faces}], "reconciles": True}
        if inside:
            measurements["inside_volume"] = {"value": inside["volume_mm3"], "unit": "mm3", "method": "the air the shell closes in (voxels)", "occurrences": [{"face_ids": inside["face_ids"]}], "reconciles": True}
        if parting_length:
            measurements["parting_line"] = {"value": parting_length, "unit": "mm", "method": "where the mold halves meet", "occurrences": [{"face_ids": list(silhouette.get("parting_face_ids", []))}], "reconciles": True}

        logger.info(f"[RotoBlow] pull={pull.nearest_axis()} wall={wall['nominal_mm']}mm inside={inside['volume_mm3'] if inside else 0}mm3 spouts={len(spouts)} holes={len(holes)} voids={len(others)}")
        return {
            "extraction_version": VERSION,
            "pull_direction": {"vector": [round(c, 5) for c in p], "axis": pull.nearest_axis(), "source": pull.source},
            "envelope_mm": {"length": round(extents[0], 3), "width": round(extents[1], 3), "depth": round(depth, 3)},
            "part_volume_mm3": round(volume, 3) if volume is not None else None,
            "surface_area_mm2": round(sum(f.area for f in meshes), 3),
            "projected_area_mm2": round(float(silhouette.get("area_mm2") or pull.projected_area_mm2), 3),
            "wall": wall,
            "hollow": inside is not None,
            "inside": {"volume_mm3": inside["volume_mm3"], "depth_mm": inside["depth_mm"], "open_axis": inside.get("open_axis"), "face_ids": inside["face_ids"]} if inside else None,
            "parting_line_mm": parting_length,
            "parting_line_source": "parting line" if parting.get("status") == "found" else "outline on the parting plane",
            "perimeter_mm": perimeter,
            "spouts": spouts,
            "holes": [{"id": h["id"], "feature_type": h["feature_type"], "variant": h["variant"], "diameter_mm": h["diameter_mm"], "depth_mm": h["depth_mm"],
                       "angle_to_pull_deg": h["angle_to_pull_deg"], "face_ids": h["face_ids"]} for h in holes if h["id"] not in spout_holes],
            "voids": [{k: v[k] for k in ("id", "feature_type", "variant", "volume_mm3", "depth_mm", "open_axis", "equivalent_diameter_mm", "face_ids") if k in v} for v in others],
            "void_cell_mm": found.get("cell_mm"),
            "feature_graph_v2": {
                "metadata": {"face_map": face_map or [], "stl_tri_total": face_map_tri_total or None, "stable_face_ids": stable},
                "features": features,
                "conditions": [],
                "measurements": measurements,
            },
        }
