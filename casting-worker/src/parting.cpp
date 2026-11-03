// The exact parting line (roadmap H2, D144): where the mould halves meet on the part. The part is cut by planes
// across the draw axis (BRepAlgoAPI_Section, exact B-rep curves); the section loops are chained into wires and the
// largest closed loop is the section's outline. The parting line is that outline at the height where it encloses
// most: a drafted part is widest at one height (found by golden-section search), a part with walls along the draw
// axis is equally wide over a range (its middle is taken). When the projected outline is not all inside that loop,
// the outline is not in one plane: the line is still the best flat one, but a stepped parting line is needed.

#include "model.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <GCPnts_AbscissaPoint.hxx>
#include <GCPnts_QuasiUniformDeflection.hxx>
#include <NCollection_HSequence.hxx>
#include <ShapeAnalysis_FreeBounds.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <gp_Pln.hxx>

#include <algorithm>
#include <cmath>

namespace {

constexpr int kLevels = 24;         // planes sampled along the draw axis
constexpr double kSame = 1e-4;      // relative area difference still counted as equally wide
constexpr double kOutside = 0.01;   // share of the projected area outside the loop still counted as planar

struct Loop {
  double area = 0, length = 0;
  std::vector<Xyz> points;
};

// Area enclosed by a closed polyline, seen along the axis (shoelace formula).
double enclosed(const std::vector<Xyz>& points, int axis) {
  const int u = (axis + 1) % 3, v = (axis + 2) % 3;
  double twice = 0;
  for (std::size_t i = 0; i < points.size(); ++i) {
    const Xyz& a = points[i];
    const Xyz& b = points[(i + 1) % points.size()];
    twice += a[u] * b[v] - b[u] * a[v];
  }
  return std::abs(twice) / 2.0;
}

// The largest closed loop of the section of the shape by the plane at `height` along the axis; empty when the plane
// misses the shape.
Loop outer_loop(const TopoDS_Shape& shape, int axis, double height, double deflection) {
  double origin[3] = {0, 0, 0};
  origin[axis] = height;
  const gp_Dir normal(axis == 0 ? 1 : 0, axis == 1 ? 1 : 0, axis == 2 ? 1 : 0);
  BRepAlgoAPI_Section section(shape, gp_Pln(gp_Pnt(origin[0], origin[1], origin[2]), normal), false);
  section.Build();
  Loop best;
  if (!section.IsDone()) return best;
  const occ::handle<NCollection_HSequence<TopoDS_Shape>> edges = new NCollection_HSequence<TopoDS_Shape>();
  for (TopExp_Explorer it(section.Shape(), TopAbs_EDGE); it.More(); it.Next()) edges->Append(it.Current());
  if (edges->IsEmpty()) return best;
  const occ::handle<NCollection_HSequence<TopoDS_Shape>> wires =
      ShapeAnalysis_FreeBounds::ConnectEdgesToWires(edges, 1e-4, false);
  for (int i = 1; i <= wires->Length(); ++i) {
    Loop loop;
    for (BRepTools_WireExplorer e(TopoDS::Wire(wires->Value(i))); e.More(); e.Next()) {
      const BRepAdaptor_Curve curve(e.Current());
      loop.length += GCPnts_AbscissaPoint::Length(curve);
      const GCPnts_QuasiUniformDeflection sampled(curve, deflection);
      if (!sampled.IsDone()) return Loop{};
      std::vector<Xyz> points;
      for (int n = 1; n <= sampled.NbPoints(); ++n) {
        const gp_Pnt p = sampled.Value(n);
        points.push_back({p.X(), p.Y(), p.Z()});
      }
      if (e.Orientation() == TopAbs_REVERSED) std::reverse(points.begin(), points.end());
      loop.points.insert(loop.points.end(), points.begin() + (loop.points.empty() ? 0 : 1), points.end());
    }
    if (loop.points.size() < 3) continue;
    const Xyz& first = loop.points.front();
    const Xyz& last = loop.points.back();
    if (std::hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2]) > 1e-3) continue;  // not closed
    loop.area = enclosed(loop.points, axis);
    if (loop.area > best.area) best = loop;
  }
  return best;
}

