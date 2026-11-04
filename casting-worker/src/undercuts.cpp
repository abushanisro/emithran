// Undercuts of every face, along each axis of the part (roadmap S5, gap G2).
//
// A pattern leaves the sand by moving along the draw axis, up out of the cope or down out of the drag. A point of the surface can be withdrawn along
// the axis when, in one of the two directions, its outward normal does not point back into the part (n . d >= -sin(limit): a face leaning the wrong way
// by more than the draft limit drags the sand) and the line from the point out along that direction meets no other metal. A point that can be
// withdrawn in neither direction is an undercut: sand must be placed there as a core, or the mould split. A face is an undercut when a fifth or more of
// its sample points are.
//
// This needs no parting plane: the mould is split wherever it has to be, and the question asked is only whether some split along the axis frees the
// point. It is asked for the three axes of the part, so the answer to "is there a direction with no core?" is in the result, whichever axis the worker
// chose to measure along. Face numbers are the ones the features and the draft use (TopExp::MapShapes order).
#include "model.hpp"

#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <BRepGProp_Face.hxx>
#include <BRepTools.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <IntCurvesFace_ShapeIntersector.hxx>
#include <NCollection_IndexedMap.hxx>
#include <TopExp.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <gp_Dir.hxx>
#include <gp_Lin.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cmath>

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr int kGrid = 5;                  // samples per parameter direction on a face
constexpr double kDraftLimitDeg = 0.5;    // a face leaning the wrong way by less than this is still withdrawn (the published rules' draft limit)
constexpr double kUndercutShare = 0.2;    // share of a face's samples that cannot be withdrawn for the face to count as an undercut
constexpr double kStart = 1e-4;           // where the ray starts off the surface, of the part's diagonal

// Whether the line from `from` along `direction` (+1 or -1) of the axis meets metal within `length`.
bool blocked(IntCurvesFace_ShapeIntersector& shape, const gp_Pnt& from, int axis, int direction, double length) {
  const gp_Dir along(axis == 0 ? direction : 0, axis == 1 ? direction : 0, axis == 2 ? direction : 0);
  shape.Perform(gp_Lin(from, along), 0.0, length);
  return shape.IsDone() && shape.NbPnt() > 0;
}

}  // namespace

void find_undercuts(const TDF_Label& part, const PartProperties& p, CastingProperties& c) {
  if (!p.box_min || !p.box_max) return;
  const TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(part);
  IntCurvesFace_ShapeIntersector rays;
  rays.Load(shape, 1e-6);

  const double diagonal = std::hypot(std::hypot((*p.box_max)[0] - (*p.box_min)[0], (*p.box_max)[1] - (*p.box_min)[1]), (*p.box_max)[2] - (*p.box_min)[2]);
  const double start = std::max(kStart * diagonal, 1e-4);
  const double limit = std::sin(kDraftLimitDeg * kPi / 180.0);

  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);

  UndercutAnalysis result;
  for (int a = 0; a < 3; ++a) {
    UndercutAxis axis;
    axis.axis = static_cast<char>('x' + a);
    const double length = (*p.box_max)[a] - (*p.box_min)[a] + 2.0 * start + 1.0;
    for (int i = 1; i <= faces.Extent(); ++i) {
      const TopoDS_Face face = TopoDS::Face(faces(i));
      double u0, u1, v0, v1;
      BRepTools::UVBounds(face, u0, u1, v0, v1);
      BRepGProp_Face properties(face);
      int samples = 0, hidden = 0;
      for (int iu = 0; iu < kGrid; ++iu) {
        for (int iv = 0; iv < kGrid; ++iv) {
          const double u = u0 + (u1 - u0) * (iu + 0.5) / kGrid, v = v0 + (v1 - v0) * (iv + 0.5) / kGrid;
          gp_Pnt point;
          gp_Vec normal;
          try {
            properties.Normal(u, v, point, normal);
          } catch (const Standard_Failure&) {
            continue;
          }
          if (normal.Magnitude() < 1e-12) continue;  // a pole or an apex
          const gp_Vec n = normal.Normalized();
          const gp_Pnt out(point.X() + n.X() * start, point.Y() + n.Y() * start, point.Z() + n.Z() * start);
          ++samples;
          const double along = n.Coord(a + 1);
          const bool free = (along >= -limit && !blocked(rays, out, a, +1, length)) || (-along >= -limit && !blocked(rays, out, a, -1, length));
          if (!free) ++hidden;
        }
      }
      if (samples == 0) continue;
      const double share = static_cast<double>(hidden) / samples;
      if (share < kUndercutShare) continue;
      GProp_GProps surface;
      BRepGProp::SurfaceProperties(face, surface);
      axis.faces.push_back({i - 1, share});
      axis.area += surface.Mass();
    }
    result.axes.push_back(std::move(axis));
  }
  c.undercuts = std::move(result);
}
