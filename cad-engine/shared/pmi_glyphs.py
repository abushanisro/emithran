"""
Deterministic decoding of the text a CAD tool drew as filled glyph triangles (PMI graphics).

How it works, and what it will not do:
  * The CAD writes each character as its own filled set (shared/step_pmi_graphics.py keeps the
    per-set triangle counts), so no segmentation is guessed.
  * A callout lies in one plane; its reading direction is not stored, so the four right-angle
    rotations on each side of the plane are tried and the one that matches best is kept.
  * Each glyph becomes a descriptor (a 24 x 24 coverage bitmap of its own bounding box, its aspect
    ratio, and its size and baseline position relative to the callout's tallest glyph) and is
    compared with TEMPLATES built from text a person verified (scripts/build_pmi_glyph_templates.py).
  * A glyph is only accepted when it matches one character clearly (high overlap AND a clear margin
    over the next different character). Otherwise the character is '?', the callout is unresolved
    and the original graphics stay the only source. There is no best-guess output.
Pure Python; no rendering library.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, Tuple

GRID = 24
MIN_IOU = 0.80            # a glyph below this overlap with its best template is not accepted
MIN_MARGIN = 0.04         # ...and must beat the best DIFFERENT character by this much
ASPECT_TOL = 0.25         # relative difference in width/height
SIZE_TOL = 0.15           # difference in height / tallest glyph of the callout
BASELINE_TOL = 0.15       # difference in vertical centre / tallest glyph, from the callout's lowest point
SPACE_GAP = 0.45          # a gap wider than this x tallest-glyph height is a space
ISOLATED = 3.0            # a glyph whose nearest neighbour is further than this x the tallest glyph (and 4x the usual spacing) is not text

Vec = Tuple[float, float, float]


def _sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _unit(a: Vec) -> Vec:
    n = math.sqrt(_dot(a, a)) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def split_glyphs(triangles: Sequence[float], counts: Sequence[int]) -> List[List[Vec]]:
    """The callout's triangle numbers cut into one list of triangle vertices (3 per triangle) per character."""
    out: List[List[Vec]] = []
    pos = 0
    for n in counts:
        verts: List[Vec] = []
        for k in range(n * 3):
            i = (pos + k) * 3
            verts.append((triangles[i], triangles[i + 1], triangles[i + 2]))
        out.append(verts)
        pos += n * 3
    return out


def plane_normal(glyphs: Sequence[Sequence[Vec]]) -> Optional[Vec]:
    """The callout's plane normal from its largest-area triangle; None when the glyphs are degenerate."""
    best, best_area = None, 0.0
    for verts in glyphs:
        for k in range(0, len(verts) - 2, 3):
            c = _cross(_sub(verts[k + 1], verts[k]), _sub(verts[k + 2], verts[k]))
            area = math.sqrt(_dot(c, c))
            if area > best_area:
                best, best_area = c, area
    return _unit(best) if best is not None and best_area > 1e-12 else None


def _basis(normal: Vec) -> Tuple[Vec, Vec]:
    ref = (1.0, 0.0, 0.0) if abs(normal[0]) < 0.9 else (0.0, 1.0, 0.0)
    e1 = _unit(_cross(normal, ref))
    return e1, _cross(normal, e1)


def _glyph_angle(glyph: Sequence[Vec], e1: Vec, e2: Vec) -> Tuple[float, float]:
    """(angle in radians within [0, pi/2), box area) of the glyph's smallest enclosing rectangle in the plane."""
    xs = [_dot(p, e1) for p in glyph]
    ys = [_dot(p, e2) for p in glyph]
    best_angle, best_area = 0.0, float("inf")
    for deg in range(0, 90):
        a = math.radians(deg)
        c, s = math.cos(a), math.sin(a)
        rx = [x * c + y * s for x, y in zip(xs, ys)]
        ry = [-x * s + y * c for x, y in zip(xs, ys)]
        area = (max(rx) - min(rx)) * (max(ry) - min(ry))
        if area < best_area - 1e-12:
            best_angle, best_area = a, area
    return best_angle, best_area


