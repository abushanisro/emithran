"""The staged rules the side-action recognition reads (shared/plastic_recognition_rules.json, generated from the reference variables by scripts/build_plastic_recognition_rules.py)."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Dict

_PATH = Path(__file__).resolve().parents[2] / "shared" / "plastic_recognition_rules.json"


@lru_cache(maxsize=1)
def staged_rules() -> Dict[str, float]:
    """name -> value. A missing file or key is an error, never a silent default: the engine has no values of its own."""
    data = json.loads(_PATH.read_text(encoding="utf-8"))
    return {k: float(v["value"]) for k, v in data["rules"].items()}
