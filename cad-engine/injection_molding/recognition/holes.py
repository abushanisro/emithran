"""
Holes, bosses and arcs, from the cylindrical and conical faces of the part.

The old extractor counted every cylindrical FACE above a fixed radius as a hole or boss. A real hole is one feature however many faces carry it (the
wall is often split in two or four), and most cylindrical faces of a molded part are not holes at all but partial arcs: the rounded corner of a boss,
the end of a rib, a fillet. So here:

  * cylinder faces on the same axis line and radius are one cylinder;
  * its angular sweep is measured from the mesh (the face's own parameter range is not trusted on trimmed faces): a cylinder that wraps at least
    FULL_SWEEP_DEG is a hole (its wall faces the axis) or a boss/pin (its wall faces away); anything less is an arc;
  * holes on one axis line that touch end to end form one stack: a cylinder and a counterbore, or a cylinder and a countersink cone, is one hole with steps;
  * a stack is blind when a face closes one end (a flat bottom, a drill point, a round bottom), through when neither end is closed; a stack closed at
    both ends is an enclosed cavity, not a hole.

The geometry is measured here; whether a hole needs no core, a side core, a lifter or an unscrewing mandrel is decided in the backend from the staged
variables and the operation catalog, so this module holds no thresholds of that kind. FULL_SWEEP_DEG and the tolerances are geometric: how much of a
circle makes a hole, and how closely two cylinders must agree to be one.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Sequence, Tuple

from .mesh import FaceMesh
from .vec import Vec, angle_between_axes_deg, canonical, cross, dot, line_distance, scale, sub, unit

FULL_SWEEP_DEG = 300.0
RADIUS_TOL_MM = 0.02        # two faces of one cylinder agree on radius to this
LINE_TOL_MM = 0.05          # ... and on the axis line to this
PARALLEL_TOL_DEG = 0.5
TOUCH_TOL_MM = 0.2          # two bores touch end to end within this
CLOSE_TOL_MM = 0.1          # a face closes a bore end when it lies within this of the end plane


@dataclass(frozen=True)
class Cylinder:
    face_ids: Tuple[int, ...]
    kind: str              # 'cylinder' | 'cone'
    radius_mm: float       # cylinder radius; for a cone the larger radius
    small_radius_mm: float  # equals radius_mm for a cylinder
    axis: Vec              # canonical unit
    axis_point: Vec
    sweep_deg: float
    t_min: float           # axial extent along `axis`, measured from the world origin (comparable between cylinders on one line)
    t_max: float
    concave: bool          # the wall faces the axis (a hole) rather than away from it (a boss)


def _basis(axis: Vec) -> Tuple[Vec, Vec]:
    a = (1.0, 0.0, 0.0) if abs(axis[0]) < 0.9 else (0.0, 1.0, 0.0)
    e1 = unit(cross(axis, a))
    return e1, cross(axis, e1)


def _sweep_deg(angles: List[float]) -> float:
    """360 degrees minus the empty arc: the largest gap between neighbouring vertex angles, less the usual gap (a full wrap has gaps of the mesh size)."""
    if len(angles) < 3:
        return 0.0
    a = sorted(angles)
    gaps = [a[i + 1] - a[i] for i in range(len(a) - 1)] + [a[0] + 360.0 - a[-1]]
    typical = sorted(gaps)[len(gaps) // 2]
    return max(0.0, 360.0 - max(0.0, max(gaps) - typical))


def _measure(face_ids: Sequence[int], kind: str, meshes_by_id: Dict[int, FaceMesh]) -> Cylinder:
    first = meshes_by_id[face_ids[0]].revolved
    assert first is not None
    axis = canonical(first.axis)
    e1, e2 = _basis(axis)
    point = first.axis_point
    angles: List[float] = []
    ts: List[float] = []
    radii: List[float] = []
    outward_sum = 0.0
    weight = 0.0
    for fid in face_ids:
        for tri in meshes_by_id[fid].triangles:
            for v in tri.vertices:
                rel = sub(v, point)
                radial = sub(rel, scale(axis, dot(rel, axis)))
                r = math.sqrt(dot(radial, radial))
                ts.append(dot(v, axis))  # along the axis from the world origin, so bores on one line can be compared
                radii.append(r)
                if r > 1e-9:
                    angles.append(math.degrees(math.atan2(dot(radial, e2), dot(radial, e1))))
            rel = sub(tri.centroid, point)
            rc = sub(rel, scale(axis, dot(rel, axis)))
            m = math.sqrt(dot(rc, rc))
            if m > 1e-9:
                outward_sum += dot(tri.normal, scale(rc, 1.0 / m)) * tri.area
                weight += tri.area
    big = max(radii) if radii else first.radius
    small = min(radii) if radii else first.radius
    return Cylinder(
        face_ids=tuple(face_ids), kind=kind, radius_mm=big if kind == "cone" else first.radius,
        small_radius_mm=small if kind == "cone" else first.radius, axis=axis, axis_point=point,
        sweep_deg=_sweep_deg(angles), t_min=min(ts) if ts else 0.0, t_max=max(ts) if ts else 0.0,
        concave=(outward_sum / weight < 0.0) if weight > 0 else True,
    )


def _same_line(a: Any, b: Any) -> bool:
    return angle_between_axes_deg(a.axis, b.axis) <= PARALLEL_TOL_DEG and line_distance(a.axis_point, b.axis_point, canonical(a.axis)) <= LINE_TOL_MM


def cylinders(meshes: Sequence[FaceMesh]) -> List[Cylinder]:
    """Cylinder faces merged by axis line and radius into cylinders; cone faces merged by axis line and half angle into cones."""
    by_id = {f.index: f for f in meshes}
    revolved = [f for f in meshes if f.revolved is not None and f.surface in ("cylinder", "cone")]
    groups: List[List[FaceMesh]] = []
    for f in revolved:
        for g in groups:
            h = g[0]
            if h.surface != f.surface or not _same_line(h.revolved, f.revolved):
                continue
            if f.surface == "cylinder" and abs(h.revolved.radius - f.revolved.radius) > RADIUS_TOL_MM:
                continue
            if f.surface == "cone" and abs(abs(h.revolved.half_angle) - abs(f.revolved.half_angle)) > math.radians(0.5):
                continue
            g.append(f)
            break
        else:
            groups.append([f])
    out: List[Cylinder] = []
    for g in groups:
        out.extend(_measure(ids, g[0].surface, by_id) for ids in _axial_components(g))
    return out


def _axial_components(group: Sequence[FaceMesh]) -> List[List[int]]:
    """
    Faces of one cylinder line and radius that are separate along the axis are separate cylinders: two holes in line on opposite sides of a part share
    a line and a radius. Faces whose axial extents overlap or touch (the two halves of one wall, or a wall split along its length) belong together.
    """
    axis = canonical(group[0].revolved.axis)
    spans = []
    for f in group:
        ts = [dot(v, axis) for tri in f.triangles for v in tri.vertices]
        spans.append((min(ts), max(ts), f.index) if ts else (0.0, 0.0, f.index))
    spans.sort()
    components: List[List[int]] = []
    current_end = None
    for lo, hi, fid in spans:
        if current_end is not None and lo <= current_end + TOUCH_TOL_MM:
            components[-1].append(fid)
            current_end = max(current_end, hi)
        else:
            components.append([fid])
            current_end = hi
    return components


def _closing_face(meshes: Sequence[FaceMesh], members: Sequence[Cylinder], axis: Vec, point: Vec, t_end: float, radius: float, outward: float) -> bool:
    """Whether a face other than the bore's own walls lies across the bore at its end `t_end` (outward = +1 for the high end, -1 for the low end)."""
    own = {fid for c in members for fid in c.face_ids}
    for f in meshes:
        if f.index in own or not f.triangles:
            continue
        inside = True
        reaches_end = False
        for tri in f.triangles:
            for v in tri.vertices:
                rel = sub(v, point)
                t = dot(v, axis)
                radial = sub(rel, scale(axis, dot(rel, axis)))
                if math.sqrt(dot(radial, radial)) > radius + 0.08:
                    inside = False
                    break
                d = (t - t_end) * outward  # beyond the end plane is positive
                if d < -CLOSE_TOL_MM or d > radius + CLOSE_TOL_MM:
                    inside = False
                    break
                if abs(d) <= CLOSE_TOL_MM:
                    reaches_end = True
            if not inside:
                break
        if inside and reaches_end:
            return True
    return False


