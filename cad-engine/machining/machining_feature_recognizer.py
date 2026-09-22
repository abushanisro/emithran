"""
Machining Feature Recognizer — geometry-detection orchestration.

RENAMED 2026-09-19 from cnc_feature_recognizer.py / CNCFeatureRecognizer per
the "Machining is the canonical domain, not CNC" architecture mandate: any
3D CAD/STEP upload enters the Machining feature-extraction pipeline
(STEP/3D CAD -> MachiningFeatureRecognizer -> MachiningFeatureTree), and
"CNC" is no longer the name of the root feature-recognition architecture.
"CNC" remains ONLY where it already is a genuine, existing manufacturing/
process classification required by the live DB-driven taxonomy -- the real
"cnc_turned"/"mill_turn"/"cnc_milled" family strings this recognize()
still accepts and returns (read throughout the backend's costing code,
e.g. bom-items.service.ts's `family === 'cnc_milled'` checks), and the real
wire-format key "cnc_features" the backend already reads in ~15 places
(main.py's response, auto-fill.service.ts, bom-items.service.ts). Neither
is part of this rename -- both are deliberately left exactly as they
already are; renaming either would touch working, unrelated costing/
persistence code this refactor is not scoped to touch.

Converts raw OCC topology into a structured manufacturing feature tree that
resembles eMithran's feature representation rather than a flat face inventory.
This module owns ONLY the orchestration (MachiningFeatureRecognizer.recognize()
and its two family-specific passes, plus the build_machining_feature_graph_v2
synthesis layer that shapes raw MachiningFeatures into feature_graph_v2). It
does not compute cost, hold machine rates, or hardcode the operation catalog
-- operation names resolve downstream through the real, DB-driven
resolveMachiningOperationCategories/resolveOperationName (backend
TypeScript), never here.

LAYERING (three layers, per the Machining architecture mandate):

  Layer 1 — Geometry (OCC faces/edges/vertices/surfaces/topology, real B-Rep
  references): shared/machining_geometry.py's collect_cylinders and this
  file's own _collect_cones/_collect_toroids/_collect_prismatic_pockets/
  _count_face_types, plus face_classification.py's _build_face_graph.

  Layer 2 — Machining Features (holes, pockets, slots, grooves, chamfers,
  counterbores, countersinks, fillets, planar faces, curved walls, curved
  surfaces, multi-step holes, cutouts): the detector modules below,
  orchestrated into MachiningFeature objects by this file's two
  family-specific recognize() passes.

  Layer 3 — Manufacturing Operations: resolved downstream through the
  existing DB-driven resolveMachiningOperationCategories/
  resolveOperationName (backend TypeScript, process_taxonomy /
  process_taxonomy_operations / mhr_records / operations_full.json) --
  never hardcoded here.

MODULE MAP (established 2026-09-19, per the machining feature-extraction
architecture plan):
  machining/feature_models.py       — MachiningFeatureType/MachiningFeature/
                                       MachiningFeatureTree (canonical data
                                       shapes, no detection logic)
  shared/machining_geometry.py      — real, cross-domain geometry primitives:
                                       tap-drill classification (hole
                                       detector's classification step),
                                       cone classification (chamfer/
                                       countersink detector), coaxial-bore
                                       detection (counterbore detector),
                                       multi-step-hole detection, axis/bbox
                                       utilities, raw cylinder collection
                                       (hole detector's raw geometry pass)
                                       -- Sheet Metal (feature_extractor.py,
                                       forming_spike.py) already depends on
                                       these directly, confirmed live, not
                                       speculative.
  machining/face_classification.py  — general milled-face surface/region
                                       detector (PlanarFace/CurvedWall/
                                       CurvedSurface) and the cutout
                                       detector (polygon kept as a
                                       documented, not-wired spike).
  machining/machining_feature_recognizer.py (this file) — orchestration
                                       only: the two family-specific
                                       recognize() passes; the toroid
                                       detector (_collect_toroids, fillet/
                                       groove) and prismatic detector
                                       (_collect_prismatic_pockets/
                                       _classify_prismatic*, pocket/slot/
                                       keyway) remain here since they are
                                       tightly coupled to each family's own
                                       axis/datum resolution, which is
                                       itself part of the orchestration;
                                       PCD grouping/dedup; and the
                                       feature_graph_v2 synthesis layer.
All of the above re-export cleanly through this file's own top-of-file
imports, so every existing import path (including Sheet Metal's real
`from machining.machining_feature_recognizer import MachiningFeature` /
`_TAP_DRILL_RANGES` / etc.) keeps working unchanged.

Covers cnc_turned and mill_turn parts (_recognize_turned):
  external_diameter, through_hole, blind_hole, cross_hole, pcd_hole_pattern,
  chamfer, groove, fillet, slot, radial_slot, pocket, counterbore,
  countersink, keyway, multi_step_hole

cnc_milled (_recognize_milled) covers the same feature set as the turned
path minus the turning-specific ones (external_diameter, pcd_hole_pattern,
radial_slot), using generic "pocket" instead of the turned-only keyway/
radial_slot split, plus the milled-only Phase 3-5 additions: planar_face/
curved_wall/curved_surface (general face classification) and cutout
(non-circular through-openings).

Thread detection here is geometry-heuristic only (tap-drill-diameter table),
confidence-capped accordingly -- not sourced from PMI/drawing data. Threads
sourced from PMI/drawing data are merged separately by the backend process
planner.
"""
from __future__ import annotations

import logging
import math
from typing import Dict, List, Optional, Tuple

