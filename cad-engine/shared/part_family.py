"""
Part-family vocabulary -- the single set of family names the whole platform
uses (CAD engine, backend costing/routing, database, frontend).

These are the stored `bom_items.family_classification` values (backend
migrations 735 and 789 renamed the platform to them: injection_molded ->
plastic_molded, cnc_milled -> milled, cnc_turned -> turned). The CAD engine
emits exactly these strings, so no consumer ever translates a family name.
"""

from typing import FrozenSet

SHEET_METAL = "sheet_metal"
MILLED = "milled"
TURNED = "turned"
MILL_TURN = "mill_turn"
PLASTIC_MOLDED = "plastic_molded"

ALL_FAMILIES: FrozenSet[str] = frozenset({SHEET_METAL, MILLED, TURNED, MILL_TURN, PLASTIC_MOLDED})

# Families produced by machining; the machining feature recognizer runs for these.
MACHINING_FAMILIES: FrozenSet[str] = frozenset({MILLED, TURNED, MILL_TURN})

# Machining families recognized around a rotation axis (lathe-based).
TURNED_FAMILIES: FrozenSet[str] = frozenset({TURNED, MILL_TURN})
