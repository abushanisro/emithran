"""
Runs inside the PythonOCC image (geometry-worker/tests/Dockerfile.pyocct), the Python engine's own measuring code, three ways:

  report <in-dir>                     build_report over every file in <in-dir> (sorted by name, as the runner names them): the reference report
  export <in-dir> <report.json> <out-dir>   export_parts for every part of that report: <out-dir>/<id with ':' as '_'>.step
  measure <dir>                       reopen every .step in <dir> as a file of its own and measure it (to check an exported file is a valid part)

The engine's shared/ package is mounted at /engine. Prints one JSON document.
"""
import json
import os
import sys
import tempfile
import time
import zipfile

sys.path.insert(0, "/engine")
from shared.assembly_report import build_report, export_parts  # noqa: E402


def files(directory):
    return [(n, os.path.join(directory, n)) for n in sorted(os.listdir(directory))]


def main():
    mode = sys.argv[1]
    if mode == "report":
        started = time.time()
        report = build_report(files(sys.argv[2]))
        print(json.dumps({"report": report, "seconds": round(time.time() - started, 3)}))
    elif mode == "export":
        in_dir, report_path, out_dir = sys.argv[2:5]
        ids = [p["id"] for p in json.load(open(report_path))["parts"]]
        started = time.time()
        with tempfile.TemporaryDirectory() as work:
            zip_path = os.path.join(work, "parts.zip")
            export_parts(files(in_dir), ids, zip_path, work)
            with zipfile.ZipFile(zip_path) as z:
                z.extractall(out_dir)
        print(json.dumps({"exported": sorted(os.listdir(out_dir)), "seconds": round(time.time() - started, 3)}))
    elif mode == "measure":
        out = {}
        for name, path in files(sys.argv[2]):
            if not name.endswith(".step"):
                continue
            try:
                rep = build_report([(name, path)])
                out[name] = {"status": rep["status"], "parts": rep["parts"], "problems": rep["problems"]}
            except Exception as e:  # a file the engine cannot read at all
                out[name] = {"status": "unreadable", "parts": [], "problems": [{"code": f"{type(e).__name__}: {e}"}]}
        print(json.dumps(out))
    else:
        sys.exit(f"unknown mode {mode}")


if __name__ == "__main__":
    main()
