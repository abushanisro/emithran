// Casting features of one part (roadmap F1/F2, D132–D134), on the exact B-rep, in the part's own coordinates.
// Feature types are those of the sand-casting operations catalogue; definitions follow the geometric cost drivers (GCDs) of the staged sand-casting catalogue:
//  - PlanarFace: a plane; CurvedWall: a cylinder, an extrusion, or a cone drafted 5° or less; CurvedSurface: any
//    other face (cones over 5°, spheres, tori, revolutions, free-form).
//  - SharpEdge: two faces meeting with a crease (not tangent, continuity C0 after EncodeRegularity at 1°); edges
//    that continue one another smoothly (tangent at the shared vertex) with the same convexity are one feature.
//    Convex: the second face's outward normal points away from the first face's material across the edge.
//  - Holes: full 360° concave cylinders on one axis line (any direction), split faces merged, steps whose axial
//    extents touch chained into one hole. One diameter: SimpleHole; diameters only decreasing (or only increasing)
//    along the axis: MultiStepHole, a SimpleHole child per step; otherwise RingedHole: a SimpleHole child for the
//    smallest bore and a Ring child per wider groove. Through when the axis is in air just beyond both ends.
//    Children: the walls (CurvedWall), step and bottom faces (PlanarFace), drill points (CurvedSurface), rounds and
//    chamfers at an open end (Edge), and the sharp edges on its faces (Edge).
//  - Ring (outer diameter): full 360° convex cylinders on one axis with coaxial circular end faces (risers); children
//    the treads (CurvedWall) and risers (PlanarFace).
//  - Hidden (F3, with the casting measurements): a face whose points, moved just into the air, see metal both ways
//    along the draw axis (most of up to 9 mesh samples). A hole with a hidden face has `hidden` 1. Connected hidden
//    faces that belong to no hole or ring are a Void. A Void with the holes it touches is a ComboVoid (made with one
//    core), the holes and voids its children. Each, and a hidden hole on its own, is linked to the core (D127) whose
//    centre lies in its box.
// Faces are numbered in TopExp_Explorer order, the order OCCT's glTF writer emits one primitive per face in.

#include "model.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Curve2d.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <BRepGProp.hxx>
#include <BRepLib.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <IntCurvesFace_ShapeIntersector.hxx>
#include <Poly_PolygonOnTriangulation.hxx>
#include <Poly_Triangulation.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <Bnd_Box.hxx>
#include <gp_Cone.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Lin.hxx>
#include <gp_Torus.hxx>

#include <algorithm>
#include <cmath>
#include <functional>
#include <map>
#include <numeric>
#include <set>

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kTangent = 1.0 * kPi / 180.0;  // faces within 1° of each other across an edge are tangent
constexpr double kDraft = 5.0 * kPi / 180.0;    // CurvedWall: drafted at most 5°
constexpr double kChain = 5.0 * kPi / 180.0;    // sharp edges continue one another within 5°
constexpr double kAxis = 0.1 * kPi / 180.0;     // coaxial: directions within 0.1°

using FaceMap = NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>;

const char* face_type(const TopoDS_Face& face) {
  const BRepAdaptor_Surface s(face, false);
  switch (s.GetType()) {
    case GeomAbs_Plane: return "PlanarFace";
    case GeomAbs_Cylinder:
    case GeomAbs_SurfaceOfExtrusion: return "CurvedWall";
    case GeomAbs_Cone: return std::abs(s.Cone().SemiAngle()) <= kDraft ? "CurvedWall" : "CurvedSurface";
    default: return "CurvedSurface";
  }
}

double area_of(const TopoDS_Shape& s) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(s, props);
  return props.Mass();
}

// The outward normal of a face at a (u, v).
gp_Dir outward_at(const TopoDS_Face& face, double u, double v) {
  gp_Pnt point;
  gp_Vec du, dv;
  BRepAdaptor_Surface(face).D1(u, v, point, du, dv);
  gp_Vec n = du.Crossed(dv);
  if (face.Orientation() == TopAbs_REVERSED) n.Reverse();
  return gp_Dir(n);
}

// The outward normal of a face at the point of an edge (the edge's parameter t), from the edge's curve on the face.
gp_Dir outward(const TopoDS_Face& face, const TopoDS_Edge& edge, double t) {
  const gp_Pnt2d p = BRepAdaptor_Curve2d(edge, face).Value(t);
  return outward_at(face, p.X(), p.Y());
}

