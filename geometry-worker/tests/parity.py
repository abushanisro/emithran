#!/usr/bin/env python3
"""
Parity: the C++ worker must read the same STEP files exactly as the Python engine (cad-engine/shared/assembly_report.build_report).
Runs both in Docker on the NestJS e2e fixtures and compares the two reports: ids, names, kinds, quantities, files, problems and
status exactly; measurements within 0.1% (the same OCCT version computes both, so they normally agree to the rounding).

  docker build --platform linux/amd64 --build-context fixtures=backend/test/fixtures/cad -t gw-build:dev geometry-worker
  docker build --platform linux/amd64 -t py-occt:dev -f geometry-worker/tests/Dockerfile.pyocct geometry-worker/tests
  python3 geometry-worker/tests/parity.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "backend/test/fixtures/cad"
# Same order and display names the runner sends: position-prefixed (core/crates/runner/src/names.rs).
CASES = {
    "nested assembly": ["nested-assembly.step"],
    "single part": ["plate.step"],
    "three files, one product": ["plate.step", "pin.step", "nested-assembly.step"],
}
PYTHON = (
    "import json,sys; sys.path.insert(0,'/engine'); from shared.assembly_report import build_report; "
    "files=[(n, '/fixtures/'+n.split('_',1)[1]) for n in sys.argv[1:]]; print(json.dumps(build_report(files)))"
)


def wire(names):
    return [f"{i:04d}_{n}" for i, n in enumerate(names)]


def run_python(names):
    # pythonocc from conda-forge, the version the engine pins; the engine's own shared/ package is mounted read-only.
    # Wire names are not real files, so each is mapped to its fixture by the script above.
    script = PYTHON
    cmd = ["docker", "run", "--rm", "--platform", "linux/amd64", "-v", f"{FIXTURES}:/fixtures:ro", "-v", f"{ROOT/'cad-engine'}:/engine:ro",
           "py-occt:dev", "python", "-c", script, *wire(names)]
    return json.loads(subprocess.run(cmd, check=True, capture_output=True, text=True).stdout)


def run_cpp(names):
    with tempfile.TemporaryDirectory() as out:
        # copy each fixture under its wire name inside the container, as the runner does, then run the worker
        shell = " && ".join(
            [f"mkdir -p /tmp/in /out/parts"]
            + [f"cp /fixtures/{n} /tmp/in/{w}" for n, w in zip(names, wire(names))]
            + [f"/src/build/geometry-worker --deadline-ms 120000 /out {' '.join('/tmp/in/' + w for w in wire(names))}"]
        )
        # as the calling user, so the files it writes into the temp folder can be cleaned up afterwards
        cmd = ["docker", "run", "--rm", "--platform", "linux/amd64", "--user", f"{os.getuid()}:{os.getgid()}",
               "-v", f"{FIXTURES}:/fixtures:ro", "-v", f"{out}:/out", "gw-build:dev", "sh", "-c", shell]
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        return json.loads((Path(out) / "result.json").read_text())


def close(a, b):
    if a is None or b is None:
        return a is b
    return abs(a - b) <= max(1e-3, 1e-3 * abs(a))


def compare(py, cpp, path="report"):
    problems = []
    if isinstance(py, dict) and isinstance(cpp, dict):
        for key in sorted(set(py) | set(cpp)):
            if key not in py or key not in cpp:
                problems.append(f"{path}.{key}: only in {'python' if key in py else 'c++'}")
            else:
                problems += compare(py[key], cpp[key], f"{path}.{key}")
    elif isinstance(py, list) and isinstance(cpp, list):
        if len(py) != len(cpp):
            problems.append(f"{path}: {len(py)} items in python, {len(cpp)} in c++")
        for i, (a, b) in enumerate(zip(py, cpp)):
            problems += compare(a, b, f"{path}[{i}]")
    elif isinstance(py, (int, float)) and isinstance(cpp, (int, float)) and not isinstance(py, bool):
        if not close(py, cpp):
            problems.append(f"{path}: python {py} != c++ {cpp}")
    elif py != cpp:
        problems.append(f"{path}: python {py!r} != c++ {cpp!r}")
    return problems


def main():
    failed = 0
    for label, names in CASES.items():
        problems = compare(run_python(names), run_cpp(names))
        print(f"{'ok  ' if not problems else 'FAIL'} {label}")
        for p in problems[:10]:
            print("     ", p)
        failed += bool(problems)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
