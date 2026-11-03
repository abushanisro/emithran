// Properties of one part definition, in its own coordinates (millimetres), in stages: check the shape as read,
// heal it only if healing keeps every solid, then measure each property on its own so that one failure (an OCCT
// exception) empties that property only. Rules for what is reported are in model.hpp (D108).

#include "model.hpp"

#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <Bnd_Box.hxx>
#include <Bnd_OBB.hxx>
#include <GProp_GProps.hxx>
#include <ShapeFix_Shape.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <XCAFDoc_ShapeTool.hxx>

#include <algorithm>
#include <cmath>
#include <functional>

namespace {

const char* surface_type(const TopoDS_Face& face) {
  switch (BRepAdaptor_Surface(face, false).GetType()) {
    case GeomAbs_Plane: return "plane";
    case GeomAbs_Cylinder: return "cylinder";
    case GeomAbs_Cone: return "cone";
    case GeomAbs_Sphere: return "sphere";
    case GeomAbs_Torus: return "torus";
    case GeomAbs_BSplineSurface: return "bspline";
    case GeomAbs_BezierSurface: return "bezier";
    case GeomAbs_SurfaceOfRevolution: return "revolution";
    case GeomAbs_SurfaceOfExtrusion: return "extrusion";
    case GeomAbs_OffsetSurface: return "offset";
    default: return "other";
  }
}

int count(const TopoDS_Shape& shape, TopAbs_ShapeEnum type) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> distinct;
  TopExp::MapShapes(shape, type, distinct);
  return distinct.Extent();
}

bool valid(const TopoDS_Shape& shape) { return BRepCheck_Analyzer(shape).IsValid(); }

bool finite(const Xyz& v) { return std::isfinite(v[0]) && std::isfinite(v[1]) && std::isfinite(v[2]); }

// Runs one measurement; an OCCT exception becomes the problem "failed:<what>" instead of ending the worker.
void attempt(PartProperties& p, const char* what, const std::function<void()>& step) {
  try {
    step();
  } catch (const Standard_Failure&) {
    p.problems.push_back(std::string("failed:") + what);
  }
}

}  // namespace

PartProperties measure(const TDF_Label& part) {
  PartProperties p;
  p.name = name_of(part);
  TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(part);
  if (shape.IsNull()) {
    p.problems.push_back("empty_shape");
    return p;
  }

  // 1. As read, and healed only if the result is valid and keeps every solid: ShapeFix may "repair" an open
  //    solid into a valid shell, which would turn a broken solid into a meaningless volume.
  attempt(p, "validity", [&] {
    p.valid_as_read = valid(shape);
    p.valid = p.valid_as_read;
    if (p.valid) return;
    ShapeFix_Shape fix(shape);
    fix.Perform();
    if (valid(fix.Shape()) && count(fix.Shape(), TopAbs_SOLID) == count(shape, TopAbs_SOLID)) {
      shape = fix.Shape();
      p.healed = true;
      p.valid = true;
    }
  });
  if (!p.valid) p.problems.push_back("invalid_geometry");

  // 2. Topology.
  attempt(p, "topology", [&] {
    p.solids = count(shape, TopAbs_SOLID);
    p.faces = count(shape, TopAbs_FACE);
    p.edges = count(shape, TopAbs_EDGE);
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
    TopExp::MapShapes(shape, TopAbs_FACE, faces);
    for (int i = 1; i <= faces.Extent(); ++i) ++p.face_types[surface_type(TopoDS::Face(faces(i)))];
  });
  if (p.solids == 0) p.problems.push_back("no_solid");

  // 3. Volume and centre of mass: only a valid shape with solids encloses a meaningful volume.
  if (p.valid && p.solids > 0) {
    attempt(p, "volume", [&] {
      GProp_GProps props;
      BRepGProp::VolumeProperties(shape, props);
      const gp_Pnt c = props.CentreOfMass();
      const Xyz centre{c.X(), c.Y(), c.Z()};
      if (std::isfinite(props.Mass()) && props.Mass() > 0 && finite(centre)) {
        p.volume = props.Mass();
        p.centre = centre;
      }
    });
  }

  // 4. Area of all faces.
  if (p.faces > 0) {
    attempt(p, "area", [&] {
      GProp_GProps props;
      BRepGProp::SurfaceProperties(shape, props);
      if (std::isfinite(props.Mass()) && props.Mass() > 0) p.area = props.Mass();
    });
  }

  // 5. Bounding boxes from the B-rep geometry (not a display mesh). The options leave out the shapes'
  //    tolerances; the boxes are tight to OCCT's precision, not mathematically exact extrema.
  attempt(p, "box", [&] {
    Bnd_Box box;
    BRepBndLib::AddOptimal(shape, box, false, false);
    if (box.IsVoid()) return;
    Xyz lo, hi;
    box.Get(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]);
    if (finite(lo) && finite(hi)) {
      p.box_min = lo;
      p.box_max = hi;
    }
  });
  attempt(p, "oriented_box", [&] {
    Bnd_OBB oriented;
    BRepBndLib::AddOBB(shape, oriented, false, true, false);
    if (oriented.IsVoid()) return;
    Xyz size{2 * oriented.XHSize(), 2 * oriented.YHSize(), 2 * oriented.ZHSize()};
    std::sort(size.begin(), size.end(), std::greater<double>());
    if (finite(size)) p.oriented_size = size;
  });
  return p;
}
