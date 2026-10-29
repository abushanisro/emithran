"""Writes a synthetic assembly of N distinct parts (a plate with a grid of holes, every plate different) as one STEP file, with
pythonocc. Used only by bench.py. Run inside the py-occt image: python make_assembly.py <out.step> <parts>"""
import sys

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.gp import gp_Ax2, gp_Dir, gp_Pnt
from OCC.Core.IFSelect import IFSelect_RetDone
from OCC.Core.STEPCAFControl import STEPCAFControl_Writer
from OCC.Core.STEPControl import STEPControl_AsIs
from OCC.Core.TCollection import TCollection_ExtendedString
from OCC.Core.TDataStd import TDataStd_Name
from OCC.Core.TDocStd import TDocStd_Document
from OCC.Core.TopLoc import TopLoc_Location
from OCC.Core.XCAFApp import XCAFApp_Application
from OCC.Core.XCAFDoc import XCAFDoc_DocumentTool

out, count = sys.argv[1], int(sys.argv[2])
app = XCAFApp_Application.GetApplication()
doc = TDocStd_Document(TCollection_ExtendedString("MDTV-XCAF"))
app.NewDocument(TCollection_ExtendedString("MDTV-XCAF"), doc)
tool = XCAFDoc_DocumentTool.ShapeTool(doc.Main())
root = tool.NewShape()
TDataStd_Name.Set(root, TCollection_ExtendedString("Bench"))
for i in range(count):
    plate = BRepPrimAPI_MakeBox(100 + i, 60 + i % 7, 4).Shape()
    for h in range(8):
        hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(10 + 11 * h, 10 + (i % 5) * 6, -1), gp_Dir(0, 0, 1)), 2.5, 8).Shape()
        plate = BRepAlgoAPI_Cut(plate, hole).Shape()
    label = tool.AddShape(plate, False)
    TDataStd_Name.Set(label, TCollection_ExtendedString(f"Plate {i}"))
    tool.AddComponent(root, label, TopLoc_Location())
tool.UpdateAssemblies()
writer = STEPCAFControl_Writer()
assert writer.Transfer(doc, STEPControl_AsIs)
assert writer.Write(out) == IFSelect_RetDone
