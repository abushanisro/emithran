"""
Canonical manufacturing feature vocabulary.

Loaded from reference_features.json, which scripts/build_reference_features.py
generates from the reference operation catalogs (memory/sheetmetal/process/
process_operations.csv, memory/machining/operations_full__operations.csv).
Every feature_type the CAD engine emits must be one of these names -- this
module is the single gate that enforces it, so a typo or an invented type
fails loudly at extraction time instead of silently reaching costing.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, FrozenSet, Literal

Domain = Literal["sheet_metal", "machining", "die_casting", "sand_casting", "investment_casting"]

_VOCAB_PATH = Path(__file__).with_name("reference_features.json")


@lru_cache(maxsize=1)
def _load() -> Dict:
    return json.loads(_VOCAB_PATH.read_text(encoding="utf-8"))


def feature_types(domain: Domain) -> FrozenSet[str]:
    return frozenset(_load()["domains"][domain]["feature_types"])


def operations_for(domain: Domain, feature_type: str) -> FrozenSet[str]:
    entry = _load()["domains"][domain]["feature_types"].get(feature_type)
    return frozenset(entry["operations"]) if entry else frozenset()


def require_feature_type(domain: Domain, feature_type: str) -> str:
    """Return feature_type unchanged if it is a real reference type for domain,
    else raise ValueError. Call at every point a feature is constructed."""
    if feature_type not in feature_types(domain):
        raise ValueError(
            f"{feature_type!r} is not a reference {domain} feature type "
            f"(see shared/reference_features.json; regenerate with "
            f"scripts/build_reference_features.py if the catalog changed)"
        )
    return feature_type
