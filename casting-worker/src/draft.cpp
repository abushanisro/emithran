// Draft angle of every face along the draw axis (roadmap S4, gap G1).
//
// A mould opens along the draw axis. The parting plane splits the part into the half above it (pulled out of the cope) and the half below it (drag). A face
// has draft when the pattern can be withdrawn without dragging the sand along: with n the face's outward normal and d the draw axis, the draft is
//     asin(n . d)   above the parting plane,      asin(-n . d)   below it.
// 0 is a face parallel to the draw axis (no taper), a positive angle tapers away from the parting plane, a negative one is an undercut (the pattern
// cannot be withdrawn: a core or a split is needed). Every sample point of a face is graded by the side of the plane it lies on, so a face that crosses the
// plane is graded on both sides. A flat face lying in the parting plane has no draft to speak of and is only counted. A curved face is sampled on a grid of its parameters: the
// smallest and largest draft over the samples are reported, so a taper that changes across the face shows. Face numbers are the ones the features and
// glb_faces use (TopExp::MapShapes order).
#include "model.hpp"

#include <BRepBndLib.hxx>
#include <BRepGProp_Face.hxx>
#include <BRepTools.hxx>
#include <Bnd_Box.hxx>
#include <NCollection_IndexedMap.hxx>
#include <TopExp.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include <algorithm>
#include <cmath>

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr int kGrid = 5;               // samples per parameter direction on a curved face
constexpr double kPlaneTolerance = 1e-4;  // of the part's depth along the draw axis: how close to the parting plane counts as on it

double degrees(double radians) { return radians * 180.0 / kPi; }

}  // namespace

void find_draft(const TDF_Label& part, const PartProperties& p, CastingProperties& c) {
  if (!c.parting) return;  // the halves are defined by the parting plane
  const TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(part);
  const int axis = c.draw_axis - 'x';
  const double height = c.parting->height;
  const double tolerance = kPlaneTolerance * std::max((*p.box_max)[axis] - (*p.box_min)[axis], 1.0);

  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);

  DraftAnalysis draft;
  draft.parting_planar = c.parting->planar;
  for (int i = 1; i <= faces.Extent(); ++i) {
    const TopoDS_Face face = TopoDS::Face(faces(i));
    Bnd_Box box;
    BRepBndLib::Add(face, box);
    if (box.IsVoid()) {
      ++draft.unmeasured;
      continue;
    }
    double lo[3], hi[3];
    box.Get(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]);
    if (hi[axis] <= height + tolerance && lo[axis] >= height - tolerance) {
      ++draft.at_parting_plane;  // lies in the parting plane
      continue;
    }

    // Each sample is graded by the side of the parting plane it lies on. The plane is a sampled height (its precision depends on how gently the part
    // tapers), so a face is not classified as a whole: a face that only just reaches across the plane is judged by where its points really are, and a
    // face that truly crosses it is judged on both sides.
    double u0, u1, v0, v1;
    BRepTools::UVBounds(face, u0, u1, v0, v1);
    BRepGProp_Face properties(face);
    double smallest = 0, largest = 0;
    bool above = false, below = false, any = false;
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
        if (normal.Magnitude() < 1e-12) continue;  // a pole or an apex: no normal there
        const double along = std::clamp(normal.Normalized().Coord(axis + 1), -1.0, 1.0);
        const double up = degrees(std::asin(along)), down = degrees(std::asin(-along));
        const double offset = point.Coord(axis + 1) - height;
        double angle;
        if (offset > tolerance) {
          angle = up, above = true;
        } else if (offset < -tolerance) {
          angle = down, below = true;
        } else {
          angle = std::max(up, down);  // on the plane: the mould can be split to either side
        }
        smallest = any ? std::min(smallest, angle) : angle;
        largest = any ? std::max(largest, angle) : angle;
        any = true;
      }
    }
    if (!any) {
      ++draft.unmeasured;
      continue;
    }
    draft.faces.push_back({i - 1, above && below ? 'b' : below ? 'd' : 'c', smallest, largest});
  }
  c.draft = std::move(draft);
}
