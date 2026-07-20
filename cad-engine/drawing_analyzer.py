"""
Drawing Analysis Service  —  POST /drawing/analyze

Pure library extraction — no AI, no API calls, no network required.

Strategy:
  1. PyMuPDF "blocks" mode: each text block with (x,y) coordinates.
  2. Title-block key-value pairs resolved by spatial proximity.
     Correctly handles SolidWorks/AutoCAD PDF title blocks where:
       - Label and value cells share a border (x can overlap slightly)
       - Multi-line value cells (take first line as primary value)
       - Label cells must be excluded from value candidates
  3. Flat-text regex catches anything spatial matching misses.
  4. Placeholder detection ("X.XX", "TBD", dashes) → "Not specified".
"""

from __future__ import annotations

import base64
import logging
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Known title-block labels ─────────────────────────────────────────────────
# Used both to FIND label cells AND to EXCLUDE them from being selected as values.

_LABEL_KEYS: dict[str, re.Pattern] = {
    "material":   re.compile(r"^MATER(?:IAL)?$|^MATL$|^MAT$", re.I),
    "revision":   re.compile(r"^REV(?:ISION)?$|^ISSUE$|^REV\.$", re.I),
    "thickness":  re.compile(r"^(?:SHEET\s+)?THI?C?K(?:NESS)?$|^THK$", re.I),
    "tolerance":  re.compile(r"^(?:GENERAL\s+)?TOL(?:ERANCE)?$|^G\.TOL$", re.I),
    "finish":     re.compile(r"^SURFACE\s+FINISH$|^FINISH$|^Ra$", re.I),
    "coating":    re.compile(r"^SURFACE\s+TREAT(?:MENT)?$|^COATING$|^PLATING$", re.I),
    "treatment":  re.compile(r"^HEAT\s+TREAT(?:MENT)?$|^HT$", re.I),
    "drawing_no": re.compile(
        r"^(?:DRG|DWG|DOC)\.?\s*NO\.?$|^PART\s*NO\.?$|^DRAWING\s*NO\.?$", re.I
    ),
    "size":       re.compile(r"^SIZE$", re.I),
    "scale":      re.compile(r"^SCALE$", re.I),
    "date":       re.compile(r"^DATE$|^DRAWN\s*DATE$", re.I),
    "drawn":      re.compile(r"^DRAWN$|^CHECKED$|^APPROVED$", re.I),
    "title":      re.compile(r"^TITLE[:\s]*$|^DESCRIPTION$|^PART\s+NAME$", re.I),
    "name":       re.compile(r"^NAME$|^DATE$", re.I),
}

# All known labels combined — used to exclude label blocks from value candidates
_ALL_LABEL_RE = re.compile(
    r"""^(?:
        MATER(?:IAL)?|MATL?                          |
        REV(?:ISION)?|ISSUE                           |
        THI?C?K(?:NESS)?|THK                          |
        (?:GENERAL\s+)?TOL(?:ERANCE)?|G\.TOL          |
        (?:SURFACE\s+)?FINISH|Ra                       |
        (?:SURFACE\s+)?(?:COATING|PLATING|TREAT(?:MENT)?) |
        (?:HEAT\s+)?TREAT(?:MENT)?|HT                 |
        (?:DRG|DWG|DOC)\.?\s*NO\.?                    |
        (?:PART|DRAWING)\s*NO\.?                       |
        SCALE|DATE|DRAWN|CHECKED|APPROVED              |
        TITLE|DESCRIPTION|PART\s+NAME                  |
        WEIGHT|SHEET|PROJ(?:ECT)?                      |
        SIZE|NAME                                      |
        DO\s+NOT\s+SCALE|UNLESS\s+OTHERWISE           |
        DIMENSIONS|PROPRIETARY|UNLESS
    )\.?$""",
    re.IGNORECASE | re.VERBOSE,
)


def _is_label(text: str) -> bool:
    return bool(_ALL_LABEL_RE.match(text.replace("\n", " ").strip()))


