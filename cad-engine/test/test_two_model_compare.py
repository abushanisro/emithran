"""two_model.compare: a finished part against the source component it is machined from, on OCC-built pairs with hand-computed values."""
import math

import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # noqa: E402
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCC.Core.GeomAbs import GeomAbs_Cylinder  # noqa: E402
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt  # noqa: E402

from shared.casting_geometry import _faces  # noqa: E402
from two_model.compare import allowed_outside_fraction, compare_models  # noqa: E402


def box(x, y, z, at=(0.0, 0.0, 0.0)):
    return BRepPrimAPI_MakeBox(gp_Pnt(*at), x, y, z).Shape()


def cut(a, b):
    return BRepAlgoAPI_Cut(a, b).Shape()


def cylinder(at, axis, r, h):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*at), gp_Dir(*axis)), r, h).Shape()


def surface_type(shape, i):
    return BRepAdaptor_Surface(_faces(shape)[i]).GetType()


def test_a_pocket_and_a_hole_machined_into_the_blank_leave_its_outside_as_supplied():
    # A 100 x 80 x 40 casting; machined: a 40 x 30 x 10 pocket in the top and a 10 mm through hole.
    source = box(100, 80, 40)
    target = cut(cut(source, box(40, 30, 20, (20, 20, 30))), cylinder((80, 60, -5), (0, 0, 1), 5, 60))
    r = compare_models(target, source)
    assert r["aligned"] is True
    assert r["removed_volume_mm3"] == pytest.approx(40 * 30 * 10 + math.pi * 25 * 40, rel=1e-6)
    # The six outer faces (the top one with the openings in it) are as the casting made them; the pocket's five faces and the hole are not.
    assert len(r["as_supplied_face_ids"]) == 6
    assert len(r["machined_face_ids"]) == 6
    hole = [i for i in r["machined_face_ids"] if surface_type(target, i) == GeomAbs_Cylinder]
    assert len(hole) == 1, "the hole's wall touches the outside only at its rims: it is machined, not supplied"


def test_a_part_machined_all_over_has_no_face_as_supplied():
    # A 110 x 90 x 50 blank with 5 mm stock on every face of a 100 x 80 x 40 part.
    source = box(110, 90, 50)
    target = box(100, 80, 40, (5, 5, 5))
    r = compare_models(target, source)
    assert r["aligned"] is True
    assert r["as_supplied_face_ids"] == []
    assert len(r["machined_face_ids"]) == 6
    assert r["removed_volume_mm3"] == pytest.approx(110 * 90 * 50 - 100 * 80 * 40, rel=1e-9)


def test_a_flat_milled_on_a_round_bar_leaves_the_round_as_supplied():
    # A 50 mm bar, 100 long, with a 5 mm deep flat along its length: the round surface left is the bar's own (curved, within the mesh's
    # deflection of the exact surface), the flat is machined.
    source = cylinder((0, 0, 0), (0, 0, 1), 25, 100)
    target = cut(source, box(60, 20, 120, (-30, 20, -10)))
    r = compare_models(target, source)
    assert r["aligned"] is True
    # OCC splits the round left into two faces at the cylinder's seam: both are the bar's own. Only the flat is machined.
    curved = [i for i, _ in enumerate(_faces(target)) if surface_type(target, i) == GeomAbs_Cylinder]
    assert curved and set(curved) <= set(r["as_supplied_face_ids"])
    assert len(r["machined_face_ids"]) == 1


def test_two_models_out_of_one_frame_are_reported_and_nothing_else_is_measured():
    source = box(100, 80, 40)
    target = cut(box(100, 80, 40, (30, 0, 0)), box(40, 30, 20, (50, 20, 30)))
    r = compare_models(target, source)
    assert r["aligned"] is False
    assert "not in one coordinate frame" in r["misalignment"]
    assert "as_supplied_face_ids" not in r and "removed_volume_mm3" not in r
    assert r["outside_fraction"] > r["allowed_outside_fraction"]


def test_the_sensitivity_runs_from_a_tenth_of_the_part_outside_to_none():
    assert allowed_outside_fraction(0) == pytest.approx(0.10)
    assert allowed_outside_fraction(82) == pytest.approx(0.018)
    assert allowed_outside_fraction(100) == 0.0


def test_the_endpoint_compares_two_step_files(tmp_path):
    from fastapi.testclient import TestClient

    import main
    from shared.assembly import write_step

    source = box(100, 80, 40)
    target = cut(source, box(40, 30, 20, (20, 20, 30)))
    paths = {}
    for name, shape in (("target", target), ("source", source)):
        paths[name] = str(tmp_path / f"{name}.step")
        write_step(shape, paths[name])
    with TestClient(main.app) as client:
        r = client.post(
            "/analyze/two-model",
            files={n: (f"{n}.step", open(p, "rb").read(), "application/step") for n, p in paths.items()},
            data={"sensitivity": "82"},
            headers={"X-API-Key": main._CAD_API_KEY},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["aligned"] is True
    assert body["removed_volume_mm3"] == pytest.approx(12000, rel=1e-6)
    assert len(body["machined_face_ids"]) == 5


def test_a_two_model_part_is_analysed_as_a_machined_part_whatever_the_geometry_alone_reads():
    # A 2 mm plate reads as sheet metal by its geometry; as a 2-Model part it is machined (milled), with the geometry's verdict beside it.
    from shared.memory_optimizer import AdvancedCADMemoryOptimizer
    from shared.part_family import MACHINING_FAMILIES, MILLED, TWO_MODEL_HINT

    plate = box(200, 150, 2)
    mi = AdvancedCADMemoryOptimizer().analyze_and_optimize(plate, family_hint=TWO_MODEL_HINT).geometry_features.manufacturing_features["manufacturing_intelligence"]
    assert mi["detected_family"] in MACHINING_FAMILIES
    if mi["geometric_family"] not in MACHINING_FAMILIES:
        assert mi["detected_family"] == MILLED
    # A block that the geometry already reads as machined keeps that family.
    block = box(60, 50, 40)
    mi = AdvancedCADMemoryOptimizer().analyze_and_optimize(block, family_hint=TWO_MODEL_HINT).geometry_features.manufacturing_features["manufacturing_intelligence"]
    assert mi["detected_family"] in MACHINING_FAMILIES
