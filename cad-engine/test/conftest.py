"""STEP fixtures built with OpenCascade XDE, so assembly tests run against real files."""
import os

import pytest

# The engine refuses every protected route without a key (main.require_api_key), and reads it once at import: set it before
# any test module imports main.
os.environ.setdefault("CAD_ENGINE_API_KEY", "test-key-for-the-cad-engine-tests")
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.gp import gp_Trsf, gp_Vec
from OCC.Core.IFSelect import IFSelect_RetDone
from OCC.Core.STEPCAFControl import STEPCAFControl_Writer
from OCC.Core.TDataStd import TDataStd_Name
from OCC.Core.TDocStd import TDocStd_Document
from OCC.Core.TopLoc import TopLoc_Location
from OCC.Core.XCAFDoc import XCAFDoc_DocumentTool

BOX_VOLUME = 10 * 20 * 30


def _at(x: float) -> TopLoc_Location:
    t = gp_Trsf()
    t.SetTranslation(gp_Vec(x, 0, 0))
    return TopLoc_Location(t)


def _write(doc, path: str) -> str:
    writer = STEPCAFControl_Writer()
    writer.Transfer(doc)
    assert writer.Write(path) == IFSelect_RetDone
    return path


@pytest.fixture
def nested_assembly(tmp_path) -> str:
    """Top = 2 x Sub + 1 Cyl;  Sub = 2 x Box + 1 Cyl.  Two distinct part definitions, seven part instances in all."""
    doc = TDocStd_Document("test-assembly")
    tool = XCAFDoc_DocumentTool.ShapeTool(doc.Main())
    box = tool.AddShape(BRepPrimAPI_MakeBox(10, 20, 30).Shape(), False)
    cyl = tool.AddShape(BRepPrimAPI_MakeCylinder(5, 40).Shape(), False)
    sub, top = tool.NewShape(), tool.NewShape()
    for label, name in ((box, "Box"), (cyl, "Cyl"), (sub, "Sub"), (top, "Top")):
        TDataStd_Name.Set(label, name)
    tool.AddComponent(sub, box, _at(0))
    tool.AddComponent(sub, box, _at(50))
    tool.AddComponent(sub, cyl, _at(100))
    tool.AddComponent(top, sub, _at(0))
    tool.AddComponent(top, sub, _at(500))
    tool.AddComponent(top, cyl, _at(900))
    tool.UpdateAssemblies()
    return _write(doc, str(tmp_path / "assembly.step"))


@pytest.fixture
def named_box(tmp_path) -> str:
    """A loose part file called "Box", as exported next to an assembly that already uses a part of that name."""
    doc = TDocStd_Document("test-part")
    tool = XCAFDoc_DocumentTool.ShapeTool(doc.Main())
    TDataStd_Name.Set(tool.AddShape(BRepPrimAPI_MakeBox(10, 20, 30).Shape(), False), "Box")
    return _write(doc, str(tmp_path / "box.step"))