// The edge's direction as the boundary of `face` runs: the face's material lies to the left, seen from outside.
gp_Vec boundary_direction(const TopoDS_Face& face, const TopoDS_Edge& edge, double t) {
  gp_Pnt p;
  gp_Vec d;
  BRepAdaptor_Curve(edge).D1(t, p, d);
  for (TopExp_Explorer it(face, TopAbs_EDGE); it.More(); it.Next()) {
    if (it.Current().IsSame(edge)) {
      if (it.Current().Orientation() == TopAbs_REVERSED) d.Reverse();
      break;
    }
  }
  return d;
}

// The edge as a polyline: its nodes on the face's mesh, else 16 segments of its curve.
std::vector<Xyz> polyline(const TopoDS_Edge& edge, const TopoDS_Face& face) {
  std::vector<Xyz> points;
  TopLoc_Location location;
  const occ::handle<Poly_Triangulation> t = BRep_Tool::Triangulation(face, location);
  if (!t.IsNull()) {
    const occ::handle<Poly_PolygonOnTriangulation>& poly = BRep_Tool::PolygonOnTriangulation(edge, t, location);
    if (!poly.IsNull()) {
      const gp_Trsf move = location.Transformation();
      for (int i = poly->Nodes().Lower(); i <= poly->Nodes().Upper(); ++i) {
        const gp_Pnt p = t->Node(poly->Nodes()(i)).Transformed(move);
        points.push_back({p.X(), p.Y(), p.Z()});
      }
      return points;
    }
  }
  const BRepAdaptor_Curve c(edge);
  for (int i = 0; i <= 16; ++i) {
    const gp_Pnt p = c.Value(c.FirstParameter() + (c.LastParameter() - c.FirstParameter()) * i / 16.0);
    points.push_back({p.X(), p.Y(), p.Z()});
  }
  return points;
}

using EdgeFaces = NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher>;

struct Sharp {
  TopoDS_Edge edge;
  int f1, f2;  // the two faces (indices)
  bool convex;
  double length;
  std::vector<Xyz> points;
};

// The sharp edges of the shape, each with its faces, convexity, length and polyline.
std::vector<Sharp> sharp_edges(const EdgeFaces& faces_of, const FaceMap& faces) {
  std::vector<Sharp> out;
  for (int i = 1; i <= faces_of.Extent(); ++i) {
    const TopoDS_Edge edge = TopoDS::Edge(faces_of.FindKey(i));
    const NCollection_List<TopoDS_Shape>& two = faces_of(i);
    if (BRep_Tool::Degenerated(edge) || two.Extent() != 2) continue;
    const TopoDS_Face f1 = TopoDS::Face(two.First()), f2 = TopoDS::Face(two.Last());
    if (f1.IsSame(f2) || BRep_Tool::Continuity(edge, f1, f2) != GeomAbs_C0) continue;  // a seam, or smooth
    const BRepAdaptor_Curve curve(edge);
    const double mid = 0.5 * (curve.FirstParameter() + curve.LastParameter());
    const gp_Dir n1 = outward(f1, edge, mid), n2 = outward(f2, edge, mid);
    if (n1.Angle(n2) < kTangent) continue;
    const gp_Vec across = gp_Vec(n1).Crossed(boundary_direction(f1, edge, mid));
    GProp_GProps props;
    BRepGProp::LinearProperties(edge, props);
    out.push_back({edge, faces.FindIndex(f1) - 1, faces.FindIndex(f2) - 1, gp_Vec(n2).Dot(across) < 0, props.Mass(),
                   polyline(edge, f1)});
  }
  return out;
}

// The edge's unit tangent at one of its vertices.
gp_Vec tangent_at(const TopoDS_Edge& edge, const TopoDS_Vertex& vertex) {
  const BRepAdaptor_Curve c(edge);
  gp_Pnt p;
  gp_Vec d;
  c.D1(BRep_Tool::Parameter(vertex, edge), p, d);
  return d.Magnitude() > 1e-12 ? d.Normalized() : d;
}