# ─── Placeholder guard ────────────────────────────────────────────────────────

_PLACEHOLDER = re.compile(
    r"""^(?:
        [X#\-\s\.]+    |
        X+\.X+         |
        0+\.0+         |
        N/?A           |
        NONE           |
        TBD|TBC|TBR    |
        \?+            |
        SPECIFY        |
        AS\s+PER\s+\w+
    )$""",
    re.IGNORECASE | re.VERBOSE,
)

def _is_placeholder(s: str) -> bool:
    return bool(_PLACEHOLDER.match(s.strip())) if s else True


# ─── Material grade normalization ─────────────────────────────────────────────

_AL_WROUGHT = {
    "1100","2014","2024","3003","5052","5083","5754",
    "6060","6061","6063","6082","7050","7075",
}

def _fix_ocr(s: str) -> str:
    s = re.sub(r"(?<=\d)[IL]", "1", s)
    s = re.sub(r"[IL](?=\d{2})", "1", s)
    s = re.sub(r"(?<=\d)O(?=\d|$)", "0", s)
    return s

def _normalize_material(raw: str | None) -> str | None:
    if not raw:
        return None
    up = _fix_ocr(raw.upper().strip())
    if not up or _is_placeholder(up):
        return None
    # Aluminum alloy: 6061-T6, AA7075-T651, Al2024
    al = re.search(r"(?:AA|AL(?:UMINI?UM)?)?[\s\-]*(\d{4})[\s\-]*(T\d{1,3}\d*|H\d{2})?", up)
    if al and al.group(1) in _AL_WROUGHT:
        temper = f"-{al.group(2)}" if al.group(2) else ""
        return f"AA{al.group(1)}{temper}"
    # Stainless: SS316L, AISI 304, 316L
    ss = re.search(r"(?:SS|AISI|STAINLESS(?:\s+STEEL)?)[\s\-]*(\d{3}L?)", up)
    if ss:
        return f"SS{ss.group(1)}"
    return raw.strip()


# ─── PDF extraction ───────────────────────────────────────────────────────────

class _Block:
    __slots__ = ("x0", "y0", "x1", "y1", "text", "first_line")
    def __init__(self, x0: float, y0: float, x1: float, y1: float, text: str):
        self.x0, self.y0, self.x1, self.y1, self.text = x0, y0, x1, y1, text
        self.first_line = text.split("\n")[0].strip()

def _extract_blocks(pdf_bytes: bytes) -> tuple[list[_Block], str]:
    try:
        import fitz
    except ImportError:
        raise HTTPException(500, "PyMuPDF not installed — run: pip install PyMuPDF")

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    if doc.page_count == 0:
        raise HTTPException(422, "PDF has no pages")

    all_blocks: list[_Block] = []
    flat_parts: list[str] = []

    for i, page in enumerate(doc):
        raw_blocks = page.get_text("blocks")
        for b in raw_blocks:
            if b[6] != 0:
                continue
            txt = b[4].strip()
            if txt:
                all_blocks.append(_Block(b[0], b[1], b[2], b[3], txt))
                flat_parts.append(txt)
        if i >= 1:
            break

    doc.close()
    flat = "\n".join(flat_parts)
    logger.info("PDF extracted: %d blocks, %d chars", len(all_blocks), len(flat))
    return all_blocks, flat


# ─── Spatial title-block matching ─────────────────────────────────────────────

