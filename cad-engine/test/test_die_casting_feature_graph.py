"""
Real end-to-end test for Die Casting Phase 1 (detection + highlighting),
mirroring test_sheet_metal_feature_graph.py's shape: build one synthetic
cored-box solid combining a straight through-hole, a 3-step bore, a
side-action tunnel (needing a slide), and a filleted edge, run the REAL
production DieCastingFeatureExtractor().extract() (never mocked), and assert
the full feature_graph_v2 contract against the live, regenerated
reference vocabulary -- never a hardcoded expected-type list in this test.
"""
import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.TopAbs import TopAbs_EDGE
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.TopoDS import topods
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt

from die_casting.feature_extractor import DieCastingFeatureExtractor
from shared.feature_vocabulary import feature_types
from shared.machining_geometry import part_bounding_box


def _build_test_part():
    # Base box: 80(x) x 60(y) x 20(z) -- z is the shortest dimension, the
    # expected real pull axis.
    shape = BRepPrimAPI_MakeBox(80.0, 60.0, 20.0).Shape()

    # 1. Straight through-hole along the pull axis (z), far from the other features.
    through_axis = gp_Ax2(gp_Pnt(10.0, 10.0, -1.0), gp_Dir(0, 0, 1))
    through_cutter = BRepPrimAPI_MakeCylinder(through_axis, 3.0, 22.0).Shape()
    shape = BRepAlgoAPI_Cut(shape, through_cutter).Shape()

    # 2. A real 3-step coaxial bore (same proven construction as
    #    test_multistep_holes.py's _make_3step_tool -- same origin point,
    #    increasing depth, decreasing radius, fused before cutting).
    sx, sy, sz = 60.0, 15.0, 20.0
    ax1 = gp_Ax2(gp_Pnt(sx, sy, sz), gp_Dir(0, 0, -1))
    step1 = BRepPrimAPI_MakeCylinder(ax1, 5.0, 6.0).Shape()
    ax2 = gp_Ax2(gp_Pnt(sx, sy, sz), gp_Dir(0, 0, -1))
    step2 = BRepPrimAPI_MakeCylinder(ax2, 3.0, 12.0).Shape()
    ax3 = gp_Ax2(gp_Pnt(sx, sy, sz), gp_Dir(0, 0, -1))
    step3 = BRepPrimAPI_MakeCylinder(ax3, 1.5, 19.0).Shape()
    stepped_tool = BRepAlgoAPI_Fuse(BRepAlgoAPI_Fuse(step1, step2).Shape(), step3).Shape()
    shape = BRepAlgoAPI_Cut(shape, stepped_tool).Shape()

    # 3. A fully-enclosed horizontal tunnel (side-action undercut, needs a
    #    slide) -- sandwiched between real part material above (z 15..20) and
    #    below (z 0..5), well clear of the other two features.
    tunnel = BRepPrimAPI_MakeBox(gp_Pnt(30.0, -1.0, 5.0), 10.0, 62.0, 10.0).Shape()
    shape = BRepAlgoAPI_Cut(shape, tunnel).Shape()

    # 4. One filleted edge, away from the other features.
    maker = BRepFilletAPI_MakeFillet(shape)
    exp = TopExp_Explorer(shape, TopAbs_EDGE)
    edge = topods.Edge(exp.Current())
    maker.Add(2.0, edge)
    shape = maker.Shape()

    return shape


def test_real_cored_box_end_to_end_feature_graph_contract():
    shape = _build_test_part()
    bbox_dims = [80.0, 60.0, 20.0]
    bbox_minmax = part_bounding_box(shape)

    extractor = DieCastingFeatureExtractor()
    result = extractor.extract(shape, bbox_dims, bbox_minmax=bbox_minmax)

    # Real pull axis matches the geometry's own shortest dimension.
    assert result["primary_setup_axis"] is not None
    assert result["primary_setup_axis"][2] == pytest.approx(1.0, abs=0.01)

    fg = result["feature_graph_v2"]
    stable_ids = fg["metadata"]["stable_face_ids"]
    assert len(stable_ids) > 0
    assert all(isinstance(v, str) and len(v) == 16 for v in stable_ids.values())

    die_casting_types = feature_types("die_casting")
    for entry in fg["features"]:
        assert entry["feature_type"] in die_casting_types
        for occ in entry["occurrences"]:
            assert occ["source_face_stable_ids"] == [
                stable_ids.get(fid) for fid in occ.get("face_ids", []) or []
            ]
            # Every occurrence that names faces has a measured nominal size
            # (ISO 286 grading), no larger than the part itself.
            if occ.get("face_ids"):
                assert 0 < occ["extent_mm"] <= 80.0 * 1.01
            if entry["feature_type"] == "SimpleHole":
                ax = occ["axis"]
                assert abs(sum(v * v for v in ax) - 1.0) < 1e-4

    # The hardest features actually fire on geometry explicitly built to need them.
    assert result["multi_step_hole_count"] >= 1
    assert result["void_count"] >= 1
    assert result["slide_bundle_count"] >= 1
    bundle = next(e for e in fg["features"] if e["feature_type"] == "SlideBundle")["occurrences"][0]
    assert bundle["face_ids"] and bundle["extent_mm"] > 0
    assert result["simple_hole_count"] >= 1  # the straight through-hole

    # The tunnel is the one region no die half reaches: one core, 10 x 60 x 10 mm
    # of air (the part is 60 wide; the tunnel cutter overhangs it).
    assert result["core_count"] == 1
    core = result["cores"][0]
    h = result["core_grid"]["cell_mm"]
    assert (10 - h) * 60 * 10 <= core["volume_mm3"] <= (10 + h) * (60 + h) * 10

    # Face-ownership invariant: no face is both a recognized feature AND
    # reported as unsupported.
    recognized_face_ids = {
        fid
        for entry in fg["features"] if entry["feature_type"] != "NotSupported"
        for occ in entry["occurrences"]
        for fid in occ.get("face_ids", []) or []
    }
    assert recognized_face_ids.isdisjoint(set(result["not_supported_face_ids"]))


def test_same_part_is_validated_against_each_casting_process_own_catalog():
    """Die casting slides an undercut (SlideBundle); sand casting cores it, so
    its catalog has no SlideBundle and none is emitted. Investment casting's
    catalog does define it."""
    from die_casting.feature_extractor import DieCastingFeatureExtractor
    shape = _build_test_part()
    bbox_minmax = part_bounding_box(shape)
    extractor = DieCastingFeatureExtractor()

    def types(domain):
        out = extractor.extract(shape, [80.0, 60.0, 20.0], bbox_minmax=bbox_minmax, domain=domain)
        return {f["feature_type"] for f in out["feature_graph_v2"]["features"]}, out

    die_types, _ = types("die_casting")
    sand_types, sand = types("sand_casting")
    inv_types, _ = types("investment_casting")

    assert "SlideBundle" in die_types
    assert "SlideBundle" not in sand_types
    assert "SlideBundle" in sand["omitted_feature_types"]
    assert sand["casting_domain"] == "sand_casting"
    assert "SlideBundle" in inv_types
    # Everything else the part has is common to all three catalogs.
    assert die_types - {"SlideBundle"} == sand_types
