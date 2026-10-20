"""Tabular customer files (Pick Place CSV or workbook, BOM workbook) as header + rows.

The header row is found, not assumed: Altium Pick Place CSVs carry a dozen lines of design information
before it, and they are GBK encoded rather than UTF-8.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field

from openpyxl import load_workbook

ENCODINGS = ("utf-8-sig", "gbk")


@dataclass
class Table:
    headers: list[str]
    rows: list[dict[str, str]]
    preamble: list[str] = field(default_factory=list)


def _decode(data: bytes) -> str:
    for encoding in ENCODINGS:
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("file is neither UTF-8 nor GBK text")


def read_csv_table(data: bytes, header_marker: str) -> Table:
    """The table starts at the first line whose first cell equals `header_marker`."""
    lines = _decode(data).splitlines()
    start = next((i for i, line in enumerate(lines) if (next(csv.reader([line]), None) or [""])[0] == header_marker), None)
    if start is None:
        raise ValueError(f"no header row starting with {header_marker!r}")
    reader = csv.DictReader(io.StringIO("\n".join(lines[start:])))
    rows = [{k: (v or "").strip() for k, v in row.items() if k is not None} for row in reader]
    return Table(headers=list(reader.fieldnames or []), rows=rows, preamble=lines[:start])


def read_sheet_table(data: bytes, header_marker: str | None = None, sheet: str | None = None) -> Table:
    """header_marker None: the header is the first non-empty row."""
    book = load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    worksheet = book[sheet] if sheet else book.worksheets[0]
    cells = [["" if c is None else str(c).strip() for c in row] for row in worksheet.iter_rows(values_only=True)]
    start = next((i for i, row in enumerate(cells) if any(row) and (header_marker is None or row[0] == header_marker)), None)
    if start is None:
        raise ValueError(f"no header row starting with {header_marker!r}")
    headers = cells[start]
    rows = [dict(zip(headers, row)) for row in cells[start + 1 :] if any(row)]
    return Table(headers=headers, rows=rows, preamble=[" ".join(r) for r in cells[:start]])
