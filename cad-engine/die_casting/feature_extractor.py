"""
Die Casting feature extraction — orchestration only.

Mirrors SheetMetalFeatureExtractor.extract()'s shape: call each detector in
dependency order (base properties first -- everything else needs the primary
pull axis), build feature_graph_v2 through die_casting_feature()'s
validating builder (never an unvalidated type/variant pair), stamp stable
face ids, and report every face no detector claimed as NotSupported --
disclosed, never silently dropped.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from shared.stable_face_id import build_stable_face_id_map
from shared.feature_extent import annotate_occurrence_extents
from shared.core_geometry import trapped_cores
from shared.casting_geometry import parting_plane_silhouette, wall_thickness_profile
from shared.feature_vocabulary import Domain, feature_types

from die_casting.feature_models import die_casting_feature
from die_casting.features.base_properties import analyze_base_properties
from die_casting.features.combo_void import detect_voids
from die_casting.features.simple_hole import detect_holes
from die_casting.features.surfaces import classify_surfaces

logger = logging.getLogger(__name__)


class DieCastingFeatureExtractor:
    def extract(
        self,
        shape: Any,
        bbox_dims: List[float],
        raw_cylinders_full: Optional[List[Any]] = None,
        bbox_minmax: Optional[Dict[str, float]] = None,
        face_map: Optional[List[Dict]] = None,
        face_map_tri_total: int = 0,
        domain: Domain = "die_casting",
    ) -> Dict[str, Any]:
        """Casting features for one casting process. `domain` is that
        process's own reference catalog (die_casting / sand_casting /
        investment_casting): a detected type its catalog does not define is
        not emitted -- e.g. sand casting cores undercuts, so it has no
        SlideBundle -- and is listed in omitted_feature_types instead."""
        supported = feature_types(domain)
        omitted: set = set()

        def feature(fid: str, ftype: str, variant: str, **fields: Any) -> Optional[Dict[str, Any]]:
            if ftype not in supported:
                omitted.add(ftype)
                return None
            return die_casting_feature(fid, ftype, variant, domain=domain, **fields)

        base = analyze_base_properties(shape, bbox_dims)
        primary_axis = base["primary_setup_axis"]

        # Casting-process inputs measured from the solid: silhouette on the
        # parting plane (clamp force) and local wall thickness (solidification).
        projected_area = None
        parting_footprint = None
        pull_extent = None
        parting_perimeter = None
        if primary_axis is not None:
            try:
                silhouette = parting_plane_silhouette(shape, primary_axis)
                projected_area = round(silhouette["area_mm2"], 3)
                parting_footprint = [round(x, 3) for x in silhouette["footprint_mm"]]
                pull_extent = round(silhouette["pull_extent_mm"], 3)
                parting_perimeter = round(silhouette["parting_perimeter_mm"], 3)
            except Exception as e:
                logger.warning(f"[DieCasting] parting-plane silhouette failed: {e}")
        try:
            walls = wall_thickness_profile(shape)
        except Exception as e:
            logger.warning(f"[DieCasting] wall thickness failed: {e}")
            walls = {"wall_thickness_nominal_mm": None, "wall_thickness_min_mm": None,
                     "wall_thickness_max_mm": None, "wall_thickness_sample_count": 0,
                     "wall_thickness_method": "inward_ray"}

        # Regions no die half reaches by a straight pull: the cores (sand
        # cores in gravity die casting, slides / pins in a pressure die).
        cores = {"core_count": None, "cores": [], "cell_mm": None, "columns": 0, "skipped_columns": 0}
        if primary_axis is not None:
            try:
                cores = trapped_cores(shape, primary_axis)
            except Exception as e:
                logger.warning(f"[DieCasting] core extraction failed: {e}")

        holes = detect_holes(shape, bbox_minmax, primary_axis)
        voids = detect_voids(shape, bbox_dims, primary_axis)

        claimed: set = set()
        claimed |= set(base.get("parting_line_face_ids", []))
        claimed |= set(holes.get("claimed_face_ids", []))
        claimed |= set(voids.get("claimed_face_ids", []))

        surfaces = classify_surfaces(shape, claimed_face_ids=claimed)
        claimed |= surfaces.get("all_claimed_face_ids", set())

        # NotSupported: every real face no detector claimed. Computed from the
        # actual face count (every face is enumerated by TopExp_Explorer in
        # classify_surfaces/surfaces.py already, including claimed ones it
        # skips) -- re-derive the total face count honestly rather than guess.
        total_face_count = self._count_faces(shape)
        not_supported_face_ids = sorted(set(range(total_face_count)) - claimed)

        v2_features: List[Optional[Dict[str, Any]]] = []

        if holes.get("simple_hole_candidates"):
            for variant in ("through", "blind"):
                occs = [h for h in holes["simple_hole_candidates"] if h["variant"] == variant]
                if occs:
                    v2_features.append(feature(
                        f"simple_hole_{variant}", "SimpleHole", variant,
                        occurrences=[{
                            "centroid": o["centroid_mm"], "face_ids": o["face_ids"],
                            "axis": o.get("axis"),
                            **({"tool_axis": o["tool_axis"], "tool_axis_bidirectional": o["tool_axis_bidirectional"]} if "tool_axis" in o else {}),
                            "diameter_mm": o["diameter_mm"], "depth_mm": o["depth_mm"],
                            "ld_ratio": o.get("ld_ratio"),
                            **({"exceeds_blind_hole_ld_ceiling": o["exceeds_blind_hole_ld_ceiling"],
                                "blind_hole_ld_ceiling": o["blind_hole_ld_ceiling"]} if "exceeds_blind_hole_ld_ceiling" in o else {}),
                        } for o in occs],
                    ))

        if holes.get("multi_step_hole_candidates"):
            v2_features.append(feature(
                "multi_step_hole", "MultiStepHole", "stepped",
                occurrences=[{
                    "centroid": o["centroid_mm"], "face_ids": o["face_ids"],
                    "steps": o["steps"], "step_count": o["step_count"],
                    "max_diameter_mm": o["max_diameter_mm"], "min_diameter_mm": o["min_diameter_mm"],
                    "monotonic": o["monotonic"],
                } for o in holes["multi_step_hole_candidates"]],
            ))

        if voids.get("void_candidates"):
            v2_features.append(feature(
                "void", "Void", "default",
                occurrences=[{
                    "centroid": o["centroid_mm"], "face_ids": o["face_ids"],
                    "retraction_axis_name": o["retraction_axis_name"],
                } for o in voids["void_candidates"]],
            ))

        if voids.get("slide_bundle_candidates"):
            v2_features.append(feature(
                "slide_bundle", "SlideBundle", "default",
                occurrences=[{
                    "centroid": o["centroid_mm"], "face_ids": o["face_ids"],
                    "member_count": o["member_count"], "retraction_axis_name": o["retraction_axis_name"],
                } for o in voids["slide_bundle_candidates"]],
            ))

        for key, ftype in (
            ("planar_face_candidates", "PlanarFace"),
            ("curved_wall_candidates", "CurvedWall"),
            ("curved_surface_candidates", "CurvedSurface"),
        ):
            occs = surfaces.get(key) or []
            if occs:
                v2_features.append(feature(
                    ftype.lower(), ftype, "default",
                    occurrences=[{
                        "centroid": o["centroid_mm"], "face_ids": o["face_ids"], "area_mm2": o["area_mm2"],
                        **({"tool_axis": o["tool_axis"], "tool_axis_bidirectional": False} if "tool_axis" in o else {}),
                    } for o in occs],
                ))

        if surfaces.get("sharp_edges"):
            v2_features.append(feature(
                "sharp_edge", "SharpEdge", "default",
                occurrences=[{
                    "centroid": e["midpoint_mm"] or [0.0, 0.0, 0.0], "face_ids": e["face_ids"],
                    "length_mm": e["length_mm"],
                } for e in surfaces["sharp_edges"]],
            ))

        if not_supported_face_ids:
            v2_features.append(feature(
                "not_supported", "NotSupported", "default",
                occurrences=[{"centroid": [0.0, 0.0, 0.0], "face_ids": not_supported_face_ids}],
            ))

        v2_features = [f for f in v2_features if f is not None]

        stable_face_ids: Dict[int, str] = {}
        try:
            stable_face_ids = build_stable_face_id_map(shape)
        except Exception as e:
            logger.warning(f"[DieCasting] stable_face_id build failed: {e}")

        for group in v2_features:
            for occ in group.get("occurrences", []) or []:
                occ["source_face_stable_ids"] = [
                    stable_face_ids.get(fid) for fid in occ.get("face_ids", []) or []
                ]
        # Nominal size for ISO 286 grading of tolerances on non-hole features.
        annotate_occurrence_extents(shape, v2_features)

        feature_graph_v2 = {
            "metadata": {
                "face_map": face_map or [],
                "stl_tri_total": face_map_tri_total or None,
                "stable_face_ids": stable_face_ids,
            },
            "features": v2_features,
            "conditions": [],
        }

        # Same observability convention as [SheetMetal]/[machining_features]
        # -- a visible confirmation this extractor actually ran and what it
        # found, not just silent success/failure.
        logger.info(
            f"[DieCasting] axis={primary_axis} projected_area={projected_area}mm2 "
            f"wall_nominal={walls['wall_thickness_nominal_mm']} wall_max={walls['wall_thickness_max_mm']} "
            f"simple_holes={holes['simple_hole_count']} "
            f"multi_step_holes={holes['multi_step_hole_count']} "
            f"voids={voids['void_count']} slide_bundles={voids['slide_bundle_count']} "
            f"planar={surfaces['planar_face_count']} curved_wall={surfaces['curved_wall_count']} "
            f"curved_surface={surfaces['curved_surface_count']} sharp_edges={surfaces['sharp_edge_count']} "
            f"not_supported={len(not_supported_face_ids)}/{total_face_count}"
        )

        return {
            "setup_axis_candidates": base["setup_axis_candidates"],
            "primary_setup_axis": primary_axis,
            "parting_plane_offset_mm": base["parting_plane_offset_mm"],
            "casting_domain": domain,
            "omitted_feature_types": sorted(omitted),
            "projected_area_mm2": projected_area,
            "parting_footprint_mm": parting_footprint,
            "pull_extent_mm": pull_extent,
            "core_count": cores["core_count"],
            "cores": cores["cores"],
            "core_grid": {"cell_mm": cores["cell_mm"], "columns": cores["columns"], "skipped_columns": cores["skipped_columns"]},
            "parting_perimeter_mm": parting_perimeter,
            **walls,
            "parting_line_face_ids": base["parting_line_face_ids"],
            "base_properties": base["base_properties"],
            "simple_hole_count": holes["simple_hole_count"],
            "simple_hole_candidates": holes["simple_hole_candidates"],
            "multi_step_hole_count": holes["multi_step_hole_count"],
            "multi_step_hole_candidates": holes["multi_step_hole_candidates"],
            "combo_void_count": voids["combo_void_count"],
            "combo_void_candidates": voids["combo_void_candidates"],
            "void_count": voids["void_count"],
            "void_candidates": voids["void_candidates"],
            "slide_bundle_count": voids["slide_bundle_count"],
            "slide_bundle_candidates": voids["slide_bundle_candidates"],
            "planar_face_count": surfaces["planar_face_count"],
            "curved_wall_count": surfaces["curved_wall_count"],
            "curved_surface_count": surfaces["curved_surface_count"],
            "sharp_edge_count": surfaces["sharp_edge_count"],
            "not_supported_face_ids": not_supported_face_ids,
            "feature_graph_v2": feature_graph_v2,
        }

    @staticmethod
    def _count_faces(shape: Any) -> int:
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
        n = 0
        exp = TopExp_Explorer(shape, TopAbs_FACE)
        while exp.More():
            n += 1
            exp.Next()
        return n
