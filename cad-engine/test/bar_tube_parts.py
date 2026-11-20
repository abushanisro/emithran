"""OCC-built bar, tube and profile parts with known dimensions, for the bar and tube measurements."""
import math

from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakeWire, BRepBuilderAPI_MakePolygon
from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_MakePipe
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakePrism
from OCC.Core.GC import GC_MakeArcOfCircle
from OCC.Core.gp import gp_Ax2, gp_Circ, gp_Dir, gp_Pnt, gp_Vec


def _wire(edges):
    mk = BRepBuilderAPI_MakeWire()
    for e in edges:
        mk.Add(e)
    return mk.Wire()


def annulus_face(od, wall, at=(0, 0, 0), normal=(1, 0, 0)):
    ax = gp_Ax2(gp_Pnt(*at), gp_Dir(*normal))
    outer = _wire([BRepBuilderAPI_MakeEdge(gp_Circ(ax, od / 2.0)).Edge()])
    mk = BRepBuilderAPI_MakeFace(outer)
    if wall is not None and wall < od / 2.0:
        inner = _wire([BRepBuilderAPI_MakeEdge(gp_Circ(ax, od / 2.0 - wall)).Edge()])
        inner.Reverse()
        mk.Add(inner)
    return mk.Face()


def polygon_face(points_yz, x=0.0, holes=()):
    """A planar face in the plane x = const from (y, z) outlines."""
    def poly(pts):
        mk = BRepBuilderAPI_MakePolygon()
        for y, z in pts:
            mk.Add(gp_Pnt(x, y, z))
        mk.Close()
        return mk.Wire()
    mk = BRepBuilderAPI_MakeFace(poly(points_yz))
    for h in holes:
        w = poly(h)
        w.Reverse()
        mk.Add(w)
    return mk.Face()


def centreline(straights, bends):
    """
    A path in the XY plane starting at the origin along +X: straights[i] mm, then a bend of radius bends[i][0] turning bends[i][1] degrees
    (positive = left), alternating; len(straights) == len(bends) + 1.
    """
    x, y, heading = 0.0, 0.0, 0.0
    edges = []
    for i, s in enumerate(straights):
        nx, ny = x + s * math.cos(heading), y + s * math.sin(heading)
        if s > 0:
            edges.append(BRepBuilderAPI_MakeEdge(gp_Pnt(x, y, 0), gp_Pnt(nx, ny, 0)).Edge())
        x, y = nx, ny
        if i < len(bends):
            r, ang = bends[i]
            side = 1.0 if ang > 0 else -1.0
            cx, cy = x - side * r * math.sin(heading), y + side * r * math.cos(heading)
            a0 = math.atan2(y - cy, x - cx)
            a1 = a0 + math.radians(ang)
            am = (a0 + a1) / 2.0
            p1 = gp_Pnt(cx + r * math.cos(am), cy + r * math.sin(am), 0)
            p2 = gp_Pnt(cx + r * math.cos(a1), cy + r * math.sin(a1), 0)
            edges.append(BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(gp_Pnt(x, y, 0), p1, p2).Value()).Edge())
            x, y = p2.X(), p2.Y()
            heading += math.radians(ang)
    return _wire(edges)


def bent_tube(od, wall, straights, bends):
    return BRepOffsetAPI_MakePipe(centreline(straights, bends), annulus_face(od, wall)).Shape()


def swept(profile_face, straights, bends):
    return BRepOffsetAPI_MakePipe(centreline(straights, bends), profile_face).Shape()


def straight_tube(od, wall, length):
    return BRepPrimAPI_MakePrism(annulus_face(od, wall), gp_Vec(length, 0, 0)).Shape()


def prism(face, length):
    return BRepPrimAPI_MakePrism(face, gp_Vec(length, 0, 0)).Shape()


def drill(shape, x, diameter, through_y=True, z=0.0):
    """A hole of `diameter` across the part at x, along Y (both walls of a tube)."""
    cyl = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, -500, z), gp_Dir(0, 1, 0)), diameter / 2.0, 1000).Shape()
    return BRepAlgoAPI_Cut(shape, cyl).Shape()


def plate(points_xy, thickness, holes=()):
    def poly(pts):
        mk = BRepBuilderAPI_MakePolygon()
        for x, y in pts:
            mk.Add(gp_Pnt(x, y, 0))
        mk.Close()
        return mk.Wire()
    mk = BRepBuilderAPI_MakeFace(poly(points_xy))
    shape = BRepPrimAPI_MakePrism(mk.Face(), gp_Vec(0, 0, thickness)).Shape()
    for (x, y, d) in holes:
        shape = BRepAlgoAPI_Cut(shape, BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, -1), gp_Dir(0, 0, 1)), d / 2.0, thickness + 2).Shape()).Shape()
    return shape


def box(x, y, z):
    return BRepPrimAPI_MakeBox(x, y, z).Shape()


def revolved_tube(profile_xr):
    """A tube revolved about X from its wall profile: (x, r) points, closed (outer then inner, or any closed outline)."""
    from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeRevol
    from OCC.Core.gp import gp_Ax1
    mk = BRepBuilderAPI_MakePolygon()
    for x, r in profile_xr:
        mk.Add(gp_Pnt(x, 0, r))
    mk.Close()
    face = BRepBuilderAPI_MakeFace(mk.Wire()).Face()
    return BRepPrimAPI_MakeRevol(face, gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0))).Shape()


def flared_tube(od, wall, length, flare_len, flare_rise):
    ro, ri = od / 2.0, od / 2.0 - wall
    return revolved_tube([(0, ri), (length, ri), (length + flare_len, ri + flare_rise), (length + flare_len, ro + flare_rise), (length, ro), (0, ro)])


def expanded_tube(od, wall, length, transition, exp_len, grow):
    ro, ri = od / 2.0, od / 2.0 - wall
    pts = [(0, ri), (length, ri), (length + transition, ri + grow), (length + transition + exp_len, ri + grow),
           (length + transition + exp_len, ro + grow), (length + transition, ro + grow), (length, ro), (0, ro)]
    return revolved_tube(pts)


def mitre(shape, x_end, angle_deg, size=500):
    """Cut the part's +X end on a plane through (x_end, 0, 0), tilted angle_deg about Z from square."""
    from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeHalfSpace
    from OCC.Core.gp import gp_Pln
    a = math.radians(angle_deg)
    n = gp_Dir(math.cos(a), math.sin(a), 0)
    face = BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(x_end, 0, 0), n), -size, size, -size, size).Face()
    half = BRepPrimAPI_MakeHalfSpace(face, gp_Pnt(x_end + 10 * math.cos(a), 10 * math.sin(a), 0)).Solid()
    return BRepAlgoAPI_Cut(shape, half).Shape()


def cut_box(shape, at, size):
    from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox as Box
    return BRepAlgoAPI_Cut(shape, Box(gp_Pnt(*at), *size).Shape()).Shape()


def stepped_shaft():
    """A 12 mm shaft 30 mm long with a 20 mm collar 8 mm long at one end: a turned part, not bar stock as it stands."""
    from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse
    shaft = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)), 6, 30).Shape()
    collar = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(30, 0, 0), gp_Dir(1, 0, 0)), 10, 8).Shape()
    return BRepAlgoAPI_Fuse(shaft, collar).Shape()
