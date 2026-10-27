"""Writes the copper reverse-engineering results (extraction/connectivity.py) into the board feature graph, with provenance.

What becomes measured:
  fabrication.minSpacingMm         narrowest gap between two different conductors on one copper layer
  fabrication.minAnnularRingMm     smallest (pad width - hole) / 2 over the plated holes that land on a pad
  fabrication.minCopperToEdgeMm    nearest copper to the centre line of the board outline
  copper                           copper area per side, conductor count, plated holes that belong to no part
  connectivity                     pins tied to nets, and the series chains of two-pin parts
  thtParts (mount type)            a footprint the package lookup does not hold is through-hole when every pin of every
                                   one of its parts is a plated hole, surface-mount when none is
Nothing is filled in when an input is missing: the field is listed in `unresolved` with the reason.
"""
from __future__ import annotations

from typing import Any

from extraction.connectivity import Analysis, ClearPolarity, CopperLayer, analyse, copper_shapes
from extraction.outline import _polyline
from parsers.gerber_layer import UnsupportedGerber, load_gerber

SIDE_OF_ROLE = {"copper_top": "top", "copper_bottom": "bottom"}


def _note(findings: list, severity: str, message: str, field: str | None) -> None:
    findings.append({"severity": severity, "message": message, **({"field": field} if field else {})})