def _refine_angle(glyphs: Sequence[Sequence[Vec]], e1: Vec, e2: Vec, angle: float) -> float:
    """
    A rectangle's angle is only good to about a degree, and a degree drifts a long callout off its baseline.
    The tall glyphs (digits, capitals) of one line share a baseline: their centres lie on a line. Turn the
    reading direction onto the principal direction of those centres, by a SMALL correction only (reduced to
    +/-45 degrees, so the quarter-turn ambiguity stays with the explicit turns and a vertical line is not
    flipped into a horizontal one). Needs three tall glyphs on a clearly elongated line; otherwise the
    rectangle angle stands.
    """
    for _ in range(3):
        c, s = math.cos(angle), math.sin(angle)
        u = tuple(c * e1[k] + s * e2[k] for k in range(3))
        v = tuple(-s * e1[k] + c * e2[k] for k in range(3))
        boxes = []
        for verts in glyphs:
            us = [_dot(p, u) for p in verts]
            vs = [_dot(p, v) for p in verts]
            boxes.append(((min(us) + max(us)) / 2, (min(vs) + max(vs)) / 2, max(max(us) - min(us), max(vs) - min(vs))))
        tallest = max(b[2] for b in boxes)
        tall = [b for b in boxes if b[2] >= 0.85 * tallest]
        if len(tall) < 3:
            return angle
        mu = sum(b[0] for b in tall) / len(tall)
        mv = sum(b[1] for b in tall) / len(tall)
        suu = sum((b[0] - mu) ** 2 for b in tall)
        svv = sum((b[1] - mv) ** 2 for b in tall)
        suv = sum((b[0] - mu) * (b[1] - mv) for b in tall)
        root = math.sqrt(((suu - svv) / 2) ** 2 + suv ** 2)
        major, minor = (suu + svv) / 2 + root, (suu + svv) / 2 - root
        if major <= 0 or minor > major / 9:  # not clearly one line
            return angle
        principal = 0.5 * math.atan2(2 * suv, suu - svv)
        step = (principal + math.pi / 4) % (math.pi / 2) - math.pi / 4
        angle += step
        if abs(step) < 1e-4:
            break
    return angle


def orientations(glyphs: Sequence[Sequence[Vec]]) -> List[Tuple[Vec, Vec]]:
    """
    The (u, v) reading frames to try, in the callout's plane: the text direction, then its three right-angle
    turns, on both sides of the plane: 8 frames. The text direction is the angle the characters' own smallest
    enclosing rectangles agree on (they follow the baseline), averaged over the glyphs that are not tiny
    (area-weighted; the angle repeats every 90 degrees, so it is averaged as 4x the angle).
    """
    normal = plane_normal(glyphs)
    if normal is None:
        return []
    e1, e2 = _basis(normal)
    sin_sum = cos_sum = 0.0
    for verts in glyphs:
        angle, area = _glyph_angle(verts, e1, e2)
        sin_sum += area * math.sin(4 * angle)
        cos_sum += area * math.cos(4 * angle)
    angle = math.atan2(sin_sum, cos_sum) / 4 if (sin_sum or cos_sum) else 0.0
    angle = _refine_angle(glyphs, e1, e2, angle)
    u0 = tuple(math.cos(angle) * e1[k] + math.sin(angle) * e2[k] for k in range(3))
    frames: List[Tuple[Vec, Vec]] = []
    for side in (1.0, -1.0):
        n = (normal[0] * side, normal[1] * side, normal[2] * side)
        for turn in range(4):
            u = u0
            for _ in range(turn):
                u = _cross(n, u)
            frames.append((_unit(u), _unit(_cross(n, u))))
    return frames


