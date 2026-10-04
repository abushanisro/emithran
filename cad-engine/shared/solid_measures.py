"""
The process-independent measurements of a solid: volume, surface area and
the bounding box (sorted so length >= width >= height, whatever the STEP axis
orientation). One function, used by the full analysis
(memory_optimizer._analyze_geometry_advanced) and by POST /measure/geometry,
which fills a BOM item's physical properties before its process is known, so
the two can never report different numbers for the same file.
"""
from __future__ import annotations

from typing import Any, Dict


def measure_solid(shape: Any) -> Dict[str, Any]:
    from OCC.Core.Bnd import Bnd_Box  # type: ignore
    from OCC.Core.BRepBndLib import brepbndlib  # type: ignore
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore

    volume_props = GProp_GProps()
    surface_props = GProp_GProps()
    brepgprop.VolumeProperties(shape, volume_props)
    brepgprop.SurfaceProperties(shape, surface_props)

    bbox = Bnd_Box()
    brepbndlib.Add(shape, bbox)
    xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()
    extents = sorted([round(xmax - xmin, 4), round(ymax - ymin, 4), round(zmax - zmin, 4)], reverse=True)
    return {
        "volume_props": volume_props,
        "volume": max(volume_props.Mass(), 0.0),
        "surface_area": max(surface_props.Mass(), 0.0),
        "bounding_box": {
            "length": extents[0],
            "width": extents[1],
            "height": extents[2],
            "diagonal": round(((xmax - xmin) ** 2 + (ymax - ymin) ** 2 + (zmax - zmin) ** 2) ** 0.5, 4),
        },
    }
