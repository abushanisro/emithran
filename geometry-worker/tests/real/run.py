#!/usr/bin/env python3
"""
Parity of the two CAD cores on real files: CAD_CORE=python (the NestJS runner calling the Python engine) against CAD_CORE=rust (the Rust runner
and the C++ geometry worker). Nothing here changes either path or the production default; it only runs them on the same zip and writes down
how they differ. Each stage tests one component alone, so a failure is attributed to the component that caused it:

  archive   the Rust extractor (core/crates/archive) and the backend's (expand-archive.ts) against a plain zip reader: same entries, bytes, skips
  geometry  the C++ geometry-worker and the Python engine's build_report on the same STEP files: tree, quantities, volume, area, boxes, status
  exports   each side's exported part files, reopened as files of their own and measured with the same code, against the reports
  e2e       the whole of each path on the zip: the backend's real CadUploadRunner with CAD_CORE=python (live cad-engine) and CAD_CORE=rust
            (the real cad-runner and cad-worker containers, as in core/tests/e2e.py), then the BOM lines each one creates

  python3 geometry-worker/tests/real/run.py --out DIR [--zip FILE]... [--only archive,geometry,exports,e2e]

Needs Docker and the images below (build commands are printed when one is missing), `cargo`, and `npm ci` in backend/. Customer files are read
from the paths given and never copied into the repository; DIR holds the raw reports and the diffs, so keep it out of git if they are customer's.
Writes DIR/<case>/{archive,geometry,exports,e2e}/..., DIR/diff.json (every finding), DIR/summary.md. Exit status 1 when any finding exists.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from datetime import datetime
from http.server import ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
from compare import Stats, compare_bom, compare_reports, compare_values, finding  # noqa: E402

IMAGES = {
    "worker": os.environ.get("CAD_WORKER_IMAGE", "cad-worker:dev"),
    "core": os.environ.get("CAD_CORE_IMAGE", "cad-core:dev"),
    "pyocc": os.environ.get("PYOCC_IMAGE", "py-occt:dev"),
    "engine": os.environ.get("CAD_ENGINE_IMAGE", "mithran-cad-engine:dev"),
}
BUILD_HINTS = {
    "worker": "docker build --build-context geometry=geometry-worker --build-context fixtures=backend/test/fixtures/cad --target worker -t cad-worker:dev core",
    "core": "docker build -t cad-core:dev core",
    "pyocc": "docker build -t py-occt:dev -f geometry-worker/tests/Dockerfile.pyocct geometry-worker/tests",
    "engine": "cd cad-engine && docker compose -f docker-compose.dev.yml build cad-engine",
}
FIXTURES = ROOT / "backend/test/fixtures/cad"
ENGINE_KEY = "parity-key"
STEP = re.compile(r"\.(step|stp)$", re.I)


def run(cmd, check=True, **kw):
    return subprocess.run([str(c) for c in cmd], check=check, capture_output=True, text=True, **kw)


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def last_json(text: str):
    """The tool's own answer is its last line: OpenCASCADE writes its warnings on stdout before it."""
    return json.loads(text.strip().splitlines()[-1])


def save(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True))


def user() -> list:
    return ["--user", f"{os.getuid()}:{os.getgid()}"]


# ---------------------------------------------------------------------------------------------------------------------------- cases

