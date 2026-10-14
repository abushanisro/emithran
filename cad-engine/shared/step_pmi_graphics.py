"""
The PMI graphics a STEP carries: what the CAD tool drew for each callout, read as geometry.

AP242 files from CAD tools such as SolidWorks MBD store every callout's presentation as
TESSELLATED_ANNOTATION_OCCURRENCE: polylines (leaders, arrowheads, frames) and filled glyph
triangles (the text: "15.00 +/-0.25", datum letters, frame symbols). That text is drawn geometry, not
a string, and values that exist ONLY there (a tolerance on a Width callout, the datum references of a
position frame) have no semantic entity at all. Drawing the graphics as authored shows exactly what the
CAD shows, with nothing read, guessed or typed by us.

Coordinates are those of the STEP model; the caller supplies the model's bounding-box centre so the
viewer can draw them in the same frame as the mesh. Only files whose length units are all millimetres
are read (the mesh is in mm); anything else is reported in `unresolved`, not scaled by guess.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from shared.step_pmi_dimensions import _REF, _statements

MAX_POINTS = 400_000  # a PMI set larger than this is reported, not shipped

_NAME = re.compile(r"'([^']*)'")
_POINT = re.compile(r"\(\s*(-?[\d.]+(?:[eE][+-]?\d+)?)\s*,\s*(-?[\d.]+(?:[eE][+-]?\d+)?)\s*,\s*(-?[\d.]+(?:[eE][+-]?\d+)?)\s*\)")
_INDEX_LIST = re.compile(r"\(\s*(\d+(?:\s*,\s*\d+)*)\s*\)")


def _split_args(call: str) -> List[str]:
    """The top-level arguments of 'NAME(a,b,(c,d),...)' (parentheses and quotes respected)."""
    start = call.index("(")
    body = call[start + 1: call.rindex(")")]
    args, depth, buf, quoted = [], 0, [], False
    for ch in body:
        if ch == "'":
            quoted = not quoted
        if not quoted:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            elif ch == "," and depth == 0:
                args.append("".join(buf).strip())
                buf = []
                continue
        buf.append(ch)
    args.append("".join(buf).strip())
    return args


def _indices(arg: str) -> List[List[int]]:
    return [[int(v) for v in m.group(1).split(",")] for m in _INDEX_LIST.finditer(arg)]


def _points(statement: str) -> List[List[float]]:
    body = statement[statement.index("((") + 1:]
    return [[float(m.group(1)), float(m.group(2)), float(m.group(3))] for m in _POINT.finditer(body)]


def _all_lengths_are_mm(E: Dict[int, str]) -> bool:
    units = [e for e in E.values() if "LENGTH_UNIT()" in e]
    return bool(units) and all(".MILLI." in e and ".METRE." in e for e in units)


def _triangles(statement: str, points: List[List[float]]) -> List[float]:
    """Flat x,y,z triples, 3 per triangle, from a (COMPLEX_)TRIANGULATED_SURFACE_SET."""
    args = _split_args(statement)
    out: List[float] = []

    def tri(a: int, b: int, c: int) -> None:
        for i in (a, b, c):
            out.extend(points[i - 1])

    if statement.startswith("COMPLEX_TRIANGULATED_SURFACE_SET"):
        strips, fans = (_indices(args[5]) if len(args) > 5 else []), (_indices(args[6]) if len(args) > 6 else [])
        for s in strips:
            for k in range(len(s) - 2):
                a, b, c = (s[k], s[k + 1], s[k + 2]) if k % 2 == 0 else (s[k + 1], s[k], s[k + 2])
                tri(a, b, c)
        for f in fans:
            for k in range(1, len(f) - 1):
                tri(f[0], f[k], f[k + 1])
    else:  # TRIANGULATED_SURFACE_SET(name, coords, pnmax, normals, pn_index, triangles)
        for t in (_indices(args[5]) if len(args) > 5 else []):
            if len(t) == 3:
                tri(*t)
    return out


def read_step_pmi_graphics(step_text: str) -> Dict[str, Any]:
    """{"graphics": [{"callout", "curves": [[[x,y,z],...]], "triangles": [x,y,z,...]}], "unresolved": [...]}"""
    E = _statements(step_text)
    occurrences = {i: e for i, e in E.items() if e.startswith("TESSELLATED_ANNOTATION_OCCURRENCE")}
    if not occurrences:
        return {"graphics": [], "unresolved": []}
    if not _all_lengths_are_mm(E):
        return {"graphics": [], "unresolved": ["PMI graphics: the file's length unit is not millimetres, so they are not drawn"]}

    graphics: List[Dict[str, Any]] = []
    unresolved: List[str] = []
    total = 0
    for i, e in occurrences.items():
        name = (_NAME.search(e) or [None, ""])[1]
        refs = [int(x) for x in _REF.findall(e)]
        target = E.get(refs[-1], "") if refs else ""
        if not target.startswith("TESSELLATED_GEOMETRIC_SET"):
            unresolved.append(f"#{i} {name}: no tessellated geometry set")
            continue
        curves: List[List[List[float]]] = []
        triangles: List[float] = []
        for item_id in (int(x) for x in _REF.findall(target)):
            item = E.get(item_id, "")
            coord_ref = next((int(x) for x in _REF.findall(item) if E.get(int(x), "").startswith("COORDINATES_LIST")), None)
            if coord_ref is None:
                continue
            pts = _points(E[coord_ref])
            total += len(pts)
            if total > MAX_POINTS:
                return {"graphics": [], "unresolved": [f"PMI graphics: more than {MAX_POINTS} points, not shipped"]}
            try:
                if item.startswith("TESSELLATED_CURVE_SET"):
                    for line in _indices(_split_args(item)[2]):
                        curves.append([pts[k - 1] for k in line])
                elif "TRIANGULATED_SURFACE_SET" in item.split("(")[0]:
                    triangles.extend(_triangles(item, pts))
            except (IndexError, ValueError) as exc:
                unresolved.append(f"#{item_id} {name}: {exc}")
        if curves or triangles:
            graphics.append({
                "callout": name,
                "curves": [[[round(v, 3) for v in p] for p in c] for c in curves],
                "triangles": [round(v, 3) for v in triangles],
            })
    return {"graphics": graphics, "unresolved": unresolved}
