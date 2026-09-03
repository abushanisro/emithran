"""
Tests for sheet_metal.features.perforation.detect_perforation_patterns and
its end-to-end wiring into SheetMetalFeatureExtractor.extract().

Unit tests operate directly on synthetic hole_entries tuples -- the same
(radius, abs_axis_z, cx, cy, cz, ax, ay, az, face_idx, v_range, u_range_rad
[, merged_face_idxs]) shape _count_holes_with_location produces -- so they
run without OCC. The one integration test at the bottom builds a real plate
with a real cut hole grid via OCC boolean ops and runs the full extractor,
proving the wiring works against real B-Rep geometry, not just synthetic
tuples.
"""
import math

import pytest

from sheet_metal.features.perforation import (
    detect_perforation_patterns,
    MIN_PATTERN_HOLES,
    MIN_NEARBY_HOLES,
    MAX_HOLES_PER_DIAMETER_GROUP,
)


def _hole(radius: float, cx: float, cy: float, cz: float = 0.0, face_idx: int = 0) -> tuple:
    """Build one synthetic hole_entries tuple. axis_z=1.0 (through-thickness,
    vertical axis) -- the ordinary case for holes on the dominant flat face."""
    return (radius, 1.0, cx, cy, cz, 0.0, 0.0, 1.0, face_idx, radius * 2.0, 2 * math.pi)


def _grid(diameter_mm: float, rows: int, cols: int, pitch_x: float, pitch_y: float,
          origin=(0.0, 0.0), jitter: float = 0.0, angle_deg: float = 0.0) -> list:
    """Build a rows x cols grid of same-diameter holes. angle_deg rotates the
    whole grid in the XY plane (to test the honest-None grid-resolution limit
    on non-axis-aligned patterns). jitter perturbs each hole's position by up
    to +/-jitter mm (to test near-tolerance grid resolution)."""
    import random
    rng = random.Random(42)
    theta = math.radians(angle_deg)
    ox, oy = origin
    r = diameter_mm / 2.0
    entries = []
    idx = 0
    for row in range(rows):
        for col in range(cols):
            lx = col * pitch_x + (rng.uniform(-jitter, jitter) if jitter else 0.0)
            ly = row * pitch_y + (rng.uniform(-jitter, jitter) if jitter else 0.0)
            x = ox + lx * math.cos(theta) - ly * math.sin(theta)
            y = oy + lx * math.sin(theta) + ly * math.cos(theta)
            entries.append(_hole(r, x, y, face_idx=idx))
            idx += 1
    return entries


class TestPositiveDetection:
    def test_clean_grid_is_detected_as_one_region(self):
        """A 5x5 grid (25 holes, above the real 20-hole threshold) at a
        regular 10mm pitch must be detected as one perforation region with
        the real pitch/row/col resolved."""
        entries = _grid(diameter_mm=3.0, rows=5, cols=5, pitch_x=10.0, pitch_y=10.0)
        regions = detect_perforation_patterns(entries)
        assert len(regions) == 1
        r = regions[0]
        assert r["count"] == 25
        assert r["diameter_mm"] == pytest.approx(3.0, abs=0.05)
        assert r["pitch_x_mm"] == pytest.approx(10.0, abs=0.1)
        assert r["pitch_y_mm"] == pytest.approx(10.0, abs=0.1)
        assert r["pattern_rows"] == 5
        assert r["pattern_cols"] == 5
        assert len(r["occurrences"]) == 25

    def test_near_tolerance_jittered_grid_still_resolves(self):
        """Real manufactured perforation patterns are not laser-perfect --
        small pitch jitter (well under GRID_AXIS_TOLERANCE_FRACTION of the
        pitch) must still resolve a real grid, not silently degrade to
        pitch=None."""
        entries = _grid(diameter_mm=4.0, rows=6, cols=6, pitch_x=8.0, pitch_y=8.0, jitter=0.3)
        regions = detect_perforation_patterns(entries)
        assert len(regions) == 1
        assert regions[0]["count"] == 36
        assert regions[0]["pitch_x_mm"] == pytest.approx(8.0, abs=0.5)
        assert regions[0]["pattern_rows"] == 6
        assert regions[0]["pattern_cols"] == 6