// What hole and ring recognition needs to know about one face.
struct FaceInfo {
  TopoDS_Face face;
  GeomAbs_SurfaceType type = GeomAbs_OtherSurface;
  gp_Ax1 axis;          // cylinders, cones, tori: the axis; planes: the normal line
  double radius = 0;    // cylinders
  bool concave = false; // cylinders, cones, tori: the material is outside the surface (a bore)
  double span = 0;      // cylinders: the angle the face covers around its axis
};

FaceInfo info_of(const TopoDS_Face& face) {
  FaceInfo f;
  f.face = face;
  const BRepAdaptor_Surface s(face);
  f.type = s.GetType();
  double u0, u1, v0, v1;
  BRepTools::UVBounds(face, u0, u1, v0, v1);
  const double um = 0.5 * (u0 + u1), vm = 0.5 * (v0 + v1);
  const auto concave_about = [&](const gp_Ax1& axis) {
    const gp_Pnt p = s.Value(um, vm);
    const gp_Vec from_axis = gp_Vec(axis.Location(), p) -
                             gp_Vec(axis.Direction()) * gp_Vec(axis.Location(), p).Dot(gp_Vec(axis.Direction()));
    return from_axis.Magnitude() > 1e-9 && gp_Vec(outward_at(face, um, vm)).Dot(from_axis) < 0;
  };
  switch (f.type) {
    case GeomAbs_Plane: f.axis = s.Plane().Axis(); break;
    case GeomAbs_Cylinder:
      f.axis = s.Cylinder().Axis();
      f.radius = s.Cylinder().Radius();
      f.span = u1 - u0;
      f.concave = concave_about(f.axis);
      break;
    case GeomAbs_Cone:
      f.axis = s.Cone().Axis();
      f.concave = concave_about(f.axis);
      break;
    case GeomAbs_Torus:
      f.axis = s.Torus().Axis();
      f.concave = concave_about(f.axis);
      break;
    default: break;
  }
  return f;
}

bool on_line(const gp_Ax1& a, const gp_Ax1& b, double tol) {
  if (a.Direction().Angle(b.Direction()) > kAxis && a.Direction().Angle(b.Direction().Reversed()) > kAxis) {
    return false;
  }
  return gp_Lin(a).Distance(b.Location()) <= tol;
}

// Every edge of the face is a circle around `axis` (an annulus or a disk perpendicular to it).
bool coaxial_circles(const TopoDS_Face& face, const gp_Ax1& axis, double tol) {
  bool any = false;
  for (TopExp_Explorer it(face, TopAbs_EDGE); it.More(); it.Next()) {
    const BRepAdaptor_Curve c(TopoDS::Edge(it.Current()));
    if (c.GetType() != GeomAbs_Circle || !on_line(c.Circle().Axis(), axis, tol)) return false;
    any = true;
  }
  return any;
}

// A run of a bore or a tread with one radius, along the axis from t0 to t1.
struct Step {
  double r, t0, t1, span;
  std::vector<int> faces;
};

double along(const gp_Ax1& axis, const gp_Pnt& p) {
  return gp_Vec(axis.Location(), p).Dot(gp_Vec(axis.Direction()));
}

// Where a cylinder face runs along the axis.
std::pair<double, double> extent(const FaceInfo& f, const gp_Ax1& axis) {
  double u0, u1, v0, v1;
  BRepTools::UVBounds(f.face, u0, u1, v0, v1);
  const BRepAdaptor_Surface s(f.face);
  const double a = along(axis, s.Value(u0, v0)), b = along(axis, s.Value(u0, v1));
  return {std::min(a, b), std::max(a, b)};
}

