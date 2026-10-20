"""Drilled holes grouped by finished diameter and plating, checked against the drill report."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from parsers.drill_report import ReportedTool
from parsers.excellon import Hole

DIAMETER_DECIMALS = 3
REPORT_TOLERANCE_MM = 0.05


@dataclass(frozen=True)
class HoleGroup:
    diameter_mm: float
    plated: bool
    count: int


def group_holes(holes: list[Hole]) -> list[HoleGroup]:
    counts = Counter((round(h.diameter_mm, DIAMETER_DECIMALS), h.plated) for h in holes)
    return [HoleGroup(d, plated, n) for (d, plated), n in sorted(counts.items(), key=lambda kv: (not kv[0][1], kv[0][0]))]


def compare_with_report(groups: list[HoleGroup], report: list[ReportedTool]) -> list[tuple[str, str]]:
    """(severity, message) for each disagreement; a single info entry when everything matches."""
    findings: list[tuple[str, str]] = []
    unmatched = list(groups)
    for tool in report:
        match = next(
            (g for g in unmatched if g.plated == tool.plated and abs(g.diameter_mm - tool.diameter_mm) <= REPORT_TOLERANCE_MM),
            None,
        )
        label = f"T{tool.tool} {tool.diameter_mm:g} mm {'plated' if tool.plated else 'non-plated'}"
        if match is None:
            findings.append(("warning", f"drill report lists {label} x {tool.count}, but the drill file has no such holes"))
            continue
        unmatched.remove(match)
        if match.count != tool.count:
            findings.append(("warning", f"drill report lists {label} x {tool.count}, the drill file has {match.count}"))
    for group in unmatched:
        findings.append(("warning", f"drill file has {group.count} holes of {group.diameter_mm:g} mm not in the drill report"))
    if not findings:
        total = sum(g.count for g in groups)
        return [("info", f"drill file matches the drill report: {total} holes in {len(groups)} tool groups")]
    return findings