def _nearest_value(label: _Block, candidates: list[_Block]) -> _Block | None:
    """
    Find the value block nearest to a label block.

    Key rules for CAD title blocks (tested against SolidWorks PDF output):
    - Value cell may START inside the label's x-range (shared border).
      Use label.x0 as the left boundary, not label.x1.
    - Value cell y0 may be slightly above label.y1 (cells overlap by a few px).
    - Must skip any block whose text is itself a known label.
    """
    h = max(label.y1 - label.y0, 8.0)
    best: _Block | None = None
    best_dist = float("inf")

    for c in candidates:
        # Never pick another label cell as a value
        if _is_label(c.first_line):
            continue

        # x: candidate must start at or after label's left edge
        if c.x0 < label.x0 - 5:
            continue
        # x: candidate must not be entirely to the left
        if c.x1 < label.x0:
            continue

        # y: candidate must be within the label row or up to 4 line-heights below
        y_diff = c.y0 - label.y0
        if y_diff < -h * 0.8 or y_diff > h * 5:
            continue

        # Distance: prefer right-of-label on same row, then below
        dx = max(0.0, c.x0 - label.x1)
        dy = max(0.0, c.y0 - label.y1)
        dist = dx + dy * 1.5

        if dist < best_dist:
            best_dist = dist
            best = c

    return best


def _extract_title_block(blocks: list[_Block]) -> dict[str, str]:
    pairs: dict[str, str] = {}
    used: set[int] = set()

    for i, blk in enumerate(blocks):
        single = blk.first_line
        for key, pat in _LABEL_KEYS.items():
            if key in pairs:
                continue
            if pat.match(single):
                non_used = [b for j, b in enumerate(blocks) if j != i and j not in used]
                val = _nearest_value(blk, non_used)
                if val:
                    idx = next(j for j, b in enumerate(blocks) if b is val)
                    used.add(idx)
                    # Take only first line — avoids "6061-T6\nA" picking up stray "A"
                    pairs[key] = val.first_line
                break
    return pairs


# ─── Regex helpers ────────────────────────────────────────────────────────────

def _find(pattern: str, text: str, flags: int = re.IGNORECASE) -> str | None:
    m = re.search(pattern, text, flags)
    return m.group(1).strip() if m else None

def _find_float(pattern: str, text: str) -> float | None:
    m = re.search(pattern, text, re.IGNORECASE)
    try:
        return float(m.group(1)) if m else None
    except (ValueError, TypeError):
        return None


# ─── Field extractors ─────────────────────────────────────────────────────────

def _extract_material(tb: dict[str, str], flat: str) -> tuple[str, float]:
    # 1) Title block (highest confidence)
    raw = tb.get("material", "")
    if raw and not _is_placeholder(raw) and not _is_label(raw):
        norm = _normalize_material(raw)
        if norm:
            return norm, 0.92

    # 2) Inline "MATERIAL: ..." in flat text
    for pat in (
        r"(?:MATERIAL|MATL|MAT)[:\s\-–]+([A-Z0-9][A-Z0-9 /\.\-]{1,30})",
        r"(?:SHEET\s+)?MATERIAL[:\s\-–]+([A-Z0-9][A-Z0-9 /\.\-]{1,30})",
    ):
        raw2 = _find(pat, flat)
        if raw2 and not _is_placeholder(raw2):
            raw2 = re.split(r'\s{2,}|\t|\n', raw2)[0].strip()
            norm = _normalize_material(raw2)
            if norm:
                return norm, 0.85

    # 3) Bare aluminum temper designation anywhere in text (e.g. "6061-T6")
    al_m = re.search(r"\b(\d{4}[\s\-]T\d{1,3}\d*)\b", flat)
    if al_m:
        norm = _normalize_material(al_m.group(1))
        if norm:
            return norm, 0.80

    # 4) Known grade keywords
    m = re.search(
        r"\b(AA\d{4}(?:[\/\-]T\d{1,2})?|SS\d{3}L?|CRCA|DC01|DC03|"
        r"EN8|EN24|EN31|IS2062|MILD\s+STEEL|STAINLESS\s+STEEL|ALUMIN(?:I|U)UM)\b",
        flat, re.IGNORECASE,
    )
    if m:
        norm = _normalize_material(m.group(1))
        if norm:
            return norm, 0.65

    return "Not specified", 0.0


