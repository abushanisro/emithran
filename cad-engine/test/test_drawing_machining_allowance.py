"""Machining allowance callouts in the drawing analyzer (text only): what the drawing prints, never an ISO table value."""
from shared.drawing_analyzer import _extract_machining_allowance as read


def test_iso_8062_3_general_tolerance_callout_gives_grade_and_allowance():
    got = read("GENERAL TOLERANCES ISO 8062-3 – DCTG 10 – RMA 6 (RMAG H)")
    assert got == {"text": "ISO 8062-3 – DCTG 10 – RMA 6 (RMAG H)", "allowance_mm": 6.0, "rmag": "H", "dctg": 10}


def test_iso_callout_with_a_grade_and_no_value_gives_the_grade_only():
    got = read("TOLERANCES: ISO 8062-3 - DCTG 9 - RMAG F\nUNLESS OTHERWISE STATED")
    assert got["allowance_mm"] is None
    assert (got["rmag"], got["dctg"]) == ("F", 9)


def test_older_iso_8062_form_with_the_grade_in_brackets():
    got = read("ISO 8062-CT12-RMA 2.5 (G)")
    assert (got["allowance_mm"], got["rmag"], got["dctg"]) == (2.5, "G", 12)


def test_plain_machining_allowance_notes():
    for text, mm in [
        ("NOTES:\n4. MACHINING ALLOWANCE 3 MM ON ALL MACHINED FACES", 3.0),
        ("MACHINING ALLOWANCE: 2,5mm", 2.5),
        ("3 MM STOCK ON MACHINED FACES", 3.0),
        ("LEAVE 4 MM MACHINING STOCK", 4.0),
        ("ALLOW 2.5 MM FOR MACHINING", 2.5),
    ]:
        got = read(text)
        assert got["allowance_mm"] == mm, text
        assert got["rmag"] is None and got["dctg"] is None, text


def test_a_note_without_a_millimetre_value_is_kept_as_text_only():
    got = read("MACHINING ALLOWANCE AS PER FOUNDRY STANDARD")
    assert got["allowance_mm"] is None
    assert "MACHINING ALLOWANCE" in got["text"]
    assert read("0.12 IN MACHINING STOCK")["allowance_mm"] is None


def test_two_different_values_are_not_chosen_between():
    got = read("MACHINING ALLOWANCE 3 MM\nISO 8062-3 – DCTG 10 – RMA 6 (RMAG H)")
    assert got["allowance_mm"] is None
    assert got["rmag"] == "H"
    assert "3 MM" in got["text"] and "RMA 6" in got["text"]


def test_the_same_value_twice_is_one_value():
    assert read("MACHINING ALLOWANCE 3 MM. 3 MM STOCK ON MACHINED FACES")["allowance_mm"] == 3.0


def test_drawings_without_an_allowance_callout():
    for text in ["", "ISO 2768-mK", "MACHINED FINISH Ra 1.6", "STOCK NO. 4471", "TOLERANCE ALLOWANCE 0.1", "ISO 8062-3 DCTG 10"]:
        got = read(text)
        assert got is None or got["allowance_mm"] is None and got["rmag"] is None, text
    assert read("") is None
    assert read("MACHINED FINISH Ra 1.6") is None
