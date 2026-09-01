"""
Injection Molding feature extraction — geometry analysis using OpenCASCADE.

Split out of the former feature_extractors.py (2026-09-01 domain-boundary
refactor) — InjectionMoldedFeatureExtractor, unchanged, verbatim.
"""

import logging
import math
from collections import defaultdict
from typing import Dict, List, Optional, Tuple, Any

logger = logging.getLogger(__name__)


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
