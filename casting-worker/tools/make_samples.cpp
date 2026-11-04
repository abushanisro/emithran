// make-samples <out-dir>: synthetic STEP files with known answers for the worker's checks (roadmap B1.2).
// Expected values are in geometry-worker/tests/expected.json, worked out by hand from these dimensions.
//   box.step              100 x 50 x 20 mm box
//   plate-with-hole.step  100 x 60 x 20 mm plate with a 20 mm through hole (cylindrical, along Z)
//   cylinder.step         radius 25, height 40
//   assembly.step         pump-assembly: housing x1, bolt-set x2; bolt-set: bolt x4 (8 bolts in total)
//   open-shell.step       a "solid" whose shell lacks one face: OCCT's reader does not make it a solid again
//   flat-face.step        a single face, no solid
//   tube.step             hollow cylinder: outer radius 30, inner 20, height 50
//   two-blocks.step       one part (one STEP product) made of two separate solids: 10 x 20 x 30 and 10 x 10 x 10 mm
//   box-inch.step         the 100 x 50 x 20 mm box written in inches (must read back in millimetres)
//   mixed.step            assembly of a good box and a part that is only an open shell (status partial)
//   hollow-box.step       100 x 60 x 40 mm block with a closed 60 x 20 x 20 mm void in its middle (needs a core)
//   step-block.step       100 x 60 x 40 mm block, upper half of the right half removed: an L step, one concave edge
//   fillet-block.step     100 x 60 x 30 mm block, one vertical edge rounded (r 5)
//   holes.step            120 x 80 x 40 mm block with a through, blind, counterbored, 3-step, grooved and cross hole
//   boss.step             100 x 80 x 10 mm plate with a Ø30 x 15 boss
//   combo.step            100 x 60 x 40 mm block with a closed void and a Ø8 hole into it from outside (one core)
//   taper-3.step          cone frustum, radius 30 at the base, height 40, its side tapering 3.0 degrees from the axis (draft, S4)
//   slot-block.step       100 x 60 x 40 block with a 60 x 20 x 20 slot cut in from the x = 0 face (y 20..40, z 10..30), open at one end (undercuts, S5)
//   taper-04.step        the same with a 0.4 degree taper (under the 0.5 degree limit of the published rules)
//   bolt.step             the assembly's bolt alone (radius 5, height 30, named "bolt")
// make-samples --big <out-dir> <parts>: big-assembly.step, the large-file timing sample (S6, see write_big).

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRep_Tool.hxx>
#include <TopExp.hxx>
#include <DESTEP_Parameters.hxx>
#include <TopoDS_Compound.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Builder.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPCAFControl_Writer.hxx>
#include <STEPControl_Writer.hxx>
#include <TDataStd_Name.hxx>
#include <TDocStd_Document.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <gp_Ax2.hxx>
#include <gp_Pln.hxx>
#include <gp_Trsf.hxx>

#include <cstdlib>
#include <iostream>
#include <string>
#include <cmath>

namespace {

std::string dir;

// `one_product`: keep a compound of solids as one product (a multi-body part) instead of OCCT's default of
// writing it as an assembly of one product per solid.
bool write_shape(const TopoDS_Shape& shape, const char* name,
                 UnitsMethods_LengthUnit unit = UnitsMethods_LengthUnit_Millimeter, bool one_product = false) {
  DESTEP_Parameters params;
  params.WriteUnit = unit;
  if (one_product) params.WriteAssembly = DESTEP_Parameters::WriteMode_Assembly_Off;
  STEPControl_Writer writer;
  writer.Transfer(shape, STEPControl_AsIs, params);
  return writer.Write((dir + "/" + name).c_str()) == IFSelect_RetDone;
}

// An L-shaped step: a 100 x 60 x 40 mm block with the upper half of its right half removed (one concave edge).
TopoDS_Shape step_block() {
  return BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(100.0, 60.0, 40.0).Shape(),
                         BRepPrimAPI_MakeBox(gp_Pnt(50.0, -1.0, 20.0), 51.0, 62.0, 21.0).Shape())
      .Shape();
}

// A 100 x 60 x 30 mm block with the vertical edge at x = 0, y = 0 rounded with a 5 mm radius.
TopoDS_Shape fillet_block() {
  const TopoDS_Shape box = BRepPrimAPI_MakeBox(100.0, 60.0, 30.0).Shape();
  BRepFilletAPI_MakeFillet fillet(box);
  for (TopExp_Explorer it(box, TopAbs_EDGE); it.More(); it.Next()) {
    const TopoDS_Edge edge = TopoDS::Edge(it.Current());
    TopoDS_Vertex a, b;
    TopExp::Vertices(edge, a, b);
    const gp_Pnt pa = BRep_Tool::Pnt(a), pb = BRep_Tool::Pnt(b);
    if (pa.X() == 0 && pa.Y() == 0 && pb.X() == 0 && pb.Y() == 0) {
      fillet.Add(5.0, edge);
      break;
    }
  }
  return fillet.Shape();
}

