"""A workbook is measured from its zip central directory before openpyxl inflates anything (parsers/tabular.py)."""
from __future__ import annotations

import io
import struct
import zipfile

import pytest
from openpyxl import Workbook

from parsers import tabular


def _workbook() -> bytes:
    book = Workbook()
    sheet = book.active
    sheet.append(["Designator", "Comment"])
    sheet.append(["R1", "10k"])
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def _zip(entries: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return out.getvalue()


def _share_first_entry(data: bytes) -> bytes:
    """Point the second central record at the first entry's local header, copying its method and sizes (a crafted bomb)."""
    buf = bytearray(data)
    eocd = len(buf) - 22
    directory = struct.unpack_from("<I", buf, eocd + 16)[0]
    first_name_len = struct.unpack_from("<H", buf, directory + 28)[0]
    second = directory + 46 + first_name_len
    for start, end in [(10, 12), (14, 28), (42, 46)]:
        buf[second + start : second + end] = buf[directory + start : directory + end]
    return bytes(buf)


def test_a_real_workbook_is_read() -> None:
    table = tabular.read_sheet_table(_workbook())
    assert table.headers == ["Designator", "Comment"]
    assert table.rows == [{"Designator": "R1", "Comment": "10k"}]


def test_a_part_that_inflates_past_the_budget_is_refused_before_loading() -> None:
    bomb = _zip({"[Content_Types].xml": b"<Types/>", "xl/media/a.bin": bytes(60 * 1024 * 1024)})
    assert len(bomb) < 200 * 1024
    with pytest.raises(ValueError, match="allowed size"):
        tabular.read_sheet_table(bomb)


def test_an_implausible_compression_ratio_is_refused() -> None:
    with pytest.raises(ValueError, match="ratio"):
        tabular.check_workbook_archive(_zip({"xl/a.xml": bytes(5 * 1024 * 1024)}))


def test_records_sharing_one_local_header_are_refused() -> None:
    shared = _share_first_entry(_zip({"a.xml": b"x" * 100, "b.xml": b"y" * 100}))
    with pytest.raises(ValueError, match="overlap"):
        tabular.check_workbook_archive(shared)


def test_too_many_parts_are_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tabular, "XLSX_MAX_ENTRIES", 2)
    with pytest.raises(ValueError, match="more than 2 parts"):
        tabular.check_workbook_archive(_zip({"a": b"1", "b": b"2", "c": b"3"}))


def test_something_that_is_not_a_zip_is_unreadable() -> None:
    with pytest.raises(ValueError, match="not a readable zip"):
        tabular.read_sheet_table(b"Designator,Comment\nR1,10k\n")
