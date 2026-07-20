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


def _annotate_tap_candidates(hole_groups: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Annotate hole groups whose diameter falls in a tap pre-drill band
    (shared table from cnc_feature_recognizer) with 'tap_candidate_spec' and
    return a [{spec, count}] summary.

    RECOGNITION DATA ONLY — sheet metal is full of clearance holes whose sizes
    overlap tap-drill bands (M3 clearance Ø3.2–3.4 vs M4 tap drill Ø3.3), so the
    backend must NOT price tapping from these candidates alone; drawing thread
    callouts remain the authoritative source for sheet-metal tapping cost.
    """
    from cnc_feature_recognizer import _TAP_DRILL_RANGES

    tap_candidates: List[Dict[str, Any]] = []
    for g in hole_groups:
        d = g.get("diameter_mm")
        if d is None:
            continue
        for lo, hi, spec in _TAP_DRILL_RANGES:
            if lo <= d <= hi:
                g["tap_candidate_spec"] = spec
                tap_candidates.append({"spec": spec, "count": g.get("count", 0)})
                break
    return tap_candidates


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
    pocket_count: int = 0,
    thin_wall_ratio: float = 0.0,
    draft_face_ratio: float = 0.0,
    volume_mm3: float = 0.0,
) -> Tuple[str, float, List[str]]:
    """
    Heuristic family classification from bounding-box geometry + cylindrical face signals.

    Returns (family, confidence, reasons) where:
      family    — 'sheet_metal' | 'cnc_turned' | 'cnc_milled' | 'mill_turn' | 'injection_molded'
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

    pocket_count: number of prismatic pocket floor faces detected.
      > 2 → hard veto on sheet_metal gates (pockets require milling, not laser/punch).
      Also doubles as an injection-molded proxy below: ribs and bosses read as pocket-detector
      floor faces (the same false-positive mechanism already documented for milled blocks),
      so an elevated pocket_count on an otherwise non-flat, non-rotational part is as much
      evidence of "shell + ribs + bosses" as it is of "milled block with pockets".

    thin_wall_ratio: fraction of antiparallel planar face-pairs (see
      _extract_sheet_metal_geometry) that fall in a plausible thin-wall band but are spread
      across MULTIPLE close bins rather than one dominant modal bin (0–1). Sheet metal
      produces one sharp, overwhelming bin (one gauge everywhere); a molded shell + ribs +
      bosses produces several close-but-distinct thin bins (nominal wall, rib walls, boss
      walls — all thin, none identical). High thin_wall_ratio with no single dominant bin is
      evidence for injection_molded, not sheet_metal.

    draft_face_ratio: fraction of "vertical" walls (relative to the shortest bbox axis, the
      likely mold pull direction) sitting at a small non-zero angle (roughly 0.3°–5°) off
      that axis, rather than exactly parallel/perpendicular to it (0–1). Sheet metal and
      milled walls are (within tolerance) exactly parallel or perpendicular; molded parts are
      deliberately drafted for ejection. 0.0 when not computed (caller doesn't support it yet).
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

    # Pre-veto gate: cylindrical-face-dominated topology with non-rotational alignment.
    # Sheet metal enclosures (boxes, frames, channels) have many small cylindrical faces
    # from bend radii. The pocket detector false-positives heavily on their enclosed
    # cavities, so the normal pocket veto would incorrectly block classification.
    # When > 40% of faces are cylindrical AND the part is not rotationally symmetric
    # (cyl_axis_alignment < 0.50 — rules out turned discs/flanges with many holes)
    # AND no large external-OD cylinders, the dominant signal is sheet metal.
    # ZDR90 enclosure: hole_density=0.57, flatness=0.52, cyl_alignment=0.41 → fires here.
    if (hole_density > 0.40
            and flatness < 0.65
            and cyl_axis_alignment < 0.50
            and large_cyl_count == 0):
        confidence = min(0.88, 0.72 + min(hole_density, 0.80) * 0.18)
        return "sheet_metal", round(confidence, 3), [
            f"Cylindrical-face-dominated topology ({hole_density:.0%} of faces) "
            f"with flat-ish bbox (flatness={flatness:.2f}) and non-rotational alignment "
            f"(cyl_alignment={cyl_axis_alignment:.2f}) — bend-rich or perforated sheet metal",
        ]

    # Hard veto: parts with multiple large-radius cylinders (external OD surfaces) cannot
    # be sheet metal. A lens holder / flange / shaft has external diameters >> hole radii;
    # a perforated sheet has only small holes. Threshold: > 3 large cylinders detected.
    #
    # BUT large_cyl_count only counts hole RADIUS — it cannot tell a big external turned
    # diameter from a big clearance/lightening hole punched or laser-cut through a flat
    # sheet (motor-mount brackets routinely have a Ø50+ shaft-clearance hole). Once the
    # part is already hole-dense (hole_density ≥ 0.20 — the same bar gate 1b below uses
    # to call a part "perforated sheet metal"), a couple of oversized holes among many
    # small ones is normal sheet-metal geometry, not evidence of turning. Only veto on
    # large cylinders when the part is NOT already hole-dense — i.e. a genuinely turned/
    # milled part with a few big bores and otherwise sparse holes.
    #
    # Pocket veto: enclosed prismatic recesses require milling — not achievable on laser/punch.
    # > 2 pockets distinguishes CNC milled blocks (e.g. Boom Clamp, bracket with bosses)
    # from sheet metal — BUT the pocket detector false-positives on rectangular slot
    # cutouts and bend-relief/corner-notch geometry in perforated sheet (e.g. ZDR90 basket:
    # 505 holes + 271 pockets from body topology). When holes overwhelm pockets (≥ 5:1 and
    # past the perforation threshold of 20), the part is hole-dominated sheet and the
    # pocket veto must not apply.
    #
    # That ratio/count escape hatch doesn't scale down to smaller parts with proportionally
    # fewer total features: Motor Bracket regression (bbox 135x165.5x70, 15 holes incl.
    # Ø58x2 + Ø70x1 motor-shaft clearance, only 26 total faces) has just 9 "pockets" — almost
    # certainly bend-relief/corner-notch artifacts on a 3.2mm sheet, which cannot physically
    # have real machined pockets — but 15 holes never reaches the 5:1/20-hole escape tuned for
    # ZDR90-scale parts. hole_density (58% of ALL faces are holes here) is a normalized signal
    # that scales correctly regardless of part size: comfortably past gate 1b's own 0.20 bar,
    # a majority-hole-faces topology is unambiguously perforated sheet, so it overrides the
    # pocket veto independently of the ratio/count check. Without this fix the part fell
    # through to the disc/flange rotational heuristic (which false-positives here because
    # every hole through a flat sheet is perpendicular to it, i.e. axis-aligned, mimicking a
    # turned part's shared spin axis) → misclassified as mill_turn at 75% confidence.
    pockets_dominate = (
        pocket_count > 2
        and hole_count < max(20, pocket_count * 5)
        and hole_density < 0.50
    )
    sheet_metal_veto = (large_cyl_count > 3 and hole_density < 0.20) or pockets_dominate

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
    # Threshold relaxed to 0.48: a 300×300×140mm sheet metal box has flatness=0.47 but is
    # clearly sheet metal — the original 0.35 cutoff was too tight for formed enclosures.
    if not sheet_metal_veto and planar_face_fraction > 0.70 and flatness < 0.48:
        confidence = min(0.82, 0.62 + (0.48 - flatness) * 0.4 + planar_face_fraction * 0.1)
        return "sheet_metal", round(confidence, 3), [
            f"Predominantly planar surfaces ({planar_face_fraction:.0%}) "
            f"with flat-ish bbox (flatness={flatness:.2f})",
            "Surface topology consistent with sheet metal",
        ]

    # Gate 1d — fill ratio gate (formed sheet metal bracket / enclosure).
    # If the part occupies < 10% of its bounding box volume AND its faces are majority
    # planar AND it is not rotationally symmetric, the part is almost certainly a bent
    # sheet metal bracket or box — a solid machined block could never have this geometry.
    # This gate is intentionally NOT blocked by sheet_metal_veto because the veto's
    # pocket_count heuristic fires incorrectly on formed sheet metal: bends read as
    # "pockets" to the planar-face detector (the concave inner corner of each bend has
    # a planar floor face). A fill ratio < 10% is a stronger and more reliable signal
    # than pocket count for distinguishing formed sheet from machined solid.
    if volume_mm3 > 0:
        _bbox_vol = dims[0] * dims[1] * dims[2]
        _fill_ratio = volume_mm3 / _bbox_vol if _bbox_vol > 0 else 1.0
        if (_fill_ratio < 0.10
                and planar_face_fraction > 0.50
                and not (cyl_axis_alignment > 0.65 and rotational_face_ratio > 0.35)
                and dims[0] / dims[2] < 0.80):
            _conf = round(min(0.85, 0.65 + (0.10 - _fill_ratio) * 5.0), 3)
            return "sheet_metal", _conf, [
                f"Very low fill ratio ({_fill_ratio:.3f} < 0.10): part occupies "
                f"{_fill_ratio:.1%} of bounding box — formed sheet metal bracket/enclosure",
                f"Majority planar faces ({planar_face_fraction:.0%}) confirm non-solid topology",
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

    # Injection-molded shell: not flat enough for the sheet-metal gates above, not
    # rotationally dominant enough for the disc/turned gates above — a thin shell
    # with ribs/bosses/draft reads as a non-flat, non-rotational solid today and
    # falls all the way to the cnc_milled catch-all below. Two independent signals
    # distinguish it from a genuinely milled block: (1) a molded shell's wall pairs
    # cluster into several close-but-distinct thin bins rather than one dominant
    # gauge (thin_wall_ratio) or one solid mass, and (2) ribs/bosses inflate the
    # pocket-detector floor-face count (see pocket_count docstring) on a part with
    # too few real holes to be sheet metal but no rotational symmetry either.
    # draft_face_ratio is the strongest single signal when available but starts at
    # 0.0 until the caller computes it — thin_wall_ratio + pocket_count alone are
    # enough to fire conservatively; confidence stays modest (0.65–0.72) until this
    # is tuned against real parts, same as every other gate in this function was.
    #
    # NOTE: deliberately does NOT check sheet_metal_veto — that variable protects
    # the SHEET-METAL gates above (1b-abs/1b/1c) from firing on parts with real
    # pockets; it says nothing about whether THIS part is milled vs. molded, and
    # reusing it here would block the gate on any part with pocket_count > 2 —
    # exactly the parts ribs/bosses are expected to produce.
    if (thin_wall_ratio > 0.35
            and cyl_axis_alignment < 0.50
            and circularity < 0.80
            and (draft_face_ratio > 0.30 or pocket_count >= 3)):
        confidence = min(0.72, 0.60 + thin_wall_ratio * 0.15 + draft_face_ratio * 0.20)
        reasons = [
            f"Thin-wall shell with multiple close-but-distinct gauge bins "
            f"(thin_wall_ratio={thin_wall_ratio:.2f} > 0.35) — not one dominant sheet gauge",
            f"Not rotationally dominant (cyl_alignment={cyl_axis_alignment:.2f}, "
            f"circularity={circularity:.2f})",
        ]
        if draft_face_ratio > 0.30:
            reasons.append(f"Drafted walls detected (draft_face_ratio={draft_face_ratio:.2f} > 0.30)")
        else:
            reasons.append(f"Elevated pocket count ({pocket_count}) consistent with ribs/bosses")
        return "injection_molded", round(confidence, 3), reasons

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
            if raw_cylinders_full:
                # Full tuples carry axial patch length → profile-radius filtering possible
                bends = self._count_bends_from_full(raw_cylinders_full, sheet_thickness)
            else:
                bends = self._count_bends_from_list(raw_cylinders, sheet_thickness)
        except Exception as e:
            logger.warning(f"[SheetMetal] bend detection failed: {e}")

        # Sharp-corner fallback: no cylindrical bend-radius faces found on a
        # confirmed sheet (thickness detected) — the part may be a "dumb solid"
        # STEP import (mitered fold lines, no bend relief). Detect folds from
        # face-normal dihedral angles instead of bend-radius cylinders.
        if bends["count"] == 0 and sheet_thickness > 0:
            try:
                sharp = self._detect_sharp_bends(shape, bbox_dims, sheet_thickness)
                if sharp["count"] > 0:
                    # radii stay empty — sharp folds have none; angles are NOT radii
                    # and must not leak into bend_radii_mm ("R90.0" in the UI)
                    bends = {
                        "count": sharp["count"], "radii": [], "all_radii": [],
                        "angles_deg": sharp["angles"],
                    }
                    logger.info(
                        f"[SheetMetal] sharp-corner bend fallback: {sharp['count']} fold(s) "
                        f"detected via dihedral angle (no bend-radius cylinders present)"
                    )
            except Exception as e:
                logger.warning(f"[SheetMetal] sharp-bend fallback failed: {e}")

        # Physics invariant: a FLAT part cannot contain bends. Bending folds the
        # sheet out of plane, so a bent part's smallest bbox dimension is always
        # far greater than the sheet thickness. When min(bbox) ≈ thickness the
        # part is a flat blank/plate and every "bend" candidate is edge-fillet
        # noise (e.g. rounded slot walls on a machined bronze plate).
        min_bbox = min(bbox_dims) if bbox_dims else 0.0
        if bends["count"] > 0 and sheet_thickness > 0 and min_bbox <= sheet_thickness * 1.5:
            logger.info(
                f"[SheetMetal] flat-part guard: zeroing {bends['count']} bend candidate(s) — "
                f"min bbox {min_bbox:.1f}mm ~ thickness {sheet_thickness:.1f}mm (flat blank)"
            )
            bends = {"count": 0, "radii": [], "all_radii": []}

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
            "bend_angles_deg": bends.get("angles_deg", []),
            "bend_confidence": 0.65 if bends.get("angles_deg") else 0.75,
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
        # Bends: axis roughly horizontal (abs_axis_z < 0.5), radius within sheet-thickness
        # range, AND axial length well above sheet thickness — cut-edge profile radii and
        # corner fillets are cylinders too, but only span the thickness of the sheet.
        max_bend_r = max(sheet_thickness * 8, 20.0)
        bend_entries = [
            c for c in raw_cylinders_full
            if self._is_bend_cylinder(c, sheet_thickness, max_bend_r)
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

    @staticmethod
    def _min_bend_line_mm(sheet_thickness: float) -> float:
        """
        Minimum axial length for a cylindrical face to qualify as a bend.

        A press-brake bend cylinder spans the flange width (tens of mm). A profile
        radius or corner fillet on the CUT EDGE of the sheet is also a cylinder with
        an in-plane axis, but its axial extent equals the sheet thickness — that is
        the physical height of the cut edge. Requiring axial length > 2× thickness
        (floor 3 mm) rejects outer-contour radii (e.g. R35/R29 profile arcs) and
        corner fillets (R2.5) without touching real bends, whose shortest practical
        bend line is a ~6 mm tab.
        """
        return max(2.0 * sheet_thickness, 3.0) if sheet_thickness > 0 else 3.0

    def _is_bend_cylinder(
        self,
        cyl: Tuple,
        sheet_thickness: float,
        max_bend_radius: float,
    ) -> bool:
        """Bend test for a full cylinder tuple (see _build_feature_occurrences)."""
        if cyl[1] >= 0.5:                       # axis must be in the sheet plane
            return False
        if not (0.1 <= cyl[0] <= max_bend_radius):
            return False
        # m[9] = axial patch length — absent on legacy 9-tuples; skip filter then
        if len(cyl) > 9 and cyl[9] is not None and cyl[9] < self._min_bend_line_mm(sheet_thickness):
            return False
        return True

    def _count_bends_from_full(
        self,
        raw_cylinders_full: List[Tuple],
        sheet_thickness: float,
    ) -> Dict[str, Any]:
        """Bend count/radii from full tuples, with profile-radius noise filtered out."""
        max_bend_radius = max(sheet_thickness * 8, 20.0)
        bend_radii: List[float] = [
            round(c[0], 3)
            for c in raw_cylinders_full
            if self._is_bend_cylinder(c, sheet_thickness, max_bend_radius)
        ]
        sorted_radii = sorted(round(r, 1) for r in bend_radii)
        inner_radii = sorted_radii[::2]
        return {
            "count": len(bend_radii) // 2,
            "radii": sorted(set(inner_radii)),
            "all_radii": inner_radii,
        }

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

    def _detect_sharp_bends(
        self,
        shape: Any,
        bbox_dims: List[float],
        sheet_thickness: float,
    ) -> Dict[str, Any]:
        """
        Fallback bend detector for STEP files modeled with sharp/mitered fold lines
        instead of filleted bend radii — a "dumb solid" import (sewn faces, no bend
        relief) common in customer-supplied STEP files. _count_bends_from_full/_list
        only see cylindrical bend-radius faces; a sharp-corner model has none of
        those, so bend_count silently reads 0 even on a visibly folded part.

        Detects large planar face pairs that:
          - share a common straight (non-arc) edge — a fold line, not a hole/fillet
            boundary,
          - are NOT coplanar: dihedral angle between unit normals in (15°, 165°).
            Below 15° is a coplanar split face (not a bend); above 165° is a
            hem/fold-flat — geometrically degenerate for this proxy, excluded to
            avoid double-counting a hem as an extra bend line,
          - both faces are large flange panels, not the laser-cut perimeter wall.
            That wall meets the top/bottom panel at ~90° too, but it is only
            sheet_thickness wide — min_flange_area excludes it by area, not angle.

        Each qualifying pair counts as one bend line (a topology proxy for one
        press-brake hit, matching how the cylindrical-radius path already counts
        one bend per radius pair).
        """
        from OCC.Core.TopExp import TopExp_Explorer, topexp  # type: ignore
        from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_EDGE  # type: ignore
        from OCC.Core.TopoDS import topods  # type: ignore
        from OCC.Core.TopTools import TopTools_IndexedDataMapOfShapeListOfShape, TopTools_ListIteratorOfListOfShape  # type: ignore
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface, BRepAdaptor_Curve  # type: ignore
        from OCC.Core.GeomAbs import GeomAbs_Plane, GeomAbs_Line  # type: ignore
        from OCC.Core.BRepGProp import brepgprop  # type: ignore
        from OCC.Core.GProp import GProp_GProps  # type: ignore

        MAX_HASH = 2 ** 31 - 1
        max_dim = max(bbox_dims) if bbox_dims else 1.0
        min_flange_area = max(sheet_thickness * 20.0, (max_dim * 0.15) ** 2 * 0.5)

        # ── Collect large planar faces (candidate flanges) ────────────────────
        planar_faces: List[Tuple[Any, Tuple[float, float, float]]] = []
        face_hash_to_idx: Dict[int, int] = {}
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
                    if mag > 1e-9:
                        nx, ny, nz = nx / mag, ny / mag, nz / mag
                        props = GProp_GProps()
                        brepgprop.SurfaceProperties(face, props)
                        if props.Mass() >= min_flange_area:
                            face_hash_to_idx[face.HashCode(MAX_HASH)] = len(planar_faces)
                            planar_faces.append((face, (nx, ny, nz)))
            except Exception:
                pass
            explorer.Next()

        if len(planar_faces) < 2:
            return {"count": 0, "angles": []}

        # ── Edge → adjacent-face map for the whole shape ──────────────────────
        try:
            edge_face_map = TopTools_IndexedDataMapOfShapeListOfShape()
            topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edge_face_map)  # type: ignore
        except Exception as e:
            logger.warning(f"[SheetMetal] sharp-bend edge map failed: {e}")
            return {"count": 0, "angles": []}

        seen_pairs = set()
        bend_angles: List[float] = []
        edge_exp = TopExp_Explorer(shape, TopAbs_EDGE)
        while edge_exp.More():
            edge = topods.Edge(edge_exp.Current())
            edge_exp.Next()
            try:
                if BRepAdaptor_Curve(edge).GetType() != GeomAbs_Line:
                    continue  # only straight fold lines — arcs are hole/fillet boundaries

                idx = edge_face_map.FindIndex(edge)
                if idx <= 0:
                    continue
                adj_list = edge_face_map.FindFromIndex(idx)
                it = TopTools_ListIteratorOfListOfShape(adj_list)
                candidate_idxs = []
                while it.More():
                    fh = topods.Face(it.Value()).HashCode(MAX_HASH)
                    it.Next()
                    fidx = face_hash_to_idx.get(fh)
                    if fidx is not None:
                        candidate_idxs.append(fidx)
                if len(candidate_idxs) != 2:
                    continue

                i, j = sorted(set(candidate_idxs))
                if i == j or (i, j) in seen_pairs:
                    continue
                seen_pairs.add((i, j))

                n1, n2 = planar_faces[i][1], planar_faces[j][1]
                dot = max(-1.0, min(1.0, n1[0]*n2[0] + n1[1]*n2[1] + n1[2]*n2[2]))
                angle_deg = math.degrees(math.acos(dot))
                if 15.0 < angle_deg < 165.0:
                    bend_angles.append(round(angle_deg, 1))
            except Exception:
                continue

        return {"count": len(bend_angles), "angles": sorted(bend_angles)}

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
        tap_candidates = _annotate_tap_candidates(hole_groups)
        return {
            "count":        sum(counter.values()),
            "diameters":    sorted(counter.keys()),
            "all_diameters": sorted(diameters),   # kept for backward compat
            "hole_groups":  hole_groups,
            "tap_candidates": tap_candidates,
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
        tap_candidates = _annotate_tap_candidates(hole_groups)
        return {
            "count":         len(hole_entries),
            "diameters":     sorted(groups.keys()),
            "all_diameters": all_diameters_sorted,
            "hole_groups":   hole_groups,
            "tap_candidates": tap_candidates,
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
            topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, edge_face_map)  # type: ignore
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


# ─────────────────────────────────────────────────────────────────────────────
# Injection-Molded Feature Extractor — Phase 2
# ─────────────────────────────────────────────────────────────────────────────


class InjectionMoldedFeatureExtractor:
    """
    Extracts injection-molded-plastic manufacturing features from an OCC
    TopoDS_Shape.

    Phase 1 (im_v1_phase1): wall thickness modal/min/max, hole-or-boss count
      (lumped), fillet radii, rib_count_proxy from pocket-floor faces.

    Phase 2 (im_v2_phase2): adds three new measurement passes:
      _analyze_wall_uniformity  — std-dev / thin-wall violations, derived from
        the existing antiparallel-face-pair histogram at zero extra OCC cost.
      _analyze_draft_angles     — per-wall-face draft angle vs the pull axis
        (shortest bbox dimension); yields undrafted_face_count, undercut_face_count,
        and parting_complexity (0-1) consumed by the routing engine.
      _detect_blind_features    — cylinder adjacency check (cap face detection)
        that splits hole_or_boss_count into through_hole_count + blind_feature_count;
        first step toward boss vs blind-hole discrimination (Phase 3).

    Still deferred (no real injection-molded test part to tune against yet):
      - True rib detection (rib_count_proxy remains the pocket-floor-face proxy)
      - Boss vs blind-hole discrimination (both counted as blind_feature_count)
      - Per-instance occurrence graph (feature_graph_v2 = None)
    """

    def __init__(self):
        # Composition over inheritance — the antiparallel-face-pair histogram and
        # cylindrical-face collection are family-agnostic OCC primitives already
        # proven in SheetMetalFeatureExtractor; reuse rather than duplicate.
        self._sm = SheetMetalFeatureExtractor()

    # Cylindrical faces below this radius are corner/edge blends (mold fillets),
    # not functional holes or bosses.
    FILLET_MAX_RADIUS_MM = 2.0

    def extract(
        self,
        shape: Any,
        bbox_dims: List[float],
        raw_cylinders_full: Optional[List[Tuple]] = None,
        sheet_geometry: Optional[Tuple[float, Any, float, Dict[str, Any]]] = None,
        pocket_count: int = 0,
        face_map: Optional[List[Dict]] = None,
        face_map_tri_total: int = 0,
    ) -> Dict[str, Any]:
        """
        raw_cylinders_full: pre-computed 9+-tuple cylinder list from _detect_holes_real
          — skips a redundant OCC face scan when supplied.
        sheet_geometry: pre-computed (thickness, dominant_face, confidence, debug)
          from _extract_sheet_metal_geometry — avoids a second antiparallel-pair scan.
        pocket_count: pocket-detector floor-face count from the caller; surfaced as
          rib_count_proxy (pocket floors on a non-sheet, non-rotational part are the
          most reliable Phase 1 proxy for ribs/bosses).
        """
        # ── Wall thickness — antiparallel-face-pair histogram ─────────────────
        if sheet_geometry is not None:
            modal_thickness, _dominant_face, thickness_conf, geom_debug = sheet_geometry
        else:
            modal_thickness, _dominant_face, thickness_conf, geom_debug = (
                self._sm._extract_sheet_metal_geometry(shape, bbox_dims)
            )
        hist_debug = geom_debug.get("thickness_histogram", {})
        thin_band_max = max(modal_thickness * 2.0, 6.0)
        thin_bins = sorted(float(k) for k in hist_debug.keys() if float(k) <= thin_band_max)
        wall_min = thin_bins[0] if thin_bins else modal_thickness
        wall_max = thin_bins[-1] if thin_bins else modal_thickness
        wall_confidence = round(min(0.75, thickness_conf * 0.85), 3)

        # ── Phase 2: wall uniformity ──────────────────────────────────────────
        wall_uniformity = self._analyze_wall_uniformity(hist_debug, modal_thickness)

        # ── Cylindrical features ──────────────────────────────────────────────
        if raw_cylinders_full is None:
            try:
                raw_pairs = self._sm._collect_cylindrical_faces(shape)
                raw_cylinders_full = [(r, az) for r, az in raw_pairs]
            except Exception as e:
                logger.warning(f"[InjectionMolded] cylindrical face scan failed: {e}")
                raw_cylinders_full = []

        vertical = [c for c in raw_cylinders_full if len(c) > 1 and c[1] >= 0.5]
        fillets = [c for c in vertical if c[0] <= self.FILLET_MAX_RADIUS_MM]
        holes_or_bosses = [c for c in vertical if c[0] > self.FILLET_MAX_RADIUS_MM]

        hb_diam_counts: Dict[float, int] = defaultdict(int)
        for c in holes_or_bosses:
            hb_diam_counts[round(c[0] * 2, 1)] += 1
        hole_or_boss_groups = sorted(
            [{"diameter_mm": d, "count": n} for d, n in hb_diam_counts.items()],
            key=lambda x: x["diameter_mm"],
        )
        fillet_radii_mm = sorted(set(round(c[0], 2) for c in fillets))

        # ── Phase 2: blind feature detection (through vs capped cylinder) ─────
        blind_features = self._detect_blind_features(shape, bbox_dims)

        # ── Phase 3: insert candidate detection ──────────────────────────────
        inserts = self._detect_insert_candidates(
            blind_features.get("blind_feature_diameters_mm", [])
        )

        # ── Phase 4: draft angle analysis + rib detection ────────────────────
        draft = self._analyze_draft_angles(shape, bbox_dims)

        # _detect_ribs reuses wall_face_planes collected inside _analyze_draft_angles
        # (returned as internal keys so no second OCC scan is needed).
        wall_planes = draft.pop("_wall_face_planes", [])
        draft.pop("_pull_axis_idx", None)  # extracted but only needed internally
        # DFM face groups with face_ids for 3D highlighting (populated when face_map supplied)
        im_dfm_groups = draft.pop("_dfm_face_groups", None)
        # All draft face classifications for heatmap (includes drafted/overdrafted, not just DFM groups)
        all_draft_faces_hm: List[Dict[str, Any]] = []
        if im_dfm_groups:
            all_draft_faces_hm = im_dfm_groups.pop("_all_draft_faces", [])
        ribs = self._detect_ribs(wall_planes, modal_thickness)
        rib_data_hm = ribs.pop("rib_data", [])

        logger.info(
            f"[InjectionMolded] wall={modal_thickness:.2f}mm "
            f"uniformity_ratio={wall_uniformity.get('wall_uniformity_ratio')} "
            f"thin_violations={wall_uniformity.get('thin_wall_violation_count')} "
            f"drafted={draft.get('drafted_face_count')} "
            f"undrafted={draft.get('undrafted_face_count')} "
            f"undercut={draft.get('undercut_face_count')} "
            f"parting_complexity={draft.get('parting_complexity')} "
            f"ribs={ribs.get('rib_count')} "
            f"through_holes={blind_features.get('through_hole_count')} "
            f"blind={blind_features.get('blind_feature_count')} "
            f"insert_candidates={inserts.get('insert_candidate_count')}"
        )

        return {
            # Phase 1 — wall thickness
            "wall_thickness_nominal_mm": round(modal_thickness, 3),
            "wall_thickness_min_mm": round(wall_min, 3),
            "wall_thickness_max_mm": round(wall_max, 3),
            "wall_thickness_confidence": wall_confidence,
            "wall_geometry_debug": geom_debug,
            # Phase 2 — wall uniformity
            "wall_thickness_std_dev_mm": wall_uniformity["wall_thickness_std_dev_mm"],
            "thin_wall_violation_count": wall_uniformity["thin_wall_violation_count"],
            "thick_wall_violation_count": wall_uniformity["thick_wall_violation_count"],
            "wall_uniformity_ratio": wall_uniformity["wall_uniformity_ratio"],
            # Phase 1 — cylindrical features (hole/boss lumped)
            "hole_or_boss_count": len(holes_or_bosses),
            "hole_or_boss_groups": hole_or_boss_groups,
            "hole_or_boss_confidence": 0.55,
            # Phase 2 — blind feature split
            "through_hole_count": blind_features["through_hole_count"],
            "blind_feature_count": blind_features["blind_feature_count"],
            "blind_feature_diameters_mm": blind_features["blind_feature_diameters_mm"],
            "blind_feature_confidence": blind_features["confidence"],
            # Phase 3 — insert candidates
            "insert_candidate_count": inserts["insert_candidate_count"],
            "insert_candidates": inserts["insert_candidates"],
            "insert_confidence": inserts["insert_confidence"],
            # Phase 1 — fillets
            "fillet_count": len(fillets),
            "fillet_radii_mm": fillet_radii_mm,
            "fillet_confidence": 0.60,
            # Phase 1 — rib proxy (pocket-floor-face count, kept for backward compat)
            "rib_count_proxy": pocket_count,
            "rib_count_confidence": 0.40,
            # Phase 4 — rib detection (antiparallel wall-face pairs at rib separation)
            # Supersedes rib_count_proxy; higher confidence for straight-rib geometry.
            "rib_count": ribs["rib_count"],
            "rib_groups": ribs["rib_groups"],
            "rib_count_real_confidence": ribs["rib_confidence"],
            # Phase 2 — draft angles
            "undrafted_face_count": draft["undrafted_face_count"],
            "drafted_face_count": draft["drafted_face_count"],
            "overdrafted_face_count": draft["overdrafted_face_count"],
            "undercut_face_count": draft["undercut_face_count"],
            "total_wall_face_count": draft["total_wall_face_count"],
            "avg_draft_angle_deg": draft["avg_draft_angle_deg"],
            "parting_complexity": draft["parting_complexity"],
            "pull_axis": draft["pull_axis"],
            "draft_confidence": draft["draft_confidence"],
            # feature_graph_v2: always built for IM so the frontend heatmap gate passes
            # even for simple parts with no undercuts or undrafted faces.
            "feature_graph_v2": self._build_im_feature_graph(
                im_dfm_groups, face_map or [], face_map_tri_total,
                inserts.get("insert_candidates", []),
            ),
            # Per-feature spatial data for localized heatmap blobs on the 3D viewer
            "heatmap_features": self._build_heatmap_features(
                all_draft_faces=all_draft_faces_hm,
                blind_feature_data=blind_features.get("blind_feature_data", []),
                rib_data=rib_data_hm,
                wall_samples=self._collect_wall_samples(wall_planes, modal_thickness),
                nominal_wall_mm=modal_thickness,
            ),
            "extraction_version": "im_v5_heatmap",
        }

    # ── Phase 2: wall uniformity ──────────────────────────────────────────────

    def _analyze_wall_uniformity(
        self,
        hist_debug: Dict[str, Any],
        nominal_mm: float,
    ) -> Dict[str, Any]:
        """
        Derive DFM-relevant wall-thickness statistics from the antiparallel-face-pair
        histogram already computed by _extract_sheet_metal_geometry — zero additional
        OCC passes required.

        thin_wall_violation_count: distinct histogram bins below 0.60 × nominal —
          industry minimum for uniform cooling; walls this thin relative to nominal
          cause differential shrinkage, sink marks, and short-shot risk.
        thick_wall_violation_count: distinct bins above 2.0 × nominal — excessive
          local thickness creates sink marks on the opposite surface and extends
          cooling time non-linearly (t_cool ∝ wall²).
        wall_uniformity_ratio: std_dev / nominal — < 0.20 = well-controlled,
          0.20–0.40 = moderate variation, > 0.40 = DFM concern.
        """
        if not hist_debug or nominal_mm <= 0:
            return {
                "wall_thickness_std_dev_mm": None,
                "thin_wall_violation_count": 0,
                "thick_wall_violation_count": 0,
                "wall_uniformity_ratio": None,
            }

        # Reconstruct a weighted sample from the histogram: each bin key appears
        # once per pair count so std-dev is pair-count-weighted, not area-weighted.
        # This matches how a DFM tool would weight: one thick region is one concern
        # regardless of how large that face happens to be.
        bins: List[float] = []
        for k, v in hist_debug.items():
            bin_val = float(k)
            count = v.get("pairs", 1) if isinstance(v, dict) else 1
            bins.extend([bin_val] * max(count, 1))

        if not bins:
            return {
                "wall_thickness_std_dev_mm": None,
                "thin_wall_violation_count": 0,
                "thick_wall_violation_count": 0,
                "wall_uniformity_ratio": None,
            }

        mean = sum(bins) / len(bins)
        std_dev = math.sqrt(sum((b - mean) ** 2 for b in bins) / len(bins))

        # Violations counted per distinct bin key, not per pair — avoids inflating
        # the count from one thick rib region with many parallel face pairs.
        unique_bins = {float(k) for k in hist_debug.keys()}
        thin_violations = sum(1 for b in unique_bins if 0.3 <= b < nominal_mm * 0.60)
        thick_violations = sum(1 for b in unique_bins if b > nominal_mm * 2.0)
        uniformity_ratio = round(std_dev / nominal_mm, 3) if nominal_mm > 0 else None

        return {
            "wall_thickness_std_dev_mm": round(std_dev, 3),
            "thin_wall_violation_count": thin_violations,
            "thick_wall_violation_count": thick_violations,
            "wall_uniformity_ratio": uniformity_ratio,
        }

    # ── Phase 2: draft angle analysis ────────────────────────────────────────

    def _analyze_draft_angles(
        self,
        shape: Any,
        bbox_dims: List[float],
    ) -> Dict[str, Any]:
        """
        Measure per-face draft angles on "wall faces" — planar faces whose normal
        is roughly perpendicular to the mold pull direction.

        Pull direction = the canonical axis (x/y/z) aligned with the shortest
        bounding-box dimension (the standard mold opening / ejection direction).

        For a wall face with unit normal n and pull unit vector p:
          draft_angle = arcsin(|dot(n, p)|)
          (When dot = 0: face is exactly perpendicular to pull → 0° draft.
           When dot = sin(2°) ≈ 0.035: face has 2° draft.)

        Classification (industry standard for thermoplastics):
          undrafted:   draft_angle < 0.3°   — straight-pull surface, ejection risk
          drafted:     0.3° ≤ angle ≤ 5°    — within standard draft range
          overdrafted: angle > 5°            — acceptable but notable for deep ribs
          undercut:    dot(n, p) < −sin(0.3°) — face normal opposes pull direction;
                       requires slide, lifter, or part-line re-design

        parting_complexity (0–1): derived from the ratio of undrafted + undercut
        faces to total wall faces. Feeds the routing engine's deflashing gate:
          complexity ≥ 0.5 → deflashing routed (stepped/complex shutoff line).

        Confidence is 0.65 — a V1 heuristic on a single-body assumption. Molds with
        multiple parting surfaces or unsupported side actions may show false undrafts
        on the action faces. Tune against real parts before raising confidence.
        """
        _FALLBACK = {
            "undrafted_face_count": 0,
            "drafted_face_count": 0,
            "overdrafted_face_count": 0,
            "undercut_face_count": 0,
            "total_wall_face_count": 0,
            "avg_draft_angle_deg": None,
            "parting_complexity": None,
            "pull_axis": None,
            "draft_confidence": 0.0,
        }
        try:
            from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
            from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
            from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
            from OCC.Core.GeomAbs import GeomAbs_Plane  # type: ignore
            from OCC.Core.TopoDS import topods  # type: ignore
            from OCC.Core.BRepGProp import brepgprop  # type: ignore
            from OCC.Core.GProp import GProp_GProps  # type: ignore
        except ImportError:
            logger.warning("[InjectionMolded] OCC unavailable for draft analysis")
            return _FALLBACK

        # ── Pull axis: dominant planar face normal ─────────────────────────────
        # The mold opens perpendicular to the parting surface — the largest flat
        # face in the part. Accumulate planar face area per canonical axis; the
        # axis with the most area is the parting-surface normal = pull direction.
        #
        # This is more robust than min(bbox_dims) for non-flat parts:
        #   flat cover 150×96×6:  large top/bottom faces ⊥ Z → pull=Z ✓
        #   deep cup 50×50×200:   large bottom face ⊥ Z (bigger than any wall) → pull=Z ✓
        #   box shell 100×80×40:  large side faces ⊥ longest dims, bottom largest → correct
        #
        # Fallback to min(bbox_dims) when no clearly dominant axis is found (e.g.
        # the shape is a pure cylinder with no planar faces).
        axis_area = [0.0, 0.0, 0.0]
        _pre_exp = TopExp_Explorer(shape, TopAbs_FACE)
        while _pre_exp.More():
            try:
                _f = topods.Face(_pre_exp.Current())
                _adp = BRepAdaptor_Surface(_f)
                if _adp.GetType() == GeomAbs_Plane:
                    _n = _adp.Plane().Axis().Direction()
                    _comps = [abs(float(_n.X())), abs(float(_n.Y())), abs(float(_n.Z()))]
                    _dom = max(range(3), key=lambda i: _comps[i])
                    if _comps[_dom] >= 0.70:  # clearly aligned to one axis
                        _gp = GProp_GProps()
                        brepgprop.SurfaceProperties(_f, _gp)
                        axis_area[_dom] += _gp.Mass()
            except Exception:
                pass
            _pre_exp.Next()

        if max(axis_area) >= 1.0:
            pull_axis_idx = int(max(range(3), key=lambda i: axis_area[i]))
        else:
            pull_axis_idx = min(range(len(bbox_dims)), key=lambda i: bbox_dims[i])

        pull_axis_names = ["x", "y", "z"]
        pull: Tuple[float, float, float] = (
            1.0 if pull_axis_idx == 0 else 0.0,
            1.0 if pull_axis_idx == 1 else 0.0,
            1.0 if pull_axis_idx == 2 else 0.0,
        )

        # Wall faces: normal roughly ⊥ pull → |dot(n, pull)| < cos(75°) ≈ 0.259.
        # Base/top/parting faces (normal ≈ pull) are excluded — they don't need draft.
        WALL_FACE_COS_THRESHOLD = 0.259  # cos(75°)
        MIN_FACE_AREA_MM2 = 10.0

        # ── Undercut threshold ─────────────────────────────────────────────────
        # A mold has TWO halves pulling in opposite directions. A face with a
        # small NEGATIVE dot product with the chosen pull vector is NOT an undercut
        # — it is a correctly drafted face belonging to the cavity half of the mold
        # (e.g., side walls of a lid that taper toward the parting surface).
        #
        # True undercutcuts have a SIGNIFICANT back-angle: the face normal opposes
        # pull by more than a generous draft range (5°). At <5° back-angle, the face
        # is attributed to the opposite mold half and classified as drafted.
        #
        # Previous threshold was -sin(0.3°) ≈ -0.005 — this caused any cavity-half
        # draft angle (even 0.5°) to be reported as an undercut. Now raised to
        # -sin(5°) ≈ -0.087 so only faces with genuine back-angles flag as undercut.
        UNDERCUT_NEG_DOT_THRESHOLD = -math.sin(math.radians(5.0))   # ≈ -0.087
        UNDRAFTED_ABS_DOT_THRESHOLD = math.sin(math.radians(0.3))   # ≈ 0.005

        undrafted_count = 0
        drafted_count = 0
        overdrafted_count = 0
        undercut_count = 0
        draft_angles: List[float] = []

        # Collect wall face plane equations for reuse in rib detection:
        # (nx, ny, nz, plane_offset, area, cx, cy, cz) — 8-tuple with centroid for heatmap placement
        wall_face_planes: List[Tuple] = []

        # DFM face groups for 3D highlighting: track face_index (global ordinal matching
        # face_map from _detect_holes_real) and centroid per classified face.
        undercut_dfm: List[Dict[str, Any]] = []
        undrafted_dfm: List[Dict[str, Any]] = []
        # All wall face classifications for heatmap source builders (not just undrafted/undercut)
        all_draft_faces_hm: List[Dict[str, Any]] = []

        face_index = 0  # counts ALL faces — matches face_map ordinal from _detect_holes_real
        explorer = TopExp_Explorer(shape, TopAbs_FACE)
        while explorer.More():
            try:
                face = topods.Face(explorer.Current())
                current_face_index = face_index
                face_index += 1

                adaptor = BRepAdaptor_Surface(face)
                if adaptor.GetType() != GeomAbs_Plane:
                    explorer.Next()
                    continue

                plane = adaptor.Plane()
                n = plane.Axis().Direction()
                p = plane.Location()
                nx, ny, nz = float(n.X()), float(n.Y()), float(n.Z())
                mag = math.sqrt(nx * nx + ny * ny + nz * nz)
                if mag < 1e-9:
                    explorer.Next()
                    continue
                nx, ny, nz = nx / mag, ny / mag, nz / mag

                # Signed dot product along pull
                dot = nx * pull[0] + ny * pull[1] + nz * pull[2]

                # Only wall faces (normal roughly ⊥ pull)
                if abs(dot) > WALL_FACE_COS_THRESHOLD:
                    explorer.Next()
                    continue

                # Skip degenerate faces
                props = GProp_GProps()
                brepgprop.SurfaceProperties(face, props)
                area = props.Mass()
                if area < MIN_FACE_AREA_MM2:
                    explorer.Next()
                    continue

                # Centroid (CentreOfMass) for 3D highlighting
                try:
                    cog = props.CentreOfMass()
                    centroid = [round(float(cog.X()), 2), round(float(cog.Y()), 2), round(float(cog.Z()), 2)]
                except Exception:
                    centroid = [round(float(p.X()), 2), round(float(p.Y()), 2), round(float(p.Z()), 2)]

                # draft_angle = arcsin(|dot|) in degrees (always non-negative)
                draft_deg = math.degrees(math.asin(min(1.0, abs(dot))))
                draft_angles.append(round(draft_deg, 2))

                # Collect plane equation for rib detection (offset = dot(location, normal))
                # 8-tuple includes centroid coords for heatmap blob placement in _detect_ribs
                offset = float(p.X()) * nx + float(p.Y()) * ny + float(p.Z()) * nz
                wall_face_planes.append((nx, ny, nz, offset, area, centroid[0], centroid[1], centroid[2]))

                # Undercut: face normal has SIGNIFICANT component opposing pull.
                # Small negative dot = cavity-half draft (valid, not an undercut).
                # Large negative dot (back-angle > 5°) = true undercut (needs slide/lifter).
                if dot < UNDERCUT_NEG_DOT_THRESHOLD:
                    undercut_count += 1
                    undercut_dfm.append({"face_id": current_face_index, "centroid": centroid, "back_angle_deg": round(draft_deg, 2)})
                    all_draft_faces_hm.append({"centroid": centroid, "draft_deg": round(draft_deg, 2), "classification": "undercut"})
                elif abs(dot) < UNDRAFTED_ABS_DOT_THRESHOLD:
                    undrafted_count += 1
                    undrafted_dfm.append({"face_id": current_face_index, "centroid": centroid, "angle_deg": round(draft_deg, 2)})
                    all_draft_faces_hm.append({"centroid": centroid, "draft_deg": round(draft_deg, 2), "classification": "undrafted"})
                elif draft_deg <= 5.0:
                    drafted_count += 1
                    all_draft_faces_hm.append({"centroid": centroid, "draft_deg": round(draft_deg, 2), "classification": "drafted"})
                else:
                    overdrafted_count += 1
                    all_draft_faces_hm.append({"centroid": centroid, "draft_deg": round(draft_deg, 2), "classification": "overdrafted"})
            except Exception:
                pass
            explorer.Next()

        total = undrafted_count + drafted_count + overdrafted_count + undercut_count
        if total == 0:
            return _FALLBACK

        # parting_complexity: undercut = full concern, undrafted = half concern.
        # Clamped to [0, 0.95]; a fully-drafted part = 0.
        raw = (undercut_count + undrafted_count * 0.5) / total
        parting_complexity = round(min(0.95, raw), 3)
        avg_draft = round(sum(draft_angles) / len(draft_angles), 2) if draft_angles else None

        logger.info(
            f"[InjectionMolded] draft: pull={pull_axis_names[pull_axis_idx]} "
            f"total_wall={total} drafted={drafted_count} undrafted={undrafted_count} "
            f"undercut={undercut_count} parting_complexity={parting_complexity}"
        )

        return {
            "undrafted_face_count": undrafted_count,
            "drafted_face_count": drafted_count,
            "overdrafted_face_count": overdrafted_count,
            "undercut_face_count": undercut_count,
            "total_wall_face_count": total,
            "avg_draft_angle_deg": avg_draft,
            "parting_complexity": parting_complexity,
            "pull_axis": pull_axis_names[pull_axis_idx],
            "draft_confidence": 0.65,
            # Internal: reused by _detect_ribs to avoid a second face scan
            "_wall_face_planes": wall_face_planes,
            "_pull_axis_idx": pull_axis_idx,
            # DFM face groups for 3D highlighting (face_id = global OCC ordinal matching face_map)
            "_dfm_face_groups": {
                "undercut": undercut_dfm,
                "undrafted": undrafted_dfm,
                "_all_draft_faces": all_draft_faces_hm,
            },
        }

    # ── Phase 4: rib detection ────────────────────────────────────────────────

    def _detect_ribs(
        self,
        wall_face_planes: List[Tuple[float, float, float, float, float]],
        nominal_wall_mm: float,
    ) -> Dict[str, Any]:
        """
        Detect ribs by finding antiparallel planar wall-face pairs at rib-typical
        separation. Reuses the wall-face plane equations already collected by
        _analyze_draft_angles — zero additional OCC passes.

        Rib geometry signature: two parallel planar faces (antiparallel normals,
        |dot(n1, n2)| > 0.97) facing each other, separated by a rib-thickness
        distance in the rib range [rib_min, rib_max].

        Industry guideline: rib thickness = 0.5–0.75× nominal wall to prevent
        sink marks on the opposite surface. Upper limit 0.85× wall to avoid
        misclassifying structural wall sections as ribs.

        Offset sign convention for antiparallel pairs:
          n2 = -n1 → offset2 = dot(P2, n2) = dot(P2, -n1) = -dot(P2, n1)
          separation = |dot(P1-P2, n1)| = |offset1 + offset2|

        Returns: {rib_count, rib_groups [{thickness_mm, count}], rib_confidence}
        Confidence 0.55: detects straight axis-aligned ribs well; diagonal/curved
        rib walls may be missed. Validated against straight-rib enclosure covers.
        """
        if not wall_face_planes or nominal_wall_mm <= 0:
            return {"rib_count": 0, "rib_groups": [], "rib_confidence": 0.0}

        ANTIPARALLEL_THRESHOLD = 0.97   # |dot(n1, n2)| > this → same direction family
        rib_min = max(0.4, nominal_wall_mm * 0.30)  # thinnest practical rib
        rib_max = nominal_wall_mm * 0.85            # max before it's just a thick wall

        rib_pairs = 0
        rib_separations: List[float] = []
        rib_data: List[Dict[str, Any]] = []  # per-rib centroid + dims for heatmap placement
        n_faces = len(wall_face_planes)

        for i in range(n_faces):
            nx1, ny1, nz1, off1, _area1, cx1, cy1, cz1 = (*wall_face_planes[i], *([0.0]*3))[:8]
            for j in range(i + 1, n_faces):
                nx2, ny2, nz2, off2, _area2, cx2, cy2, cz2 = (*wall_face_planes[j], *([0.0]*3))[:8]

                # Must be antiparallel (facing each other)
                dot_nn = nx1 * nx2 + ny1 * ny2 + nz1 * nz2
                if dot_nn > -ANTIPARALLEL_THRESHOLD:
                    continue  # same-direction normals or oblique → not a rib pair

                # Plane separation = |offset1 + offset2| (see docstring for derivation)
                sep = abs(off1 + off2)
                if not (rib_min <= sep <= rib_max):
                    continue

                rib_pairs += 1
                rib_separations.append(round(sep, 2))

                # Rib centroid = midpoint between the two face centroids.
                # height estimate: area ≈ height × sep, so height ≈ sqrt(max_area)
                height_est = round(math.sqrt(max(_area1, _area2, 1.0)), 2)
                rib_data.append({
                    "centroid": [
                        round((cx1 + cx2) / 2, 2),
                        round((cy1 + cy2) / 2, 2),
                        round((cz1 + cz2) / 2, 2),
                    ],
                    "thickness_mm": round(sep, 2),
                    "height_mm": height_est,
                })

        # Bin into 0.5 mm groups for DFM reporting
        binned: Dict[float, int] = {}
        for s in rib_separations:
            bin_key = round(round(s / 0.5) * 0.5, 1)
            binned[bin_key] = binned.get(bin_key, 0) + 1

        rib_groups = sorted(
            [{"thickness_mm": k, "count": v} for k, v in binned.items()],
            key=lambda x: x["thickness_mm"],
        )
        confidence = 0.55 if rib_pairs > 0 else 0.35

        return {
            "rib_count": rib_pairs,
            "rib_groups": rib_groups,
            "rib_confidence": confidence,
            "rib_data": rib_data,
        }

    # ── Phase 2: blind feature detection ─────────────────────────────────────

    def _detect_blind_features(
        self,
        shape: Any,
        bbox_dims: List[float],
    ) -> Dict[str, Any]:
        """
        Split functional cylindrical features (radius > FILLET_MAX_RADIUS_MM, axis ≈ pull)
        into through-holes and blind features (bosses or blind holes) by checking
        whether a cylinder's rim edge has an adjacent planar cap face.

        Algorithm:
          For each qualifying cylinder:
            Walk its edges. For each edge, query the edge→face adjacency map.
            If any adjacent planar face has a normal roughly parallel to the cylinder
            axis (|dot(face_normal, cyl_axis)| > 0.70) AND area ≤ 3× cylinder
            cross-section → this cylinder is capped = blind feature.
          If no cap found → through-hole.

        Phase 2 limitation: boss vs blind-hole discrimination is deferred — both are
        counted together as blind_feature_count. Use for routing is limited (insert
        installation is triggered by user-confirmed insert_count, not boss count).
        blind_feature_count is a DFM signal only in Phase 2.

        Confidence: 0.60 — the cap-area heuristic can misfire on shells where a thin
        rib floor face lies adjacent to a boss cylinder edge. Tune against real parts.
        """
        _FALLBACK = {"through_hole_count": 0, "blind_feature_count": 0, "confidence": 0.0}
        try:
            from OCC.Core.TopExp import TopExp_Explorer, topexp  # type: ignore
            from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_EDGE  # type: ignore
            from OCC.Core.TopTools import (  # type: ignore
                TopTools_IndexedDataMapOfShapeListOfShape,
                TopTools_ListIteratorOfListOfShape,
            )
            from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
            from OCC.Core.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder  # type: ignore
            from OCC.Core.TopoDS import topods  # type: ignore
            from OCC.Core.BRepGProp import brepgprop  # type: ignore
            from OCC.Core.GProp import GProp_GProps  # type: ignore
        except ImportError:
            return _FALLBACK

        # Use the same dominant-face pull axis as _analyze_draft_angles.
        _bfd_area = [0.0, 0.0, 0.0]
        try:
            _bfd_pre = TopExp_Explorer(shape, TopAbs_FACE)
            while _bfd_pre.More():
                _bfd_f = topods.Face(_bfd_pre.Current())
                _bfd_adp = BRepAdaptor_Surface(_bfd_f)
                if _bfd_adp.GetType() == GeomAbs_Plane:
                    _bfd_n = _bfd_adp.Plane().Axis().Direction()
                    _bfd_c = [abs(float(_bfd_n.X())), abs(float(_bfd_n.Y())), abs(float(_bfd_n.Z()))]
                    _bfd_d = max(range(3), key=lambda ii: _bfd_c[ii])
                    if _bfd_c[_bfd_d] >= 0.70:
                        _bfd_gpr = GProp_GProps()
                        brepgprop.SurfaceProperties(_bfd_f, _bfd_gpr)
                        _bfd_area[_bfd_d] += _bfd_gpr.Mass()
                _bfd_pre.Next()
        except Exception:
            pass
        if max(_bfd_area) >= 1.0:
            pull_axis_idx = int(max(range(3), key=lambda ii: _bfd_area[ii]))
        else:
            pull_axis_idx = min(range(len(bbox_dims)), key=lambda i: bbox_dims[i])

        # Edge → adjacent face map for the whole shape (one build, reused per cylinder)
        try:
            edge_face_map = TopTools_IndexedDataMapOfShapeListOfShape()
            topexp.MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edge_face_map)  # type: ignore
        except Exception as e:
            logger.warning(f"[InjectionMolded] blind detection edge map failed: {e}")
            return _FALLBACK

        MAX_HASH = 2 ** 31 - 1
        through_count = 0
        blind_count = 0
        blind_diameters_mm: List[float] = []  # Phase 3: diameters for insert matching
        blind_feature_data: List[Dict[str, Any]] = []  # per-boss centroid + dims for heatmap

        explorer = TopExp_Explorer(shape, TopAbs_FACE)
        while explorer.More():
            try:
                face = topods.Face(explorer.Current())
                adaptor = BRepAdaptor_Surface(face)
                if adaptor.GetType() != GeomAbs_Cylinder:
                    explorer.Next()
                    continue

                cyl = adaptor.Cylinder()
                radius = cyl.Radius()
                if radius <= self.FILLET_MAX_RADIUS_MM or radius > 50.0:
                    explorer.Next()
                    continue

                cyl_dir = cyl.Axis().Direction()
                ax = [float(cyl_dir.X()), float(cyl_dir.Y()), float(cyl_dir.Z())]
                ax_pull = abs(ax[pull_axis_idx])
                if ax_pull < 0.5:
                    explorer.Next()
                    continue

                cyl_cross_area = math.pi * radius * radius
                has_cap = False
                seen: set = set()

                edge_exp = TopExp_Explorer(face, TopAbs_EDGE)
                while edge_exp.More() and not has_cap:
                    edge = topods.Edge(edge_exp.Current())
                    idx = edge_face_map.FindIndex(edge)
                    if idx > 0:
                        it = TopTools_ListIteratorOfListOfShape(
                            edge_face_map.FindFromIndex(idx)
                        )
                        while it.More() and not has_cap:
                            adj = topods.Face(it.Value())
                            fh = adj.HashCode(MAX_HASH)
                            if fh not in seen and not adj.IsSame(face):
                                seen.add(fh)
                                try:
                                    adj_adp = BRepAdaptor_Surface(adj)
                                    if adj_adp.GetType() == GeomAbs_Plane:
                                        pn = adj_adp.Plane().Axis().Direction()
                                        dot = abs(
                                            float(pn.X()) * ax[0]
                                            + float(pn.Y()) * ax[1]
                                            + float(pn.Z()) * ax[2]
                                        )
                                        if dot > 0.70:
                                            props = GProp_GProps()
                                            brepgprop.SurfaceProperties(adj, props)
                                            if props.Mass() <= cyl_cross_area * 3.0:
                                                has_cap = True
                                except Exception:
                                    pass
                            it.Next()
                    edge_exp.Next()

                if has_cap:
                    blind_count += 1
                    blind_diameters_mm.append(round(radius * 2.0, 2))
                    # Collect cylinder face centroid + dimensions for heatmap source placement.
                    # height estimate: area ≈ 2π×r×h → h = area / (2π×r)
                    try:
                        cyl_props = GProp_GProps()
                        brepgprop.SurfaceProperties(face, cyl_props)
                        cyl_cog = cyl_props.CentreOfMass()
                        cyl_area = cyl_props.Mass()
                        h_est = cyl_area / (2 * math.pi * radius) if radius > 0 else 0
                        slend = round(h_est / (radius * 2.0), 3) if radius > 0 else 0
                        blind_feature_data.append({
                            "centroid": [
                                round(float(cyl_cog.X()), 2),
                                round(float(cyl_cog.Y()), 2),
                                round(float(cyl_cog.Z()), 2),
                            ],
                            "diameter_mm": round(radius * 2.0, 2),
                            "height_mm": round(h_est, 2),
                            "slenderness": slend,
                        })
                    except Exception:
                        pass
                else:
                    through_count += 1
            except Exception:
                pass
            explorer.Next()

        return {
            "through_hole_count": through_count,
            "blind_feature_count": blind_count,
            "blind_feature_diameters_mm": sorted(blind_diameters_mm),
            "blind_feature_data": blind_feature_data,
            "confidence": 0.60,
        }

    # ── Phase 3: insert candidate detection ──────────────────────────────────

    # Standard heat-stake / ultrasonic / press-fit threaded insert OD bands (mm
    # diameter of the host blind hole). Sources: Spirol CL400/CL410, Penn
    # Engineering PEM, B-Tite, E-Z LOK BSO/SO series — all published catalogs.
    # Each entry: (min_hole_dia_mm, max_hole_dia_mm, thread_spec_label)
    _THREADED_INSERT_OD_BANDS: List[Tuple[float, float, str]] = [
        (3.0,  4.3,  "M2"),
        (4.4,  5.7,  "M3"),
        (5.8,  7.1,  "M4"),
        (7.2,  8.6,  "M5"),
        (8.7, 10.1,  "M6"),
        (10.2, 13.0, "M8"),
    ]

    def _detect_insert_candidates(
        self,
        blind_feature_diameters_mm: List[float],
    ) -> Dict[str, Any]:
        """
        From the blind-feature diameter list produced by _detect_blind_features,
        identify candidates whose hole diameter matches a standard threaded insert
        OD band (Spirol / Penn Engineering / B-Tite series).

        insert_candidate_count: total blind holes matching any insert OD band.
        insert_candidates: [{spec, count}] breakdown by thread size.

        Confidence: 0.55 — a blind hole at an insert OD could also be a locating
        peg, snap-fit boss attachment, or stud boss. Drawing thread callouts (Phase 4
        drawing analysis) will confirm which blind holes are genuine inserts. The
        routing engine routes insert_installation conservatively on this count — the
        cost of over-routing one insert station (~$0.05/part) is less than the cost
        of under-quoting genuine inserts.
        """
        per_spec: Dict[str, int] = {}
        for d in blind_feature_diameters_mm:
            for lo, hi, spec in self._THREADED_INSERT_OD_BANDS:
                if lo <= d <= hi:
                    per_spec[spec] = per_spec.get(spec, 0) + 1
                    break

        total = sum(per_spec.values())
        return {
            "insert_candidate_count": total,
            "insert_candidates": [
                {"spec": k, "count": v} for k, v in sorted(per_spec.items())
            ],
            "insert_confidence": 0.55,
        }

    # ── feature_graph_v2 for injection molded parts ───────────────────────────

    def _build_im_feature_graph(
        self,
        dfm_groups: Dict[str, Any],
        face_map: List[Dict],
        face_map_tri_total: int,
        insert_candidates: List[Dict],
    ) -> Optional[Dict[str, Any]]:
        """
        Build feature_graph_v2 for injection molded DFM groups so the 3D viewer
        can highlight undercut and undrafted faces by category.

        Structure mirrors SheetMetalFeatureExtractor's feature_graph_v2:
          metadata.face_map    — face_id → {tri_start, tri_count} for STL highlighting
          features             — list of FeatureNodeV2-compatible dicts per DFM category

        Color semantics (resolved by frontend):
          undercut  → severity 'high'   (ejection blocker, must have slide/lifter)
          undrafted → severity 'medium' (draft DFM warning, may stick on ejection)
        """
        try:
            features = []

            if dfm_groups:
                undercut_faces = dfm_groups.get("undercut", [])
                if undercut_faces:
                    features.append({
                        "id": "im_undercuts",
                        "feature_type": "im_undercut",
                        "severity": "high",
                        "label": "Undercuts",
                        "description": f"{len(undercut_faces)} face(s) with back-angle >5° — require slide or lifter",
                        "occurrences": [
                            {
                                "face_ids": [f["face_id"]],
                                "centroid": f["centroid"],
                                "back_angle_deg": f.get("back_angle_deg"),
                            }
                            for f in undercut_faces
                        ],
                    })

                undrafted_faces = dfm_groups.get("undrafted", [])
                if undrafted_faces:
                    features.append({
                        "id": "im_undrafted",
                        "feature_type": "im_undrafted",
                        "severity": "medium",
                        "label": "Undrafted Faces",
                        "description": f"{len(undrafted_faces)} face(s) with <0.3° draft — ejection risk",
                        "occurrences": [
                            {
                                "face_ids": [f["face_id"]],
                                "centroid": f["centroid"],
                                "angle_deg": f.get("angle_deg"),
                            }
                            for f in undrafted_faces
                        ],
                    })

            # Always return metadata for IM — enables frontend heatmap even when
            # no undercuts or undrafted faces exist (simple uniform parts still
            # benefit from boss/rib/wall-variation heatmaps).
            return {
                "metadata": {
                    "face_map": face_map,
                    "stl_tri_total": face_map_tri_total or None,
                },
                "features": features,
            }
        except Exception as e:
            logger.warning(f"[InjectionMolded] feature_graph_v2 build failed: {e}")
            return None

    # ── Heatmap feature extraction ────────────────────────────────────────────

    def _collect_wall_samples(
        self,
        wall_face_planes: List[Tuple],
        nominal_mm: float,
    ) -> List[Dict[str, Any]]:
        """
        Extract per-location wall thickness samples from antiparallel face pairs
        at wall-thickness separation using the enriched 8-tuple wall_face_planes
        (already collected in _analyze_draft_angles).

        Uses adaptive area-based sampling: 1 sample per 1000 mm² of wall area,
        bounded [5, 300]. When more pairs are found than the target, a spatial
        voxel grid in the XY plane keeps the highest-deviation sample per cell.
        This gives coverage proportional to part size rather than a hard cap.
        """
        if not wall_face_planes or nominal_mm <= 0:
            return []

        wall_min = nominal_mm * 0.40
        wall_max = nominal_mm * 1.80
        ANTIPARALLEL_THRESHOLD = 0.95

        samples: List[Dict[str, Any]] = []
        total_area_mm2 = 0.0
        n = len(wall_face_planes)

        for i in range(n):
            p1 = (*wall_face_planes[i], *([0.0] * 3))[:8]
            nx1, ny1, nz1, off1, area1, cx1, cy1, cz1 = p1
            for j in range(i + 1, n):
                p2 = (*wall_face_planes[j], *([0.0] * 3))[:8]
                nx2, ny2, nz2, off2, area2, cx2, cy2, cz2 = p2

                dot_nn = nx1 * nx2 + ny1 * ny2 + nz1 * nz2
                if dot_nn > -ANTIPARALLEL_THRESHOLD:
                    continue

                sep = abs(off1 + off2)
                if not (wall_min <= sep <= wall_max):
                    continue

                pair_area = min(area1, area2) if area1 > 0 and area2 > 0 else 0.0
                total_area_mm2 += pair_area
                delta = round(abs(sep - nominal_mm) / nominal_mm, 3)
                samples.append({
                    "centroid": [
                        round((cx1 + cx2) / 2, 2),
                        round((cy1 + cy2) / 2, 2),
                        round((cz1 + cz2) / 2, 2),
                    ],
                    "thickness_mm": round(sep, 2),
                    "delta_from_nominal": delta,
                })

        if not samples:
            return []

        # Adaptive target: 1 sample per 1000 mm² of wall surface area, bounded [5, 300]
        target = max(5, min(300, int(total_area_mm2 / 1000) if total_area_mm2 > 0 else len(samples)))

        if len(samples) <= target:
            return samples

        # Spatial voxel-grid subsampling: keep highest-deviation sample per cell.
        # Grid sized to approximate the target count, proportional to XY extents.
        cx_vals = [s["centroid"][0] for s in samples]
        cy_vals = [s["centroid"][1] for s in samples]
        x_min, x_max = min(cx_vals), max(cx_vals)
        y_min, y_max = min(cy_vals), max(cy_vals)
        span_x = max(x_max - x_min, 1.0)
        span_y = max(y_max - y_min, 1.0)

        cells_side = max(1, int(math.sqrt(target)))
        cells_x = max(1, round(cells_side * span_x / max(span_x, span_y)))
        cells_y = max(1, round(cells_side * span_y / max(span_x, span_y)))

        grid: Dict[Tuple[int, int], Dict[str, Any]] = {}
        for s in samples:
            ix = min(int((s["centroid"][0] - x_min) / span_x * cells_x), cells_x - 1)
            iy = min(int((s["centroid"][1] - y_min) / span_y * cells_y), cells_y - 1)
            key = (ix, iy)
            existing = grid.get(key)
            # Prefer the highest-deviation sample in each cell: it dominates heatmap amplitude
            if existing is None or s["delta_from_nominal"] > existing["delta_from_nominal"]:
                grid[key] = s

        return list(grid.values())

    def _build_heatmap_features(
        self,
        all_draft_faces: List[Dict[str, Any]],
        blind_feature_data: List[Dict[str, Any]],
        rib_data: List[Dict[str, Any]],
        wall_samples: List[Dict[str, Any]],
        nominal_wall_mm: float,
    ) -> Dict[str, Any]:
        """
        Assemble per-feature spatial data for the frontend IM heatmap engine.
        All centroids are in OCC global coordinates (same frame as STL export).

        bosses:       blind cylindrical features (bosses + blind holes lumped)
        ribs:         antiparallel wall-face pairs at rib-thickness separation
        wall_samples: antiparallel face pairs at wall-thickness separation (up to 30)
        draft_faces:  all classified wall faces (undrafted/drafted/overdrafted/undercut)
        """
        return {
            "bosses": [
                {
                    "centroid": f["centroid"],
                    "diameter_mm": f["diameter_mm"],
                    "height_mm": f["height_mm"],
                    "wall_mm": round(nominal_wall_mm, 2),
                    "slenderness": f["slenderness"],
                }
                for f in blind_feature_data
            ],
            "ribs": rib_data,
            "wall_samples": wall_samples,
            "draft_faces": all_draft_faces,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Component Feature Analyzer — aPriori-style decomposition
# ─────────────────────────────────────────────────────────────────────────────


class ComponentFeatureAnalyzer:
    """
    aPriori-style geometry decomposition for any detected part family.

    Produces:
      blank            — largest planar face (sheet metal blank / datum face)
      main_surfaces    — top-5 planar faces by area
      setup_axes       — 6 orthogonal accessibility candidates (±X, ±Y, ±Z)
      sides            — inside / outside classification of feature instances
      gcd_relations    — spatial relations between feature instances

    Uses only OCC APIs already imported elsewhere in this module.
    All coordinates are Three.js-centered (origin at bbox centroid).
    """

    _ORTHO_DIRS: List[Tuple[str, Tuple[float, float, float]]] = [
        ("+Z", (0.0, 0.0, 1.0)),
        ("-Z", (0.0, 0.0, -1.0)),
        ("+Y", (0.0, 1.0, 0.0)),
        ("-Y", (0.0, -1.0, 0.0)),
        ("+X", (1.0, 0.0, 0.0)),
        ("-X", (-1.0, 0.0, 0.0)),
    ]

    @staticmethod
    def _normalize_mfg_features(mfg_features: Dict[str, Any]) -> Dict[str, Any]:
        """Flatten AdvancedCADMemoryOptimizer's nested layout for sub-method access.

        The optimizer stores all family-specific features under:
          manufacturing_features["manufacturing_intelligence"]["features"]

        Every ComponentFeatureAnalyzer sub-method expects feature_graph_v2 and flat
        metrics (cut_length_mm, pierce_count, flat_pattern_area_mm2, …) at the TOP
        LEVEL of the dict it receives.

        This method produces a shallow-merged copy so all sub-methods work without
        knowing about the nesting.  The caller's dict is never mutated.
        """
        # Already flat (test path or future layout change) — return as-is
        if mfg_features.get("feature_graph_v2"):
            return mfg_features

        mi = mfg_features.get("manufacturing_intelligence")
        mi_feats = mi.get("features") if isinstance(mi, dict) else None
        if not isinstance(mi_feats, dict):
            return mfg_features

        # Shallow-merge mi_feats into a copy; top-level keys take priority so we
        # never clobber 'holes', 'pockets', 'thin_walls', etc.
        normalized = {**mi_feats, **mfg_features}
        return normalized

    def analyze(
        self,
        shape: Any,
        mfg_features: Dict[str, Any],
        bbox_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Return the full ComponentFeatureAnalysis dict."""
        # Normalise once here — all sub-methods receive a flat dict
        mfg = self._normalize_mfg_features(mfg_features)
        face_data = self._collect_planar_faces(shape, bbox_data)
        blank = self._extract_blank(face_data, mfg)
        main_surfaces = self._extract_main_surfaces(face_data, blank)
        setup_axes = self._compute_setup_axes(face_data, mfg, bbox_data)
        sides = self._classify_sides(mfg, blank)
        gcd_relations = self._compute_gcd_relations(shape, mfg, blank, setup_axes)
        return {
            "blank": blank,
            "main_surfaces": main_surfaces,
            "setup_axes_candidates": setup_axes,
            "sides": sides,
            "gcd_relations": gcd_relations,
        }

    # ── Face collection ────────────────────────────────────────────────────

    def _collect_planar_faces(
        self,
        shape: Any,
        bbox_data: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
        from OCC.Core.TopAbs import TopAbs_FACE      # type: ignore
        from OCC.Core.TopoDS import topods           # type: ignore
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
        from OCC.Core.GeomAbs import GeomAbs_Plane   # type: ignore
        from OCC.Core.BRepGProp import brepgprop     # type: ignore
        from OCC.Core.GProp import GProp_GProps      # type: ignore

        bcx = (bbox_data.get("xmin", 0.0) + bbox_data.get("xmax", 0.0)) / 2
        bcy = (bbox_data.get("ymin", 0.0) + bbox_data.get("ymax", 0.0)) / 2
        bcz = (bbox_data.get("zmin", 0.0) + bbox_data.get("zmax", 0.0)) / 2

        faces: List[Dict[str, Any]] = []
        exp = TopExp_Explorer(shape, TopAbs_FACE)
        idx = 0
        while exp.More():
            face = topods.Face(exp.Current())
            try:
                surf = BRepAdaptor_Surface(face, True)
                if surf.GetType() == GeomAbs_Plane:
                    props = GProp_GProps()
                    brepgprop.SurfaceProperties(face, props)
                    area = props.Mass()
                    if area >= 1.0:
                        pln = surf.Plane()
                        nx, ny, nz = pln.Axis().Direction().XYZ().Coord()
                        cx, cy, cz = props.CentreOfMass().Coord()
                        faces.append({
                            "face_id": idx,
                            "area_mm2": round(area, 1),
                            "normal": {"x": round(nx, 4), "y": round(ny, 4), "z": round(nz, 4)},
                            "centroid": {
                                "x": round(cx - bcx, 2),
                                "y": round(cy - bcy, 2),
                                "z": round(cz - bcz, 2),
                            },
                        })
            except Exception:
                pass
            exp.Next()
            idx += 1

        return sorted(faces, key=lambda f: f["area_mm2"], reverse=True)

    # ── Blank ──────────────────────────────────────────────────────────────

    def _extract_blank(
        self,
        face_data: List[Dict[str, Any]],
        mfg_features: Dict[str, Any],
    ) -> Dict[str, Any]:
        if not face_data:
            return {
                "id": "blank_1", "face_id": 0, "volume_mm3": 0.0,
                "area_mm2": 0.0, "edge_count": 0, "edge_segments": [],
                "centroid": {"x": 0.0, "y": 0.0, "z": 0.0},
            }
        bf = face_data[0]
        volume = mfg_features.get("volume_mm3") or 0.0
        cut_length = mfg_features.get("cut_length_mm") or 0.0
        pierce_count = mfg_features.get("pierce_count") or 4
        seg_len = round(cut_length / max(pierce_count, 1), 1)
        return {
            "id": "blank_1",
            "face_id": bf["face_id"],
            "volume_mm3": round(float(volume), 2),
            "area_mm2": bf["area_mm2"],
            "edge_count": pierce_count,
            "edge_segments": [
                {"id": f"edge_{i}", "length_mm": seg_len}
                for i in range(min(pierce_count, 20))
            ],
            "centroid": bf["centroid"],
        }

    # ── Main surfaces ──────────────────────────────────────────────────────

    def _extract_main_surfaces(
        self,
        face_data: List[Dict[str, Any]],
        blank: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        return [
            {
                "id": f"surface_{i + 1}",
                "face_id": f["face_id"],
                "area_mm2": f["area_mm2"],
                "normal": f["normal"],
                "is_primary": f["face_id"] == blank["face_id"],
            }
            for i, f in enumerate(face_data[:5])
        ]

    # ── Setup axis candidates ──────────────────────────────────────────────

    def _compute_setup_axes(
        self,
        face_data: List[Dict[str, Any]],
        mfg_features: Dict[str, Any],
        bbox_data: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        total_area = sum(f["area_mm2"] for f in face_data) or 1.0
        xmin, xmax = bbox_data.get("xmin", 0.0), bbox_data.get("xmax", 0.0)
        ymin, ymax = bbox_data.get("ymin", 0.0), bbox_data.get("ymax", 0.0)
        zmin, zmax = bbox_data.get("zmin", 0.0), bbox_data.get("zmax", 0.0)
        feature_centroids = self._get_feature_centroids(mfg_features)

        candidates = []
        slide_idx = 1
        for label, (dx, dy, dz) in self._ORTHO_DIRS:
            try:
                result = self._evaluate_direction(
                    label, (dx, dy, dz), face_data, total_area,
                    xmin, xmax, ymin, ymax, zmin, zmax,
                    feature_centroids, slide_idx,
                )
                if result["accessible_surface_area_mm2"] > 0:
                    candidates.append(result)
                    slide_idx += 1
            except Exception as e:
                logger.debug(f"[ComponentFeatures] setup axis {label} skipped: {e}")
        return candidates

    def _get_feature_centroids(
        self, mfg_features: Dict[str, Any]
    ) -> List[Tuple[float, float, float]]:
        pts: List[Tuple[float, float, float]] = []
        fg2 = mfg_features.get("feature_graph_v2") or {}
        features = fg2.get("features") if isinstance(fg2, dict) else []
        if not features:
            return pts
        for feat in features:
            for occ in (feat.get("occurrences") or []):
                c = occ.get("centroid")
                if c and len(c) == 3:
                    pts.append((float(c[0]), float(c[1]), float(c[2])))
        return pts

    def _evaluate_direction(
        self,
        label: str,
        direction: Tuple[float, float, float],
        face_data: List[Dict[str, Any]],
        total_area: float,
        xmin: float, xmax: float,
        ymin: float, ymax: float,
        zmin: float, zmax: float,
        feature_centroids: List[Tuple[float, float, float]],
        slide_idx: int,
    ) -> Dict[str, Any]:
        dx, dy, dz = direction

        accessible: List[Dict[str, Any]] = []
        has_undercut = False
        for f in face_data:
            n = f["normal"]
            dot = n["x"] * dx + n["y"] * dy + n["z"] * dz
            if dot > 0.7:
                accessible.append(f)
            elif dot < -0.9:
                has_undercut = True

        acc_area = sum(f["area_mm2"] for f in accessible)
        shadow_depth = (
            abs(dx) * (xmax - xmin)
            + abs(dy) * (ymax - ymin)
            + abs(dz) * (zmax - zmin)
        )
        shadow_area = self._shadow_area(dx, dy, dz, xmin, xmax, ymin, ymax, zmin, zmax)
        rect = self._parting_rect(dx, dy, dz, xmin, xmax, ymin, ymax, zmin, zmax)

        perp = self._perp_extents(dx, dy, dz, xmin, xmax, ymin, ymax, zmin, zmax)
        clearance = round(min(perp) / 2, 2) if perp else None

        if accessible:
            dots = [
                abs(f["normal"]["x"] * dx + f["normal"]["y"] * dy + f["normal"]["z"] * dz)
                for f in accessible
            ]
            mean_dot = sum(dots) / len(dots)
            draft_angle = round(math.degrees(math.acos(min(mean_dot, 1.0))), 1)
        else:
            draft_angle = 90.0

        tool_reach = 0.0
        for (cx, cy, cz) in feature_centroids:
            depth = abs(cx * dx + cy * dy + cz * dz)
            tool_reach = max(tool_reach, depth)
        tool_reach = round(min(tool_reach, shadow_depth), 2)

        is_feasible = (not has_undercut) and acc_area > 0

        return {
            "id": f"slide_{slide_idx}",
            "direction_label": label,
            "direction_type": "ORTHOGONAL",
            "direction_vector": {"x": dx, "y": dy, "z": dz},
            "tool_reach_mm": tool_reach,
            "length_mm": round(shadow_depth, 2),
            "max_rules_deg": round(draft_angle, 1),
            "wall_corner_diameter_mm": None,
            "unobstructed_wall_corner_diameter_mm": None,
            "distance_to_obstruction_mm": None,
            "distance_to_tool_interference_mm": None,
            "is_feasible": is_feasible,
            "is_feasible_for_fillet": is_feasible,
            "has_parallel_tangent_edges": len(accessible) > 1,
            "distance_to_solid_shadow_border_mm": None,
            "parting_projection_start_mm": rect["start"],
            "parting_projection_end_mm": rect["end"],
            "rectangle_lower_left": rect["ll"],
            "rectangle_upper_right": rect["ur"],
            "clearance_distance_mm": clearance,
            "accessible_surface_area_mm2": round(acc_area, 1),
            "has_blocked_volume": has_undercut or acc_area < total_area * 0.1,
            "oriented_box_center": {
                "x": round((xmin + xmax) / 2, 2),
                "y": round((ymin + ymax) / 2, 2),
                "z": round((zmin + zmax) / 2, 2),
            },
            "largest_window_area_mm2": None,
            "largest_shadow_area_mm2": round(shadow_area, 1),
            "shadow_depth_mm": round(shadow_depth, 2),
            "draft_angle_deg": draft_angle,
            "group_id": label,
        }

    def _shadow_area(
        self, dx: float, dy: float, dz: float,
        xmin: float, xmax: float, ymin: float, ymax: float, zmin: float, zmax: float,
    ) -> float:
        extents = self._perp_extents(dx, dy, dz, xmin, xmax, ymin, ymax, zmin, zmax)
        return extents[0] * extents[1] if len(extents) >= 2 else 0.0

    def _perp_extents(
        self, dx: float, dy: float, dz: float,
        xmin: float, xmax: float, ymin: float, ymax: float, zmin: float, zmax: float,
    ) -> List[float]:
        extents: List[float] = []
        if abs(dx) < 0.5:
            extents.append(xmax - xmin)
        if abs(dy) < 0.5:
            extents.append(ymax - ymin)
        if abs(dz) < 0.5:
            extents.append(zmax - zmin)
        return extents

    def _parting_rect(
        self, dx: float, dy: float, dz: float,
        xmin: float, xmax: float, ymin: float, ymax: float, zmin: float, zmax: float,
    ) -> Dict[str, Any]:
        extents: List[Tuple[float, float]] = []
        if abs(dx) < 0.5:
            extents.append((xmin, xmax))
        if abs(dy) < 0.5:
            extents.append((ymin, ymax))
        if abs(dz) < 0.5:
            extents.append((zmin, zmax))
        if len(extents) >= 2:
            a_min, a_max = extents[0]
            b_min, b_max = extents[1]
            ca, cb = (a_min + a_max) / 2, (b_min + b_max) / 2
            ll = {"x": round(a_min - ca, 2), "y": round(b_min - cb, 2)}
            ur = {"x": round(a_max - ca, 2), "y": round(b_max - cb, 2)}
            return {"start": ll, "end": ur, "ll": ll, "ur": ur}
        return {"start": None, "end": None, "ll": None, "ur": None}

    # ── Sides ──────────────────────────────────────────────────────────────

    def _classify_sides(
        self,
        mfg_features: Dict[str, Any],
        blank: Dict[str, Any],
    ) -> Dict[str, Any]:
        blank_z = blank["centroid"]["z"]
        inside: List[Dict[str, Any]] = []
        outside: List[Dict[str, Any]] = []

        fg2 = mfg_features.get("feature_graph_v2") or {}
        features = fg2.get("features") if isinstance(fg2, dict) else []
        if not features:
            return {"inside": [], "outside": []}

        for feat in features:
            feat_id = feat.get("id", "")
            for occ in (feat.get("occurrences") or []):
                c = occ.get("centroid", [0, 0, 0])
                oz = float(c[2]) if len(c) > 2 else 0.0
                face_ids = occ.get("face_ids", [])
                entry = {"feature_id": feat_id, "face_ids": face_ids}
                if oz < blank_z:
                    inside.append(entry)
                else:
                    outside.append(entry)
        return {"inside": inside, "outside": outside}

    # ── GCD relations ──────────────────────────────────────────────────────

    def _compute_gcd_relations(
        self,
        shape: Any,
        mfg_features: Dict[str, Any],
        blank: Dict[str, Any],
        setup_axes: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Compute all 9 aPriori GCD relation types between feature instances.

        Relation taxonomy (matches aPriori Geometric Cost Drivers panel):
          adjacent         — faces share a boundary edge (OCC topology)
          ends_on          — bend fold-line terminates on blank boundary edge
          intersects       — sphere volumes overlap, or blank contains a non-bend feature
          is_accessible_from — feature reachable from a setup axis direction
          is_orthogonal    — feature normals perpendicular (dot ≈ 0, within 5° of 90°)
          lies_near        — within 2× effective radius without volume overlap
          lies_on          — feature centroid lies within another feature's face bounds
          lies_outside     — distant with no normal alignment
          parallel         — feature normals co-directional (abs(dot) > 0.95)

        All coordinates are Three.js-centred (bbox centroid = origin).
        face_id values match the TopExp_Explorer(shape, TopAbs_FACE) walk order used
        by both _collect_planar_faces and memory_optimizer._detect_holes_real.
        """
        fg2 = mfg_features.get("feature_graph_v2") or {}
        features = fg2.get("features") if isinstance(fg2, dict) else []
        if not features:
            return []

        # ── Build feature instance list ────────────────────────────────────
        instances: List[Dict[str, Any]] = []
        for feat in features:
            ftype = feat.get("feature_type", "")
            diam = feat.get("diameter_mm")
            radius = (float(diam) / 2.0) if diam else (feat.get("radius_mm") or 5.0)
            raw_n = feat.get("normal")
            # Normalise the stored normal vector (list/tuple [x, y, z])
            normal: Optional[Tuple[float, float, float]] = None
            if isinstance(raw_n, (list, tuple)) and len(raw_n) >= 3:
                nx, ny, nz = float(raw_n[0]), float(raw_n[1]), float(raw_n[2])
                mag = math.sqrt(nx * nx + ny * ny + nz * nz)
                if mag > 1e-9:
                    normal = (nx / mag, ny / mag, nz / mag)
            for i, occ in enumerate(feat.get("occurrences") or []):
                c = occ.get("centroid", [0, 0, 0])
                instances.append({
                    "id": self._feature_label(ftype, diam, i),
                    "ftype": ftype,
                    "cx": float(c[0]) if len(c) > 0 else 0.0,
                    "cy": float(c[1]) if len(c) > 1 else 0.0,
                    "cz": float(c[2]) if len(c) > 2 else 0.0,
                    "radius": float(radius),
                    "normal": normal,
                    "face_ids": list(occ.get("face_ids") or []),
                })

        if not instances:
            return []

        # ── face_id → feature_id lookup ────────────────────────────────────
        face_to_feature: Dict[int, str] = {}
        feature_to_faces: Dict[str, List[int]] = {}
        for inst in instances:
            for fid in inst["face_ids"]:
                face_to_feature[fid] = inst["id"]
                feature_to_faces.setdefault(inst["id"], []).append(fid)

        blank_face_id: Optional[int] = blank.get("face_id")

        # Diagnostic log — remove once adjacent relations are confirmed working
        all_face_ids_in_instances = [fid for inst in instances for fid in inst["face_ids"]]
        logger.info(
            f"[GCD-adj] blank_face_id={blank_face_id} "
            f"instances={len(instances)} "
            f"face_to_feature keys={sorted(face_to_feature.keys())[:20]} "
            f"all_face_ids={sorted(set(all_face_ids_in_instances))[:30]}"
        )

        # ── OCC face adjacency ─────────────────────────────────────────────
        # Global edge-midpoint matching across ALL faces.
        # Two faces sharing a geometrically coincident edge midpoint (within
        # _EDGE_TOL) are adjacent — this is immune to pythonocc 7.7.x
        # identity-comparison bugs (FindIndex/IsPartner/IsSame all fail for
        # faces from different traversal paths in disconnected STEP compounds).
        #
        # Produces raw_adjacent_pairs (face-level, aPriori-style labelling)
        # for GCD emission, plus blank_adjacent_features / feature_adjacent_pairs
        # for the downstream ends_on / intersects / lies_near derivations.
        blank_adjacent_features: set = set()
        feature_adjacent_pairs: set = set()
        raw_adjacent_pairs: List[Dict[str, Any]] = []

        try:
            from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
            from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_EDGE  # type: ignore
            from OCC.Core.TopTools import TopTools_IndexedMapOfShape  # type: ignore
            from OCC.Core.BRepAdaptor import BRepAdaptor_Surface, BRepAdaptor_Curve  # type: ignore
            from OCC.Core.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder  # type: ignore

            # Build face ordinal map — same walk order as memory_optimizer
            face_ordinal_map = TopTools_IndexedMapOfShape()
            _exp = TopExp_Explorer(shape, TopAbs_FACE)
            while _exp.More():
                face_ordinal_map.Add(_exp.Current())
                _exp.Next()

            total_faces = face_ordinal_map.Size()
            logger.info(f"[GCD-adj] OCC face walk: {total_faces} total faces, "
                        f"blank_face_id={blank_face_id} "
                        f"(valid: {blank_face_id is not None and blank_face_id < total_faces})")

            # aPriori merges co-planar OCC faces into a single "planarFace" entity before
            # computing adjacency — so a blank plate represented as 8 separate OCC faces
            # becomes 1 entity, and edges between those 8 faces disappear (same entity,
            # not adjacent to itself).  Cylinders stay as individual entities.
            # Entity label: "planarFace:N" (shared across co-planar faces) or "curvedWall:N".
            _plane_entity_counter: List[int] = [0]
            _plane_key_to_entity: Dict[tuple, str] = {}
            _face_entity_cache: Dict[int, str] = {}
            # Representative face ordinal for each entity (for face_ids in output)
            _entity_repr_face: Dict[str, int] = {}
            # Canonical (nx, ny, nz) stored per planarFace entity for fold-line detection
            _entity_normal: Dict[str, tuple] = {}

            def _face_entity(fi: int) -> str:
                if fi in _face_entity_cache:
                    return _face_entity_cache[fi]
                label = f"face:{fi}"
                try:
                    s = BRepAdaptor_Surface(face_ordinal_map.FindKey(fi + 1), True)
                    t = s.GetType()
                    if t == GeomAbs_Cylinder:
                        # aPriori groups all cylinder faces of the same feature into
                        # one entity (one "simpleHole" or "straightBend" entity, not
                        # one curvedWall per OCC face). This collapses 15 curvedWall
                        # entities → 8 feature entities and reduces adjacent pairs
                        # from ~55 to ~18, leaving budget for planarFace fold-lines.
                        feat_id = face_to_feature.get(fi)
                        if feat_id:
                            label = feat_id
                        else:
                            n = _plane_entity_counter[0]
                            _plane_entity_counter[0] += 1
                            label = f"curvedWall:{n}"
                    elif t == GeomAbs_Plane:
                        pln = s.Plane()
                        nx = pln.Axis().Direction().X()
                        ny = pln.Axis().Direction().Y()
                        nz = pln.Axis().Direction().Z()
                        # Signed distance from world origin to the plane
                        loc = pln.Axis().Location()
                        d_raw = loc.X() * nx + loc.Y() * ny + loc.Z() * nz
                        # Canonical normal: first non-zero component positive
                        if nx < -1e-6 or (abs(nx) < 1e-6 and ny < -1e-6) \
                                or (abs(nx) < 1e-6 and abs(ny) < 1e-6 and nz < -1e-6):
                            nx, ny, nz, d_raw = -nx, -ny, -nz, -d_raw
                        key = (round(nx, 2), round(ny, 2), round(nz, 2), round(d_raw, 1))
                        if key not in _plane_key_to_entity:
                            n = _plane_entity_counter[0]
                            _plane_entity_counter[0] += 1
                            _plane_key_to_entity[key] = f"planarFace:{n}"
                        label = _plane_key_to_entity[key]
                        if label not in _entity_normal:
                            _entity_normal[label] = (nx, ny, nz)
                    else:
                        n = _plane_entity_counter[0]
                        _plane_entity_counter[0] += 1
                        label = f"face:{n}"
                except Exception:
                    pass
                _face_entity_cache[fi] = label
                if label not in _entity_repr_face:
                    _entity_repr_face[label] = fi
                return label

            # Build entity labels for all faces up-front
            for fi in range(total_faces):
                _face_entity(fi)

            num_entities = _plane_entity_counter[0]
            logger.info(f"[GCD-adj] entities after plane-merging: {num_entities} "
                        f"(from {total_faces} OCC faces)")

            # Collect (face_ordinal, edge_midpoint) for every edge of every face
            _EDGE_TOL = 0.1  # mm
            all_face_edges: List[tuple] = []
            for fi in range(total_faces):
                _ee = TopExp_Explorer(face_ordinal_map.FindKey(fi + 1), TopAbs_EDGE)
                while _ee.More():
                    try:
                        c = BRepAdaptor_Curve(_ee.Current())
                        mid = c.Value((c.FirstParameter() + c.LastParameter()) / 2.0)
                        all_face_edges.append((fi, mid))
                    except Exception:
                        pass
                    _ee.Next()

            # Cluster edge midpoints by physical location (greedy O(N×G))
            edge_clusters: List[List[tuple]] = []
            for fi, mid in all_face_edges:
                placed = False
                for cluster in edge_clusters:
                    if cluster[0][1].Distance(mid) < _EDGE_TOL:
                        cluster.append((fi, mid))
                        placed = True
                        break
                if not placed:
                    edge_clusters.append([(fi, mid)])

            # Emit one entity-pair adjacency per unique cluster.
            # Skip clusters where all faces belong to the same entity (internal
            # edges within a merged planar entity — aPriori ignores these).
            seen_ent_pairs: set = set()
            for cluster in edge_clusters:
                face_ords = list(dict.fromkeys(fi for fi, _ in cluster))
                if len(face_ords) < 2:
                    continue
                entities = [_face_entity(fi) for fi in face_ords]
                # Unique entities at this edge location
                uniq_ents = list(dict.fromkeys(entities))
                if len(uniq_ents) < 2:
                    continue  # all faces on same merged entity — skip
                # Prefer feature/curvedWall → planarFace as the canonical pair.
                # After cylinder-grouping, cylinder entities carry feat_id labels
                # (simpleHole_N, straightBend_N) rather than curvedWall:N, so we
                # check the inverse: not-planar source, planar target.
                best_ea: str = ""
                best_eb: str = ""
                best_fia: int = face_ords[0]
                best_fib: int = face_ords[1]
                found_feature_planar = False
                for ea in uniq_ents:
                    for eb in uniq_ents:
                        if ea == eb:
                            continue
                        if not ea.startswith("planarFace") and eb.startswith("planarFace"):
                            best_ea, best_eb = ea, eb
                            best_fia = _entity_repr_face.get(ea, face_ords[0])
                            best_fib = _entity_repr_face.get(eb, face_ords[1])
                            found_feature_planar = True
                            break
                    if found_feature_planar:
                        break
                if not found_feature_planar:
                    best_ea, best_eb = uniq_ents[0], uniq_ents[1]
                    best_fia = _entity_repr_face.get(best_ea, face_ords[0])
                    best_fib = _entity_repr_face.get(best_eb, face_ords[1])

                ek = (min(best_ea, best_eb), max(best_ea, best_eb))
                if ek in seen_ent_pairs:
                    continue
                seen_ent_pairs.add(ek)
                raw_adjacent_pairs.append({
                    "fi": best_fia, "fj": best_fib,
                    "li": best_ea, "lj": best_eb,
                })
                # Populate feature-level sets for ends_on / intersects derivation
                for fi_c in face_ords:
                    if fi_c == blank_face_id:
                        for fj_c in face_ords:
                            if fj_c != fi_c:
                                feat = face_to_feature.get(fj_c)
                                if feat:
                                    blank_adjacent_features.add(feat)
                    else:
                        fa_f = face_to_feature.get(fi_c)
                        if fa_f:
                            for fj_c in face_ords:
                                fb_f = face_to_feature.get(fj_c)
                                if fb_f and fb_f != fa_f:
                                    feature_adjacent_pairs.add((min(fa_f, fb_f), max(fa_f, fb_f)))

            logger.info(
                f"[GCD-adj] OCC result: raw_pairs={len(raw_adjacent_pairs)} "
                f"blank_adjacent={blank_adjacent_features} "
                f"feature_pairs={len(feature_adjacent_pairs)}"
            )

        except Exception as e:
            logger.info(f"[GCD-adj] OCC face adjacency FAILED: {type(e).__name__}: {e}")

        relations: List[Dict[str, Any]] = []

        # ── 1. adjacent ────────────────────────────────────────────────────
        import math as _math

        blank_entity = _face_entity_cache.get(blank_face_id) if blank_face_id is not None else None

        def _is_planar(ea: str) -> bool:
            return ea.startswith("planarFace")

        def _planar_angle_deg(ea: str, eb: str):
            na = _entity_normal.get(ea)
            nb = _entity_normal.get(eb)
            if na is None or nb is None:
                return None
            dot = abs(na[0]*nb[0] + na[1]*nb[1] + na[2]*nb[2])
            try:
                return round(_math.degrees(_math.acos(min(1.0, dot))), 1)
            except Exception:
                return None

        def _is_fold_line(ea: str, eb: str) -> bool:
            """Both are planarFace with normals at ≥45° — structural fold / corner edges."""
            if not (_is_planar(ea) and _is_planar(eb)):
                return False
            angle = _planar_angle_deg(ea, eb)
            return angle is not None and angle >= 45.0

        # Degree-based significance filter for planarFace→planarFace pairs.
        # On a sheet metal bracket nearly all adjacent planar faces are at 90°
        # (flanges to base plate), so the angle threshold alone passes everything.
        # Instead, count each entity's distinct adjacencies: major structural
        # surfaces (base plate, large flanges) have high degree; minor faces
        # (hole annuli, fillet strips, narrow edge bands) have degree 1–3.
        # Only include planarFace→planarFace pairs where both are high-degree hubs.
        _entity_degree: Dict[str, int] = {}
        for p in raw_adjacent_pairs:
            ea, eb = p["li"], p["lj"]
            _entity_degree[ea] = _entity_degree.get(ea, 0) + 1
            _entity_degree[eb] = _entity_degree.get(eb, 0) + 1

        _sorted_ent = sorted(_entity_degree.items(), key=lambda x: -x[1])
        logger.info(
            f"[GCD-adj] entity degrees (top-15): "
            f"{[(e, d) for e, d in _sorted_ent[:15]]}"
        )

        # Threshold: planarFace entities with fewer than _MIN_PLANAR_DEGREE
        # neighbours are considered minor (hole annuli, edge strips) and are
        # excluded from planarFace–planarFace adjacent pairs.
        _MIN_PLANAR_DEGREE = 4

        def _is_significant_planar(e: str) -> bool:
            return _is_planar(e) and _entity_degree.get(e, 0) >= _MIN_PLANAR_DEGREE

        # Emit pairs:
        #   a) feature/curvedWall → anything  (always)
        #   b) planarFace → planarFace  only when both are significant hubs AND fold-line ≥45°
        _emit_pairs = [
            p for p in raw_adjacent_pairs
            if not (_is_planar(p["li"]) and _is_planar(p["lj"]))
            or (
                _is_significant_planar(p["li"])
                and _is_significant_planar(p["lj"])
                and _is_fold_line(p["li"], p["lj"])
            )
        ]
        logger.info(
            f"[GCD-adj] emit pairs: {len(_emit_pairs)} "
            f"(feature+fold degree≥{_MIN_PLANAR_DEGREE} / {len(raw_adjacent_pairs)} total, "
            f"blank_entity={blank_entity})"
        )
        def _expand_fids(repr_face: int) -> List[int]:
            """Return all OCC face ordinals for the feature that owns repr_face.
            Falls back to [repr_face] when the face isn't part of a named feature
            (e.g. blank, edge strips)."""
            feat_id = face_to_feature.get(repr_face)
            if feat_id:
                return feature_to_faces.get(feat_id, [repr_face])
            return [repr_face]

        for p in _emit_pairs:
            angle = None
            if p["li"].startswith("planarFace") and p["lj"].startswith("planarFace"):
                angle = _planar_angle_deg(p["li"], p["lj"])
            # Expand to all faces of each entity's feature so the full feature
            # geometry (e.g. both semicircles of a rounded slot) gets highlighted.
            all_fi = _expand_fids(p["fi"])
            all_fj = _expand_fids(p["fj"])
            face_ids = list(dict.fromkeys(all_fi + all_fj))
            rel: Dict[str, Any] = {
                "type": "adjacent",
                "source_id": p["li"],
                "target_id": p["lj"],
                "face_ids": face_ids,
                "distance_mm": 0.0,
            }
            if angle is not None:
                rel["angle_deg"] = angle
            relations.append(rel)

        # ── 2. ends_on ─────────────────────────────────────────────────────
        # Bends whose faces share an edge with the blank face (fold line = shared edge).
        # Domain-rule fallback: every sheet-metal bend always ends on blank_1.
        seen_ends_on: set = set()
        for feat_id in blank_adjacent_features:
            inst_match = next((i for i in instances if i["id"] == feat_id), None)
            if inst_match and inst_match["ftype"] == "bend":
                seen_ends_on.add(feat_id)
                relations.append({
                    "type": "ends_on",
                    "source_id": feat_id,
                    "target_id": "blank_1",
                })
        if not seen_ends_on:
            # Fallback: OCC adjacency didn't resolve (face_ids absent or STEP topology variant)
            for inst in instances:
                if inst["ftype"] == "bend":
                    seen_ends_on.add(inst["id"])
                    relations.append({
                        "type": "ends_on",
                        "source_id": inst["id"],
                        "target_id": "blank_1",
                    })

        # ── 3. intersects ──────────────────────────────────────────────────
        # blank_1 contains every non-bend feature (holes, slots drill through blank plane)
        for inst in instances:
            if inst["ftype"] != "bend":
                relations.append({
                    "type": "intersects",
                    "source_id": "blank_1",
                    "target_id": inst["id"],
                })
        # Feature-to-feature volume overlap (sphere proxy)
        n = len(instances)
        for i in range(n):
            a = instances[i]
            for j in range(i + 1, n):
                b = instances[j]
                dist = math.sqrt(
                    (a["cx"] - b["cx"]) ** 2
                    + (a["cy"] - b["cy"]) ** 2
                    + (a["cz"] - b["cz"]) ** 2
                )
                sum_r = a["radius"] + b["radius"]
                max_r = max(a["radius"], b["radius"])
                an, bn = a["normal"], b["normal"]
                has_normals = isinstance(an, tuple) and isinstance(bn, tuple)

                if dist < sum_r:
                    # ── 3. intersects (cont.) ──────────────────────────────
                    relations.append({
                        "type": "intersects",
                        "source_id": a["id"],
                        "target_id": b["id"],
                        "distance_mm": round(dist, 2),
                    })

                elif dist < 2 * max_r:
                    # ── 6. lies_near ──────────────────────────────────────
                    relations.append({
                        "type": "lies_near",
                        "source_id": a["id"],
                        "target_id": b["id"],
                        "distance_mm": round(dist, 2),
                    })

                else:
                    # Classify by normal relationship for distant features
                    if has_normals:
                        dot = an[0] * bn[0] + an[1] * bn[1] + an[2] * bn[2]
                        abs_dot = abs(dot)
                        if abs_dot > 0.95:
                            # ── 9. parallel ───────────────────────────────
                            relations.append({
                                "type": "parallel",
                                "source_id": a["id"],
                                "target_id": b["id"],
                                "distance_mm": round(dist, 2),
                                "angle_deg": round(
                                    math.degrees(math.acos(min(abs_dot, 1.0))), 1
                                ),
                            })
                        elif abs_dot < 0.087:
                            # cos(85°) ≈ 0.087 — within 5° of perpendicular
                            # ── 5. is_orthogonal ──────────────────────────
                            relations.append({
                                "type": "is_orthogonal",
                                "source_id": a["id"],
                                "target_id": b["id"],
                                "distance_mm": round(dist, 2),
                                "angle_deg": round(
                                    math.degrees(math.acos(min(abs_dot, 1.0))), 1
                                ),
                            })
                        else:
                            # ── 8. lies_outside ───────────────────────────
                            relations.append({
                                "type": "lies_outside",
                                "source_id": a["id"],
                                "target_id": b["id"],
                                "distance_mm": round(dist, 2),
                            })
                    else:
                        relations.append({
                            "type": "lies_outside",
                            "source_id": a["id"],
                            "target_id": b["id"],
                            "distance_mm": round(dist, 2),
                        })

        # ── 4. is_accessible_from ──────────────────────────────────────────
        # Feature is reachable from a setup axis when its normal faces that direction
        # (dot > 0.3) or, for features without normals, from any feasible axis.
        for inst in instances:
            for axis in setup_axes:
                dv = axis.get("direction_vector") or {}
                dx, dy, dz = float(dv.get("x", 0)), float(dv.get("y", 0)), float(dv.get("z", 0))
                accessible = False
                if inst["normal"]:
                    nx, ny, nz = inst["normal"]
                    accessible = (nx * dx + ny * dy + nz * dz) > 0.3
                elif axis.get("is_feasible"):
                    accessible = True
                if accessible:
                    relations.append({
                        "type": "is_accessible_from",
                        "source_id": inst["id"],
                        "target_id": axis["id"],
                        "area_mm2": round(axis.get("accessible_surface_area_mm2") or 0.0, 1),
                    })

        # ── 7. lies_on ─────────────────────────────────────────────────────
        # Feature centroid lies within the footprint of the blank face.
        # Approximation: blank boundary radius ≈ sqrt(area / π); a feature
        # lies_on the blank when its centroid distance from blank centroid < blank_r
        # (i.e. it is inside the blank perimeter, as all sheet-metal features are).
        blank_cx = blank["centroid"]["x"]
        blank_cy = blank["centroid"]["y"]
        blank_r = math.sqrt(max(blank.get("area_mm2") or 1.0, 1.0) / math.pi)
        for inst in instances:
            dist_to_blank_centre = math.sqrt(
                (inst["cx"] - blank_cx) ** 2 + (inst["cy"] - blank_cy) ** 2
            )
            if dist_to_blank_centre < blank_r:
                relations.append({
                    "type": "lies_on",
                    "source_id": inst["id"],
                    "target_id": "blank_1",
                    "distance_mm": round(dist_to_blank_centre, 2),
                    "area_mm2": round(math.pi * inst["radius"] ** 2, 1),
                })

        return relations[:300]  # 300 entries: ~9 types × richer per-feature data

    @staticmethod
    def _feature_label(
        ftype: str,
        diam: Optional[Any],
        occurrence_idx: int,
    ) -> str:
        idx = occurrence_idx + 1
        if ftype == "hole":
            d = float(diam) if diam is not None else 0.0
            return f"complexHole_{idx}" if d > 10.0 else f"simpleHole_{idx}"
        if ftype == "bend":
            return f"straightBend_{idx}"
        if ftype == "slot":
            return f"slot_{idx}"
        if ftype == "pocket":
            return f"pocket_{idx}"
        return f"feature_{idx}"
