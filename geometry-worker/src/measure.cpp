#include "measure.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <functional>

#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>

namespace gw {

namespace {
// Python's round(x, 4): half to even is not what C++ gives, but the values here are measured doubles, never exact halves.
double round4(double x) { return std::round(x * 1e4) / 1e4; }
}  // namespace

Measures measure_solid(const TopoDS_Shape& shape) {
  GProp_GProps volume_props, surface_props;
  BRepGProp::VolumeProperties(shape, volume_props);
  BRepGProp::SurfaceProperties(shape, surface_props);

  Bnd_Box box;
  BRepBndLib::Add(shape, box);
  double xmin, ymin, zmin, xmax, ymax, zmax;
  box.Get(xmin, ymin, zmin, xmax, ymax, zmax);
  std::array<double, 3> extents{round4(xmax - xmin), round4(ymax - ymin), round4(zmax - zmin)};
  std::sort(extents.begin(), extents.end(), std::greater<double>());
  const double dx = xmax - xmin, dy = ymax - ymin, dz = zmax - zmin;
  return {std::max(volume_props.Mass(), 0.0), std::max(surface_props.Mass(), 0.0), extents[0], extents[1], extents[2],
          round4(std::sqrt(dx * dx + dy * dy + dz * dz))};
}

}  // namespace gw