def analyse_copper(graph: dict[str, Any], provenance: dict[str, Any], unresolved: list[dict[str, str]], findings: list,
                   used: list[str], copper_files: list, by_role: dict, drilled: list, components: list | None,
                   outline_file, drill_file, pp_file) -> None:
    def use(name: str) -> None:
        if name not in used:
            used.append(name)

    def measured(key: str, file_name: str, confidence: str, reference: str) -> None:
        provenance[key] = {"basis": "measured", "confidence": confidence, "source": {"file": file_name, "reference": reference}}
        use(file_name)

    layers: list[CopperLayer] = []
    try:
        for role in ("copper_top", "copper_bottom"):
            for f in by_role.get(role, []):
                layers.append(CopperLayer(f.name, SIDE_OF_ROLE[role], copper_shapes(load_gerber(f.name, f.data), f.name)))
    except (ClearPolarity, UnsupportedGerber) as error:
        reason = f"copper cannot be traced: {error}"
        for key in ("fabrication.minSpacingMm", "copper", "connectivity"):
            unresolved.append({"field": key, "reason": reason})
        return
    if not layers:
        return

    segments: list[tuple[float, float, float, float]] = []
    for obj in load_gerber(outline_file.name, outline_file.data).objects:
        if type(obj).__name__ in ("Line", "Arc"):
            pts, _ = _polyline(obj)
            segments.extend((*a, *b) for a, b in zip(pts, pts[1:]))

    holes = drilled if drill_file is not None else []
    result: Analysis = analyse(layers, holes, components if drill_file is not None else components, segments)
    top_file = layers[0].name

    # ---- fabrication facts -------------------------------------------------------------------------------
    fabrication = graph.setdefault("fabrication", {})
    if result.min_spacing is not None:
        fabrication["minSpacingMm"] = result.min_spacing[0]
        measured("fabrication.minSpacingMm", result.min_spacing[1], "high",
                 "smallest edge-to-edge gap between copper of two different conductors on one layer (pads, strokes, regions)")
    if result.min_annular_ring_mm is not None and drill_file is not None and result.min_annular_ring_mm > 0:
        fabrication["minAnnularRingMm"] = result.min_annular_ring_mm
        measured("fabrication.minAnnularRingMm", drill_file.name, "high", "(narrowest landing-pad width - hole diameter) / 2 over the plated holes; pads from the copper layers")
    elif drill_file is not None and result.min_annular_ring_mm is not None:
        _note(findings, "warning", f"a plated hole is wider than its landing pad (annular ring {result.min_annular_ring_mm} mm)", "fabrication")
    if result.min_copper_to_edge_mm is not None:
        fabrication["minCopperToEdgeMm"] = result.min_copper_to_edge_mm
        measured("fabrication.minCopperToEdgeMm", outline_file.name, "high", "nearest copper to the centre line of the outline path")

    # ---- copper --------------------------------------------------------------------------------------------
    copper: dict[str, Any] = {"areaMm2": result.copper["areaMm2"], "conductors": result.copper["conductors"]}
    if drill_file is not None:
        copper["viaCount"] = result.copper["viaCount"]
    graph["copper"] = copper
    measured("copper", top_file, "high", "union of the copper drawn on each layer (scanlines 0.05 mm apart); conductors joined through the plated holes")
    for layer in layers[1:]:
        use(layer.name)
    if drill_file is not None and "viaCount" in copper:
        provenance["copper.viaCount"] = {
            "basis": "measured",
            "confidence": "medium" if components else "high",
            "source": {"file": drill_file.name, "reference": "plated holes whose pads belong to no placed part (vias, and holes for wires soldered in)" if components else "every plated hole that lands on copper (no Pick Place to tell part holes apart)"},
        }
        use(drill_file.name)

    # ---- connectivity ------------------------------------------------------------------------------------
    if result.connectivity is not None and pp_file is not None:
        graph["connectivity"] = result.connectivity
        measured("connectivity", top_file, "medium",
                 f"pins: copper pads at the {pp_file.name} positions whose offset recurs on the parts of the same footprint; nets: copper joined through plated holes")
        use(pp_file.name)
    elif pp_file is None:
        unresolved.append({"field": "connectivity", "reason": "nets are traced from the copper, but pins cannot be tied to parts without a Pick Place file"})

    # ---- mount type for footprints the lookup does not hold ---------------------------------------------
    if drill_file is not None and result.mount and "placements" in graph:
        moved: list[str] = []
        kept_smd: list[str] = []
        remaining: list[dict[str, Any]] = []
        tht = {t["label"]: t for t in graph.get("thtParts", [])}
        for p in graph["placements"]:
            entry = result.mount.get(p.get("footprint", "")) if p["packageClass"] == "unknown" else None
            if entry is None:
                remaining.append(p)
            elif entry[0] == "tht":
                current = tht.setdefault(p["footprint"], {"label": p["footprint"], "count": 0, "jointsPerPart": entry[1]})
                current["count"] += p["count"]
                moved.append(p["footprint"])
            else:
                remaining.append(p)
                kept_smd.append(p["footprint"])
        graph["placements"] = remaining
        graph["thtParts"] = list(tht.values())
        if moved:
            provenance["thtParts"] = {
                "basis": "measured",
                "confidence": "medium",
                "source": {"file": drill_file.name, "reference": f"every pin of {', '.join(sorted(set(moved)))} is a plated hole at the Pick Place position; joints per part = pins found"},
            }
        still_unknown = sorted({p["footprint"] for p in remaining if p["packageClass"] == "unknown" and p.get("footprint") not in result.mount})
        stale = lambda u: (u["field"] == "thtParts" and u["reason"].startswith("through-hole parts cannot be told")) or (
            u["field"] == "placements" and u["reason"].startswith("footprints not in the package-class lookup"))
        unresolved[:] = [u for u in unresolved if not stale(u)]
        # The package class (chip_0805, sot, ...) still comes only from the lookup; the mount type no longer does.
        unclassed: dict[str, int] = {}
        for p in remaining:
            if p["packageClass"] == "unknown" and p.get("footprint"):
                unclassed[p["footprint"]] = unclassed.get(p["footprint"], 0) + p["count"]
        if unclassed:
            names = ", ".join(f"{fp} ({n}{', ' + result.mount[fp][0].upper() + ' read from the copper' if fp in result.mount else ''})" for fp, n in sorted(unclassed.items()))
            unresolved.append({"field": "placements", "reason": f"footprints not in the package-class lookup, so their package class is unknown: {names}"})
        if still_unknown:
            unresolved.append({"field": "thtParts", "reason": f"mount type not readable from the copper for: {', '.join(still_unknown)}"})
        if moved or kept_smd:
            _note(findings, "info",
                  "mount type read from the copper and drill file for footprints the package lookup does not hold: "
                  + "; ".join(f"{fp}: {result.mount[fp][0].upper()} {result.mount[fp][1]} pins" for fp in sorted(set(moved + kept_smd))),
                  "thtParts")

    for key, reason in result.unresolved:
        unresolved.append({"field": key, "reason": reason})
    for severity, message, field in result.findings:
        _note(findings, severity, message, field)
