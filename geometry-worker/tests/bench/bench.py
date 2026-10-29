#!/usr/bin/env python3
"""
Benchmark for the go/no-go gate (docs/ASSEMBLY_CORE.md): the same N-part assembly through the Python engine's build_report and through
the C++ worker (report + one STEP export per part). Wall time and peak memory of each, measured inside the container.
  python3 geometry-worker/tests/bench/bench.py [parts=150]
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3].parent
HERE = Path(__file__).resolve().parent
PARTS = sys.argv[1] if len(sys.argv) > 1 else "150"

PY_MEASURE = """
import json, resource, sys, time
sys.path.insert(0, '/engine')
from shared.assembly_report import build_report, export_parts
t = time.time()
report = build_report([('0000_bench.step', '/work/bench.step')])
t_report = time.time() - t
t = time.time()
import tempfile, os
d = tempfile.mkdtemp()
export_parts([('0000_bench.step', '/work/bench.step')], [p['id'] for p in report['parts']], os.path.join(d, 'p.zip'), d)
t_export = time.time() - t
print(json.dumps({'parts': len(report['parts']), 'report_s': round(t_report, 2), 'export_s': round(t_export, 2),
                  'peak_rss_mb': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)}))
"""
CPP_MEASURE = """
import json, os, resource, subprocess, time
os.makedirs('/out/parts', exist_ok=True)
t = time.time()
subprocess.run(['/src/build/geometry-worker', '--deadline-ms', '600000', '/out', '/work/bench.step'], check=True, capture_output=True)
wall = time.time() - t
parts = len(os.listdir('/out/parts'))
print(json.dumps({'parts': parts, 'total_s': round(wall, 2), 'peak_rss_mb': round(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024)}))
"""


def docker(image, mounts, code, python="python"):
    cmd = ["docker", "run", "--rm", "--platform", "linux/amd64", *[a for m in mounts for a in ("-v", m)], image, python, "-c", code]
    return json.loads(subprocess.run(cmd, check=True, capture_output=True, text=True).stdout.strip().splitlines()[-1])


def main():
    with tempfile.TemporaryDirectory() as work:
        subprocess.run(["docker", "run", "--rm", "--platform", "linux/amd64", "-v", f"{work}:/work", "-v", f"{HERE}:/bench:ro", "py-occt:dev",
                        "python", "/bench/make_assembly.py", "/work/bench.step", PARTS], check=True, capture_output=True)
        size_mb = (Path(work) / "bench.step").stat().st_size / 1e6
        py = docker("py-occt:dev", [f"{work}:/work:ro", f"{ROOT/'cad-engine'}:/engine:ro"], PY_MEASURE)
        cpp = docker("gw-build:dev", [f"{work}:/work:ro"], CPP_MEASURE, python="/opt/conda/bin/python")
    print(f"assembly: {PARTS} distinct parts, {size_mb:.1f} MB STEP")
    print(f"python engine : report {py['report_s']} s + export {py['export_s']} s = {py['report_s'] + py['export_s']:.2f} s, peak {py['peak_rss_mb']} MB, {py['parts']} parts")
    print(f"c++ worker    : report + export {cpp['total_s']} s, peak {cpp['peak_rss_mb']} MB, {cpp['parts']} parts")


if __name__ == "__main__":
    main()
