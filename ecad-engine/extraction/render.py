"""Board preview: each layer of a board set as an SVG in millimetres on one shared frame.

The layers are drawn by Gerbonara from the files themselves, so the picture shows exactly what was measured. All layers share
the same bounds (the outline extents), so a viewer can stack them and toggle each one. Pad master and drill drawing/guide
layers duplicate other layers and are not drawn.

The same frame carries the board scene: every part of the Pick Place file with its position (mm, y up, the Gerber frame) and every
drilled hole. Positions are as the files state them; tests check on the real boards that parts and holes share the layers' origin.
"""
from __future__ import annotations

import logging
import re
import uuid

from gerbonara import ExcellonFile

from extraction.board import ExtractionError, InputFile, read_tabular
from extraction.outline import measure_outline
from extraction.placements import PlacementError, read_components
from parsers.excellon import load_holes
from parsers.gerber_layer import UnsupportedGerber, load_gerber

log = logging.getLogger(__name__)

# Bump when the shape or drawing of the preview changes: the platform stores each preview with this value and re-renders a
# stored one whose value is older than the version it expects.
RENDER_VERSION = "2"

# Presentation only (how a layer is tinted on screen). Not manufacturing data.
LAYER_STYLE: dict[str, tuple[str, float]] = {
    "board_outline": ("#16a34a", 1.0),
    "copper_top": ("#dc2626", 0.85),
    "copper_bottom": ("#2563eb", 0.7),
    "soldermask_top": ("#0f766e", 0.35),
    "soldermask_bottom": ("#0f766e", 0.25),
    "paste_top": ("#9ca3af", 0.9),
    "paste_bottom": ("#9ca3af", 0.9),
    "silkscreen_top": ("#e5e7eb", 0.9),
    "silkscreen_bottom": ("#d1d5db", 0.8),
    "drill_data": ("#111827", 1.0),
}
DRAWN_ROLES = tuple(LAYER_STYLE)


def _scene_components(files: list[InputFile], placement_layers: dict[str, str]) -> tuple[list[dict], str | None]:
    """The placed parts of the set's Pick Place file, or the reason they cannot be shown (the layers are drawn regardless)."""
    for f in files:
        if f.role is not None:
            continue
        try:
            kind, table = read_tabular(f)
        except ValueError:
            continue
        if kind != "placement":
            continue
        try:
            parts = read_components(table, placement_layers)
        except PlacementError:
            # The reason goes to the log only (it quotes file content); the response carries an id to find it by.
            error_id = uuid.uuid4().hex
            log.warning("Pick Place file %s cannot be shown (error %s)", f.name, error_id, exc_info=True)
            return [], f"The Pick Place file could not be read (error {error_id})."
        return [
            {"designator": c.designator, "comment": c.comment, "footprint": c.footprint, "side": c.side,
             "xMm": round(c.x_mm, 4), "yMm": round(c.y_mm, 4), "rotationDeg": c.rotation_deg}
            for c in parts
        ], None
    return [], None


def _scene_holes(files: list[InputFile]) -> list[dict]:
    drill = next((f for f in files if f.role == "drill_data"), None)
    if drill is None:
        return []
    try:
        holes = load_holes(drill.name, drill.data)
    except Exception as error:  # the drill layer is drawn from the same file; a failure there is reported by name
        raise ExtractionError(f"{drill.name}: holes could not be read ({type(error).__name__})") from error
    return [{"xMm": round(h.x_mm, 4), "yMm": round(h.y_mm, 4), "diameterMm": round(h.diameter_mm, 3), "plated": h.plated} for h in holes]


# The list-card thumbnail is these layers on the shared frame, bottom to top. Everything else is omitted: it is a
# recognisable picture of the board, not a second copy of the viewer.
THUMBNAIL_ROLES = ("board_outline", "copper_bottom", "copper_top", "drill_data")
THUMBNAIL_MAX_CHARS = 400_000
_NUMBER = re.compile(r"-?\d+\.\d+")
_BODY = re.compile(r"<svg[^>]*>(.*)</svg>", re.DOTALL)


def _round_numbers(svg: str, decimals: int) -> str:
    return _NUMBER.sub(lambda m: f"{float(m.group()):.{decimals}f}".rstrip("0").rstrip("."), svg)


def build_thumbnail(layers: list[dict], width_mm: float, height_mm: float) -> str | None:
    """One small SVG of the board, or None when it would be too large to be a thumbnail (the caller shows an icon, not a huge file).

    Coordinates are rounded (0.01 mm, then 0.1 mm) because a thumbnail is a few hundred pixels across. Nothing is simplified
    beyond that: every stroke and pad of the chosen layers is still drawn.
    """
    parts = []
    for role in THUMBNAIL_ROLES:
        for layer in layers:
            if layer["role"] != role:
                continue
            body = _BODY.search(layer["svg"])
            if body:
                parts.append(f'<g opacity="{layer["opacity"]}">{body.group(1).strip()}</g>')
    if not parts:
        return None
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width_mm:g} {height_mm:g}" preserveAspectRatio="xMidYMid meet">{"".join(parts)}</svg>'
    for decimals in (2, 1):
        rounded = _round_numbers(svg, decimals)
        if len(rounded) <= THUMBNAIL_MAX_CHARS:
            return rounded
    return None


def render_board(files: list[InputFile], placement_layers: dict[str, str] | None = None) -> dict:
    outline_file = next((f for f in files if f.role == "board_outline"), None)
    if outline_file is None:
        raise ExtractionError("the set has no board outline layer, so there is no frame to draw the layers on")
    try:
        outline = measure_outline(load_gerber(outline_file.name, outline_file.data))
    except (ValueError, UnsupportedGerber) as error:
        raise ExtractionError(f"{outline_file.name}: {error}") from error
    bounds = ((outline.min_x_mm, outline.min_y_mm), (outline.min_x_mm + outline.length_mm, outline.min_y_mm + outline.width_mm))

    layers = []
    for f in files:
        if f.role not in DRAWN_ROLES:
            continue
        color, opacity = LAYER_STYLE[f.role]
        try:
            if f.role == "drill_data":
                drawing = ExcellonFile.from_string(f.data.decode("latin1"), filename=f.name)
            else:
                drawing = load_gerber(f.name, f.data)
            svg = str(drawing.to_svg(margin=0, force_bounds=bounds, fg=color, bg="none"))
        except UnsupportedGerber as error:
            raise ExtractionError(str(error)) from error
        except Exception as error:  # Gerbonara raises assorted errors for a layer it cannot draw
            raise ExtractionError(f"{f.name}: could not be drawn ({type(error).__name__})") from error
        layers.append({"name": f.name, "role": f.role, "color": color, "opacity": opacity, "svg": svg})

    components, components_error = _scene_components(files, placement_layers or {})
    return {
        "renderVersion": RENDER_VERSION,
        "thumbnail": build_thumbnail(layers, round(outline.length_mm, 3), round(outline.width_mm, 3)),
        "components": components,
        "componentsError": components_error,
        "holes": _scene_holes(files),
        "bounds": {"minXMm": round(bounds[0][0], 3), "minYMm": round(bounds[0][1], 3), "widthMm": round(outline.length_mm, 3), "heightMm": round(outline.width_mm, 3)},
        "layers": layers,
    }
