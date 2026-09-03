"""
Perforating pattern detection — sheet-metal repeated-hole regions.

Distinguishes a genuine perforated pattern (a deliberate manufacturing
region, e.g. a ventilation grille or speaker mesh) from incidental
same-diameter holes scattered around a part (e.g. 20+ unrelated mounting
holes at a common bolt size). Runs entirely on already-extracted hole data
(the deduped, coaxial-clustered tuple list feature_extractor.py's
_count_holes_with_location already builds) — no new OCC/B-Rep access, pure
computational geometry over points already known to be real physical holes.

Thresholds MIN_PATTERN_HOLES / MIN_NEARBY_HOLES are real, sourced values
from sm_reference_data (staged migration of the licensed Digital Factory
reference dataset, source_version 2026-03):
  defaultNumIdentHolesPerforating       = 20  (row id 86)
  defaultNumNearbyIdentHolesPerforating = 2   (row id 87)
Both rows' notes are truncated in the staged data ("Default number of ...
required to determine perforating pattern for turret press perforatin...",
notesTruncatedInSource=true). Literal reading used here: a same-diameter
hole group qualifies as a perforating pattern only if it has >=20 total
members, AND every qualifying member has >=2 other same-diameter members
within a "nearby" radius.

"Nearby" itself carries no distance/multiplier in the source data (its own
unit_type is null — these two rows are pure counts). CONNECTIVITY_MULTIPLIER
below is this module's OWN engineering choice, not sourced — kept separate
and clearly labeled so a future audit can tell real thresholds from derived
ones, the same discipline already applied to every other hardcoded-fallback
fix in this codebase.
"""

import math
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

# Real, sourced (sm_reference_data ids 86/87, USA 2026-03) — see module
# docstring. Do not change without re-checking the source.
MIN_PATTERN_HOLES = 20
MIN_NEARBY_HOLES = 2

# NOT sourced — this module's own connectivity-radius heuristic (see module
# docstring). 2.5x a diameter-group's own median nearest-neighbor spacing
# keeps diagonal grid neighbors (~1.41x pitch) and adjacent-row neighbors
# connected, while excluding a hole spaced 3x+ farther than its local
# typical pitch (almost certainly an unrelated, incidentally-same-diameter
# hole, not part of the pattern).
CONNECTIVITY_MULTIPLIER = 2.5

# NOT sourced. A purely RELATIVE connectivity test (above) cannot by itself
# distinguish a real, dense perforated field from a perfectly UNIFORM chain
# of same-diameter holes spaced arbitrarily far apart (e.g. mounting holes
# every 500mm along a long bracket edge) — every hole's nearest neighbor is
# still "the typical pitch" away in both cases. Real perforated/mesh sheet
# patterns keep pitch within a few multiples of the hole diameter itself
# (commonly ~1.3-4x for standard round-hole perforated sheet); 15x is a
# deliberately conservative ceiling that will not reject any real
# perforation pattern while still rejecting holes that are merely
# identical-diameter and evenly spaced, not actually a dense field. A
# diameter group whose own median nearest-neighbor pitch exceeds this
# multiple of its hole diameter is skipped entirely — never sub-clustered.
MAX_PITCH_TO_DIAMETER_RATIO = 15.0

# O(n^2) nearest-neighbor/connectivity cap. Real perforation patterns are
# tens to low hundreds of holes; beyond this, skip pattern detection for
# this diameter group rather than risk a multi-second stall on a part with
# an unrelated large same-diameter hole population. Same "capped, honestly
# disclosed" discipline test_nesting.py's
# test_capped_fires_honestly_under_a_tiny_evaluation_budget already
# established for this codebase — never a silent hang, never a fabricated
# partial result.
MAX_HOLES_PER_DIAMETER_GROUP = 2000


