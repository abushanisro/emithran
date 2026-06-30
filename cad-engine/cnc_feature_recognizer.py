"""
CNC Feature Recognizer — Phase 1 architecture.

Converts raw OCC topology into a structured manufacturing feature tree that
resembles aPriori's feature representation rather than a flat face inventory.

Phase 1 covers cnc_turned and mill_turn parts:
  external_diameter, through_hole, blind_hole, cross_hole, pcd_hole_pattern,
  chamfer, groove, fillet, slot, radial_slot, pocket, counterbore,
  countersink, keyway

cnc_milled: stub — returns empty list + warning (Phase 2).

Thread detection is NOT performed here. Threads are sourced from PMI/drawing
data only and merged by the backend process planner.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional, Tuple

logger = logging.getLogger(__name__)

# Toroidal faces with minor radius below this are sub-mm blend arcs on complex STEP models,
# not manufacturable fillets. Without this floor, a single STEP file can yield 10,000+ "fillets".
_MIN_FILLET_RADIUS_MM = 0.5

# ── Feature type registry ─────────────────────────────────────────────────────

FeatureType = Literal[
    "external_diameter",  # outer cylindrical step along rotation axis
    "through_hole",       # cylindrical bore traversing full part thickness
    "blind_hole",         # cylindrical bore with closed bottom
    "cross_hole",         # single hole perpendicular to main axis (not in PCD)
    "pcd_hole_pattern",   # group of cross holes at equal radius + equal angular spacing
    "chamfer",            # conical face (entry/exit taper)
    "countersink",        # cone + coaxial hole (tapered entry leading to a bore)
    "counterbore",        # two coaxial cylinders: large shallow + small deep
    "groove",             # narrow toroidal face (concave annular groove)
    "fillet",             # toroidal face (convex radius blend)
    "slot",               # elongated pocket terminating in arcs (end-mill path)
    "radial_slot",        # slot oriented radially on a turned OD
    "keyway",             # axial slot on OD for key/spline engagement
    "pocket",             # enclosed prismatic recess (all walls perpendicular or angled)
]

# ── Data structures ───────────────────────────────────────────────────────────


@dataclass
class CNCFeature:
    id: str
    type: FeatureType
    params: Dict           # geometry params — type-specific (see each builder method)
    confidence: float      # 0.0–1.0
    children: List[str] = field(default_factory=list)  # child feature IDs
    face_ids: List[int] = field(default_factory=list)  # OCC face ordinals → STL triangle lookup via face_map


@dataclass
class CNCFeatureTree:
    family: str            # "cnc_turned" | "mill_turn" | "cnc_milled"
    features: List[CNCFeature]
    extraction_version: str = "1.0"
    warnings: List[str] = field(default_factory=list)
    debug: Dict = field(default_factory=dict)  # face counts + recognizer used

    def to_dict(self) -> dict:
        by_type: Dict[str, int] = {}
        for f in self.features:
            by_type[f.type] = by_type.get(f.type, 0) + 1
        return {
            "family": self.family,
            "features": [
                {
                    "id": f.id,
                    "type": f.type,
                    "params": f.params,
                    "confidence": round(f.confidence, 3),
                    "children": f.children,
                    "face_ids": f.face_ids,
                }
                for f in self.features
            ],
            "feature_summary": by_type,
            "extraction_version": self.extraction_version,
            "warnings": self.warnings,
            "debug": self.debug,
        }


# ── Entry point ───────────────────────────────────────────────────────────────


class CNCFeatureRecognizer:
    """
    Usage:
        tree = CNCFeatureRecognizer().recognize(occ_shape, "cnc_turned")
        result_dict = tree.to_dict()
    """

    def recognize(self, shape, family: str) -> CNCFeatureTree:
        face_counts = _count_face_types(shape)
        n_cyl = face_counts["cyl"]
        n_planar = face_counts["planar"]
        n_cone = face_counts["cone"]
        n_torus = face_counts["torus"]

        logger.info(
            f"[cnc_features] family={family} "
            f"cyl_faces={n_cyl} "
            f"planar_faces={n_planar} "
            f"cone_faces={n_cone} "
            f"torus_faces={n_torus}"
        )

        debug: Dict = {
            "recognizer_used": family,
            "face_counts": face_counts,
            "candidate_features": {},  # filled in by each recognizer
        }

        if family in ("cnc_turned", "mill_turn"):
            tree = self._recognize_turned(shape, family)
        else:
            tree = self._recognize_milled(shape)

        debug["candidate_features"] = {f.type: f.params for f in tree.features[:10]}
        tree.debug = debug

        n_with_ids = sum(1 for f in tree.features if f.face_ids)
        sample = tree.features[0].face_ids[:5] if tree.features else []
        logger.info(
            f"[cnc_features] extracted {len(tree.features)} features "
            f"types={list({f.type for f in tree.features})} "
            f"face_ids_populated={n_with_ids}/{len(tree.features)} sample={sample}"
        )
        return tree

    # ── Turned / mill-turn recognition ───────────────────────────────────────

    def _recognize_turned(self, shape, family: str) -> CNCFeatureTree:
        features: List[CNCFeature] = []
        warnings: List[str] = []

        try:
            bbox = _part_bounding_box(shape)
        except Exception as exc:
            warnings.append(f"Bounding box failed: {exc}")
            return CNCFeatureTree(family=family, features=[], warnings=warnings)

        main_axis = self._dominant_cylinder_axis(shape)

        raw_cylinders = self._collect_cylinders(shape, main_axis, bbox)
        # Merge face patches of the same physical feature before emitting features.
        # Without this, OCC can represent a single bore or OD step as 2–8 separate
        # cylindrical face patches, inflating counts into the hundreds.
        cylinders = _deduplicate_cylinders(raw_cylinders)
        cones = self._collect_cones(shape)
        toroids = self._collect_toroids(shape)
        prismatic = self._collect_prismatic_pockets(shape, main_axis)

        kind_counts: Dict[str, int] = {}
        for c in cylinders:
            kind_counts[c["kind"]] = kind_counts.get(c["kind"], 0) + 1
        logger.info(
            f"[turned] raw_cyl={len(raw_cylinders)} deduped={len(cylinders)} "
            f"kinds={kind_counts} "
            f"cones={len(cones)} toroids={len(toroids)} prismatic={len(prismatic)}"
        )

        # ── Cylinders → external_diameter / through_hole / blind_hole / cross_hole ─
        # bore_id_to_cyl lets PCD detection read dist_from_axis and angle_deg after
        # bore features are emitted, without storing those fields in the public API.
        ext_idx = bore_idx = cross_idx = 0
        cross_feature_ids: List[str] = []
        bore_id_to_cyl: Dict[str, Dict] = {}

        for cyl in cylinders:
            diameter_mm = round(cyl["radius"] * 2.0, 3)
            kind = cyl["kind"]

            cx, cy, cz = cyl["centroid"]
            centroid = [round(cx, 3), round(cy, 3), round(cz, 3)]
            face_ids = cyl.get("face_indices", [])

            if kind == "external_diameter":
                features.append(CNCFeature(
                    id=f"od_{ext_idx}",
                    type="external_diameter",
                    params={
                        "diameter_mm": diameter_mm,
                        "length_mm": round(cyl["length"], 3),
                        "position_along_axis_mm": round(cyl["position"], 3),
                        "centroid": centroid,
                    },
                    confidence=0.90,
                    face_ids=face_ids,
                ))
                ext_idx += 1

            elif kind in ("through_hole", "blind_hole"):
                fid = f"bore_{bore_idx}"
                features.append(CNCFeature(
                    id=fid,
                    type=kind,
                    params={
                        "diameter_mm": diameter_mm,
                        "depth_mm": round(cyl["length"], 3),
                        "centroid": centroid,
                    },
                    confidence=0.85 if kind == "through_hole" else 0.80,
                    face_ids=face_ids,
                ))
                bore_id_to_cyl[fid] = cyl
                bore_idx += 1

            elif kind == "cross_hole":
                fid = f"cross_{cross_idx}"
                features.append(CNCFeature(
                    id=fid,
                    type="cross_hole",
                    params={
                        "diameter_mm": diameter_mm,
                        "depth_mm": round(cyl["length"], 3),
                        "distance_from_axis_mm": round(cyl["dist_from_axis"], 3),
                        "angle_deg": round(cyl.get("angle_deg", 0.0), 1),
                        "centroid": centroid,
                    },
                    confidence=0.75,
                    face_ids=face_ids,
                ))
                cross_feature_ids.append(fid)
                cross_idx += 1

        # ── PCD from axially-aligned bores (disc/flange/lens holder pattern) ─
        # PCD holes in a disc are parallel to the rotation axis, not cross holes.
        # They appear as through_hole/blind_hole with non-zero dist_from_axis.
        bore_features = [f for f in features if f.type in ("through_hole", "blind_hole")]
        bore_face_ids_map = {f.id: f.face_ids for f in bore_features}
        axial_pcd_groups = _detect_pcd_from_axial_bores(bore_features, bore_id_to_cyl)
        pcd_feature_idx = 0
        if axial_pcd_groups:
            absorbed_bores: set = set()
            for group_ids, pcd_params in axial_pcd_groups:
                pcd_face_ids = list(set(
                    fid for gid in group_ids for fid in bore_face_ids_map.get(gid, [])
                ))
                features.append(CNCFeature(
                    id=f"pcd_{pcd_feature_idx}",
                    type="pcd_hole_pattern",
                    params=pcd_params,
                    confidence=0.85,
                    children=group_ids,
                    face_ids=pcd_face_ids,
                ))
                absorbed_bores.update(group_ids)
                pcd_feature_idx += 1
            features = [f for f in features if f.id not in absorbed_bores]

        # ── Cross holes → PCD patterns (perpendicular-to-axis pattern) ───────
        cross_features = [f for f in features if f.id in cross_feature_ids]
        cross_face_ids_map = {f.id: f.face_ids for f in cross_features}
        perp_pcd_groups = _detect_pcd_patterns(cross_features)
        if perp_pcd_groups:
            grouped_ids: set = set()
            for group_ids in perp_pcd_groups:
                group = [f for f in cross_features if f.id in group_ids]
                sample = group[0]
                pcd_face_ids = list(set(
                    fid for gid in group_ids for fid in cross_face_ids_map.get(gid, [])
                ))
                features.append(CNCFeature(
                    id=f"pcd_{pcd_feature_idx}",
                    type="pcd_hole_pattern",
                    params={
                        "pcd_mm": round(sample.params["distance_from_axis_mm"] * 2.0, 3),
                        "hole_count": len(group),
                        "hole_diameter_mm": sample.params["diameter_mm"],
                    },
                    confidence=0.82,
                    children=group_ids,
                    face_ids=pcd_face_ids,
                ))
                grouped_ids.update(group_ids)
                pcd_feature_idx += 1
            features = [f for f in features if f.id not in grouped_ids]

        # ── Cones → chamfer or countersink ───────────────────────────────────
        for cone_idx, cone in enumerate(cones):
            ftype, params, conf = _classify_cone(cone, cylinders)
            features.append(CNCFeature(
                id=f"{ftype}_{cone_idx}",
                type=ftype,
                params=params,
                confidence=conf,
                face_ids=cone.get("face_indices", []),
            ))

        # ── Detect counterbores (coaxial cylinder pairs) ──────────────────────
        counterbores = _detect_counterbores(
            [f for f in features if f.type in ("through_hole", "blind_hole")],
            bore_id_to_cyl,
        )
        if counterbores:
            absorbed: set = set()
            for cb_idx, (outer_id, inner_id, params) in enumerate(counterbores):
                # Union face_ids from both constituent bores for visual coverage
                cb_face_ids = list(set(
                    bore_id_to_cyl.get(outer_id, {}).get("face_indices", []) +
                    bore_id_to_cyl.get(inner_id, {}).get("face_indices", [])
                ))
                features.append(CNCFeature(
                    id=f"cbore_{cb_idx}",
                    type="counterbore",
                    params=params,
                    confidence=0.78,
                    children=[outer_id, inner_id],
                    face_ids=cb_face_ids,
                ))
                absorbed.update([outer_id, inner_id])
            features = [f for f in features if f.id not in absorbed]

        # ── Toroids → groove / fillet ─────────────────────────────────────────
        for tor_idx, tor in enumerate(toroids):
            ftype = "groove" if tor["is_concave"] else "fillet"
            features.append(CNCFeature(
                id=f"{ftype}_{tor_idx}",
                type=ftype,
                params={
                    "major_diameter_mm": round(tor["major_radius"] * 2.0, 3),
                    "radius_mm": round(tor["minor_radius"], 3),
                },
                confidence=0.80,
                face_ids=tor.get("face_indices", []),
            ))

        # ── Prismatic pockets → slot / keyway only (skip structural faces) ────
        # Structural transition faces (shoulders, datums) are excluded by requiring
        # aspect ratio > 2.5. Generic "pocket" is not emitted from turned parts —
        # pockets on turned parts are either keyways or radial slots.
        p_idx = 0
        for p in prismatic:
            result = _classify_prismatic_turned(p, main_axis)
            if result is None:
                continue
            ftype, params = result
            features.append(CNCFeature(
                id=f"{ftype}_{p_idx}",
                type=ftype,
                params=params,
                confidence=0.70,
                face_ids=p.get("face_indices", []),
            ))
            p_idx += 1

        if not features:
            warnings.append(
                "No CNC features recognized. Family classification may be incorrect "
                "or geometry uses unsupported surface types."
            )

        return CNCFeatureTree(family=family, features=features, warnings=warnings)

    # ── cnc_milled recognizer ─────────────────────────────────────────────────

    def _recognize_milled(self, shape) -> CNCFeatureTree:
        """
        Prismatic / milled part recognition.

        No dominant rotation axis is assumed. All internal cylinders become
        through_hole or blind_hole; conical faces become chamfers; planar
        recesses become pockets or slots. No external_diameter is emitted.
        """
        features: List[CNCFeature] = []
        warnings: List[str] = []

        try:
            bbox = _part_bounding_box(shape)
        except Exception as exc:
            warnings.append(f"Bounding box failed: {exc}")
            return CNCFeatureTree(family="cnc_milled", features=[], warnings=warnings)

        # For milled parts the machining datum is the largest planar face.
        # Use dominant planar normal as the "Z axis" for through vs blind checks.
        datum_axis = self._dominant_planar_normal(shape)
        part_span = _axis_span(bbox, datum_axis)

        cylinders = self._collect_cylinders(shape, datum_axis, bbox)
        cones = self._collect_cones(shape)
        prismatic = self._collect_prismatic_pockets(shape, datum_axis)

        bore_idx = 0
        for cyl in cylinders:
            # Milled parts have no external_diameter — skip outward-facing cylinders
            if cyl["kind"] == "external_diameter":
                continue
            diameter_mm = round(cyl["radius"] * 2.0, 3)
            kind = cyl["kind"] if cyl["kind"] in ("through_hole", "blind_hole") else "blind_hole"
            cx, cy, cz = cyl["centroid"]
            features.append(CNCFeature(
                id=f"bore_{bore_idx}",
                type=kind,
                params={
                    "diameter_mm": diameter_mm,
                    "depth_mm": round(cyl["length"], 3),
                    "centroid": [round(cx, 3), round(cy, 3), round(cz, 3)],
                },
                confidence=0.80,
                face_ids=cyl.get("face_indices", []),
            ))
            bore_idx += 1

        # Counterbore detection
        bore_features = [f for f in features if f.type in ("through_hole", "blind_hole")]
        bore_face_ids = {f.id: f.face_ids for f in bore_features}
        counterbores = _detect_counterbores(bore_features)
        if counterbores:
            absorbed: set = set()
            for cb_idx, (outer_id, inner_id, params) in enumerate(counterbores):
                cb_face_ids = list(set(
                    bore_face_ids.get(outer_id, []) + bore_face_ids.get(inner_id, [])
                ))
                features.append(CNCFeature(
                    id=f"cbore_{cb_idx}",
                    type="counterbore",
                    params=params,
                    confidence=0.78,
                    children=[outer_id, inner_id],
                    face_ids=cb_face_ids,
                ))
                absorbed.update([outer_id, inner_id])
            features = [f for f in features if f.id not in absorbed]

        for cone_idx, cone in enumerate(cones):
            ftype, params, conf = _classify_cone(cone, cylinders)
            features.append(CNCFeature(
                id=f"{ftype}_{cone_idx}",
                type=ftype,
                params=params,
                confidence=conf,
                face_ids=cone.get("face_indices", []),
            ))

        for p_idx, p in enumerate(prismatic):
            ftype, params = _classify_prismatic(p, datum_axis)
            features.append(CNCFeature(
                id=f"{ftype}_{p_idx}",
                type=ftype,
                params=params,
                confidence=0.68,
                face_ids=p.get("face_indices", []),
            ))

        if not features:
            warnings.append(
                "No milled features recognized. Geometry may use unsupported surface types "
                "or the part may require manual feature tagging."
            )

        return CNCFeatureTree(family="cnc_milled", features=features, warnings=warnings)

    def _dominant_planar_normal(self, shape) -> Tuple[float, float, float]:
        """
        Returns the normal of the largest planar face (the machining datum for milled parts).
        Falls back to (0, 0, 1) if no planar faces found.
        """
        from OCC.Core.GeomAbs import GeomAbs_Plane  # type: ignore
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
        from OCC.Core.BRepGProp import brepgprop  # type: ignore
        from OCC.Core.GProp import GProp_GProps  # type: ignore

        best_area = 0.0
        best_normal = (0.0, 0.0, 1.0)
        exp = TopExp_Explorer(shape, TopAbs_FACE)
        while exp.More():
            face = exp.Current()
            surf = BRepAdaptor_Surface(face)
            if surf.GetType() == GeomAbs_Plane:
                try:
                    gprops = GProp_GProps()
                    brepgprop.SurfaceProperties(face, gprops)
                    area = gprops.Mass()
                    if area > best_area:
                        best_area = area
                        n = surf.Plane().Axis().Direction()
                        best_normal = (abs(n.X()), abs(n.Y()), abs(n.Z()))
                except Exception:
                    pass
            exp.Next()
        return best_normal

    # ── OCC collection helpers ────────────────────────────────────────────────

    def _dominant_cylinder_axis(self, shape) -> Tuple[float, float, float]:
        """
        Returns the dominant cylinder axis as a normalized unit vector.
        Votes are cast by each cylindrical face; the plurality wins.
        Falls back to (0, 0, 1) if the shape has no cylindrical faces.
        """
        from OCC.Core.GeomAbs import GeomAbs_Cylinder  # type: ignore
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore

        # Count-based voting (not radius-weighted) to match memory_optimizer.py's
        # _compute_cyl_signals, which correctly classifies this family.
        # Radius-weighted voting is biased toward fewer large features and can
        # mis-elect a perpendicular axis when many small bores dominate by count.
        votes: Dict[Tuple[float, float, float], int] = {}
        exp = TopExp_Explorer(shape, TopAbs_FACE)
        while exp.More():
            surf = BRepAdaptor_Surface(exp.Current())
            if surf.GetType() == GeomAbs_Cylinder:
                d = surf.Cylinder().Axis().Direction()
                # Snap to 2-decimal grid so near-parallel axes collapse to same key
                key = (round(abs(d.X()), 2), round(abs(d.Y()), 2), round(abs(d.Z()), 2))
                votes[key] = votes.get(key, 0) + 1
            exp.Next()

        if not votes:
            return (0.0, 0.0, 1.0)
        dominant = max(votes, key=lambda k: votes[k])
        logger.info(
            f"[cnc_features] dominant_axis={dominant} votes={votes[dominant]}/{sum(votes.values())}"
        )
        return dominant

    def _collect_cylinders(
        self,
        shape,
        main_axis: Tuple[float, float, float],
        bbox: Dict,
    ) -> List[Dict]:
        """
        Collects all cylindrical faces and classifies each as:
          external_diameter | through_hole | blind_hole | cross_hole

        Uses face orientation (FORWARD/REVERSED) for external vs internal.
        Uses axis alignment with main_axis for axial vs cross orientation.
        Uses length vs part span for through vs blind discrimination.
        """
        from OCC.Core.GeomAbs import GeomAbs_Cylinder  # type: ignore
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_FORWARD  # type: ignore
        from OCC.Core.BRepBndLib import brepbndlib  # type: ignore
        from OCC.Core.Bnd import Bnd_Box  # type: ignore

        ax, ay, az = main_axis
        axis_norm = math.sqrt(ax * ax + ay * ay + az * az) or 1.0
        ax, ay, az = ax / axis_norm, ay / axis_norm, az / axis_norm

        # Part span along main axis — used for through vs blind discrimination
        part_span = _axis_span(bbox, (ax, ay, az))

        results = []
        face_idx = 0
        exp = TopExp_Explorer(shape, TopAbs_FACE)
        while exp.More():
            face = exp.Current()
            surf = BRepAdaptor_Surface(face)
            if surf.GetType() == GeomAbs_Cylinder:
                cyl = surf.Cylinder()
                radius = cyl.Radius()
                loc = cyl.Location()
                d = cyl.Axis().Direction()

                # Normalize face axis
                fx, fy, fz = d.X(), d.Y(), d.Z()
                fn = math.sqrt(fx * fx + fy * fy + fz * fz) or 1.0
                fx, fy, fz = fx / fn, fy / fn, fz / fn

                # Alignment with main axis (1.0 = parallel, 0.0 = perpendicular)
                alignment = abs(fx * ax + fy * ay + fz * az)

                # Centroid of cylinder base along main axis
                cx, cy, cz = loc.X(), loc.Y(), loc.Z()
                position = cx * ax + cy * ay + cz * az

                # Distance from centroid to main axis (arbitrary orientation)
                dist_from_axis = _point_to_axis_distance((cx, cy, cz), (ax, ay, az))

                # Approximate length from face bounding box
                fbox = Bnd_Box()
                brepbndlib.Add(face, fbox)
                xmin, ymin, zmin, xmax, ymax, zmax = fbox.Get()
                face_span = _axis_span(
                    {"xmin": xmin, "ymin": ymin, "zmin": zmin,
                     "xmax": xmax, "ymax": ymax, "zmax": zmax},
                    (fx, fy, fz),
                )
                length = max(face_span, 0.1)

                is_reversed = face.Orientation() != TopAbs_FORWARD

                # Angular position of centroid around main axis (for PCD grouping)
                angle_deg = _angle_around_axis((cx, cy, cz), (ax, ay, az))

                if alignment >= 0.85:
                    # Axially aligned cylinder
                    if is_reversed:
                        # Inner surface → bore. Through vs blind from length/span ratio.
                        if part_span > 0 and (length / part_span) > 0.90:
                            kind = "through_hole"
                        else:
                            kind = "blind_hole"
                    else:
                        kind = "external_diameter"
                else:
                    kind = "cross_hole"

                # Arc extent in the U (angular) direction — 2π = full cylinder.
                # Used by _deduplicate_cylinders to distinguish arc patches of
                # one bore (each ~π/2, total ≈ 2π) from separate holes
                # (each ≈ 2π, total >> 2π).
                u_range = abs(surf.LastUParameter() - surf.FirstUParameter())

                results.append({
                    "radius": radius,
                    "length": length,
                    "position": position,
                    "kind": kind,
                    "axis": (fx, fy, fz),
                    "centroid": (cx, cy, cz),
                    "dist_from_axis": dist_from_axis,
                    "angle_deg": angle_deg,
                    "u_range": u_range,
                    "face_indices": [face_idx],  # OCC face ordinal — matches face_map in memory_optimizer
                })
            face_idx += 1  # increment for EVERY face, not just cylinders
            exp.Next()

        return results

    def _collect_cones(self, shape) -> List[Dict]:
        from OCC.Core.GeomAbs import GeomAbs_Cone  # type: ignore
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_FORWARD  # type: ignore

        results = []
        face_idx = 0
        exp = TopExp_Explorer(shape, TopAbs_FACE)
        while exp.More():
            face = exp.Current()
            surf = BRepAdaptor_Surface(face)
            if surf.GetType() == GeomAbs_Cone:
                cone = surf.Cone()
                half_angle_deg = abs(math.degrees(cone.SemiAngle()))
                loc = cone.Location()
                ref_radius = cone.RefRadius()
                is_reversed = face.Orientation() != TopAbs_FORWARD
                results.append({
                    "half_angle_deg": half_angle_deg,
                    "ref_radius": ref_radius,
                    "centroid": (loc.X(), loc.Y(), loc.Z()),
                    "is_reversed": is_reversed,
                    "face_indices": [face_idx],  # OCC face ordinal — matches face_map in memory_optimizer
                })
            face_idx += 1  # increment for EVERY face, not just cones
            exp.Next()
        return results

    def _collect_toroids(self, shape) -> List[Dict]:
        from OCC.Core.GeomAbs import GeomAbs_Torus  # type: ignore
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_FORWARD  # type: ignore

        results = []
        face_idx = 0
        exp = TopExp_Explorer(shape, TopAbs_FACE)
        while exp.More():
            face = exp.Current()
            surf = BRepAdaptor_Surface(face)
            if surf.GetType() == GeomAbs_Torus:
                tor = surf.Torus()
                minor_r = tor.MinorRadius()
                if minor_r >= _MIN_FILLET_RADIUS_MM:
                    is_concave = face.Orientation() != TopAbs_FORWARD
                    results.append({
                        "major_radius": tor.MajorRadius(),
                        "minor_radius": minor_r,
                        "is_concave": is_concave,
                        "face_indices": [face_idx],  # OCC face ordinal — matches face_map in memory_optimizer
                    })
            face_idx += 1  # increment for EVERY face, not just toroids
            exp.Next()

        if len(results) > 500:
            logger.warning(
                f"[cnc_recognizer] {len(results)} torus faces after radius filter — "
                f"likely STEP quality issue; suppressing all fillet/groove features"
            )
            return []
        return results

    def _collect_prismatic_pockets(self, shape, main_axis: Tuple[float, float, float]) -> List[Dict]:
        """
        Detects enclosed planar-walled recesses for slot / keyway / pocket classification.
        Phase 1: uses face-count heuristics. Phase 2 will use full wire topology.
        """
        from OCC.Core.GeomAbs import GeomAbs_Plane  # type: ignore
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
        from OCC.Core.BRepBndLib import brepbndlib  # type: ignore
        from OCC.Core.Bnd import Bnd_Box  # type: ignore

        ax, ay, az = main_axis
        pockets = []
        face_idx = 0
        exp = TopExp_Explorer(shape, TopAbs_FACE)
        while exp.More():
            face = exp.Current()
            surf = BRepAdaptor_Surface(face)
            if surf.GetType() == GeomAbs_Plane:
                plane = surf.Plane()
                n = plane.Axis().Direction()
                nx, ny, nz = n.X(), n.Y(), n.Z()
                # Only include faces whose normal is perpendicular to the main axis
                # (these are pocket floor faces, not end faces)
                dot_with_axis = abs(nx * ax + ny * ay + nz * az)
                if dot_with_axis > 0.85:
                    fbox = Bnd_Box()
                    brepbndlib.Add(face, fbox)
                    xmin, ymin, zmin, xmax, ymax, zmax = fbox.Get()
                    dx, dy, dz = xmax - xmin, ymax - ymin, zmax - zmin
                    dims = sorted([dx, dy, dz])
                    pockets.append({
                        "normal": (nx, ny, nz),
                        "dims": dims,
                        "centroid": (
                            (xmin + xmax) / 2,
                            (ymin + ymax) / 2,
                            (zmin + zmax) / 2,
                        ),
                        "face_indices": [face_idx],  # OCC face ordinal — matches face_map in memory_optimizer
                    })
            face_idx += 1  # increment for EVERY face, not just planes
            exp.Next()
        return pockets


# ── Face type counter (used for logging + debug JSON) ────────────────────────


def _count_face_types(shape) -> Dict[str, int]:
    """
    Single-pass count of face surface types. Used for diagnostic logging.
    Returns dict with keys: cyl, planar, cone, torus, other, total.
    """
    from OCC.Core.GeomAbs import (  # type: ignore
        GeomAbs_Cylinder, GeomAbs_Plane, GeomAbs_Cone, GeomAbs_Torus,
    )
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore

    counts = {"cyl": 0, "planar": 0, "cone": 0, "torus": 0, "other": 0, "total": 0}
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        st = BRepAdaptor_Surface(exp.Current()).GetType()
        counts["total"] += 1
        if st == GeomAbs_Cylinder:
            counts["cyl"] += 1
        elif st == GeomAbs_Plane:
            counts["planar"] += 1
        elif st == GeomAbs_Cone:
            counts["cone"] += 1
        elif st == GeomAbs_Torus:
            counts["torus"] += 1
        else:
            counts["other"] += 1
        exp.Next()
    return counts


# ── Deduplication ────────────────────────────────────────────────────────────


def _deduplicate_cylinders(raw: List[Dict]) -> List[Dict]:
    """
    Merges OCC face patches that represent the same physical cylindrical feature.

    OCC parameterises curved surfaces as NURBS patches. One bore or OD step can
    appear as 2–8 arc-segment patches with identical radius, axis, and position
    but different angular extents. Each patch has a u_range (arc extent in radians).

    Merge criterion: within each (kind, radius, position, dist_from_axis) bucket,
    if the SUM of u_range values ≤ 1.1 × 2π the patches together cover at most
    one full revolution — they are arc segments of the same feature and are merged
    (keeping the patch with maximum length as the representative).

    If the sum exceeds 1.1 × 2π the bucket contains multiple separate physical
    holes (e.g. 4 PCD holes each with u_range ≈ 2π → sum ≈ 8π) and all entries
    are kept as individual features.

    Grouping tolerances:
      - radius        0.5 mm
      - position      3.0 mm  (patches of the same axial step share ≈same centroid)
      - dist_from_axis 2.0 mm (cross holes at different radii stay separate)
    """
    ONE_CIRCLE = 2.0 * math.pi

    buckets: Dict[Tuple, List[Dict]] = {}
    for cyl in raw:
        r_key    = round(cyl["radius"]          / 0.5) * 0.5
        pos_key  = round(cyl["position"]         / 3.0) * 3.0
        dist_key = round(cyl["dist_from_axis"]   / 2.0) * 2.0
        key = (cyl["kind"], r_key, pos_key, dist_key)
        buckets.setdefault(key, []).append(cyl)

    result: List[Dict] = []
    for group in buckets.values():
        if len(group) == 1:
            result.append(group[0])
            continue
        total_arc = sum(c.get("u_range", ONE_CIRCLE) for c in group)
        if total_arc <= 1.1 * ONE_CIRCLE:
            # Arc patches of one bore/OD — merge, keeping best length estimate
            rep = dict(max(group, key=lambda c: c["length"]))
            merged_face_indices: List[int] = []
            for c in group:
                merged_face_indices.extend(c.get("face_indices", []))
            rep["face_indices"] = merged_face_indices
            result.append(rep)
        else:
            # Multiple separate holes sharing radius and position (e.g. PCD holes)
            result.extend(group)

    return result


# ── Classification helpers ────────────────────────────────────────────────────


def _classify_cone(
    cone: Dict,
    cylinders: List[Dict],
) -> Tuple[FeatureType, Dict, float]:
    """
    A cone is a countersink if there is a coaxial cylinder immediately below it.
    Otherwise it is a chamfer.
    """
    cx, cy, cz = cone["centroid"]
    half_angle = cone["half_angle_deg"]
    ref_r = cone["ref_radius"]

    # Check for coaxial adjacent cylinder (within 5 mm centroid proximity)
    for cyl in cylinders:
        if cyl["kind"] in ("through_hole", "blind_hole"):
            dcx, dcy, dcz = cyl["centroid"]
            dist = math.sqrt((cx - dcx) ** 2 + (cy - dcy) ** 2 + (cz - dcz) ** 2)
            if dist < 5.0 and cyl["radius"] < ref_r:
                return "countersink", {
                    "entry_diameter_mm": round(ref_r * 2.0, 3),
                    "bore_diameter_mm": round(cyl["radius"] * 2.0, 3),
                    "half_angle_deg": round(half_angle, 1),
                }, 0.78

    return "chamfer", {
        "half_angle_deg": round(half_angle, 1),
        "diameter_mm": round(ref_r * 2.0, 3),
    }, 0.85


def _classify_prismatic(pocket: Dict, main_axis: Tuple[float, float, float]) -> Tuple[FeatureType, Dict]:
    """
    Classify a planar floor face into slot / radial_slot / keyway / pocket.

    slot       : elongated (length/width > 3) with axis roughly perpendicular to main axis
    radial_slot: elongated, oriented radially on a turned OD
    keyway     : elongated parallel to main axis, shallow depth
    pocket     : default — enclosed planar recess
    """
    dims = pocket["dims"]
    short, mid, long = dims[0], dims[1], dims[2]
    aspect = long / max(mid, 0.1)

    nx, ny, nz = pocket["normal"]
    ax, ay, az = main_axis

    # Slot: elongated + floor normal parallel to main axis (floor faces axially downward)
    dot = abs(nx * ax + ny * ay + nz * az)
    if aspect > 2.5 and dot > 0.85:
        # Check if the long dimension is parallel or perpendicular to main axis
        # Keyway: long axis parallel to main rotation axis
        # Slot / radial_slot: long axis perpendicular
        return "keyway", {
            "width_mm": round(mid, 3),
            "depth_mm": round(short, 3),
        }

    if aspect > 2.5:
        return "slot", {
            "length_mm": round(long, 3),
            "width_mm": round(mid, 3),
            "depth_mm": round(short, 3),
        }

    return "pocket", {
        "length_mm": round(long, 3),
        "width_mm": round(mid, 3),
        "depth_mm": round(short, 3),
    }


def _classify_prismatic_turned(
    pocket: Dict,
    main_axis: Tuple[float, float, float],
) -> Optional[Tuple[FeatureType, Dict]]:
    """
    Classify a prismatic face collected from a turned part.
    Returns None for structural/transition faces (end faces, shoulders, datums).

    Only keyway and slot are emitted from turned parts — generic "pocket" is not
    valid here because pockets on turned ODs are either keyways (parallel to axis)
    or radial slots (perpendicular). Structural faces are filtered by aspect < 2.5.
    """
    dims = pocket["dims"]
    short, mid, long = dims[0], dims[1], dims[2]
    if mid < 0.1:
        return None
    aspect = long / mid
    if aspect < 2.5:
        return None  # structural transition face, shoulder, or datum face

    nx, ny, nz = pocket["normal"]
    ax, ay, az = main_axis
    dot_with_axis = abs(nx * ax + ny * ay + nz * az)

    if dot_with_axis > 0.85:
        # Floor normal is parallel to axis → keyway running along the shaft
        return "keyway", {
            "width_mm": round(mid, 3),
            "depth_mm": round(short, 3),
        }

    # Elongated face with normal perpendicular to axis → radial slot on OD
    return "radial_slot", {
        "length_mm": round(long, 3),
        "width_mm": round(mid, 3),
        "depth_mm": round(short, 3),
    }


def _detect_pcd_from_axial_bores(
    bore_features: List[CNCFeature],
    bore_id_to_cyl: Dict[str, Dict],
) -> List[Tuple[List[str], Dict]]:
    """
    Detects PCD (Pitch Circle Diameter) patterns from axially-aligned bores.

    On disc/flange/lens-holder parts, PCD holes run parallel to the rotation axis
    and appear as through_hole or blind_hole entries with non-zero dist_from_axis.
    This is different from cross_hole PCD patterns where holes are perpendicular
    to the axis (found on shafts or cylindrical bodies).

    Grouping criteria (all must match):
      1. dist_from_axis > 3 mm  — excludes the central bore on-axis
      2. Same hole diameter     — ±0.1 mm bucket
      3. Same radial distance   — ±1 mm bucket
      4. Equal angular spacing  — within ±10°

    Returns list of (group_ids, pcd_params_dict).
    """
    MIN_DIST_MM = 3.0  # bores closer to axis than this are central, not PCD

    off_axis: List[Tuple[CNCFeature, Dict]] = []
    for f in bore_features:
        cyl = bore_id_to_cyl.get(f.id)
        if cyl and cyl["dist_from_axis"] > MIN_DIST_MM:
            off_axis.append((f, cyl))

    if len(off_axis) < 2:
        return []

    # Bucket by (diameter_key, radial_distance_key)
    buckets: Dict[Tuple[float, float], List[Tuple[CNCFeature, Dict]]] = {}
    for f, cyl in off_axis:
        d_key = round(f.params["diameter_mm"] / 0.1) * 0.1
        r_key = round(cyl["dist_from_axis"] / 1.0) * 1.0
        buckets.setdefault((d_key, r_key), []).append((f, cyl))

    results: List[Tuple[List[str], Dict]] = []
    for (d_key, r_key), group in buckets.items():
        if len(group) < 2:
            continue
        angles = sorted(cyl["angle_deg"] for _, cyl in group)
        if not _angles_equally_spaced(angles, tolerance_deg=10.0):
            continue
        group_ids = [f.id for f, _ in group]
        avg_depth = round(sum(f.params["depth_mm"] for f, _ in group) / len(group), 3)
        results.append((group_ids, {
            "pcd_mm": round(r_key * 2.0, 3),
            "hole_count": len(group),
            "hole_diameter_mm": d_key,
            "depth_mm": avg_depth,
        }))

    return results


def _detect_pcd_patterns(cross_features: List[CNCFeature]) -> List[List[str]]:
    """
    Groups cross holes into PCD (Pitch Circle Diameter) patterns.

    Grouping criteria (all three must match):
      1. Same hole diameter       — within ±0.1 mm
      2. Same distance from axis  — within ±0.5 mm
      3. Equal angular spacing    — each hole is N/count × 360° from the next,
                                    within ±8°

    Returns list of groups, each group is a list of feature IDs.
    Only groups with ≥ 2 holes that pass the angular spacing check are returned.
    """
    if len(cross_features) < 2:
        return []

    # Bucket by (diameter_key, radius_key)
    buckets: Dict[Tuple[float, float], List[CNCFeature]] = {}
    for f in cross_features:
        d_key = round(f.params["diameter_mm"] / 0.1) * 0.1
        r_key = round(f.params["distance_from_axis_mm"] / 0.5) * 0.5
        key = (d_key, r_key)
        buckets.setdefault(key, []).append(f)

    pcd_groups: List[List[str]] = []
    for group in buckets.values():
        if len(group) < 2:
            continue
        angles = sorted(f.params.get("angle_deg", 0.0) for f in group)
        if _angles_equally_spaced(angles, tolerance_deg=8.0):
            pcd_groups.append([f.id for f in group])

    return pcd_groups


def _angles_equally_spaced(angles: List[float], tolerance_deg: float = 8.0) -> bool:
    """
    Returns True if the sorted list of angles (0–360) represents equally spaced
    positions around a circle, within the given tolerance.
    """
    n = len(angles)
    if n < 2:
        return False
    expected_step = 360.0 / n
    for i in range(n):
        next_angle = angles[(i + 1) % n]
        curr_angle = angles[i]
        gap = (next_angle - curr_angle) % 360.0
        if abs(gap - expected_step) > tolerance_deg:
            return False
    return True


def _detect_counterbores(
    bore_features: List[CNCFeature],
    bore_id_to_cyl: Optional[Dict[str, Dict]] = None,
) -> List[Tuple[str, str, Dict]]:
    """
    Identifies counterbore pairs: two coaxial bores where the outer is larger
    and shallower than the inner.

    Returns list of (outer_id, inner_id, params).
    """
    MAX_COAXIAL_DIST_MM = 5.0
    results = []
    checked: set = set()
    for i, outer in enumerate(bore_features):
        for j, inner in enumerate(bore_features):
            if i >= j:
                continue
            pair_key = (outer.id, inner.id)
            if pair_key in checked:
                continue
            checked.add(pair_key)
            od = outer.params["diameter_mm"]
            id_ = inner.params["diameter_mm"]
            if od <= id_:
                continue
            if bore_id_to_cyl:
                oc = bore_id_to_cyl.get(outer.id, {}).get("centroid")
                ic = bore_id_to_cyl.get(inner.id, {}).get("centroid")
                if oc and ic:
                    dist = math.sqrt(sum((a - b) ** 2 for a, b in zip(oc, ic)))
                    if dist > MAX_COAXIAL_DIST_MM:
                        continue
            outer_depth = outer.params["depth_mm"]
            inner_depth = inner.params["depth_mm"]
            if outer_depth >= inner_depth:
                continue
            results.append((outer.id, inner.id, {
                "counterbore_diameter_mm": od,
                "counterbore_depth_mm": round(outer_depth, 3),
                "bore_diameter_mm": id_,
                "bore_depth_mm": round(inner_depth, 3),
            }))
    return results


# ── Geometry utilities ────────────────────────────────────────────────────────


def _point_to_axis_distance(
    point: Tuple[float, float, float],
    axis_unit: Tuple[float, float, float],
) -> float:
    """
    Distance from a point to a line through the origin with direction axis_unit.
    Works for arbitrary axis orientation via cross-product magnitude.
    """
    px, py, pz = point
    ax, ay, az = axis_unit
    # |P × axis| where P = point vector, axis = unit vector
    cx = py * az - pz * ay
    cy = pz * ax - px * az
    cz = px * ay - py * ax
    return math.sqrt(cx * cx + cy * cy + cz * cz)


def _angle_around_axis(
    point: Tuple[float, float, float],
    axis_unit: Tuple[float, float, float],
) -> float:
    """
    Angular position (0–360°) of a point projected onto the plane perpendicular
    to axis_unit. Uses a fixed reference vector perpendicular to the axis.
    """
    px, py, pz = point
    ax, ay, az = axis_unit

    # Project point onto plane perpendicular to axis
    dot = px * ax + py * ay + pz * az
    rx = px - dot * ax
    ry = py - dot * ay
    rz = pz - dot * az

    if math.sqrt(rx * rx + ry * ry + rz * rz) < 1e-6:
        return 0.0

    # Build a stable reference vector perpendicular to axis
    if abs(ax) < 0.9:
        ref = (1.0, 0.0, 0.0)
    else:
        ref = (0.0, 1.0, 0.0)
    # Gram-Schmidt: remove axis component from ref
    d = ref[0] * ax + ref[1] * ay + ref[2] * az
    ux = ref[0] - d * ax
    uy = ref[1] - d * ay
    uz = ref[2] - d * az
    un = math.sqrt(ux * ux + uy * uy + uz * uz) or 1.0
    ux, uy, uz = ux / un, uy / un, uz / un

    # Perpendicular reference: v = axis × u
    vx = ay * uz - az * uy
    vy = az * ux - ax * uz
    vz = ax * uy - ay * ux

    cosine = rx * ux + ry * uy + rz * uz
    sine = rx * vx + ry * vy + rz * vz
    angle = math.degrees(math.atan2(sine, cosine))
    return angle % 360.0


def _axis_span(bbox: Dict, axis_unit: Tuple[float, float, float]) -> float:
    """
    Returns the extent of the bounding box projected onto the given axis unit vector.
    """
    corners = [
        (bbox["xmin"], bbox["ymin"], bbox["zmin"]),
        (bbox["xmax"], bbox["ymin"], bbox["zmin"]),
        (bbox["xmin"], bbox["ymax"], bbox["zmin"]),
        (bbox["xmax"], bbox["ymax"], bbox["zmin"]),
        (bbox["xmin"], bbox["ymin"], bbox["zmax"]),
        (bbox["xmax"], bbox["ymin"], bbox["zmax"]),
        (bbox["xmin"], bbox["ymax"], bbox["zmax"]),
        (bbox["xmax"], bbox["ymax"], bbox["zmax"]),
    ]
    ax, ay, az = axis_unit
    projections = [x * ax + y * ay + z * az for x, y, z in corners]
    return max(projections) - min(projections)


def _part_bounding_box(shape) -> Dict:
    from OCC.Core.BRepBndLib import brepbndlib  # type: ignore
    from OCC.Core.Bnd import Bnd_Box  # type: ignore

    bbox = Bnd_Box()
    brepbndlib.Add(shape, bbox)
    xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()
    return {
        "xmin": xmin, "ymin": ymin, "zmin": zmin,
        "xmax": xmax, "ymax": ymax, "zmax": zmax,
    }
