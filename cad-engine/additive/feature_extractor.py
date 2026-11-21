"""
What an additively manufactured part's cost rests on, measured from the solid.

A part built layer by layer (metal powder bed DMLS/SLM, polymer powder bed SLS, material jetting, stereolithography) costs by how tall it is
built, how much of the bed it takes, how much support it needs and where the supports touch. A STEP solid carries no build orientation, so
it is chosen here:

  build_direction    each of the six axis directions the part could be built along (the plate below, layers stacked along it). For each, at
                     every self-supporting angle the reference data names (memory/Additive Manufacturing tblSelfSupportingAngles: 30 and 45
                     degrees), the measures below. The direction quoted is the one with the least overhang area at the default angle, of
                     equal ones the lowest build height (the fewest layers); an engineer's direction (pull_direction) overrides it. The
                     backend re-picks from the candidates at the material's own angle.
  build_height       the part's extent along the build direction (the layers).
  footprint          its extent in the plate's two directions (the bed area one part takes, before the nesting allowance).
  overhang           down-facing surface flatter than the self-supporting angle, not lying on the plate: it needs support. Its area, and the
                     faces it lies on.
  support_volume     each overhanging triangle's area seen from below times its height above the plate: the support columns, down to the
                     plate (a column landing on the part below is not detected: an upper bound).
  plate_contact      the part's faces on the plate plus the overhang seen from below: what is broken off the plate after the build.
  features           holes (SimpleHole, MultiStepHole, RingedHole: a bore with a groove), voids (additive/voids.py: pockets, ring pockets,
                     enclosed cavities and non-round holes, each with its volume and depth), planar faces, curved walls and surfaces (as built,
                     the catalog's "As Sintered / As Printed / As Cured"), the support structure (the overhang faces) and the build direction
                     (the plate faces). The holes and voids are what cleaning clears (memory/Rapid prototyping cleaning* variables).

These are measurements only. Route, layers, nesting, cycle times and cost are decided in the backend from the staged additive reference data.
"""
from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from injection_molding.recognition.holes import recognize_holes
from injection_molding.recognition.mesh import FaceMesh, tessellate_faces
from injection_molding.recognition.vec import Vec, dot, unit
from shared.stable_face_id import build_stable_face_id_map
from forging.feature_extractor import extreme_faces, face_features, hole_features, solid_volume
from additive.voids import find_voids

logger = logging.getLogger(__name__)

VERSION = "additive-2"

# The six directions a part can be built along: the plate is below, layers stack along the direction.
AXES: Tuple[Tuple[str, Vec], ...] = (
    ("+z", (0.0, 0.0, 1.0)), ("-z", (0.0, 0.0, -1.0)),
    ("+x", (1.0, 0.0, 0.0)), ("-x", (-1.0, 0.0, 0.0)),
    ("+y", (0.0, 1.0, 0.0)), ("-y", (0.0, -1.0, 0.0)),
)
# The self-supporting angles of memory/Additive Manufacturing tblSelfSupportingAngles (degrees from the plate): a down-facing surface inclined
# less than this from horizontal needs support. The default is the larger one (aluminium, maraging steel, nickel alloys; and the polymers,
# which the table does not list).
SELF_SUPPORTING_DEG: Tuple[float, ...] = (30.0, 45.0)
DEFAULT_SELF_SUPPORTING_DEG = 45.0
# Two overhang areas within this share of the larger are equal for the choice of direction (the mesh's own scatter).
EQUAL_AREA_FRACTION = 0.02


def _plates(axis: Vec) -> Tuple[Vec, Vec]:
    """The plate's two directions for a build direction along `axis` (both axis-aligned)."""
    if abs(axis[2]) > 0.5:
        return (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)
    if abs(axis[0]) > 0.5:
        return (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)
    return (1.0, 0.0, 0.0), (0.0, 0.0, 1.0)


def _extent(meshes: Sequence[FaceMesh], axis: Vec) -> Tuple[float, float]:
    vals = [dot(v, axis) for f in meshes for t in f.triangles for v in t.vertices]
    return (min(vals), max(vals)) if vals else (0.0, 0.0)


