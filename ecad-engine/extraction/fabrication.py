"""Bare-board fabrication facts that a Gerber set can state: narrowest drawn conductor and smallest drilled hole."""
from __future__ import annotations

from dataclasses import dataclass

from gerbonara import GerberFile

from parsers.gerber_layer import to_mm
from parsers.excellon import Hole

STROKE_DECIMALS = 3


@dataclass(frozen=True)
class TraceWidth:
    min_width_mm: float | None
    strokes: int
    skipped: int  # strokes drawn with a non-circular aperture, which are not measured


def measure_trace_width(file: GerberFile) -> TraceWidth:
    """Narrowest drawn stroke (Line or Arc, dark polarity) with a circular aperture.

    Flashes are pads and regions are pours, so neither is a trace. A stroke with a non-circular aperture has no single
    width, so it is counted as skipped instead of being measured by guess.
    """
    narrowest: float | None = None
    strokes = skipped = 0
    for obj in file.objects:
        if type(obj).__name__ not in ("Line", "Arc") or not obj.polarity_dark:
            continue
        aperture = obj.aperture
        if type(aperture).__name__ != "CircleAperture":
            skipped += 1
            continue
        width = round(to_mm(aperture.diameter, aperture.unit), STROKE_DECIMALS)
        if width <= 0:
            continue
        strokes += 1
        narrowest = width if narrowest is None else min(narrowest, width)
    return TraceWidth(min_width_mm=narrowest, strokes=strokes, skipped=skipped)


def smallest_hole_mm(holes: list[Hole]) -> float | None:
    return round(min(h.diameter_mm for h in holes), STROKE_DECIMALS) if holes else None
