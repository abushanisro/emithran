"""
Sheet-metal feature vocabulary.

Every sheet-metal feature_graph_v2 entry's feature_type is a canonical
reference feature type -- the exact "//Feature" vocabulary of the sheet-metal
operation catalog (memory/sheetmetal/process/process_operations.csv, generated
into shared/reference_features.json by scripts/build_reference_features.py).
The distinction a consumer needs that is a geometric fact about the feature
(a flanged vs. a plain hole, a rolled vs. an embossed form) is carried in a
closed per-type `variant`; the operation (Laser Cutting, Punching, Bending,
Extruding, ...) is chosen downstream, never baked in here.
"""
from __future__ import annotations

from typing import Any, Dict, FrozenSet, Mapping

from shared.feature_vocabulary import require_feature_type

VARIANTS: Mapping[str, FrozenSet[str]] = {
    # through: a plain round through-hole. extruded: a hole with a formed
    # collar ("Extruding//SimpleHole", hole-flanging). perforated: a hole that
    # belongs to a detected repeated-pattern region ("Perforating").
    # countersunk: a cone coaxial with the hole at its mouth
    # ("Countersinking//SimpleHole"); the hole itself stays a through entry.
    "SimpleHole": frozenset({"through", "extruded", "perforated", "countersunk"}),
    # slot: an elongated non-circular internal cut-out.
    "ComplexHole": frozenset({"slot"}),
    "StraightBend": frozenset({"default"}),
    # rolled: one continuous curvature sweeping past what a press brake can
    # wrap in one hit ("3 Roll Bending//Form"). emboss: a formed dimple/emboss
    # worked from both faces ("Embossing//Form").
    # drawn: a shell drawn over a punch (deep draw / fluid cell hydroforming,
    # "Deep Draw Forming//Form"), recognised by double-curved faces with an
    # offset twin one thickness away (sheet_metal/features/drawn_shell.py).
    "Form": frozenset({"rolled", "emboss", "drawn"}),
    "Lance": frozenset({"default"}),
    # The cut boundary of the blank: outer perimeter plus every internal
    # cut-out wall ("Laser Cutting//Blank").
    "Blank": frozenset({"default"}),
}

for _t in VARIANTS:
    require_feature_type("sheet_metal", _t)


def sheet_metal_feature(feature_id: str, feature_type: str, variant: str, **fields: Any) -> Dict[str, Any]:
    """Build one feature_graph_v2 entry, validating type and variant."""
    require_feature_type("sheet_metal", feature_type)
    allowed = VARIANTS.get(feature_type)
    if allowed is None or variant not in allowed:
        raise ValueError(
            f"variant {variant!r} is not valid for sheet-metal {feature_type} "
            f"(allowed: {sorted(allowed or [])})"
        )
    return {"id": feature_id, "feature_type": feature_type, "variant": variant, **fields}
