"""
Manufacturing Feature Extractors — family-specific geometry analysis using OpenCASCADE.

Each extractor converts raw OCC topology into manufacturing-relevant features:
  - SheetMetalFeatureExtractor: thickness, cut length, bends, holes, slots
  - (Future) MachiningFeatureExtractor, TurningFeatureExtractor

Separation of concerns:
  Python CAD engine  = geometry intelligence (this file)
  Node.js planner    = manufacturing intelligence (routing, costing)

NOTE: bend and slot detection thresholds are V1 heuristics. Validate against
20+ real parts and tune before treating results as production-grade.
"""

import logging
import math
from collections import defaultdict
from typing import Dict, List, Optional, Tuple, Any

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Part-family detection
# ─────────────────────────────────────────────────────────────────────────────

def detect_part_family(
    bbox_dims: List[float],
    hole_count: int,
    secondary_features_count: int,
    cyl_axis_alignment: float = 0.0,
    rotational_face_ratio: float = 0.0,
    planar_face_fraction: float = 0.0,
    total_face_count: int = 1,
    large_cyl_count: int = 0,
) -> Tuple[str, float, List[str]]:
    """
    Heuristic family classification from bounding-box geometry + cylindrical face signals.

    Returns (family, confidence, reasons) where:
      family    — 'sheet_metal' | 'cnc_turned' | 'cnc_milled' | 'mill_turn'
      confidence — 0–1 score
      reasons   — human-readable list explaining which signals fired

    secondary_features_count: cross holes (non-axial cylinders) + pocket count.
      > 0 elevates cnc_turned → mill_turn.

    cyl_axis_alignment: fraction of cyl faces sharing the dominant axis (0–1).
      > 0.60 → rotationally symmetric (turned part regardless of elongation).

    rotational_face_ratio: cylindrical face count / total face count (0–1).
      > 0.30 → most surfaces are cylindrical → confirms turned, not milled housing.
      Guards against mis-classifying round milled housings / pipe manifolds.

    planar_face_fraction: planar face count / total face count (0–1).
      > 0.70 → mostly planar surfaces → sheet metal or simple block.

    total_face_count: total OCC face count used to compute hole density.

    large_cyl_count: number of cylindrical faces with radius > 15% of max bbox dimension.
      These represent external OD surfaces (turned diameters, large bores) — not sheet holes.
      > 3 → hard veto on sheet_metal gates (a genuine sheet metal part has only small holes).
    """
    dims = sorted(d for d in bbox_dims if d > 0)
    if len(dims) < 3:
        return "cnc_milled", 0.50, ["Insufficient bounding box data — defaulting to cnc_milled"]

    flatness = dims[0] / dims[2]               # min / max  — low = flat
    elongation = dims[2] / max(dims[1], 1.0)   # max / mid  — high = rod-like
    circularity = dims[1] / max(dims[2], 1.0)  # mid / max  — high = circular cross-section

    if flatness < 0.15:
        confidence = min(0.95, 0.60 + (0.15 - flatness) * 2.0)
        return "sheet_metal", round(confidence, 3), [
            f"Very flat cross-section (flatness={flatness:.2f} < 0.15)",
        ]

    hole_density = hole_count / max(total_face_count, 1)

    # Hard veto: parts with multiple large-radius cylinders (external OD surfaces) cannot
    # be sheet metal. A lens holder / flange / shaft has external diameters >> hole radii;
    # a perforated sheet has only small holes. Threshold: > 3 large cylinders detected.
    sheet_metal_veto = large_cyl_count > 3

    # Gate 1b-abs — absolute hole count + moderately flat bbox.
    # Perforated brackets with flanges that inflate bbox height will have flatness 0.40–0.60
    # (e.g., ZDR90 bracket: 94.6 / 182.2 = 0.52). A CNC-milled block with >20 drilled holes
    # AND flatness < 0.60 is extremely rare; this combination is overwhelmingly sheet metal.
    # NOT applied when external OD cylinders are detected (sheet_metal_veto).
    if not sheet_metal_veto and hole_count > 20 and flatness < 0.60:
        confidence = min(0.85, 0.70 + min(hole_count, 200) / 2000)
        return "sheet_metal", round(confidence, 3), [
            f"High absolute hole count ({hole_count}) with flat-ish bbox "
            f"(flatness={flatness:.2f}) — perforated sheet metal",
        ]

    # Gate 1b — hole density + moderately flat bbox (catches cases below 20-hole threshold).
    if not sheet_metal_veto and hole_density > 0.20 and flatness < 0.60:
        confidence = min(0.88, 0.68 + max(0, 0.60 - flatness) * 0.3)
        return "sheet_metal", round(confidence, 3), [
            f"High hole density ({hole_count}/{total_face_count} faces = {hole_density:.0%}) "
            f"with flat-ish bbox (flatness={flatness:.2f})",
            "Perforated sheet metal — hole-dominated topology",
        ]

    # Gate 1c — planar-dominant surface topology + moderately flat bbox.
    # Sheet metal is almost entirely planar faces (top, bottom, flanges, webs).
    # CNC milled and turned parts have more diverse surface types (fillets, bosses, pockets).
    # Catches simple bent brackets and channel sections where hole count is low.
    if not sheet_metal_veto and planar_face_fraction > 0.70 and flatness < 0.35:
        confidence = min(0.82, 0.62 + (0.35 - flatness) * 0.4 + planar_face_fraction * 0.1)
        return "sheet_metal", round(confidence, 3), [
            f"Predominantly planar surfaces ({planar_face_fraction:.0%}) "
            f"with flat-ish bbox (flatness={flatness:.2f})",
            "Surface topology consistent with sheet metal",
        ]

    # Disc / flange / ring (lens holders, pulleys, bearing races):
    # rotational_face_ratio > 0.30 guards against round milled housings / pipe manifolds
    # where a few through-holes make cyl_axis_alignment look high.
    if (circularity > 0.80
            and cyl_axis_alignment > 0.60
            and rotational_face_ratio > 0.30):
        reasons = [
            f"Circular cross-section (circularity={circularity:.2f} > 0.80)",
            f"Most cylindrical faces share a common axis (alignment={cyl_axis_alignment:.2f} > 0.60)",
            f"High proportion of cylindrical faces (ratio={rotational_face_ratio:.2f} > 0.30)",
        ]
        if secondary_features_count > 0:
            reasons.append(
                f"Secondary machining features detected (count={secondary_features_count})"
            )
            return "mill_turn", 0.75, reasons
        return "cnc_turned", 0.80, reasons

    if elongation > 2.5 and flatness > 0.20:
        reasons = [
            f"Elongated geometry (elongation={elongation:.2f} > 2.5)",
            f"Not flat (flatness={flatness:.2f} > 0.20)",
        ]
        if secondary_features_count > 0:
            reasons.append(
                f"Secondary machining features detected (count={secondary_features_count})"
            )
            return "mill_turn", 0.72, reasons
        return "cnc_turned", 0.75, reasons

    return "cnc_milled", 0.65, [
        f"No strong rotational or sheet-metal signal "
        f"(flatness={flatness:.2f}, elongation={elongation:.2f}, "
        f"circularity={circularity:.2f}, "
        f"cyl_alignment={cyl_axis_alignment:.2f}, "
        f"rot_ratio={rotational_face_ratio:.2f})",
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Sheet Metal Feature Extractor
# ─────────────────────────────────────────────────────────────────────────────


class SheetMetalFeatureExtractor:
    """
    Extracts sheet-metal-specific manufacturing features from an OCC TopoDS_Shape.

    Key outputs:
      sheet_thickness_mm  — antiparallel planar face-pair modal distance (topology-based)
      cut_length_mm       — total edge length = laser path (outer + inner contours)
      bend_count          — horizontal cylindrical faces with small radius
      hole_count          — vertical cylindrical faces (separated from bends)
      slot_count          — elongated closed wire loops (aspect ratio > 2.5)

    Each output carries a _confidence field (0–1) so downstream consumers can
    weight features appropriately during validation runs.
    """

    def extract(
        self,
        shape: Any,
        bbox_dims: List[float],
        raw_cylinders: Optional[List[Tuple[float, float]]] = None,
        raw_cylinders_full: Optional[List[Tuple]] = None,
        bbox_minmax: Optional[Dict[str, float]] = None,
        face_map: Optional[List[Dict]] = None,
        face_map_tri_total: int = 0,
        face_id_map: Optional[Dict[int, int]] = None,
        adjacent_face_ids: Optional[Dict[int, List[int]]] = None,
    ) -> Dict[str, Any]:
        """
        Run all sheet-metal extractors and return a flat feature dict.

        raw_cylinders: pre-computed (radius_mm, abs_axis_z) list from _detect_holes_real.
          When provided, bend and hole detection skip a redundant OCC face scan.
          Falls back to full OCC scan if None.
        raw_cylinders_full: extended 9-tuple list
          (radius, abs_axis_z, cx, cy, cz, ax, ay, az, face_index) from _detect_holes_real.
          face_index is a runtime OCC face ordinal — NOT stable across STEP regeneration.
          Used to build feature_graph_v2 with per-instance occurrence data.
        bbox_minmax: absolute bounding box dict with xmin/xmax/ymin/ymax/zmin/zmax keys.
          Required for zone classification and occurrence centroid computation.
        """
        # Sheet thickness + dominant blank face + confidence in one topology pass.
        sheet_thickness, dominant_face, thickness_conf, geom_debug = (
            self._extract_sheet_metal_geometry(shape, bbox_dims)
        )

        flatness = sheet_thickness / max(max(bbox_dims), 1.0)

        # Use pre-computed cylinder list when available.
        if raw_cylinders is None:
            try:
                raw_cylinders = self._collect_cylindrical_faces(shape)
            except Exception as e:
                logger.warning(f"[SheetMetal] cylindrical face scan failed: {e}")
                raw_cylinders = []

        cut_length = 0.0
        try:
            cut_length = self._compute_cut_length(shape, dominant_face)
        except Exception as e:
            logger.warning(f"[SheetMetal] cut_length failed: {e}")

        bends: Dict[str, Any] = {"count": 0, "radii": [], "all_radii": []}
        try:
            bends = self._count_bends_from_list(raw_cylinders, sheet_thickness)
        except Exception as e:
            logger.warning(f"[SheetMetal] bend detection failed: {e}")

        holes: Dict[str, Any] = {"count": 0, "diameters": [], "all_diameters": []}
        try:
            if raw_cylinders_full and bbox_minmax:
                holes = self._count_holes_with_location(raw_cylinders_full, bbox_minmax)
            else:
                holes = self._count_holes_from_list(raw_cylinders)
        except Exception as e:
            logger.warning(f"[SheetMetal] hole detection failed: {e}")

        slots: Dict[str, Any] = {"count": 0}
        try:
            slots = self._detect_slots_v2(
                shape, dominant_face,
                face_id_map=face_id_map or {},
                bbox_minmax=bbox_minmax,
            )
        except Exception as e:
            logger.warning(f"[SheetMetal] slot detection failed: {e}")

        pierce_count = holes["count"] + slots["count"] + 1  # +1 = initial pierce

        flat_pattern_area_mm2 = 0.0
        try:
            flat_pattern_area_mm2 = self._compute_flat_pattern_area(shape, dominant_face)
        except Exception as e:
            logger.warning(f"[SheetMetal] flat_pattern_area failed: {e}")

        # Validation warnings + debug output
        validation_debug = self._validate_sheet_geometry(
            sheet_thickness, flat_pattern_area_mm2, cut_length, bbox_dims
        )

        # Feature Graph v2: per-instance occurrence data with exact face_ids for highlighting
        feature_graph_v2: Optional[Dict[str, Any]] = None
        if raw_cylinders_full and bbox_minmax:
            try:
                v2_features = self._build_feature_occurrences(
                    raw_cylinders_full, bbox_minmax, sheet_thickness,
                    slot_occurrences=slots.get('occurrences', []),
                    adjacent_face_ids=adjacent_face_ids,
                    dominant_face=dominant_face,
                )
                feature_graph_v2 = {
                    "metadata": {
                        "face_map": face_map or [],
                        "stl_tri_total": face_map_tri_total or None,
                    },
                    "features": v2_features,
                }
                logger.info(
                    f"[SheetMetal] feature_graph_v2: {len(v2_features)} feature types, "
                    f"face_map {len(face_map or [])} faces ({face_map_tri_total} triangles)"
                )
            except Exception as e:
                logger.warning(f"[SheetMetal] feature_graph_v2 build failed: {e}")

        logger.info(
            f"[SheetMetal] thickness={sheet_thickness:.2f}mm(conf={thickness_conf:.2f}) "
            f"cut={cut_length:.0f}mm bends={bends['count']} "
            f"holes={holes['count']} slots={slots['count']} "
            f"pierces={pierce_count} area={flat_pattern_area_mm2:.0f}mm²"
        )

        return {
            "sheet_thickness_mm": round(sheet_thickness, 3),
            "sheet_thickness_confidence": thickness_conf,
            "cut_length_mm": round(cut_length, 1),
            "cut_length_confidence": 0.90,
            "bend_count": bends["count"],
            "bend_radii_mm": bends.get("all_radii", bends["radii"]),
            "bend_confidence": 0.75,
            "hole_count": holes["count"],
            "hole_diameters_mm": holes.get("all_diameters", holes["diameters"]),
            "hole_groups": holes.get("hole_groups", []),
            "hole_confidence": 0.90,
            "slot_count": slots["count"],
            "slot_confidence": 0.70,
            "pierce_count": pierce_count,
            "flat_pattern_area_mm2": flat_pattern_area_mm2,
            "sheet_geometry_debug": {**geom_debug, **validation_debug},
            "feature_graph_v2": feature_graph_v2,
        }

    # ── Sheet thickness + dominant face (combined single pass) ────────────────

    def _extract_sheet_metal_geometry(
        self,
        shape: Any,
        bbox_dims: List[float],
    ) -> Tuple[float, Any, float, Dict[str, Any]]:
        """
        Topology-based extraction of (thickness_mm, dominant_face, confidence, debug).

        Algorithm:
          1. Walk all planar faces once.
             Collect (face, unit_normal, plane_d, area, centroid) where
             plane_d = dot(unit_normal, plane_location_point).

          2. Find every antiparallel pair (dot(n_i, n_j) < -0.92) whose
             perpendicular distance falls in [0.3 mm, 20% of max_bbox_dim].
             Distance formula for an antiparallel pair:
               dist = |d_i + d_j|
             This is exact because n_j ≈ -n_i, so
               dot(n_i, loc_j) = -d_j  →  separation = |d_i - (-d_j)| = |d_i + d_j|
             Works for ANY normal orientation, not just ±X/Y/Z.

          3. Area-weighted distance histogram at 0.05 mm resolution.
             Each pair votes with weight = combined_area of both faces.
             Modal bin = sheet material gauge.
             (A 55-bend frame with many flat sections all at 2 mm produces a
              clear majority vote over the rare large-distance pairs.)

          4. Among pairs within ±15% of the modal thickness, score each pair:
               score = combined_area × (1 + 0.3 × centrality)
             where centrality = 1 − (dist_from_part_centre / bbox_half_diag).
             Highest score → dominant blank face.

          5. Confidence = f(area_ratio of modal bin, plausibility vs bbox).
        """
        logger.info("[SheetMetal] _extract_sheet_metal_geometry: running topology-based algorithm (geo_v2)")
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
        from OCC.Core.GeomAbs import GeomAbs_Plane  # type: ignore
        from OCC.Core.TopoDS import topods  # type: ignore
        from OCC.Core.BRepGProp import brepgprop  # type: ignore
        from OCC.Core.GProp import GProp_GProps  # type: ignore

        max_dim = max(bbox_dims)
        # Gauge search range:
        #   tight  0.3–6mm   → physical sheet metal (steel/al gauge up to 6mm)
        #   loose  0.3–20%   → fallback for thick plate or unusual geometry
        _GAUGE_TIGHT_MAX = 6.0
        _HIGHAREA_FRAC   = 0.25   # bin must have ≥ 25% of max bin area to be "high-area"
        max_gauge_loose  = max_dim * 0.20
        bbox_half_diag = math.sqrt(sum(d * d for d in bbox_dims)) / 2.0
        fallback_t = min(d for d in bbox_dims if d > 0)
        fallback_debug: Dict[str, Any] = {
            "planar_face_count": 0,
            "pairs_in_gauge": 0,
            "thickness_histogram": {},
            "modal_thickness_mm": fallback_t,
            "area_ratio": 0.0,
        }

        # ── 1. Collect planar faces ───────────────────────────────────────────
        planar: List[Tuple[Any, Tuple[float, float, float], float, float, Tuple[float, float, float]]] = []

        explorer = TopExp_Explorer(shape, TopAbs_FACE)
        while explorer.More():
            try:
                face = topods.Face(explorer.Current())
                adaptor = BRepAdaptor_Surface(face)
                if adaptor.GetType() == GeomAbs_Plane:
                    plane = adaptor.Plane()
                    n = plane.Axis().Direction()
                    nx, ny, nz = float(n.X()), float(n.Y()), float(n.Z())
                    mag = math.sqrt(nx * nx + ny * ny + nz * nz)
                    if mag < 1e-9:
                        explorer.Next()
                        continue
                    nx, ny, nz = nx / mag, ny / mag, nz / mag
                    loc = plane.Location()
                    plane_d = (
                        nx * float(loc.X())
                        + ny * float(loc.Y())
                        + nz * float(loc.Z())
                    )
                    props = GProp_GProps()
                    brepgprop.SurfaceProperties(face, props)
                    area = props.Mass()
                    if area < 1.0:  # skip degenerate / seam faces
                        explorer.Next()
                        continue
                    cg = props.CentreOfMass()
                    planar.append(
                        (
                            face,
                            (nx, ny, nz),
                            plane_d,
                            area,
                            (float(cg.X()), float(cg.Y()), float(cg.Z())),
                        )
                    )
            except Exception:
                pass
            explorer.Next()

        if len(planar) < 2:
            fallback_debug["planar_face_count"] = len(planar)
            return fallback_t, None, 0.30, fallback_debug

        # Area-weighted part centroid estimate (avoids needing absolute bbox min/max)
        total_pl_area = sum(a for _, _, _, a, _ in planar)
        part_cx = sum(c[0] * a for _, _, _, a, c in planar) / max(total_pl_area, 1.0)
        part_cy = sum(c[1] * a for _, _, _, a, c in planar) / max(total_pl_area, 1.0)
        part_cz = sum(c[2] * a for _, _, _, a, c in planar) / max(total_pl_area, 1.0)

        # ── 2. Antiparallel pairs within loose gauge range ────────────────────
        BIN_RES = 0.05  # histogram bin width (mm)
        hist: Dict[float, float] = defaultdict(float)        # bin_key → total_pair_area
        hist_count: Dict[float, int] = defaultdict(int)      # bin_key → pair count
        pairs = []  # (dist, combined_area, face_i, centroid_i, centroid_j)

        for i in range(len(planar)):
            fi, ni, di, ai, ci = planar[i]
            for j in range(i + 1, len(planar)):
                fj, nj, dj, aj, cj = planar[j]
                dot_ij = ni[0] * nj[0] + ni[1] * nj[1] + ni[2] * nj[2]
                if dot_ij > -0.92:
                    continue
                # Perpendicular separation for antiparallel planes:
                #   dist = |d_i + d_j|   (exact when n_j = -n_i)
                dist = abs(di + dj)
                if dist < 0.3 or dist > max_gauge_loose:
                    continue
                pair_area = ai + aj
                bin_key = round(dist / BIN_RES) * BIN_RES
                hist[bin_key] += pair_area
                hist_count[bin_key] += 1
                pairs.append((dist, pair_area, fi, ci, cj))

        if not hist:
            fallback_debug["planar_face_count"] = len(planar)
            return fallback_t, None, 0.30, fallback_debug

        # ── 3. Modal thickness — thinnest high-area mode, tight range first ──
        total_hist_area = sum(hist.values())
        max_bin_area    = max(hist.values())

        # Log top-10 bins (area descending) for diagnosis
        top10 = sorted(hist.items(), key=lambda x: x[1], reverse=True)[:10]
        logger.info(
            "[SheetMetal] histogram top-10 (bin_mm: area×count): "
            + ", ".join(f"{k:.2f}:{v:.0f}×{hist_count[k]}" for k, v in top10)
        )

        def _best_gauge_bin(sub: Dict[float, float]) -> float:
            """
            Best gauge bin = thinnest among bins in the top 90th percentile of
            area × sqrt(pair_count).  Using area alone ignores structural evidence
            (count); using count alone ignores scale.  The combined score lets the
            true material gauge — which appears at many parallel face pairs AND has
            significant face area — beat both large-area rib features and thin
            clearance-gap artifacts with few pairs.
            """
            scores = {k: v * math.sqrt(max(hist_count[k], 1)) for k, v in sub.items()}
            peak = max(scores.values())
            top_tier = sorted(k for k, s in scores.items() if s >= peak * 0.90)
            return top_tier[0]  # thinnest in the top-tier

        tight_hist = {k: v for k, v in hist.items() if k <= _GAUGE_TIGHT_MAX}
        tight_total = sum(tight_hist.values())
        modal_source = "tight"

        if tight_hist and tight_total / total_hist_area >= 0.05:
            # Tight range has meaningful area → best combined-score bin within it
            modal_thickness = _best_gauge_bin(tight_hist)
            modal_area = tight_hist[modal_thickness]
            logger.info(
                f"[SheetMetal] tight-range selection: {modal_thickness:.2f}mm "
                f"(tight_frac={tight_total/total_hist_area:.1%})"
            )
        else:
            # Tight range empty or negligible (<5% of total) → thick plate / unusual part
            modal_thickness = _best_gauge_bin(hist)
            modal_area = hist[modal_thickness]
            modal_source = "loose"
            logger.info(
                f"[SheetMetal] loose-range fallback: {modal_thickness:.2f}mm "
                f"(tight_frac={tight_total/total_hist_area:.1%})"
            )

        # ── 4. Dominant face: highest-scored pair near modal thickness ────────
        tol = max(0.3, modal_thickness * 0.15)
        best_score = -1.0
        best_face = None
        best_pair_area = 0.0
        best_centrality = 0.0

        for dist, pair_area, fi, ci, cj in pairs:
            if abs(dist - modal_thickness) > tol:
                continue
            avg_cx = (ci[0] + cj[0]) / 2.0
            avg_cy = (ci[1] + cj[1]) / 2.0
            avg_cz = (ci[2] + cj[2]) / 2.0
            d_to_centre = math.sqrt(
                (avg_cx - part_cx) ** 2
                + (avg_cy - part_cy) ** 2
                + (avg_cz - part_cz) ** 2
            )
            centrality = max(0.0, 1.0 - d_to_centre / max(bbox_half_diag, 1.0))
            score = pair_area * (1.0 + 0.3 * centrality)
            if score > best_score:
                best_score = score
                best_face = fi
                best_pair_area = pair_area
                best_centrality = round(centrality, 3)

        # ── 5. Confidence ─────────────────────────────────────────────────────
        area_ratio = modal_area / max(total_hist_area, 1.0)
        confidence = min(0.92, 0.60 + area_ratio * 0.40)
        min_xy_dim = sorted(bbox_dims)[-2]  # second-largest ≈ part width
        if modal_thickness > min_xy_dim * 0.20:
            confidence *= 0.50
        confidence = round(confidence, 3)

        # Histogram debug: include pair counts alongside area
        hist_debug = {
            f"{round(k, 2):.2f}": {"area": round(v, 0), "pairs": hist_count[k]}
            for k, v in sorted(hist.items())
        }

        geo_debug: Dict[str, Any] = {
            "planar_face_count": len(planar),
            "pairs_in_gauge": len(pairs),
            "thickness_histogram": hist_debug,
            "modal_thickness_mm": round(modal_thickness, 3),
            "modal_source": modal_source,
            "modal_area_weight": round(modal_area, 0),
            "total_area_weight": round(total_hist_area, 0),
            "tight_area_frac": round(tight_total / max(total_hist_area, 1.0), 3),
            "area_ratio": round(area_ratio, 3),
            "dominant_pair_area": round(best_pair_area, 0),
            "dominant_centrality": best_centrality,
        }

        logger.debug(
            f"[SheetMetal] planar={len(planar)} pairs={len(pairs)} "
            f"modal={modal_thickness:.2f}mm({modal_source}) "
            f"area_ratio={area_ratio:.2f} conf={confidence}"
        )

        return modal_thickness, best_face, confidence, geo_debug

    # ── Cylindrical face collection (shared between bend + hole detectors) ───

    def _collect_cylindrical_faces(self, shape: Any) -> List[Tuple[float, float]]:
        """
        Single-pass OCC face scan returning (radius_mm, abs_axis_z) for every
        cylindrical face. Called as fallback when raw_cylinders is not pre-supplied.
        """
        from OCC.Core.GeomAbs import GeomAbs_Cylinder  # type: ignore
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
        from OCC.Core.TopoDS import topods  # type: ignore
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore

        result: List[Tuple[float, float]] = []
        explorer = TopExp_Explorer(shape, TopAbs_FACE)
        while explorer.More():
            try:
                face = topods.Face(explorer.Current())
                adaptor = BRepAdaptor_Surface(face)
                if adaptor.GetType() == GeomAbs_Cylinder:
                    cyl = adaptor.Cylinder()
                    result.append(
                        (round(cyl.Radius(), 3), abs(cyl.Axis().Direction().Z()))
                    )
            except Exception:
                pass
            explorer.Next()
        return result

    def _edge_clearance(self, cx: float, cy: float, cz: float, outer_wire: Any) -> Optional[float]:
        """Min distance from (cx,cy,cz) to outer wire edges. Returns mm or None."""
        try:
            from OCC.Core.BRep import BRep_Tool                              # type: ignore
            from OCC.Core.GeomAPI import GeomAPI_ProjectPointOnCurve         # type: ignore
            from OCC.Core.gp import gp_Pnt                                   # type: ignore
            from OCC.Core.TopExp import TopExp_Explorer as _TExp             # type: ignore
            from OCC.Core.TopAbs import TopAbs_EDGE                          # type: ignore
            from OCC.Core.TopoDS import topods as _topods                    # type: ignore
            pt = gp_Pnt(cx, cy, cz)
            min_dist = float('inf')
            exp = _TExp(outer_wire, TopAbs_EDGE)
            while exp.More():
                edge = _topods.Edge(exp.Current())
                try:
                    curve_h, u0, u1 = BRep_Tool.Curve(edge)
                    if curve_h is not None:
                        proj = GeomAPI_ProjectPointOnCurve(pt, curve_h, u0, u1)
                        if proj.NbPoints() > 0:
                            min_dist = min(min_dist, proj.LowerDistance())
                except Exception:
                    pass
                exp.Next()
            return round(min_dist, 2) if min_dist < float('inf') else None
        except Exception:
            return None

    def _nearest_dist(self, cx: float, cy: float, cz: float, pts: List[Tuple]) -> Optional[float]:
        """Min 3D Euclidean distance from (cx,cy,cz) to any point in pts, excluding self."""
        best = float('inf')
        for (ox, oy, oz) in pts:
            dx, dy, dz = cx - ox, cy - oy, cz - oz
            d = (dx * dx + dy * dy + dz * dz) ** 0.5
            if d > 1e-4:
                best = min(best, d)
        return round(best, 2) if best < float('inf') else None

    def _local_density(self, cx: float, cy: float, pts: List[Tuple], radius: float = 30.0) -> int:
        """Count of other points within `radius` mm in the XY plane."""
        count = 0
        r2 = radius * radius
        for (ox, oy, _oz) in pts:
            dx, dy = cx - ox, cy - oy
            if dx * dx + dy * dy < r2 and (abs(dx) > 1e-4 or abs(dy) > 1e-4):
                count += 1
        return count

    def _cluster_bbox(
        self,
        h_cx: float, h_cy: float,
        pts: List[Tuple],
        bbox_cx: float, bbox_cy: float,
        radius: float = 30.0,
    ) -> Optional[Dict]:
        """
        Bounding box of neighboring hole centroids within `radius` mm in XY plane.
        Coordinates in Three.js-centered space (subtract bbox_cx/cy).
        Returns None when no neighbors exist within radius.
        """
        r2 = radius * radius
        nx: List[float] = []
        ny: List[float] = []
        for (ox, oy, _oz) in pts:
            dx, dy = h_cx - ox, h_cy - oy
            if dx * dx + dy * dy < r2 and (abs(dx) > 1e-4 or abs(dy) > 1e-4):
                nx.append(ox)
                ny.append(oy)
        if not nx:
            return None
        x_min, x_max = min(nx), max(nx)
        y_min, y_max = min(ny), max(ny)
        ex = x_max - x_min
        ey = y_max - y_min
        return {
            "x_min": round(x_min - bbox_cx, 2),
            "x_max": round(x_max - bbox_cx, 2),
            "y_min": round(y_min - bbox_cy, 2),
            "y_max": round(y_max - bbox_cy, 2),
            "extent_x": round(ex, 2),
            "extent_y": round(ey, 2),
            "diagonal": round((ex * ex + ey * ey) ** 0.5, 2),
            "count": len(nx),
        }

    def _build_feature_occurrences(
        self,
        raw_cylinders_full: List[Tuple],  # 11-tuple: (r, axis_z, cx, cy, cz, ax, ay, az, face_idx, v_range, u_range_rad)
        bbox_minmax: Dict[str, float],
        sheet_thickness: float,
        slot_occurrences: Optional[List[Dict]] = None,
        adjacent_face_ids: Optional[Dict[int, List[int]]] = None,
        dominant_face: Any = None,
    ) -> List[Dict[str, Any]]:
        """
        Build per-instance occurrence data for holes and bends.

        INVARIANT: len(occurrences) == physical count of that feature in the part.
        Each entry in occurrences[] is one physical hole or bend — never a grouped count.
        Future DFM ("Hole #3 has insufficient edge clearance") and pattern detection
        both require this per-instance guarantee.

        centroid is Three.js-centered: [abs_x - bbox_cx, abs_y - bbox_cy, abs_z - bbox_cz].
        This matches the viewer's geometry.center() call (edrawings-viewer.tsx line 1948).

        face_id is an OCC face index from the current parse session.
        NOT stable across STEP regeneration — Phase 2 highlighting uses centroid
        proximity matching, not stored face IDs.
        """
        cx = (bbox_minmax['xmin'] + bbox_minmax['xmax']) / 2
        cy = (bbox_minmax['ymin'] + bbox_minmax['ymax']) / 2
        cz = (bbox_minmax['zmin'] + bbox_minmax['zmax']) / 2

        # Holes: axis roughly Z-aligned (abs_axis_z >= 0.5), radius in fastener/clearance range
        hole_entries = [
            c for c in raw_cylinders_full
            if c[1] >= 0.5 and 0.3 <= c[0] <= 150.0
        ]
        # Bends: axis roughly horizontal (abs_axis_z < 0.5), radius within sheet-thickness range
        max_bend_r = max(sheet_thickness * 8, 20.0)
        bend_entries = [
            c for c in raw_cylinders_full
            if c[1] < 0.5 and 0.1 <= c[0] <= max_bend_r
        ]

        # ── Pre-compute spatial data for per-occurrence metrics ─────────────────
        hole_centroids_abs = [(c[2], c[3], c[4]) for c in hole_entries]

        # Inner-face clustering done here (moved up) so bend_centroids_abs is available
        # during the hole occurrence loop below.
        AXIS_TOL_MM = 2.0
        _inner_faces_pre: List[Any] = []
        _used_pre = [False] * len(bend_entries)
        for _i, _ei in enumerate(bend_entries):
            if _used_pre[_i]:
                continue
            _cluster = [_ei]
            _used_pre[_i] = True
            _ci_x, _ci_y, _ci_z = _ei[2], _ei[3], _ei[4]
            for _j in range(_i + 1, len(bend_entries)):
                if _used_pre[_j]:
                    continue
                _ej = bend_entries[_j]
                _dx, _dy, _dz = _ej[2] - _ci_x, _ej[3] - _ci_y, _ej[4] - _ci_z
                if (_dx * _dx + _dy * _dy + _dz * _dz) ** 0.5 < AXIS_TOL_MM:
                    _cluster.append(_ej)
                    _used_pre[_j] = True
            _inner = min(_cluster, key=lambda _m: _m[0])
            _all_fids = [_m[8] for _m in _cluster]
            _inner_faces_pre.append((_inner, _all_fids))
        bend_centroids_abs = [(_inner[2], _inner[3], _inner[4]) for (_inner, _) in _inner_faces_pre]

        # Outer wire from dominant_face for edge clearance (first wire = outer contour)
        outer_wire = None
        try:
            if dominant_face is not None:
                from OCC.Core.TopExp import TopExp_Explorer as _WExp  # type: ignore
                from OCC.Core.TopAbs import TopAbs_WIRE               # type: ignore
                from OCC.Core.TopoDS import topods as _td             # type: ignore
                _we = _WExp(dominant_face, TopAbs_WIRE)
                if _we.More():
                    outer_wire = _td.Wire(_we.Current())
        except Exception:
            pass

        features: List[Dict[str, Any]] = []

        # ── Holes: group by diameter, one FeatureNodeV2 per diameter ─────────
        hole_by_diameter: Dict[float, List] = defaultdict(list)
        for c in hole_entries:
            d = round(c[0] * 2, 1)  # radius → diameter
            hole_by_diameter[d].append(c)

        for d_mm in sorted(hole_by_diameter.keys()):
            members = hole_by_diameter[d_mm]

            # One dict per OCC cylindrical face = one dict per physical hole
            occurrences = []
            xs, ys = [], []
            for m in members:
                cyl_fi = m[8]
                adj_fids = (adjacent_face_ids or {}).get(cyl_fi, [])
                h_cx, h_cy, h_cz = m[2], m[3], m[4]
                radius_mm = m[0]
                ec = self._edge_clearance(h_cx, h_cy, h_cz, outer_wire)
                if ec is not None:
                    ec = round(max(0.0, ec - radius_mm), 2)  # wall-to-edge, not center-to-edge
                occurrences.append({
                    "centroid": [round(h_cx - cx, 2), round(h_cy - cy, 2), round(h_cz - cz, 2)],
                    # cylinder wall + adjacent planar rim faces for visible top-down highlight
                    "face_ids": [cyl_fi] + adj_fids,
                    "edge_clearance_mm": ec,
                    "nearest_hole_distance_mm": self._nearest_dist(h_cx, h_cy, h_cz, hole_centroids_abs),
                    "nearest_bend_distance_mm": self._nearest_dist(h_cx, h_cy, h_cz, bend_centroids_abs)
                        if bend_centroids_abs else None,
                    "local_feature_density": self._local_density(h_cx, h_cy, hole_centroids_abs, 30.0),
                    "hole_cluster_bbox_mm": self._cluster_bbox(h_cx, h_cy, hole_centroids_abs, cx, cy, 30.0),
                })
                xs.append(h_cx)
                ys.append(h_cy)

            avg_ax = sum(m[5] for m in members) / len(members)
            avg_ay = sum(m[6] for m in members) / len(members)
            avg_az = sum(m[7] for m in members) / len(members)

            features.append({
                "id": f"hole_d{d_mm}",
                "feature_type": "hole",
                "diameter_mm": d_mm,
                "normal": [round(avg_ax, 4), round(avg_ay, 4), round(avg_az, 4)],
                "occurrences": occurrences,  # len == physical hole count for this diameter
                "bbox_centered": {
                    "x_min": round(min(xs) - cx, 1),
                    "x_max": round(max(xs) - cx, 1),
                    "y_min": round(min(ys) - cy, 1),
                    "y_max": round(max(ys) - cy, 1),
                },
            })

        # ── Bends: use pre-clustered inner_faces from spatial pre-computation above ──
        #
        # Clustering logic (AXIS_TOL_MM=2.0) was moved up to _inner_faces_pre so that
        # bend_centroids_abs is available during the hole loop. Reuse those results here.
        # Each entry: (inner_tuple, [all face_ids in this cluster])
        # inner_tuple used for centroid/normal; all face_ids cover inner + outer cylinder
        inner_faces = _inner_faces_pre

        # Group by rounded radius → one FeatureNodeV2 per unique bend radius
        bend_by_radius: Dict[float, List] = defaultdict(list)
        for (inner, all_fids) in inner_faces:
            r = round(inner[0], 1)
            bend_by_radius[r].append((inner, all_fids))

        for r_mm in sorted(bend_by_radius.keys()):
            members = bend_by_radius[r_mm]

            occurrences = []
            xs, ys = [], []
            for (m, all_fids) in members:
                b_cx, b_cy, b_cz = m[2], m[3], m[4]
                ec = self._edge_clearance(b_cx, b_cy, b_cz, outer_wire)
                bend_r = m[0]
                # edge_to_bend: distance from bend cylinder SURFACE to nearest part edge
                # = centroid-to-wire minus bend inner radius (same direction, surface vs axis)
                edge_to_bend = round(max(0.0, ec - bend_r), 2) if ec is not None else None
                occurrences.append({
                    "centroid": [round(b_cx - cx, 2), round(b_cy - cy, 2), round(b_cz - cz, 2)],
                    "face_ids": all_fids,  # inner + outer cylinder faces → full bend surface
                    "edge_clearance_mm": ec,
                    "edge_to_bend_distance_mm": edge_to_bend,
                    "nearest_hole_distance_mm": self._nearest_dist(b_cx, b_cy, b_cz, hole_centroids_abs)
                        if hole_centroids_abs else None,
                    "bend_length_mm": round(m[9], 2) if len(m) > 9 else None,
                    "bend_angle_deg": round(math.degrees(m[10]), 1) if len(m) > 10 else None,
                })
                xs.append(b_cx)
                ys.append(b_cy)

            avg_ax = sum(m[5] for (m, _) in members) / len(members)
            avg_ay = sum(m[6] for (m, _) in members) / len(members)
            avg_az = sum(m[7] for (m, _) in members) / len(members)

            features.append({
                "id": f"bend_r{r_mm}",
                "feature_type": "bend",
                "radius_mm": r_mm,
                "normal": [round(avg_ax, 4), round(avg_ay, 4), round(avg_az, 4)],
                "occurrences": occurrences,  # len == physical bend count for this radius
                "bbox_centered": {
                    "x_min": round(min(xs) - cx, 1),
                    "x_max": round(max(xs) - cx, 1),
                    "y_min": round(min(ys) - cy, 1),
                    "y_max": round(max(ys) - cy, 1),
                },
            })

        # Slots: add from _detect_slots_v2 result (already have centroid + face_ids)
        if slot_occurrences:
            features.append({
                "id": "slot_all",
                "feature_type": "slot",
                "occurrences": slot_occurrences,
            })

        return features

    def _count_bends_from_list(
        self,
        raw_cylinders: List[Tuple[float, float]],
        sheet_thickness: float,
    ) -> Dict[str, Any]:
        """Detect bends from pre-collected (radius, abs_axis_z) pairs."""
        max_bend_radius = max(sheet_thickness * 8, 20.0)
        bend_radii: List[float] = [
            round(r, 3)
            for r, axis_z in raw_cylinders
            if axis_z < 0.5 and 0.1 <= r <= max_bend_radius
        ]
        sorted_radii = sorted(round(r, 1) for r in bend_radii)
        inner_radii = sorted_radii[::2]
        return {
            "count": len(bend_radii) // 2,
            "radii": sorted(set(inner_radii)),
            "all_radii": inner_radii,
        }

    def _count_holes_from_list(
        self,
        raw_cylinders: List[Tuple[float, float]],
    ) -> Dict[str, Any]:
        """Detect holes from pre-collected (radius, abs_axis_z) pairs."""
        from collections import Counter
        diameters: List[float] = [
            round(r * 2, 1)
            for r, axis_z in raw_cylinders
            if axis_z >= 0.5 and 0.3 <= r <= 150.0
        ]
        if not diameters:
            return {"count": 0, "diameters": [], "all_diameters": [], "hole_groups": []}
        counter = Counter(diameters)
        hole_groups = sorted(
            [{"diameter_mm": d, "count": c} for d, c in counter.items()],
            key=lambda x: x["diameter_mm"],
        )
        return {
            "count":        sum(counter.values()),
            "diameters":    sorted(counter.keys()),
            "all_diameters": sorted(diameters),   # kept for backward compat
            "hole_groups":  hole_groups,
        }

    def _count_holes_with_location(
        self,
        raw_cylinders_full: List[Tuple],
        bbox_minmax: Dict[str, float],
    ) -> Dict[str, Any]:
        """
        Detect holes from full spatial cylinder data and attach per-group location metadata.

        Each hole_group gains a 'location' dict:
          manufacturing_region — "Primary blank" | "Flange" | "Side wall"
            Derived from axis direction only — NOT from Z-position, which changes with
            model orientation and has no manufacturing meaning.
          face_type — "flat" | "flange" | "sidewall"
          bbox      — {x_min, x_max, y_min, y_max} of hole centroids (mm, absolute)

        NOTE: holes of the same diameter on different faces are still merged into one
        group (spatial clustering milestone deferred). bbox captures the spread.
        """
        from collections import defaultdict

        # Filter for holes: abs_axis_z >= 0.5, radius in [0.3, 150] mm
        # Tuple layout: (radius, abs_axis_z, cx, cy, cz, ax, ay, az)
        hole_entries = [
            c for c in raw_cylinders_full
            if c[1] >= 0.5 and 0.3 <= c[0] <= 150.0
        ]

        if not hole_entries:
            return {"count": 0, "diameters": [], "all_diameters": [], "hole_groups": []}

        # Group by diameter rounded to 0.1 mm
        groups: Dict[float, List[Tuple]] = defaultdict(list)
        for c in hole_entries:
            d = round(c[0] * 2, 1)
            groups[d].append(c)

        # Part center in absolute coords — used to produce bbox_centered for Three.js.
        # Three.js calls geometry.center() which shifts all vertices by -bbox_center,
        # so viewer coordinates = absolute_coords - part_center.
        cx_part = (bbox_minmax.get('xmin', 0.0) + bbox_minmax.get('xmax', 0.0)) / 2
        cy_part = (bbox_minmax.get('ymin', 0.0) + bbox_minmax.get('ymax', 0.0)) / 2

        hole_groups = []
        all_diameters: List[float] = []

        for d_mm in sorted(groups.keys()):
            members = groups[d_mm]
            all_diameters.extend([d_mm] * len(members))

            xs = [m[2] for m in members]
            ys = [m[3] for m in members]
            avg_axis_z = sum(m[1] for m in members) / len(members)

            # face_type and manufacturing_region derived from axis direction only.
            # abs_axis_z ≈ 1: axis is vertical → hole through a flat/horizontal face.
            # abs_axis_z ≈ 0.5–0.85: axis is diagonal → hole through a flange.
            # (abs_axis_z < 0.5 excluded by filter above — those would be side-wall holes,
            #  currently misidentified as bends; handled in a later CAD engine milestone.)
            if avg_axis_z >= 0.85:
                face_type = "flat"
                manufacturing_region = "Primary blank"
            else:
                face_type = "flange"
                manufacturing_region = "Flange"

            x_min, x_max = round(min(xs), 1), round(max(xs), 1)
            y_min, y_max = round(min(ys), 1), round(max(ys), 1)

            hole_groups.append({
                "diameter_mm": d_mm,
                "count": len(members),
                "location": {
                    "manufacturing_region": manufacturing_region,
                    "face_type": face_type,
                    # Absolute OCC coordinates — for display (e.g. "X: 120–180 mm")
                    "bbox": {
                        "x_min": x_min, "x_max": x_max,
                        "y_min": y_min, "y_max": y_max,
                    },
                    # Three.js-centered coordinates (absolute minus part bbox center).
                    # geometry.center() is called on load, so viewer coords = abs - part_center.
                    # Used directly for Zoom-to-Region: set controls.target to bbox_centered center.
                    "bbox_centered": {
                        "x_min": round(x_min - cx_part, 1),
                        "x_max": round(x_max - cx_part, 1),
                        "y_min": round(y_min - cy_part, 1),
                        "y_max": round(y_max - cy_part, 1),
                    },
                },
            })

        all_diameters_sorted = sorted(all_diameters)
        return {
            "count":         len(hole_entries),
            "diameters":     sorted(groups.keys()),
            "all_diameters": all_diameters_sorted,
            "hole_groups":   hole_groups,
        }

    # ── Cut length, flat area, slots (accept pre-found dominant face) ─────────

    def _compute_cut_length(self, shape: Any, dominant_face: Any) -> float:
        """
        Laser cut length = sum of all edge lengths on the dominant blank face.
        Orientation-independent: uses the face from _extract_sheet_metal_geometry.
        """
        if dominant_face is None:
            return 0.0

        from OCC.Core.BRepAdaptor import BRepAdaptor_Curve  # type: ignore
        from OCC.Core.GCPnts import GCPnts_AbscissaPoint  # type: ignore
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopAbs import TopAbs_EDGE  # type: ignore

        total = 0.0
        edge_exp = TopExp_Explorer(dominant_face, TopAbs_EDGE)
        while edge_exp.More():
            try:
                curve = BRepAdaptor_Curve(edge_exp.Current())
                total += GCPnts_AbscissaPoint.Length(curve, 1e-3)
            except Exception:
                pass
            edge_exp.Next()
        return total

    def _compute_flat_pattern_area(self, shape: Any, dominant_face: Any) -> float:
        """Area of the dominant blank face. Orientation-independent."""
        if dominant_face is None:
            return 0.0

        from OCC.Core.BRepGProp import brepgprop  # type: ignore
        from OCC.Core.GProp import GProp_GProps  # type: ignore

        props = GProp_GProps()
        brepgprop.SurfaceProperties(dominant_face, props)
        return round(props.Mass(), 1)

    def _detect_slots_v2(
        self,
        shape: Any,
        dominant_face: Any,
        face_id_map: Dict[int, int],
        bbox_minmax: Optional[Dict[str, float]] = None,
    ) -> Dict[str, Any]:
        """
        Detect slots (wire aspect ratio > 2.5) and return per-slot occurrences with face_ids.
        face_ids are the wall faces adjacent to each slot wire edge (excluding dominant_face).
        Falls back to count-only if topology lookup fails.
        """
        if dominant_face is None:
            return {"count": 0, "occurrences": []}

        from OCC.Core.TopExp import TopExp_Explorer, topexp  # type: ignore
        from OCC.Core.TopAbs import TopAbs_WIRE, TopAbs_EDGE  # type: ignore
        from OCC.Core.TopTools import TopTools_IndexedDataMapOfShapeListOfShape, TopTools_ListIteratorOfListOfShape  # type: ignore
        from OCC.Core.BRepBndLib import brepbndlib  # type: ignore
        from OCC.Core.Bnd import Bnd_Box  # type: ignore
        from OCC.Core.TopoDS import topods  # type: ignore

        MAX_HASH = 2 ** 31 - 1
        cx = cy = cz = 0.0
        if bbox_minmax:
            cx = (bbox_minmax['xmin'] + bbox_minmax['xmax']) / 2
            cy = (bbox_minmax['ymin'] + bbox_minmax['ymax']) / 2
            cz = (bbox_minmax['zmin'] + bbox_minmax['zmax']) / 2

        # Build edge → adjacent faces map for the whole shape (for slot wall lookup)
        try:
            edge_face_map = TopTools_IndexedDataMapOfShapeListOfShape()
            topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edge_face_map)  # type: ignore
            has_edge_map = True
        except Exception:
            has_edge_map = False
            edge_face_map = None

        occurrences = []
        slot_count = 0
        first_wire = True
        wire_exp = TopExp_Explorer(dominant_face, TopAbs_WIRE)

        while wire_exp.More():
            wire = wire_exp.Current()
            if first_wire:
                first_wire = False
                wire_exp.Next()
                continue  # skip outer contour wire
            try:
                bb = Bnd_Box()
                brepbndlib.Add(wire, bb)
                xmin, ymin, zmin, xmax, ymax, zmax = bb.Get()
                dx, dy, dz = xmax - xmin, ymax - ymin, zmax - zmin
                extents = sorted([e for e in [dx, dy, dz] if e > 0.01])

                if len(extents) >= 2 and extents[-1] / extents[-2] > 2.5:
                    # Collect wall face_ids via edge adjacency
                    slot_face_ids: List[int] = []
                    if has_edge_map and edge_face_map is not None and face_id_map:
                        try:
                            edge_exp = TopExp_Explorer(wire, TopAbs_EDGE)
                            while edge_exp.More():
                                edge = topods.Edge(edge_exp.Current())
                                idx = edge_face_map.FindIndex(edge)
                                if idx > 0:
                                    adj_list = edge_face_map.FindFromIndex(idx)
                                    it = TopTools_ListIteratorOfListOfShape(adj_list)
                                    while it.More():
                                        adj_face = topods.Face(it.Value())
                                        it.Next()
                                        if not adj_face.IsSame(dominant_face):
                                            fh = adj_face.HashCode(MAX_HASH)
                                            fid = face_id_map.get(fh)
                                            if fid is not None and fid not in slot_face_ids:
                                                slot_face_ids.append(fid)
                                edge_exp.Next()
                        except Exception:
                            slot_face_ids = []

                    occurrences.append({
                        'centroid': [
                            round((xmin + xmax) / 2 - cx, 2),
                            round((ymin + ymax) / 2 - cy, 2),
                            round((zmin + zmax) / 2 - cz, 2),
                        ],
                        'face_ids': slot_face_ids,
                    })
                    slot_count += 1
            except Exception:
                pass
            wire_exp.Next()

        return {"count": slot_count, "occurrences": occurrences}

    def _count_slots(self, shape: Any, dominant_face: Any) -> Dict[str, Any]:
        """
        Detect slots: elongated closed wire loops (bounding box aspect ratio > 2.5)
        on the dominant flat face, excluding the outer contour wire.

        ⚠ EXPERIMENTAL: threshold > 2.5 catches standard rectangular slots but may
        miss short obround holes.
        """
        if dominant_face is None:
            return {"count": 0}

        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopAbs import TopAbs_WIRE  # type: ignore
        from OCC.Core.BRepBndLib import brepbndlib  # type: ignore
        from OCC.Core.Bnd import Bnd_Box  # type: ignore

        slot_count = 0
        first_wire = True
        wire_explorer = TopExp_Explorer(dominant_face, TopAbs_WIRE)
        while wire_explorer.More():
            if first_wire:
                first_wire = False  # skip outer contour wire
                wire_explorer.Next()
                continue
            try:
                bb = Bnd_Box()
                brepbndlib.Add(wire_explorer.Current(), bb)
                xmin, ymin, zmin, xmax, ymax, zmax = bb.Get()
                dx = xmax - xmin
                dy = ymax - ymin
                if min(dx, dy) > 0:
                    ratio = max(dx, dy) / min(dx, dy)
                    if ratio > 2.5:
                        slot_count += 1
            except Exception:
                pass
            wire_explorer.Next()

        return {"count": slot_count}

    # ── Validation ────────────────────────────────────────────────────────────

    def _validate_sheet_geometry(
        self,
        thickness: float,
        flat_area: float,
        cut_length: float,
        bbox_dims: List[float],
    ) -> Dict[str, Any]:
        """
        Emit logger.warning for physically implausible extraction results.
        Returns a debug dict merged into sheet_geometry_debug.
        """
        sorted_dims = sorted(bbox_dims, reverse=True)  # [max, mid, min]
        max_dim = sorted_dims[0]
        xy_dims = sorted_dims[:2]  # two largest = L, W
        outer_perimeter = 2.0 * (xy_dims[0] + xy_dims[1])

        warnings_emitted: List[str] = []

        if thickness > min(xy_dims) * 0.20:
            msg = (
                f"thickness {thickness:.1f}mm > 20% of min-XY {min(xy_dims):.0f}mm"
                f" — likely bbox artifact, not material gauge"
            )
            logger.warning(f"[SheetMetal] {msg}")
            warnings_emitted.append(msg)

        if thickness < 0.3:
            msg = f"thickness {thickness:.1f}mm below 0.3mm physical minimum"
            logger.warning(f"[SheetMetal] {msg}")
            warnings_emitted.append(msg)

        if max_dim > 100 and flat_area < 5_000:
            msg = (
                f"flat_area {flat_area:.0f}mm² implausibly small for"
                f" {max_dim:.0f}mm part — dominant face may be wrong"
            )
            logger.warning(f"[SheetMetal] {msg}")
            warnings_emitted.append(msg)

        if cut_length > 0 and cut_length < outer_perimeter * 0.5:
            msg = (
                f"cut_length {cut_length:.0f}mm < 50% of outer perimeter"
                f" {outer_perimeter:.0f}mm — dominant face edges may be incomplete"
            )
            logger.warning(f"[SheetMetal] {msg}")
            warnings_emitted.append(msg)

        return {
            "outer_perimeter_estimate_mm": round(outer_perimeter, 1),
            "bbox_dims_sorted_mm": [round(d, 2) for d in sorted_dims],
            "validation_warnings": warnings_emitted,
        }
