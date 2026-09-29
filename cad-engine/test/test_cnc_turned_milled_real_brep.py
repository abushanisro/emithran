"""
Phase 2 real-B-Rep regression coverage for MachiningFeatureRecognizer's existing
detectors (machining_feature_recognizer.py), per the machining feature-extraction
plan: real OCC geometry throughout, not synthetic dicts (see
test_cnc_feature_graph.py's own header for what these tests deliberately do
NOT replace -- that file's synthetic-dict coverage of the
build_machining_feature_graph_v2 synthesis layer stays valid and complementary).

Every fixture here is a real, hand-verified OCC solid (BRepPrimAPI +
BRepAlgoAPI booleans); expected feature counts/dimensions were confirmed by
running each fixture through the real recognizer before being locked into
assertions, not guessed. Real face_ids are asserted non-empty everywhere a
feature is checked, proving 3D-highlight data is actually produced.

Known, disclosed gap surfaced while building this file (not fixed here --
see the machining feature-extraction plan for the full writeup): a
perpendicular-to-axis floor face (the real shape of a genuine "slot" on a
milled part or Slot/radial on a turned part) never reaches
_collect_prismatic_pockets' classification step at all -- that collector's
own axis-alignment prefilter (dot_with_axis > 0.85) only ever admits
axis-PARALLEL floor faces, so 'slot' (milled) and 'radial_slot' (turned) are
effectively unreachable given the current collection filter, regardless of
real geometry. Confirmed directly: a real full-height side notch on a milled
box, and a real radial notch cut into a turned shaft's OD, both produce zero
prismatic features. Not attempted here -- fixing it means broadening the
collector to also gather perpendicular-normal candidates, which needs the
same real containment/adjacency work Phase 3's face classification already
requires, not a Phase 2 test-writing patch.
"""
import math

from OCC.Core.BRepPrimAPI import (
    BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeCone,
)
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse, BRepAlgoAPI_Cut
from OCC.Core.gp import gp_Pnt, gp_Dir, gp_Ax2
from OCC.Core.ShapeUpgrade import ShapeUpgrade_UnifySameDomain

from machining.machining_feature_recognizer import MachiningFeatureRecognizer
from machining.feature_models import MachiningFeatureTree, MachiningFeature


def test_recognize_returns_machining_feature_tree_of_machining_features():
    """A 3D upload's recognize() call must produce MachiningFeatureTree /
    MachiningFeature instances directly."""
    tree = MachiningFeatureRecognizer().recognize(_shaft_with_tapped_hole(), "turned")
    assert isinstance(tree, MachiningFeatureTree)
    assert tree.features, "a real fixture with a tapped hole must yield at least one feature"
    for f in tree.features:
        assert isinstance(f, MachiningFeature)


def _unify(shape):
    u = ShapeUpgrade_UnifySameDomain(shape, True, True, True)
    u.Build()
    return u.Shape()


def _recognize(shape, family):
    return MachiningFeatureRecognizer().recognize(shape, family)


def _by_type(tree, ftype, variant=None):
    return [f for f in tree.features if f.type == ftype and (variant is None or f.variant == variant)]


# ── Turned-path fixtures ──────────────────────────────────────────────────


def _stepped_shaft_with_holes():
    """OD1 (D40, z0-40) fused to OD2 (D25, z40-80); a coaxial blind hole
    (D6, depth 20) from the top; a radial cross hole (D5) through OD2,
    axially clear of the blind hole's floor."""
    cyl_a = BRepPrimAPI_MakeCylinder(20.0, 40.0).Shape()
    ax_b = gp_Ax2(gp_Pnt(0, 0, 40.0), gp_Dir(0, 0, 1))
    cyl_b = BRepPrimAPI_MakeCylinder(ax_b, 12.5, 40.0).Shape()
    body = _unify(BRepAlgoAPI_Fuse(cyl_a, cyl_b).Shape())

    drill_ax = gp_Ax2(gp_Pnt(0, 0, 60.0), gp_Dir(0, 0, -1))
    drill = BRepPrimAPI_MakeCylinder(drill_ax, 3.0, 20.0).Shape()
    body = BRepAlgoAPI_Cut(body, drill).Shape()

    cross_ax = gp_Ax2(gp_Pnt(-15.0, 0, 50.0), gp_Dir(1, 0, 0))
    cross = BRepPrimAPI_MakeCylinder(cross_ax, 2.5, 30.0).Shape()
    body = BRepAlgoAPI_Cut(body, cross).Shape()
    return _unify(body)


def _sleeve_through_bore():
    outer = BRepPrimAPI_MakeCylinder(15.0, 50.0).Shape()
    bore = BRepPrimAPI_MakeCylinder(10.0, 60.0).Shape()
    return BRepAlgoAPI_Cut(outer, bore).Shape()


def _shaft_with_tapped_hole():
    body = BRepPrimAPI_MakeCylinder(15.0, 40.0).Shape()
    ax = gp_Ax2(gp_Pnt(0, 0, 40.0), gp_Dir(0, 0, -1))
    drill = BRepPrimAPI_MakeCylinder(ax, 2.5, 15.0).Shape()  # D=5.0mm -> M6x1.0
    return BRepAlgoAPI_Cut(body, drill).Shape()


