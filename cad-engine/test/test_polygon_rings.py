"""
Real-OCC regression tests for Phase 5's polygon-ring SPIKE
(face_classification.detect_polygon_rings) -- rotary-broached hex/square
sockets and bosses ("Polygon" / "Rotary Broaching" / "Polygon Turning", 18
real rows in memory/machining/operations_full__operations.csv).

NOT WIRED into MachiningFeatureRecognizer.recognize() -- see this module's own
doc comment (face_classification.py) and the "NOT WIRED" note in
_recognize_milled (machining_feature_recognizer.py) for why: real testing (this
file) found the detector's own geometric signal cannot reliably distinguish
a genuine broached polygon from an ordinary square/rectangular milled
pocket. Both are real closed rings of congruent-area, mutually adjacent
planar walls -- the difference is the intended tooling/process, not the
geometry. Kept as a documented, tested spike (same precedent as
sheet_metal/features/gusset_spike.py) for a future pass with an additional
real disambiguating signal, called directly here at the unit level (not
through the full recognizer pipeline, which never invokes it).

Real B-Rep throughout: genuine hex/square prism cutouts/bosses and an
ordinary rectangular pocket, built via BRepBuilderAPI_MakePolygon +
BRepPrimAPI_MakePrism / BRepPrimAPI_MakeBox, not synthetic dicts.
"""
import math

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakePrism, BRepPrimAPI_MakeCylinder
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse, BRepAlgoAPI_Cut
from OCC.Core.gp import gp_Pnt, gp_Vec

from machining.machining_feature_recognizer import _part_bounding_box
from machining.face_classification import detect_polygon_rings


def _hex_wire_face(cx, cy, z, radius):
    mk = BRepBuilderAPI_MakePolygon()
    for i in range(6):
        ang = math.pi / 6 + i * (math.pi / 3)
        mk.Add(gp_Pnt(cx + radius * math.cos(ang), cy + radius * math.sin(ang), z))
    mk.Close()
    return BRepBuilderAPI_MakeFace(mk.Wire()).Face()


def _square_wire_face(cx, cy, z, half_width):
    mk = BRepBuilderAPI_MakePolygon()
    for dx, dy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
        mk.Add(gp_Pnt(cx + dx * half_width, cy + dy * half_width, z))
    mk.Close()
    return BRepBuilderAPI_MakeFace(mk.Wire()).Face()


def _box_with_hex_socket():
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    face = _hex_wire_face(30.0, 25.0, 20.0, 8.0)
    prism = BRepPrimAPI_MakePrism(face, gp_Vec(0, 0, -10.0)).Shape()
    return BRepAlgoAPI_Cut(box, prism).Shape()


def _box_with_hex_boss():
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    face = _hex_wire_face(30.0, 25.0, 20.0, 8.0)
    prism = BRepPrimAPI_MakePrism(face, gp_Vec(0, 0, 10.0)).Shape()
    return BRepAlgoAPI_Fuse(box, prism).Shape()


def _box_with_square_socket():
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    face = _square_wire_face(30.0, 25.0, 20.0, 6.0)
    prism = BRepPrimAPI_MakePrism(face, gp_Vec(0, 0, -8.0)).Shape()
    return BRepAlgoAPI_Cut(box, prism).Shape()


def _detect(shape):
    bbox = _part_bounding_box(shape)
    return detect_polygon_rings(shape, claimed_face_ids=set(), part_bbox=bbox)


def test_real_hex_socket_is_detected_as_a_6_sided_ring():
    rings = _detect(_box_with_hex_socket())
    assert len(rings) == 1
    r = rings[0]
    assert r["side_count"] == 6
    assert len(r["face_indices"]) == 6
    # Real regular-hexagon lateral area: 6 * side_length * depth. side_length
    # for a radius-8 regular hexagon is 8mm; depth of cut is 10mm -> 480mm^2.
    assert abs(r["area_mm2"] - 480.0) < 1.0


def test_real_hex_boss_is_detected_as_a_6_sided_ring():
    rings = _detect(_box_with_hex_boss())
    assert len(rings) == 1
    assert rings[0]["side_count"] == 6


def test_real_square_socket_is_detected_as_a_4_sided_ring():
    rings = _detect(_box_with_square_socket())
    assert len(rings) == 1
    r = rings[0]
    assert r["side_count"] == 4
    # 4 sides * 12mm width * 8mm depth = 384mm^2
    assert abs(r["area_mm2"] - 384.0) < 1.0


def test_plain_box_yields_no_ring():
    """The confirmed false positive the part-bbox exclusion fixes: a plain
    box's own 4 side walls independently satisfy the degree-2 +
    congruent-area ring signature, but they ARE the part's own outer
    envelope, not a real localized feature."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    assert _detect(box) == []


def test_plain_cylinder_yields_no_ring():
    """A round part has no planar faces at all to form a ring from."""
    cyl = BRepPrimAPI_MakeCylinder(15.0, 40.0).Shape()
    assert _detect(cyl) == []


def test_part_bbox_exclusion_is_what_removes_the_plain_box_false_positive():
    """Direct proof that the part_bbox check specifically is what rejects
    the plain box (not some unrelated filter): omitting it must let the
    same 4-wall false positive back through."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    without_part_bbox = detect_polygon_rings(box, claimed_face_ids=set(), part_bbox=None)
    assert len(without_part_bbox) == 1
    assert without_part_bbox[0]["side_count"] == 4


def test_KNOWN_LIMITATION_an_ordinary_pocket_is_also_reported_as_a_ring():
    """Documents, rather than hides, the real reason this detector is not
    wired into the live recognizer: an ordinary rectangular pocket cut into
    a box is geometrically indistinguishable from a genuine broached
    polygon feature under this detector's own real signal (both are closed
    rings of congruent-area, mutually adjacent planar walls). This is a
    confirmed, live characteristic of detect_polygon_rings itself, not a
    fixture bug -- if a future change makes this test start failing (no
    ring reported), the module doc comment's "NOT WIRED" rationale should
    be re-evaluated, not just this test deleted."""
    box = BRepPrimAPI_MakeBox(60.0, 50.0, 20.0).Shape()
    tool = BRepPrimAPI_MakeBox(gp_Pnt(20.0, 17.5, 12.0), 20.0, 15.0, 8.0).Shape()
    part = BRepAlgoAPI_Cut(box, tool).Shape()

    rings = _detect(part)
    assert len(rings) == 1
    assert rings[0]["side_count"] == 4
