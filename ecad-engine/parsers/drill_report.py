"""Altium NC Drill report (.DRR): the tool table the drill file is checked against."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ReportedTool:
    tool: int
    diameter_mm: float
    count: int
    plated: bool


def parse_drill_report(data: bytes) -> list[ReportedTool]:
    """Reads the rows of the tool table: `T1  24mil (0.6mm)  Round  224  PTH  ...`.

    A row is a line whose first token is T followed by digits. The diameter in millimetres is the
    parenthesised value; the plating is the PTH / NPTH column.
    """
    tools: list[ReportedTool] = []
    for line in data.decode("latin1").splitlines():
        tokens = line.split()
        if not tokens or tokens[0][:1] != "T" or not tokens[0][1:].isdigit():
            continue
        mm = next((t for t in tokens if t.startswith("(") and t.endswith("mm)")), None)
        plating = next((t for t in tokens if t in ("PTH", "NPTH")), None)
        # The hole count is the token just before the plating column.
        before = tokens[tokens.index(plating) - 1] if plating else ""
        if mm is None or plating is None or not before.isdigit():
            raise ValueError(f"drill report row not understood: {line.strip()}")
        count = int(before)
        tools.append(ReportedTool(int(tokens[0][1:]), float(mm[1:-3]), count, plating == "PTH"))
    return tools
