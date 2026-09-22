"""
Real-OCC regression test for a confirmed pre-existing bug found while
building Phase 2 real-B-Rep coverage: _collect_prismatic_pockets included
a part's own outer boundary/end faces (top/bottom of a milled block, flat
end face of a turned shaft) as "pocket" candidates, because it only checked
that a face's normal was parallel to the main/datum axis -- exactly the
faces the turned-path classifier (_classify_prismatic_turned) already knew
to reject via its own "aspect < 2.5" structural-face guard, but the milled
path (_classify_prismatic) has no generic-pocket exclusion at all, so any
face that failed the keyway/slot checks fell through to a fabricated
"pocket" classification.

Root cause fix: _collect_prismatic_pockets now also excludes any candidate
face whose position along the main axis coincides (within
_STRUCTURAL_FACE_AXIS_TOL_MM) with the part's own bounding-box extreme along
that axis -- a genuine pocket floor is always axially INSET from the part's
outer envelope; the part's own boundary face never is. Confirmed live-cost
impact: every real milled part previously carried 1-2 fabricated Pocket
Rough/Finish cost lines for its own untouched top/bottom faces.
"""
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCC.Core.gp import gp_Pnt

from machining.machining_feature_recognizer import MachiningFeatureRecognizer


def test_plain_box_yields_zero_features_not_two_fabricated_pockets():
    """The exact real regression this fix closes: a genuine plain box (no
    cuts at all) has NO real pocket -- both of its own flat faces (top and
    bottom) must NOT be reported as one.

    Since Phase 3 (face_classification.py) landed, a plain box legitimately
    DOES produce real features now (6 real planar_face regions, one per
    face -- a genuine facing-operation candidate, not fabricated). That is
    correct, desired behavior, not a regression of this fix -- only
    pocket/slot/keyway must stay empty here."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    tree = MachiningFeatureRecognizer().recognize(box, "cnc_milled")

    pocket_like = [f for f in tree.features if f.type in ("pocket", "slot", "keyway")]
    assert pocket_like == [], (
        f"a plain box has no real pocket/slot/keyway -- got {[(f.type, f.params) for f in pocket_like]}"
    )


def test_plain_cylinder_yields_no_fabricated_keyway_on_its_own_end_faces():
    """Same bug, turned-path negative control: a plain, unmachined round bar
    has two real flat end faces (normal parallel to the rotation axis) --
    neither is a real keyway."""
    cyl = BRepPrimAPI_MakeCylinder(15.0, 40.0).Shape()
    tree = MachiningFeatureRecognizer().recognize(cyl, "cnc_turned")

    pocket_like = [f for f in tree.features if f.type in ("keyway", "radial_slot")]
    assert pocket_like == [], (
        f"a plain round bar has no real keyway/radial_slot -- got {[(f.type, f.params) for f in pocket_like]}"
    )


def test_real_pocket_recessed_from_the_boundary_is_still_correctly_detected():
    """Positive control -- the fix must not throw out genuine pockets along
    with the false positives: a real pocket cut INTO a box, whose floor sits
    strictly between the box's own top and bottom faces, must still be
    detected as a real 'pocket'."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    tool = BRepPrimAPI_MakeBox(gp_Pnt(20.0, 17.5, 12.0), 20.0, 15.0, 8.0).Shape()
    part = BRepAlgoAPI_Cut(box, tool).Shape()

    tree = MachiningFeatureRecognizer().recognize(part, "cnc_milled")
    pockets = [f for f in tree.features if f.type == "pocket"]

    assert len(pockets) == 1, (
        f"exactly one real pocket floor was cut, and the part's own top/bottom "
        f"faces must not reappear as extra pockets -- got {[(f.type, f.params) for f in tree.features]}"
    )
    p = pockets[0]
    assert sorted([p.params["length_mm"], p.params["width_mm"]]) == [15.0, 20.0]
    # Real floor centroid: z=12 (inset), not z=0 or z=20 (the box's own extremes)
    assert p.params["centroid"][2] == 12.0
