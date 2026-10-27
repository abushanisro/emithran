"""Builds a candidate board feature graph (contract 1.1) from a set of customer board files.

Every field the files state is measured; every field a person or document states arrives as `supplied`; a field that is
neither stays unresolved. Nothing is estimated. All lookup data (file roles, placement layer names, footprint classes)
is passed in; the engine holds none of its own.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from extraction.fabrication import measure_trace_width, smallest_hole_mm
from extraction.holes import compare_with_report, group_holes
from extraction.outline import measure_outline
from extraction.paste import measure_paste
from extraction.placements import PlacementError, group_placements, read_components
from extraction.copper_facts import analyse_copper as _analyse_copper
from parsers.drill_report import parse_drill_report
from parsers.excellon import load_holes
from parsers.gerber_layer import UnsupportedGerber, load_gerber
from parsers.tabular import Table, read_csv_table, read_sheet_table

PARSER_ID = "ecad-engine-board"
PARSER_VERSION = "0.3.0"
CONTRACT_VERSION = "1.3"

PLACEMENT_MARKER = "Designator"
# Files without a board-file role that can hold a table (a Pick Place file, a BOM workbook). Any other role-less file in the
# set (a drawing PDF, a photo, a requirements document) travels with the board as reference and is never parsed as a table.
TABULAR_EXTENSIONS = (".csv", ".tsv", ".txt", ".xlsx", ".xlsm")
COPPER_ROLES = ("copper_top", "copper_bottom")
# Roles that are recognised files but are not measured yet.
REFERENCE_ROLES = (
    "pad_master_top",
    "pad_master_bottom",
    "drill_drawing",
    "drill_guide",
)


class ExtractionError(ValueError):
    """The set cannot produce a graph (for example: no outline layer)."""


@dataclass(frozen=True)
class InputFile:
    name: str
    data: bytes
    role: str | None = None


@dataclass(frozen=True)
class PackageEntry:
    package_class: str | None
    mount_type: str  # smd | tht | mark
    pin_count: int | None


@dataclass(frozen=True)
class Lookups:
    placement_layers: dict[str, str]  # lower-case layer name -> top | bottom
    packages: dict[str, PackageEntry]  # exact footprint name -> entry


@dataclass(frozen=True)
class Supplied:
    """A fact stated by a person or a document, with who said it."""

    value: Any
    note: str


@dataclass
class Extraction:
    graph: dict[str, Any]
    documents: dict[str, Any] = field(default_factory=dict)
    files_report: list[dict[str, str]] = field(default_factory=list)


def _finding(findings: list, severity: str, message: str, field_name: str | None = None) -> None:
    findings.append({"severity": severity, "message": message, **({"field": field_name} if field_name else {})})


def read_tabular(file: InputFile) -> tuple[str, Table]:
    """('placement', table) when the file has a Designator column, else ('table', table) for a workbook."""
    is_sheet = file.name.lower().endswith((".xlsx", ".xlsm"))
    try:
        table = read_sheet_table(file.data, PLACEMENT_MARKER) if is_sheet else read_csv_table(file.data, PLACEMENT_MARKER)
        return "placement", table
    except ValueError:
        if is_sheet:
            return "table", read_sheet_table(file.data)
        raise


def extract_board(
    files: list[InputFile],
    lookups: Lookups,
    supplied: dict[str, Supplied] | None = None,
    input_tier: str = "B",
) -> Extraction:
    supplied = supplied or {}
    graph: dict[str, Any] = {
        "contractVersion": CONTRACT_VERSION,
        "kind": "board",
        "inputTier": input_tier,
        "reviewStatus": "needs_review",
        "extraction": {"parserId": PARSER_ID, "parserVersion": PARSER_VERSION},
        "provenance": {},
        "unresolved": [],
    }
    provenance: dict[str, Any] = graph["provenance"]
    unresolved: list[dict[str, str]] = graph["unresolved"]
    findings: list[dict[str, str]] = []
    report: list[dict[str, str]] = []
    used: list[str] = []
    documents: dict[str, Any] = {}
    by_role: dict[str, list[InputFile]] = {}
    tabular: list[InputFile] = []

    for f in files:
        if f.role:
            by_role.setdefault(f.role, []).append(f)
        elif f.name.lower().endswith(TABULAR_EXTENSIONS):
            tabular.append(f)
        else:
            report.append({"name": f.name, "role": "document", "status": "reference", "note": "kept with the board for review; not a table or a board layer, so not read"})

    def one(role: str) -> InputFile | None:
        found = by_role.get(role, [])
        if len(found) > 1:
            raise ExtractionError(f"more than one {role} file: {', '.join(x.name for x in found)}")
        return found[0] if found else None

    def measured(name: str, source: InputFile, confidence: str, reference: str | None = None) -> None:
        provenance[name] = {
            "basis": "measured",
            "confidence": confidence,
            "source": {"file": source.name, **({"reference": reference} if reference else {})},
        }
        if source.name not in used:
            used.append(source.name)

    # ---- outline -------------------------------------------------------------------------------------------
    outline_file = one("board_outline")
    if outline_file is None:
        raise ExtractionError("the set has no board outline layer, so the board size cannot be measured")
    try:
        outline = measure_outline(load_gerber(outline_file.name, outline_file.data))
    except (ValueError, UnsupportedGerber) as error:
        raise ExtractionError(f"{outline_file.name}: {error}") from error
    graph["outline"] = {
        "lengthMm": round(outline.length_mm, 3),
        "widthMm": round(outline.width_mm, 3),
        "areaMm2": round(outline.area_mm2, 2),
    }
    measured("outline", outline_file, "high", "centre line of the outline path; area is the sum of the regions it encloses")
    if outline.dangling_ends:
        _finding(findings, "warning", f"the outline path has {outline.dangling_ends} loose end(s); the area may be incomplete", "outline")
    if len(outline.regions) > 1:
        parts = ", ".join(f"{r.length_mm:.1f} x {r.width_mm:.1f} mm" for r in outline.regions)
        _finding(
            findings,
            "info",
            f"the outline layer encloses {len(outline.regions)} separate regions ({parts}): a panel of boards and rails, or several parts",
            "outline",
        )
    thickness = supplied.get("outline.thicknessMm")
    if thickness:
        graph["outline"]["thicknessMm"] = thickness.value
        provenance["outline.thicknessMm"] = {"basis": "supplied", "confidence": "high", "source": {"note": thickness.note}}
    else:
        unresolved.append({"field": "outline.thicknessMm", "reason": "board thickness is not in a Gerber set; it comes from the fabrication drawing"})

    # ---- layers --------------------------------------------------------------------------------------------
    copper = [f for role in COPPER_ROLES for f in by_role.get(role, [])]
    if not copper:
        raise ExtractionError("the set has no copper layer")
    graph["layers"] = len(copper)
    measured("layers", copper[0], "medium", f"counted {len(copper)} copper layer file(s): {', '.join(f.name for f in copper)}")
    for f in copper[1:]:
        if f.name not in used:
            used.append(f.name)
    stated = supplied.get("layers")
    if stated and stated.value != len(copper):
        _finding(findings, "warning", f"{stated.note} states {stated.value} layers; the set has {len(copper)} copper layer file(s)", "layers")

    # ---- fabrication facts ---------------------------------------------------------------------------------
    fabrication: dict[str, Any] = {}

    # ---- holes ---------------------------------------------------------------------------------------------
    drill_file = one("drill_data")
    drilled: list = []
    if drill_file is None:
        unresolved.append({"field": "holes", "reason": "the set has no drill file"})
    else:
        drilled = load_holes(drill_file.name, drill_file.data)
        groups = group_holes(drilled)
        graph["holes"] = [{"diameterMm": g.diameter_mm, "plated": g.plated, "count": g.count} for g in groups]
        report_file = one("drill_report")
        matched = False
        if report_file is not None:
            checks = compare_with_report(groups, parse_drill_report(report_file.data))
            for severity, message in checks:
                _finding(findings, severity, message, "holes")
            matched = all(severity == "info" for severity, _ in checks)
            used.append(report_file.name)
        measured("holes", drill_file, "high" if matched else "medium", "cross-checked against the drill report" if matched else None)
        smallest = smallest_hole_mm(drilled)
        if smallest is not None:
            fabrication["minHoleMm"] = smallest
            measured("fabrication.minHoleMm", drill_file, "high" if matched else "medium", "smallest tool diameter in the drill file")

    # ---- paste ---------------------------------------------------------------------------------------------
    paste: dict[str, float] = {}
    paste_files: list[InputFile] = []
    for side in ("top", "bottom"):
        paste_file = one(f"paste_{side}")
        if paste_file is None:
            unresolved.append({"field": f"pasteAreaMm2.{side}", "reason": f"the set has no {side} paste layer"})
            continue
        try:
            paste[side] = round(measure_paste(load_gerber(paste_file.name, paste_file.data)).area_mm2, 2)
        except (ValueError, UnsupportedGerber) as error:
            raise ExtractionError(f"{paste_file.name}: {error}") from error
        paste_files.append(paste_file)
        provenance[f"pasteAreaMm2.{side}"] = {"basis": "measured", "confidence": "high", "source": {"file": paste_file.name}}
        used.append(paste_file.name)
    if paste:
        graph["pasteAreaMm2"] = paste
        provenance["pasteAreaMm2"] = {
            "basis": "measured",
            "confidence": "high",
            "source": {"file": paste_files[0].name, "reference": "sum of the flashed paste openings per side"},
        }

    # ---- soldermask, silkscreen, narrowest trace -------------------------------------------------------------
    for feature in ("soldermask", "silkscreen"):
        present: dict[str, bool] = {}
        layer_files: list[InputFile] = []
        for side in ("top", "bottom"):
            layer = one(f"{feature}_{side}")
            if layer is None:
                unresolved.append({"field": f"fabrication.{feature}.{side}", "reason": f"the set has no {side} {feature} layer; a board without it and an incomplete set look the same"})
                continue
            try:
                load_gerber(layer.name, layer.data)
            except UnsupportedGerber as error:
                raise ExtractionError(str(error)) from error
            present[side] = True
            layer_files.append(layer)
        if present:
            fabrication[feature] = present
            measured(f"fabrication.{feature}", layer_files[0], "high", f"{', '.join(f.name for f in layer_files)} present")
            for layer in layer_files[1:]:
                if layer.name not in used:
                    used.append(layer.name)
    narrowest: float | None = None
    narrowest_file: InputFile | None = None
    skipped_strokes = 0
    for f in copper:
        try:
            trace = measure_trace_width(load_gerber(f.name, f.data))
        except UnsupportedGerber as error:
            raise ExtractionError(str(error)) from error
        skipped_strokes += trace.skipped
        if trace.min_width_mm is not None and (narrowest is None or trace.min_width_mm < narrowest):
            narrowest, narrowest_file = trace.min_width_mm, f
    if narrowest is not None and narrowest_file is not None:
        fabrication["minTraceWidthMm"] = narrowest
        measured("fabrication.minTraceWidthMm", narrowest_file, "medium", "narrowest circular-aperture stroke on the copper layers; pours and pads are not strokes")
        if skipped_strokes:
            _finding(findings, "info", f"{skipped_strokes} copper stroke(s) use a non-circular aperture and are not in the narrowest-trace measurement", "fabrication.minTraceWidthMm")
    else:
        unresolved.append({"field": "fabrication.minTraceWidthMm", "reason": "the copper layers hold no circular-aperture strokes to measure"})
    graph["fabrication"] = fabrication  # removed again at the end when nothing was measured

    # ---- placements ----------------------------------------------------------------------------------------
    placement_tables: list[tuple[InputFile, Table]] = []
    for f in tabular:
        kind, table = read_tabular(f)
        if kind == "placement":
            placement_tables.append((f, table))
            documents["placement"] = {"preamble": table.preamble, "rows": len(table.rows)}
        else:
            documents["bom"] = {"file": f.name, "headers": table.headers, "rows": table.rows[:500]}
            report.append({"name": f.name, "role": "bom", "status": "reference", "note": "shown for review; not matched to placements (no designators)"})
    if len(placement_tables) > 1:
        raise ExtractionError("more than one Pick Place file")
    components: list | None = None
    pp_used: InputFile | None = None
    if placement_tables:
        pp_file, table = placement_tables[0]
        pp_used = pp_file
        try:
            components = read_components(table, lookups.placement_layers)
        except PlacementError:
            components = None  # positions missing: placements are still counted, pins cannot be traced
        try:
            groups_pp, duplicates = group_placements(table, lookups.placement_layers)
        except PlacementError as error:
            raise ExtractionError(f"{pp_file.name}: {error}") from error
        if duplicates:
            _finding(findings, "warning", f"Pick Place repeats designator(s): {', '.join(duplicates[:10])}", "placements")
        placements: list[dict[str, Any]] = []
        tht: dict[str, dict[str, Any]] = {}
        unknown_footprints: dict[str, int] = {}
        unknown_pins: dict[str, int] = {}
        for g in groups_pp:
            entry = lookups.packages.get(g.footprint)
            if entry is None:
                unknown_footprints[g.footprint] = unknown_footprints.get(g.footprint, 0) + g.count
                placements.append({"side": g.side, "packageClass": "unknown", "count": g.count, "footprint": g.footprint})
            elif entry.mount_type == "mark":
                continue
            elif entry.mount_type == "tht":
                if entry.pin_count is None:
                    unknown_pins[g.footprint] = unknown_pins.get(g.footprint, 0) + g.count
                    placements.append({"side": g.side, "packageClass": "unknown", "count": g.count, "footprint": g.footprint})
                else:
                    current = tht.get(g.footprint, {"label": g.footprint, "count": 0, "jointsPerPart": entry.pin_count})
                    current["count"] += g.count
                    tht[g.footprint] = current
            else:
                placements.append({"side": g.side, "packageClass": entry.package_class, "count": g.count, "footprint": g.footprint})
        graph["placements"] = placements
        graph["thtParts"] = list(tht.values())
        measured("placements", pp_file, "high", f"{sum(g.count for g in groups_pp)} rows grouped by side and footprint")
        provenance["thtParts"] = {"basis": "derived", "confidence": "medium", "derivedFrom": ["placements"]}
        if unknown_footprints:
            names = ", ".join(f"{k} ({v})" for k, v in sorted(unknown_footprints.items()))
            unresolved.append({"field": "placements", "reason": f"footprints not in the package-class lookup, so their class and mount type are unknown: {names}"})
            unresolved.append({"field": "thtParts", "reason": "through-hole parts cannot be told from surface-mount until the footprints above are in the lookup"})
        if unknown_pins:
            unresolved.append({"field": "thtParts", "reason": f"through-hole footprints without a pin count: {', '.join(sorted(unknown_pins))}"})
        graph["sidesPopulated"] = sorted({g.side for g in groups_pp}, key=("top", "bottom").index)
        provenance["sidesPopulated"] = {"basis": "derived", "confidence": "high", "derivedFrom": ["placements"]}
        report.append({"name": pp_file.name, "role": "placement", "status": "used", "note": ""})
    else:
        unresolved.append({"field": "placements", "reason": "the set has no Pick Place file"})
        if paste:
            graph["sidesPopulated"] = [s for s in ("top", "bottom") if s in paste]
            provenance["sidesPopulated"] = {"basis": "derived", "confidence": "low", "derivedFrom": ["pasteAreaMm2"]}

    # ---- copper reverse engineering: nets, pins, mount type, chains, spacing ------------------------------------
    _analyse_copper(graph, provenance, unresolved, findings, used, copper, by_role, drilled, components, outline_file, drill_file, pp_used)

    unresolved.append({"field": "uniquePartNumbers", "reason": "the BOM lists no designators, so its lines cannot be matched to the placements"})
    unresolved.append({"field": "testPoints", "reason": "no netlist or test point layer in the set"})

    # ---- supplied panel ------------------------------------------------------------------------------------
    up = supplied.get("panel.boardsPerPanel")
    if up:
        graph["panel"] = {
            "boardsPerPanel": up.value,
            "panelLengthMm": graph["outline"]["lengthMm"],
            "panelWidthMm": graph["outline"]["widthMm"],
        }
        provenance["panel"] = {"basis": "supplied", "confidence": "high", "source": {"note": up.note}}

    # ---- file report ---------------------------------------------------------------------------------------
    for f in files:
        if not f.role:
            continue
        status = "used" if f.name in used else ("reference" if f.role in REFERENCE_ROLES else "ignored")
        note = {"reference": "recognised; not measured yet", "ignored": "not needed for this set"}.get(status, "")
        report.append({"name": f.name, "role": f.role, "status": status, "note": note})

    if not graph.get("fabrication"):
        graph.pop("fabrication", None)
    else:
        # Every present top-level field needs its own provenance entry; each fabrication fact keeps its dotted one.
        first = next(provenance[k] for k in provenance if k.startswith("fabrication."))
        provenance["fabrication"] = {
            "basis": "measured",
            "confidence": first["confidence"],
            "source": {"file": first["source"]["file"], "reference": "each fact has its own fabrication.* entry"},
        }
    graph["sourceFiles"] = [f.name for f in files if f.name in used or any(r["name"] == f.name and r["status"] == "used" for r in report)]
    if findings:
        graph["findings"] = findings
    return Extraction(graph=graph, documents=documents, files_report=report)