def _extract_drawing_number(tb: dict[str, str], flat: str, part_hint: str | None) -> str:
    raw = tb.get("drawing_no", "")
    if raw:
        return raw.strip()
    if part_hint:
        return part_hint.strip()
    m = re.search(r"\b([A-Z]{2,6}-\d{3,6}-[A-Z0-9]{1,2})\b", flat)
    return m.group(1) if m else ""


def _extract_revision(tb: dict[str, str], flat: str, drawing_no: str) -> str:
    raw = tb.get("revision", "")
    if raw and not _is_placeholder(raw) and not _is_label(raw):
        # Direct single letter/number
        if re.match(r"^[A-Z0-9]{1,2}$", raw.strip(), re.I):
            return raw.strip().upper()
        # Drawing number format: RMP-00030-A → "A"
        m = re.match(r"[A-Z\d]+-\d+-([A-Z0-9]{1,2})$", raw.strip(), re.I)
        if m:
            return m.group(1).upper()

    # Infer from drawing number
    dn = drawing_no or tb.get("drawing_no", "")
    if dn:
        m2 = re.search(r"[A-Z\d]{2,}-\d{3,}-([A-Z0-9]{1,2})(?:\b|$)", dn, re.I)
        if m2:
            return m2.group(1).upper()

    # Flat text "REV A" (single char only)
    rev = _find(r"REV(?:ISION)?[\s.:]+([A-Z0-9]{1,2})\b", flat)
    if rev and not _is_placeholder(rev):
        return rev.upper()

    # Last resort: drawing number in flat text
    m3 = re.search(r"\b[A-Z]{2,6}-\d{3,6}-([A-Z0-9]{1,2})\b", flat)
    return m3.group(1).upper() if m3 else ""


def _extract_sheet_thickness(tb: dict[str, str], flat: str) -> tuple[float, float]:
    raw = tb.get("thickness", "")
    if raw and not _is_placeholder(raw):
        m = re.search(r"(\d+(?:\.\d+)?)", raw)
        if m:
            v = float(m.group(1))
            if 0.3 <= v <= 25.0:
                return v, 0.95
    patterns = [
        (r"(?:SHEET\s+)?(?:THICKNESS|THK(?:NS)?)[:\s\-–]+(\d+(?:\.\d+)?)\s*(?:MM)?", 0.90),
        (r"\bt\s*=\s*(\d+(?:\.\d+)?)\s*(?:MM)?", 0.85),
        (r"(\d+(?:\.\d+)?)\s*MM\s+(?:CRCA|MS|STEEL|SS|AA|ALUMINUM)", 0.80),
    ]
    for pat, conf in patterns:
        v = _find_float(pat, flat)
        if v and 0.3 <= v <= 25.0:
            return v, conf
    return 0.0, 0.0


def _extract_tolerance(tb: dict[str, str], flat: str) -> tuple[float, float]:
    raw = tb.get("tolerance", "")
    if raw and not _is_placeholder(raw):
        m = re.search(r"[±]\s*(\d+(?:\.\d+)?)", raw)
        if m:
            return float(m.group(1)), 0.90
    vals: list[tuple[float, float]] = []
    for m in re.finditer(r"[±Ø⊕◎⊙]\s*(\d+\.\d+)", flat):
        try:
            vals.append((float(m.group(1)), 0.85))
        except ValueError:
            pass
    for m in re.finditer(r"±\s*(\d+(?:\.\d+)?)", flat):
        try:
            vals.append((float(m.group(1)), 0.80))
        except ValueError:
            pass
    if vals:
        best = min(vals, key=lambda x: x[0])
        return best[0], best[1]
    if re.search(r"ISO\s*2768[\s\-]*[fm]|DIN\s*ISO\s*2768", flat, re.I):
        return 0.1, 0.50
    return 0.0, 0.0


