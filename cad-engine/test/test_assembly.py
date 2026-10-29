"""STEP assembly structure: definitions vs instances, collapsed quantities, one shape per distinct part."""
import pytest
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox

from shared.assembly import MAX_DEPTH, part_totals, read_assembly, write_step
from shared.exceptions import StepReadError, StepWriteError
from shared.solid_measures import measure_solid
from shared.services import StepReader

from conftest import BOX_VOLUME


def test_repeated_instances_collapse_into_quantities(nested_assembly):
    (top,) = read_assembly(nested_assembly).roots
    assert top.name == "Top" and top.quantity == 1
    by_name = {c.name: c for c in top.children}
    assert set(by_name) == {"Sub", "Cyl"}
    assert by_name["Sub"].quantity == 2 and by_name["Cyl"].quantity == 1
    assert {c.name: c.quantity for c in by_name["Sub"].children} == {"Box": 2, "Cyl": 1}


def test_total_quantities_multiply_down_the_tree(nested_assembly):
    assembly = read_assembly(nested_assembly)
    names = {n.definition: n.name for n in _leaves(assembly.roots)}
    totals = {names[d]: q for d, q in part_totals(assembly.roots).items()}
    assert totals == {"Box": 4, "Cyl": 3}  # Box: 2 Sub x 2;  Cyl: 2 Sub x 1 + 1 in Top


def test_each_distinct_part_definition_is_returned_once(nested_assembly):
    assembly = read_assembly(nested_assembly)
    assert len(assembly.shapes) == 2
    volumes = sorted(round(measure_solid(s)["volume"]) for s in assembly.shapes.values())
    assert volumes[1] == BOX_VOLUME


def test_a_single_part_step_is_one_root_part(tmp_path):
    path = str(tmp_path / "part.step")
    write_step(BRepPrimAPI_MakeBox(10, 20, 30).Shape(), path)
    assembly = read_assembly(path)
    (root,) = assembly.roots
    assert root.children == [] and root.quantity == 1
    assert list(assembly.shapes) == [root.definition]
    assert round(measure_solid(assembly.shapes[root.definition])["volume"]) == BOX_VOLUME


def test_a_written_part_reads_back_with_the_same_volume(tmp_path):
    path = str(tmp_path / "out.step")
    write_step(BRepPrimAPI_MakeBox(10, 20, 30).Shape(), path)
    assert round(measure_solid(StepReader().read(path))["volume"]) == BOX_VOLUME


def test_prefix_keeps_definition_ids_unique_across_files(nested_assembly):
    a = read_assembly(nested_assembly, prefix="0:")
    b = read_assembly(nested_assembly, prefix="1:")
    assert not set(a.shapes) & set(b.shapes)


def test_missing_and_garbage_files_raise_step_read_error(tmp_path):
    with pytest.raises(StepReadError):
        read_assembly(str(tmp_path / "missing.step"))
    garbage = tmp_path / "garbage.step"
    garbage.write_text("not a step file")
    with pytest.raises(StepReadError):
        read_assembly(str(garbage))


def _leaves(nodes):
    for n in nodes:
        if n.kind == "part":
            yield n
        else:
            yield from _leaves(n.children)


def test_nodes_say_whether_they_are_parts_or_assemblies(nested_assembly):
    (top,) = read_assembly(nested_assembly).roots
    assert top.kind == "assembly"
    assert {c.name: c.kind for c in top.children} == {"Sub": "assembly", "Cyl": "part"}


def test_definition_ids_are_label_entries_not_bare_tags(nested_assembly):
    ids = {n.definition for n in _leaves(read_assembly(nested_assembly).roots)}
    assert all(":" in i for i in ids)  # e.g. "0:1:1:3", unique within the document


def test_a_file_whose_only_sub_assembly_is_empty_still_reads_without_error(tmp_path):
    """The STEP writer cannot express an empty sub-assembly (it flattens the parent), so none can be produced here;
    the empty_assembly kind is exercised on a hand-built tree in test_assembly_report.py."""
    from OCC.Core.STEPCAFControl import STEPCAFControl_Writer
    from OCC.Core.TDataStd import TDataStd_Name
    from OCC.Core.TDocStd import TDocStd_Document
    from OCC.Core.XCAFDoc import XCAFDoc_DocumentTool
    from conftest import _at
    doc = TDocStd_Document("empty")
    tool = XCAFDoc_DocumentTool.ShapeTool(doc.Main())
    box = tool.AddShape(BRepPrimAPI_MakeBox(1, 1, 1).Shape(), False)
    top, hollow = tool.NewShape(), tool.NewShape()
    TDataStd_Name.Set(top, "Top")
    tool.AddComponent(top, box, _at(0))
    tool.AddComponent(top, hollow, _at(10))
    path = str(tmp_path / "empty.step")
    writer = STEPCAFControl_Writer()
    writer.Transfer(doc)
    writer.Write(path)
    (root,) = read_assembly(path).roots
    assert root.name == "Top" and root.kind == "part"


def test_a_tree_deeper_than_the_limit_is_refused(tmp_path):
    from OCC.Core.STEPCAFControl import STEPCAFControl_Writer
    from OCC.Core.TDocStd import TDocStd_Document
    from OCC.Core.XCAFDoc import XCAFDoc_DocumentTool
    from conftest import _at
    doc = TDocStd_Document("deep")
    tool = XCAFDoc_DocumentTool.ShapeTool(doc.Main())
    inner = tool.AddShape(BRepPrimAPI_MakeBox(1, 1, 1).Shape(), False)
    for _ in range(MAX_DEPTH + 3):
        outer = tool.NewShape()
        tool.AddComponent(outer, inner, _at(0))
        inner = outer
    tool.UpdateAssemblies()
    path = str(tmp_path / "deep.step")
    writer = STEPCAFControl_Writer()
    writer.Transfer(doc)
    writer.Write(path)
    with pytest.raises(StepReadError, match="deeper"):
        read_assembly(path)


def test_write_step_names_the_operation_that_failed(tmp_path):
    from OCC.Core.TopoDS import TopoDS_Shape
    with pytest.raises(StepWriteError, match="null shape"):
        write_step(TopoDS_Shape(), str(tmp_path / "x.step"))
    with pytest.raises(StepWriteError, match="write STEP"):
        write_step(BRepPrimAPI_MakeBox(1, 1, 1).Shape(), str(tmp_path / "missing-dir" / "x.step"))


def _all(nodes):
    for n in nodes:
        yield n
        yield from _all(n.children)
