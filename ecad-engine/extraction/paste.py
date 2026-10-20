"""Solder paste opening area from a paste layer: the sum of the flashed pad areas."""
from __future__ import annotations

import math
from dataclasses import dataclass

from gerbonara import GerberFile

from parsers.gerber_layer import to_mm


@dataclass(frozen=True)
class Paste:
    area_mm2: float
    openings: int


def _flash_area_mm2(obj) -> float:
    aperture = obj.aperture
    kind = type(aperture).__name__
    unit = aperture.unit
    if kind == "RectangleAperture":
        return to_mm(aperture.w, unit) * to_mm(aperture.h, unit)
    if kind == "CircleAperture":
        d = to_mm(aperture.diameter, unit)
        return math.pi * d * d / 4
    if kind == "ObroundAperture":  # a rectangle with semicircular ends: (long - d) * d + pi d^2 / 4
        w, h = to_mm(aperture.w, unit), to_mm(aperture.h, unit)
        d, long = min(w, h), max(w, h)
        return (long - d) * d + math.pi * d * d / 4
    raise ValueError(f"paste layer uses a {kind} aperture, which is not measured")


def measure_paste(file: GerberFile) -> Paste:
    """Overlapping openings would be counted twice; paste layers do not overlap openings."""
    total, count = 0.0, 0
    for obj in file.objects:
        kind = type(obj).__name__
        if kind != "Flash":
            raise ValueError(f"paste layer holds a {kind}; only flashed openings are measured")
        if not obj.polarity_dark:
            raise ValueError("paste layer uses clear polarity, which is not measured")
        total += _flash_area_mm2(obj)
        count += 1
    return Paste(area_mm2=total, openings=count)
