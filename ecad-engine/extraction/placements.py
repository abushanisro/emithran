"""Component placements from a Pick Place table, grouped by side and footprint."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from parsers.tabular import Table

REQUIRED_COLUMNS = ("Designator", "Layer", "Footprint")
# Altium Pick Place export: where each part sits. Needed to show parts on the board, not to count them.
POSITION_COLUMNS = ("Center-X(mm)", "Center-Y(mm)", "Rotation")


@dataclass(frozen=True)
class PlacementGroup:
    side: str
    footprint: str
    count: int


@dataclass(frozen=True)
class Component:
    designator: str
    comment: str
    footprint: str
    side: str
    x_mm: float
    y_mm: float
    rotation_deg: float


class PlacementError(ValueError):
    pass


def read_components(table: Table, layer_sides: dict[str, str]) -> list[Component]:
    """Every placed part with its position, exactly as the Pick Place file states it."""
    missing = [c for c in (*REQUIRED_COLUMNS, *POSITION_COLUMNS) if c not in table.headers]
    if missing:
        raise PlacementError(f"Pick Place table lacks column(s): {', '.join(missing)}")
    components: list[Component] = []
    for row in table.rows:
        side = layer_sides.get(row["Layer"].lower())
        if side is None:
            raise PlacementError(f"Pick Place layer {row['Layer']!r} is not in the placement layer table")
        try:
            x, y, rotation = (float(row[c]) for c in POSITION_COLUMNS)
        except ValueError as error:
            raise PlacementError(f"Pick Place row {row['Designator']!r} has a non-numeric position") from error
        components.append(Component(row["Designator"], row.get("Comment", ""), row["Footprint"], side, x, y, rotation))
    return components


def group_placements(table: Table, layer_sides: dict[str, str]) -> tuple[list[PlacementGroup], list[str]]:
    """Returns the groups and the designators that were duplicated. `layer_sides` maps a lower-case layer name to a side."""
    missing = [c for c in REQUIRED_COLUMNS if c not in table.headers]
    if missing:
        raise PlacementError(f"Pick Place table lacks column(s): {', '.join(missing)}")
    counts: Counter[tuple[str, str]] = Counter()
    seen: Counter[str] = Counter()
    for row in table.rows:
        side = layer_sides.get(row["Layer"].lower())
        if side is None:
            raise PlacementError(f"Pick Place layer {row['Layer']!r} is not in the placement layer table")
        counts[(side, row["Footprint"])] += 1
        seen[row["Designator"]] += 1
    groups = [PlacementGroup(side, footprint, n) for (side, footprint), n in sorted(counts.items())]
    return groups, sorted(d for d, n in seen.items() if n > 1)
