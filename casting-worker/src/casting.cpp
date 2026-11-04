// Casting measurements of one part (roadmap M4, D126), by ray casting on the exact B-rep geometry
// (IntCurvesFace_ShapeIntersector), in the part's own coordinates:
//  - along each of the three axes, a 64 x 64 grid of rays over the bounding box: rays that meet the part give the
//    projected area, the outline of those cells (marching squares) the parting line, and rays that pass solid, air,
//    solid mark material hidden from both mould halves (cores or undercuts);
//  - cores: along the draw axis, air gaps of neighbouring rays that overlap are one core (volume, size);
//  - the draw axis has the fewest such rays, then the smallest depth, then the largest projected area;
//  - wall thickness: from points spread over the display mesh (their exact points on the surface, about 10,000 per
//    part) straight inwards to the next surface, weighted by area; 5th percentile, median, 95th percentile.
// Grid sampling makes the area and outline approximate: within a few per cent; round outlines come out about 5 %
// long (the outline runs in 45-degree steps).

#include "model.hpp"

#include <BRepAdaptor_Surface.hxx>
#include <BRep_Tool.hxx>
#include <IntCurvesFace_ShapeIntersector.hxx>
#include <Poly_Triangulation.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <gp_Lin.hxx>

#include <algorithm>
#include <cmath>
#include <functional>
#include <map>
#include <numeric>
#include <vector>

