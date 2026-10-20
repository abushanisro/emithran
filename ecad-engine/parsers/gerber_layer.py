"""Gerber layer reading (RS-274X) on top of Gerbonara. Customer files: nothing here logs content."""
from __future__ import annotations

from gerbonara import GerberFile


class UnsupportedGerber(ValueError):
    """The layer uses something this engine does not measure (for example clear polarity)."""


def load_gerber(name: str, data: bytes) -> GerberFile:
    text = data.decode("latin1")
    # Gerbonara tolerates garbage (it warns and returns an empty layer). A layer without its format statement is not
    # RS-274X, and an empty drawing must never stand in for it.
    if "%FS" not in text[:8192]:
        raise UnsupportedGerber(f"{name}: has no Gerber format statement (%FS), so it is not a Gerber layer")
    try:
        return GerberFile.from_string(text, filename=name)
    except Exception as error:  # Gerbonara raises assorted parse errors; the caller reports one rejection
        raise UnsupportedGerber(f"{name}: could not be read as a Gerber layer ({type(error).__name__})") from error


def to_mm(value: float, unit) -> float:
    """A length in the given Gerbonara unit, in millimetres."""
    return unit.convert_to("mm", value)
