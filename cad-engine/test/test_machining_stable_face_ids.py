"""
Real-OCC regression test for Phase 1 of the machining feature-extraction
plan: Machining never adopted shared/stable_face_id.py (Sheet Metal's own,
already-proven content-based face identity) -- its face references were
still raw TopExp_Explorer enumeration ordinals, unstable across STEP
regeneration.

build_machining_feature_graph_v2 now accepts an optional stable_face_ids map
(same shape shared/stable_face_id.build_stable_face_id_map produces) and,
when supplied, attaches source_face_stable_ids per occurrence and exposes
the full map in feature_graph_v2.metadata.stable_face_ids -- purely
additive, same integration pattern already proven for Sheet Metal in
sheet_metal/feature_extractor.py.

Real B-Rep throughout: a real box with a real through hole drilled via
BRepAlgoAPI_Cut, recognized by the real MachiningFeatureRecognizer -- not a
synthetic dict.
"""
import pytest

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # type: ignore
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # type: ignore
from OCC.Core.gp import gp_Pnt, gp_Dir, gp_Ax2  # type: ignore

from machining.machining_feature_recognizer import (
    MachiningFeatureRecognizer,
    build_machining_feature_graph_v2,
    _part_bounding_box,
)
from shared.stable_face_id import build_stable_face_id_map


def _make_drilled_box(dx=40.0, dy=30.0, dz=20.0, hole_diam=6.0):
    """A real box with one real through hole drilled top-to-bottom."""
    box = BRepPrimAPI_MakeBox(dx, dy, dz).Shape()
    axis = gp_Ax2(gp_Pnt(dx / 2, dy / 2, -1.0), gp_Dir(0, 0, 1))
    drill = BRepPrimAPI_MakeCylinder(axis, hole_diam / 2, dz + 2.0).Shape()
    return BRepAlgoAPI_Cut(box, drill).Shape()


def _synthesize(shape, family="milled", with_stable_ids=True):
    tree = MachiningFeatureRecognizer().recognize(shape, family=family)
    machining_dict = tree.to_dict()
    bbox = _part_bounding_box(shape)
    bbox_center = (
        (bbox["xmin"] + bbox["xmax"]) / 2,
        (bbox["ymin"] + bbox["ymax"]) / 2,
        (bbox["zmin"] + bbox["zmax"]) / 2,
    )
    stable_ids = build_stable_face_id_map(shape) if with_stable_ids else None
    fgv2 = build_machining_feature_graph_v2(machining_dict, bbox_center, [], 0, stable_face_ids=stable_ids)
    return machining_dict, fgv2, stable_ids


def test_real_drilled_box_produces_a_through_hole_with_stable_ids():
    shape = _make_drilled_box()
    machining_dict, fgv2, stable_ids = _synthesize(shape)

    assert stable_ids, "a real drilled box must have real faces to key stable ids on"
    assert fgv2["metadata"]["stable_face_ids"] == stable_ids

    hole_entries = [f for f in fgv2["features"] if (f["feature_type"], f["variant"]) == ("SimpleHole", "through")]
    assert len(hole_entries) >= 1, "real drilled box must yield a real through_hole entry"
    occ = hole_entries[0]["occurrences"][0]

    assert "source_face_stable_ids" in occ
    assert len(occ["source_face_stable_ids"]) == len(occ["face_ids"])
    for fid, sid in zip(occ["face_ids"], occ["source_face_stable_ids"]):
        assert sid == stable_ids.get(fid)
        assert sid is not None


def test_stable_ids_are_deterministic_across_repeated_synthesis():
    shape = _make_drilled_box()
    _, fgv2_a, _ = _synthesize(shape)
    _, fgv2_b, _ = _synthesize(shape)

    hole_a = next(f for f in fgv2_a["features"] if (f["feature_type"], f["variant"]) == ("SimpleHole", "through"))
    hole_b = next(f for f in fgv2_b["features"] if (f["feature_type"], f["variant"]) == ("SimpleHole", "through"))
    assert (
        hole_a["occurrences"][0]["source_face_stable_ids"]
        == hole_b["occurrences"][0]["source_face_stable_ids"]
    )


def test_omitting_stable_face_ids_is_backward_compatible():
    """No stable_face_ids argument -> no source_face_stable_ids key at all,
    and metadata.stable_face_ids is an empty dict, not a fabricated one --
    proves this is purely additive for callers that don't pass it."""
    shape = _make_drilled_box()
    _, fgv2, _ = _synthesize(shape, with_stable_ids=False)

    assert fgv2["metadata"]["stable_face_ids"] == {}
    hole_entries = [f for f in fgv2["features"] if (f["feature_type"], f["variant"]) == ("SimpleHole", "through")]
    assert len(hole_entries) >= 1
    occ = hole_entries[0]["occurrences"][0]
    assert "source_face_stable_ids" not in occ
