"""Chemical-milling callout detection in the drawing analyzer (text only)."""
from shared.drawing_analyzer import _extract_chemical_milling


def test_detects_chem_mill_note_variants():
    assert _extract_chemical_milling({}, "NOTES:\n3. CHEM MILL PER AMS 2643") == "CHEM MILL"
    assert _extract_chemical_milling({}, "chemically milled areas as shown") == "CHEMICALLY MILLED"
    assert _extract_chemical_milling({}, "CHEM-MILLED POCKETS 1.2 DEEP") == "CHEM-MILLED"
    assert _extract_chemical_milling({}, "CHEMICAL ETCHING TO DEPTH SHOWN") == "CHEMICAL ETCHING"


def test_prefers_a_title_block_process_field():
    tb = {"process": "Chemical Mill per MIL-STD-1234"}
    assert _extract_chemical_milling(tb, "") == "Chemical Mill per MIL-STD-1234"


def test_ordinary_milling_and_other_chemical_words_are_not_chem_milling():
    for text in ["MILLED FINISH", "SURFACE MILLING", "PHOTOCHEMICAL MACHINE", "CHEMICAL CONVERSION COATING", ""]:
        assert _extract_chemical_milling({}, text) == "None", text