// Full 360° runs: cylinders of one radius that overlap along the axis are one run (split faces); runs that touch
// along the axis are chained; each chain is returned with its runs in axial order.
std::vector<std::vector<Step>> runs(const std::vector<int>& cylinders, const std::vector<FaceInfo>& info,
                                    const gp_Ax1& axis, double tol) {
  std::vector<Step> steps;
  for (const int i : cylinders) {
    const auto [t0, t1] = extent(info[i], axis);
    auto same = std::find_if(steps.begin(), steps.end(), [&](const Step& s) {
      return std::abs(s.r - info[i].radius) <= tol && t0 < s.t1 - tol && s.t0 < t1 - tol;
    });
    if (same == steps.end()) {
      steps.push_back({info[i].radius, t0, t1, info[i].span, {i}});
    } else {
      same->t0 = std::min(same->t0, t0);
      same->t1 = std::max(same->t1, t1);
      same->span += info[i].span;
      same->faces.push_back(i);
    }
  }
  steps.erase(std::remove_if(steps.begin(), steps.end(), [](const Step& s) { return s.span < 2 * kPi - 1e-3; }),
              steps.end());
  std::sort(steps.begin(), steps.end(), [](const Step& a, const Step& b) { return a.t0 < b.t0; });
  std::vector<std::vector<Step>> chains;
  for (const Step& s : steps) {
    if (!chains.empty() && std::abs(s.t0 - chains.back().back().t1) <= tol) {
      // Two runs of one radius in a row (a face split across the axis) are one step.
      if (std::abs(s.r - chains.back().back().r) <= tol) {
        Step& last = chains.back().back();
        last.t1 = s.t1;
        last.faces.insert(last.faces.end(), s.faces.begin(), s.faces.end());
      } else {
        chains.back().push_back(s);
      }
    } else {
      chains.push_back({s});
    }
  }
  return chains;
}

}  // namespace

std::vector<int> glb_faces(const TDF_Label& part) {
  const TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(part);
  FaceMap faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  std::vector<int> out;
  for (TopExp_Explorer it(shape, TopAbs_FACE); it.More(); it.Next()) {
    TopLoc_Location location;
    const occ::handle<Poly_Triangulation> t = BRep_Tool::Triangulation(TopoDS::Face(it.Current()), location);
    if (!t.IsNull() && t->NbTriangles() > 0) out.push_back(faces.FindIndex(it.Current()) - 1);
  }
  return out;
}