namespace {

constexpr int kGrid = 64;                 // rays per side, per axis
constexpr double kThicknessRays = 10000;  // about this many wall-thickness rays per part

// Where a line meets the shape, as distances along it, sorted. A ray through an edge meets two faces at one
// point: counted once.
std::vector<double> hits(IntCurvesFace_ShapeIntersector& shape, const gp_Lin& line, double length) {
  shape.Perform(line, 0.0, length);
  std::vector<double> at;
  if (!shape.IsDone()) return at;
  for (int i = 1; i <= shape.NbPnt(); ++i) at.push_back(shape.WParameter(i));
  std::sort(at.begin(), at.end());
  at.erase(std::unique(at.begin(), at.end(), [](double a, double b) { return b - a < 1e-6; }), at.end());
  return at;
}

// Length of the outline of the covered cells, through the midpoints between covered and empty cell centres
// (marching squares), in mm.
double outline(const std::vector<char>& covered, double du, double dv) {
  const auto at = [&](int i, int j) {
    return i >= 0 && j >= 0 && i < kGrid && j < kGrid && covered[i * kGrid + j] != 0;
  };
  // Edge midpoints of a cell square: bottom, right, top, left.
  const double mx[4] = {0.5, 1.0, 0.5, 0.0}, my[4] = {0.0, 0.5, 1.0, 0.5};
  const auto segment = [&](int a, int b) { return std::hypot((mx[a] - mx[b]) * du, (my[a] - my[b]) * dv); };
  double length = 0;
  for (int i = -1; i < kGrid; ++i) {
    for (int j = -1; j < kGrid; ++j) {
      // Corners a (i, j), b (i+1, j), c (i+1, j+1), d (i, j+1).
      const bool a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      int crossed[4], n = 0;
      if (a != b) crossed[n++] = 0;
      if (b != c) crossed[n++] = 1;
      if (c != d) crossed[n++] = 2;
      if (d != a) crossed[n++] = 3;
      if (n == 2) length += segment(crossed[0], crossed[1]);
      if (n == 4) length += segment(0, 1) + segment(2, 3);
    }
  }
  return length;
}

// Air between two layers of metal on one ray: from where the metal ends to where it starts again (along the axis).
struct Gap {
  int cell;
  double from, to;
};

struct View {
  int axis = 2;
  double depth = 0, area = 0, parting = 0, hidden_fraction = 0;
  int hidden = 0;
  std::array<double, 2> footprint{};
  double du = 0, dv = 0;
  Xyz lo{};               // the box corner the grid starts at (rays start 1 mm before it along the axis)
  std::vector<Gap> gaps;  // in cell order
  std::vector<std::array<double, 2>> covered;  // centres of the cells the part covers
};

View look_along(IntCurvesFace_ShapeIntersector& shape, const Xyz& lo, const Xyz& hi, int axis) {
  const int u = (axis + 1) % 3, v = (axis + 2) % 3;
  View view;
  view.axis = axis;
  view.depth = hi[axis] - lo[axis];
  const double su = hi[u] - lo[u], sv = hi[v] - lo[v];
  view.footprint = {std::max(su, sv), std::min(su, sv)};
  const double du = su / kGrid, dv = sv / kGrid;
  const gp_Dir along(axis == 0 ? 1 : 0, axis == 1 ? 1 : 0, axis == 2 ? 1 : 0);
  std::vector<char> covered(kGrid * kGrid, 0);
  int count = 0;
  for (int i = 0; i < kGrid; ++i) {
    for (int j = 0; j < kGrid; ++j) {
      double p[3];
      p[axis] = lo[axis] - 1.0;
      p[u] = lo[u] + (i + 0.5) * du;
      p[v] = lo[v] + (j + 0.5) * dv;
      const std::vector<double> at = hits(shape, gp_Lin(gp_Pnt(p[0], p[1], p[2]), along), view.depth + 2.0);
      if (at.empty()) continue;
      covered[i * kGrid + j] = 1;
      view.covered.push_back({p[u], p[v]});
      ++count;
      if (at.size() >= 4) ++view.hidden;  // in, out, in, out: air between two layers of metal
      // A ray that grazes a surface has an odd number of hits; its gaps are not trusted.
      if (at.size() % 2 == 0) {
        for (std::size_t k = 1; k + 1 < at.size(); k += 2) view.gaps.push_back({i * kGrid + j, at[k], at[k + 1]});
      }
    }
  }
  view.du = du;
  view.lo = lo;
  view.dv = dv;
  view.area = count * du * dv;
  view.hidden_fraction = count > 0 ? static_cast<double>(view.hidden) / count : 0.0;
  view.parting = outline(covered, du, dv);
  return view;
}

// Cores: gaps of neighbouring rays that overlap along the axis are one connected region of air (union-find).
std::vector<CoreProperties> cores_of(const View& view) {
  const std::vector<Gap>& gaps = view.gaps;
  std::vector<int> parent(gaps.size());
  std::iota(parent.begin(), parent.end(), 0);
  const std::function<int(int)> root = [&](int x) { return parent[x] == x ? x : parent[x] = root(parent[x]); };
  // Gaps by cell, to find a cell's neighbours.
  std::vector<int> first(kGrid * kGrid + 1, 0);
  for (const Gap& g : gaps) ++first[g.cell + 1];
  std::partial_sum(first.begin(), first.end(), first.begin());
  for (int i = 0; i < kGrid; ++i) {
    for (int j = 0; j < kGrid; ++j) {
      const int cell = i * kGrid + j;
      for (const int next : {i + 1 < kGrid ? cell + kGrid : -1, j + 1 < kGrid ? cell + 1 : -1}) {
        if (next < 0) continue;
        for (int a = first[cell]; a < first[cell + 1]; ++a) {
          for (int b = first[next]; b < first[next + 1]; ++b) {
            if (gaps[a].from < gaps[b].to && gaps[b].from < gaps[a].to) parent[root(a)] = root(b);
          }
        }
      }
    }
  }
  struct Region {
    double volume = 0, from = 1e300, to = -1e300;
    Xyz moment{};  // volume x position, for the centre
    int i0 = kGrid, i1 = -1, j0 = kGrid, j1 = -1;
  };
  std::map<int, Region> regions;
  for (std::size_t n = 0; n < gaps.size(); ++n) {
    Region& r = regions[root(static_cast<int>(n))];
    const Gap& g = gaps[n];
    const int i = g.cell / kGrid, j = g.cell % kGrid;
    const double v = (g.to - g.from) * view.du * view.dv;
    r.volume += v;
    const int a = view.axis, ua = (a + 1) % 3, va = (a + 2) % 3;
    r.moment[a] += v * (view.lo[a] - 1.0 + 0.5 * (g.from + g.to));
    r.moment[ua] += v * (view.lo[ua] + (i + 0.5) * view.du);
    r.moment[va] += v * (view.lo[va] + (j + 0.5) * view.dv);
    r.from = std::min(r.from, g.from);
    r.to = std::max(r.to, g.to);
    r.i0 = std::min(r.i0, i);
    r.i1 = std::max(r.i1, i);
    r.j0 = std::min(r.j0, j);
    r.j1 = std::max(r.j1, j);
  }
  std::vector<CoreProperties> cores;
  for (const auto& [id, r] : regions) {
    CoreProperties core;
    core.volume = r.volume;
    core.centre = {r.moment[0] / r.volume, r.moment[1] / r.volume, r.moment[2] / r.volume};
    core.size = {(r.i1 - r.i0 + 1) * view.du, (r.j1 - r.j0 + 1) * view.dv, r.to - r.from};
    std::sort(core.size.begin(), core.size.end(), std::greater<double>());
    cores.push_back(core);
  }
  std::sort(cores.begin(), cores.end(),
            [](const CoreProperties& a, const CoreProperties& b) { return a.volume > b.volume; });
  if (cores.size() > 100) cores.resize(100);
  return cores;
}

// Area of the mesh triangles of a shape.
double mesh_area(const TopoDS_Shape& solid) {
  double area = 0;
  for (TopExp_Explorer it(solid, TopAbs_FACE); it.More(); it.Next()) {
    TopLoc_Location location;
    const occ::handle<Poly_Triangulation> t = BRep_Tool::Triangulation(TopoDS::Face(it.Current()), location);
    if (t.IsNull()) continue;
    for (int n = 1; n <= t->NbTriangles(); ++n) {
      int a, b, c;
      t->Triangle(n).Get(a, b, c);
      area += gp_Vec(t->Node(a), t->Node(b)).Crossed(gp_Vec(t->Node(a), t->Node(c))).Magnitude() / 2.0;
    }
  }
  return area;
}

// Points spread evenly over every mesh triangle: a flat face may be two large triangles, and one ray each would miss
// a thin wall over an inner void. Each triangle is split into m x m equal sub-triangles (m from the spacing); a ray
// starts at each sub-triangle's centre and carries its area.
std::optional<WallThickness> wall(IntCurvesFace_ShapeIntersector& shape, const TopoDS_Shape& solid, double diagonal) {
  const double spacing = std::max(diagonal / 60.0, std::sqrt(mesh_area(solid) / kThicknessRays));
  struct Sample {
    double thickness, area;
  };
  std::vector<Sample> samples;
  for (TopExp_Explorer it(solid, TopAbs_FACE); it.More(); it.Next()) {
    const TopoDS_Face face = TopoDS::Face(it.Current());
    TopLoc_Location location;
    const occ::handle<Poly_Triangulation> t = BRep_Tool::Triangulation(face, location);
    if (t.IsNull() || !t->HasUVNodes()) continue;
    const BRepAdaptor_Surface surface(face);
    const bool reversed = face.Orientation() == TopAbs_REVERSED;
    for (int n = 1; n <= t->NbTriangles(); ++n) {
      int a, b, c;
      t->Triangle(n).Get(a, b, c);
      const double area = gp_Vec(t->Node(a), t->Node(b)).Crossed(gp_Vec(t->Node(a), t->Node(c))).Magnitude() / 2.0;
      if (area <= 0) continue;
      const int m = std::max(1, static_cast<int>(std::ceil(std::sqrt(2.0 * area) / spacing)));
      const gp_XY ua = t->UVNode(a).XY(), ub = t->UVNode(b).XY(), uc = t->UVNode(c).XY();
      // Centres of the sub-triangles in barycentric steps of 1/m: m(m+1)/2 upright and m(m-1)/2 upside down.
      const auto sample = [&](double wb, double wc) {
        const gp_XY uv = ua * (1.0 - wb - wc) + ub * wb + uc * wc;
        gp_Pnt point;
        gp_Vec du, dv;
        surface.D1(uv.X(), uv.Y(), point, du, dv);
        gp_Vec normal = du.Crossed(dv);
        if (normal.Magnitude() < 1e-12) return;
        normal.Normalize();
        if (reversed) normal.Reverse();
        const double start = 1e-3;  // just inside the surface
        const std::vector<double> at =
            hits(shape, gp_Lin(point.Translated(-start * normal), gp_Dir(normal.Reversed())), 2.0 * diagonal);
        const auto next = std::find_if(at.begin(), at.end(), [](double w) { return w > 1e-4; });
        if (next != at.end()) samples.push_back({*next + start, area / (m * m)});
      };
      for (int i = 0; i < m; ++i) {
        for (int j = 0; i + j < m; ++j) {
          sample((i + 1.0 / 3.0) / m, (j + 1.0 / 3.0) / m);
          if (i + j < m - 1) sample((i + 2.0 / 3.0) / m, (j + 2.0 / 3.0) / m);
        }
      }
    }
  }
  if (samples.empty()) return std::nullopt;
  std::sort(samples.begin(), samples.end(), [](const Sample& x, const Sample& y) { return x.thickness < y.thickness; });
  const double total =
      std::accumulate(samples.begin(), samples.end(), 0.0, [](double s, const Sample& x) { return s + x.area; });
  const auto percentile = [&](double q) {
    double sum = 0;
    for (const Sample& x : samples) {
      sum += x.area;
      if (sum >= q * total) return x.thickness;
    }
    return samples.back().thickness;
  };
  WallThickness w;
  w.min = percentile(0.05);
  w.nominal = percentile(0.5);
  w.max = percentile(0.95);
  w.samples = static_cast<int>(samples.size());
  return w;
}

}  // namespace