// A cone frustum on the z axis: radius 30 at z = 0, height 40, the side leaning `degrees` from the axis (the draft of that face along z).
TopoDS_Shape taper(double degrees) {
  const double base = 30.0, height = 40.0;
  return BRepPrimAPI_MakeCone(base, base - height * std::tan(degrees * 3.14159265358979323846 / 180.0), height).Shape();
}

// A 100 x 60 x 40 mm block with a 60 x 20 x 20 mm slot cut in from the x = 0 face (x 0..60, y 20..40, z 10..30): open at one end only.
TopoDS_Shape slot_block() {
  return BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(100.0, 60.0, 40.0).Shape(), BRepPrimAPI_MakeBox(gp_Pnt(-1.0, 20.0, 10.0), 61.0, 20.0, 20.0).Shape()).Shape();
}

TopoDS_Shape cylinder_z(double x, double y, double r, double z0, double z1) {
  return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, z0), gp_Dir(0, 0, 1)), r, z1 - z0).Shape();
}

// A 120 x 80 x 40 mm block with one hole of each kind (z up, holes from the top unless said):
//   (20, 20) Ø10 through;  (50, 20) Ø12 blind, 15 deep;  (90, 20) counterbore Ø20 x 8 over Ø10 through;
//   (30, 60) three steps Ø24 x 6, Ø16 x 12, Ø8 through;  (90, 60) Ø10 through with a Ø16 groove from z 15 to 25;
//   a Ø8 cross hole along x at y 40, z 20.
TopoDS_Shape holes() {
  TopoDS_Shape part = BRepPrimAPI_MakeBox(120.0, 80.0, 40.0).Shape();
  const TopoDS_Shape tools[] = {
      cylinder_z(20, 20, 5, -1, 41),
      cylinder_z(50, 20, 6, 25, 41),
      cylinder_z(90, 20, 10, 32, 41),
      cylinder_z(90, 20, 5, -1, 41),
      cylinder_z(30, 60, 12, 34, 41),
      cylinder_z(30, 60, 8, 22, 41),
      cylinder_z(30, 60, 4, -1, 41),
      cylinder_z(90, 60, 5, -1, 41),
      cylinder_z(90, 60, 8, 15, 25),
      BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(-1, 40, 20), gp_Dir(1, 0, 0)), 4.0, 122.0).Shape(),
  };
  for (const TopoDS_Shape& t : tools) part = BRepAlgoAPI_Cut(part, t).Shape();
  return part;
}

// A 100 x 80 x 10 mm plate with a Ø30 boss 15 high on top at (50, 40): an outer Ring.
TopoDS_Shape boss() {
  return BRepAlgoAPI_Fuse(BRepPrimAPI_MakeBox(100.0, 80.0, 10.0).Shape(), cylinder_z(50, 40, 15, 10, 25)).Shape();
}

// A 100 x 60 x 40 mm block with a closed 10 x 10 x 30 mm void at x 45..55, y 25..35, z 5..35 and a Ø8 hole along x
// at y 30, z 20 from the outside (x 0) into the void: one core makes both (a ComboVoid).
// Parting lines (D144). A rod lying along x (Ø20 x 100, axis at y 30, z 30): widest across y at its axis.
TopoDS_Shape rod() {
  return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 30, 30), gp_Dir(1, 0, 0)), 10.0, 100.0).Shape();
}

// Two plates in steps: 60 x 50 x 10 at the bottom, 50 x 50 x 10 on top of its last 10 mm and beyond (x 50..100). Seen
// from above it covers 100 x 50, but no flat section does: a stepped parting line is needed.
TopoDS_Shape stepped_block() {
  return BRepAlgoAPI_Fuse(BRepPrimAPI_MakeBox(60.0, 50.0, 10.0).Shape(),
                          BRepPrimAPI_MakeBox(gp_Pnt(50.0, 0.0, 10.0), 50.0, 50.0, 10.0).Shape())
      .Shape();
}

TopoDS_Shape combo() {
  const TopoDS_Shape block = BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(100.0, 60.0, 40.0).Shape(),
                                             BRepPrimAPI_MakeBox(gp_Pnt(45.0, 25.0, 5.0), 10.0, 10.0, 30.0).Shape())
                                 .Shape();
  return BRepAlgoAPI_Cut(block, BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(-1, 30, 20), gp_Dir(1, 0, 0)), 4.0, 47.0).Shape())
      .Shape();
}