def _fill(bitmap: List[List[int]], tri: Sequence[Tuple[float, float]]) -> None:
    (x0, y0), (x1, y1), (x2, y2) = tri
    den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    if abs(den) < 1e-12:
        return
    lo_x = max(0, int(math.floor(min(x0, x1, x2) - 0.5)))
    hi_x = min(GRID - 1, int(math.ceil(max(x0, x1, x2) - 0.5)))
    lo_y = max(0, int(math.floor(min(y0, y1, y2) - 0.5)))
    hi_y = min(GRID - 1, int(math.ceil(max(y0, y1, y2) - 0.5)))
    for gy in range(lo_y, hi_y + 1):
        for gx in range(lo_x, hi_x + 1):
            px, py = gx + 0.5, gy + 0.5
            a = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den
            b = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den
            if a >= 0 and b >= 0 and 1 - a - b >= 0:
                bitmap[gy][gx] = 1


def describe(
    glyph: Sequence[Vec], frame: Tuple[Vec, Vec], reference_height: float, baseline: float,
) -> Optional[Dict]:
    """A glyph's descriptor in a reading frame: bitmap of its own box, aspect, relative size and baseline offset."""
    u, v = frame
    xs = [_dot(p, u) for p in glyph]
    ys = [_dot(p, v) for p in glyph]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    if w <= 1e-9 or h <= 1e-9 or reference_height <= 0:
        return None
    bitmap = [[0] * GRID for _ in range(GRID)]
    for k in range(0, len(glyph) - 2, 3):
        tri = [((xs[k + j] - min(xs)) / w * GRID, (1 - (ys[k + j] - min(ys)) / h) * GRID) for j in range(3)]
        _fill(bitmap, tri)
    return {
        "bitmap": bitmap,
        "aspect": w / h,
        "height": h / reference_height,
        "centre": ((min(ys) + max(ys)) / 2 - baseline) / reference_height,
        "x": (min(xs) + max(xs)) / 2,
        "width_abs": w,
    }


def _iou(a: List[List[int]], b: List[List[int]]) -> float:
    inter = union = 0
    for ra, rb in zip(a, b):
        for x, y in zip(ra, rb):
            inter += x & y
            union += x | y
    return inter / union if union else 0.0


def _compatible(d: Dict, t: Dict) -> bool:
    return (abs(d["aspect"] - t["aspect"]) <= ASPECT_TOL * max(d["aspect"], t["aspect"], 0.05)
            and abs(d["height"] - t["height"]) <= SIZE_TOL
            # a character whose vertical position varies between callouts (a datum arrow floats above its
            # letter at any distance) is matched on shape and size alone; the library records which
            and (t.get("centre_free") or abs(d["centre"] - t["centre"]) <= BASELINE_TOL))


def match_glyph(desc: Dict, templates: Dict[str, List[Dict]]) -> Dict:
    """
    {'char': c | '?', 'iou': best overlap, 'margin': lead over the best different character}.
    '?' when no template is compatible and close, or when two characters are too close to call.
    """
    scores: Dict[str, float] = {}
    for ch, variants in templates.items():
        for t in variants:
            if _compatible(desc, t):
                scores[ch] = max(scores.get(ch, 0.0), _iou(desc["bitmap"], t["bitmap"]))
    if not scores:
        return {"char": "?", "iou": 0.0, "margin": 0.0}
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    best_ch, best = ranked[0]
    second = ranked[1][1] if len(ranked) > 1 else 0.0
    if best < MIN_IOU or best - second < MIN_MARGIN:
        return {"char": "?", "iou": round(best, 4), "margin": round(best - second, 4)}
    return {"char": best_ch, "iou": round(best, 4), "margin": round(best - second, 4)}


