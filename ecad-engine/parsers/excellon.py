"""Excellon drill file reading: every hole with its finished diameter and plating."""
from __future__ import annotations

from dataclasses import dataclass

from gerbonara import ExcellonFile

from parsers.gerber_layer import to_mm


@dataclass(frozen=True)
class Hole:
    x_mm: float
    y_mm: float
    diameter_mm: float
    plated: bool
    tool: int | None


def load_holes(name: str, data: bytes) -> list[Hole]:
    text = data.decode("latin1")
    file = ExcellonFile.from_string(text, filename=name)
    holes: list[Hole] = []
    for obj in file.objects:
        tool = obj.tool
        holes.append(
            Hole(
                x_mm=to_mm(obj.x, obj.unit),
                y_mm=to_mm(obj.y, obj.unit),
                diameter_mm=to_mm(tool.diameter, tool.unit),
                plated=bool(tool.plated),
                tool=getattr(tool, "original_number", None),
            )
        )
    return holes
