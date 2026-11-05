"""Tessellate a shape into oriented triangles per face: one representation for planes, cylinders, cones and free-form (B-spline) surfaces alike."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List, Tuple

Vec = Tuple[float, float, float]


@dataclass(frozen=True)
class Triangle:
    centroid: Vec
    normal: Vec  # unit, pointing out of the material
    area: float
    vertices: Tuple[Vec, Vec, Vec]


@dataclass(frozen=True)
class Revolved:
    """The analytic parameters of a cylinder or cone face: where its axis is and how wide it is (the face's own extent is measured from its mesh)."""
    axis_point: Vec
    axis: Vec          # unit
    radius: float      # cylinder radius; for a cone, the radius at its reference plane
    half_angle: float  # radians; 0 for a cylinder


@dataclass(frozen=True)
class FaceMesh:
    index: int      # ordinal of the face in TopExp_Explorer order, the numbering every other detector and the 3D viewer use
    surface: str    # plane | cylinder | cone | sphere | torus | bspline | bezier | revolution | extrusion | offset | other
    area: float
    triangles: List[Triangle]
    revolved: "Revolved | None" = None  # set for cylinders and cones


def _surface_name(adaptor_type: Any) -> str:
    from OCC.Core import GeomAbs as g  # type: ignore

    return {
        g.GeomAbs_Plane: "plane", g.GeomAbs_Cylinder: "cylinder", g.GeomAbs_Cone: "cone", g.GeomAbs_Sphere: "sphere",
        g.GeomAbs_Torus: "torus", g.GeomAbs_BSplineSurface: "bspline", g.GeomAbs_BezierSurface: "bezier",
        g.GeomAbs_SurfaceOfRevolution: "revolution", g.GeomAbs_SurfaceOfExtrusion: "extrusion", g.GeomAbs_OffsetSurface: "offset",
    }.get(adaptor_type, "other")


def tessellate_faces(shape: Any, linear_deflection: float, angular_deflection: float = 0.5) -> List[FaceMesh]:
    """
    Every face of `shape` as oriented triangles. A triangle's normal points out of the material: the face's own orientation is applied, so a hole's wall
    has its normal toward the hole's axis, as it should for draft and undercut. A face that could not be meshed has no triangles (area still measured).
    """
    from OCC.Core.BRep import BRep_Tool  # type: ignore
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
    from OCC.Core.BRepGProp import brepgprop  # type: ignore
    from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh  # type: ignore
    from OCC.Core.GProp import GProp_GProps  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_REVERSED  # type: ignore
    from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
    from OCC.Core.TopLoc import TopLoc_Location  # type: ignore
    from OCC.Core.TopoDS import topods  # type: ignore

    BRepMesh_IncrementalMesh(shape, linear_deflection, False, angular_deflection, True)
    out: List[FaceMesh] = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    index = 0
    while explorer.More():
        face = topods.Face(explorer.Current())
        props = GProp_GProps()
        brepgprop.SurfaceProperties(face, props)
        area = float(props.Mass())
        surface = _surface_name(BRepAdaptor_Surface(face).GetType())
        triangles: List[Triangle] = []
        location = TopLoc_Location()
        tri = BRep_Tool.Triangulation(face, location)
        if tri is not None:
            transform = location.Transformation()
            reversed_face = face.Orientation() == TopAbs_REVERSED
            nodes = []
            for i in range(1, tri.NbNodes() + 1):
                p = tri.Node(i).Transformed(transform)
                nodes.append((float(p.X()), float(p.Y()), float(p.Z())))
            for i in range(1, tri.NbTriangles() + 1):
                a, b, c = tri.Triangle(i).Get()
                if reversed_face:
                    b, c = c, b
                t = _triangle(nodes[a - 1], nodes[b - 1], nodes[c - 1])
                if t is not None:
                    triangles.append(t)
        out.append(FaceMesh(index=index, surface=surface, area=area, triangles=triangles, revolved=_revolved(face, surface)))
        index += 1
        explorer.Next()
    return out


def _triangle(p: Vec, q: Vec, r: Vec) -> "Triangle | None":
    ux, uy, uz = q[0] - p[0], q[1] - p[1], q[2] - p[2]
    vx, vy, vz = r[0] - p[0], r[1] - p[1], r[2] - p[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    twice_area = (nx * nx + ny * ny + nz * nz) ** 0.5
    if twice_area < 1e-12:
        return None
    return Triangle(
        centroid=((p[0] + q[0] + r[0]) / 3.0, (p[1] + q[1] + r[1]) / 3.0, (p[2] + q[2] + r[2]) / 3.0),
        normal=(nx / twice_area, ny / twice_area, nz / twice_area),
        area=twice_area / 2.0,
        vertices=(p, q, r),
    )


def _revolved(face: Any, surface: str) -> "Revolved | None":
    if surface not in ("cylinder", "cone"):
        return None
    from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore

    adaptor = BRepAdaptor_Surface(face)
    if surface == "cylinder":
        c = adaptor.Cylinder()
        radius, half_angle = float(c.Radius()), 0.0
        axis = c.Axis()
    else:
        c = adaptor.Cone()
        radius, half_angle = float(c.RefRadius()), float(c.SemiAngle())
        axis = c.Axis()
    d, p = axis.Direction(), axis.Location()
    return Revolved(axis_point=(float(p.X()), float(p.Y()), float(p.Z())), axis=(float(d.X()), float(d.Y()), float(d.Z())), radius=radius, half_angle=half_angle)