CastingProperties measure_casting(const TDF_Label& part, const PartProperties& p, int forced_axis) {
  const TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(part);
  const Xyz lo = *p.box_min, hi = *p.box_max;
  IntCurvesFace_ShapeIntersector rays;
  rays.Load(shape, 1e-6);

  View best;
  bool first = true;
  for (int axis = 0; axis < 3; ++axis) {
    if (forced_axis >= 0 && axis != forced_axis) continue;
    const View view = look_along(rays, lo, hi, axis);
    const bool better = first || view.hidden < best.hidden ||
                        (view.hidden == best.hidden && view.depth < best.depth - 1e-9) ||
                        (view.hidden == best.hidden && std::abs(view.depth - best.depth) <= 1e-9 && view.area > best.area);
    if (better) best = view;
    first = false;
  }
  CastingProperties c;
  c.draw_axis = "xyz"[best.axis];
  c.axis_requested = forced_axis >= 0;
  c.draw_depth = best.depth;
  c.projected_area = best.area;
  c.parting_line = best.parting;
  c.footprint = best.footprint;
  c.hidden_fraction = best.hidden_fraction;
  c.covered = best.covered;
  c.cores = cores_of(best);
  const double diagonal = std::hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  c.wall = wall(rays, shape, diagonal);
  return c;
}