TopoDS_Shape two_blocks() {
  BRep_Builder builder;
  TopoDS_Compound both;
  builder.MakeCompound(both);
  builder.Add(both, BRepPrimAPI_MakeBox(10.0, 20.0, 30.0).Shape());
  builder.Add(both, BRepPrimAPI_MakeBox(gp_Pnt(100.0, 0.0, 0.0), 10.0, 10.0, 10.0).Shape());
  return both;
}

TopLoc_Location moved(double x, double y, double z) {
  gp_Trsf t;
  t.SetTranslation(gp_Vec(x, y, z));
  return TopLoc_Location(t);
}

bool write_assembly() {
  occ::handle<TDocStd_Document> doc;
  XCAFApp_Application::GetApplication()->NewDocument("MDTV-XCAF", doc);
  const occ::handle<XCAFDoc_ShapeTool> shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());

  const TDF_Label housing = shapes->AddShape(BRepPrimAPI_MakeBox(100.0, 50.0, 20.0).Shape(), false);
  TDataStd_Name::Set(housing, "housing");
  const TDF_Label bolt = shapes->AddShape(BRepPrimAPI_MakeCylinder(5.0, 30.0).Shape(), false);
  TDataStd_Name::Set(bolt, "bolt");

  const TDF_Label bolt_set = shapes->NewShape();
  TDataStd_Name::Set(bolt_set, "bolt-set");
  for (int i = 0; i < 4; ++i) shapes->AddComponent(bolt_set, bolt, moved(10.0 + 20.0 * i, 10.0, 20.0));

  const TDF_Label top = shapes->NewShape();
  TDataStd_Name::Set(top, "pump-assembly");
  shapes->AddComponent(top, housing, TopLoc_Location());
  shapes->AddComponent(top, bolt_set, moved(0.0, 0.0, 0.0));
  shapes->AddComponent(top, bolt_set, moved(0.0, 30.0, 0.0));
  shapes->UpdateAssemblies();

  STEPCAFControl_Writer writer;
  writer.SetNameMode(true);
  return writer.Transfer(doc, STEPControl_AsIs) && writer.Write((dir + "/assembly.step").c_str()) == IFSelect_RetDone;
}

// The assembly's bolt on its own, named as there: exported next to its assembly, it must not be counted twice.
bool write_bolt() {
  occ::handle<TDocStd_Document> doc;
  XCAFApp_Application::GetApplication()->NewDocument("MDTV-XCAF", doc);
  const TDF_Label bolt =
      XCAFDoc_DocumentTool::ShapeTool(doc->Main())->AddShape(BRepPrimAPI_MakeCylinder(5.0, 30.0).Shape(), false);
  TDataStd_Name::Set(bolt, "bolt");
  STEPCAFControl_Writer writer;
  writer.SetNameMode(true);
  return writer.Transfer(doc, STEPControl_AsIs) && writer.Write((dir + "/bolt.step").c_str()) == IFSelect_RetDone;
}

bool write_mixed() {
  occ::handle<TDocStd_Document> doc;
  XCAFApp_Application::GetApplication()->NewDocument("MDTV-XCAF", doc);
  const occ::handle<XCAFDoc_ShapeTool> shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  const TDF_Label good = shapes->AddShape(BRepPrimAPI_MakeBox(100.0, 50.0, 20.0).Shape(), false);
  TDataStd_Name::Set(good, "good-box");
  BRep_Builder builder;
  TopoDS_Shell shell;
  builder.MakeShell(shell);
  int kept = 0;
  for (TopExp_Explorer it(BRepPrimAPI_MakeBox(40.0, 40.0, 40.0).Shape(), TopAbs_FACE); it.More() && kept < 5;
       it.Next(), ++kept) {
    builder.Add(shell, it.Current());
  }
  const TDF_Label open = shapes->AddShape(shell, false);
  TDataStd_Name::Set(open, "open-shell");
  const TDF_Label top = shapes->NewShape();
  TDataStd_Name::Set(top, "mixed-assembly");
  shapes->AddComponent(top, good, TopLoc_Location());
  shapes->AddComponent(top, open, moved(200.0, 0.0, 0.0));
  shapes->UpdateAssemblies();
  STEPCAFControl_Writer writer;
  writer.SetNameMode(true);
  return writer.Transfer(doc, STEPControl_AsIs) && writer.Write((dir + "/mixed.step").c_str()) == IFSelect_RetDone;
}

