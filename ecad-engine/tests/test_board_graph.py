"""The whole extraction on the smallest hand-written set: an outline, two copper layers, a drill file and a Pick Place table.

These strings are not a sample board; they only make extract_board run end to end so the graph it returns can be checked
against the contract. Real boards are verified by uploading them.
"""
from __future__ import annotations

import json
from pathlib import Path

from jsonschema import Draft7Validator

from extraction.board import CONTRACT_VERSION, InputFile, Lookups, extract_board

SCHEMA = json.loads((Path(__file__).resolve().parent.parent / "contract" / "schemas" / "board_feature_graph.v1.schema.json").read_text())
HEADER = "%FSLAX24Y24*%\n%MOMM*%\n"

OUTLINE = HEADER + "%ADD10C,0.10*%\nD10*\nX0Y0D02*\nX200000Y0D01*\nX200000Y100000D01*\nX0Y100000D01*\nX0Y0D01*\nM02*\n"
# Two pads joined by a trace on top (R1, a jumper), a via pad 1 mm above the trace, and the same via pad on the bottom.
TOP = (
    HEADER
    + "%ADD10C,0.25*%\n%ADD11R,1.0X1.0*%\n%ADD12C,0.80*%\n"
    + "D11*\nX50000Y50000D03*\nX150000Y50000D03*\n"
    + "D10*\nX50000Y50000D02*\nX150000Y50000D01*\n"
    + "D12*\nX100000Y60000D03*\nM02*\n"
)
BOTTOM = HEADER + "%ADD12C,0.80*%\nD12*\nX100000Y60000D03*\nM02*\n"
DRILL = "M48\nMETRIC,LZ\n;TYPE=PLATED\nT1C0.400\n%\nT1\nX10.0Y6.0\nM30\n"  # Altium marks plating with a TYPE comment
PICK_PLACE = (
    '"Designator","Comment","Layer","Footprint","Center-X(mm)","Center-Y(mm)","Rotation","Description"\n'
    '"R1","","TopLayer","JUMPER","10.0000","5.0000","0",""\n'
)


def _graph() -> dict:
    files = [
        InputFile("b.gko", OUTLINE.encode(), "board_outline"),
        InputFile("b.gtl", TOP.encode(), "copper_top"),
        InputFile("b.gbl", BOTTOM.encode(), "copper_bottom"),
        InputFile("b.txt", DRILL.encode(), "drill_data"),
        InputFile("pp.csv", PICK_PLACE.encode()),
    ]
    return extract_board(files, Lookups({"toplayer": "top"}, {}), {}, "B").graph


def test_the_graph_satisfies_the_contract_schema():
    graph = _graph()
    errors = sorted(Draft7Validator(SCHEMA).iter_errors(graph), key=str)
    assert not errors, [e.message for e in errors]
    assert graph["contractVersion"] == CONTRACT_VERSION == "1.3"


def test_every_present_top_level_field_has_its_own_provenance_entry():
    # Regression: fabrication facts carried only dotted entries (fabrication.minHoleMm, ...), so the platform rejected
    # every real board set with "provenance missing for fabrication".
    graph = _graph()
    data = [k for k in ("outline", "layers", "holes", "fabrication", "copper", "placements", "thtParts", "connectivity", "sidesPopulated") if k in graph]
    assert {"fabrication", "copper", "connectivity"} <= set(data)
    assert [k for k in data if k not in graph["provenance"]] == []


def test_copper_facts_are_measured_from_the_copper_and_drill_files():
    graph = _graph()
    assert graph["fabrication"]["minSpacingMm"] == 0.475  # 1 mm between centres - 0.4 via radius - 0.125 trace half-width
    assert graph["fabrication"]["minAnnularRingMm"] == 0.2  # (0.8 pad - 0.4 hole) / 2
    assert graph["copper"]["viaCount"] == 1  # the hole belongs to no placed part
    assert graph["copper"]["conductors"] == 2  # the pad pair with its trace, and the via through both layers
    assert graph["provenance"]["copper.viaCount"]["source"]["file"] == "b.txt"
    assert graph["connectivity"]["shortedParts"] == ["R1"]  # both pins of R1 sit on the trace that joins them


def test_a_drawing_pdf_in_the_set_is_kept_as_reference_not_read_as_a_table():
    # Regression: a design pack carries each board's drawing beside its Gerbers; every role-less file was parsed as a
    # table, so the PDF failed the whole board with "file is neither UTF-8 nor GBK text".
    files = [
        InputFile("b.gko", OUTLINE.encode(), "board_outline"),
        InputFile("b.gtl", TOP.encode(), "copper_top"),
        InputFile("pp.csv", PICK_PLACE.encode()),
        InputFile("drawing.pdf", b"%PDF-1.4\n\x00\xff\xfe binary body\n%%EOF\n"),
    ]
    result = extract_board(files, Lookups({"toplayer": "top"}, {}), {}, "B")
    assert result.graph["placements"]
    assert {"name": "drawing.pdf", "role": "document", "status": "reference", "note": "kept with the board for review; not a table or a board layer, so not read"} in result.files_report
