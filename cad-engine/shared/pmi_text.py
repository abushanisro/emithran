"""
Typed values from the text of a decoded PMI callout.

Only formats this parser fully understands are accepted; anything else (a '?' glyph, a symbol it does
not know, stacked limits, fits such as H7, angles) is returned as unsupported with the reason, never
partly read. The text carries no unit: it is in the file's length unit, which the graphics reader has
already required to be millimetres.

  dimension   [N x] [R|Ø|M] nominal [± tolerance]       e.g.  "R45.75 ±0.15", "4 x 5.50±0.15", "15.00 ±0.25"
  frame       zone [datum refs]                          e.g.  "0.15 A-B-C", ".05 A-B-C", "0.25 A", "0.015"
  datum       arrow + letter                             e.g.  "▼A"
Decimal point or decimal comma are both read (a comma only if the decoder produced one).
"""
from __future__ import annotations

import re
from typing import Any, Dict, Optional

_NUMBER = r"(?:\d+(?:[.,]\d+)?|[.,]\d+)"
_DIMENSION = re.compile(rf"^(?:(?P<count>\d+)\s*x\s*)?(?P<prefix>[RØM]?)\s*(?P<nominal>{_NUMBER})\s*(?:±\s*(?P<tol>{_NUMBER}))?$")
_FRAME = re.compile(rf"^(?P<zone>{_NUMBER})\s*(?P<datums>[A-Z](?:-[A-Z])*)?$")
_DATUM = re.compile(r"^(?:▼|▲)\s*(?P<letter>[A-Z])$|^(?P<letter2>[A-Z])\s*(?:▼|▲)$")


def _number(text: str) -> float:
    return float(text.replace(",", "."))


def _decimals(text: str) -> int:
    text = text.replace(",", ".")
    return len(text.split(".")[1]) if "." in text else 0


def parse_dimension_text(text: str) -> Dict[str, Any]:
    """{'ok': True, 'count', 'prefix', 'nominal', 'tolerance', 'decimals'} or {'ok': False, 'reason'}."""
    if "?" in text:
        return {"ok": False, "reason": "contains a glyph that was not recognised"}
    m = _DIMENSION.match(text.strip())
    if not m:
        return {"ok": False, "reason": f"not a format this reader supports: {text!r}"}
    return {
        "ok": True,
        "count": int(m.group("count")) if m.group("count") else 1,
        "prefix": m.group("prefix") or None,
        "nominal": _number(m.group("nominal")),
        "nominal_decimals": _decimals(m.group("nominal")),
        "tolerance": _number(m.group("tol")) if m.group("tol") else None,
    }


def parse_frame_text(text: str) -> Dict[str, Any]:
    """{'ok': True, 'zone', 'datum_refs': ['A','B','C']} or {'ok': False, 'reason'}."""
    if "?" in text:
        return {"ok": False, "reason": "contains a glyph that was not recognised"}
    m = _FRAME.match(text.strip())
    if not m:
        return {"ok": False, "reason": f"not a frame format this reader supports: {text!r}"}
    return {"ok": True, "zone": _number(m.group("zone")), "datum_refs": m.group("datums").split("-") if m.group("datums") else []}


def parse_datum_text(text: str) -> Optional[str]:
    """The datum letter of an arrow-and-letter datum symbol (either glyph order), or None."""
    if "?" in text:
        return None
    cleaned = text.strip()
    letters = [c for c in cleaned if c.isalpha()]
    arrows = [c for c in cleaned if c in "▼▲"]
    return letters[0] if len(letters) == 1 and len(arrows) == 1 and len(cleaned.replace(" ", "")) == 2 else None