// The large-file timing sample (roadmap S6): an assembly of `parts` distinct plates, each 200 x 150 x 20 mm drilled
// with 10 x 8 through holes whose radius differs per part, so no part is an instance of another and the file is as
// large as its geometry.
bool write_big(int parts) {
  occ::handle<TDocStd_Document> doc;
  XCAFApp_Application::GetApplication()->NewDocument("MDTV-XCAF", doc);
  const occ::handle<XCAFDoc_ShapeTool> shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  const TDF_Label top = shapes->NewShape();
  TDataStd_Name::Set(top, "big-assembly");
  for (int k = 0; k < parts; ++k) {
    BRep_Builder builder;
    TopoDS_Compound drills;
    builder.MakeCompound(drills);
    const double r = 3.0 + 0.01 * k;
    for (int i = 0; i < 10; ++i)
      for (int j = 0; j < 8; ++j) builder.Add(drills, cylinder_z(15.0 + 19.0 * i, 12.0 + 18.0 * j, r, -1.0, 21.0));
    const TDF_Label plate =
        shapes->AddShape(BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(200.0, 150.0, 20.0).Shape(), drills).Shape(), false);
    TDataStd_Name::Set(plate, ("plate-" + std::to_string(k + 1)).c_str());
    shapes->AddComponent(top, plate, moved(0.0, 0.0, 30.0 * k));
  }
  shapes->UpdateAssemblies();
  STEPCAFControl_Writer writer;
  writer.SetNameMode(true);
  return writer.Transfer(doc, STEPControl_AsIs) &&
         writer.Write((dir + "/big-assembly.step").c_str()) == IFSelect_RetDone;
}

// A box whose shell keeps only five of its six faces: not closed, so not a valid solid.
TopoDS_Shape broken_solid() {
  BRep_Builder builder;
  TopoDS_Shell shell;
  builder.MakeShell(shell);
  int kept = 0;
  for (TopExp_Explorer it(BRepPrimAPI_MakeBox(40.0, 40.0, 40.0).Shape(), TopAbs_FACE); it.More() && kept < 5;
       it.Next(), ++kept) {
    builder.Add(shell, it.Current());
  }
  TopoDS_Solid solid;
  builder.MakeSolid(solid);
  builder.Add(solid, shell);
  return solid;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc == 4 && std::string(argv[1]) == "--big") {
    dir = argv[2];
    const int parts = std::atoi(argv[3]);
    if (parts < 1 || parts > 10000) {
      std::cerr << "parts: 1 to 10000\n";
      return 64;
    }
    return write_big(parts) ? 0 : 1;
  }
  if (argc != 2) {
    std::cerr << "usage: make-samples <out-dir> | make-samples --big <out-dir> <parts>\n";
    return 64;
  }
  dir = argv[1];
  const TopoDS_Shape plate = BRepPrimAPI_MakeBox(100.0, 60.0, 20.0).Shape();
  const TopoDS_Shape hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(50.0, 30.0, -1.0), gp_Dir(0, 0, 1)), 10.0, 22.0).Shape();
  const bool ok = write_shape(BRepPrimAPI_MakeBox(100.0, 50.0, 20.0).Shape(), "box.step") &&
                  write_shape(BRepAlgoAPI_Cut(plate, hole).Shape(), "plate-with-hole.step") &&
                  write_shape(BRepPrimAPI_MakeCylinder(25.0, 40.0).Shape(), "cylinder.step") &&
                  write_assembly() && write_shape(broken_solid(), "open-shell.step") &&
                  write_shape(BRepBuilderAPI_MakeFace(gp_Pln(), 0.0, 10.0, 0.0, 10.0).Shape(), "flat-face.step") &&
                  write_shape(BRepAlgoAPI_Cut(BRepPrimAPI_MakeCylinder(30.0, 50.0).Shape(),
                                              BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, -1), gp_Dir(0, 0, 1)), 20.0, 52.0).Shape())
                                  .Shape(),
                              "tube.step") &&
                  write_shape(two_blocks(), "two-blocks.step", UnitsMethods_LengthUnit_Millimeter, true) &&
                  write_shape(BRepPrimAPI_MakeBox(100.0, 50.0, 20.0).Shape(), "box-inch.step", UnitsMethods_LengthUnit_Inch) &&
                  write_mixed() &&
                  write_shape(BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(100.0, 60.0, 40.0).Shape(),
                                              BRepPrimAPI_MakeBox(gp_Pnt(20.0, 20.0, 10.0), 60.0, 20.0, 20.0).Shape())
                                  .Shape(),
                              "hollow-box.step") &&
                  write_shape(step_block(), "step-block.step") && write_shape(fillet_block(), "fillet-block.step") &&
                  write_shape(holes(), "holes.step") && write_shape(boss(), "boss.step") &&
                  write_shape(combo(), "combo.step") && write_bolt() && write_shape(rod(), "rod.step") &&
                  write_shape(stepped_block(), "stepped-block.step") &&
                  write_shape(taper(3.0), "taper-3.step") && write_shape(taper(0.4), "taper-04.step") &&
                  write_shape(slot_block(), "slot-block.step");
  if (!ok) {
    std::cerr << "could not write the samples\n";
    return 1;
  }
  return 0;
}
