"""
Assembly structure of a STEP file, read through OpenCascade XDE.

STEP stores an assembly as part *definitions* plus *instances* that reference them. Reading the file as one merged
shape (shared/services.py StepReader) loses that, so repeated parts cannot be counted. This module keeps it:
instances of the same definition under one parent collapse into one node with a quantity, like a BOM line, and each
distinct part definition is returned once, so it is measured and analysed once however many times it is used.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Dict, List

from OCC.Core.IFSelect import IFSelect_RetDone
from OCC.Core.STEPCAFControl import STEPCAFControl_Reader
from OCC.Core.STEPControl import STEPControl_AsIs, STEPControl_Writer
from OCC.Core.TCollection import TCollection_AsciiString
from OCC.Core.TDF import TDF_Label, TDF_LabelSequence, TDF_Tool
from OCC.Core.TDocStd import TDocStd_Document
from OCC.Core.TopoDS import TopoDS_Shape
from OCC.Core.XCAFDoc import XCAFDoc_DocumentTool

from shared.exceptions import StepReadError, StepWriteError

# Real product trees are a few levels deep; this stops a malformed or hostile file from exhausting the recursion limit.
MAX_DEPTH = 64


@dataclass
class Node:
    definition: str  # document-unique id (label entry, with the file prefix) of the definition this node instances
    name: str
    kind: str  # "part", "assembly", or "empty_assembly" (an assembly with no components)
    quantity: int = 1
    children: List["Node"] = field(default_factory=list)  # empty unless kind == "assembly"


@dataclass
class Assembly:
    roots: List[Node]
    shapes: Dict[str, TopoDS_Shape]  # part definition id -> its shape (kind == "part" only, one per definition)


def read_assembly(step_path: str, prefix: str = "") -> Assembly:
    """`prefix` keeps definition ids unique when several files are read together."""
    if not os.path.exists(step_path):
        raise StepReadError(f"STEP file does not exist: {step_path}")

    doc = TDocStd_Document("emithran-assembly")
    reader = STEPCAFControl_Reader()
    reader.SetNameMode(True)
    if reader.ReadFile(step_path) != IFSelect_RetDone:
        raise StepReadError("Failed to read STEP file")
    if not reader.Transfer(doc):
        raise StepReadError("Failed to transfer STEP file to the assembly document")

    tool = XCAFDoc_DocumentTool.ShapeTool(doc.Main())
    shapes: Dict[str, TopoDS_Shape] = {}

    def entry(label: TDF_Label) -> str:
        text = TCollection_AsciiString()
        TDF_Tool.Entry(label, text)
        return f"{prefix}{text.ToCString()}"

    def build(label: TDF_Label, depth: int) -> Node:
        if depth > MAX_DEPTH:
            raise StepReadError(f"Assembly nested deeper than {MAX_DEPTH} levels")
        definition = TDF_Label()
        if tool.IsReference(label):
            tool.GetReferredShape(label, definition)
        else:
            definition = label
        key = entry(definition)
        name = definition.GetLabelName() or key

        if not tool.IsAssembly(definition):
            shape = tool.GetShape(definition)
            if shape is None or shape.IsNull():
                raise StepReadError(f"Part '{name}' has no geometry")
            shapes.setdefault(key, shape)
            return Node(key, name, "part")

        components = TDF_LabelSequence()
        tool.GetComponents(definition, components)
        if components.Length() == 0:
            return Node(key, name, "empty_assembly")

        children: List[Node] = []
        by_definition: Dict[str, Node] = {}
        for i in range(1, components.Length() + 1):
            child = build(components.Value(i), depth + 1)
            if child.definition in by_definition:
                by_definition[child.definition].quantity += 1
            else:
                by_definition[child.definition] = child
                children.append(child)
        return Node(key, name, "assembly", children=children)

    free = TDF_LabelSequence()
    tool.GetFreeShapes(free)
    if free.Length() == 0:
        raise StepReadError("STEP file contains no shapes")
    return Assembly([build(free.Value(i), 0) for i in range(1, free.Length() + 1)], shapes)


def part_totals(roots: List[Node]) -> Dict[str, int]:
    """Total quantity of every part definition: quantities multiply down each path of the tree."""
    totals: Dict[str, int] = {}

    def walk(node: Node, factor: int) -> None:
        factor *= node.quantity
        if node.kind == "part":
            totals[node.definition] = totals.get(node.definition, 0) + factor
        for child in node.children:
            walk(child, factor)

    for root in roots:
        walk(root, 1)
    return totals


def write_step(shape: TopoDS_Shape, path: str) -> None:
    if shape.IsNull():
        raise StepWriteError("Cannot write a null shape")
    writer = STEPControl_Writer()
    if writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone:
        raise StepWriteError("Failed to transfer the shape to the STEP model")
    if writer.Write(path) != IFSelect_RetDone:
        raise StepWriteError(f"Failed to write STEP file: {path}")
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        raise StepWriteError(f"STEP file was not created: {path}")
