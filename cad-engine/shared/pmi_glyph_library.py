"""
The glyph templates the PMI text decoder (shared/pmi_glyphs.py) matches against.

Templates are built ONLY from callouts whose text a person verified (scripts/pmi_glyph_manifest.json:
callout name -> text and the upright reading frame), never from decoded output. Each template is the
descriptor of one drawn character: its coverage bitmap, aspect, and size/baseline relative to its
callout. A character the library has never seen cannot be decoded: the glyph stays '?' and the callout
unresolved.
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, Iterable, List, Optional, Sequence

from shared.pmi_glyphs import (
    GRID, _dot, _iou, describe, make_template, orientations, split_glyphs,
)

TEMPLATES_PATH = os.path.join(os.path.dirname(__file__), "pmi_glyph_templates.json")
SAME_VARIANT_IOU = 0.97  # a second drawing of a character this close to a stored one adds nothing
CENTRE_FREE_SPREAD = 0.25  # relative-height spread of one character across callouts above which its position is not baseline-tied

Templates = Dict[str, List[Dict[str, Any]]]


def _frame_and_order(graphic: Dict[str, Any], turn: int, order: str):
    glyphs = split_glyphs(graphic["triangles"], graphic["glyph_triangle_counts"])
    frames = orientations(glyphs)
    if not glyphs or turn >= len(frames):
        raise ValueError(f"{graphic['callout']}: no reading frame {turn}")
    frame = frames[turn]
    extents = [(min(_dot(p, frame[1]) for p in g), max(_dot(p, frame[1]) for p in g)) for g in glyphs]
    reference = max(hi - lo for lo, hi in extents)
    baseline = min(lo for lo, _ in extents)
    described = [describe(g, frame, reference, baseline) for g in glyphs]
    if order == "vertical":  # stacked glyphs (a datum symbol): top first
        ranked = sorted(range(len(glyphs)), key=lambda i: -(extents[i][0] + extents[i][1]))
    else:
        ranked = sorted(range(len(glyphs)), key=lambda i: described[i]["x"])
    return glyphs, frame, reference, baseline, ranked


def build_templates(
    graphics: Sequence[Dict[str, Any]], manifest: Dict[str, Any], exclude: Iterable[str] = (),
) -> Templates:
    """Templates from the manifest's verified callouts (minus `exclude`), one list of variants per character."""
    by_name = {g["callout"]: g for g in graphics}
    skip = set(exclude)
    templates: Templates = {}
    seen_centres: Dict[str, List[float]] = {}
    for name, truth in manifest["callouts"].items():
        if name in skip:
            continue
        graphic = by_name.get(name)
        if graphic is None:
            raise ValueError(f"manifest callout {name!r} is not in the graphics")
        chars = [c for c in truth["text"] if c != " "]
        glyphs, frame, reference, baseline, ranked = _frame_and_order(graphic, truth["turn"], truth.get("order", "horizontal"))
        if len(chars) != len(glyphs):
            raise ValueError(f"{name}: {len(glyphs)} drawn characters but the verified text has {len(chars)}")
        for ch, index in zip(chars, ranked):
            template = make_template(glyphs[index], frame, reference, baseline)
            if template is None:
                continue
            seen_centres.setdefault(ch, []).append(template["centre"])
            variants = templates.setdefault(ch, [])
            if not any(_iou(template["bitmap"], v["bitmap"]) >= SAME_VARIANT_IOU for v in variants):
                variants.append(template)
    # A character drawn at clearly different heights above the baseline across callouts is not
    # positioned by the baseline: match it on shape and size only.
    for ch, centres in seen_centres.items():
        if max(centres) - min(centres) > CENTRE_FREE_SPREAD:
            for v in templates[ch]:
                v["centre_free"] = True
    return templates


def to_json(templates: Templates, manifest: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "source": manifest.get("source"),
        "verified_by": manifest.get("verified_by"),
        "grid": GRID,
        "templates": {
            ch: [{**{k: v for k, v in t.items() if k != "bitmap"}, "bitmap": ["".join(str(c) for c in row) for row in t["bitmap"]]} for t in variants]
            for ch, variants in sorted(templates.items())
        },
    }


def from_json(data: Dict[str, Any]) -> Templates:
    return {
        ch: [{**{k: v for k, v in t.items() if k != "bitmap"}, "bitmap": [[int(c) for c in row] for row in t["bitmap"]]} for t in variants]
        for ch, variants in data["templates"].items()
    }


_cached: Optional[Templates] = None


def default_templates() -> Templates:
    """The committed library; empty (every glyph unresolved) if the file is absent."""
    global _cached
    if _cached is None:
        try:
            with open(TEMPLATES_PATH, encoding="utf8") as fh:
                _cached = from_json(json.load(fh))
        except FileNotFoundError:
            _cached = {}
    return _cached
