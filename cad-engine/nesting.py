"""
True (real polygon) 2D nesting placement -- for the Nest View feature.

This is NOT the existing rectangle-grid nesting engine
(backend/src/modules/bom-items/costing/sheet-metal-nesting.engine.ts),
which remains the sole source of truth for material cost. This module is
visualization-only: it answers "how would these parts actually interlock on
a real sheet" using the real flat-pattern outline (from
feature_extractors.py's _compute_flat_pattern_outline), not a bounding
rectangle.

Algorithm: extreme-point bottom-left-fill (BLF) with real polygon overlap
testing via shapely. This is a heuristic used by practical irregular-shape
nesting tools -- NOT a full no-fit-polygon (NFP) + genetic-algorithm
optimizer like commercial nesters (Deepnest, SigmaNest, Almacam). It will
not always match a fully-optimized commercial nest, but it performs real
collision testing against the actual part silhouette (not its bounding
box), so concave regions of one part can genuinely accept a neighboring
part's convex bump -- true interlocking, not a uniform grid.

No job-queue infrastructure exists in this codebase (confirmed before this
was written) -- this must run to completion synchronously and fail safely
(never hang) via the `capped` output, since it's called from an on-demand
HTTP endpoint with a real timeout on the caller's side.
"""
import math
from typing import Any, Dict, List, Optional, Tuple

from shapely.geometry import Polygon
from shapely.affinity import rotate as shapely_rotate, translate as shapely_translate
from shapely.ops import unary_union

DEFAULT_ALLOWED_ROTATIONS_DEG: List[float] = [0.0, 90.0, 180.0, 270.0]

# Total (anchor x rotation x remaining-instance) trial evaluations allowed
# while filling one sheet. A generous bound for realistic part counts (tens
# to low hundreds per sheet); parts that would need far more than this to
# nest (very high quantities, or a shape/sheet combination that produces
# many tiny slivers of remaining space) hit `capped` honestly rather than
# the request hanging with no queue to fall back on.
MAX_EVALUATIONS = 150_000


def _build_outline_polygon(outline_points_mm: List[List[float]]) -> Optional[Polygon]:
    if not outline_points_mm or len(outline_points_mm) < 3:
        return None
    try:
        poly = Polygon(outline_points_mm).buffer(0)
    except Exception:
        return None
    if poly.is_empty or poly.area <= 0:
        return None
    # buffer(0) on a self-intersecting or oddly-wound input can yield a
    # MultiPolygon -- take the largest piece rather than guess which was
    # intended, same "decline the ambiguous part, don't fabricate" stance
    # used throughout the cad-engine geometry code this builds on.
    if poly.geom_type == "MultiPolygon":
        poly = max(poly.geoms, key=lambda g: g.area)
    if poly.geom_type != "Polygon":
        return None
    return poly


