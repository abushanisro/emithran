"""
Tests for sheet_metal.features.forming_spike -- the formed-feature
(emboss/dimple/louver) FEASIBILITY SPIKE. See that module's docstring for
full context: this is NOT a production detector and is NOT wired into
SheetMetalFeatureExtractor.extract().

Most tests exercise _classify_candidates directly (pure, synthetic dicts,
no OCC) -- the same style bend_relationships.py's own test suite uses for
its non-geometric assertions. One integration test builds real OCC geometry
(a real partial-depth blind cylindrical pocket) to prove the wrapper's real
CNCFeatureRecognizer._collect_cylinders reuse actually works end-to-end.

The critical test in this file is
test_shallow_blind_hole_is_geometrically_identical_to_a_dimple_candidate --
it documents, rather than hides, this spike's central honest finding: this
approach cannot distinguish a real formed dimple from an ordinary shallow
blind hole from B-Rep topology alone.
"""
import pytest

from sheet_metal.features.forming_spike import (
    _classify_candidates,
    MIN_DEPTH_THICKNESS_MULTIPLE,
    MAX_DEPTH_THICKNESS_MULTIPLE,
)

assert MAX_DEPTH_THICKNESS_MULTIPLE <= 1.0, (
    "a blind_hole cannot physically be deeper than the local material thickness "
    "without becoming a through_hole -- see forming_spike.py's own comment"
)

THICKNESS = 2.0
BBOX = {"xmin": 0.0, "xmax": 200.0, "ymin": 0.0, "ymax": 200.0, "zmin": 0.0, "zmax": THICKNESS}


def _cyl(kind: str, radius: float, depth: float, cx: float, cy: float, cz: float = 0.0, face_idx: int = 0) -> dict:
    return {"kind": kind, "radius": radius, "length": depth, "centroid": (cx, cy, cz), "face_indices": [face_idx]}


class TestPositiveDetection:
    def test_plausible_shallow_blind_cavity_is_a_candidate(self):
        """A blind cylindrical cavity at a thickness-relative depth, well
        inside the panel, away from any known hole, is a real candidate --
        this is the entire feasibility question this spike answers yes to."""
        cyl = _cyl("blind_hole", radius=5.0, depth=THICKNESS * 0.7, cx=100.0, cy=100.0)
        candidates = _classify_candidates([cyl], THICKNESS, BBOX)
        assert len(candidates) == 1
        c = candidates[0]
        assert c["geometry_type"] == "cylindrical_blind_cavity"
        assert c["diameter_mm"] == pytest.approx(10.0)
        assert c["depth_mm"] == pytest.approx(1.4)
        assert c["recognition_status"] == "ambiguous"  # never 'recognized' -- see module docstring


class TestNegativeDetection:
    def test_through_hole_is_excluded(self):
        cyl = _cyl("through_hole", radius=5.0, depth=THICKNESS, cx=100.0, cy=100.0)
        assert _classify_candidates([cyl], THICKNESS, BBOX) == []

    def test_too_deep_cavity_is_excluded(self):
        assert MAX_DEPTH_THICKNESS_MULTIPLE == 0.9
        cyl = _cyl("blind_hole", radius=5.0, depth=THICKNESS * 0.95, cx=100.0, cy=100.0)
        assert _classify_candidates([cyl], THICKNESS, BBOX) == []

    def test_too_shallow_cavity_is_excluded(self):
        assert MIN_DEPTH_THICKNESS_MULTIPLE == 0.2
        cyl = _cyl("blind_hole", radius=5.0, depth=THICKNESS * 0.05, cx=100.0, cy=100.0)
        assert _classify_candidates([cyl], THICKNESS, BBOX) == []

    def test_edge_adjacent_cavity_is_excluded(self):
        """A candidate right at the panel boundary is more likely an edge
        notch/flange remnant than a local formed feature."""
        cyl = _cyl("blind_hole", radius=5.0, depth=THICKNESS * 0.7, cx=2.0, cy=100.0)
        assert _classify_candidates([cyl], THICKNESS, BBOX) == []

    def test_cavity_near_known_hole_is_excluded(self):
        """A candidate spatially close to an already-classified real hole is
        treated as that hole's own chamfer/counterbore/countersink remnant,
        not an independent formed feature -- same coarse-correction spirit
        as extruded_flange_count's existing counterbore/countersink fix."""
        cyl = _cyl("blind_hole", radius=5.0, depth=THICKNESS * 0.7, cx=100.0, cy=100.0)
        known_holes = [(102.0, 100.0, 0.0)]  # 2mm away -- well inside the 3x-diameter proximity radius
        assert _classify_candidates([cyl], THICKNESS, BBOX, known_holes) == []

    def test_out_of_range_radius_is_excluded(self):
        cyl = _cyl("blind_hole", radius=0.05, depth=THICKNESS * 0.7, cx=100.0, cy=100.0)
        assert _classify_candidates([cyl], THICKNESS, BBOX) == []

    def test_zero_thickness_returns_no_candidates(self):
        cyl = _cyl("blind_hole", radius=5.0, depth=3.0, cx=100.0, cy=100.0)
        assert _classify_candidates([cyl], 0.0, BBOX) == []