# ── Extracted 2026-09-19 per the machining feature-extraction architecture
# plan's layer-separation requirement: canonical feature data structures
# live in feature_models.py; cross-domain geometry primitives (already
# real, live-used by Sheet Metal -- see shared/machining_geometry.py's own
# module doc comment for the confirmed import sites) live in shared/.
# Re-exported here under their original private names so every existing
# call site in THIS file, and every existing external import (Sheet
# Metal's real `from machining.machining_feature_recognizer import
# _TAP_DRILL_RANGES` / `MachiningFeature` / etc.), keeps working unchanged.
from .feature_models import MachiningFeatureType, MachiningFeature, MachiningFeatureTree
from shared.machining_geometry import (
    TAP_DRILL_RANGES as _TAP_DRILL_RANGES,
    HELICOIL_DRILL_RANGES as _HELICOIL_DRILL_RANGES,
    MAX_COAXIAL_DIST_MM as _MAX_COAXIAL_DIST_MM,
    classify_hole as _classify_hole,
    annotate_hole_depth as _annotate_hole_depth,
    classify_cone as _classify_cone,
    detect_counterbores as _detect_counterbores,
    detect_multistep_holes as _detect_multistep_holes,
    point_to_axis_distance as _point_to_axis_distance,
    angle_around_axis as _angle_around_axis,
    axis_range as _axis_range,
    axis_span as _axis_span,
    part_bounding_box as _part_bounding_box,
    collect_cylinders as _collect_cylinders_fn,
)

logger = logging.getLogger(__name__)

# Toroidal faces with minor radius below this are sub-mm blend arcs on complex STEP models,
# not manufacturable fillets. Without this floor, a single STEP file can yield 10,000+ "fillets".
_MIN_FILLET_RADIUS_MM = 0.5

# A planar face whose position along the main/datum axis is within this
# tolerance of the part's own bounding-box extreme (min or max) is the
# part's own outer boundary/end face, not a real pocket floor -- see
# _collect_prismatic_pockets' own doc comment for the bug this closes.
_STRUCTURAL_FACE_AXIS_TOL_MM = 0.05


# ── Entry point ───────────────────────────────────────────────────────────────


