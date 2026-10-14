"""
Cylinders hidden in non-analytic faces.

Some CAD exports write every face as a B-spline surface, holes and bores
included. The recognizers look for analytic cylinders (GeomAbs_Cylinder), so
such a part got no holes, no diameters and one catch-all "curved surface".
pythonocc 7.7 has no GeomConvert_SurfToAnalytic, so a face is recognised here
from its own geometry instead.

A face is a cylinder when, over a grid of its surface:
  - one principal curvature is ~0 and the other is a constant 1/r;
  - the zero-curvature direction (the axis) is the same everywhere;
  - every sample is at distance r from one line.
All three are checked (curvature alone also passes for a cone sample patch).
Nothing is assumed from the surface type name, and a face that does not pass
is simply not a cylinder here.

Concave or convex comes from the solid: the face's outward normal (surface
normal flipped by the face orientation) against the radial direction. That is
the information `Orientation() != FORWARD` carries for an analytic cylinder, and
it cannot be used for a B-spline whose own normal may point either way.
"""
import math
from dataclasses import dataclass
from typing import Optional, Tuple

Vec = Tuple[float, float, float]

GRID = 7                      # samples per direction for the curvature fit
ANGLE_SAMPLES = 24            # samples along the angular direction for the extent
RADIUS_REL_TOL = 0.01         # curvature, and distance from the axis, within 1 % of r
FLAT_REL_TOL = 0.02           # the "zero" principal curvature, relative to the other
AXIS_PARALLEL_DOT = 0.9995    # ~1.8 deg between sampled axis directions
MIN_RADIUS_MM = 1e-3


@dataclass(frozen=True)
class FittedCylinder:
    radius: float
    axis: Vec             # unit
    location: Vec         # a point on the axis (nearest the face centre)
    u_range: float        # angular extent of the face, radians (2*pi = full cylinder)
    internal: bool        # True: material is outside the cylinder (a bore)


def _dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _norm(a: Vec) -> float:
    return math.sqrt(_dot(a, a))


