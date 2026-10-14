"""
Typed engineering records from a STEP's PMI: one record per annotation, from the best source available.

  1. NATIVE semantic PMI (DIMENSIONAL_SIZE + PLUS_MINUS_TOLERANCE, geometric tolerance entities):
     authoritative. validation.status 'verified'.
  2. DECODED graphics (shared/pmi_glyphs.py): only for what has no native value: a Width callout's
     tolerance, the datum references of a frame, a frame that has no entity. Always flagged: it is never
     'verified' and never automation-ready until a person confirms it.
        'decoded_cross_checked'  every glyph recognised, orientation unambiguous, and an independent value
                                 agrees (the callout's own label for the nominal; the native zone for a frame)
        'decoded_unverified'     every glyph recognised but nothing independent to compare with
  3. Anything else is 'unresolved' with the reason; the original graphics stay the only source.
  'conflict': native and decoded disagree. The native value is kept, the record is not automation-ready.

`automation_ready` is true ONLY for verified native values: no decoded value drives costing or a
manufacturing decision.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Callable, Dict, List, Optional, Sequence

from shared.pmi_glyph_library import default_templates
from shared.pmi_glyphs import decode_callout
from shared.pmi_text import parse_datum_text, parse_dimension_text, parse_frame_text

SAME_SIZE_MM = 0.005
CHARACTERISTICS = {
    "position": "position", "flatness": "flatness", "cylindricity": "cylindricity", "perpendicularity": "perpendicularity",
    "parallelism": "parallelism", "angularity": "angularity", "circularity": "circularity", "roundness": "circularity",
    "straightness": "straightness", "concentricity": "concentricity", "coaxiality": "coaxiality", "symmetry": "symmetry",
    "surfaceprofile": "profile_of_surface", "lineprofile": "profile_of_line",
    "circularrunout": "circular_runout", "totalrunout": "total_runout",
}
_LABEL_KIND = re.compile(r"^([A-Za-z]+)\d*@")
_LABEL_VALUE = re.compile(r"\((-?[\d.]+)\)(?:-\d+)?$")


def _digest(payload: Any) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf8")).hexdigest()


def record_fingerprint(rec: Dict[str, Any]) -> str:
    """
    What an engineer's approval is bound to: the annotation, the values it states, how they were obtained and
    which model faces they are tied to. Any change to one of these changes the fingerprint, so an approval
    given to the old content can never be read as an approval of the new (the backend and the database compare
    it at approval time and at read time). The STEP file itself is bound separately (pmi.source.file_sha256).
    """
    decode = (rec.get("provenance") or {}).get("decode") or {}
    return _digest({
        "annotation_ref": rec.get("annotation_ref"), "record_type": rec.get("record_type"),
        "dimension_type": rec.get("dimension_type"), "characteristic": rec.get("characteristic"),
        "nominal": rec.get("nominal"), "tolerance": rec.get("tolerance"), "zone": rec.get("zone"),
        "datum_refs": rec.get("datum_refs"), "letter": rec.get("letter"), "source": rec.get("source"),
        "status": (rec.get("validation") or {}).get("status"), "decoded_text": decode.get("text"),
        "face_ids": (rec.get("feature_ref") or {}).get("face_ids"),
    })


def datum_refs_fingerprint(rec: Dict[str, Any]) -> str:
    """The same, for the datum references of a frame whose zone is native: a separate reviewable claim."""
    decode = (rec.get("provenance") or {}).get("decode") or {}
    return _digest({
        "annotation_ref": rec.get("annotation_ref"), "zone": rec.get("zone"), "datum_refs": rec.get("datum_refs"),
        "decoded_text": decode.get("text"), "face_ids": (rec.get("feature_ref") or {}).get("face_ids"),
    })


def _dimension_type(kind: Optional[str]) -> str:
    k = (kind or "").strip().lower().replace(" ", "_")
    return {"distancebetween": "distance"}.get(k, k or "unknown")


def _limits(nominal: float, lower: Optional[float], upper: Optional[float]) -> Optional[Dict[str, float]]:
    if lower is None or upper is None:
        return None
    return {"lower_mm": round(lower, 6), "upper_mm": round(upper, 6),
            "min_mm": round(nominal + lower, 6), "max_mm": round(nominal + upper, 6)}


def _within(a: float, b: float, decimals: int) -> bool:
    return abs(a - b) <= 0.5 * 10 ** (-decimals) + 1e-9


def _label_nominal(label: Optional[str]):
    m = _LABEL_VALUE.search(label or "")
    if not m:
        return None, 0
    text = m.group(1)
    return float(text), len(text.split(".")[1]) if "." in text else 0


class _Decoder:
    """Decodes a callout once, on demand."""

    def __init__(self, graphics: Sequence[Dict[str, Any]], templates):
        self._by_name = {g["callout"]: g for g in graphics}
        self._templates = templates
        self._cache: Dict[str, Optional[Dict[str, Any]]] = {}

    def has(self, callout: Optional[str]) -> bool:
        return callout in self._by_name

    def decode(self, callout: Optional[str]) -> Optional[Dict[str, Any]]:
        if callout is None or callout not in self._by_name:
            return None
        if callout not in self._cache:
            g = self._by_name[callout]
            counts = g.get("glyph_triangle_counts") or []
            self._cache[callout] = decode_callout(g["triangles"], counts, self._templates) if counts else None
        return self._cache[callout]


def _trace(d: Dict[str, Any]) -> Dict[str, Any]:
    return {"text": d["text"], "min_glyph_iou": d["min_iou"], "min_glyph_margin": d["min_margin"],
            "ignored_glyphs": d.get("ignored_glyphs", 0), "resolved": d["resolved"],
            "ambiguous_orientation": bool(d.get("ambiguous_orientation"))}


def _readable(d: Optional[Dict[str, Any]]) -> Optional[str]:
    """None when the decode can be used; otherwise why not."""
    if d is None:
        return "no drawn text to decode"
    if d.get("ambiguous_orientation"):
        return "the text reads differently in two orientations"
    if not d["resolved"]:
        return f"{d['text']!r} contains a glyph that was not recognised"
    return None


def _validation(status: str, reasons: List[str], checks: List[str]) -> Dict[str, Any]:
    return {"status": status, "automation_ready": status == "verified", "requires_review": status != "verified",
            "checks": checks, "reasons": reasons}


# ── Dimensions ───────────────────────────────────────────────────────────────

def _native_dimension(item: Dict[str, Any], dec: _Decoder) -> Dict[str, Any]:
    nominal = item["nominal_mm"]
    tol = _limits(nominal, item.get("lower_mm"), item.get("upper_mm"))
    record: Dict[str, Any] = {
        "id": f"pmi:{item.get('label') or item['id']}", "annotation_ref": item.get("label"),
        "record_type": "dimension", "dimension_type": _dimension_type(item.get("dimension_kind")),
        "nominal": {"value": nominal, "unit": "mm"}, "tolerance": tol, "basic": bool(item.get("basic")),
        "cad_feature": item.get("cad_feature"), "source": "native_pmi",
        "provenance": {"entities": ["DIMENSIONAL_SIZE"] + (["PLUS_MINUS_TOLERANCE"] if tol else [])},
    }
    checks = ["native semantic entities"]
    status, reasons = "verified", []
    d = dec.decode(item.get("label"))
    why = _readable(d) if d is not None else None
    if d is not None and why is None:
        p = parse_dimension_text(d["text"])
        if p["ok"]:
            nominal_ok = _within(p["nominal"], nominal, p["nominal_decimals"])
            tol_ok = True
            if tol and p["tolerance"] is not None:
                tol_ok = abs(p["tolerance"] - tol["upper_mm"]) <= 1e-6 + 0.5 * 10 ** (-3) and abs(tol["upper_mm"] + tol["lower_mm"]) < 1e-9
            elif tol and p["tolerance"] is None:
                tol_ok = False
            elif not tol and p["tolerance"] is not None and not item.get("basic"):
                tol_ok = False
            if nominal_ok and tol_ok:
                checks.append("drawn text agrees with the native values")
            else:
                status = "conflict"
                reasons.append(f"the drawn text {d['text']!r} disagrees with the native nominal/tolerance")
        record["provenance"]["decode"] = _trace(d)
    record["validation"] = _validation(status, reasons, checks)
    return record


def _label_only_dimension(item: Dict[str, Any], dec: _Decoder) -> Dict[str, Any]:
    label = item.get("label")
    label_value, label_decimals = _label_nominal(label)
    record: Dict[str, Any] = {
        "id": f"pmi:{label}", "annotation_ref": label, "record_type": "dimension",
        "dimension_type": _dimension_type(item.get("dimension_kind")),
        "nominal": {"value": label_value if label_value is not None else item.get("nominal_mm"), "unit": "mm"},
        "tolerance": None, "basic": False, "cad_feature": item.get("cad_feature"), "source": "callout_label",
        "provenance": {"entities": ["DRAUGHTING_CALLOUT", "TESSELLATED_ANNOTATION_OCCURRENCE"]},
    }
    d = dec.decode(label)
    why = _readable(d)
    if why:
        record["validation"] = _validation("unresolved", [why, "the original graphics are the only source; review them"], [])
        if d is not None:
            record["provenance"]["decode"] = _trace(d)
        return record
    record["provenance"]["decode"] = _trace(d)
    p = parse_dimension_text(d["text"])
    if not p["ok"]:
        record["validation"] = _validation("unresolved", [p["reason"]], [])
        return record
    if label_value is not None and not _within(p["nominal"], label_value, max(label_decimals, p["nominal_decimals"] and 0)):
        record["validation"] = _validation("conflict", [f"the drawn text {d['text']!r} does not match the callout label value {label_value}"], [])
        return record
    record["nominal"] = {"value": p["nominal"], "unit": "mm"}
    record["tolerance"] = _limits(p["nominal"], -p["tolerance"], p["tolerance"]) if p["tolerance"] is not None else None
    record["source"] = "decoded_graphics"
    checks = ["every glyph recognised", "reading orientation unambiguous"]
    status = "decoded_unverified"
    if label_value is not None:
        checks.append("decoded nominal equals the callout label value")
        status = "decoded_cross_checked"
    record["validation"] = _validation(status, ["decoded from drawn glyphs: confirm against the drawing before relying on it"], checks)
    return record


# ── GD&T ─────────────────────────────────────────────────────────────────────

def _frame(characteristic: str, label: Optional[str], zone: Optional[float], native: bool, dec: _Decoder,
           cad_feature: Optional[str]) -> Dict[str, Any]:
    record: Dict[str, Any] = {
        "id": f"pmi:{label}", "annotation_ref": label, "record_type": "gdt", "characteristic": characteristic,
        "zone": {"value": zone, "unit": "mm"} if zone is not None else None, "modifiers": [],
        "datum_refs": None, "datum_refs_source": None, "cad_feature": cad_feature,
        "source": "native_pmi" if native else "decoded_graphics",
        "provenance": {"entities": [f"{characteristic.upper()}_TOLERANCE"]} if native else {"entities": ["TESSELLATED_ANNOTATION_OCCURRENCE"]},
    }
    if not native:
        record["characteristic_source"] = "callout label"
    d = dec.decode(label)
    why = _readable(d)
    if d is not None:
        record["provenance"]["decode"] = _trace(d)
    reasons: List[str] = []
    checks: List[str] = ["native semantic entity"] if native else []
    status = "verified" if native else "unresolved"
    p = parse_frame_text(d["text"]) if d is not None and why is None else None
    if p is not None and p["ok"]:
        if native and zone is not None:
            if _within(p["zone"], zone, 3):
                checks.append("drawn zone agrees with the native zone")
                record["datum_refs"] = p["datum_refs"]
                record["datum_refs_source"] = "decoded_graphics"
                reasons.append("datum references are decoded from drawn glyphs (the file stores none as data): confirm before relying on them")
            else:
                status = "conflict"
                reasons.append(f"the drawn zone {p['zone']} disagrees with the native zone {zone}")
        elif not native:
            record["zone"] = {"value": p["zone"], "unit": "mm"}
            record["datum_refs"] = p["datum_refs"]
            record["datum_refs_source"] = "decoded_graphics"
            checks += ["every glyph recognised", "reading orientation unambiguous"]
            status = "decoded_unverified"
            reasons.append("no native entity: the zone and datum references are decoded from drawn glyphs only; confirm before relying on them")
    else:
        reasons.append(why or (p["reason"] if p else "no drawn text"))
        if not native:
            status = "unresolved"
        else:
            reasons.append("datum references are not available as data: see the PMI graphics")
    record["validation"] = _validation(status, reasons, checks)
    # The native zone (when there is one) is authoritative on its own. The datum references are a separate
    # field with their own, weaker status: decoded from glyphs, never automation-ready.
    record["validation"]["applies_to"] = ["zone"] if native else ["zone", "datum_refs"]
    if record["datum_refs"] is not None:
        record["datum_refs_validation"] = {
            "status": "decoded_cross_checked" if native and status == "verified" else "decoded_unverified",
            "automation_ready": False, "requires_review": True,
            "reason": "read from drawn glyphs; the STEP stores no datum reference as data",
        }
    return record


def _datum(item: Dict[str, Any], dec: _Decoder) -> Dict[str, Any]:
    label = item.get("label")
    record: Dict[str, Any] = {
        "id": f"pmi:{label}", "annotation_ref": label, "record_type": "datum", "letter": item.get("letter"),
        "cad_feature": item.get("cad_feature"), "source": "callout_label",
        "provenance": {"entities": ["DRAUGHTING_CALLOUT"]},
    }
    d = dec.decode(label)
    status, checks, reasons = "decoded_unverified", ["letter read from the callout label"], []
    if d is not None:
        record["provenance"]["decode"] = _trace(d)
        letter = parse_datum_text(d["text"]) if d["resolved"] else None
        if letter == item.get("letter"):
            status = "decoded_cross_checked"
            checks.append("the drawn letter equals the label letter")
        elif letter is not None:
            status = "conflict"
            reasons.append(f"the drawn letter {letter!r} differs from the label letter {item.get('letter')!r}")
    record["validation"] = _validation(status, reasons, checks)
    return record


# ── Association with the engine's features ───────────────────────────────────

def engine_features(machining_features: Optional[Sequence[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """The engine's features that have a radius, diameter or width, as {id, kind, size_mm, face_ids}."""
    out: List[Dict[str, Any]] = []
    for f in machining_features or []:
        p, faces = f.get("params") or {}, list(f.get("face_ids") or [])
        ftype, variant = f.get("type"), f.get("variant")

        def add(kind: str, size: Any) -> None:
            if isinstance(size, (int, float)) and size > 0 and faces:
                out.append({"id": f.get("id"), "kind": kind, "size_mm": float(size), "face_ids": faces})

        if ftype == "SimpleHole" and variant != "pcd_pattern":
            add("diameter", p.get("diameter_mm"))
        elif ftype == "MultiStepHole":
            for s in p.get("steps") or []:
                add("diameter", (s or {}).get("diameter_mm"))
            add("diameter", p.get("counterbore_diameter_mm"))
            add("diameter", p.get("bore_diameter_mm"))
        elif ftype == "Edge" and variant == "countersink":
            add("diameter", p.get("entry_diameter_mm"))
        elif ftype == "Edge" and variant == "round":
            add("radius", p.get("radius_mm"))
        elif ftype == "Ring" and variant == "outer_diameter":
            add("diameter", p.get("diameter_mm"))
        elif ftype == "Slot" and variant == "straight":
            add("width", p.get("width_mm"))
    return out


