"""
Field-level comparison of two assembly reports (the Python engine's and the C++ worker's), and of the BOM lines built from them.
Pure: dicts in, findings out; no Docker, no files. Every difference becomes one finding with a category, so a missing field is never
mistaken for a rounding difference, and a geometry difference is never mistaken for a processing failure:

  missing_field  a key present on one side only
  structure      different tree, ids, names, kinds, files, or numbers of parts / nodes / inputs
  quantity       a part's quantity differs
  geometry       volume, surface area or a bounding box differs by more than the tolerance
  processing     status, an input's status, a problem code, or a process that failed or crashed
  export         an exported STEP file that cannot be reopened, or whose measurements differ from the report's
  archive        the unzipped files differ
  bom            the created BOM lines differ

Tolerance: relative 1e-3 (0.1%) with an absolute floor of 1e-3, the same as geometry-worker/tests/parity.py.
"""
from __future__ import annotations

import re
from typing import Any

REL_TOL = 1e-3
ABS_TOL = 1e-3

GEOMETRY = re.compile(r"(volume_mm3|surface_area_mm2|bounding_box\.|volume$|surfaceArea$|max(Length|Width|Height)$)")
QUANTITY = re.compile(r"(quantity_total|\.quantity|quantity$)")
PROCESSING = re.compile(r"(^|\.)(status|inside|problems)(\[|\.|$)|\.code$")


def close(a: float, b: float) -> bool:
    return abs(a - b) <= max(ABS_TOL, REL_TOL * abs(a))


def finding(category: str, path: str, python: Any = None, cpp: Any = None, detail: str = "") -> dict:
    return {"category": category, "path": path, "python": python, "cpp": cpp, "detail": detail}


def categorize(path: str) -> str:
    if GEOMETRY.search(path):
        return "geometry"
    if QUANTITY.search(path):
        return "quantity"
    if PROCESSING.search(path):
        return "processing"
    return "structure"


class Stats:
    """The largest relative difference seen per measurement, also among values that agree: how close 'passing' really is."""

    def __init__(self) -> None:
        self.max_rel: dict[str, float] = {}
        self.compared = 0

    def note(self, path: str, a: float, b: float) -> None:
        key = re.sub(r"\[[^\]]*\]", "[*]", path)
        rel = abs(a - b) / abs(a) if a else abs(b)
        self.max_rel[key] = max(self.max_rel.get(key, 0.0), rel)
        self.compared += 1


def _walk(py: Any, cpp: Any, path: str, out: list, stats: Stats, category: str | None) -> None:
    if isinstance(py, dict) and isinstance(cpp, dict):
        for key in sorted(set(py) | set(cpp)):
            sub = f"{path}.{key}" if path else key
            if key not in py or key not in cpp:
                out.append(finding("missing_field", sub, py.get(key, "<absent>"), cpp.get(key, "<absent>"), f"only in {'python' if key in py else 'c++'}"))
            else:
                _walk(py[key], cpp[key], sub, out, stats, category)
    elif isinstance(py, list) and isinstance(cpp, list):
        if len(py) != len(cpp):
            out.append(finding(category or categorize(path), f"{path}[]", len(py), len(cpp), "different number of items"))
        for i, (a, b) in enumerate(zip(py, cpp)):
            _walk(a, b, f"{path}[{i}]", out, stats, category)
    elif isinstance(py, (int, float)) and isinstance(cpp, (int, float)) and not isinstance(py, bool) and not isinstance(cpp, bool):
        stats.note(path, py, cpp)
        if not close(py, cpp):
            out.append(finding(category or categorize(path), path, py, cpp, f"relative difference {abs(py - cpp) / abs(py) if py else abs(cpp):.3g}"))
    elif py is None or cpp is None:
        if py is not cpp:
            out.append(finding(category or categorize(path), path, py, cpp, "one side has no value"))
    elif py != cpp:
        out.append(finding(category or categorize(path), path, py, cpp))


def _by(items: list, key: str) -> dict:
    return {i[key]: i for i in items}


def compare_reports(py: dict, cpp: dict, stats: Stats | None = None) -> list[dict]:
    """Two assembly reports (contract/assembly.schema.json). Parts are matched by id and inputs by file, not by position."""
    stats = stats or Stats()
    out: list[dict] = []
    flat_py = {k: v for k, v in py.items() if k not in ("parts", "inputs", "assembly", "problems")}
    flat_cpp = {k: v for k, v in cpp.items() if k not in ("parts", "inputs", "assembly", "problems")}
    _walk(flat_py, flat_cpp, "", out, stats, None)
    for name, key in (("parts", "id"), ("inputs", "file")):
        a, b = _by(py.get(name, []), key), _by(cpp.get(name, []), key)
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out.append(finding("structure", f"{name}[{k}]", "present" if k in a else "<absent>", "present" if k in b else "<absent>", f"{name[:-1]} only in {'python' if k in a else 'c++'}"))
            else:
                _walk(a[k], b[k], f"{name}[{k}]", out, stats, None)
    _walk(sorted(py.get("problems", []), key=repr), sorted(cpp.get("problems", []), key=repr), "problems", out, stats, "processing")
    _walk(py.get("assembly", []), cpp.get("assembly", []), "assembly", out, stats, None)
    return out


def compare_bom(py_items: list[dict], cpp_items: list[dict], stats: Stats | None = None) -> list[dict]:
    """BOM lines in creation order. A parent is compared by the position of its line (ids are the fakes' own)."""
    stats = stats or Stats()

    def norm(items: list[dict]) -> list[dict]:
        index = {i["id"]: n for n, i in enumerate(items)}
        return [{**{k: v for k, v in i.items() if k != "id"}, "parentItemId": index.get(i.get("parentItemId"))} for i in items]

    out: list[dict] = []
    _walk(norm(py_items), norm(cpp_items), "bom", out, stats, None)
    return [{**f, "category": "bom" if f["category"] != "missing_field" else f["category"]} for f in out]


def compare_values(py: Any, cpp: Any, path: str, category: str, stats: Stats | None = None) -> list[dict]:
    """Any two JSON values, every difference filed under `category` (used for exported files and the unzipped files)."""
    out: list[dict] = []
    _walk(py, cpp, path, out, stats or Stats(), category)
    return out