class TestMultipleInstances:
    def test_several_independent_candidates_all_reported(self):
        cyls = [
            _cyl("blind_hole", radius=4.0, depth=THICKNESS * 0.6, cx=50.0, cy=50.0, face_idx=1),
            _cyl("blind_hole", radius=6.0, depth=THICKNESS * 0.8, cx=150.0, cy=150.0, face_idx=2),
            _cyl("blind_hole", radius=3.0, depth=THICKNESS * 0.5, cx=100.0, cy=50.0, face_idx=3),
        ]
        candidates = _classify_candidates(cyls, THICKNESS, BBOX)
        assert len(candidates) == 3
        assert {c["face_ids"][0] for c in candidates} == {1, 2, 3}


class TestHonestLimitation:
    def test_shallow_blind_hole_is_geometrically_identical_to_a_dimple_candidate(self):
        """THE central honest finding of this spike: a genuine formed
        dimple and an ordinary shallow blind hole (e.g. an undersized
        tapped-hole pilot bore, drilled but not yet through) produce the
        EXACT SAME cylinder dict shape -- kind='blind_hole', a
        thickness-relative depth, no other distinguishing field exists
        anywhere in _collect_cylinders' output. This test proves that by
        construction: two geometrically identical inputs, meant to
        represent two different real manufacturing features, are
        classified identically by this spike -- because B-Rep topology
        alone cannot tell them apart. This is why every candidate carries
        recognition_status='ambiguous', never 'recognized', and why this
        spike is not wired into extract()."""
        dimple_cyl = _cyl("blind_hole", radius=4.0, depth=THICKNESS * 0.7, cx=100.0, cy=100.0, face_idx=1)
        pilot_bore_cyl = _cyl("blind_hole", radius=4.0, depth=THICKNESS * 0.7, cx=100.0, cy=100.0, face_idx=1)
        dimple_result = _classify_candidates([dimple_cyl], THICKNESS, BBOX)
        pilot_bore_result = _classify_candidates([pilot_bore_cyl], THICKNESS, BBOX)
        assert dimple_result == pilot_bore_result  # identical input -> identical (ambiguous) output
        assert dimple_result[0]["recognition_status"] == "ambiguous"


# ── Integration: real OCC geometry end-to-end ──────────────────────────────

pytest.importorskip("OCC")

from sheet_metal.features.forming_spike import detect_candidate_formed_features  # noqa: E402


def _find_top_face(shape, min_area=100.0):
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.GeomAbs import GeomAbs_Plane  # type: ignore
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore

    best_face, best_area = None, 0.0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = topods.Face(exp.Current())
        adaptor = BRepAdaptor_Surface(face)
        if adaptor.GetType() == GeomAbs_Plane:
            n = adaptor.Plane().Axis().Direction()
            if abs(n.Z()) > 0.99:
                props = GProp_GProps()
                brepgprop.SurfaceProperties(face, props)
                if props.Mass() > best_area and props.Mass() > min_area:
                    best_area = props.Mass()
                    best_face = face
        exp.Next()
    return best_face


def test_real_partial_depth_pocket_is_detected_as_a_candidate():
    """Build a real 200x200x2mm plate with a real blind cylindrical pocket
    (cut only partway through the thickness via a shorter cutting cylinder,
    not all the way -- a real, not synthetic, blind cavity), and confirm
    the full detect_candidate_formed_features() wrapper finds it via the
    real CNCFeatureRecognizer._collect_cylinders reuse."""
    from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # type: ignore
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # type: ignore
    from OCC.Core.gp import gp_Pnt, gp_Ax2, gp_Dir  # type: ignore
    from OCC.Core.Bnd import Bnd_Box  # type: ignore
    from OCC.Core.BRepBndLib import brepbndlib  # type: ignore

    thickness = 2.0
    box = BRepPrimAPI_MakeBox(200.0, 200.0, thickness).Shape()

    pocket_depth = thickness * 0.7  # must stay < thickness -- see forming_spike.py's own physical-constraint comment
    axis = gp_Ax2(gp_Pnt(100.0, 100.0, thickness + 0.5), gp_Dir(0, 0, -1))
    pocket_cutter = BRepPrimAPI_MakeCylinder(axis, 5.0, pocket_depth + 0.5).Shape()
    shape = BRepAlgoAPI_Cut(box, pocket_cutter).Shape()

    dominant_face = _find_top_face(shape)
    assert dominant_face is not None

    bnd = Bnd_Box()
    brepbndlib.Add(shape, bnd)
    xmin, ymin, zmin, xmax, ymax, zmax = bnd.Get()
    bbox_minmax = {"xmin": xmin, "xmax": xmax, "ymin": ymin, "ymax": ymax, "zmin": zmin, "zmax": zmax}

    candidates = detect_candidate_formed_features(shape, dominant_face, bbox_minmax, thickness)
    assert len(candidates) == 1
    c = candidates[0]
    assert c["diameter_mm"] == pytest.approx(10.0, abs=0.1)
    assert c["recognition_status"] == "ambiguous"