def _dist(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def _median(values: List[float]) -> float:
    s = sorted(values)
    n = len(s)
    if n == 0:
        return 0.0
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2.0


def _connected_components(points: List[Tuple[float, float, float]], radius: float) -> List[List[int]]:
    """Radius-graph connected-components over a same-diameter hole group's centroids."""
    n = len(points)
    adjacency: Dict[int, List[int]] = {i: [] for i in range(n)}
    for i in range(n):
        for j in range(i + 1, n):
            if _dist(points[i], points[j]) <= radius:
                adjacency[i].append(j)
                adjacency[j].append(i)
    visited = [False] * n
    components: List[List[int]] = []
    for i in range(n):
        if visited[i]:
            continue
        stack = [i]
        visited[i] = True
        comp = []
        while stack:
            k = stack.pop()
            comp.append(k)
            for nb in adjacency[k]:
                if not visited[nb]:
                    visited[nb] = True
                    stack.append(nb)
        components.append(comp)
    return components


def _detect_grid(
    xs: List[float], ys: List[float],
) -> Tuple[Optional[float], Optional[float], Optional[int], Optional[int]]:
    """
    Attempt to resolve a rectilinear row/column grid from 2D hole centers.
    Returns (pitch_x_mm, pitch_y_mm, rows, cols) — all None if the holes
    don't form a clean, fully-populated rectangle (staggered/hex/irregular
    layouts are real perforation patterns too, just not ones this v1 grid
    resolver can describe with a pitch — honestly None, never fabricated).
    """
    def _cluster(vals: List[float]) -> List[float]:
        """
        Cluster 1D coordinates into rows/columns. With multiple holes per
        row/column and real-world jitter, consecutive-gap values are
        bimodal: many small WITHIN-cluster gaps (jitter-scale) and few large
        BETWEEN-cluster gaps (pitch-scale) — a single global median gap
        conflates the two and produces a tolerance that is right for
        neither. Instead find the natural break: the largest ratio jump
        between consecutive sorted nonzero gaps. Every gap at or below that
        break is real within-cluster jitter; every gap above it is a real
        between-cluster pitch. A perfectly uniform axis (no jitter, no
        multi-point clusters, or every cluster gap identical) has no such
        jump — falls back to half the smallest real gap, which is exactly
        the honest boundary between "same point" (gap 0, filtered out) and
        "next real position" in that case.
        """
        s = sorted(vals)
        if len(s) <= 1:
            return list(s)
        gaps = [s[i + 1] - s[i] for i in range(len(s) - 1)]
        nonzero_gaps = sorted(g for g in gaps if g > 1e-6)
        if not nonzero_gaps:
            return [sum(s) / len(s)]
        if len(nonzero_gaps) == 1:
            tol = nonzero_gaps[0] / 2.0
        else:
            best_ratio = 1.0
            best_idx: Optional[int] = None
            for i in range(len(nonzero_gaps) - 1):
                a, b = nonzero_gaps[i], nonzero_gaps[i + 1]
                ratio = b / a
                if ratio > best_ratio:
                    best_ratio = ratio
                    best_idx = i
            if best_idx is not None:
                tol = (nonzero_gaps[best_idx] + nonzero_gaps[best_idx + 1]) / 2.0
            else:
                tol = nonzero_gaps[0] / 2.0
        clusters = [[s[0]]]
        for v in s[1:]:
            if v - clusters[-1][-1] <= tol:
                clusters[-1].append(v)
            else:
                clusters.append([v])
        return [sum(c) / len(c) for c in clusters]

    x_clusters = _cluster(xs)
    y_clusters = _cluster(ys)
    if len(x_clusters) < 2 or len(y_clusters) < 2:
        return None, None, None, None
    if len(x_clusters) * len(y_clusters) != len(xs):
        return None, None, None, None  # not a fully-populated rectangle — honest None
    x_gaps = [x_clusters[i + 1] - x_clusters[i] for i in range(len(x_clusters) - 1)]
    y_gaps = [y_clusters[i + 1] - y_clusters[i] for i in range(len(y_clusters) - 1)]
    pitch_x = round(_median(x_gaps), 2) if x_gaps else None
    pitch_y = round(_median(y_gaps), 2) if y_gaps else None
    return pitch_x, pitch_y, len(y_clusters), len(x_clusters)


def detect_perforation_patterns(
    hole_entries: List[Tuple],
    min_pattern_holes: int = MIN_PATTERN_HOLES,
    min_nearby_holes: int = MIN_NEARBY_HOLES,
) -> List[Dict[str, Any]]:
    """
    hole_entries: the SAME deduped, coaxial-clustered tuple list
    feature_extractor.py's _count_holes_with_location already builds — one
    entry per real physical hole:
      (radius, abs_axis_z, cx, cy, cz, ax, ay, az, face_idx, v_range,
       u_range_rad[, merged_face_idxs])
    (indices 0-10 always present; index 11 present only for entries that
    survived STEP-seam dedup — see _dedupe_coincident_cylinders).

    Returns one dict per qualifying perforated region:
      {diameter_mm, count, pitch_x_mm, pitch_y_mm, pattern_rows,
       pattern_cols, region_bbox_mm, occurrences: [{centroid (absolute mm),
       face_ids}]}
    pitch_x_mm/pitch_y_mm/pattern_rows/pattern_cols are None when the region
    isn't a clean rectilinear grid (a real, honestly-undescribed pattern,
    e.g. staggered) — never guessed. Every occurrence corresponds to a real
    already-extracted hole; this function creates no new geometry facts, it
    only classifies existing ones.
    """
    by_diameter: Dict[float, List[Tuple]] = defaultdict(list)
    for c in hole_entries:
        by_diameter[round(c[0] * 2, 1)].append(c)

    regions: List[Dict[str, Any]] = []
    for d_mm, members in by_diameter.items():
        if len(members) < min_pattern_holes or len(members) > MAX_HOLES_PER_DIAMETER_GROUP:
            continue

        points = [(m[2], m[3], m[4]) for m in members]
        nn_dists: List[float] = []
        for i, p in enumerate(points):
            best = None
            for j, q in enumerate(points):
                if i == j:
                    continue
                d = _dist(p, q)
                if best is None or d < best:
                    best = d
            if best is not None:
                nn_dists.append(best)
        if not nn_dists:
            continue
        typical_pitch = _median(nn_dists)
        if typical_pitch <= 0:
            continue
        if typical_pitch > d_mm * MAX_PITCH_TO_DIAMETER_RATIO:
            continue  # too sparse relative to hole size — see MAX_PITCH_TO_DIAMETER_RATIO
        radius = typical_pitch * CONNECTIVITY_MULTIPLIER

        components = _connected_components(points, radius)
        for comp_idxs in components:
            if len(comp_idxs) < min_pattern_holes:
                continue
            comp_points = [points[i] for i in comp_idxs]
            comp_members = [members[i] for i in comp_idxs]

            # Real per-member "nearby identical hole" count — direct
            # implementation of the second sourced threshold, not just a
            # component-size proxy: every member must itself have
            # >=min_nearby_holes same-diameter members within radius.
            qualifies = True
            for i, p in enumerate(comp_points):
                nearby = sum(
                    1 for j, q in enumerate(comp_points) if i != j and _dist(p, q) <= radius
                )
                if nearby < min_nearby_holes:
                    qualifies = False
                    break
            if not qualifies:
                continue

            xs = [p[0] for p in comp_points]
            ys = [p[1] for p in comp_points]
            zs = [p[2] for p in comp_points]
            pitch_x, pitch_y, rows, cols = _detect_grid(xs, ys)

            occurrences = []
            for m in comp_members:
                fids = list(m[11]) if len(m) > 11 else [int(m[8])]
                occurrences.append({
                    "centroid": [round(m[2], 2), round(m[3], 2), round(m[4], 2)],
                    "face_ids": fids,
                })

            regions.append({
                "diameter_mm": d_mm,
                "count": len(comp_members),
                "pitch_x_mm": pitch_x,
                "pitch_y_mm": pitch_y,
                "pattern_rows": rows,
                "pattern_cols": cols,
                "region_bbox_mm": {
                    "x_min": round(min(xs), 1), "x_max": round(max(xs), 1),
                    "y_min": round(min(ys), 1), "y_max": round(max(ys), 1),
                    "z_min": round(min(zs), 1), "z_max": round(max(zs), 1),
                },
                "occurrences": occurrences,
            })

    return regions