std::vector<Feature> recognise_features(const TDF_Label& part, const std::optional<CastingProperties>& casting) {
  const TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(part);
  FaceMap faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  const int n = faces.Extent();
  std::vector<FaceInfo> info;
  for (int i = 1; i <= n; ++i) info.push_back(info_of(TopoDS::Face(faces(i))));
  BRepLib::EncodeRegularity(shape, kTangent);
  EdgeFaces faces_of;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, faces_of);
  std::vector<std::set<int>> neighbours(n);
  for (int i = 1; i <= faces_of.Extent(); ++i) {
    std::vector<int> two;
    for (const TopoDS_Shape& f : faces_of(i)) two.push_back(faces.FindIndex(f) - 1);
    for (const int a : two)
      for (const int b : two)
        if (a != b) neighbours[a].insert(b);
  }
  Bnd_Box box;
  for (int i = 0; i < n; ++i) BRepBndLib::Add(info[i].face, box);
  const double tol = 1e-4 * std::sqrt(box.SquareExtent()) + 1e-3;

  std::vector<Feature> features;
  std::map<std::string, int> count;
  const auto add = [&](Feature f) {
    f.id = f.type + ":" + std::to_string(++count[f.type]);
    features.push_back(std::move(f));
    return features.back().id;
  };
  const auto feature = [&](const std::string& id) -> Feature& {
    return *std::find_if(features.begin(), features.end(), [&](const Feature& f) { return f.id == id; });
  };
  std::vector<std::pair<std::string, std::vector<int>>> hole_faces;  // each hole and all its faces
  std::vector<std::string> owner(n);       // the feature a face belongs to (deepest)
  std::vector<std::string> as_type(n);     // a face's type when it is not its surface's (a rim round: Edge)
  BRepClass3d_SolidClassifier inside(shape);
  const auto metal_at = [&](const gp_Pnt& p) {
    inside.Perform(p, 1e-6);
    return inside.State() == TopAbs_IN;
  };

  // Lines of axes: cylinders on one line, by concavity.
  std::vector<bool> grouped(n, false);
  for (int i = 0; i < n; ++i) {
    if (info[i].type != GeomAbs_Cylinder || grouped[i]) continue;
    const gp_Ax1 axis = info[i].axis;
    std::vector<int> bores, treads;
    for (int j = i; j < n; ++j) {
      if (info[j].type != GeomAbs_Cylinder || grouped[j] || !on_line(info[j].axis, axis, tol)) continue;
      grouped[j] = true;
      (info[j].concave ? bores : treads).push_back(j);
    }
    // Coaxial faces next to a set: annuli or disks perpendicular to the axis, cones and tori on the axis.
    const auto next_to = [&](const std::vector<int>& set, auto&& accept) {
      std::vector<int> out;
      for (const int f : set)
        for (const int g : neighbours[f])
          if (owner[g].empty() && accept(g) && std::find(out.begin(), out.end(), g) == out.end()) out.push_back(g);
      return out;
    };
    const auto disk = [&](int g) {
      return info[g].type == GeomAbs_Plane && on_line(gp_Ax1(axis.Location(), info[g].axis.Direction()), axis, tol) &&
             coaxial_circles(info[g].face, axis, tol);
    };
    const auto revolved = [&](int g) {
      return (info[g].type == GeomAbs_Cone || info[g].type == GeomAbs_Torus) && on_line(info[g].axis, axis, tol);
    };

    // Holes.
    for (const std::vector<Step>& hole : runs(bores, info, axis, tol)) {
      const double t0 = hole.front().t0, t1 = hole.back().t1;
      const gp_Dir d = axis.Direction();
      const gp_Pnt before = axis.Location().Translated(gp_Vec(d) * (t0 - 0.05));
      const gp_Pnt after = axis.Location().Translated(gp_Vec(d) * (t1 + 0.05));
      const bool closed0 = metal_at(before), closed1 = metal_at(after);
      const bool through = !closed0 && !closed1;
      double rmin = hole.front().r, rmax = rmin;
      for (const Step& s : hole) {
        rmin = std::min(rmin, s.r);
        rmax = std::max(rmax, s.r);
      }
      bool down = true, up = true;
      for (std::size_t k = 1; k < hole.size(); ++k) {
        down = down && hole[k].r < hole[k - 1].r;
        up = up && hole[k].r > hole[k - 1].r;
      }
      const double depth = t1 - t0;
      Feature top;
      top.type = hole.size() == 1 ? "SimpleHole" : (down || up) ? "MultiStepHole" : "RingedHole";
      top.parameters = {{"diameter_mm", 2 * rmin}, {"depth_mm", depth}, {"through", through ? 1.0 : 0.0}};
      if (hole.size() > 1) {
        top.parameters.push_back({"max_diameter_mm", 2 * rmax});
        top.parameters.push_back({"steps", static_cast<double>(hole.size())});
      } else {
        top.parameters.push_back({"l_over_d", depth / (2 * rmin)});
      }
      const std::string top_id = add(top);
      // Which feature each step's faces belong to: the hole itself, a SimpleHole per step, or (ringed) the smallest
      // bore and a Ring per groove.
      std::vector<std::string> step_owner(hole.size(), top_id);
      if (top.type == "MultiStepHole") {
        for (std::size_t k = 0; k < hole.size(); ++k) {
          Feature s;
          s.type = "SimpleHole";
          s.parent = top_id;
          const double len = hole[k].t1 - hole[k].t0;
          s.parameters = {{"diameter_mm", 2 * hole[k].r}, {"depth_mm", len}, {"l_over_d", len / (2 * hole[k].r)}};
          step_owner[k] = add(s);
        }
      } else if (top.type == "RingedHole") {
        Feature bore;
        bore.type = "SimpleHole";
        bore.parent = top_id;
        bore.parameters = {{"diameter_mm", 2 * rmin}, {"depth_mm", depth}, {"l_over_d", depth / (2 * rmin)}};
        const std::string bore_id = add(bore);
        for (std::size_t k = 0; k < hole.size(); ++k) {
          if (std::abs(hole[k].r - rmin) <= tol) {
            step_owner[k] = bore_id;
            continue;
          }
          Feature ring;
          ring.type = "Ring";
          ring.parent = top_id;
          ring.parameters = {{"diameter_mm", 2 * hole[k].r}, {"width_mm", hole[k].t1 - hole[k].t0}, {"outer", 0.0}};
          step_owner[k] = add(ring);
        }
      }
      std::vector<int> walls;
      for (std::size_t k = 0; k < hole.size(); ++k) {
        for (const int f : hole[k].faces) {
          owner[f] = step_owner[k];
          walls.push_back(f);
        }
      }
      // Step faces and bottoms belong to the wider step next to them. Only faces whose every edge borders the hole's
      // walls: an annulus that also borders an outer diameter (a tube's end) is that ring's riser, not the hole's.
      const auto inside_hole = [&](int g) {
        for (TopExp_Explorer it(info[g].face, TopAbs_EDGE); it.More(); it.Next()) {
          bool bordered = false;
          for (const TopoDS_Shape& other : faces_of.FindFromKey(it.Current())) {
            const int k = faces.FindIndex(other) - 1;
            bordered = bordered || (k != g && std::find(walls.begin(), walls.end(), k) != walls.end());
          }
          if (!bordered) return false;
        }
        return true;
      };
      for (const int g : next_to(walls, [&](int g) { return disk(g) && inside_hole(g); })) {
        int best = -1;
        for (std::size_t k = 0; k < hole.size(); ++k) {
          for (const int f : hole[k].faces)
            if (neighbours[g].count(f) && (best < 0 || hole[k].r > hole[best].r)) best = static_cast<int>(k);
        }
        owner[g] = step_owner[best < 0 ? 0 : best];
      }
      // Cones and tori on the axis: a drill point at a closed end stays a surface; at an open end, a chamfer or a
      // round on the hole's edge (Edge).
      for (const int g : next_to(walls, revolved)) {
        double u0, u1, v0, v1;
        BRepTools::UVBounds(info[g].face, u0, u1, v0, v1);
        const double t = along(axis, BRepAdaptor_Surface(info[g].face).Value(0.5 * (u0 + u1), 0.5 * (v0 + v1)));
        const bool at_closed_end = (closed0 && t < t0 + tol) || (closed1 && t > t1 - tol);
        const std::size_t k = t < 0.5 * (t0 + t1) ? 0 : hole.size() - 1;
        owner[g] = step_owner[k];
        if (!at_closed_end) as_type[g] = "Edge";
      }
      std::vector<int> mine;
      for (int g = 0; g < n; ++g)
        if (std::find(step_owner.begin(), step_owner.end(), owner[g]) != step_owner.end()) mine.push_back(g);
      hole_faces.push_back({top_id, mine});
    }

    // Rings on outer diameters: treads with at least one coaxial circular end face.
    for (const std::vector<Step>& ring : runs(treads, info, axis, tol)) {
      std::vector<int> walls;
      for (const Step& s : ring) walls.insert(walls.end(), s.faces.begin(), s.faces.end());
      if (std::any_of(walls.begin(), walls.end(), [&](int f) { return !owner[f].empty(); })) continue;
      const std::vector<int> risers = next_to(walls, disk);
      if (risers.empty()) continue;
      double rmax = 0;
      for (const Step& s : ring) rmax = std::max(rmax, s.r);
      Feature f;
      f.type = "Ring";
      f.parameters = {{"diameter_mm", 2 * rmax}, {"width_mm", ring.back().t1 - ring.front().t0}, {"outer", 1.0}};
      const std::string id = add(f);
      for (const int w : walls) owner[w] = id;
      for (const int r : risers) owner[r] = id;
    }
  }

  // Hidden faces, hidden holes, voids and combo voids (F3).
  if (casting) {
    const int ax = casting->draw_axis - 'x';
    const gp_Dir up(ax == 0 ? 1 : 0, ax == 1 ? 1 : 0, ax == 2 ? 1 : 0);
    const double diagonal = std::sqrt(box.SquareExtent());
    const double eps = std::max(0.01, 1e-5 * diagonal);
    IntCurvesFace_ShapeIntersector rays;
    rays.Load(shape, 1e-6);
    const auto blocked = [&](const gp_Pnt& q, const gp_Dir& d) {
      rays.Perform(gp_Lin(q, d), 0.0, 2 * diagonal);
      return rays.IsDone() && rays.NbPnt() > 0;
    };
    std::vector<bool> hidden(n, false);
    for (int i = 0; i < n; ++i) {
      TopLoc_Location location;
      const occ::handle<Poly_Triangulation> t = BRep_Tool::Triangulation(info[i].face, location);
      if (t.IsNull() || !t->HasUVNodes() || t->NbTriangles() == 0) continue;
      const BRepAdaptor_Surface s(info[i].face);
      const int samples = std::min(9, t->NbTriangles());
      int both = 0;
      for (int j = 0; j < samples; ++j) {
        int a, b, c;
        t->Triangle(1 + j * t->NbTriangles() / samples).Get(a, b, c);
        const gp_XY uv = (t->UVNode(a).XY() + t->UVNode(b).XY() + t->UVNode(c).XY()) / 3.0;
        const gp_Pnt q = s.Value(uv.X(), uv.Y()).Translated(gp_Vec(outward_at(info[i].face, uv.X(), uv.Y())) * eps);
        if (blocked(q, up) && blocked(q, up.Reversed())) ++both;
      }
      hidden[i] = 2 * both > samples;
    }
    for (const auto& [id, fs] : hole_faces) {
      const bool h = std::any_of(fs.begin(), fs.end(), [&](int f) { return hidden[f]; });
      feature(id).parameters.push_back({"hidden", h ? 1.0 : 0.0});
    }

    // Voids: connected hidden faces of no hole or ring.
    std::vector<std::vector<int>> voids;
    std::vector<bool> seen(n, false);
    for (int i = 0; i < n; ++i) {
      if (!hidden[i] || !owner[i].empty() || seen[i]) continue;
      std::vector<int> v{i};
      seen[i] = true;
      for (std::size_t k = 0; k < v.size(); ++k) {
        for (const int g : neighbours[v[k]]) {
          if (hidden[g] && owner[g].empty() && !seen[g]) {
            seen[g] = true;
            v.push_back(g);
          }
        }
      }
      voids.push_back(v);
    }
    // Each void with the holes it touches (union-find over voids, then holes); a hole touching two voids joins them.
    const std::size_t nv = voids.size();
    std::vector<std::size_t> link(nv + hole_faces.size());
    std::iota(link.begin(), link.end(), 0);
    const std::function<std::size_t(std::size_t)> top = [&](std::size_t x) {
      return link[x] == x ? x : link[x] = top(link[x]);
    };
    for (std::size_t v = 0; v < nv; ++v) {
      for (std::size_t h = 0; h < hole_faces.size(); ++h) {
        const bool touches = std::any_of(voids[v].begin(), voids[v].end(), [&](int f) {
          const std::vector<int>& hf = hole_faces[h].second;
          return std::any_of(hf.begin(), hf.end(), [&](int g) { return neighbours[f].count(g) > 0; });
        });
        if (touches) link[top(nv + h)] = top(v);
      }
    }
    const auto box_of = [&](const std::vector<int>& fs) {
      Bnd_Box b;
      for (const int f : fs) BRepBndLib::AddOptimal(info[f].face, b, false, false);
      return b;
    };
    // The core whose centre lies in the faces' box (1-based), else 0.
    const auto core_of = [&](const std::vector<int>& fs) {
      Bnd_Box b = box_of(fs);
      b.Enlarge(tol);
      for (std::size_t c = 0; c < casting->cores.size(); ++c) {
        const Xyz& m = casting->cores[c].centre;
        if (!b.IsOut(gp_Pnt(m[0], m[1], m[2]))) return static_cast<double>(c + 1);
      }
      return 0.0;
    };
    std::map<std::size_t, std::vector<std::size_t>> groups;
    for (std::size_t i = 0; i < link.size(); ++i) groups[top(i)].push_back(i);
    for (const auto& [root_index, members] : groups) {
      if (members.front() >= nv) {  // a hole that touches no void stays a hole; hidden, it is cored (H3)
        const auto& [id, fs] = hole_faces[members.front() - nv];
        if (std::any_of(fs.begin(), fs.end(), [&](int f) { return hidden[f]; })) {
          feature(id).parameters.push_back({"core", core_of(fs)});
        }
        continue;
      }
      std::vector<int> all;
      for (const std::size_t m : members) {
        const std::vector<int>& fs = m < nv ? voids[m] : hole_faces[m - nv].second;
        all.insert(all.end(), fs.begin(), fs.end());
      }
      const double core = core_of(all);
      std::string combo;
      if (members.size() > 1) {
        Feature c;
        c.type = "ComboVoid";
        c.parameters = {{"members", static_cast<double>(members.size())}, {"core", core}};
        combo = add(c);
      }
      for (const std::size_t m : members) {
        if (m >= nv) {
          feature(hole_faces[m - nv].first).parent = combo;
          continue;
        }
        double x0, y0, z0, x1, y1, z1;
        box_of(voids[m]).Get(x0, y0, z0, x1, y1, z1);
        std::array<double, 3> size{x1 - x0, y1 - y0, z1 - z0};
        std::sort(size.begin(), size.end(), std::greater<>());
        double area = 0;
        for (const int f : voids[m]) area += area_of(info[f].face);
        Feature v;
        v.type = "Void";
        v.parent = combo;
        v.parameters = {{"box_length_mm", size[0]}, {"box_width_mm", size[1]}, {"box_height_mm", size[2]},
                        {"area_mm2", area}, {"core", core}};
        const std::string id = add(v);
        for (const int f : voids[m]) owner[f] = id;
      }
    }
  }

  // Faces: their own feature, under the hole, ring or void they belong to.
  for (int i = 0; i < n; ++i) {
    Feature f;
    f.type = as_type[i].empty() ? face_type(info[i].face) : as_type[i];
    f.faces = {i};
    f.parent = owner[i];
    f.parameters = {{"area_mm2", area_of(info[i].face)}};
    add(std::move(f));
  }

  // Sharp edges, chained where one continues another smoothly with the same convexity (union-find). A chain on the
  // faces of a hole is that hole's Edge.
  const std::vector<Sharp> sharp = sharp_edges(faces_of, faces);
  std::vector<int> parent(sharp.size());
  std::iota(parent.begin(), parent.end(), 0);
  const std::function<int(int)> root = [&](int x) { return parent[x] == x ? x : parent[x] = root(parent[x]); };
  for (std::size_t a = 0; a < sharp.size(); ++a) {
    for (std::size_t b = a + 1; b < sharp.size(); ++b) {
      if (sharp[a].convex != sharp[b].convex) continue;
      for (TopExp_Explorer va(sharp[a].edge, TopAbs_VERTEX); va.More(); va.Next()) {
        for (TopExp_Explorer vb(sharp[b].edge, TopAbs_VERTEX); vb.More(); vb.Next()) {
          if (!va.Current().IsSame(vb.Current())) continue;
          const TopoDS_Vertex v = TopoDS::Vertex(va.Current());
          const gp_Vec ta = tangent_at(sharp[a].edge, v), tb = tangent_at(sharp[b].edge, v);
          if (ta.Magnitude() > 0 && tb.Magnitude() > 0 && std::abs(ta.Dot(tb)) >= std::cos(kChain)) {
            parent[root(static_cast<int>(a))] = root(static_cast<int>(b));
          }
        }
      }
    }
  }
  const auto hole_of = [&](const Sharp& s) {
    for (const int f : {s.f1, s.f2}) {
      const std::string& o = owner[f];
      if (o.rfind("SimpleHole:", 0) == 0 || o.rfind("MultiStepHole:", 0) == 0 || o.rfind("RingedHole:", 0) == 0) {
        return o;
      }
    }
    return std::string();
  };
  const auto void_of = [&](const Sharp& s) {
    return owner[s.f1].rfind("Void:", 0) == 0 && owner[s.f1] == owner[s.f2] ? owner[s.f1] : std::string();
  };
  std::map<int, std::vector<std::size_t>> chains;
  for (std::size_t i = 0; i < sharp.size(); ++i) chains[root(static_cast<int>(i))].push_back(i);
  for (const auto& [id, members] : chains) {
    Feature f;
    const std::string hole = hole_of(sharp[members.front()]);
    const bool on_hole = !hole.empty() && std::all_of(members.begin(), members.end(),
                                                       [&](std::size_t m) { return hole_of(sharp[m]) == hole; });
    const std::string in = void_of(sharp[members.front()]);
    const bool in_void = !in.empty() && std::all_of(members.begin(), members.end(),
                                                    [&](std::size_t m) { return void_of(sharp[m]) == in; });
    f.type = on_hole ? "Edge" : "SharpEdge";
    f.parent = on_hole ? hole : in_void ? in : "";
    double length = 0;
    for (const std::size_t m : members) {
      length += sharp[m].length;
      f.edges.push_back(sharp[m].points);
    }
    f.parameters = {{"length_mm", length},
                    {"convex", sharp[members.front()].convex ? 1.0 : 0.0},
                    {"edges", static_cast<double>(members.size())}};
    add(std::move(f));
  }
  return features;
}
