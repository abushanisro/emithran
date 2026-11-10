"""The sheet gauge is the thickness most of the part's walls have, and only a part made of one gauge is called sheet metal."""
import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox  # noqa: E402
from OCC.Core.gp import gp_Pnt  # noqa: E402

from sheet_metal.feature_extractor import SheetMetalFeatureExtractor  # noqa: E402
from shared.memory_optimizer import SHEET_GAUGE_DOMINANCE_MIN, smf_override_verdict  # noqa: E402


def _box(x, y, z, dx, dy, dz):
    return BRepPrimAPI_MakeBox(gp_Pnt(x, y, z), dx, dy, dz).Shape()


def test_a_large_face_opposite_small_pocket_floors_does_not_outvote_the_real_wall():
    # A 3.5 mm plate with four 1.5 x 1.5 mm pockets milled down to 1 mm above its underside: the Cannula Holder bottom's
    # counterbore floors in miniature. Each floor faces the whole underside 1 mm away. When a pair voted with the sum of its
    # two faces, the underside's 3000 mm² counted once per floor and the plate read as 1 mm sheet; a pair is a wall only
    # where its faces overlap, so it votes the smaller face.
    plate = _box(0, 0, 0, 60, 50, 3.5)
    for x in (10, 20, 30, 40):
        plate = BRepAlgoAPI_Cut(plate, _box(x, 20, 1.0, 1.5, 1.5, 5)).Shape()
    gauge, _face, _conf, debug = SheetMetalFeatureExtractor()._extract_sheet_metal_geometry(plate, [60, 50, 3.5])
    assert gauge == pytest.approx(3.5, abs=0.05)
    assert debug["area_ratio"] > 0.95  # the pocket floors are a sliver of the evidence, not most of it


def test_one_dominant_gauge_turns_a_hollow_milled_reading_into_sheet_metal():
    # a 2 mm folded cover, 120 x 115 x 60, every wall pair at 2 mm (SUN-SHADE-COVER-1: dominance 1.00)
    verdict = smf_override_verdict(gauge_mm=2.0, gauge_dominance=1.0, dims=[160, 120, 115], volume_mm3=82_000)
    assert verdict is not None and verdict[0] is True and "smf_override:" in verdict[1]


def test_a_thin_wall_among_stepped_walls_is_a_machined_housing_not_sheet():
    # the Cannula Holder bottom: 54 x 45 x 44, 11,274 mm³, modal wall 3.5 mm holding 65% of the wall area (the rest stepped)
    verdict = smf_override_verdict(gauge_mm=3.5, gauge_dominance=0.649, dims=[54.3, 45.0, 44.4], volume_mm3=11_274)
    assert verdict is not None and verdict[0] is False
    assert "declined" in verdict[1] and "65%" in verdict[1]


def test_the_cross_check_does_not_apply_to_a_full_part_or_a_gauge_as_thick_as_the_part():
    assert smf_override_verdict(gauge_mm=3.0, gauge_dominance=1.0, dims=[60, 50, 3], volume_mm3=9_000) is None  # a solid plate: fill 1.0
    assert smf_override_verdict(gauge_mm=30.0, gauge_dominance=1.0, dims=[100, 100, 50], volume_mm3=10_000) is None  # gauge >= 45% of 50 mm
    assert smf_override_verdict(gauge_mm=0.0, gauge_dominance=1.0, dims=[100, 100, 50], volume_mm3=10_000) is None  # no gauge found
    assert 0.65 < SHEET_GAUGE_DOMINANCE_MIN <= 0.82  # between the machined holder and the least dominant real sheet part measured
