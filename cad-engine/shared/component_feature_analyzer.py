"""
Cross-domain CAD feature primitives — geometry decomposition and part-family
classification applicable to ANY manufacturing domain, not owned by one.

Split out of the former feature_extractors.py (2026-09-01 domain-boundary
refactor) — detect_part_family() + ComponentFeatureAnalyzer, unchanged,
verbatim. See each symbol's own docstring for why it belongs here rather
than under a single domain (sheet_metal/injection_molding/machining).
"""

import logging
import math
from collections import defaultdict
from typing import Dict, List, Optional, Tuple, Any

logger = logging.getLogger(__name__)


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


class ComponentFeatureAnalyzer:
    """
    eMithran-style geometry decomposition for any detected part family.

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
        Compute all 9 eMithran GCD relation types between feature instances.

        Relation taxonomy (matches eMithran Geometric Cost Drivers panel):
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

        # ── OCC face adjacency ─────────────────────────────────────────────
        # Global edge-midpoint matching across ALL faces.
        # Two faces sharing a geometrically coincident edge midpoint (within
        # _EDGE_TOL) are adjacent — this is immune to pythonocc 7.7.x
        # identity-comparison bugs (FindIndex/IsPartner/IsSame all fail for
        # faces from different traversal paths in disconnected STEP compounds).
        #
        # Produces raw_adjacent_pairs (face-level, eMithran-style labelling)
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

            # eMithran merges co-planar OCC faces into a single "planarFace" entity before
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
                        # eMithran groups all cylinder faces of the same feature into
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
            # edges within a merged planar entity — eMithran ignores these).
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
        seen_ends_on: set = set()
        for feat_id in blank_adjacent_features:
            inst_match = next((i for i in instances if i["id"] == feat_id), None)
            if inst_match and inst_match["ftype"] == "bend":
                seen_ends_on.add(feat_id)
                relations.append({
                    "type": "ends_on",
                    "source_id": feat_id,
                    "target_id": "blank_1",
                    "provenance": "occ_adjacency",
                })
        if not seen_ends_on:
            # Domain-rule fallback for when OCC adjacency didn't resolve any
            # bend (face_ids absent or an unusual STEP topology variant):
            # assume every bend ends on blank_1, which is topologically true
            # for the common single-blank case but does NOT model real
            # bend-to-bend/bend-to-flange chains (CLAUDE.md tracks that as a
            # separate, in-progress capability). Tagged "domain_rule_fallback"
            # so a consumer can tell this apart from a real OCC-measured
            # relation instead of treating it as equally precise.
            for inst in instances:
                if inst["ftype"] == "bend":
                    seen_ends_on.add(inst["id"])
                    relations.append({
                        "type": "ends_on",
                        "source_id": inst["id"],
                        "target_id": "blank_1",
                        "provenance": "domain_rule_fallback",
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
