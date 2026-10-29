"""
The JSON a /analyze/assembly call returns (contract: contract/assembly.schema.json, version SCHEMA_VERSION).

Fields may be added within a version; consumers ignore unknown fields. A measurement that cannot be taken is null with a
code in `problems`, never an invented number.
"""
from __future__ import annotations

import os
import tempfile
import zipfile
from typing import Any, Dict, Iterable, List, Tuple

from OCC.Core.BRepCheck import BRepCheck_Analyzer

from shared.assembly import Assembly, Node, part_totals, read_assembly, write_step
from shared.exceptions import StepReadError, UnknownPartError
from shared.solid_measures import measure_solid

SCHEMA_VERSION = 1


def build_report(files: List[Tuple[str, str]]) -> Dict[str, Any]:
    """`files` is (display name, path on disk) per STEP file. All files form one product."""
    assemblies: Dict[str, Assembly] = {}
    inputs: List[Dict[str, Any]] = []
    for i, (name, path) in enumerate(files):
        try:
            assemblies[name] = read_assembly(path, prefix=f"{i}:")
            inputs.append({"file": name, "status": "ok", "inside": None})
        except StepReadError:
            inputs.append({"file": name, "status": "unreadable", "inside": None})

    # An assembly exported together with its parts lists those parts as separate files too: a root that already sits
    # inside another file's assembly is that assembly's component, not a second product line.
    kept: List[Tuple[str, Node]] = []
    for name, assembly in assemblies.items():
        for root in assembly.roots:
            owner = next((o for o, other in assemblies.items() if o != name and _contains(other.roots, root.name)), None)
            if owner:
                next(x for x in inputs if x["file"] == name)["inside"] = owner
            else:
                kept.append((name, root))

    totals = part_totals([root for _, root in kept])
    shapes = {d: s for a in assemblies.values() for d, s in a.shapes.items()}
    files_of = {d: f for f, a in assemblies.items() for d in a.shapes}
    names = {n.definition: n.name for _, root in kept for n in _parts([root])}

    parts, problems = [], []
    for definition, quantity in totals.items():
        part = {"id": definition, "name": names[definition], "file": files_of[definition], "quantity_total": quantity,
                "volume_mm3": None, "surface_area_mm2": None, "bounding_box": None}
        if not BRepCheck_Analyzer(shapes[definition]).IsValid():
            problems.append({"part": definition, "code": "invalid_geometry"})  # still measured; the caller decides
        try:
            m = measure_solid(shapes[definition])
            part.update(volume_mm3=round(m["volume"], 4), surface_area_mm2=round(m["surface_area"], 4),
                        bounding_box=m["bounding_box"])
        except Exception:
            problems.append({"part": definition, "code": "failed:measure"})
        parts.append(part)

    for _, root in kept:
        problems += [{"part": n.definition, "code": "empty_assembly"} for n in _walk([root]) if n.kind == "empty_assembly"]

    complete = all(i["status"] == "ok" for i in inputs) and bool(kept)
    return {"schema_version": SCHEMA_VERSION, "units": "mm", "status": "complete" if complete else "partial",
            "inputs": inputs, "assembly": [_node(root, f) for f, root in kept], "parts": parts, "problems": problems}


def _node(node: Node, file: str) -> Dict[str, Any]:
    return {"definition": node.definition, "name": node.name, "kind": node.kind, "quantity": node.quantity, "file": file,
            "children": [_node(c, file) for c in node.children]}


def _contains(nodes: List[Node], name: str) -> bool:
    """True when `name` is a component (not a root) somewhere below `nodes`."""
    return any(c.name == name or _contains([c], name) for n in nodes for c in n.children)


def _walk(nodes: List[Node]):
    for n in nodes:
        yield n
        yield from _walk(n.children)


def _parts(nodes: List[Node]):
    return (n for n in _walk(nodes) if n.kind == "part")


def part_file_name(part_id: str) -> str:
    """The entry name of a part in the archive export_parts writes (the id's ':' is not portable in file names)."""
    return part_id.replace(":", "_") + ".step"


def export_parts(files: List[Tuple[str, str]], wanted: Iterable[str], zip_path: str, work_dir: str) -> None:
    """
    Writes each wanted part (an `id` from build_report) as a STEP file of its own into a zip, so a part that only
    exists inside an assembly file can be stored and analysed like any other part. The files must be given in the same
    order as for build_report: the id starts with the file's position.
    """
    shapes: Dict[str, Any] = {}
    for i, (_, path) in enumerate(files):
        try:
            shapes.update(read_assembly(path, prefix=f"{i}:").shapes)
        except StepReadError:
            continue  # build_report already reported it as unreadable
    ids = list(dict.fromkeys(wanted))
    unknown = [part_id for part_id in ids if part_id not in shapes]
    if unknown:
        raise UnknownPartError(f"No such part in the uploaded files: {', '.join(unknown[:5])}")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for part_id in ids:
            fd, step_path = tempfile.mkstemp(suffix=".step", dir=work_dir)
            os.close(fd)
            try:
                write_step(shapes[part_id], step_path)
                archive.write(step_path, part_file_name(part_id))
            finally:
                os.unlink(step_path)