def fixture_cases(out: Path) -> list:
    """The repository's synthetic STEP fixtures: the required nested assembly, alone and inside a pack with loose parts."""
    pack = out / "_inputs" / "nested-assembly-pack.zip"
    pack.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(pack, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Pack/top/nested-assembly.step", (FIXTURES / "nested-assembly.step").read_bytes())
        z.writestr("Pack/parts/plate.step", (FIXTURES / "plate.step").read_bytes())
        z.writestr("Pack/parts/pin.step", (FIXTURES / "pin.step").read_bytes())
        z.writestr("Pack/readme.txt", "not cad")
    # Bad input must fail the same way on both paths: a pack whose second STEP file is cut off, and one that holds no CAD at all.
    broken = out / "_inputs" / "pack-with-a-corrupt-step.zip"
    with zipfile.ZipFile(broken, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Pack/plate.step", (FIXTURES / "plate.step").read_bytes())
        z.writestr("Pack/cut-off.step", (FIXTURES / "pin.step").read_bytes()[:400])
    drawings = out / "_inputs" / "pack-with-drawings-only.zip"
    with zipfile.ZipFile(drawings, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Drawings/P01.pdf", b"%PDF-1.4 not cad")
    # A pack as a customer sends it: one STEP part and native CAD files (Parasolid) beside it. Both cores must leave the same files out, for the same reasons.
    mixed = out / "_inputs" / "pack-with-native-cad.zip"
    with zipfile.ZipFile(mixed, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Pack/plate.step", (FIXTURES / "plate.step").read_bytes())
        z.writestr("Pack/Front Top Cover.x_t", b"**ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        z.writestr("Pack/Housing.SLDPRT", b"not a step file")
        z.writestr("Pack/drawing.pdf", b"%PDF-1.4")
    return [("fixture: nested assembly + loose parts (zip)", pack), ("fixture: nested assembly (one STEP file)", FIXTURES / "nested-assembly.step"),
            ("fixture: zip with a corrupt STEP file", broken), ("fixture: zip with no CAD file", drawings),
            ("fixture: zip with a STEP part and native CAD files", mixed)]


def slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")


# -------------------------------------------------------------------------------------------------------------------------- archive

def truth_entries(zip_path: Path) -> list:
    with zipfile.ZipFile(zip_path) as z:
        return [{"path": i.filename, "size": i.file_size, "sha256": sha(z.read(i))} for i in z.infolist() if not i.filename.endswith("/")]


def describe_extraction(raw: dict, files_dir: Path) -> dict:
    if "error" in raw:
        return {"error": raw["error"]["code"]}
    root = raw["root"]
    strip = lambda p: p[len(root) + 1:]  # noqa: E731
    return {
        "entries": [{"path": strip(e["path"]), "size": e["size"], "sha256": sha((files_dir / str(e["index"])).read_bytes())} for e in raw["entries"]],
        "skipped": [{"path": strip(s["path"]), "reason": s["reason"]} for s in raw["skipped"]],
    }


def stage_archive(zip_path: Path, out: Path) -> tuple:
    """Rust extractor and TypeScript extractor, each against a plain zip reader, then against each other."""
    findings, notes = [], {}
    truth = truth_entries(zip_path)
    rust_dir, ts_dir = out / "rust-files", out / "ts-files"
    rust = run(["cargo", "run", "-q", "-p", "archive", "--example", "expand", "--", zip_path, rust_dir], cwd=ROOT / "core")
    ts = run(["npx", "ts-node", "-r", "tsconfig-paths/register", "scripts/cad-parity.ts", "archive", zip_path, ts_dir], cwd=ROOT / "backend", env={**os.environ, "NODE_NO_WARNINGS": "1"})
    got = {"rust": describe_extraction(json.loads(rust.stdout), rust_dir), "typescript": describe_extraction(json.loads(ts.stdout.strip().splitlines()[-1]), ts_dir)}
    save(out / "truth.json", truth)
    save(out / "rust.json", got["rust"])
    save(out / "typescript.json", got["typescript"])
    by_path = {t["path"]: t for t in truth}
    for who, d in got.items():
        if "error" in d:
            findings.append(finding("archive", f"{who}", detail=f"{who} refused the archive ({d['error']}), a plain zip reader reads {len(truth)} files"))
            continue
        seen = {e["path"] for e in d["entries"]} | {s["path"] for s in d["skipped"]}
        for path in sorted(set(by_path) - seen):
            findings.append(finding("archive", f"{who}:{path}", detail=f"{who} neither extracted nor listed as skipped: a silent drop"))
        for path in sorted(seen - set(by_path)):
            findings.append(finding("archive", f"{who}:{path}", detail=f"{who} produced a file the zip does not hold"))
        for e in d["entries"]:
            t = by_path.get(e["path"])
            if t and (t["size"], t["sha256"]) != (e["size"], e["sha256"]):
                findings.append(finding("archive", f"{who}:{e['path']}", t["sha256"][:12], e["sha256"][:12], "bytes differ from the zip's own"))
    if "error" not in got["rust"] and "error" not in got["typescript"]:
        # python = TypeScript (the production default), cpp = Rust.
        findings += compare_values(got["typescript"]["entries"], got["rust"]["entries"], "entries (order matters: it fixes part ids)", "archive")
        findings += compare_values(got["typescript"]["skipped"], got["rust"]["skipped"], "skipped", "archive")
    elif got["rust"].get("error") != got["typescript"].get("error"):
        findings.append(finding("archive", "refusal", got["typescript"].get("error"), got["rust"].get("error"), "the extractors answer differently"))
    notes["files"] = len(truth)
    return findings, notes, got


# ------------------------------------------------------------------------------------------------------------------------- geometry

def stage_geometry(steps: list, out: Path) -> tuple:
    """The same STEP files, named as the runner names them (position-prefixed), through the Python engine's code and the C++ worker."""
    findings, notes = [], {}
    indir = out / "in"
    indir.mkdir(parents=True, exist_ok=True)
    for i, (name, data) in enumerate(steps):
        (indir / f"{i:04d}_{os.path.basename(name)}").write_bytes(data)
    wire = sorted(os.listdir(indir))

    started = time.time()
    py = run(["docker", "run", "--rm", *user(), "-v", f"{indir}:/in:ro", "-v", f"{ROOT / 'cad-engine'}:/engine:ro", "-v", f"{HERE}:/tool:ro",
              IMAGES["pyocc"], "python", "/tool/pyocc_side.py", "report", "/in"], check=False)
    notes["python_wall_seconds"] = round(time.time() - started, 2)
    cpp_out = out / "cpp"
    cpp_out.mkdir(exist_ok=True)
    started = time.time()
    cpp = run(["docker", "run", "--rm", *user(), "--entrypoint", "/usr/local/bin/geometry-worker", "-v", f"{indir}:/in:ro", "-v", f"{cpp_out}:/out",
               IMAGES["worker"], "--deadline-ms", "600000", "/out", *[f"/in/{w}" for w in wire]], check=False)
    notes["cpp_wall_seconds"] = round(time.time() - started, 2)
    py_report = cpp_report = None
    if py.returncode != 0:
        findings.append(finding("processing", "python engine", detail=f"exit {py.returncode}: {py.stderr.strip()[-300:]}"))
    else:
        try:
            doc = last_json(py.stdout)
            py_report, notes["python_engine_seconds"] = doc["report"], doc["seconds"]
            save(out / "python.report.json", py_report)
        except (ValueError, IndexError, KeyError):
            findings.append(finding("processing", "python engine", detail=f"no report on stdout: {py.stdout.strip()[-300:]}"))
    result = cpp_out / "result.json"
    if cpp.returncode != 0 or not result.exists():
        findings.append(finding("processing", "c++ worker", detail=f"exit {cpp.returncode}: {cpp.stderr.strip()[-300:]}"))
    else:
        cpp_report = json.loads(result.read_text())
        save(out / "cpp.report.json", cpp_report)
    stats = Stats()
    if py_report and cpp_report:
        findings += compare_reports(py_report, cpp_report, stats)
    notes["max_relative_difference"] = {k: float(f"{v:.3g}") for k, v in sorted(stats.max_rel.items())}
    notes["numbers_compared"] = stats.compared
    notes["parts"] = {"python": len(py_report["parts"]) if py_report else None, "cpp": len(cpp_report["parts"]) if cpp_report else None}
    return findings, notes, py_report, cpp_report, wire


# -------------------------------------------------------------------------------------------------------------------------- exports

def id_of(file_name: str) -> str:
    return file_name[:-len(".step")].replace("_", ":")


def measure(directory: Path) -> dict:
    p = run(["docker", "run", "--rm", *user(), "-v", f"{directory}:/d:ro", "-v", f"{ROOT / 'cad-engine'}:/engine:ro", "-v", f"{HERE}:/tool:ro",
             IMAGES["pyocc"], "python", "/tool/pyocc_side.py", "measure", "/d"])
    return last_json(p.stdout)


def stage_exports(wire_dir: Path, py_report, cpp_report, out: Path) -> tuple:
    """Each side's exported part files, reopened as files of their own with the same code, against its own report and against each other."""
    findings, notes = [], {}
    py_dir, cpp_dir = out / "python", ROOT / "never"  # cpp parts live in the geometry stage's output
    py_dir.mkdir(parents=True, exist_ok=True)
    py_report_path = out.parent / "geometry" / "python.report.json"
    run(["docker", "run", "--rm", *user(), "-v", f"{wire_dir}:/in:ro", "-v", f"{py_report_path.parent}:/rep:ro", "-v", f"{py_dir}:/out", "-v", f"{ROOT / 'cad-engine'}:/engine:ro",
         "-v", f"{HERE}:/tool:ro", IMAGES["pyocc"], "python", "/tool/pyocc_side.py", "export", "/in", "/rep/python.report.json", "/out"])
    cpp_dir = out.parent / "geometry" / "cpp" / "parts"
    measured = {"python": measure(py_dir), "cpp": measure(cpp_dir) if cpp_dir.exists() else {}}
    save(out / "measured.json", measured)
    for side, report in (("python", py_report), ("cpp", cpp_report)):
        for part in report["parts"]:
            name = part["id"].replace(":", "_") + ".step"
            m = measured[side].get(name)
            if m is None:
                findings.append(finding("export", f"{side}:{name}", detail=f"the {side} side exported no file for part {part['id']} ({part['name']})"))
                continue
            if m["status"] != "complete" or len(m["parts"]) != 1:
                findings.append(finding("export", f"{side}:{name}", detail=f"reopened as {m['status']} with {len(m['parts'])} parts: {m['problems']}"))
                continue
            got = m["parts"][0]
            for key in ("volume_mm3", "surface_area_mm2", "bounding_box"):
                findings += compare_values(part[key], got[key], f"{side}:{name}.{key} (report vs reopened file)", "export")
    # The two sides' files for the same part, reopened by the same code, must measure the same.
    for name in sorted(set(measured["python"]) & set(measured["cpp"])):
        a, b = measured["python"][name]["parts"], measured["cpp"][name]["parts"]
        if len(a) == 1 and len(b) == 1:
            for key in ("volume_mm3", "surface_area_mm2", "bounding_box"):
                findings += compare_values(a[0][key], b[0][key], f"{name}.{key} (python's export vs c++'s export)", "export")
    notes["files"] = {"python": len(measured["python"]), "cpp": len(measured["cpp"])}
    return findings, notes


# ------------------------------------------------------------------------------------------------------------------------------ e2e

class Engine:
    """A throwaway cad-engine for the Python path (its own port and key, so a developer's running engine is never touched)."""

    def __init__(self, url=None):
        self.url, self.owned = url, url is None

    def __enter__(self):
        if not self.owned:
            return self
        run(["docker", "rm", "-f", "parity-engine"], check=False)
        run(["docker", "run", "-d", "--rm", "--name", "parity-engine", "-p", "127.0.0.1:5056:5055", "-e", f"CAD_ENGINE_API_KEY={ENGINE_KEY}", "-e", "HOST=0.0.0.0", "-e", "PORT=5055",
             IMAGES["engine"], "bash", "-lc", "source /opt/conda/etc/profile.d/conda.sh && conda activate cad-env && exec python -m uvicorn main:app --host 0.0.0.0 --port 5055"])
        self.url = "http://127.0.0.1:5056"
        for _ in range(60):
            if run(["curl", "-s", "-m", "3", f"{self.url}/health"], check=False).returncode == 0:
                return self
            time.sleep(2)
        raise SystemExit("the cad-engine did not become healthy")

    def __exit__(self, *_):
        if self.owned:
            run(["docker", "rm", "-f", "parity-engine"], check=False)


def ts_path(*args) -> dict:
    p = run(["npx", "ts-node", "-r", "tsconfig-paths/register", "scripts/cad-parity.ts", *args], cwd=ROOT / "backend", env={**os.environ, "NODE_NO_WARNINGS": "1", "CAD_ENGINE_API_KEY": ENGINE_KEY})
    return json.loads(p.stdout.strip().splitlines()[-1])


def rust_run(server_port: int, data: bytes, file_name: str) -> dict:
    sys.path.insert(0, str(ROOT / "core/tests"))
    import e2e  # the repository's own end-to-end harness: its stand-in data API and bucket, and its container pair
    e2e.Fake.reset()
    e2e.Fake.zip_bytes = data
    e2e.ROW["file_name"] = file_name
    volume = e2e.docker("volume", "create").stdout.strip()
    worker = runner = None
    started = time.time()
    try:
        worker, runner = e2e.start_pair(server_port, volume)
        finished = e2e.Fake.done.wait(timeout=1200)
        time.sleep(1)
        return {"finished": finished, "calls": list(e2e.Fake.finished), "uploads": dict(e2e.Fake.uploads), "seconds": round(time.time() - started, 2),
                "log": e2e.logs(runner) + e2e.logs(worker) if not finished or not e2e.Fake.finished else ""}
    finally:
        for c in (runner, worker):
            if c:
                e2e.docker("stop", "-t", "2", c, check=False)
        e2e.docker("volume", "rm", "-f", volume, check=False)


def stage_e2e(zip_path: Path, out: Path, engine_url: str, server_port: int) -> tuple:
    findings, notes = [], {}
    started = time.time()
    py = ts_path("python-path", zip_path, engine_url, out / "python-files")
    notes["python_path_seconds"] = round(time.time() - started, 2)
    save(out / "python.json", py)
    rs = rust_run(server_port, zip_path.read_bytes(), zip_path.name)
    notes["rust_path_seconds"] = rs["seconds"]
    if not rs["finished"] or not rs["calls"]:
        findings.append(finding("processing", "rust path", detail=f"the Rust runner reported no result in time. {rs['log'][-600:]}"))
        return findings, notes
    name, call = rs["calls"][-1]
    if name != "cad_runner_mark_analysed":
        save(out / "rust.analysed.json", call)
        rust_error = {"code": call.get("p_code"), "detail": call.get("p_detail")}
        if py["status"] != "failed":
            findings.append(finding("processing", "upload status", py["status"], "failed", f"the Rust runner failed the upload ({rust_error}); the Python path did not"))
        else:
            findings += compare_values(py["error"], rust_error, "upload failure", "processing")
        return findings, notes
    parts_dir = out / "rust-parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    for key, body in rs["uploads"].items():
        (parts_dir / os.path.basename(key)).write_bytes(body)
    analysed = {"report": call["p_result"]["report"], "skipped": call["p_result"]["skipped"]}
    save(out / "rust.analysed.json", analysed)
    rust = ts_path("rust-path", zip_path, out / "rust.analysed.json", parts_dir, out / "rust-files")
    save(out / "rust.json", rust)
    if py["status"] != "done" or rust["status"] != "done":
        findings.append(finding("processing", "upload status", py["status"], rust["status"], f"errors: python {py['error']}, rust {rust['error']}"))
    if py["result"] and rust["result"]:
        stats = Stats()
        findings += compare_reports(py["result"]["report"], rust["result"]["report"], stats)
        findings += compare_values(py["result"]["skipped"], rust["result"]["skipped"], "skipped", "archive")
        notes["max_relative_difference"] = {k: float(f"{v:.3g}") for k, v in sorted(stats.max_rel.items())}
    findings += compare_bom(py["items"], rust["items"])
    findings += compare_values(sorted((f["name"], f["item"]) for f in py["storedFiles"]), sorted((f["name"], f["item"]) for f in rust["storedFiles"]), "bom stored files (name, item)", "bom")
    notes["bom_items"] = {"python": len(py["items"]), "rust": len(rust["items"])}
    return findings, notes


# ----------------------------------------------------------------------------------------------------------------------------- main

def config_differences() -> list:
    """Settings the two paths read separately that may disagree (found by reading both sources, not by running them)."""
    notes = []
    rust_main = (ROOT / "core/crates/runner/src/main.rs").read_text()
    limits = (ROOT / "backend/src/common/resource-limits.ts").read_text()
    compose = (ROOT / "docker-compose.prod.yml").read_text()
    ts = re.search(r"ARCHIVE_MAX_EXPANDED_MB',\s*(\d+)", limits)
    rust = re.search(r"const DEFAULT: u64 = (\d+);", rust_main) if "ARCHIVE_MAX_EXPANDED_MB" in rust_main else None
    if not (ts and rust):
        notes.append("Archive expansion cap: the Rust runner does not read ARCHIVE_MAX_EXPANDED_MB, so a zip between the two caps is accepted by one core and refused by the other.")
    elif ts.group(1) != rust.group(1):
        notes.append(f"Archive expansion cap defaults differ: backend {ts.group(1)} MB, Rust runner {rust.group(1)} MB.")
    if len(re.findall(r"ARCHIVE_MAX_EXPANDED_MB:", compose)) < 2:
        notes.append("docker-compose.prod.yml passes ARCHIVE_MAX_EXPANDED_MB to fewer than both the backend and cad-core.")
    return notes


SOURCES = {"worker": ["geometry-worker/src", "geometry-worker/CMakeLists.txt", "core/crates/runner"], "core": ["core/crates", "core/Cargo.lock"],
           "engine": ["cad-engine"], "pyocc": []}


def _time(stamp: str) -> datetime:
    return datetime.fromisoformat(re.sub(r"\.\d+", "", stamp).replace("Z", "+00:00"))


def provenance() -> list:
    """Each image's build time against the newest commit that touched what it is built from: a stale image says nothing about current sources."""
    out = []
    for key, image in IMAGES.items():
        made = run(["docker", "image", "inspect", image, "--format", "{{.Created}}"], check=False).stdout.strip()
        newest = run(["git", "log", "-1", "--format=%cI", "--", *SOURCES[key]], cwd=ROOT, check=False).stdout.strip() if SOURCES[key] else ""
        out.append({"image": image, "built": made, "sources_last_changed": newest or "n/a", "stale": bool(made and newest and _time(made) < _time(newest))})
    return out


def check_prerequisites(stages: set) -> None:
    need = {"geometry": ["worker", "pyocc"], "exports": ["pyocc"], "e2e": ["worker", "core", "engine"]}
    missing = []
    for stage in stages & set(need):
        for key in need[stage]:
            if run(["docker", "image", "inspect", IMAGES[key]], check=False).returncode != 0 and key not in [m[0] for m in missing]:
                missing.append((key, IMAGES[key]))
    if missing:
        sys.exit("missing image(s):\n" + "\n".join(f"  {name}: {BUILD_HINTS[key]}" for key, name in missing))
    if not (ROOT / "backend/node_modules").exists():
        sys.exit("run `npm ci --legacy-peer-deps` in backend/ first")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--zip", action="append", default=[], help="a zip (or STEP file) to test; repeatable. The repository's fixtures are always included.")
    ap.add_argument("--only", default="archive,geometry,exports,e2e")
    ap.add_argument("--engine-url", help="use a running cad-engine (it must accept CAD_ENGINE_API_KEY=parity-key) instead of starting one")
    args = ap.parse_args()
    stages = set(args.only.split(","))
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    check_prerequisites(stages)
    cases = fixture_cases(out) + [(Path(z).name, Path(z).resolve()) for z in args.zip]

    server = None
    if "e2e" in stages:
        sys.path.insert(0, str(ROOT / "core/tests"))
        import e2e
        server = ThreadingHTTPServer(("0.0.0.0", 0), e2e.Fake)
        threading.Thread(target=server.serve_forever, daemon=True).start()

    all_findings, summary = [], []
    engine = Engine(args.engine_url) if "e2e" in stages else None
    try:
        if engine:
            engine.__enter__()
        for label, path in cases:
            case_dir = out / slug(label)
            print(f"== {label}")
            result = {"case": label, "file": path.name, "stages": {}}
            is_zip = path.suffix.lower() == ".zip"
            steps = []
            wire_dir = case_dir / "geometry" / "in"

            def record(stage, findings, notes):
                for f in findings:
                    f["case"], f["stage"] = label, stage
                all_findings.extend(findings)
                result["stages"][stage] = {"findings": len(findings), "by_category": {c: sum(1 for f in findings if f["category"] == c) for c in sorted({f["category"] for f in findings})}, "notes": notes}
                print(f"   {stage:9} {'ok' if not findings else f'{len(findings)} finding(s)'}")

            if is_zip and "archive" in stages:
                f, n, got = stage_archive(path, case_dir / "archive")
                record("archive", f, n)
            if "geometry" in stages or "exports" in stages:
                if is_zip:
                    got = got if "archive" in stages else None
                    with zipfile.ZipFile(path) as z:
                        entries = [i for i in z.infolist() if not i.filename.endswith("/") and STEP.search(i.filename) and "__MACOSX" not in i.filename and not os.path.basename(i.filename).startswith("._")]
                        steps = [(i.filename, z.read(i)) for i in entries]
                else:
                    steps = [(path.name, path.read_bytes())]
                if not steps:
                    print("   geometry  skipped: the zip holds no STEP file (the e2e stage covers how each path refuses it)")
                    py_report = cpp_report = None
                    f, n, wire = [], {"skipped": "no STEP files"}, []
                else:
                    f, n, py_report, cpp_report, wire = stage_geometry(steps, case_dir / "geometry")
                if "geometry" in stages and steps:
                    record("geometry", f, n)
                if "exports" in stages and py_report and cpp_report:
                    f, n = stage_exports(wire_dir, py_report, cpp_report, case_dir / "exports")
                    record("exports", f, n)
            if "e2e" in stages:
                f, n = stage_e2e(path, case_dir / "e2e", engine.url, server.server_address[1])
                record("e2e", f, n)
            summary.append(result)
    finally:
        if engine:
            engine.__exit__()
        if server:
            server.shutdown()

    save(out / "diff.json", all_findings)
    save(out / "summary.json", {"cases": summary, "configuration_differences": config_differences(), "images": provenance()})
    write_summary(out, summary, all_findings)
    print(f"\n{len(all_findings)} finding(s). Report: {out / 'summary.md'}")
    return 1 if all_findings else 0


def write_summary(out: Path, summary: list, findings: list) -> None:
    sizes = {k: run(["docker", "image", "inspect", v, "--format", "{{.Size}}"], check=False).stdout.strip() for k, v in IMAGES.items()}
    mb = lambda s: f"{int(s) / 1e6:.0f} MB" if s.isdigit() else "n/a"  # noqa: E731
    lines = ["# CAD core parity: Python engine vs Rust runner + C++ worker", "", f"Findings: **{len(findings)}**. Raw reports and per-stage diffs are next to this file.", "",
             "| case | archive | geometry | exports | e2e |", "|---|---|---|---|---|"]
    for r in summary:
        cells = []
        for stage in ("archive", "geometry", "exports", "e2e"):
            s = r["stages"].get(stage)
            cells.append("n/a" if s is None else "pass" if s["findings"] == 0 else "FAIL " + ", ".join(f"{c}:{n}" for c, n in s["by_category"].items()))
        lines.append(f"| {r['case']} | " + " | ".join(cells) + " |")
    lines += ["", "## Timings (wall clock, containers run natively on this host's architecture: indicative only)", "", "| case | python engine | c++ worker | python path e2e | rust path e2e |", "|---|---|---|---|---|"]
    for r in summary:
        g, e = r["stages"].get("geometry", {}).get("notes", {}), r["stages"].get("e2e", {}).get("notes", {})
        lines.append(f"| {r['case']} | {g.get('python_wall_seconds', 'n/a')} s | {g.get('cpp_wall_seconds', 'n/a')} s | {e.get('python_path_seconds', 'n/a')} s | {e.get('rust_path_seconds', 'n/a')} s |")
    lines += ["", f"Image sizes: cad-worker (C++ worker + host) {mb(sizes['worker'])}, cad-core (Rust runner) {mb(sizes['core'])}, python engine {mb(sizes['engine'])}, py-occt reference {mb(sizes['pyocc'])}. Memory and crash rates are not measured here.", ""]
    lines += ["## Images under test", "", "| image | built | its sources last changed | |", "|---|---|---|---|"]
    for i in provenance():
        lines.append(f"| {i['image']} | {i['built'][:19]} | {i['sources_last_changed'][:19]} | {'**STALE: rebuild before drawing conclusions**' if i['stale'] else 'current'} |")
    lines.append("")
    differences = config_differences()
    if differences:
        lines += ["## Configuration differences found by reading both sources", ""] + [f"- {d}" for d in differences] + [""]
    lines += ["## Closeness of agreement (largest relative difference per measurement, among values inside the tolerance too)", ""]
    for r in summary:
        m = r["stages"].get("geometry", {}).get("notes", {}).get("max_relative_difference")
        if m:
            lines.append(f"- {r['case']}: " + ", ".join(f"{k} {v}" for k, v in m.items()))
    lines += ["", "## Unresolved differences", ""]
    if not findings:
        lines.append("None.")
    for f in findings[:60]:
        lines.append(f"- [{f['case']} / {f['stage']} / {f['category']}] `{f['path']}` python={f['python']!r} c++={f['cpp']!r} {f['detail']}")
    if len(findings) > 60:
        lines.append(f"- ... {len(findings) - 60} more in diff.json")
    (out / "summary.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    sys.exit(main())
