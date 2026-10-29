"""/analyze/assembly: the report builder and the endpoint, on real STEP files."""
import os

from conftest import BOX_VOLUME
from fastapi.testclient import TestClient

import main
from shared.assembly_report import build_report


def test_report_counts_and_measures_each_distinct_part_once(nested_assembly):
    report = build_report([("assembly.step", nested_assembly)])
    assert report["status"] == "complete" and report["problems"] == []
    parts = {p["name"]: p for p in report["parts"]}
    assert set(parts) == {"Box", "Cyl"}
    assert parts["Box"]["quantity_total"] == 4 and parts["Cyl"]["quantity_total"] == 3
    assert round(parts["Box"]["volume_mm3"]) == BOX_VOLUME
    assert parts["Box"]["bounding_box"]["length"] == 30
    (top,) = report["assembly"]
    assert top["name"] == "Top" and {c["name"]: c["quantity"] for c in top["children"]} == {"Sub": 2, "Cyl": 1}


def test_a_loose_part_already_inside_the_assembly_is_not_counted_twice(nested_assembly, named_box):
    report = build_report([("assembly.step", nested_assembly), ("box.step", named_box)])
    assert [r["name"] for r in report["assembly"]] == ["Top"]
    assert {i["file"]: i["inside"] for i in report["inputs"]} == {"assembly.step": None, "box.step": "assembly.step"}
    assert {p["name"]: p["quantity_total"] for p in report["parts"]} == {"Box": 4, "Cyl": 3}


def test_an_unreadable_file_makes_the_result_partial_not_a_failure(nested_assembly, tmp_path):
    bad = tmp_path / "bad.step"
    bad.write_text("not a step file")
    report = build_report([("assembly.step", nested_assembly), ("bad.step", str(bad))])
    assert report["status"] == "partial"
    assert {i["file"]: i["status"] for i in report["inputs"]} == {"assembly.step": "ok", "bad.step": "unreadable"}
    assert len(report["parts"]) == 2


def test_endpoint_returns_the_report_and_rejects_native_cad(nested_assembly):
    headers = {"X-API-Key": main._CAD_API_KEY}
    with TestClient(main.app) as client:
        with open(nested_assembly, "rb") as f:
            ok = client.post("/analyze/assembly", files=[("files", ("assembly.step", f, "application/step"))], headers=headers)
        native = client.post("/analyze/assembly", files=[("files", ("part.sldprt", b"x", "application/octet-stream"))], headers=headers)
    assert ok.status_code == 200 and ok.json()["parts"][0]["quantity_total"] in (3, 4)
    assert native.status_code == 400 and "STEP" in native.json()["detail"]
    assert not [n for n in os.listdir(main.config.temp_dir) if n.endswith(".step") and n.startswith("tmp")]


def test_an_empty_assembly_is_reported_and_never_counted_as_a_part(monkeypatch, nested_assembly):
    from shared import assembly_report
    from shared.assembly import Assembly, Node, read_assembly
    real = read_assembly(nested_assembly, prefix="0:")
    hollow = Node("0:9", "Hollow", "empty_assembly")
    real.roots[0].children.append(hollow)
    monkeypatch.setattr(assembly_report, "read_assembly", lambda path, prefix="": Assembly(real.roots, real.shapes))
    report = assembly_report.build_report([("assembly.step", nested_assembly)])
    assert {"part": "0:9", "code": "empty_assembly"} in report["problems"]
    assert "Hollow" not in {p["name"] for p in report["parts"]}
    assert report["status"] == "complete"


def _part_ids(report):
    return {p["name"]: p["id"] for p in report["parts"]}


def test_exported_parts_are_real_step_files_with_the_right_geometry(nested_assembly, tmp_path):
    import zipfile
    from shared.assembly_report import export_parts, part_file_name
    from shared.services import StepReader
    from shared.solid_measures import measure_solid

    files = [("assembly.step", nested_assembly)]
    ids = _part_ids(build_report(files))
    archive = str(tmp_path / "parts.zip")
    export_parts(files, ids.values(), archive, str(tmp_path))
    with zipfile.ZipFile(archive) as z:
        assert sorted(z.namelist()) == sorted(part_file_name(i) for i in ids.values())
        z.extract(part_file_name(ids["Box"]), tmp_path)
    assert round(measure_solid(StepReader().read(str(tmp_path / part_file_name(ids["Box"]))))["volume"]) == BOX_VOLUME


def test_an_unknown_part_id_is_refused_by_name(nested_assembly, tmp_path):
    import pytest
    from shared.assembly_report import export_parts
    from shared.exceptions import UnknownPartError

    with pytest.raises(UnknownPartError, match="9:9"):
        export_parts([("assembly.step", nested_assembly)], ["9:9"], str(tmp_path / "x.zip"), str(tmp_path))


def test_the_endpoint_returns_a_zip_of_the_requested_parts_and_cleans_up(nested_assembly):
    import io
    import json
    import zipfile

    headers = {"X-API-Key": main._CAD_API_KEY}
    with TestClient(main.app) as client:
        with open(nested_assembly, "rb") as f:
            report = client.post("/analyze/assembly", files=[("files", ("assembly.step", f.read(), "application/step"))], headers=headers).json()
        ids = _part_ids(report)
        with open(nested_assembly, "rb") as f:
            ok = client.post("/assembly/parts", files=[("files", ("assembly.step", f.read(), "application/step"))], data={"parts": json.dumps([ids["Cyl"]])}, headers=headers)
        with open(nested_assembly, "rb") as f:
            bad = client.post("/assembly/parts", files=[("files", ("assembly.step", f.read(), "application/step"))], data={"parts": json.dumps(["7:7"])}, headers=headers)
        empty = client.post("/assembly/parts", files=[("files", ("assembly.step", b"x", "application/step"))], data={"parts": "[]"}, headers=headers)
    assert ok.status_code == 200 and ok.headers["content-type"] == "application/zip"
    assert zipfile.ZipFile(io.BytesIO(ok.content)).namelist() == [ids["Cyl"].replace(":", "_") + ".step"]
    assert bad.status_code == 400 and "7:7" in bad.json()["detail"]
    assert empty.status_code == 400
    assert not [n for n in os.listdir(main.config.temp_dir) if n.endswith(".zip") and n.startswith("tmp")]
