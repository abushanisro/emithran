"""Plain 3-vector helpers shared by the recognition modules (tuples of floats, no dependencies)."""
from __future__ import annotations

import math
from typing import Tuple

Vec = Tuple[float, float, float]


def dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def scale(a: Vec, k: float) -> Vec:
    return (a[0] * k, a[1] * k, a[2] * k)


def norm(a: Vec) -> float:
    return math.sqrt(dot(a, a))


def unit(v: Vec) -> Vec:
    m = norm(v)
    if m < 1e-12:
        raise ValueError("a direction cannot be the zero vector")
    return (v[0] / m, v[1] / m, v[2] / m)


def canonical(d: Vec) -> Vec:
    """The same axis, signed so its largest component is positive: an axis has two names, this picks one."""
    d = unit(d)
    i = max(range(3), key=lambda k: abs(d[k]))
    return d if d[i] >= 0 else (-d[0], -d[1], -d[2])


def angle_between_axes_deg(a: Vec, b: Vec) -> float:
    """The angle between two axes (signs ignored), 0 to 90 degrees."""
    return math.degrees(math.acos(min(1.0, abs(dot(unit(a), unit(b))))))


def line_distance(p1: Vec, p2: Vec, direction: Vec) -> float:
    """Distance between two parallel lines through p1 and p2 with the given direction."""
    return norm(cross(sub(p2, p1), unit(direction)))