def _extract_surface_finish(tb: dict[str, str], flat: str) -> tuple[float, float]:
    raw = tb.get("finish", "")
    if raw and not _is_placeholder(raw):
        m = re.search(r"(\d+(?:\.\d+)?)", raw)
        if m:
            return float(m.group(1)), 0.90
    # Handles both "Ra 1.6" and "1.6um Ra" and "1.6 Ra" formats
    m = re.search(
        r"Ra\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:µm|um|μm)?\s*Ra",
        flat, re.I,
    )
    if m:
        try:
            return float(m.group(1) or m.group(2)), 0.90
        except (ValueError, TypeError):
            pass
    return 0.0, 0.0


def _extract_coating(tb: dict[str, str], flat: str) -> str:
    raw = tb.get("coating", "")
    if raw and not _is_placeholder(raw) and not _is_label(raw):
        return raw.strip()
    # Priority: hardcoat anodize (aerospace/industrial standard)
    if re.search(r"TYPE\s+III\s+HARDCOAT|HARD\s+ANODIZ", flat, re.I):
        return "Type III Hardcoat Anodizing"
    if re.search(r"TYPE\s+II\s+ANODIZ", flat, re.I):
        return "Type II Anodizing"
    coatings = [
        "ZINC PLATED","ZINC PHOSPHATE","HOT DIP GALVANIZED","GALVANIZED",
        "POWDER COAT","POWDER COATED","ANODIZED","ANODISE",
        "CHROME PLATED","NICKEL PLATED","ELECTROLESS NICKEL",
        "PAINT","E-COAT","ELECTROCOAT","BLACK OXIDE","PASSIVATION","DACROMET",
    ]
    up = flat.upper()
    for c in coatings:
        if c in up:
            return c.title()
    return "None"


def _extract_heat_treatment(tb: dict[str, str], flat: str) -> str:
    raw = tb.get("treatment", "")
    if raw and not _is_placeholder(raw) and not _is_label(raw):
        return raw.strip()
    treatments = [
        "CASE HARDENED","THROUGH HARDENED","HARDENED",
        "ANNEALED","NORMALIZED","NORMALISED",
        "QUENCH","TEMPERED","STRESS RELIEVED","CARBURIZED","NITRIDED",
    ]
    up = flat.upper()
    for t in treatments:
        if t in up:
            return t.title()
    return "None"


def _extract_general_tolerance(tb: dict[str, str], flat: str) -> str:
    raw = tb.get("tolerance", "")
    if raw and not _is_placeholder(raw) and re.search(r"ISO|DIN|ASME", raw, re.I):
        return raw.strip()
    m = re.search(
        r"(ISO\s*2768[\s\-]*[a-zA-Z]{1,3}|DIN\s*ISO\s*2768[\s\-]*[a-zA-Z]{1,3}|ASME\s*Y14\.5[\s\-]*\d{4})",
        flat, re.I,
    )
    return m.group(1).strip() if m else ""


def _extract_dimensions(flat: str) -> dict[str, float]:
    m = re.search(r"(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)", flat)
    if m:
        vals = sorted([float(m.group(i)) for i in (1, 2, 3)], reverse=True)
        return {"L": vals[0], "W": vals[1], "H": vals[2]}
    return {"L": 0, "W": 0, "H": 0}


