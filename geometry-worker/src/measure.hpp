// The process-independent measurements of a solid, identical to cad-engine/shared/solid_measures.py.
#pragma once

#include <TopoDS_Shape.hxx>

namespace gw {

struct Measures {
  double volume;        // mm3, never negative
  double surface_area;  // mm2, never negative
  // Bounding-box extents sorted longest first (whatever the STEP axis orientation), rounded to 4 decimals like the Python engine.
  double length, width, height, diagonal;
};

Measures measure_solid(const TopoDS_Shape& shape);

}  // namespace gw