def orientation(meshes: Sequence[FaceMesh], build: Vec, tol: float, angles: Sequence[float] = SELF_SUPPORTING_DEG) -> Dict[str, Any]:
    """
    One build direction: its height and footprint, and at each self-supporting angle the overhang (area, faces), the support volume and the
    plate contact. A triangle on the plate (every vertex within tol of the bottom) is plate contact, never overhang.
    """
    b = unit(build)
    lo, hi = _extent(meshes, b)
    p1, p2 = _plates(b)
    e1, e2 = _extent(meshes, p1), _extent(meshes, p2)
    bottom_area = 0.0
    bottom_faces: Set[int] = set()
    per_angle: Dict[str, Dict[str, Any]] = {}
    down: List[Tuple[int, float, float, float]] = []  # (face, area, cos to -build, height above plate) of down-facing, off-plate triangles
    for f in meshes:
        for t in f.triangles:
            c = -dot(t.normal, b)  # cos of the angle between the normal and straight down
            if c <= 1e-9:
                continue
            if all(dot(v, b) <= lo + tol for v in t.vertices):
                bottom_area += t.area * c
                bottom_faces.add(f.index)
                continue
            down.append((f.index, t.area, c, dot(t.centroid, b) - lo))
    for a in angles:
        # Inclined less than `a` from horizontal: the angle between the normal and straight down is below `a`, so its cosine is above cos(a).
        threshold = math.cos(math.radians(a))
        over = [d for d in down if d[2] > threshold + 1e-9]
        faces = sorted({d[0] for d in over})
        projected = sum(d[1] * d[2] for d in over)
        per_angle[str(int(a))] = {
            "overhang_area_mm2": round(sum(d[1] for d in over), 3),
            "overhang_projected_area_mm2": round(projected, 3),
            "support_volume_mm3": round(sum(d[1] * d[2] * d[3] for d in over), 3),
            "plate_contact_area_mm2": round(bottom_area + projected, 3),
            "overhang_face_ids": faces,
            "overhang_regions": len(faces),
        }
    return {
        "vector": [round(x, 5) for x in b],
        "build_height_mm": round(hi - lo, 3),
        "footprint_mm": [round(e1[1] - e1[0], 3), round(e2[1] - e2[0], 3)],
        "footprint_axes": [list(p1), list(p2)],
        "bottom_area_mm2": round(bottom_area, 3),
        "bottom_face_ids": sorted(bottom_faces),
        "by_angle": per_angle,
    }


def choose_direction(candidates: Dict[str, Dict[str, Any]], angle: float = DEFAULT_SELF_SUPPORTING_DEG) -> str:
    """The direction with the least overhang area at `angle`; of overhang areas equal within EQUAL_AREA_FRACTION, the lowest build height."""
    key = str(int(angle))
    least = min(c["by_angle"][key]["overhang_area_mm2"] for c in candidates.values())
    margin = max(1e-6, least * EQUAL_AREA_FRACTION)
    near = [k for k, c in candidates.items() if c["by_angle"][key]["overhang_area_mm2"] <= least + margin]
    return min(near, key=lambda k: (candidates[k]["build_height_mm"], [a for a, _ in AXES].index(k)))


def nearest_axis(vector: Sequence[float]) -> str:
    """The axis direction (of AXES) closest to an engineer's direction."""
    v = unit((float(vector[0]), float(vector[1]), float(vector[2])))
    return max(AXES, key=lambda a: dot(v, a[1]))[0]


