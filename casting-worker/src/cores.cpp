// Cores as their own bodies (roadmap H3, D145). A core fills the air its features enclose: the faces of the voids
// and hidden holes linked to it (F3), sewn into a shell. Where the core leaves the part (a hole's opening, where its
// print sits in the mould) the shell has a free loop: a flat loop is closed by a plane, any other by a filling
// surface. The closed shells become solids, exact on the part's own surfaces: the core's volume, size and centre
// are taken from them instead of the ray grid, and they are written as parts/<part>-cores.glb (one node per core,
// "core <n>") for the viewer. A core whose faces cannot be closed keeps its ray measurements and says why.

#include "model.hpp"

#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepOffsetAPI_MakeFilling.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <NCollection_HSequence.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <ShapeAnalysis_FreeBounds.hxx>
#include <ShapeFix_Solid.hxx>
#include <TDataStd_Name.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>

#include <algorithm>
#include <cmath>
#include <functional>
#include <map>
#include <set>

namespace {

constexpr double kSewing = 1e-3;  // mm

// The core a feature names (parameter `core`, 1-based), else 0.
int core_of(const Feature& f) {
  for (const auto& [name, value] : f.parameters) {
    if (name == "core") return static_cast<int>(value);
  }
  return 0;
}

// The faces of each core: of every feature linked to it and of the features below those.
std::map<int, std::set<int>> faces_by_core(const std::vector<Feature>& features) {
  std::map<std::string, const Feature*> by_id;
  for (const Feature& f : features) by_id[f.id] = &f;
  std::map<int, std::set<int>> out;
  for (const Feature& f : features) {
    for (const Feature* up = &f; up; up = up->parent.empty() ? nullptr : by_id.at(up->parent)) {
      const int core = core_of(*up);
      if (core > 0) {
        out[core].insert(f.faces.begin(), f.faces.end());
        break;
      }
    }
  }
  return out;
}

// The solid of one core from its faces, or the reason there is none.
std::optional<TopoDS_Shape> body(const std::vector<TopoDS_Face>& faces, std::string& problem) {
  BRepBuilderAPI_Sewing sewing(kSewing);
  for (const TopoDS_Face& f : faces) sewing.Add(f);
  sewing.Perform();
  const TopoDS_Shape sewn = sewing.SewedShape();
  // The openings: the sewing's free edges chained into loops (a single sewn face is no shell to analyse).
  const occ::handle<NCollection_HSequence<TopoDS_Shape>> free = new NCollection_HSequence<TopoDS_Shape>();
  for (int i = 1; i <= sewing.NbFreeEdges(); ++i) free->Append(sewing.FreeEdge(i));
  const occ::handle<NCollection_HSequence<TopoDS_Shape>> loops =
      ShapeAnalysis_FreeBounds::ConnectEdgesToWires(free, kSewing, false);
  // Each opening closed: flat by a plane, otherwise by a filling surface through its edges.
  BRepBuilderAPI_Sewing closing(kSewing);
  closing.Add(sewn);
  for (int i = 1; i <= loops->Length(); ++i) {
    const TopoDS_Wire wire = TopoDS::Wire(loops->Value(i));
    if (!BRep_Tool::IsClosed(wire)) {
      problem = "open_boundary";
      return std::nullopt;
    }
    const BRepBuilderAPI_MakeFace flat(wire, true);
    if (flat.IsDone()) {
      closing.Add(flat.Face());
      continue;
    }
    BRepOffsetAPI_MakeFilling filling;
    for (TopExp_Explorer e(wire, TopAbs_EDGE); e.More(); e.Next()) filling.Add(TopoDS::Edge(e.Current()), GeomAbs_C0);
    filling.Build();
    if (!filling.IsDone()) {
      problem = "opening_not_closed";
      return std::nullopt;
    }
    closing.Add(filling.Shape());
  }
  closing.Perform();
  TopoDS_Compound solids;
  BRep_Builder builder;
  builder.MakeCompound(solids);
  ShapeFix_Solid fix;
  int count = 0;
  for (TopExp_Explorer s(closing.SewedShape(), TopAbs_SHELL); s.More(); s.Next()) {
    builder.Add(solids, fix.SolidFromShell(TopoDS::Shell(s.Current())));
    ++count;
  }
  GProp_GProps props;
  if (count > 0) BRepGProp::VolumeProperties(solids, props);
  if (count == 0 || !BRepCheck_Analyzer(solids).IsValid() || props.Mass() <= 0) {
    problem = "not_a_solid";
    return std::nullopt;
  }
  return solids;
}

}  // namespace

void build_cores(const TDF_Label& part, PartProperties& p, const std::string& out_dir) {
  CastingProperties& c = *p.casting;
  const TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(part);
  std::vector<TopoDS_Face> all;
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) all.push_back(TopoDS::Face(it.Current()));

  occ::handle<TDocStd_Document> doc;
  XCAFApp_Application::GetApplication()->NewDocument("MDTV-XCAF", doc);
  const occ::handle<XCAFDoc_ShapeTool> shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  NCollection_Sequence<TDF_Label> roots;
  const double size = std::hypot((*p.box_max)[0] - (*p.box_min)[0], (*p.box_max)[1] - (*p.box_min)[1],
                                 (*p.box_max)[2] - (*p.box_min)[2]);
  for (const auto& [n, faces] : faces_by_core(p.features)) {
    if (n > static_cast<int>(c.cores.size())) continue;
    CoreProperties& core = c.cores[n - 1];
    core.faces.assign(faces.begin(), faces.end());
    std::vector<TopoDS_Face> own;
    for (const int f : faces) own.push_back(all.at(f));
    std::string problem;
    const std::optional<TopoDS_Shape> solid = body(own, problem);
    if (!solid) {
      core.problem = problem;
      continue;
    }
    GProp_GProps props;
    BRepGProp::VolumeProperties(*solid, props);
    Bnd_Box box;
    BRepBndLib::AddOptimal(*solid, box, false, false);
    double x0, y0, z0, x1, y1, z1;
    box.Get(x0, y0, z0, x1, y1, z1);
    core.volume = props.Mass();
    core.centre = {props.CentreOfMass().X(), props.CentreOfMass().Y(), props.CentreOfMass().Z()};
    core.size = {x1 - x0, y1 - y0, z1 - z0};
    std::sort(core.size.begin(), core.size.end(), std::greater<double>());
    core.body = true;
    BRepMesh_IncrementalMesh(*solid, std::max(0.01, 0.001 * size), false, 0.5, true);
    const TDF_Label label = shapes->AddShape(*solid, false);
    TDataStd_Name::Set(label, ("core " + std::to_string(n)).c_str());
    roots.Append(label);
  }
  if (roots.IsEmpty()) return;
  std::string file = "parts/" + p.id + "-cores.glb";
  std::replace(file.begin(), file.end(), ':', '-');
  if (write_glb(doc, roots, out_dir + "/" + file)) {
    c.cores_glb = file;
  } else {
    p.problems.push_back("failed:cores_glb");
  }
}