def _associate(kind: str, size: float, features: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    hits = [f for f in features if f["kind"] == kind and abs(f["size_mm"] - size) <= SAME_SIZE_MM]
    if not hits:
        return {"feature_ids": [], "face_ids": [], "association": f"no engine {kind} feature of size {size}"}
    return {
        "feature_ids": sorted({str(h["id"]) for h in hits}),
        "face_ids": sorted({fid for h in hits for fid in h["face_ids"]}),
        "association": f"engine {kind} features of size {size} (matched by kind and size; the STEP ties PMI to no face)",
        "instances": len({str(h["id"]) for h in hits}),
    }


def build_pmi_records(
    pmi: Dict[str, Any], features: Optional[Sequence[Dict[str, Any]]] = None, templates=None, decode: bool = True,
) -> Dict[str, Any]:
    """
    {'records': [...], 'summary': {...}} from the reader's output (items, graphics). `features` is
    engine_features(...). `decode=False` skips all glyph work (every decoded field then stays unresolved).
    """
    graphics = (pmi.get("graphics") or []) if decode else []
    dec = _Decoder(graphics, templates if templates is not None else default_templates())
    items = pmi.get("items") or []
    records: List[Dict[str, Any]] = []
    covered = set()

    for item in items:
        kind = item.get("kind")
        if kind == "dimension":
            rec = _native_dimension(item, dec)
        elif kind == "label_only":
            rec = _label_only_dimension(item, dec)
        elif kind == "geometric":
            rec = _frame(item["type"], item.get("label"), item.get("zone_mm"), True, dec, item.get("cad_feature"))
        elif kind == "datum":
            rec = _datum(item, dec)
        else:
            continue
        covered.add(item.get("label"))
        records.append(rec)

    # callouts the semantic list does not cover: frames drawn without a tolerance entity
    for g in graphics:
        name = g["callout"]
        if name in covered:
            continue
        m = _LABEL_KIND.match(name)
        characteristic = CHARACTERISTICS.get((m.group(1) if m else "").lower())
        if characteristic:
            records.append(_frame(characteristic, name, None, False, dec, None))

    # engine features: by kind and size for dimensions; GD&T through the dimensions of the same CAD feature
    feats = list(features or [])
    by_cad_feature: Dict[str, Dict[str, Any]] = {}
    for rec in records:
        if rec["record_type"] == "dimension" and rec["dimension_type"] in ("radius", "diameter", "width") and rec["nominal"]["value"]:
            assoc = _associate(rec["dimension_type"], rec["nominal"]["value"], feats)
            rec["feature_ref"] = {"cad_feature": rec.get("cad_feature"), "engine_feature_ids": assoc["feature_ids"],
                                  "face_ids": assoc["face_ids"], "association": assoc["association"]}
            if rec.get("cad_feature") and assoc["feature_ids"]:
                by_cad_feature.setdefault(rec["cad_feature"], rec["feature_ref"])
        elif rec["record_type"] == "dimension":
            rec["feature_ref"] = {"cad_feature": rec.get("cad_feature"), "engine_feature_ids": [], "face_ids": [],
                                  "association": "no engine feature type for this dimension"}
    for rec in records:
        if rec["record_type"] in ("gdt", "datum"):
            ref = by_cad_feature.get(rec.get("cad_feature") or "")
            rec["feature_ref"] = ({**ref, "association": f"through the dimension of CAD feature {rec['cad_feature']!r}: {ref['association']}"}
                                  if ref else {"cad_feature": rec.get("cad_feature"), "engine_feature_ids": [], "face_ids": [],
                                               "association": "the file dimensions no CAD feature of this name"})

    for rec in records:
        rec["fingerprint"] = record_fingerprint(rec)
        if rec.get("datum_refs") is not None:
            rec["datum_refs_fingerprint"] = datum_refs_fingerprint(rec)

    counts: Dict[str, int] = {}
    for rec in records:
        s = rec["validation"]["status"]
        counts[s] = counts.get(s, 0) + 1
    return {"records": records, "summary": {"records": len(records), "by_status": counts}}
