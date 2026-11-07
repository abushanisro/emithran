"""The faces behind the CAD quantities a molding calculator takes as inputs (feature_graph_v2.measurements).

A tray with a 2.5 mm wall and three 1.5 mm ribs, whose answers are known without running the engine:
  - the nominal wall is 2.5 mm and is measured on the outer and inner faces of the walls and the floor, never on the rim top or the rib faces;
  - the body volume is 100x60x15 - 95x55x12.5 + 3 ribs of 95x1.5x10 = 28,962.5 mm3, and the whole body is every face.
"""
import pytest

pytest.importorskip("OCC")

from OCC.Core.Bnd import Bnd_Box  # noqa: E402
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse  # noqa: E402
from OCC.Core.BRepBndLib import brepbndlib  # noqa: E402
from OCC.Core.BRepGProp import brepgprop  # noqa: E402
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox  # noqa: E402
from OCC.Core.GProp import GProp_GProps  # noqa: E402
from OCC.Core.TopAbs import TopAbs_FACE  # noqa: E402
from OCC.Core.TopExp import TopExp_Explorer  # noqa: E402
from OCC.Core.TopoDS import topods  # noqa: E402
from OCC.Core.gp import gp_Pnt  # noqa: E402

from injection_molding.feature_extractor import InjectionMoldedFeatureExtractor  # noqa: E402
from sheet_metal.feature_extractor import SheetMetalFeatureExtractor  # noqa: E402


def _box(x, y, z, dx, dy, dz):
    return BRepPrimAPI_MakeBox(gp_Pnt(x, y, z), dx, dy, dz).Shape()


def _ribbed_tray():
    shape = BRepAlgoAPI_Cut(_box(-50, -30, 0, 100, 60, 15), _box(-47.5, -27.5, 2.5, 95, 55, 15)).Shape()
    for y in (-15, 0, 15):
        shape = BRepAlgoAPI_Fuse(shape, _box(-47.5, y - 0.75, 2.5, 95, 1.5, 10)).Shape()
    return shape


def _dims(shape):
    b = Bnd_Box()
    brepbndlib.Add(shape, b)
    x0, y0, z0, x1, y1, z1 = b.Get()
    return [x1 - x0, y1 - y0, z1 - z0]


def _faces(shape):
    out, ex = [], TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        f = topods.Face(ex.Current())
        p = GProp_GProps()
        brepgprop.SurfaceProperties(f, p)
        c = p.CentreOfMass()
        out.append({"area": p.Mass(), "z": c.Z(), "y": c.Y()})
        ex.Next()
    return out


@pytest.fixture(scope="module")
def evidence():
    shape = _ribbed_tray()
    faces = _faces(shape)
    face_map = [{"face_id": i, "tri_start": i, "tri_count": 1} for i in range(len(faces))]
    out = InjectionMoldedFeatureExtractor().extract(shape, _dims(shape), face_map=face_map, face_map_tri_total=len(faces))
    return out, faces


def test_the_wall_is_measured_on_the_pairs_that_voted_for_it(evidence):
    out, faces = evidence
    wall = out["feature_graph_v2"]["measurements"]["wall_thickness"]
    assert out["wall_thickness_nominal_mm"] == pytest.approx(2.5)
    assert wall["value"] == pytest.approx(2.5) and wall["unit"] == "mm"
    assert wall["reconciles"] is True
    # every pair is two faces whose separation is the wall
    assert wall["occurrences"] and all(len(o["face_ids"]) == 2 for o in wall["occurrences"])
    assert all(o["length_mm"] == pytest.approx(2.5, abs=1e-3) for o in wall["occurrences"])


def test_the_rim_top_and_the_rib_faces_are_not_wall_evidence(evidence):
    out, faces = evidence
    on_wall = {f for o in out["feature_graph_v2"]["measurements"]["wall_thickness"]["occurrences"] for f in o["face_ids"]}
    rim = [i for i, f in enumerate(faces) if abs(f["z"] - 15.0) < 1e-6]
    ribs = [i for i, f in enumerate(faces) if abs(abs(f["y"]) - 15.0) < 1.0 and abs(f["area"] - 950.0) < 1.0]  # the long rib faces
    assert rim and ribs
    assert not (set(rim) & on_wall), "the rim top (15 mm from the floor underside) is not a wall"
    assert not (set(ribs) & on_wall), "a 1.5 mm rib face is not the 2.5 mm wall"
    assert on_wall <= set(range(len(faces)))


def test_the_part_volume_is_the_solids_and_its_faces_are_all_of_them(evidence):
    out, faces = evidence
    volume = out["feature_graph_v2"]["measurements"]["part_volume"]
    assert volume["value"] == pytest.approx(100 * 60 * 15 - 95 * 55 * 12.5 + 3 * 95 * 1.5 * 10, rel=1e-6)
    assert volume["unit"] == "mm3" and volume["reconciles"] is True
    assert volume["occurrences"][0]["face_ids"] == list(range(len(faces)))


def test_the_pair_lists_are_not_left_in_the_debug_dict_that_is_returned_as_is(evidence):
    out, _ = evidence
    for key in ("modal_pairs", "modal_pair_face_ids", "modal_pair_count"):
        assert key not in out["wall_geometry_debug"]


def test_without_a_face_map_there_is_no_part_volume_evidence_and_no_guess():
    shape = _ribbed_tray()
    out = InjectionMoldedFeatureExtractor().extract(shape, _dims(shape))
    measurements = (out["feature_graph_v2"] or {}).get("measurements", {})
    assert "part_volume" not in measurements


def test_sheet_metal_output_is_unchanged_unless_the_pairs_are_asked_for():
    shape = _ribbed_tray()
    default = SheetMetalFeatureExtractor()._extract_sheet_metal_geometry(shape, _dims(shape))[3]
    asked = SheetMetalFeatureExtractor()._extract_sheet_metal_geometry(shape, _dims(shape), collect_modal_pairs=True)[3]
    assert "modal_pairs" not in default and "modal_pair_face_ids" not in default
    assert asked["modal_pair_count"] > 0 and asked["modal_pair_face_ids"]
    # asking for them changes nothing else
    assert {k: v for k, v in asked.items() if not k.startswith("modal_pair")} == default


def test_the_analysis_path_records_the_wall_faces_too():
    """The optimizer scans the wall once and hands that result to the molding extractor; the pairs must be collected in that scan (found on a real part:
    the part volume was recorded, the wall was not)."""
    from shared.memory_optimizer import AdvancedCADMemoryOptimizer

    shape = _ribbed_tray()
    opt = AdvancedCADMemoryOptimizer.__new__(AdvancedCADMemoryOptimizer)
    dims = _dims(shape)
    bbox = {"min_x": -50, "min_y": -30, "min_z": 0, "max_x": 50, "max_y": 30, "max_z": 15, "x": dims[0], "y": dims[1], "z": dims[2], "length": dims[0], "width": dims[1], "height": dims[2]}
    out = opt._analyze_manufacturing_features(shape, bbox, 28962.5, family_hint="plastic_molded")
    features = out["manufacturing_intelligence"]["features"]
    graph = features["feature_graph_v2"]
    assert features["wall_thickness_nominal_mm"] == pytest.approx(2.5)
    wall = graph["measurements"]["wall_thickness"]
    assert wall["occurrences"] and all(len(o["face_ids"]) == 2 for o in wall["occurrences"])
