"""
Real-OCC regression test for the Phase 0 coverage fix:
_collect_toroids (machining/machining_feature_recognizer.py) now computes a real
face centroid (via GProp_GProps/brepgprop.SurfaceProperties, same technique
shared/stable_face_id.py already uses) for every real toroidal face it finds.

Root cause this closes: fillet/groove MachiningFeature.params previously had NO
"centroid" key at all, so build_machining_feature_graph_v2's required-centroid
guard silently dropped every real, already-detected fillet/groove feature --
real face_ids, zero cost line, zero 3D-highlight capability. This test
exercises the REAL OCC geometry path (a real filleted cylinder, a real
toroidal face from BRepFilletAPI_MakeFillet), not a synthetic dict -- the bug
lived in real geometry extraction, so the regression test has to as well.

Scope note (2026-09-19): _collect_toroids matches ONLY GeomAbs_Torus. A
fillet swept along a straight linear edge (e.g. a plain box edge) is
topologically a CYLINDRICAL blend, not a torus -- a torus only appears where
a fillet follows a curved (e.g. circular) edge, or where two fillets meet at
a corner. So this fixture deliberately fillets a cylinder's circular rim
edge, which is the real, minimal shape that actually produces a
GeomAbs_Torus face. Straight-edge (cylindrical-blend) fillet/round detection
is a separate, not-yet-built capability -- tracked as a CurvedWall sub-case
in Phase 3 of the machining feature-extraction plan, not covered here.
"""
import math

import pytest

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # type: ignore
from OCC.Core.BRepFilletAPI import BRepFilletAPI_MakeFillet  # type: ignore
from OCC.Core.BRepAdaptor import BRepAdaptor_Curve  # type: ignore
from OCC.Core.GeomAbs import GeomAbs_Circle  # type: ignore
from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
from OCC.Core.TopAbs import TopAbs_EDGE  # type: ignore
from OCC.Core.TopoDS import topods  # type: ignore

from machining.machining_feature_recognizer import MachiningFeatureRecognizer


def _make_filleted_cylinder(radius=20.0, height=30.0, fillet_radius=4.0):
    """A real cylinder with its top circular rim edge filleted -> one real
    torus face (major radius ~= cylinder radius, minor radius = fillet
    radius). Filleting a curved (circular) edge is what actually produces
    GeomAbs_Torus in OCC -- a straight-edge fillet does not."""
    cyl = BRepPrimAPI_MakeCylinder(radius, height).Shape()
    mkfillet = BRepFilletAPI_MakeFillet(cyl)
    exp = TopExp_Explorer(cyl, TopAbs_EDGE)
    target_edge = None
    while exp.More():
        edge = topods.Edge(exp.Current())
        curve = BRepAdaptor_Curve(edge)
        if curve.GetType() == GeomAbs_Circle:
            target_edge = edge
            break
        exp.Next()
    assert target_edge is not None, "cylinder must have a real circular edge -- fixture itself is broken"
    mkfillet.Add(fillet_radius, target_edge)
    mkfillet.Build()
    assert mkfillet.IsDone(), "real fillet construction failed -- test fixture itself is broken"
    return mkfillet.Shape(), fillet_radius


def test_collect_toroids_produces_real_nonzero_centroid():
    shape, fillet_radius = _make_filleted_cylinder()
    recognizer = MachiningFeatureRecognizer()
    toroids = recognizer._collect_toroids(shape)

    assert len(toroids) >= 1, "real filleted cylinder rim must produce at least one real torus face"
    tor = toroids[0]

    assert "centroid" in tor, "Phase 0 fix: every toroid must carry a real centroid"
    cx, cy, cz = tor["centroid"]
    # A real rim fillet sits near the top of the cylinder (z ~= height), not
    # at the world origin -- a genuinely all-zero centroid would mean the fix
    # silently fell back to a fabricated (0,0,0), not a real computed value.
    assert not (cx == 0.0 and cy == 0.0 and cz == 0.0)

    assert tor["minor_radius"] == pytest.approx(fillet_radius, abs=0.5)
    assert tor["is_concave"] is False  # an outside rim fillet on a cylinder is convex


def test_toroid_centroid_is_stable_across_repeated_calls():
    """Same real shape -> same real centroid (deterministic, not random)."""
    shape, _ = _make_filleted_cylinder()
    recognizer = MachiningFeatureRecognizer()
    first = recognizer._collect_toroids(shape)[0]["centroid"]
    second = recognizer._collect_toroids(shape)[0]["centroid"]
    assert first == second


def test_milled_path_now_detects_fillets_too():
    """Phase 0 fix: _recognize_milled previously never called
    _collect_toroids at all -- fillets/grooves were only ever detected on
    the turned path. Real filleted cylinder, milled family, must now produce
    a real 'fillet' MachiningFeature with real face_ids."""
    shape, _ = _make_filleted_cylinder()
    recognizer = MachiningFeatureRecognizer()
    tree = recognizer.recognize(shape, family="milled")
    fillet_features = [f for f in tree.features if (f.type, f.variant) == ("Edge", "round")]
    assert len(fillet_features) >= 1
    feat = fillet_features[0]
    assert len(feat.face_ids) >= 1
    assert "centroid" in feat.params
    assert feat.params["centroid"] != [0.0, 0.0, 0.0]


def test_no_false_positive_fillet_on_a_plain_box():
    """Negative control: a box with NO filleted edges must produce zero
    fillet/groove features -- _MIN_FILLET_RADIUS_MM and the surface-type
    check must not fire on ordinary sharp-edged planar geometry."""
    box = BRepPrimAPI_MakeBox(40.0, 30.0, 20.0).Shape()
    recognizer = MachiningFeatureRecognizer()
    toroids = recognizer._collect_toroids(box)
    assert toroids == []