def _shaft_with_counterbore():
    body = BRepPrimAPI_MakeCylinder(15.0, 40.0).Shape()
    ax_wide = gp_Ax2(gp_Pnt(0, 0, 40.0), gp_Dir(0, 0, -1))
    wide = BRepPrimAPI_MakeCylinder(ax_wide, 8.0, 8.0).Shape()
    ax_narrow = gp_Ax2(gp_Pnt(0, 0, 40.0), gp_Dir(0, 0, -1))
    narrow = BRepPrimAPI_MakeCylinder(ax_narrow, 4.0, 20.0).Shape()
    tool = BRepAlgoAPI_Fuse(wide, narrow).Shape()
    return BRepAlgoAPI_Cut(body, tool).Shape()


def _shaft_with_countersink():
    body = BRepPrimAPI_MakeCylinder(15.0, 40.0).Shape()
    ax_cone = gp_Ax2(gp_Pnt(0, 0, 40.0), gp_Dir(0, 0, -1))
    cone = BRepPrimAPI_MakeCone(ax_cone, 8.0, 4.0, 4.0).Shape()
    ax_bore = gp_Ax2(gp_Pnt(0, 0, 36.0), gp_Dir(0, 0, -1))
    bore = BRepPrimAPI_MakeCylinder(ax_bore, 4.0, 16.0).Shape()
    tool = BRepAlgoAPI_Fuse(cone, bore).Shape()
    return BRepAlgoAPI_Cut(body, tool).Shape()


def _shaft_with_chamfer():
    from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeChamfer
    from OCC.Core.BRepAdaptor import BRepAdaptor_Curve
    from OCC.Core.GeomAbs import GeomAbs_Circle
    from OCC.Core.TopExp import TopExp_Explorer
    from OCC.Core.TopAbs import TopAbs_EDGE
    from OCC.Core.TopoDS import topods

    body = BRepPrimAPI_MakeCylinder(15.0, 40.0).Shape()
    mk = BRepFilletAPI_MakeChamfer(body)
    exp = TopExp_Explorer(body, TopAbs_EDGE)
    target = None
    while exp.More():
        e = topods.Edge(exp.Current())
        c = BRepAdaptor_Curve(e)
        if c.GetType() == GeomAbs_Circle and abs(c.Circle().Location().Z() - 40.0) < 0.01:
            target = e
            break
        exp.Next()
    assert target is not None, "fixture itself is broken -- no top circular edge found"
    mk.Add(3.0, target)
    mk.Build()
    assert mk.IsDone()
    return mk.Shape()


def _flange_with_pcd_bolt_holes(n=4, pcd_radius=20.0, hole_r=2.5):
    body = BRepPrimAPI_MakeCylinder(30.0, 15.0).Shape()
    tools = []
    for i in range(n):
        ang = 2 * math.pi * i / n
        x, y = pcd_radius * math.cos(ang), pcd_radius * math.sin(ang)
        ax = gp_Ax2(gp_Pnt(x, y, 15.0), gp_Dir(0, 0, -1))
        tools.append(BRepPrimAPI_MakeCylinder(ax, hole_r, 20.0).Shape())
    tool = tools[0]
    for t in tools[1:]:
        tool = BRepAlgoAPI_Fuse(tool, t).Shape()
    return BRepAlgoAPI_Cut(body, tool).Shape()


# ── Turned-path tests ─────────────────────────────────────────────────────


def test_stepped_shaft_yields_two_real_external_diameters():
    tree = _recognize(_stepped_shaft_with_holes(), "turned")
    ods = _by_type(tree, "Ring", "outer_diameter")
    diams = sorted(round(f.params["diameter_mm"]) for f in ods)
    assert diams == [25, 40]
    for f in ods:
        assert f.face_ids


def test_stepped_shaft_yields_real_blind_hole_not_tapped():
    tree = _recognize(_stepped_shaft_with_holes(), "turned")
    blinds = _by_type(tree, "SimpleHole", "blind")
    assert len(blinds) == 1
    f = blinds[0]
    assert f.params["diameter_mm"] == 6.0
    assert f.params["depth_mm"] == 20.0
    assert "spec" not in f.params  # 6.0mm is not a real tap-drill diameter
    assert f.face_ids


def test_stepped_shaft_yields_real_cross_hole():
    tree = _recognize(_stepped_shaft_with_holes(), "turned")
    crosses = _by_type(tree, "SimpleHole", "cross")
    assert len(crosses) >= 1, "real radial through-hole must be detected"
    for f in crosses:
        assert f.params["diameter_mm"] == 5.0
        assert f.face_ids


