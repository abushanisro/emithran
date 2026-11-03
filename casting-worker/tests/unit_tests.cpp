// Unit tests of measure() on shapes built in memory (roadmap B1.2, D108): validity, healing and what is reported
// when a measurement is not meaningful. A STEP round trip cannot reach these cases: OCCT's reader already repairs
// small defects and does not import an open "solid". Exit code 0 when all pass.

#include "../src/json.hpp"
#include "../src/model.hpp"

#include <BRepPrimAPI_MakeBox.hxx>
#include <BRep_Builder.hxx>
#include <TDocStd_Document.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <gp_Pnt.hxx>

#include <algorithm>
#include <cmath>
#include <iostream>
#include <limits>

namespace {

int failures = 0;

std::string show(const std::optional<double>& v) { return v ? std::to_string(*v) : "null"; }

void check(const char* name, bool ok, const PartProperties& p) {
  std::cout << (ok ? "PASS  " : "FAIL  ") << name;
  if (!ok) {
    std::cout << "  (as read " << p.valid_as_read << ", healed " << p.healed << ", valid " << p.valid << ", volume "
              << show(p.volume) << ", area " << show(p.area) << ", solids " << p.solids << ", problems";
    for (const std::string& problem : p.problems) std::cout << ' ' << problem;
    std::cout << ')';
  }
  std::cout << '\n';
  if (!ok) ++failures;
}

bool near(const std::optional<double>& v, double expected) { return v && std::abs(*v - expected) < 0.01; }

bool has(const PartProperties& p, const char* problem) {
  return std::find(p.problems.begin(), p.problems.end(), problem) != p.problems.end();
}

PartProperties measure_shape(const TopoDS_Shape& shape) {
  occ::handle<TDocStd_Document> doc;
  XCAFApp_Application::GetApplication()->NewDocument("MDTV-XCAF", doc);
  return measure(XCAFDoc_DocumentTool::ShapeTool(doc->Main())->AddShape(shape, false));
}

// The faces of a 40 mm cube as a shell: face `reversed` turned inside out, face `missing` left out (-1: none).
TopoDS_Shell cube_shell(int reversed, int missing) {
  BRep_Builder builder;
  TopoDS_Shell shell;
  builder.MakeShell(shell);
  int i = 0;
  for (TopExp_Explorer it(BRepPrimAPI_MakeBox(40.0, 40.0, 40.0).Shape(), TopAbs_FACE); it.More(); it.Next(), ++i) {
    if (i == missing) continue;
    builder.Add(shell, i == reversed ? it.Current().Reversed() : it.Current());
  }
  return shell;
}

TopoDS_Shape solid_of(const TopoDS_Shell& shell) {
  BRep_Builder builder;
  TopoDS_Solid solid;
  builder.MakeSolid(solid);
  builder.Add(solid, shell);
  return solid;
}

}  // namespace

int main() {
  const PartProperties good = measure_shape(solid_of(cube_shell(-1, -1)));
  check("valid cube: valid as read and measured, 64,000 mm3, no problems",
        good.valid_as_read && good.valid && !good.healed && near(good.volume, 64000) && good.problems.empty(), good);

  const PartProperties flipped = measure_shape(solid_of(cube_shell(2, -1)));
  check("one face inside out: invalid as read, healed, valid, 64,000 mm3",
        !flipped.valid_as_read && flipped.healed && flipped.valid && near(flipped.volume, 64000), flipped);

  const PartProperties open = measure_shape(solid_of(cube_shell(-1, 5)));
  check("solid with a missing face: invalid, not healed (no solid lost to a 'repair'), invalid_geometry",
        !open.valid_as_read && !open.healed && !open.valid && has(open, "invalid_geometry"), open);
  check("solid with a missing face: no volume or centre, area of the 5 faces (8,000 mm2) still reported",
        !open.volume && !open.centre && near(open.area, 8000), open);

  const PartProperties shell = measure_shape(cube_shell(-1, 5));
  check("valid open shell: valid, no solid, no volume, area 8,000 mm2, problem no_solid",
        shell.valid && shell.solids == 0 && !shell.volume && near(shell.area, 8000) && has(shell, "no_solid"), shell);

  BRep_Builder builder;
  TopoDS_Compound two;
  builder.MakeCompound(two);
  builder.Add(two, BRepPrimAPI_MakeBox(10.0, 20.0, 30.0).Shape());
  builder.Add(two, BRepPrimAPI_MakeBox(gp_Pnt(100, 0, 0), 10.0, 10.0, 10.0).Shape());
  const PartProperties multi = measure_shape(two);
  check("part of two separate solids: 2 solids, volumes added (6,000 + 1,000 mm3)",
        multi.solids == 2 && near(multi.volume, 7000), multi);

  TopoDS_Compound nothing;
  builder.MakeCompound(nothing);
  const PartProperties empty = measure_shape(nothing);
  check("empty part: no solid, every measurement null, no crash",
        empty.solids == 0 && !empty.volume && !empty.area && !empty.box_min && !empty.oriented_size, empty);

  JsonWriter json;
  json.begin_array().value(std::optional<double>()).value(std::numeric_limits<double>::quiet_NaN()).value(1.5).end_array();
  const bool nulls = json.str() == "[null,null,1.5]";
  std::cout << (nulls ? "PASS  " : "FAIL  ") << "JSON: an empty value and a non-finite number are written as null"
            << (nulls ? "" : "  (" + json.str() + ")") << '\n';
  if (!nulls) ++failures;

  std::cout << (failures == 0 ? "OK" : "FAILED") << '\n';
  return failures == 0 ? 0 : 1;
}
