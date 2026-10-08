"""
Part-family vocabulary -- the single set of family names the whole platform
uses (CAD engine, backend costing/routing, database, frontend).

These are the stored `bom_items.family_classification` values (backend
migrations 735 and 789 renamed the platform to them: injection_molded ->
plastic_molded, cnc_milled -> milled, cnc_turned -> turned). The CAD engine
emits exactly these strings, so no consumer ever translates a family name.
"""

from typing import Dict, FrozenSet

SHEET_METAL = "sheet_metal"
MILLED = "milled"
TURNED = "turned"
MILL_TURN = "mill_turn"
PLASTIC_MOLDED = "plastic_molded"
# Die Casting Phase 1 (2026-10): detection + highlighting only. No automatic
# geometric classifier exists for this family yet (building one is itself a
# routing-adjacent inference, deliberately deferred) -- reached only via the
# explicit, disclosed family_hint override in main.py's analyze_geometry_advanced.
DIE_CAST = "die_cast"
# Sand and investment casting: the same casting feature extractor, validated
# against each process's own reference catalog. Like die_cast, reached only
# through the explicit family_hint (the user's chosen process).
SAND_CAST = "sand_cast"
INVESTMENT_CAST = "investment_cast"

ALL_FAMILIES: FrozenSet[str] = frozenset({
    SHEET_METAL, MILLED, TURNED, MILL_TURN, PLASTIC_MOLDED, DIE_CAST, SAND_CAST, INVESTMENT_CAST,
})

# Casting families -> the reference-catalog domain their features validate
# against (shared/reference_features.json). One map, read by the dispatcher.
CASTING_FAMILY_DOMAIN: Dict[str, str] = {
    DIE_CAST: "die_casting",
    SAND_CAST: "sand_casting",
    INVESTMENT_CAST: "investment_casting",
}

# Families produced by machining; the machining feature recognizer runs for these.
MACHINING_FAMILIES: FrozenSet[str] = frozenset({MILLED, TURNED, MILL_TURN})

# Machining families recognized around a rotation axis (lathe-based).
TURNED_FAMILIES: FrozenSet[str] = frozenset({TURNED, MILL_TURN})