def _isolated(glyphs: Sequence[Sequence[Vec]]) -> List[int]:
    """
    Indices of filled glyphs that stand apart from the text run: a leader's terminator dot, a lone mark.
    Measured on real callouts: text characters sit within 0.9 glyph heights of a neighbour, a datum letter
    within 1.8 of its arrow, while a leader terminator is 3.7 or more away. Anything further than ISOLATED
    heights from every other glyph, and than four times the usual character spacing, is decoration, not
    text. Never removes down to fewer than two glyphs.
    """
    if len(glyphs) < 3:
        return []
    centres, sizes = [], []
    for g in glyphs:
        lo = tuple(min(p[k] for p in g) for k in range(3))
        hi = tuple(max(p[k] for p in g) for k in range(3))
        centres.append(tuple((lo[k] + hi[k]) / 2 for k in range(3)))
        sizes.append(math.sqrt(sum((hi[k] - lo[k]) ** 2 for k in range(3))))
    tallest = max(sizes)
    nearest_all = [min(math.dist(c, centres[j]) for j in range(len(glyphs)) if j != i) for i, c in enumerate(centres)]
    usual = sorted(nearest_all)[len(nearest_all) // 2]
    out = [i for i, nearest in enumerate(nearest_all) if nearest > ISOLATED * tallest and nearest > 4 * usual]
    return out if len(glyphs) - len(out) >= 2 else []


def decode_callout(
    triangles: Sequence[float], counts: Sequence[int], templates: Dict[str, List[Dict]],
) -> Optional[Dict]:
    """
    Decode one callout's text. The reading frame with the most characters recognised wins; a tie between
    frames that read differently is unresolved. Returns None for a callout with no filled glyphs.
    {'text', 'glyphs': [{'char','iou','margin'}...], 'resolved': bool, 'min_iou', 'min_margin'}
    """
    all_glyphs = split_glyphs(triangles, counts)
    if not all_glyphs:
        return None
    ignored = _isolated(all_glyphs)
    glyphs = [g for i, g in enumerate(all_glyphs) if i not in ignored]
    best: Optional[Dict] = None
    tied_differently = False
    frames = orientations(glyphs)
    # The four turns on the front of the plane first; the back side (a mirrored reading) only when the
    # front does not read every character, which halves the work for the usual callout.
    sides = [frames[:4], frames[4:]]
    for side_index, side_frames in enumerate(sides):
        if side_index == 1 and best is not None and best["resolved"] and not tied_differently:
            break
        best, tied_differently = _decode_frames(glyphs, side_frames, templates, best, tied_differently)
    if best is None:
        return None
    if tied_differently:
        best["resolved"] = False
        best["ambiguous_orientation"] = True
    best["ignored_glyphs"] = len(ignored)  # isolated filled marks (leader dots), not text
    return best


def _decode_frames(glyphs, frames, templates, best, tied_differently):
    for frame in frames:
        extents = []
        for g in glyphs:
            ys = [_dot(p, frame[1]) for p in g]
            extents.append((min(ys), max(ys)))
        reference = max(hi - lo for lo, hi in extents)
        baseline = min(lo for lo, _ in extents)
        described = [describe(g, frame, reference, baseline) for g in glyphs]
        if any(d is None for d in described):
            continue
        order = sorted(range(len(glyphs)), key=lambda i: described[i]["x"])
        matches = [match_glyph(described[i], templates) for i in order]
        recognised = sum(1 for m in matches if m["char"] != "?")
        text_parts: List[str] = []
        for pos, i in enumerate(order):
            if pos > 0:
                prev = described[order[pos - 1]]
                gap = (described[i]["x"] - described[i]["width_abs"] / 2) - (prev["x"] + prev["width_abs"] / 2)
                if gap > SPACE_GAP * reference:
                    text_parts.append(" ")
            text_parts.append(matches[pos]["char"])
        candidate = {
            "text": "".join(text_parts), "glyphs": matches, "recognised": recognised,
            "resolved": recognised == len(matches),
            "min_iou": min((m["iou"] for m in matches), default=0.0),
            "min_margin": min((m["margin"] for m in matches), default=0.0),
        }
        if best is None or recognised > best["recognised"]:
            best, tied_differently = candidate, False
        elif recognised == best["recognised"] and candidate["text"] != best["text"] and recognised > 0:
            tied_differently = True
    return best, tied_differently


# ── Templates ────────────────────────────────────────────────────────────────

def make_template(
    glyph: Sequence[Vec], frame: Tuple[Vec, Vec], reference_height: float, baseline: float,
) -> Optional[Dict]:
    d = describe(glyph, frame, reference_height, baseline)
    if d is None:
        return None
    return {"bitmap": d["bitmap"], "aspect": round(d["aspect"], 4), "height": round(d["height"], 4), "centre": round(d["centre"], 4)}