def additive_measurements(meshes: Sequence[FaceMesh], chosen: Dict[str, Any], part_volume: Optional[float], tol: float) -> Dict[str, Any]:
    """The faces behind each number the additive cost reads, as feature_graph_v2 measurements (the calculator dialog's eye highlights them)."""
    b = tuple(chosen["vector"])
    at = chosen["by_angle"][str(int(DEFAULT_SELF_SUPPORTING_DEG))]
    all_faces = sorted(f.index for f in meshes)
    out: Dict[str, Any] = {
        "build_height": {"value": chosen["build_height_mm"], "unit": "mm", "method": "faces at the two extremes along the build direction",
                         "occurrences": [{"face_ids": extreme_faces(meshes, b, tol)}], "reconciles": True},
        "overhang_area": {"value": at["overhang_area_mm2"], "unit": "mm2", "method": "down-facing surface flatter than the self-supporting angle",
                          "occurrences": [{"face_ids": at["overhang_face_ids"]}], "reconciles": True},
        "support_volume": {"value": at["support_volume_mm3"], "unit": "mm3", "method": "the overhang seen from below times its height above the plate",
                           "occurrences": [{"face_ids": at["overhang_face_ids"]}], "reconciles": True},
        "plate_contact_area": {"value": at["plate_contact_area_mm2"], "unit": "mm2", "method": "the faces on the plate and the overhang seen from below",
                               "occurrences": [{"face_ids": sorted(set(chosen["bottom_face_ids"]) | set(at["overhang_face_ids"]))}], "reconciles": True},
        "surface_area": {"value": round(sum(f.area for f in meshes), 3), "unit": "mm2", "method": "every face of the part",
                         "occurrences": [{"face_ids": all_faces}], "reconciles": True},
    }
    if part_volume is not None:
        out["part_volume"] = {"value": round(part_volume, 3), "unit": "mm3", "method": "the solid's volume",
                              "occurrences": [{"face_ids": all_faces}], "reconciles": True}
    for key, i in (("footprint_length", 0), ("footprint_width", 1)):
        out[key] = {"value": chosen["footprint_mm"][i], "unit": "mm", "method": "faces at the two ends of the footprint on the plate",
                    "occurrences": [{"face_ids": extreme_faces(meshes, tuple(chosen["footprint_axes"][i]), tol)}], "reconciles": True}
    return out


def build_features(chosen: Dict[str, Any], stable: Dict[int, str]) -> List[Dict[str, Any]]:
    """The support structure (the overhang faces) and the build direction (the plate faces) as feature_graph_v2 features."""
    def occ(ids: Sequence[int], **extra: Any) -> Dict[str, Any]:
        o: Dict[str, Any] = {"face_ids": sorted(ids), **extra}
        s = [stable.get(i) for i in o["face_ids"]]
        if s and all(s):
            o["source_face_stable_ids"] = s
        return o
    at = chosen["by_angle"][str(int(DEFAULT_SELF_SUPPORTING_DEG))]
    out: List[Dict[str, Any]] = []
    if at["overhang_face_ids"]:
        out.append({"id": "support-structure", "feature_type": "SupportStructure", "variant": "default", "occurrences": [
            occ(at["overhang_face_ids"], area_mm2=at["overhang_area_mm2"], volume_mm3=at["support_volume_mm3"])]})
    if chosen["bottom_face_ids"]:
        out.append({"id": "build-direction", "feature_type": "BuildDirection", "variant": "default", "occurrences": [
            occ(chosen["bottom_face_ids"], area_mm2=chosen["bottom_area_mm2"], vector=chosen["vector"])]})
    return out


def is_ringed(hole: Dict[str, Any]) -> bool:
    """A bore with a groove inside it: along its axis, a wider cylinder step lies between two narrower ones (the catalog's RingedHole)."""
    radii = [float(s["diameter_mm"]) for s in sorted(hole.get("steps", []), key=lambda s: s.get("t_min", 0.0)) if s.get("kind") == "cylinder"]
    return any(radii[i] > radii[i - 1] and radii[i] > radii[i + 1] for i in range(1, len(radii) - 1))


def void_features(voids: Sequence[Dict[str, Any]], stable: Dict[int, str]) -> List[Dict[str, Any]]:
    """
    Each void (additive/voids.py) as a feature_graph_v2 feature of its own, under the void's id (as each hole is under its own): Void (simple,
    complex), Ring (a pocket around a boss), ComplexHole. The cleaning step names the features it times by these ids.
    """
    out: List[Dict[str, Any]] = []
    for v in voids:
        occ: Dict[str, Any] = {"face_ids": list(v["face_ids"]), "centroid": v["centroid"], "volume_mm3": v["volume_mm3"], "depth_mm": v["depth_mm"]}
        if v.get("equivalent_diameter_mm") is not None:
            occ["diameter_mm"] = v["equivalent_diameter_mm"]
        s = [stable.get(i) for i in occ["face_ids"]]
        if s and all(s):
            occ["source_face_stable_ids"] = s
        out.append({"id": v["id"], "feature_type": v["feature_type"], "variant": v["variant"], "occurrences": [occ]})
    return out


