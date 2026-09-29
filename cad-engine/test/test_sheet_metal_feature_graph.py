"""
Real, end-to-end verification of the sheet-metal feature_graph_v2 contract:

  - every feature_type is a reference sheet-metal catalog type with a valid
    variant (shared/reference_features.json, sheet_metal/feature_models.py)
  - stable_face_ids (shared/stable_face_id.py) -- content-based face identity,
    carried per occurrence as source_face_stable_ids
  - bend_flange_relationships (sheet_metal/bend_relationships.py)

Runs the FULL, PRODUCTION SheetMetalFeatureExtractor.extract() pipeline
against a real, two-bend U-channel (the same real-geometry construction
convention test_bend_relationships.py already established), the same way
memory_optimizer.py drives it in production -- not a synthetic/mocked call.
"""
import math

import pytest

pytest.importorskip("OCC")

from OCC.Core.TopExp import TopExp_Explorer  # noqa: E402
from OCC.Core.TopAbs import TopAbs_FACE  # noqa: E402
from OCC.Core.TopoDS import topods  # noqa: E402
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # noqa: E402
from OCC.Core.GeomAbs import GeomAbs_Cylinder  # noqa: E402
from OCC.Core.Bnd import Bnd_Box  # noqa: E402
from OCC.Core.BRepBndLib import brepbndlib  # noqa: E402

from sheet_metal.feature_extractor import SheetMetalFeatureExtractor  # noqa: E402
from test_bend_relationships import make_bent_sheet  # noqa: E402


def _scan_cylinders_and_bbox(shape):
    """Same real-OCC face walk test_perforation.py's own end-to-end test
    uses -- reproduced here (not imported, to keep this file independently
    runnable) rather than re-deriving a different shape."""
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


def test_real_u_channel_end_to_end_feature_graph_contract():
    """A real two-bend U-channel: flat-bend90-flat(20mm)-bend90-flat, swept
    from a real rectangular profile (BRepOffsetAPI_MakePipe) -- run through
    the FULL production extract() pipeline."""
    shape = make_bent_sheet(seg_lens=[30.0, 20.0, 30.0], angles_deg=[90.0, 90.0])

    raw_cylinders_full, bbox_minmax = _scan_cylinders_and_bbox(shape)
    assert len(raw_cylinders_full) >= 2, "expected at least the two real bend cylinders"

    extractor = SheetMetalFeatureExtractor()
    result = extractor.extract(
        shape,
        bbox_dims=[bbox_minmax["xmax"] - bbox_minmax["xmin"],
                   bbox_minmax["ymax"] - bbox_minmax["ymin"],
                   bbox_minmax["zmax"] - bbox_minmax["zmin"]],
        raw_cylinders_full=raw_cylinders_full,
        bbox_minmax=bbox_minmax,
    )

    assert result["bend_count"] >= 2

    # ── stable_face_ids ──────────────────────────────────────────────────
    fg = result["feature_graph_v2"]
    assert fg is not None
    stable_ids = fg["metadata"]["stable_face_ids"]
    real_face_count = 0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        real_face_count += 1
        exp.Next()
    assert len(stable_ids) == real_face_count
    assert len(set(stable_ids.values())) >= 1
    assert all(isinstance(v, str) and len(v) == 16 for v in stable_ids.values())

    # ── reference vocabulary ────────────────────────────────────────────
    from shared.feature_vocabulary import feature_types
    from sheet_metal.feature_models import VARIANTS
    assert "normalized_features" not in fg
    for entry in fg["features"]:
        assert entry["feature_type"] in feature_types("sheet_metal")
        assert entry["variant"] in VARIANTS[entry["feature_type"]]
    bends = [e for e in fg["features"] if e["feature_type"] == "StraightBend"]
    assert sum(len(e["occurrences"]) for e in bends) >= 2
    for entry in bends:
        for occ in entry["occurrences"]:
            assert occ["face_ids"], "a bend occurrence must carry its real face ids"
            # Every face id must resolve to its real stable id -- proves the
            # per-occurrence stable ids are neither fabricated nor misaligned.
            assert occ["source_face_stable_ids"] == [stable_ids.get(fid) for fid in occ["face_ids"]]
            assert all(sid is not None for sid in occ["source_face_stable_ids"])
            assert "centroid" in occ

    # ── bend_flange_relationships ────────────────────────────────────────
    relationships = result["bend_flange_relationships"]
    assert len(relationships) >= 1, "the U-channel's two bends must share a real flange"
    rel = relationships[0]
    assert rel["recognition_status"] in ("recognized", "ambiguous")
    if rel["recognition_status"] == "recognized":
        assert rel["fold_relative_orientation"] is not None
        assert -1.0 <= rel["fold_relative_orientation"] <= 1.0
        # Two 90deg turns in the SAME rotational sense compound to a net
        # 180deg relative rotation between the two far-side walls (this
        # shape folds like a Z/hook, not an open U with parallel walls --
        # that needs opposite-signed turns) -- anti-parallel, -1.0. Real,
        # computed value, verified against bend_relationships.py's own
        # documented convention, not assumed.
        assert rel["fold_relative_orientation"] == pytest.approx(-1.0, abs=0.05)
    assert rel["flange_width_mm"] is not None
    assert rel["flange_width_mm"] > 0