def _unit(a: Vec) -> Vec:
    n = _norm(a) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def fit_cylinder(face) -> Optional[FittedCylinder]:
    """The cylinder this face is, or None when it is not one (or cannot be told)."""
    from OCC.Core.BRep import BRep_Tool  # type: ignore
    from OCC.Core.BRepTools import breptools  # type: ignore
    from OCC.Core.GeomLProp import GeomLProp_SLProps  # type: ignore
    from OCC.Core.gp import gp_Dir  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FORWARD  # type: ignore

    surface = BRep_Tool.Surface(face)
    if surface is None:
        return None
    u1, u2, v1, v2 = breptools.UVBounds(face)
    if not all(math.isfinite(x) for x in (u1, u2, v1, v2)) or u2 <= u1 or v2 <= v1:
        return None
    flip = -1.0 if face.Orientation() != TopAbs_FORWARD else 1.0

    samples = []  # (point, outward normal, signed curvature, axis direction)
    for i in range(GRID):
        u = u1 + (u2 - u1) * (0.1 + 0.8 * i / (GRID - 1))
        for j in range(GRID):
            v = v1 + (v2 - v1) * (0.1 + 0.8 * j / (GRID - 1))
            props = GeomLProp_SLProps(surface, u, v, 2, 1e-7)
            if not (props.IsNormalDefined() and props.IsCurvatureDefined()):
                return None
            k_max, k_min = props.MaxCurvature(), props.MinCurvature()
            big, small = (k_max, k_min) if abs(k_max) >= abs(k_min) else (k_min, k_max)
            if abs(big) < 1e-9 or abs(small) > FLAT_REL_TOL * abs(big):
                return None  # flat, or curved both ways: not a cylinder
            d_max, d_min = gp_Dir(), gp_Dir()
            props.CurvatureDirections(d_max, d_min)
            axis_d = d_min if abs(k_max) >= abs(k_min) else d_max
            p, n = props.Value(), props.Normal()
            samples.append((
                (p.X(), p.Y(), p.Z()),
                (flip * n.X(), flip * n.Y(), flip * n.Z()),
                big,
                (axis_d.X(), axis_d.Y(), axis_d.Z()),
                (n.X(), n.Y(), n.Z()),
            ))

    radius = 1.0 / abs(samples[0][2])
    if radius < MIN_RADIUS_MM:
        return None
    if any(abs(1.0 / abs(s[2]) - radius) > RADIUS_REL_TOL * radius for s in samples):
        return None
    ref = samples[0][3]
    if any(abs(_dot(s[3], ref)) < AXIS_PARALLEL_DOT for s in samples):
        return None
    axis = _unit((sum(math.copysign(1.0, _dot(s[3], ref)) * s[3][0] for s in samples),
                  sum(math.copysign(1.0, _dot(s[3], ref)) * s[3][1] for s in samples),
                  sum(math.copysign(1.0, _dot(s[3], ref)) * s[3][2] for s in samples)))

    # A point on the axis: each sample's centre of curvature, P + N / k (surface normal, signed k).
    centres = [(s[0][0] + s[4][0] / s[2], s[0][1] + s[4][1] / s[2], s[0][2] + s[4][2] / s[2]) for s in samples]
    centre = (sum(c[0] for c in centres) / len(centres),
              sum(c[1] for c in centres) / len(centres),
              sum(c[2] for c in centres) / len(centres))
    # Every sample must really sit at `radius` from the axis line through `centre`.
    for s in samples:
        rel = _sub(s[0], centre)
        along = _dot(rel, axis)
        radial = (rel[0] - along * axis[0], rel[1] - along * axis[1], rel[2] - along * axis[2])
        if abs(_norm(radial) - radius) > RADIUS_REL_TOL * radius:
            return None

    # Bore (material outside) when the outward normal points at the axis.
    inward = sum(1 for s in samples if _dot(s[1], _sub(s[0], centre)) < 0)
    internal = inward > len(samples) / 2

    # Angular extent: unwrap the angle around the axis along the face's u direction.
    mid_v = (v1 + v2) / 2
    base = _unit(_sub(samples[0][0], centre))
    base = _unit((base[0] - _dot(base, axis) * axis[0], base[1] - _dot(base, axis) * axis[1], base[2] - _dot(base, axis) * axis[2]))
    side = (axis[1] * base[2] - axis[2] * base[1], axis[2] * base[0] - axis[0] * base[2], axis[0] * base[1] - axis[1] * base[0])
    total, last = 0.0, None
    for k in range(ANGLE_SAMPLES + 1):
        p = surface.Value(u1 + (u2 - u1) * k / ANGLE_SAMPLES, mid_v)
        rel = _sub((p.X(), p.Y(), p.Z()), centre)
        angle = math.atan2(_dot(rel, side), _dot(rel, base))
        if last is not None:
            step = angle - last
            while step > math.pi:
                step -= 2 * math.pi
            while step < -math.pi:
                step += 2 * math.pi
            total += step
        last = angle
    u_range = min(abs(total), 2 * math.pi)

    # The axis point nearest the face centre, so `location` sits at the face rather than far along the axis.
    mid = surface.Value((u1 + u2) / 2, (v1 + v2) / 2)
    rel = _sub((mid.X(), mid.Y(), mid.Z()), centre)
    t = _dot(rel, axis)
    location = (centre[0] + t * axis[0], centre[1] + t * axis[1], centre[2] + t * axis[2])
    return FittedCylinder(radius=radius, axis=axis, location=location, u_range=u_range, internal=internal)


def face_is_internal(face, location: Vec, axis: Vec) -> bool:
    """True when the solid's material is OUTSIDE this cylindrical face (a bore, a concave round).

    The face's outward normal (surface normal flipped by the face orientation) against the radial
    direction at the face centre. `Orientation() != FORWARD` alone is wrong for a cylinder built
    with a left-handed axis, whose own normal points inward.
    """
    from OCC.Core.BRep import BRep_Tool  # type: ignore
    from OCC.Core.BRepTools import breptools  # type: ignore
    from OCC.Core.GeomLProp import GeomLProp_SLProps  # type: ignore
    from OCC.Core.TopAbs import TopAbs_FORWARD  # type: ignore

    surface = BRep_Tool.Surface(face)
    u1, u2, v1, v2 = breptools.UVBounds(face)
    props = GeomLProp_SLProps(surface, (u1 + u2) / 2, (v1 + v2) / 2, 1, 1e-7)
    p, n = props.Value(), props.Normal()
    flip = -1.0 if face.Orientation() != TopAbs_FORWARD else 1.0
    rel = _sub((p.X(), p.Y(), p.Z()), location)
    along = _dot(rel, axis)
    radial = (rel[0] - along * axis[0], rel[1] - along * axis[1], rel[2] - along * axis[2])
    return _dot((flip * n.X(), flip * n.Y(), flip * n.Z()), radial) < 0
