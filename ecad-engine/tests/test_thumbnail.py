"""The list-card thumbnail composed from already-drawn layers (hand-written layer strings, not a sample board)."""
from __future__ import annotations

from extraction.render import THUMBNAIL_MAX_CHARS, build_thumbnail

LAYER = '<?xml version="1.0"?>\n<svg width="10mm" height="5mm" viewBox="0 0 10 5" xmlns="http://www.w3.org/2000/svg"><g transform="translate(0.0 5.0) scale(1 -1)"><path d="M 0.123456 0.0 L 9.876543 4.0" stroke-width="0.25"/></g></svg>'


def layer(role: str, svg: str = LAYER) -> dict:
    return {"role": role, "opacity": 0.85, "svg": svg}


def test_layers_are_stacked_in_order_on_one_frame_with_rounded_coordinates():
    svg = build_thumbnail([layer("copper_top"), layer("board_outline"), layer("copper_bottom"), layer("paste_top")], 10, 5)
    assert svg.startswith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"')
    assert svg.count("<g opacity") == 3  # outline, bottom copper, top copper; paste is not part of the thumbnail
    assert "0.123456" not in svg and "M 0.12 0 L 9.88 4" in svg


def test_no_drawn_layers_gives_no_thumbnail():
    assert build_thumbnail([layer("paste_top")], 10, 5) is None


def test_a_thumbnail_that_stays_too_large_is_dropped_not_shipped():
    big = LAYER.replace('d="M 0.123456 0.0 L 9.876543 4.0"', 'd="' + " ".join(f"L {i}.5 {i}.25" for i in range(THUMBNAIL_MAX_CHARS)) + '"')
    assert build_thumbnail([layer("copper_top", big)], 10, 5) is None