class TestNegativeDetection:
    def test_below_threshold_grid_is_not_flagged(self):
        """19 holes (one under the real MIN_PATTERN_HOLES=20 threshold) must
        NOT be reported as a perforation region -- false positives are worse
        than an honest miss."""
        assert MIN_PATTERN_HOLES == 20
        entries = _grid(diameter_mm=3.0, rows=1, cols=19, pitch_x=10.0, pitch_y=10.0)
        regions = detect_perforation_patterns(entries)
        assert regions == []

    def test_scattered_same_diameter_holes_are_not_flagged(self):
        """25 same-diameter holes that are each far from every other (no
        real 'nearby' cluster) must NOT be reported -- this is the exact
        case the two real sourced thresholds exist to reject: an incidental
        common bolt size used all over an unrelated part, not a deliberate
        perforated region."""
        entries = [_hole(3.0, cx=i * 500.0, cy=0.0) for i in range(25)]
        regions = detect_perforation_patterns(entries)
        assert regions == []

    def test_small_mounting_hole_cluster_is_not_flagged(self):
        """A tight 3-hole same-diameter mounting pattern (genuinely 'nearby'
        to each other, satisfying MIN_NEARBY_HOLES) must still NOT be
        flagged -- it never reaches the real 20-hole total threshold, so a
        small legitimate mounting pattern is never misread as perforation."""
        assert MIN_NEARBY_HOLES == 2
        entries = [_hole(3.0, cx=0.0, cy=0.0), _hole(3.0, cx=10.0, cy=0.0), _hole(3.0, cx=0.0, cy=10.0)]
        regions = detect_perforation_patterns(entries)
        assert regions == []

    def test_empty_input_returns_empty(self):
        assert detect_perforation_patterns([]) == []


class TestMultipleInstances:
    def test_two_separate_regions_of_different_diameters_both_detected(self):
        """Two distinct perforated regions (different diameters, far apart)
        on the same part must both be reported as separate regions, not
        merged or only the first found."""
        region_a = _grid(diameter_mm=3.0, rows=5, cols=5, pitch_x=10.0, pitch_y=10.0, origin=(0.0, 0.0))
        region_b = _grid(diameter_mm=5.0, rows=5, cols=6, pitch_x=12.0, pitch_y=12.0, origin=(2000.0, 2000.0))
        regions = detect_perforation_patterns(region_a + region_b)
        assert len(regions) == 2
        diameters = sorted(r["diameter_mm"] for r in regions)
        assert diameters == [3.0, 5.0]
        counts = sorted(r["count"] for r in regions)
        assert counts == [25, 30]


class TestOrientedInstances:
    def test_rotated_grid_is_still_detected_but_pitch_is_honestly_none(self):
        """A grid rotated 30deg in-plane is still a real perforated region
        (count/diameter/occurrences must be correct) but this v1 grid
        resolver only recognizes axis-aligned rectangles -- pitch/rows/cols
        must be honestly None, never a fabricated value from mis-clustered
        rotated coordinates."""
        entries = _grid(diameter_mm=3.0, rows=5, cols=5, pitch_x=10.0, pitch_y=10.0, angle_deg=30.0)
        regions = detect_perforation_patterns(entries)
        assert len(regions) == 1
        assert regions[0]["count"] == 25
        assert regions[0]["pitch_x_mm"] is None
        assert regions[0]["pitch_y_mm"] is None
        assert regions[0]["pattern_rows"] is None
        assert regions[0]["pattern_cols"] is None


class TestSimilarButDifferentGeometry:
    def test_isolated_same_diameter_hole_is_excluded_from_a_real_region(self):
        """One extra same-diameter hole far from a real grid must NOT be
        absorbed into the region's count/occurrences -- it is a different,
        unrelated physical feature that happens to share a diameter."""
        entries = _grid(diameter_mm=3.0, rows=5, cols=5, pitch_x=10.0, pitch_y=10.0)
        entries.append(_hole(3.0, cx=5000.0, cy=5000.0))  # far away, same diameter
        regions = detect_perforation_patterns(entries)
        assert len(regions) == 1
        assert regions[0]["count"] == 25  # the isolated hole is excluded, not a 26th member


class TestDuplicateSuppressionAndFaceIds:
    def test_merged_face_ids_from_dedup_survive_into_occurrences(self):
        """A hole entry carrying dedup's 12th tuple element (merged
        face_idxs from a STEP-seam-split hole) must surface ALL of those
        real face ids in its occurrence, not just the representative's."""
        entries = _grid(diameter_mm=3.0, rows=5, cols=5, pitch_x=10.0, pitch_y=10.0)
        # Replace one entry with a deduped-shape tuple (merged_face_idxs at index 11).
        r, az, cx, cy, cz, ax, ay, azv, fidx, vr, ur = entries[0]
        entries[0] = (r, az, cx, cy, cz, ax, ay, azv, fidx, vr, ur, (fidx, 999))
        regions = detect_perforation_patterns(entries)
        assert len(regions) == 1
        occ = next(o for o in regions[0]["occurrences"] if o["centroid"] == [round(cx, 2), round(cy, 2), round(cz, 2)])
        assert set(occ["face_ids"]) == {entries[0][8], 999}


class TestPerformanceCap:
    def test_oversized_diameter_group_is_skipped_honestly_not_crashed(self):
        """A pathological same-diameter hole population beyond
        MAX_HOLES_PER_DIAMETER_GROUP must be skipped (no region, no crash,
        no multi-second O(n^2) stall) -- an honest capacity limit, not a
        fabricated result."""
        entries = [_hole(3.0, cx=float(i), cy=0.0) for i in range(MAX_HOLES_PER_DIAMETER_GROUP + 1)]
        regions = detect_perforation_patterns(entries)
        assert regions == []


# ── Integration: real OCC geometry end-to-end ──────────────────────────────

pytest.importorskip("OCC")

