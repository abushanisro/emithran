"""OCCT 7.8 removed TopoDS_Shape.HashCode; hash(shape) is the supported key (equal for the same shape, whatever the Python wrapper object).
A call to the removed method fails only when a part with faces is analysed, so this keeps it out of the source."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_no_source_file_calls_the_removed_hashcode_method():
    offenders = [
        str(p.relative_to(ROOT))
        for p in ROOT.rglob("*.py")
        if "test" not in p.relative_to(ROOT).parts[:1] and ".HashCode(" in p.read_text(encoding="utf-8")
    ]
    assert offenders == []
