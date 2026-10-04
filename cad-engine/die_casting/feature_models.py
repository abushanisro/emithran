"""
Die-casting feature vocabulary.

Every die-casting feature_graph_v2 entry's feature_type is a canonical
reference feature type -- the exact "//Feature" vocabulary of the die-casting
operation catalog (memory/Die Casting/Processes/operations.csv, generated into
shared/reference_features.json by scripts/build_reference_features.py, under
the "die_casting" domain key). The distinction a consumer needs that is a
geometric fact about the feature (a through vs. a blind hole) is carried in a
closed per-type `variant`; the operation (Unscrewing, Insert Coring, Slides,
...) is chosen downstream, never baked in here.
"""
from __future__ import annotations

from typing import Any, Dict, FrozenSet, Mapping

from shared.feature_vocabulary import Domain, require_feature_type

VARIANTS: Mapping[str, FrozenSet[str]] = {
    # through: envelope broken on both ends. blind: a genuine distinct floor face.
    "SimpleHole": frozenset({"through", "blind"}),
    # A coaxial bore with >=3 strictly-monotonic-diameter steps, each step
    # boundary a real distinct planar annulus face.
    "MultiStepHole": frozenset({"stepped"}),
    "Ring": frozenset({"default"}),
    "RingedHole": frozenset({"default"}),
    # A connected undercut-candidate component with BOTH straight-pull-reachable
    # and ray-blocked faces -- a cavity combining a straight pocket and a slide.
    "ComboVoid": frozenset({"default"}),
    # A connected undercut-candidate component where every face is ray-blocked
    # along every candidate pull axis -- a pure side-action cavity.
    "Void": frozenset({"default"}),
    # A group of Void/ComboVoid occurrences sharing one real common blocked-ray
    # retraction direction -- the one physical slide/core that could service them.
    "SlideBundle": frozenset({"default"}),
    "PlanarFace": frozenset({"default"}),
    "CurvedWall": frozenset({"default"}),
    "CurvedSurface": frozenset({"default"}),
    "Edge": frozenset({"default"}),
    "SharpEdge": frozenset({"default"}),
    # Every face no detector claimed -- a disclosed gap, never silently dropped.
    "NotSupported": frozenset({"default"}),
}

for _t in VARIANTS:
    require_feature_type("die_casting", _t)


def die_casting_feature(
    feature_id: str, feature_type: str, variant: str, domain: Domain = "die_casting", **fields: Any,
) -> Dict[str, Any]:
    """Build one feature_graph_v2 entry, validating type (against the active
    casting process's own catalog) and variant."""
    require_feature_type(domain, feature_type)
    allowed = VARIANTS.get(feature_type)
    if allowed is None or variant not in allowed:
        raise ValueError(
            f"variant {variant!r} is not valid for die-casting {feature_type} "
            f"(allowed: {sorted(allowed or [])})"
        )
    return {"id": feature_id, "feature_type": feature_type, "variant": variant, **fields}