class MachiningFeatureRecognizer:
    """
    Usage:
        tree = MachiningFeatureRecognizer().recognize(occ_shape, "cnc_turned")
        result_dict = tree.to_dict()
    """

    def recognize(self, shape, family: str) -> MachiningFeatureTree:
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

    def _recognize_turned(self, shape, family: str) -> MachiningFeatureTree:
        features: List[MachiningFeature] = []
        warnings: List[str] = []

        try:
            bbox = _part_bounding_box(shape)
        except Exception as exc:
            warnings.append(f"Bounding box failed: {exc}")
            return MachiningFeatureTree(family=family, features=[], warnings=warnings)

        main_axis = self._dominant_cylinder_axis(shape)

        raw_cylinders = self._collect_cylinders(shape, main_axis, bbox)
        # Merge face patches of the same physical feature before emitting features.
        # Without this, OCC can represent a single bore or OD step as 2–8 separate
        # cylindrical face patches, inflating counts into the hundreds.
        cylinders = _deduplicate_cylinders(raw_cylinders)
        cones = self._collect_cones(shape)
        toroids = self._collect_toroids(shape)
        prismatic = self._collect_prismatic_pockets(shape, main_axis, bbox)

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
                features.append(MachiningFeature(
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
                emit_type, tap_spec, is_helicoil = _classify_hole(
                    diameter_mm, through=(kind == "through_hole"),
                )

                params: Dict = {
                    "diameter_mm": diameter_mm,
                    "depth_mm": round(cyl["length"], 3),
                    "centroid": centroid,
                }
                _annotate_hole_depth(params, diameter_mm, cyl["length"])
                if tap_spec:
                    params["spec"] = tap_spec
                    params["detection"] = "geometry_heuristic"
                    params["through"] = kind == "through_hole"
                    if is_helicoil:
                        params["helicoil_candidate"] = True

                features.append(MachiningFeature(
                    id=fid,
                    type=emit_type,
                    params=params,
                    confidence=0.85 if emit_type == "through_hole" else (0.55 if tap_spec else 0.80),
                    face_ids=face_ids,
                ))
                bore_id_to_cyl[fid] = cyl
                bore_idx += 1

            elif kind == "cross_hole":
                fid = f"cross_{cross_idx}"
                cross_params: Dict = {
                    "diameter_mm": diameter_mm,
                    "depth_mm": round(cyl["length"], 3),
                    "distance_from_axis_mm": round(cyl["dist_from_axis"], 3),
                    "angle_deg": round(cyl.get("angle_deg", 0.0), 1),
                    "centroid": centroid,
                }
                _annotate_hole_depth(cross_params, diameter_mm, cyl["length"])
                features.append(MachiningFeature(
                    id=fid,
                    type="cross_hole",
                    params=cross_params,
                    confidence=0.75,
                    face_ids=face_ids,
                ))
                cross_feature_ids.append(fid)
                cross_idx += 1

        # ── PCD from axially-aligned bores (disc/flange/lens holder pattern) ─
        # PCD holes in a disc are parallel to the rotation axis, not cross holes.
        # They appear as through_hole/blind_hole/tapped_hole with non-zero dist_from_axis.
        bore_features = [f for f in features if f.type in ("through_hole", "blind_hole", "tapped_hole")]
        bore_face_ids_map = {f.id: f.face_ids for f in bore_features}
        axial_pcd_groups = _detect_pcd_from_axial_bores(bore_features, bore_id_to_cyl)
        pcd_feature_idx = 0
        if axial_pcd_groups:
            absorbed_bores: set = set()
            for group_ids, pcd_params in axial_pcd_groups:
                pcd_face_ids = list(set(
                    fid for gid in group_ids for fid in bore_face_ids_map.get(gid, [])
                ))
                # If all holes in the group are tapped, propagate the spec + helicoil flag
                group_features = [f for f in bore_features if f.id in group_ids]
                tap_specs = [f.params.get("spec") for f in group_features if f.type == "tapped_hole"]
                if tap_specs and all(s == tap_specs[0] for s in tap_specs):
                    pcd_params = {**pcd_params, "tap_spec": tap_specs[0], "hole_type": "tapped"}
                    if any(f.params.get("helicoil_candidate") for f in group_features):
                        pcd_params["helicoil_candidate"] = True
                features.append(MachiningFeature(
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
                features.append(MachiningFeature(
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
            features.append(MachiningFeature(
                id=f"{ftype}_{cone_idx}",
                type=ftype,
                params=params,
                confidence=conf,
                face_ids=cone.get("face_indices", []),
            ))

        # ── Detect multi-step holes (3+ coaxial bores) BEFORE counterbores —
        # a real 3-step hole must not ALSO be reported as two overlapping
        # 2-way counterbore pairs. See _detect_multistep_holes' own doc
        # comment (Phase 5, "Multistep Holemaking", 72 real catalog rows).
        multistep_bores = [f for f in features if f.type in ("through_hole", "blind_hole")]
        multistep_groups = _detect_multistep_holes(multistep_bores, bore_id_to_cyl)
        multistep_absorbed: set = set()
        for ms_idx, (member_ids, ms_params) in enumerate(multistep_groups):
            features.append(MachiningFeature(
                id=f"mstep_{ms_idx}",
                type="multi_step_hole",
                params=ms_params,
                confidence=0.75,
                children=member_ids,
                face_ids=ms_params.get("face_ids", []),
            ))
            multistep_absorbed.update(member_ids)
        if multistep_absorbed:
            features = [f for f in features if f.id not in multistep_absorbed]

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
                features.append(MachiningFeature(
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
            features.append(MachiningFeature(
                id=f"{ftype}_{tor_idx}",
                type=ftype,
                params={
                    "major_diameter_mm": round(tor["major_radius"] * 2.0, 3),
                    "radius_mm": round(tor["minor_radius"], 3),
                    "centroid": list(tor.get("centroid", (0.0, 0.0, 0.0))),
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
            features.append(MachiningFeature(
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

        return MachiningFeatureTree(family=family, features=features, warnings=warnings)

    # ── cnc_milled recognizer ─────────────────────────────────────────────────

    def _recognize_milled(self, shape) -> MachiningFeatureTree:
        """
        Prismatic / milled part recognition.

        No dominant rotation axis is assumed. All internal cylinders become
        through_hole / tapped_hole / blind_hole; conical faces become chamfers
        or countersinks; planar recesses become pockets or slots.
        No external_diameter is emitted.
        """
        features: List[MachiningFeature] = []
        warnings: List[str] = []

        try:
            bbox = _part_bounding_box(shape)
        except Exception as exc:
            warnings.append(f"Bounding box failed: {exc}")
            return MachiningFeatureTree(family="cnc_milled", features=[], warnings=warnings)

        # For milled parts the machining datum is the largest planar face.
        # Use dominant planar normal as the "Z axis" for through vs blind checks.
        datum_axis = self._dominant_planar_normal(shape)

        raw_cylinders = self._collect_cylinders(shape, datum_axis, bbox)
        # Merge OCC arc patches of the same physical bore. Without this, one bore
        # represented as 4 quarter-circle patches would inflate hole counts 4×.
        cylinders = _deduplicate_cylinders(raw_cylinders)
        cones = self._collect_cones(shape)
        prismatic = self._collect_prismatic_pockets(shape, datum_axis, bbox)
        # Reuse the same toroid detector the turned path already uses (Phase 0
        # coverage fix) — fillets/grooves are real, common features on milled
        # parts too (edge blends, corner radii); this detector is orientation-
        # agnostic (pure surface-type classification), no turned-part
        # assumption in it.
        toroids = self._collect_toroids(shape)

        logger.info(
            f"[milled] raw_cyl={len(raw_cylinders)} deduped={len(cylinders)} "
            f"cones={len(cones)} prismatic={len(prismatic)} toroids={len(toroids)}"
        )

        bore_idx = 0
        bore_id_to_cyl: Dict[str, Dict] = {}

        for cyl in cylinders:
            # Milled parts have no external_diameter — skip outward-facing cylinders
            if cyl["kind"] == "external_diameter":
                continue
            diameter_mm = round(cyl["radius"] * 2.0, 3)
            cx, cy, cz = cyl["centroid"]
            centroid = [round(cx, 3), round(cy, 3), round(cz, 3)]
            fid = f"bore_{bore_idx}"

            kind = cyl["kind"] if cyl["kind"] in ("through_hole", "blind_hole") else "blind_hole"
            emit_type, tap_spec, is_helicoil = _classify_hole(
                diameter_mm, through=(kind == "through_hole"),
            )

            params: Dict = {
                "diameter_mm": diameter_mm,
                "depth_mm": round(cyl["length"], 3),
                "centroid": centroid,
            }
            _annotate_hole_depth(params, diameter_mm, cyl["length"])
            if tap_spec:
                params["spec"] = tap_spec
                params["detection"] = "geometry_heuristic"
                params["through"] = kind == "through_hole"
                if is_helicoil:
                    params["helicoil_candidate"] = True

            features.append(MachiningFeature(
                id=fid,
                type=emit_type,
                params=params,
                confidence=0.85 if emit_type == "through_hole" else (0.55 if tap_spec else 0.80),
                face_ids=cyl.get("face_indices", []),
            ))
            bore_id_to_cyl[fid] = cyl
            bore_idx += 1

        # Counterbore detection with centroid distance guard. Without bore_id_to_cyl the
        # O(n²) pair check would produce thousands of false positives from non-coaxial
        # bore pairs that happen to satisfy diam_outer > diam_inner + depth_outer < depth_inner.
        bore_features = [f for f in features if f.type in ("through_hole", "blind_hole", "tapped_hole")]

        # Multi-step holes (3+ coaxial bores) BEFORE counterbores — see the
        # matching comment in _recognize_turned for why the ordering matters.
        multistep_groups = _detect_multistep_holes(
            [f for f in bore_features if f.type in ("through_hole", "blind_hole")],
            bore_id_to_cyl,
        )
        multistep_absorbed: set = set()
        for ms_idx, (member_ids, ms_params) in enumerate(multistep_groups):
            features.append(MachiningFeature(
                id=f"mstep_{ms_idx}",
                type="multi_step_hole",
                params=ms_params,
                confidence=0.75,
                children=member_ids,
                face_ids=ms_params.get("face_ids", []),
            ))
            multistep_absorbed.update(member_ids)
        if multistep_absorbed:
            features = [f for f in features if f.id not in multistep_absorbed]
            bore_features = [f for f in bore_features if f.id not in multistep_absorbed]

        counterbores = _detect_counterbores(
            [f for f in bore_features if f.type in ("through_hole", "blind_hole")],
            bore_id_to_cyl,
        )
        if counterbores:
            absorbed: set = set()
            for cb_idx, (outer_id, inner_id, params) in enumerate(counterbores):
                cb_face_ids = list(set(
                    bore_id_to_cyl.get(outer_id, {}).get("face_indices", []) +
                    bore_id_to_cyl.get(inner_id, {}).get("face_indices", [])
                ))
                features.append(MachiningFeature(
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
            features.append(MachiningFeature(
                id=f"{ftype}_{cone_idx}",
                type=ftype,
                params=params,
                confidence=conf,
                face_ids=cone.get("face_indices", []),
            ))

        for p_idx, p in enumerate(prismatic):
            ftype, params = _classify_prismatic(p, datum_axis)
            features.append(MachiningFeature(
                id=f"{ftype}_{p_idx}",
                type=ftype,
                params=params,
                confidence=0.68,
                face_ids=p.get("face_indices", []),
            ))

        for tor_idx, tor in enumerate(toroids):
            ftype = "groove" if tor["is_concave"] else "fillet"
            features.append(MachiningFeature(
                id=f"{ftype}_{tor_idx}",
                type=ftype,
                params={
                    "major_diameter_mm": round(tor["major_radius"] * 2.0, 3),
                    "radius_mm": round(tor["minor_radius"], 3),
                    "centroid": list(tor.get("centroid", (0.0, 0.0, 0.0))),
                },
                confidence=0.80,
                face_ids=tor.get("face_indices", []),
            ))

        # ── General face classification (Phase 3) — PlanarFace / CurvedWall /
        # CurvedSurface, the single largest real coverage gap (41% of
        # operations_full__operations.csv by row count). Scoped to faces NOT
        # already claimed by a discrete detector above, so a hole's own
        # bore wall or a fillet's own toroid never also emits as a generic
        # region. See face_classification.py's own module doc comment.
        #
        # NOTE: Phase 5 also built face_classification.detect_polygon_rings()
        # (rotary-broached hex/square socket/boss detection) but it is
        # DELIBERATELY NOT called here -- real testing found it cannot
        # reliably distinguish a genuine broached polygon from an ordinary
        # square/rectangular milled pocket (both are real closed rings of
        # congruent-area, mutually adjacent planar walls; the difference is
        # the intended TOOLING/process, not the geometry). Confirmed live:
        # wiring it in silently reclassified an ordinary 20x15 pocket's own
        # 4 walls as "polygon". Kept as a documented, real, tested spike
        # (same precedent as sheet_metal/features/gusset_spike.py) for a
        # future pass that has an additional real signal (drawing-callout
        # PMI, known drive-socket size standards) to disambiguate -- not
        # wired in without one.
        claimed_face_ids: set = set()
        for f in features:
            claimed_face_ids.update(f.face_ids)

        # ── Cutout rings (Phase 5) — non-circular through-openings (11 real
        # catalog rows). Runs BEFORE general face classification so a real
        # cutout's walls are claimed and never also reappear as generic
        # planar_face regions. Unlike the abandoned Polygon spike above,
        # this detector's real "goes fully through the part" span check
        # (reusing the same through-vs-blind threshold _collect_cylinders
        # already uses for circular holes) reliably excludes ordinary blind
        # pockets/sockets -- verified directly against the same adversarial
        # fixtures that broke Polygon (a plain box, a blind rectangular
        # pocket) before being wired in here. See
        # face_classification.detect_cutout_rings' own doc comment.
        try:
            from .face_classification import detect_cutout_rings
            cutouts = detect_cutout_rings(shape, claimed_face_ids, datum_axis, part_bbox=bbox)
        except Exception as exc:
            cutouts = []
            warnings.append(f"Cutout ring detection failed: {exc}")
        for cutout_idx, cutout in enumerate(cutouts):
            features.append(MachiningFeature(
                id=f"cutout_{cutout_idx}",
                type="cutout",
                params={
                    "side_count": cutout["side_count"],
                    "area_mm2": cutout["area_mm2"],
                    "centroid": list(cutout["centroid"]),
                    "bbox": cutout["bbox"],
                },
                confidence=0.70,
                face_ids=cutout["face_indices"],
            ))
            claimed_face_ids.update(cutout["face_indices"])

        try:
            from .face_classification import classify_and_group_milled_faces
            regions = classify_and_group_milled_faces(shape, claimed_face_ids)
        except Exception as exc:
            regions = []
            warnings.append(f"Face classification failed: {exc}")
        for region_idx, region in enumerate(regions):
            ftype = region["feature_type"]
            features.append(MachiningFeature(
                id=f"{ftype}_{region_idx}",
                type=ftype,
                params={
                    "area_mm2": region["area_mm2"],
                    "centroid": list(region["centroid"]),
                    "bbox": region["bbox"],
                },
                # Coarser than a discrete detector (surface-type + adjacency
                # only, no manufacturing-specific shape logic), same tier as
                # the prismatic pocket/slot/keyway confidence above.
                confidence=0.60,
                face_ids=region["face_indices"],
            ))

        if not features:
            warnings.append(
                "No milled features recognized. Geometry may use unsupported surface types "
                "or the part may require manual feature tagging."
            )

        return MachiningFeatureTree(family="cnc_milled", features=features, warnings=warnings)

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
        Thin delegating wrapper -- the real implementation moved to
        shared/machining_geometry.py's collect_cylinders (2026-09-19) since
        it is a real, live, cross-domain primitive (Sheet Metal already
        called this exact method as `recognizer._collect_cylinders(...)`;
        that call pattern is preserved unchanged here).
        """
        return _collect_cylinders_fn(shape, main_axis, bbox)

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
        """Real toroidal (GeomAbs_Torus) faces only — corner blends and
        fillets swept along a curved edge. A fillet along a straight linear
        edge is a cylindrical blend (GeomAbs_Cylinder), not a torus, and is
        NOT detected here; that is a separate, not-yet-built classification
        (tracked as a CurvedWall sub-case, see Phase 3 of the machining
        feature-extraction plan) — do not assume this covers all fillets."""
        from OCC.Core.GeomAbs import GeomAbs_Torus  # type: ignore
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_FORWARD  # type: ignore
        from OCC.Core.GProp import GProp_GProps  # type: ignore
        from OCC.Core.BRepGProp import brepgprop  # type: ignore

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
                    # Real face centroid (same GProp_GProps/brepgprop technique
                    # shared/stable_face_id.py already uses) — fillet/groove
                    # previously carried no centroid at all, so
                    # build_machining_feature_graph_v2's `if centroid_abs is
                    # None: continue` guard silently dropped every one of
                    # them before this fix, real face_ids notwithstanding.
                    props = GProp_GProps()
                    brepgprop.SurfaceProperties(face, props)
                    cg = props.CentreOfMass()
                    results.append({
                        "major_radius": tor.MajorRadius(),
                        "minor_radius": minor_r,
                        "is_concave": is_concave,
                        "face_indices": [face_idx],  # OCC face ordinal — matches face_map in memory_optimizer
                        "centroid": (round(cg.X(), 3), round(cg.Y(), 3), round(cg.Z(), 3)),
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

    def _collect_prismatic_pockets(
        self,
        shape,
        main_axis: Tuple[float, float, float],
        bbox: Optional[Dict] = None,
    ) -> List[Dict]:
        """
        Detects enclosed planar-walled recesses for slot / keyway / pocket classification.
        Phase 1: uses face-count heuristics. Phase 2 will use full wire topology.

        Structural-face exclusion (fixed 2026-09-19, real confirmed bug): a face
        whose normal is parallel to main_axis (dot > 0.85) is kept as a pocket-
        floor CANDIDATE, but a face sitting exactly at the part's own outer
        envelope along that axis (bbox min/max, within _STRUCTURAL_FACE_AXIS_TOL_MM)
        is the part's own boundary face -- never a real pocket floor, since a
        genuine pocket floor is by definition axially inset from the part's
        outer envelope. Without this, EVERY plain box (or any part's own flat
        top/bottom/end faces) was misclassified as a real "pocket" feature,
        producing a fabricated Pocket Rough/Finish cost line for material that
        was never actually machined out. bbox is optional only for backward
        compatibility with any external caller that doesn't have it yet; when
        omitted, this exclusion is skipped (previous, buggy behavior) rather
        than raising, but every real call site in this file now passes it.
        """
        from OCC.Core.GeomAbs import GeomAbs_Plane  # type: ignore
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
        from OCC.Core.BRepBndLib import brepbndlib  # type: ignore
        from OCC.Core.Bnd import Bnd_Box  # type: ignore

        ax, ay, az = main_axis
        axis_lo, axis_hi = _axis_range(bbox, (ax, ay, az)) if bbox is not None else (None, None)
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
                # Only include faces whose normal is parallel to the main axis
                # (these are pocket-floor CANDIDATES; the part's own outer
                # boundary faces at the axis extremes are excluded below).
                dot_with_axis = abs(nx * ax + ny * ay + nz * az)
                if dot_with_axis > 0.85:
                    fbox = Bnd_Box()
                    brepbndlib.Add(face, fbox)
                    xmin, ymin, zmin, xmax, ymax, zmax = fbox.Get()
                    dx, dy, dz = xmax - xmin, ymax - ymin, zmax - zmin
                    dims = sorted([dx, dy, dz])
                    cx = (xmin + xmax) / 2
                    cy = (ymin + ymax) / 2
                    cz = (zmin + zmax) / 2
                    if axis_lo is not None:
                        position = cx * ax + cy * ay + cz * az
                        if (
                            abs(position - axis_lo) < _STRUCTURAL_FACE_AXIS_TOL_MM
                            or abs(position - axis_hi) < _STRUCTURAL_FACE_AXIS_TOL_MM
                        ):
                            face_idx += 1
                            exp.Next()
                            continue
                    pockets.append({
                        "normal": (nx, ny, nz),
                        "dims": dims,
                        "centroid": (cx, cy, cz),
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
# (_classify_cone moved to shared/machining_geometry.py, re-exported above)


def _classify_prismatic(pocket: Dict, main_axis: Tuple[float, float, float]) -> Tuple[MachiningFeatureType, Dict]:
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

    # centroid is real, already computed by _collect_prismatic_pockets (the
    # pocket dict's own "centroid" key) -- previously never propagated into
    # the returned params, so build_machining_feature_graph_v2's required
    # centroid check silently dropped every pocket/slot/keyway feature.
    centroid = pocket.get("centroid")

    # Slot: elongated + floor normal parallel to main axis (floor faces axially downward)
    dot = abs(nx * ax + ny * ay + nz * az)
    if aspect > 2.5 and dot > 0.85:
        # Check if the long dimension is parallel or perpendicular to main axis
        # Keyway: long axis parallel to main rotation axis
        # Slot / radial_slot: long axis perpendicular
        return "keyway", {
            "length_mm": round(long, 3),
            "width_mm": round(mid, 3),
            "depth_mm": round(short, 3),
            "centroid": centroid,
        }

    if aspect > 2.5:
        return "slot", {
            "length_mm": round(long, 3),
            "width_mm": round(mid, 3),
            "depth_mm": round(short, 3),
            "centroid": centroid,
        }

    return "pocket", {
        "length_mm": round(long, 3),
        "width_mm": round(mid, 3),
        "depth_mm": round(short, 3),
        "centroid": centroid,
    }


def _classify_prismatic_turned(
    pocket: Dict,
    main_axis: Tuple[float, float, float],
) -> Optional[Tuple[MachiningFeatureType, Dict]]:
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

    # centroid: see _classify_prismatic's identical fix above.
    centroid = pocket.get("centroid")

    if dot_with_axis > 0.85:
        # Floor normal is parallel to axis → keyway running along the shaft
        return "keyway", {
            "length_mm": round(long, 3),
            "width_mm": round(mid, 3),
            "depth_mm": round(short, 3),
            "centroid": centroid,
        }

    # Elongated face with normal perpendicular to axis → radial slot on OD
    return "radial_slot", {
        "length_mm": round(long, 3),
        "width_mm": round(mid, 3),
        "depth_mm": round(short, 3),
        "centroid": centroid,
    }


def _detect_pcd_from_axial_bores(
    bore_features: List[MachiningFeature],
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

    off_axis: List[Tuple[MachiningFeature, Dict]] = []
    for f in bore_features:
        cyl = bore_id_to_cyl.get(f.id)
        if cyl and cyl["dist_from_axis"] > MIN_DIST_MM:
            off_axis.append((f, cyl))

    if len(off_axis) < 2:
        return []

    # Bucket by (diameter_key, radial_distance_key)
    buckets: Dict[Tuple[float, float], List[Tuple[MachiningFeature, Dict]]] = {}
    for f, cyl in off_axis:
        d_key = round(f.params["diameter_mm"] / 0.1) * 0.1
        r_key = round(cyl["dist_from_axis"] / 1.0) * 1.0
        buckets.setdefault((d_key, r_key), []).append((f, cyl))

    results: List[Tuple[List[str], Dict]] = []
    for (d_key, r_key), group in buckets.items():
        if len(group) < 2:
            continue
        angles = sorted(cyl["angle_deg"] for _, cyl in group)
        if not _angles_equally_spaced(angles, tolerance_deg=15.0):
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


def _detect_pcd_patterns(cross_features: List[MachiningFeature]) -> List[List[str]]:
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
    buckets: Dict[Tuple[float, float], List[MachiningFeature]] = {}
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
        if len(group) == 3:
            # Fast path for 3-hole patterns: check all gaps ≈ 120° (±20°)
            a = sorted(f.params.get("angle_deg", 0.0) for f in group)
            gaps = [(a[(i + 1) % 3] - a[i]) % 360.0 for i in range(3)]
            if all(100.0 < g < 140.0 for g in gaps):
                pcd_groups.append([f.id for f in group])
                continue
        if _angles_equally_spaced(angles, tolerance_deg=15.0):
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


# ── Coaxial-bore detection (_detect_counterbores, _detect_multistep_holes)
# and geometry utilities (_point_to_axis_distance, _angle_around_axis,
# _axis_range, _axis_span, _part_bounding_box) moved to
# shared/machining_geometry.py, re-exported above.


# Feature types that carry a diameter and are grouped/labelled by diameter
# bucket. Each maps to its own real feature_type string in the output --
# previously ALL of these (plus counterbore/countersink, which were missing
# entirely -- see _extract_diam_depth's own doc comment) collapsed into one
# generic "hole" string that operation-sequencer.ts's switch (which matches
# on the exact strings "through_hole"/"blind_hole"/"tapped_hole"/
# "counterbore"/"countersink"/"chamfer") never matched, silently routing
# every real hole/counterbore/chamfer/countersink into its volume-only
# default-case costing instead of real per-feature Drill/Tap/Counterbore/
# Chamfer/Countersink cycle times.
_DIAMETER_TYPES = {
    "through_hole", "blind_hole", "tapped_hole", "cross_hole",
    "counterbore", "countersink", "chamfer",
    # Real, already-detected (MachiningFeature.face_ids populated), previously
    # silently dropped here because _extract_diam_depth had no branch for it
    # (fell through to (None, None), skipped by the `if diam is None`
    # guard). Phase 0 coverage fix.
    "external_diameter",
}
# Feature types classified by volumetric dims rather than a diameter.
# "pocket" stays "pocket"; "keyway" stays "keyway" (real, distinct data --
# a dedicated Keyway Broaching engine now consumes it, pre-filtered out of
# what reaches build_operation_sequence the same way through_hole/blind_hole
# occurrences are split off for Gun Drilling/Deep Bore -- see
# deep-hole-routing.ts's splitDeepHoleOccurrences and its keyway analogue).
# radial_slot still folds into "slot": operation-sequencer.ts has no
# dedicated case for it yet (only "pocket"/"slot"/now "keyway"), so it is
# still a 1:1 passthrough compromise, not a fabricated mapping.
_POCKET_TYPES = {"pocket", "slot", "radial_slot", "keyway"}
_KEYWAY_DIM_FIELDS = ("length_mm", "width_mm", "depth_mm")
# Toroidal (concave=groove / convex=fillet) real features — classified by a
# real major/minor radius pair, not a diameter+depth pair. Previously
# silently dropped here (no branch at all); ALSO previously had no centroid
# in their own MachiningFeature.params (see _collect_toroids' Phase 0 fix), which
# would have caused build_machining_feature_graph_v2's `centroid_abs is None`
# guard to drop them even with a branch added — both fixed together.
_TOROID_TYPES = {"fillet", "groove"}
# Phase 3 general milled-face classification regions (face_classification.py)
# — real, connected-component face groups classified by surface type, not
# by diameter, volume, or toroid radius. Carry area_mm2 + bbox instead.
_FACE_REGION_TYPES = {"planar_face", "curved_wall", "curved_surface"}


def _extract_diam_depth(ftype: str, p: dict):
    """Real (diameter_mm, depth_mm) for one _DIAMETER_TYPES feature, or
    (None, None) when the source data genuinely doesn't have it -- never a
    guessed value.

    Each type's real params use a different field name for the same real
    quantity (through_hole/blind_hole/tapped_hole/cross_hole:
    "diameter_mm"/"depth_mm"; counterbore: "counterbore_diameter_mm"/
    "counterbore_depth_mm" from _detect_counterbores, kept distinct from its
    own "bore_diameter_mm" rather than conflated; countersink: only
    "entry_diameter_mm"/"bore_diameter_mm"/"half_angle_deg" from
    _classify_cone -- no direct depth signal from cone geometry alone, so
    depth is derived from the real entry/bore diameter step and half-angle
    (right-triangle: depth = radial_step / tan(half_angle)) when both are
    present, else 0.0 so the TS-side fallback (diamMm * 2.5) applies rather
    than fabricating a number here; chamfer: only "diameter_mm", no depth
    concept at all -- operation-sequencer.ts's chamfer case is a fixed
    per-count time, not diameter/depth-driven).
    """
    if ftype in ("through_hole", "blind_hole", "tapped_hole", "cross_hole"):
        return p.get("diameter_mm"), (p.get("depth_mm", 0.0) or 0.0)
    if ftype == "counterbore":
        return p.get("counterbore_diameter_mm"), (p.get("counterbore_depth_mm", 0.0) or 0.0)
    if ftype == "countersink":
        diam = p.get("entry_diameter_mm")
        bore_d = p.get("bore_diameter_mm")
        half_angle = p.get("half_angle_deg")
        depth = 0.0
        if diam is not None and bore_d is not None and half_angle:
            step_r = (diam - bore_d) / 2.0
            tan_a = math.tan(math.radians(half_angle))
            if tan_a > 1e-6:
                depth = round(step_r / tan_a, 3)
        return diam, depth
    if ftype == "chamfer":
        return p.get("diameter_mm"), 0.0
    if ftype == "external_diameter":
        # Real params: diameter_mm + length_mm (axial extent of the OD step,
        # see the "external_diameter" MachiningFeature construction) — length_mm
        # is the real analogue of "depth" here (how far along the axis this
        # OD step runs), not a guessed value.
        return p.get("diameter_mm"), (p.get("length_mm", 0.0) or 0.0)
    return None, None


def build_machining_feature_graph_v2(
    cnc_dict: dict,
    bbox_center: tuple,
    face_map_list: list,
    total_tris: int,
    stable_face_ids: Optional[Dict[int, str]] = None,
) -> dict:
    """Synthesise a feature_graph_v2 payload from CNC feature data.

    Groups diameter-bearing features (holes, counterbore, countersink,
    chamfer) by real type + diameter bucket, and volumetric features
    (pocket/slot) by real type, so operation-sequencer.ts's per-feature-type
    switch actually receives the type it switches on -- see _DIAMETER_TYPES'
    own doc comment for what this replaces.

    stable_face_ids: optional real content-based face-identity map (see
    shared/stable_face_id.py), keyed by the same OCC face ordinal used in
    each occurrence's face_ids. When supplied, each occurrence additionally
    carries source_face_stable_ids (same integration pattern already proven
    for Sheet Metal in feature_extractor.py) -- purely additive, existing
    consumers reading face_ids/centroid/etc. are unaffected.
    """
    from collections import defaultdict

    cx, cy, cz = bbox_center
    buckets: dict = defaultdict(list)

    for feat in cnc_dict.get("features", []):
        ftype = feat.get("type", "")
        p = feat.get("params", {})
        centroid_abs = p.get("centroid")
        if centroid_abs is None and ftype == "pcd_hole_pattern":
            # A PCD pattern has no single hole's centroid of its own (it's a
            # ring of real holes) — the real part bbox_center (already
            # computed, already passed into this function) is used as a
            # disclosed positional fallback, not a fabricated value.
            centroid_abs = (cx, cy, cz)
        if centroid_abs is None:
            continue

        if ftype in _DIAMETER_TYPES:
            diam, depth = _extract_diam_depth(ftype, p)
            if diam is None:
                continue
            d_bucket = round(diam / 0.1) * 0.1
            buckets[(ftype, d_bucket)].append({
                "centroid_abs": centroid_abs,
                "depth_mm": depth,
                "face_ids": feat.get("face_ids", []),
                "tapped": ftype == "tapped_hole",
                "spec": p.get("spec"),
                "material_removed_mm3": round(math.pi * (diam / 2) ** 2 * depth, 2) if depth else 0.0,
            })

        elif ftype in _POCKET_TYPES:
            if ftype == "pocket":
                feat_type_out = "pocket"
            elif ftype == "keyway":
                feat_type_out = "keyway"
            else:
                feat_type_out = "slot"
            dims = p.get("dims") or [
                p.get("depth_mm", 0) or 0,
                p.get("width_mm", 0) or 0,
                p.get("length_mm", 0) or 0,
            ]
            vol = round(dims[-1] * dims[-2] * dims[0], 2) if len(dims) >= 3 else 0.0
            bucket_entry = {
                "centroid_abs": centroid_abs,
                "face_ids": feat.get("face_ids", []),
                "material_removed_mm3": vol,
            }
            if feat_type_out == "keyway":
                for field in _KEYWAY_DIM_FIELDS:
                    bucket_entry[field] = p.get(field)
            buckets[(feat_type_out, "pocket")].append(bucket_entry)

        elif ftype in _TOROID_TYPES:
            # Real major_diameter_mm/radius_mm bucket (Phase 0 coverage fix).
            # material_removed_mm3 is honestly left at 0.0, not fabricated —
            # a toroidal blend's real removed volume depends on its real arc
            # sweep angle, which is not extracted here; this stays a
            # disclosed gap for the MRR-based fallback path rather than an
            # invented number.
            major_d = round(p.get("major_diameter_mm", 0.0) or 0.0, 1)
            buckets[(ftype, major_d)].append({
                "centroid_abs": centroid_abs,
                "radius_mm": p.get("radius_mm"),
                "face_ids": feat.get("face_ids", []),
                "material_removed_mm3": 0.0,
            })

        elif ftype == "pcd_hole_pattern":
            # A real, already-aggregated group of holes (see
            # _detect_pcd_from_axial_bores / the cross-hole PCD grouping) --
            # its constituent individual bores are already absorbed/removed
            # from cnc_dict["features"] by the time this runs, so there is
            # no real per-hole centroid to report. Represented as ONE
            # occurrence per pattern (not fabricated per-hole entries),
            # carrying the real hole_count so a consumer knows how many real
            # holes it represents; face_ids is the real union of every
            # constituent hole's faces, so clicking it highlights the real
            # pattern (not isolatable to one hole within it, which is an
            # honest limitation of the aggregate, not a guess).
            diam = round(p.get("hole_diameter_mm", 0.0) or 0.0, 1)
            buckets[(ftype, diam)].append({
                "centroid_abs": centroid_abs,
                "depth_mm": p.get("depth_mm", 0.0) or 0.0,
                "hole_count": p.get("hole_count", 1),
                "pcd_mm": p.get("pcd_mm"),
                "face_ids": feat.get("face_ids", []),
                "material_removed_mm3": 0.0,
            })

        elif ftype in _FACE_REGION_TYPES:
            # Phase 3 general milled-face classification (face_classification.py).
            # Real area_mm2, no fabricated removed-volume -- same disclosed-0.0
            # discipline as _TOROID_TYPES above (classifying a face does not by
            # itself reveal how much stock sat above it before machining).
            # All real regions of the SAME type across the part become
            # occurrences of ONE output feature entry, matching every other
            # type's bucketing convention in this function (e.g. "pocket").
            buckets[(ftype, "region")].append({
                "centroid_abs": centroid_abs,
                "area_mm2": p.get("area_mm2", 0.0) or 0.0,
                "face_ids": feat.get("face_ids", []),
                "material_removed_mm3": 0.0,
            })

        elif ftype == "cutout":
            # Phase 5 (detect_cutout_rings): real wall area_mm2 + side_count.
            # material_removed_mm3 stays a disclosed 0.0 -- the real
            # cross-sectional footprint the cutout removed isn't separately
            # computed here (area_mm2 is total LATERAL wall area, not
            # footprint x depth), same honesty as _FACE_REGION_TYPES above
            # rather than a fabricated approximation.
            buckets[(ftype, "region")].append({
                "centroid_abs": centroid_abs,
                "area_mm2": p.get("area_mm2", 0.0) or 0.0,
                "side_count": p.get("side_count", 0),
                "face_ids": feat.get("face_ids", []),
                "material_removed_mm3": 0.0,
            })

        elif ftype == "multi_step_hole":
            # Phase 5 (_detect_multistep_holes): a real chain of 3+ coaxial
            # bores. material_removed_mm3 is a real, honest sum of each
            # step's own exposed diameter+depth as a simple cylinder --
            # the same per-hole volume formula _DIAMETER_TYPES already uses
            # above, applied per real step rather than fabricated.
            steps = p.get("steps", [])
            total_removed = sum(
                math.pi * (s.get("diameter_mm", 0.0) / 2) ** 2 * (s.get("depth_mm") or 0.0)
                for s in steps
            )
            buckets[(ftype, "region")].append({
                "centroid_abs": centroid_abs,
                "steps": steps,
                "step_count": p.get("step_count", len(steps)),
                "face_ids": feat.get("face_ids", []),
                "material_removed_mm3": round(total_removed, 2),
            })


    features_out = []
    for (feat_type_out, diam_or_tag), occurrences in buckets.items():
        is_diam_type = feat_type_out in _DIAMETER_TYPES
        # Toroids bucket by major_diameter_mm, pcd_hole_pattern by
        # hole_diameter_mm — both real diameters worth surfacing on the
        # entry even though they don't get the hole-family occurrence
        # fields (depth_mm/ld_ratio/tapped/spec) below.
        has_real_diameter = is_diam_type or feat_type_out in _TOROID_TYPES or feat_type_out == "pcd_hole_pattern"
        diam = diam_or_tag if has_real_diameter else None
        count = len(occurrences)
        feat_id = (
            f"{feat_type_out}_d{diam}_c{count}_cnc" if has_real_diameter
            else f"{feat_type_out}_c{count}_cnc"
        )
        occ_list = []
        for occ in occurrences:
            ax, ay, az = occ["centroid_abs"]
            centered = [round(ax - cx, 3), round(ay - cy, 3), round(az - cz, 3)]
            depth = occ.get("depth_mm", 0.0) or 0.0
            ld_ratio = round(depth / max(diam, 0.1), 3) if (diam and depth) else None
            occ_entry: dict = {
                "centroid": centered,
                "face_ids": occ["face_ids"],
                "local_feature_density": count,
                "material_removed_mm3": occ.get("material_removed_mm3", 0.0),
            }
            if stable_face_ids:
                occ_entry["source_face_stable_ids"] = [
                    stable_face_ids.get(fid) for fid in occ["face_ids"]
                ]
            if is_diam_type:
                occ_entry["depth_mm"] = round(depth, 3)
                occ_entry["ld_ratio"] = ld_ratio
                occ_entry["tapped"] = occ.get("tapped", False)
                occ_entry["spec"] = occ.get("spec")
            if feat_type_out == "keyway":
                for field in _KEYWAY_DIM_FIELDS:
                    val = occ.get(field)
                    occ_entry[field] = round(val, 3) if val is not None else None
            if feat_type_out in _TOROID_TYPES:
                occ_entry["radius_mm"] = occ.get("radius_mm")
            if feat_type_out == "pcd_hole_pattern":
                occ_entry["depth_mm"] = round(depth, 3)
                occ_entry["hole_count"] = occ.get("hole_count", 1)
                occ_entry["pcd_mm"] = occ.get("pcd_mm")
            if feat_type_out in _FACE_REGION_TYPES:
                occ_entry["area_mm2"] = occ.get("area_mm2", 0.0)
            if feat_type_out == "cutout":
                occ_entry["area_mm2"] = occ.get("area_mm2", 0.0)
                occ_entry["side_count"] = occ.get("side_count", 0)
            if feat_type_out == "multi_step_hole":
                occ_entry["steps"] = occ.get("steps", [])
                occ_entry["step_count"] = occ.get("step_count", 0)
            occ_list.append(occ_entry)
        entry: dict = {"id": feat_id, "feature_type": feat_type_out, "occurrences": occ_list}
        if diam is not None:
            entry["diameter_mm"] = diam
        features_out.append(entry)

    return {
        "metadata": {
            "face_map": face_map_list,
            "stl_tri_total": total_tris,
            "source": "cnc_features",
            "stable_face_ids": stable_face_ids or {},
        },
        "features": features_out,
    }