def test_sleeve_yields_real_through_hole():
    tree = _recognize(_sleeve_through_bore(), "turned")
    throughs = _by_type(tree, "SimpleHole", "through")
    assert len(throughs) == 1
    f = throughs[0]
    assert f.params["diameter_mm"] == 20.0
    assert f.params["depth_mm"] == 50.0
    assert f.face_ids
    ods = _by_type(tree, "Ring", "outer_diameter")
    assert len(ods) == 1 and ods[0].params["diameter_mm"] == 30.0


def test_real_tap_drill_diameter_yields_tapped_hole_with_correct_spec():
    tree = _recognize(_shaft_with_tapped_hole(), "turned")
    tapped = _by_type(tree, "SimpleHole", "threaded")
    assert len(tapped) == 1
    f = tapped[0]
    assert f.params["diameter_mm"] == 5.0
    assert f.params["spec"] == "M6×1.0"
    assert f.face_ids


def test_real_coaxial_stepped_bore_yields_counterbore_with_correct_dims():
    tree = _recognize(_shaft_with_counterbore(), "turned")
    cbores = _by_type(tree, "MultiStepHole", "counterbore")
    assert len(cbores) == 1
    f = cbores[0]
    assert f.params["counterbore_diameter_mm"] == 16.0
    assert f.params["bore_diameter_mm"] == 8.0
    assert f.params["counterbore_depth_mm"] < f.params["bore_depth_mm"]
    assert len(f.face_ids) >= 2  # union of both real constituent bore faces


def test_real_cone_over_coaxial_bore_yields_countersink_plus_its_own_bore():
    """A countersink is genuinely two real operations (conical entry +
    straight bore) -- both must survive as distinct, correctly-typed
    features, not merged or dropped."""
    tree = _recognize(_shaft_with_countersink(), "turned")
    csinks = _by_type(tree, "Edge", "countersink")
    assert len(csinks) == 1
    cs = csinks[0]
    assert cs.params["entry_diameter_mm"] == 16.0
    assert cs.params["bore_diameter_mm"] == 8.0
    assert cs.params["half_angle_deg"] == 45.0
    assert cs.face_ids

    blinds = _by_type(tree, "SimpleHole", "blind")
    assert len(blinds) == 1
    assert blinds[0].params["diameter_mm"] == 8.0


def test_real_isolated_cone_with_no_coaxial_bore_yields_chamfer_not_countersink():
    tree = _recognize(_shaft_with_chamfer(), "turned")
    chamfers = _by_type(tree, "Edge", "chamfer")
    assert len(chamfers) == 1
    f = chamfers[0]
    assert f.params["half_angle_deg"] == 45.0
    assert f.face_ids
    assert _by_type(tree, "Edge", "countersink") == []


def test_real_pcd_bolt_pattern_is_grouped_into_one_pattern_feature():
    tree = _recognize(_flange_with_pcd_bolt_holes(n=4, pcd_radius=20.0, hole_r=2.5), "turned")
    patterns = _by_type(tree, "SimpleHole", "pcd_pattern")
    assert len(patterns) == 1
    p = patterns[0]
    assert p.params["hole_count"] == 4
    assert p.params["pcd_mm"] == 40.0
    assert p.params["hole_diameter_mm"] == 5.0
    # 4 real constituent holes' faces, unioned
    assert len(p.face_ids) >= 4
    # Individual bores must be absorbed, not double-counted as separate holes
    assert _by_type(tree, "SimpleHole", "threaded") == []
    assert _by_type(tree, "SimpleHole", "blind") == []


# ── Milled-path fixtures + tests ──────────────────────────────────────────


def _box_with_pocket():
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    tool = BRepPrimAPI_MakeBox(gp_Pnt(20.0, 17.5, 12.0), 20.0, 15.0, 8.0).Shape()
    return BRepAlgoAPI_Cut(box, tool).Shape()


def _box_with_bounded_recess():
    """A rectangular recess elongated in-plane, bounded on all 4 in-plane
    sides and by the box's own top/bottom -- the milled path's real,
    observed classification for this shape is 'keyway' (see this file's own
    module docstring for why 'slot' specifically is unreachable today)."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 40.0).Shape()
    tool = BRepPrimAPI_MakeBox(gp_Pnt(-1.0, 10.0, 14.0), 7.0, 30.0, 6.0).Shape()
    return BRepAlgoAPI_Cut(box, tool).Shape()


def test_real_recessed_pocket_is_detected_and_boundary_faces_are_not():
    tree = _recognize(_box_with_pocket(), "milled")
    pockets = _by_type(tree, "PocketV2")
    assert len(pockets) == 1
    p = pockets[0]
    assert sorted([p.params["length_mm"], p.params["width_mm"]]) == [15.0, 20.0]
    assert p.params["centroid"][2] == 12.0  # inset from the box's own z=0/z=20 faces
    assert p.face_ids


def test_real_elongated_bounded_recess_is_detected_as_keyway():
    tree = _recognize(_box_with_bounded_recess(), "milled")
    keyways = _by_type(tree, "Keyway")
    assert len(keyways) >= 1, "a real elongated bounded recess must be detected"
    for f in keyways:
        assert f.params["length_mm"] == 30.0
        assert f.params["width_mm"] == 6.0
        assert f.face_ids