def compute_true_nest(
    outline_points_mm: List[List[float]],
    holes_mm: List[Dict[str, float]],
    sheet_width_mm: float,
    sheet_length_mm: float,
    quantity: int,
    kerf_mm: float = 0.0,
    edge_margin_mm: float = 2.0,
    allowed_rotations_deg: Optional[List[float]] = None,
) -> Tuple[Optional[Dict[str, Any]], str]:
    """
    Places as many copies of the real part outline as fit on ONE sheet
    (extreme-point bottom-left-fill, real polygon collision), then
    replicates that single-sheet layout across sheets_required = ceil(quantity
    / parts_per_sheet) -- the same "one representative sheet layout, real
    life reuses it" convention the existing rectangle-nesting engine already
    uses for sheets_required.

    Returns (None, reason) when the outline itself is unusable (degenerate,
    or too large to fit even once within the sheet's usable area) -- never a
    fabricated/empty-but-successful result. `reason` is always a non-empty,
    specific diagnostic string on failure (e.g. "outline has fewer than 3
    points", "part does not fit the sheet's usable area at any of the N
    allowed rotations (largest rotation bbox WxH mm vs usable AxB mm)") --
    never a generic "could not compute" placeholder -- and an empty string
    on success.

    Return shape (on success, i.e. reason == ""):
      {
        "sheet_width_mm", "sheet_length_mm": echoed inputs,
        "parts_per_sheet": int (>= 0),
        "placements": [{"x_mm", "y_mm", "rotation_deg"}, ...] -- ONE sheet's
            worth; x_mm/y_mm is the translation applied to the ORIGINAL
            outline_points_mm coordinate frame (i.e. render as
            `translate(x_mm, y_mm) rotate(rotation_deg)` applied to the
            original outline, in that order, matching SVG's own
            transform-list convention of right-to-left application).
        "utilization_pct": geometric nest utilization -- computed from the
            true polygon area (not bounding-rect-derived), as (part_area *
            parts_per_sheet) / usable_sheet_area * 100. This reflects
            THIS heuristic placement only, not a globally optimal packing --
            a different (e.g. full NFP/genetic-algorithm) nester could
            legitimately report a different, possibly higher, figure for
            the same part/sheet. Display this as "True-shape nest
            utilization" / "Geometric nest utilization", never as "Real
            utilization" or otherwise implied to be the best achievable.
        "sheets_required": ceil(quantity / parts_per_sheet), or None if
            parts_per_sheet is 0 (nothing fits -- a real, disclosed failure,
            not silently reported as 0 sheets needed).
        "capped": True if the evaluation budget was exhausted before the
            sheet was confirmed full (result still reflects everything
            actually placed before the cap -- a real partial answer, not a
            wrong one).
      }
    """
    n_pts = len(outline_points_mm) if outline_points_mm else 0
    base_poly = _build_outline_polygon(outline_points_mm)
    if base_poly is None:
        if n_pts < 3:
            return None, f"outline has only {n_pts} point(s) -- need at least 3 to form a polygon"
        return None, (
            f"outline with {n_pts} points failed to form a valid polygon "
            "(self-intersecting/degenerate topology that buffer(0) repair could not resolve, "
            "or the repaired geometry has zero area)"
        )

    rotations = allowed_rotations_deg if allowed_rotations_deg else DEFAULT_ALLOWED_ROTATIONS_DEG
    usable_w = sheet_width_mm - 2 * edge_margin_mm
    usable_l = sheet_length_mm - 2 * edge_margin_mm
    if usable_w <= 0 or usable_l <= 0:
        return None, (
            f"sheet {sheet_width_mm}x{sheet_length_mm}mm with edge_margin_mm={edge_margin_mm} "
            f"leaves a non-positive usable area ({usable_w:.1f}x{usable_l:.1f}mm)"
        )

    half_kerf = max(0.0, kerf_mm) / 2.0

    # Precompute each rotation's polygon (around the origin) + its own bbox
    # dims, reused for every placement attempt at that rotation.
    rotated_variants: List[Tuple[float, Polygon, float, float]] = []
    for angle in rotations:
        rp = shapely_rotate(base_poly, angle, origin=(0, 0), use_radians=False)
        minx, miny, maxx, maxy = rp.bounds
        rotated_variants.append((angle, rp, maxx - minx, maxy - miny))
    if not rotated_variants:
        return None, "no allowed_rotations_deg were provided"

    # A part instance too large for the usable sheet area in EVERY rotation
    # can never be placed -- decline rather than report a false 0.
    if all(w > usable_w or h > usable_l for (_a, _p, w, h) in rotated_variants):
        best = min(rotated_variants, key=lambda v: max(v[2] - usable_w, v[3] - usable_l))
        return None, (
            f"part outline (bbox at its best-fitting rotation of {best[0]}deg is "
            f"{best[2]:.1f}x{best[3]:.1f}mm) does not fit the sheet's usable area "
            f"({usable_w:.1f}x{usable_l:.1f}mm) at any of the {len(rotations)} allowed rotations "
            f"({rotations})"
        )

    placed_polys: List[Polygon] = []       # raw (unbuffered) placed footprints
    placed_buffered: List[Polygon] = []    # kerf/2-buffered, for real collision tests
    placements: List[Dict[str, float]] = []

    # Uniform-grid spatial index over placed_buffered, keyed by cell size ~=
    # one part's own footprint. Without this, _fits_and_clear tested every
    # candidate against the FULL placed_buffered list (confirmed live: a
    # small part -- ~53x123mm -- on a 2500x5000mm sheet needs ~1,800+
    # placements, so a plain O(n) scan per candidate made the whole nest
    # O(n^2) real shapely intersection calls and blew past the caller's
    # 30s timeout well before MAX_EVALUATIONS even kicked in, since that cap
    # bounds evaluation COUNT, not the cost of each one). shapely's own
    # STRtree can't be used here -- it's built once from a fixed geometry
    # array and has no incremental insert, but this loop discovers one new
    # polygon per placement. A part-sized grid keeps each cell's occupancy
    # roughly constant as the sheet fills, so a candidate only tests against
    # placements actually near it -- same correctness (still a real
    # intersection-area test), just without scanning placements far away on
    # the sheet that could never overlap it anyway.
    cell_size_mm = max(1.0, max((max(w, h) for (_a, _p, w, h) in rotated_variants), default=1.0))
    grid_index: Dict[Tuple[int, int], List[int]] = {}

    def _grid_cells(minx: float, miny: float, maxx: float, maxy: float) -> List[Tuple[int, int]]:
        cx0, cy0 = int(math.floor(minx / cell_size_mm)), int(math.floor(miny / cell_size_mm))
        cx1, cy1 = int(math.floor(maxx / cell_size_mm)), int(math.floor(maxy / cell_size_mm))
        return [(cx, cy) for cx in range(cx0, cx1 + 1) for cy in range(cy0, cy1 + 1)]

    def _grid_insert(idx: int, poly: Polygon) -> None:
        for cell in _grid_cells(*poly.bounds):
            grid_index.setdefault(cell, []).append(idx)

    # Extreme-point candidate anchors: seeded with the sheet's own inner
    # bottom-left corner; after each placement, the newly-placed part's own
    # bbox top-left and bottom-right corners become new candidates. This is
    # the standard "extreme point" BLF heuristic used by practical irregular
    # bin-packers -- a tractable approximation of scanning every possible
    # position, not a full continuous search.
    candidate_anchors: set = {(edge_margin_mm, edge_margin_mm)}
    sheet_origin_x, sheet_origin_y = edge_margin_mm, edge_margin_mm
    sheet_max_x, sheet_max_y = edge_margin_mm + usable_w, edge_margin_mm + usable_l

    evaluations = 0
    capped = False
    # An anchor that fails at every rotation can NEVER later succeed --
    # obstacles (placed_buffered) only ever grow, never shrink, so "no room
    # here now" only gets more true over time. Without this, every dead
    # anchor got re-tested (including real shapely buffer/intersection
    # calls) on every single subsequent round -- confirmed live: this made
    # filling a 96x96mm area with 10x10mm squares take 15+ seconds per test
    # case (O(placed^2) real geometry calls) instead of a fraction of a
    # second. Marking an anchor dead the first time it fully fails caps its
    # real-geometry cost at once, ever.
    dead_anchors: set = set()

    def _fits_and_clear(candidate: Polygon) -> bool:
        minx, miny, maxx, maxy = candidate.bounds
        if minx < sheet_origin_x - 1e-6 or miny < sheet_origin_y - 1e-6:
            return False
        if maxx > sheet_max_x + 1e-6 or maxy > sheet_max_y + 1e-6:
            return False
        candidate_buffered = candidate.buffer(half_kerf) if half_kerf > 0 else candidate
        nearby_idx: set = set()
        for cell in _grid_cells(*candidate_buffered.bounds):
            nearby_idx.update(grid_index.get(cell, ()))
        for idx in nearby_idx:
            other = placed_buffered[idx]
            # Cheap AABB pre-filter before the real (more expensive) polygon
            # intersection test -- avoids a full geometry test against every
            # grid-neighbor for candidates that obviously don't overlap its
            # bounding box at all.
            if not candidate_buffered.intersects(other.envelope):
                continue
            # Area-based overlap test, not Polygon.intersects() -- intersects()
            # is True for merely TOUCHING polygons (shared boundary, zero
            # overlap area), which would wrongly reject two parts legitimately
            # butted edge-to-edge at zero kerf (confirmed live: this rejected
            # every placement after the first for identical adjacent squares,
            # capping a 96x96mm usable area at a single 10x10mm part).
            if candidate_buffered.intersection(other).area > 1e-6:
                return False
        return True

    # Always fill the sheet to its TRUE capacity, independent of `quantity`
    # -- quantity only determines sheets_required afterward (a quantity of 3
    # on a sheet that fits 20 must still report the real 20-part capacity,
    # not stop at 3 and misreport the sheet as nearly empty).
    while True:
        placed_this_round = False
        # Try anchors bottom-to-top, left-to-right (real bottom-left-fill
        # order), skipping any already confirmed dead.
        live_anchors = sorted(candidate_anchors - dead_anchors, key=lambda a: (a[1], a[0]))
        for anchor in live_anchors:
            ax, ay = anchor
            if ax >= sheet_max_x or ay >= sheet_max_y:
                dead_anchors.add(anchor)
                continue
            found = False
            for (angle, rp, w, h) in rotated_variants:
                evaluations += 1
                if evaluations > MAX_EVALUATIONS:
                    capped = True
                    break
                if ax + w > sheet_max_x + 1e-6 or ay + h > sheet_max_y + 1e-6:
                    continue
                minx, miny, _maxx, _maxy = rp.bounds
                dx, dy = ax - minx, ay - miny
                candidate = shapely_translate(rp, xoff=dx, yoff=dy)
                if not _fits_and_clear(candidate):
                    continue
                # Accepted -- this anchor+rotation is the placement.
                placed_polys.append(candidate)
                accepted_buffered = candidate.buffer(half_kerf) if half_kerf > 0 else candidate
                placed_buffered.append(accepted_buffered)
                _grid_insert(len(placed_buffered) - 1, accepted_buffered)
                placements.append({"x_mm": round(dx, 3), "y_mm": round(dy, 3), "rotation_deg": angle})
                cminx, cminy, cmaxx, cmaxy = candidate.bounds
                # New extreme-point anchors offset OUTWARD by the full kerf --
                # not the bare touching corner. A candidate anchored exactly
                # at (cmaxx, cminy) with zero offset is, by construction,
                # touching this part with zero real gap; the kerf/2-buffered
                # collision test then correctly rejects it every time (kerf
                # demands real separation), permanently dead-ends that anchor,
                # and the whole sheet stops after this one placement --
                # confirmed live: ANY kerf_mm > 0 collapsed every tested shape
                # (square, trapezoid, concave L) to parts_per_sheet == 1. The
                # offset below is what a real kerf-aware BLF anchor must be:
                # the next position that is ALREADY kerf_mm clear of this
                # part, not a touching point that can never pass its own
                # clearance test.
                candidate_anchors.add((cmaxx + kerf_mm, cminy))
                candidate_anchors.add((cminx, cmaxy + kerf_mm))
                found = True
                break
            if capped:
                break
            if found:
                placed_this_round = True
                break
            dead_anchors.add(anchor)  # failed at every rotation -- never retry
        if capped or not placed_this_round:
            break

    parts_per_sheet = len(placements)
    if parts_per_sheet == 0:
        return {
            "sheet_width_mm": sheet_width_mm,
            "sheet_length_mm": sheet_length_mm,
            "parts_per_sheet": 0,
            "placements": [],
            "utilization_pct": 0.0,
            "sheets_required": None,
            "capped": capped,
        }, ""

    usable_area = usable_w * usable_l
    utilization_pct = round(100.0 * (base_poly.area * parts_per_sheet) / usable_area, 1) if usable_area > 0 else 0.0
    sheets_required = math.ceil(quantity / parts_per_sheet) if quantity and quantity > 0 else None

    return {
        "sheet_width_mm": sheet_width_mm,
        "sheet_length_mm": sheet_length_mm,
        "parts_per_sheet": parts_per_sheet,
        "placements": placements,
        "utilization_pct": utilization_pct,
        "sheets_required": sheets_required,
        "capped": capped,
    }, ""
