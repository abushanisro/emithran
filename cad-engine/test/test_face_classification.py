"""
Real-OCC regression tests for Phase 3 of the machining feature-extraction
plan: general milled-face surface classification (machining/
face_classification.py), covering PlanarFace / CurvedWall / CurvedSurface —
the single largest real coverage gap (41% of memory/machining/
operations_full__operations.csv's real rows).

Real B-Rep throughout, with real positive AND negative controls, per this
session's established discipline (see rolled_form.py/lance.py in
sheet_metal for the precedent this follows).

Confirmed, disclosed, pre-existing edge case surfaced while building these
fixtures (NOT a Phase 3 regression, not fixed here): when a boss is FUSED
onto a box's top face, the resulting shouldered/annular top region gets
classified "pocket" by the existing, unrelated _classify_prismatic
heuristic (any axis-parallel planar face that is not at the part's true
outer bbox extreme along that axis, and is not elongated enough for slot/
keyway, defaults to "pocket") rather than "PlanarFace" — a real, separate,
lower-priority gap in that pre-existing classifier's coarse heuristic. Not
in Phase 3's scope (face_classification.py only ever sees faces NOT already
claimed by another detector, and correctly excludes this one since it was
already claimed as "pocket").
"""
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse, BRepAlgoAPI_Cut
from OCC.Core.gp import gp_Pnt, gp_Dir, gp_Ax2

from machining.machining_feature_recognizer import MachiningFeatureRecognizer
from machining.face_classification import classify_and_group_milled_faces


def _recognize(shape):
    return MachiningFeatureRecognizer().recognize(shape, "milled")


def _by_type(tree, ftype, variant=None):
    return [f for f in tree.features if f.type == ftype and (variant is None or f.variant == variant)]


def test_plain_box_yields_six_distinct_planar_face_regions_not_one_blob():
    """The real regression the coplanarity fix closes: adjacency alone
    would merge a box's top/bottom/4 sides (all planar, all mutually
    adjacent via shared edges) into ONE meaningless region. Each real
    distinct plane must stay its own region."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    tree = _recognize(box)
    regions = _by_type(tree, "PlanarFace")

    assert len(regions) == 6, f"a plain box has 6 real distinct planes -- got {len(regions)}"
    areas = sorted(round(f.params["area_mm2"], 1) for f in regions)
    assert areas == [1000.0, 1000.0, 1200.0, 1200.0, 3000.0, 3000.0]
    for f in regions:
        assert len(f.face_ids) == 1
        assert "bbox" in f.params


def test_adjacent_but_non_coplanar_faces_stay_separate_even_though_they_touch():
    """Direct, targeted proof of the coplanarity requirement: two real
    adjacent (edge-sharing) faces on genuinely different planes (a box's
    top face and one of its side walls) must never merge."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    tree = _recognize(box)
    regions = _by_type(tree, "PlanarFace")
    face_id_sets = [set(f.face_ids) for f in regions]
    assert all(len(s) == 1 for s in face_id_sets), (
        "every region here must be a single real face -- any region with >1 "
        "face proves two non-coplanar adjacent faces were wrongly merged"
    )


def test_pocket_opening_leaves_one_correctly_holed_planar_region():
    """A real pocket cut into a box's top face: the top face remains ONE
    real connected region (a single face with an inner wire boundary), with
    its real area correctly reduced by the opening -- not split, not
    inflated."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    tool = BRepPrimAPI_MakeBox(gp_Pnt(20.0, 17.5, 12.0), 20.0, 15.0, 8.0).Shape()
    part = BRepAlgoAPI_Cut(box, tool).Shape()
    tree = _recognize(part)

    regions = _by_type(tree, "PlanarFace")
    top_region = [f for f in regions if abs(f.params["centroid"][2] - 20.0) < 0.01]
    assert len(top_region) == 1
    assert top_region[0].params["area_mm2"] == 3000.0 - (20.0 * 15.0)

    # The pocket's own 4 real vertical walls must ALSO appear as their own
    # distinct planar_face regions (real, unclaimed geometry) -- not folded
    # into the outer shell, not dropped.
    assert len(regions) == 6 + 4  # 6 outer faces (minus the claimed floor) + 4 real walls
    # The claimed floor itself must never double-appear as a planar_face.
    pocket_floor_ids = set(_by_type(tree, "PocketV2")[0].face_ids)
    for f in regions:
        assert not (set(f.face_ids) & pocket_floor_ids)


def test_real_cylindrical_boss_is_classified_curved_wall_with_real_area():
    """Positive control: a real cylindrical boss fused onto a box produces
    a genuine curved_wall region (its lateral surface) distinct from the
    box's own planar faces, with a real, correctly-computed lateral area
    (2*pi*r*h)."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    ax = gp_Ax2(gp_Pnt(30.0, 25.0, 20.0), gp_Dir(0, 0, 1))
    boss = BRepPrimAPI_MakeCylinder(ax, 10.0, 15.0).Shape()
    part = BRepAlgoAPI_Fuse(box, boss).Shape()
    tree = _recognize(part)

    walls = _by_type(tree, "CurvedWall")
    assert len(walls) == 1
    w = walls[0]
    import math
    expected_lateral_area = 2 * math.pi * 10.0 * 15.0
    assert abs(w.params["area_mm2"] - expected_lateral_area) < 0.5
    assert len(w.face_ids) == 1

    # The boss's own flat top cap is a real, separate planar_face region.
    caps = [f for f in _by_type(tree, "PlanarFace") if abs(f.params["area_mm2"] - math.pi * 10.0 ** 2) < 0.5]
    assert len(caps) == 1


def test_a_hole_wall_is_never_double_counted_as_a_curved_wall_region():
    """The real exclusion this module exists to respect: a drilled hole's
    own cylindrical bore wall is already claimed by the discrete hole
    detector -- it must never also appear as a generic curved_wall."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    ax = gp_Ax2(gp_Pnt(30.0, 25.0, 20.0), gp_Dir(0, 0, -1))
    drill = BRepPrimAPI_MakeCylinder(ax, 5.0, 20.0).Shape()
    part = BRepAlgoAPI_Cut(box, drill).Shape()
    tree = _recognize(part)

    hole_face_ids = set()
    for f in tree.features:
        if f.type == "SimpleHole" and f.variant in ("through", "blind", "threaded"):
            hole_face_ids.update(f.face_ids)
    assert hole_face_ids, "fixture must actually produce a real detected hole"

    for f in _by_type(tree, "CurvedWall"):
        assert not (set(f.face_ids) & hole_face_ids)


def test_no_false_positive_regions_when_every_face_is_already_claimed():
    """Direct unit-level negative control on face_classification.py itself:
    if every real face is passed in as already claimed, zero regions must
    be produced -- no fallback, no fabricated leftover region."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    regions = classify_and_group_milled_faces(box, claimed_face_ids={0, 1, 2, 3, 4, 5})
    assert regions == []