class AdditiveFeatureExtractor:
    def extract(
        self,
        shape: Any,
        bbox_dims: Sequence[float],
        face_map: Optional[List[Any]] = None,
        face_map_tri_total: int = 0,
        build_direction_override: Optional[Tuple[float, float, float]] = None,
    ) -> Dict[str, Any]:
        diagonal = math.sqrt(sum(float(x) ** 2 for x in bbox_dims))
        deflection = max(0.05, diagonal * 0.001)
        tol = deflection * 2.0
        meshes = tessellate_faces(shape, linear_deflection=deflection)
        candidates = {name: orientation(meshes, axis, tol) for name, axis in AXES}
        if build_direction_override is not None:
            chosen_key, source = nearest_axis(build_direction_override), "engineer"
        else:
            chosen_key, source = choose_direction(candidates), "least_support"
        chosen = candidates[chosen_key]
        build = tuple(chosen["vector"])
        volume = solid_volume(shape)

        stable: Dict[int, str] = {}
        try:
            stable = build_stable_face_id_map(shape)
        except Exception as e:  # the ids only serve highlighting; a part that cannot be hashed is still measured
            logger.warning(f"[Additive] stable_face_id build failed: {e}")
        holes = recognize_holes(meshes, build)
        for h in holes["holes"]:
            if is_ringed(h):
                h["feature_type"] = "RingedHole"
        try:
            found = find_voids(shape, meshes, holes["holes"])
        except Exception as e:  # cleaning then has no void to time; the build is still measured
            logger.warning(f"[Additive] void recognition failed: {e}")
            found = {"voids": [], "cell_mm": None, "skipped_columns": 0, "open_recesses": 0}
        claimed = [i for h in holes["holes"] for i in h["face_ids"]] + [i for v in found["voids"] for i in v["face_ids"]]
        features = (hole_features(holes["holes"], stable) + void_features(found["voids"], stable)
                    + face_features(shape, bbox_dims, build, claimed, stable, voids=False) + build_features(chosen, stable))

        at = chosen["by_angle"][str(int(DEFAULT_SELF_SUPPORTING_DEG))]
        logger.info(
            f"[Additive] build={chosen_key} ({source}) height={chosen['build_height_mm']}mm footprint={chosen['footprint_mm']} "
            f"overhang={at['overhang_area_mm2']}mm2 support={at['support_volume_mm3']}mm3 holes={len(holes['holes'])}"
        )
        return {
            "extraction_version": VERSION,
            "build_direction": {"axis": chosen_key, "vector": chosen["vector"], "source": source,
                                "self_supporting_deg": DEFAULT_SELF_SUPPORTING_DEG},
            "candidates": {k: {kk: vv for kk, vv in c.items() if kk not in ("bottom_face_ids",)} for k, c in candidates.items()},
            "part_volume_mm3": round(volume, 3) if volume is not None else None,
            "surface_area_mm2": round(sum(f.area for f in meshes), 3),
            "build_height_mm": chosen["build_height_mm"],
            "footprint_mm": chosen["footprint_mm"],
            "overhang_area_mm2": at["overhang_area_mm2"],
            "support_volume_mm3": at["support_volume_mm3"],
            "plate_contact_area_mm2": at["plate_contact_area_mm2"],
            "overhang_regions": at["overhang_regions"],
            "holes": [
                {"id": h["id"], "feature_type": h["feature_type"], "variant": h["variant"], "diameter_mm": h["diameter_mm"], "depth_mm": h["depth_mm"],
                 "face_ids": h["face_ids"]}
                for h in holes["holes"]
            ],
            # The pockets, ring pockets, enclosed cavities and non-round holes (additive/voids.py): what cleaning clears besides the holes.
            "voids": [{k: v[k] for k in ("id", "feature_type", "variant", "volume_mm3", "depth_mm", "open_axis", "equivalent_diameter_mm", "face_ids") if k in v}
                      for v in found["voids"]],
            "void_cell_mm": found["cell_mm"],
            "feature_graph_v2": {
                "metadata": {"face_map": face_map or [], "stl_tri_total": face_map_tri_total or None, "stable_face_ids": stable},
                "features": features,
                "conditions": [],
                "measurements": additive_measurements(meshes, chosen, volume, tol),
            },
        }