// Whether the point (u, v) across the axis lies inside the closed polyline (even-odd rule).
bool inside(const std::vector<Xyz>& points, int axis, double pu, double pv) {
  const int u = (axis + 1) % 3, v = (axis + 2) % 3;
  bool in = false;
  for (std::size_t i = 0, j = points.size() - 1; i < points.size(); j = i++) {
    const Xyz& a = points[i];
    const Xyz& b = points[j];
    if ((a[v] > pv) != (b[v] > pv) && pu < (b[u] - a[u]) * (pv - a[v]) / (b[v] - a[v]) + a[u]) in = !in;
  }
  return in;
}

std::optional<PartingLine> parting_line(const TopoDS_Shape& shape, int axis, const Xyz& lo, const Xyz& hi,
                                        const std::vector<std::array<double, 2>>& covered) {
  const double diagonal = std::hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const double deflection = diagonal / 2000.0;
  const double bottom = lo[axis], top = hi[axis];
  const auto area = [&](double h) { return outer_loop(shape, axis, h, deflection).area; };

  std::vector<double> level(kLevels), wide(kLevels);
  for (int k = 0; k < kLevels; ++k) {
    level[k] = bottom + (top - bottom) * (k + 0.5) / kLevels;
    wide[k] = area(level[k]);
  }
  const int k = static_cast<int>(std::max_element(wide.begin(), wide.end()) - wide.begin());
  if (wide[k] <= 0) return std::nullopt;

  // The widest height between the neighbouring levels (a drafted part is widest at one height).
  double best = level[k], most = wide[k];
  {
    double a = k > 0 ? level[k - 1] : bottom, b = k + 1 < kLevels ? level[k + 1] : top;
    const double g = (std::sqrt(5.0) - 1.0) / 2.0;
    double c = b - g * (b - a), d = a + g * (b - a), fc = area(c), fd = area(d);
    for (int i = 0; i < 20; ++i) {
      if (fc >= fd) {
        b = d, d = c, fd = fc, c = b - g * (b - a), fc = area(c);
      } else {
        a = c, c = d, fc = fd, d = a + g * (b - a), fd = area(d);
      }
    }
    for (const auto& [h, f] : {std::pair{c, fc}, std::pair{d, fd}}) {
      if (f > most) best = h, most = f;
    }
  }
  // Equally wide around it (walls along the draw axis): each end of that range, by bisection from the first level
  // beyond it that is narrower (or the end of the part).
  const auto same = [&](double f) { return f >= most * (1.0 - kSame); };
  const auto end_of_range = [&](int step) {
    int j = k;
    while (j >= 0 && j < kLevels && (j == k || same(wide[j]))) j += step;
    if (j < 0) return bottom;
    if (j >= kLevels) return top;
    double in = (j - step == k) ? best : level[j - step], out = level[j];
    for (int i = 0; i < 16; ++i) {
      const double mid = (in + out) / 2.0;
      (same(area(mid)) ? in : out) = mid;
    }
    return in;
  };
  const double low = std::min(best, end_of_range(-1)), high = std::max(best, end_of_range(+1));

  PartingLine line;
  line.height = (low + high) / 2.0;
  Loop loop = outer_loop(shape, axis, line.height, deflection);
  if (!same(loop.area)) {  // the middle of the range is narrower: keep the widest height
    line.height = best;
    loop = outer_loop(shape, axis, best, deflection);
  }
  if (loop.points.empty()) return std::nullopt;
  line.length = loop.length;
  line.area = loop.area;
  int out = 0;
  for (const auto& [pu, pv] : covered) out += inside(loop.points, axis, pu, pv) ? 0 : 1;
  line.outside = covered.empty() ? 0.0 : static_cast<double>(out) / covered.size();
  line.planar = line.outside < kOutside;
  line.points = std::move(loop.points);
  return line;
}

}  // namespace

void find_parting_line(const TDF_Label& part, const PartProperties& p, CastingProperties& c) {
  c.parting = parting_line(XCAFDoc_ShapeTool::GetShape(part), c.draw_axis - 'x', *p.box_min, *p.box_max, c.covered);
  if (c.parting && c.parting->planar) c.parting_line = c.parting->length;
}