def _extract_threads(flat: str) -> list[dict]:
    """
    Detect both metric (M4×0.7) and imperial UNC/UNF (3/8-16, #8-32) thread callouts.
    Format on drawings: [count ×] <size> [Tapped Thru / Tapped Blind / UNC/UNF]
    De-duplication key is the full size string so M4 and 3/8-16 are independent.
    """
    results: list[dict] = []
    seen: set[str] = set()

    # ── Metric: 2 × M4 × 0.7, M6x1.0, M10 ──────────────────────────────────
    for m in re.finditer(
        r"(?:(\d+)\s*[xX×]\s*)?M(\d+(?:\.\d+)?)(?:\s*[xX×]\s*(\d+(?:\.\d+)?))?",
        flat, re.I,
    ):
        size_str = f"M{m.group(2)}"
        if size_str in seen:
            continue
        seen.add(size_str)
        try:
            count = int(m.group(1)) if m.group(1) else 1
            pitch = float(m.group(3)) if m.group(3) else _default_pitch(float(m.group(2)))
            results.append({
                "size": size_str, "pitch": pitch, "count": count,
                "standard": "metric",
                "extractionConfidence": 0.85,
                "extractionSource": "drawing_text",
            })
        except (ValueError, TypeError):
            pass

    # ── Imperial UNC/UNF: 1 × 3/8-16, #8-32, 1/4-20 ────────────────────────
    # Pattern: optional [count ×] then  (#N  or  N/D)  then  -TPI
    # TPI guard (4–80) avoids false positives from page numbers or dates.
    for m in re.finditer(
        r"(?:(\d+)\s*[xX×]\s*)?(?:#(\d{1,2})|(\d{1,2})/(\d{1,2}))-(\d{1,3})\b",
        flat, re.I,
    ):
        count_s, num_dia, fn, fd, tpi_s = (
            m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        )
        try:
            tpi = int(tpi_s)
            if not (4 <= tpi <= 80):
                continue
            if num_dia is not None:
                size_str = f"#{num_dia}-{tpi}"
            else:
                # Sanity: denominator must be a valid fraction (2,4,8,16,32,64)
                if int(fd) not in (2, 4, 8, 16, 32, 64):
                    continue
                size_str = f"{fn}/{fd}-{tpi}"
            if size_str in seen:
                continue
            seen.add(size_str)
            count = int(count_s) if count_s else 1
            results.append({
                "size": size_str,
                "tpi": tpi,
                "count": count,
                "standard": "imperial",
                "extractionConfidence": 0.85,
                "extractionSource": "drawing_text",
            })
        except (ValueError, TypeError):
            pass

    return results


def _default_pitch(d: float) -> float:
    table = {3:0.5, 4:0.7, 5:0.8, 6:1.0, 8:1.25, 10:1.5, 12:1.75, 16:2.0, 20:2.5, 24:3.0}
    return table.get(int(d), 1.0)


def _extract_bend_count(flat: str) -> int:
    m = re.search(r"(\d+)\s*(?:BENDS?|FOLDS?)", flat, re.I)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            pass
    return len(re.findall(r"\bBEND\s+(?:UP|DOWN|INWARD|OUTWARD|LINE)\b", flat, re.I))


def _extract_process(flat: str, thickness: float, material: str) -> str:
    up = flat.upper()
    if any(k in up for k in ("LASER CUT","PRESS BRAKE","PUNCH","BLANK")):
        return "Sheet Metal Laser Cutting"
    if "INJECTION MOULD" in up or "INJECTION MOLD" in up:
        return "Injection Moulding"
    if "DIE CAST" in up or "DIECASTING" in up:
        return "Die Casting"
    if "CAST" in up and "BROADCAST" not in up:
        return "Sand Casting"
    if "TURN" in up or "LATHE" in up:
        return "CNC Turning"
    # Sheet metal if explicit sheet or thin material
    if any(k in up for k in ("CRCA","SHEET METAL")):
        return "Sheet Metal Fabrication"
    if thickness > 0 and thickness < 6.0:
        return "Sheet Metal Fabrication"
    # Default to machining (catches aluminum billet, etc.)
    return "CNC Machining"


def _extract_notes(flat: str) -> str:
    m = re.search(r"NOTES?[:\s]*\n([\s\S]{10,400}?)(?:\n{2,}|\Z)", flat, re.I)
    return m.group(1).strip()[:300] if m else ""


# ─── Fallback ─────────────────────────────────────────────────────────────────

_FALLBACK: dict[str, Any] = {
    "material": "Not specified", "material_confidence": 0.0,
    "process": "Not specified",
    "dimensions_mm": {"L": 0, "W": 0, "H": 0},
    "tightest_tolerance_mm": 0, "tolerance_confidence": 0.0,
    "surface_finish_ra": 0, "surface_finish_confidence": 0.0,
    "sheet_thickness_mm": 0, "sheet_thickness_confidence": 0.0,
    "bend_count": 0,
    "heat_treatment": "None", "coating": "None",
    "complexity": "medium",
    "threads": [], "gdt_callouts": [], "clearanceHoles": [],
    "general_tolerances": "",
    "drawing_revision": "", "drawing_number": "",
    "drawing_notes": "",
    "drawing_intelligence_confidence": 0.0,
}


