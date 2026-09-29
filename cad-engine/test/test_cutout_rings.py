"""
Real-OCC regression tests for Phase 5's cutout-ring detector
(face_classification.detect_cutout_rings), wired live into
MachiningFeatureRecognizer._recognize_milled -- "Cutout" (Perimeter Milling /
Rough Milling / Routering on a milled part, 11 real rows in
memory/machining/operations_full__operations.csv): a non-circular opening
that goes fully through the part.

Unlike the abandoned Polygon spike (see test_polygon_rings.py), this
detector's defining signal -- the ring's own span along the part's datum
axis must reach the part's FULL thickness, reusing the exact real
through-vs-blind threshold _collect_cylinders already uses for circular
holes -- reliably separates a genuine cutout from an ordinary blind pocket.
It was verified directly against the SAME adversarial fixtures that broke
Polygon (a plain box, a blind pocket) before being wired live; both are
exercised again here as this file's own negative controls.

Real B-Rep throughout: genuine rectangular through-openings and a blind
pocket, built via BRepPrimAPI_MakeBox + BRepAlgoAPI_Cut, not synthetic
dicts.
"""
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCC.Core.gp import gp_Pnt, gp_Ax2, gp_Dir

from machining.machining_feature_recognizer import MachiningFeatureRecognizer


def _recognize(shape):
    return MachiningFeatureRecognizer().recognize(shape, "milled")


def _by_type(tree, ftype, variant=None):
    return [f for f in tree.features if f.type == ftype and (variant is None or f.variant == variant)]


def _box_with_rect_through_cutout():
    """A real rectangular window (20mm x 8mm footprint, deliberately
    non-congruent side lengths) cut fully through a 20mm-thick box."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    tool = BRepPrimAPI_MakeBox(gp_Pnt(20.0, 20.0, -1.0), 20.0, 8.0, 22.0).Shape()
    return BRepAlgoAPI_Cut(box, tool).Shape()


def _box_with_blind_rect_pocket():
    """The SAME footprint, but blind (8mm deep in a 20mm-thick box) --
    must NOT be detected as a cutout."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    tool = BRepPrimAPI_MakeBox(gp_Pnt(20.0, 20.0, 12.0), 20.0, 8.0, 8.0).Shape()
    return BRepAlgoAPI_Cut(box, tool).Shape()


def _box_with_circular_through_hole():
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    ax = gp_Ax2(gp_Pnt(30.0, 25.0, -1.0), gp_Dir(0, 0, 1))
    drill = BRepPrimAPI_MakeCylinder(ax, 6.0, 22.0).Shape()
    return BRepAlgoAPI_Cut(box, drill).Shape()


def test_real_rect_through_opening_is_detected_as_a_4_sided_cutout():
    tree = _recognize(_box_with_rect_through_cutout())
    cutouts = _by_type(tree, "Cutout")
    assert len(cutouts) == 1
    c = cutouts[0]
    assert c.params["side_count"] == 4
    assert len(c.face_ids) == 4
    # Real total lateral wall area: 2*(20*20) + 2*(8*20) = 1120mm^2
    assert abs(c.params["area_mm2"] - 1120.0) < 1.0


def test_cutout_walls_are_claimed_not_double_counted_as_planar_face():
    tree = _recognize(_box_with_rect_through_cutout())
    cutout_face_ids = set(_by_type(tree, "Cutout")[0].face_ids)
    for f in _by_type(tree, "PlanarFace"):
        assert not (set(f.face_ids) & cutout_face_ids)


def test_real_blind_pocket_with_the_same_footprint_is_not_a_cutout():
    """The exact real regression the through-span check exists to prevent:
    the SAME rectangular footprint, but blind, must be a real 'pocket', not
    a fabricated 'cutout'."""
    tree = _recognize(_box_with_blind_rect_pocket())
    assert _by_type(tree, "Cutout") == []
    pockets = _by_type(tree, "PocketV2")
    assert len(pockets) == 1


def test_plain_box_yields_no_false_positive_cutout():
    """Same real false positive Polygon's own investigation found (a plain
    box's own 4 side walls trivially span the part's full height and form
    a real degree-2 ring) -- rejected by the same part-bbox envelope
    exclusion detect_polygon_rings uses."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    tree = _recognize(box)
    assert _by_type(tree, "Cutout") == []


def test_real_circular_through_hole_is_not_reclassified_as_a_cutout():
    """A circular through-hole is already claimed by the discrete hole
    detector before cutout detection runs -- it must never also appear (or
    cause a spurious ring from leftover geometry) as a cutout."""
    tree = _recognize(_box_with_circular_through_hole())
    assert _by_type(tree, "Cutout") == []
    assert len(_by_type(tree, "SimpleHole", "through")) == 1