def recognize_holes(meshes: Sequence[FaceMesh], pull: Vec) -> Dict[str, Any]:
    cyls = cylinders(meshes)
    holes_raw = [c for c in cyls if c.concave and c.sweep_deg >= FULL_SWEEP_DEG]
    bosses = [c for c in cyls if not c.concave and c.kind == "cylinder" and c.sweep_deg >= FULL_SWEEP_DEG]
    arcs = [c for c in cyls if c.sweep_deg < FULL_SWEEP_DEG]

    # Stacks: bores on one axis line that touch end to end.
    stacks: List[List[Cylinder]] = []
    for c in sorted(holes_raw, key=lambda c: c.t_min):
        for s in stacks:
            if _same_line(s[0], c) and any(abs(c.t_min - o.t_max) <= TOUCH_TOL_MM or abs(o.t_min - c.t_max) <= TOUCH_TOL_MM for o in s):
                s.append(c)
                break
        else:
            stacks.append([c])

    holes: List[Dict[str, Any]] = []
    enclosed = 0
    cone_only = 0
    for s in stacks:
        if not any(c.kind == "cylinder" for c in s):
            cone_only += 1  # a countersink or dimple with no bore of its own is not a hole
            continue
        axis, point = s[0].axis, s[0].axis_point
        s = sorted(s, key=lambda c: c.t_min)
        lo, hi = min(c.t_min for c in s), max(c.t_max for c in s)
        at_lo = next(c for c in s if c.t_min == lo)
        at_hi = next(c for c in s if c.t_max == hi)
        r_lo = at_lo.small_radius_mm if at_lo.kind == "cone" else at_lo.radius_mm
        r_hi = at_hi.small_radius_mm if at_hi.kind == "cone" and at_hi.t_max == hi and at_hi is not at_lo else at_hi.radius_mm
        widest = max(c.radius_mm for c in s)
        closed_lo = r_lo < 0.15 * widest or _closing_face(meshes, s, axis, point, lo, max(r_lo, 0.05), -1.0)
        closed_hi = r_hi < 0.15 * widest or _closing_face(meshes, s, axis, point, hi, max(r_hi, 0.05), 1.0)
        if closed_lo and closed_hi:
            enclosed += 1
            continue
        cyl_steps = [c for c in s if c.kind == "cylinder"]
        radii = sorted({round(c.radius_mm, 2) for c in cyl_steps})
        steps = [
            {"kind": c.kind, "diameter_mm": round(2 * c.radius_mm, 3), **({"small_diameter_mm": round(2 * c.small_radius_mm, 3)} if c.kind == "cone" else {}),
             "length_mm": round(c.t_max - c.t_min, 3)}
            for c in s
        ]
        smallest = min(c.radius_mm for c in cyl_steps) if cyl_steps else widest
        holes.append({
            "feature_type": "MultiStepHole" if len(radii) > 1 else "SimpleHole",
            "variant": "blind" if (closed_lo or closed_hi) else "through",
            "diameter_mm": round(2 * smallest, 3),
            "depth_mm": round(hi - lo, 3),
            "depth_to_diameter": round((hi - lo) / (2 * smallest), 2),
            "steps": steps,
            "axis": [round(x, 5) for x in axis],
            "angle_to_pull_deg": round(angle_between_axes_deg(axis, pull), 2),
            "face_ids": sorted({fid for c in s for fid in c.face_ids}),
        })
    holes.sort(key=lambda h: (h["diameter_mm"], h["depth_mm"]))
    for i, h in enumerate(holes, 1):
        h["id"] = f"hole-{i}"
    return {
        "holes": holes,
        "bosses": [{"diameter_mm": round(2 * c.radius_mm, 3), "length_mm": round(c.t_max - c.t_min, 3), "axis": [round(x, 5) for x in c.axis],
                    "angle_to_pull_deg": round(angle_between_axes_deg(c.axis, pull), 2), "face_ids": list(c.face_ids)} for c in bosses],
        "arcs": {
            "count": len(arcs),
            "concave": sum(1 for c in arcs if c.concave),
            "convex": sum(1 for c in arcs if not c.concave),
            "sweep_deg_range": [round(min(c.sweep_deg for c in arcs), 1), round(max(c.sweep_deg for c in arcs), 1)] if arcs else None,
        },
        "enclosed_cavities": enclosed,
        "cone_only_dimples": cone_only,
        "cylinder_faces": sum(1 for f in meshes if f.surface == "cylinder"),
        "cylinders": sum(1 for c in cyls if c.kind == "cylinder"),
    }