# ─── Request / endpoint ───────────────────────────────────────────────────────

class AnalyzeDrawingRequest(BaseModel):
    imageBase64: str
    mediaType: str = "image/png"
    partNumber: str | None = None


@router.post("/analyze")
async def analyze_drawing(body: AnalyzeDrawingRequest) -> dict[str, Any]:
    if body.mediaType != "application/pdf":
        result = dict(_FALLBACK)
        result["drawing_notes"] = (
            "Image drawings require OCR. Upload as a vector PDF "
            "exported from your CAD system for automatic field extraction."
        )
        result["analyzedAt"] = datetime.now(timezone.utc).isoformat()
        return result

    try:
        pdf_bytes = base64.b64decode(body.imageBase64)
        blocks, flat = _extract_blocks(pdf_bytes)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("PDF extraction failed")
        raise HTTPException(422, f"PDF extraction failed: {exc}") from exc

    if not flat.strip():
        result = dict(_FALLBACK)
        result["drawing_notes"] = (
            "No text found — this PDF appears to be scanned/rasterized. "
            "Export from your CAD system as a vector PDF for text extraction."
        )
        result["analyzedAt"] = datetime.now(timezone.utc).isoformat()
        return result

    # Pass 1 — spatial title block key-value matching
    tb = _extract_title_block(blocks)
    logger.debug("Title block pairs: %s", tb)

    drawing_no = _extract_drawing_number(tb, flat, body.partNumber)
    material, mat_conf     = _extract_material(tb, flat)
    sheet_thick, thick_conf = _extract_sheet_thickness(tb, flat)
    tolerance, tol_conf    = _extract_tolerance(tb, flat)
    surface_ra, ra_conf    = _extract_surface_finish(tb, flat)
    revision               = _extract_revision(tb, flat, drawing_no)
    coating                = _extract_coating(tb, flat)

    found = sum([mat_conf > 0, sheet_thick > 0, tolerance > 0, surface_ra > 0, bool(revision)])
    intelligence = round(min(1.0, found / 4), 2)

    result: dict[str, Any] = {
        "material":                    material,
        "material_confidence":         round(mat_conf, 2),
        "process":                     _extract_process(flat, sheet_thick, material),
        "dimensions_mm":               _extract_dimensions(flat),
        "tightest_tolerance_mm":       tolerance,
        "tolerance_confidence":        round(tol_conf, 2),
        "surface_finish_ra":           surface_ra,
        "surface_finish_confidence":   round(ra_conf, 2),
        "sheet_thickness_mm":          sheet_thick,
        "sheet_thickness_confidence":  round(thick_conf, 2),
        "bend_count":                  _extract_bend_count(flat),
        "heat_treatment":              _extract_heat_treatment(tb, flat),
        "coating":                     coating,
        "complexity":                  "medium",
        "threads":                     _extract_threads(flat),
        "gdt_callouts":                [],
        "clearanceHoles":              [],
        "general_tolerances":          _extract_general_tolerance(tb, flat),
        "drawing_revision":            revision,
        "drawing_number":              drawing_no,
        "drawing_notes":               _extract_notes(flat),
        "drawing_intelligence_confidence": intelligence,
        "analyzedAt":                  datetime.now(timezone.utc).isoformat(),
    }

    logger.info(
        "Drawing parsed: no=%s rev=%s material=%s(%.2f) thk=%.1f tol=%.3f "
        "ra=%.1f coating=%s threads=%d tb_keys=%s",
        drawing_no, revision, material, mat_conf,
        sheet_thick, tolerance, surface_ra, coating,
        len(result["threads"]), list(tb.keys()),
    )
    return result
