"""
Dimensions, datums and label-only callouts, read from the STEP's Part 21 text.

The entity model in step_pmi.py reaches geometric tolerances. It does not reach
dimensions: pythonocc 7.7.2 wraps DIMENSIONAL_SIZE but exposes no value on the
complex measure item (REPR_ITEM_AND_LENGTH_MEASURE_WITH_UNIT_AND_QRI) that holds
the nominal. So the nominal, its +/- bounds and the callout they belong to are
read from the Part 21 statements themselves. Everything returned is written in
the file; nothing is inferred from geometry.

What a STEP can hold, and what is reported for each:
  semantic dimension   DIMENSIONAL_SIZE + PLUS_MINUS_TOLERANCE: nominal, lower and upper bound, mm.
                       A DIMENSIONAL_SIZE noted 'theoretical' is a basic dimension (no tolerance).
  datum                in files from CAD tools that write no DATUM entity, only as the label of a
                       presentation callout ('Datum443@Plane10(A)'): the letter and the CAD feature
                       it names are read from that label.
  label-only callout   a callout whose value exists only in its label ('Width2@Width1(15)'):
                       reported as presentation-only, with no tolerance, because none is stored.
None of these is tied to a model face when the file's shape aspects carry no items; that is
shown by the absence of face ids, never guessed.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

_REF = re.compile(r"#(\d+)")
_NAME = re.compile(r"'([^']*)'")
_LENGTH = re.compile(r"(?:POSITIVE_)?LENGTH_MEASURE\(\s*(-?[\d.]+(?:[eE][+-]?\d+)?)\s*\)")
_LABEL_VALUE = re.compile(r"^([A-Za-z]+)\d+@.+?\((-?[\d.]+)\)(?:-\d+)?$")
_DATUM_LABEL = re.compile(r"^Datum\d+@(.+)\(([A-Z])\)$")
_MM_PER_SI_PREFIX = {".MILLI.": 1.0, ".CENTI.": 10.0, ".KILO.": 1e6, ".MICRO.": 1e-3}


def _statements(step_text: str) -> Dict[int, str]:
    start = step_text.find("DATA;")
    body = step_text[start + 5:] if start >= 0 else step_text
    out: Dict[int, str] = {}
    for raw in body.split(";"):
        m = re.match(r"^\s*#(\d+)\s*=\s*(.*)$", raw, re.S)
        if m:
            out[int(m.group(1))] = re.sub(r"\s+", " ", m.group(2)).strip()
    return out


def _unit_mm(entities: Dict[int, str], unit_id: int) -> Optional[float]:
    text = entities.get(unit_id, "")
    if "SI_UNIT" in text and "METRE" in text:
        prefix = re.search(r"SI_UNIT\(\s*(\.[A-Z]+\.|\$)\s*,", text)
        key = prefix.group(1) if prefix else "$"
        return 1000.0 if key == "$" else _MM_PER_SI_PREFIX.get(key)
    if "CONVERSION_BASED_UNIT" in text and "INCH" in text.upper():
        return 25.4
    return None


def _length_mm(entities: Dict[int, str], statement_id: int) -> Optional[float]:
    """A *_LENGTH_MEASURE(value) entity in mm; None when its unit is not a resolvable length unit."""
    text = entities.get(statement_id, "")
    value = _LENGTH.search(text)
    unit_ref = _REF.search(text[value.end():]) if value else None
    if not value or not unit_ref:
        return None
    per_unit = _unit_mm(entities, int(unit_ref.group(1)))
    return float(value.group(1)) * per_unit if per_unit is not None else None


def _callout_of_semantic_item(E: Dict[int, str]) -> Dict[int, str]:
    """DIMENSIONAL_SIZE / tolerance entity id -> the name of the callout that presents it."""
    callouts = {i: (_NAME.search(e) or [None, ""])[1] for i, e in E.items() if e.startswith("DRAUGHTING_CALLOUT")}
    out: Dict[int, str] = {}
    for e in E.values():
        if not e.startswith("DRAUGHTING_MODEL_ITEM_ASSOCIATION"):
            continue
        refs = [int(x) for x in _REF.findall(e)]
        for r in refs[1:]:
            if r in callouts:
                out[refs[0]] = callouts[r]
                break
    return out


def read_step_dimensions(step_text: str) -> Dict[str, Any]:
    """{"dimensions", "datums", "presentation_only", "unresolved"} from Part 21 text."""
    E = _statements(step_text)
    callout_of = _callout_of_semantic_item(E)
    unresolved: List[str] = []

    bounds: Dict[int, tuple] = {}  # DIMENSIONAL_SIZE id -> (lower, upper)
    for i, e in E.items():
        if not e.startswith("PLUS_MINUS_TOLERANCE"):
            continue
        refs = [int(x) for x in _REF.findall(e)]
        value_refs = [int(x) for x in _REF.findall(E.get(refs[0], ""))] if len(refs) >= 2 else []
        lo = _length_mm(E, value_refs[0]) if len(value_refs) >= 2 else None
        hi = _length_mm(E, value_refs[1]) if len(value_refs) >= 2 else None
        if lo is None or hi is None:
            unresolved.append(f"#{i} PLUS_MINUS_TOLERANCE: bounds are not a resolvable length")
            continue
        bounds[refs[1]] = (round(lo, 6), round(hi, 6))

    representation_of: Dict[int, List[int]] = {}  # DIMENSIONAL_SIZE id -> representation ids
    for e in E.values():
        if e.startswith("DIMENSIONAL_CHARACTERISTIC_REPRESENTATION"):
            refs = [int(x) for x in _REF.findall(e)]
            if len(refs) >= 2:
                representation_of[refs[0]] = refs[1:]

    dimensions: List[Dict[str, Any]] = []
    for i, e in E.items():
        if not e.startswith("DIMENSIONAL_SIZE"):
            continue
        kind = ((_NAME.search(e) or [None, ""])[1]).strip().lower() or "size"
        nominal: Optional[float] = None
        basic = False
        for rep in representation_of.get(i, []):
            for item in (int(x) for x in _REF.findall(E.get(rep, ""))):
                text = E.get(item, "")
                if nominal is None and "LENGTH_MEASURE" in text:
                    nominal = _length_mm(E, item)
                if "DESCRIPTIVE_REPRESENTATION_ITEM" in text and "theoretical" in text:
                    basic = True
        if nominal is None:
            unresolved.append(f"#{i} DIMENSIONAL_SIZE '{kind}': nominal is not a resolvable length")
            continue
        lower, upper = bounds.get(i, (None, None))
        dimensions.append({
            "callout": callout_of.get(i), "kind": kind, "nominal_mm": round(nominal, 6),
            "lower_mm": lower, "upper_mm": upper, "basic": basic,
        })

    datums: List[Dict[str, Any]] = []
    presentation_only: List[Dict[str, Any]] = []
    semantic_callouts = set(callout_of.values())
    for e in E.values():
        if not e.startswith("DRAUGHTING_CALLOUT"):
            continue
        name = (_NAME.search(e) or [None, ""])[1]
        d = _DATUM_LABEL.match(name)
        if d:
            datums.append({"letter": d.group(2), "feature": d.group(1), "callout": name})
            continue
        v = _LABEL_VALUE.match(name)
        if v and name not in semantic_callouts:
            presentation_only.append({"callout": name, "kind": v.group(1).lower(), "nominal_mm": float(v.group(2))})
    return {"dimensions": dimensions, "datums": datums, "presentation_only": presentation_only, "unresolved": unresolved}