from sheet_metal.feature_extractor import SheetMetalFeatureExtractor  # noqa: E402  (after importorskip)


def _scan_cylinders_and_bbox(shape):
    """Minimal real-OCC face walk producing the SAME raw_cylinders_full
    11-tuple shape and bbox_minmax dict memory_optimizer.py's
    _detect_holes_real builds in the real pipeline -- reproduced here (not
    imported) since _detect_holes_real lives on AdvancedCADMemoryOptimizer,
    which needs full app config to construct; this covers only the fields
    SheetMetalFeatureExtractor.extract() actually reads."""
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.GeomAbs import GeomAbs_Cylinder  # type: ignore
    from OCC.Core.Bnd import Bnd_Box  # type: ignore
    from OCC.Core.BRepBndLib import brepbndlib  # type: ignore

    raw_cylinders_full = []
    face_index = 0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = topods.Face(exp.Current())
        adaptor = BRepAdaptor_Surface(face)
        if adaptor.GetType() == GeomAbs_Cylinder:
            cyl = adaptor.Cylinder()
            radius = cyl.Radius()
            axis = cyl.Axis()
            axis_dir = axis.Direction()
            axis_loc = axis.Location()
            axis_z = abs(float(axis_dir.Z()))
            v_start, v_end = adaptor.FirstVParameter(), adaptor.LastVParameter()
            v_mid = (v_start + v_end) / 2
            v_range = abs(v_end - v_start)
            u_range_rad = abs(adaptor.LastUParameter() - adaptor.FirstUParameter())
            face_cx = float(axis_loc.X()) + v_mid * float(axis_dir.X())
            face_cy = float(axis_loc.Y()) + v_mid * float(axis_dir.Y())
            face_cz = float(axis_loc.Z()) + v_mid * float(axis_dir.Z())
            raw_cylinders_full.append((
                round(radius, 3), axis_z,
                round(face_cx, 2), round(face_cy, 2), round(face_cz, 2),
                round(float(axis_dir.X()), 4), round(float(axis_dir.Y()), 4), round(float(axis_dir.Z()), 4),
                face_index, round(v_range, 2), round(u_range_rad, 4),
            ))
        face_index += 1
        exp.Next()

    box = Bnd_Box()
    brepbndlib.Add(shape, box)
    xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
    bbox_minmax = {"xmin": xmin, "xmax": xmax, "ymin": ymin, "ymax": ymax, "zmin": zmin, "zmax": zmax}
    return raw_cylinders_full, bbox_minmax


def test_real_step_geometry_plate_with_hole_grid_end_to_end():
    """Build a real 200x200x2mm plate with a real 5x5 grid of 4mm holes cut
    via BRepAlgoAPI_Cut (real B-Rep, not synthetic tuples), run the full
    SheetMetalFeatureExtractor.extract() pipeline the same way
    memory_optimizer.py drives it (real raw_cylinders_full/bbox_minmax, not
    the STL-fallback path), and confirm the real extracted
    perforation_count/perforation_groups/feature_graph_v2 output."""
    from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # type: ignore
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # type: ignore
    from OCC.Core.gp import gp_Pnt, gp_Ax2, gp_Dir  # type: ignore

    thickness = 2.0
    box = BRepPrimAPI_MakeBox(200.0, 200.0, thickness).Shape()
    shape = box
    pitch = 20.0
    hole_r = 2.0
    expected_holes = 0
    for row in range(5):
        for col in range(5):
            cx = 40.0 + col * pitch
            cy = 40.0 + row * pitch
            axis = gp_Ax2(gp_Pnt(cx, cy, -1.0), gp_Dir(0, 0, 1))
            hole_solid = BRepPrimAPI_MakeCylinder(axis, hole_r, thickness + 2.0).Shape()
            shape = BRepAlgoAPI_Cut(shape, hole_solid).Shape()
            expected_holes += 1

    raw_cylinders_full, bbox_minmax = _scan_cylinders_and_bbox(shape)
    assert len(raw_cylinders_full) == expected_holes  # sanity: real scan found all 25 real cut cylinders

    extractor = SheetMetalFeatureExtractor()
    result = extractor.extract(
        shape, bbox_dims=[200.0, 200.0, thickness],
        raw_cylinders_full=raw_cylinders_full,
        bbox_minmax=bbox_minmax,
    )

    assert result["hole_count"] == expected_holes
    assert result["perforation_count"] == 1
    region = result["perforation_groups"][0]
    assert region["count"] == expected_holes
    assert region["diameter_mm"] == pytest.approx(hole_r * 2.0, abs=0.1)
    assert region["pitch_x_mm"] == pytest.approx(pitch, abs=0.5)
    assert region["pitch_y_mm"] == pytest.approx(pitch, abs=0.5)
    assert region["pattern_rows"] == 5
    assert region["pattern_cols"] == 5

    fgv2 = result["feature_graph_v2"]
    assert fgv2 is not None
    perforation_features = [f for f in fgv2["features"] if f["feature_type"] == "perforation"]
    assert len(perforation_features) == 1
    assert len(perforation_features[0]["occurrences"]) == expected_holes
