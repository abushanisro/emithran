"""Gear quality, gear shaving / shaping and polygon callouts in the drawing analyzer (text only)."""
from shared.drawing_analyzer import (
    _GEAR_SHAPING_RE, _GEAR_SHAVING_RE, _POLYGON_RE, _extract_gear_quality, _match_or_none,
)


def test_gear_quality_new_agma_old_agma_and_din():
    assert _extract_gear_quality("GEAR DATA: AGMA 2015 A6") == "A6"
    assert _extract_gear_quality("QUALITY: AGMA A8") == "A8"
    assert _extract_gear_quality("AGMA Q10 MIN") == "Q10"
    assert _extract_gear_quality("ACCURACY DIN 3962 QUALITY 7") == "DIN7"
    assert _extract_gear_quality("DIN 7") == "DIN7"


def test_no_gear_quality_in_unrelated_din_references():
    assert _extract_gear_quality("THREADS PER DIN 13-1") == "None"
    assert _extract_gear_quality("NO GEAR DATA") == "None"


def test_shaving_and_shaping_callouts():
    assert _match_or_none(_GEAR_SHAVING_RE, "TEETH TO BE SHAVED AFTER HOBBING") == "SHAVED"
    assert _match_or_none(_GEAR_SHAVING_RE, "GEAR SHAVING REQUIRED") == "GEAR SHAVING"
    assert _match_or_none(_GEAR_SHAPING_RE, "INTERNAL TEETH: GEAR SHAPING") == "GEAR SHAPING"
    assert _match_or_none(_GEAR_SHAPING_RE, "SHAPED SPLINE 24T") == "SHAPED SPLINE"
    # "SHAPE" alone (e.g. a form note) is not gear shaping
    assert _match_or_none(_GEAR_SHAPING_RE, "SHAPE PER MODEL") == "None"
    assert _match_or_none(_GEAR_SHAVING_RE, "SHAPE PER MODEL") == "None"


def test_polygon_callouts():
    assert _match_or_none(_POLYGON_RE, "6MM HEX SOCKET, ROTARY BROACHED") == "HEX SOCKET"
    assert _match_or_none(_POLYGON_RE, "ROTARY BROACH 8 A/F") == "ROTARY BROACH"
    assert _match_or_none(_POLYGON_RE, "POLYGON TURNING 17 A/F") == "POLYGON TURNING"
    assert _match_or_none(_POLYGON_RE, "HEX NUT M8") == "None"
    assert _match_or_none(_POLYGON_RE, "SQUARE POCKET 20X20") == "None"
