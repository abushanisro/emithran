#!/usr/bin/env python3
"""
Differential test: the Rust nester must answer like the Python/shapely nester it replaces (cad-engine/sheet_metal/nesting.py), because
its result feeds material cost. Generates seeded cases (rectangles, L/T shapes, trapezoids, stars, wavy outlines; several sheets,
kerfs, margins and rotation sets), runs both, and compares the answers: refusal vs result, parts_per_sheet, every placement,
utilization, sheets_required and capped. Reports how many agree exactly and lists every difference.

  python3 -m venv venv && venv/bin/pip install 'shapely>=2,<3'
  cargo build --release -p nesting        (from core/)
  venv/bin/python core/crates/nesting/tests/differential.py [cases=120] [seed=7]
  venv/bin/python core/crates/nesting/tests/differential.py heavy      the 1,800-placement real-world case
"""
import json
import math
import random
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "cad-engine"))
from sheet_metal import nesting  # noqa: E402  (the Python nester under test, imported in place)

NESTER = ROOT / "core/target/release/nester"


def rect(w, h):
    return [[0, 0], [w, 0], [w, h], [0, h]]


def l_shape(w, h, t):
    return [[0, 0], [w, 0], [w, t], [t, t], [t, h], [0, h]]


def t_shape(w, h, t):
    return [[0, h - t], [w / 2 - t / 2, h - t], [w / 2 - t / 2, 0], [w / 2 + t / 2, 0], [w / 2 + t / 2, h - t], [w, h - t], [w, h], [0, h]]


def trapezoid(w, h, k):
    return [[0, 0], [w, 0], [w - k, h], [k, h]]


def star(rng, r, n):
    return [[r * (0.55 + 0.45 * rng.random()) * math.cos(2 * math.pi * i / n), r * (0.55 + 0.45 * rng.random()) * math.sin(2 * math.pi * i / n)] for i in range(n)]


def wavy(rng, w, h, n):
    top = [[w * i / n, h + 0.06 * h * math.sin(i * 0.9 + rng.random())] for i in range(n, -1, -1)]
    return [[0, 0], [w, 0]] + top


def case(rng, i):
    kind = rng.choice(["rect", "l", "t", "trap", "star", "wavy", "circle"])
    s = rng.choice([20, 35, 50, 80, 120])
    if kind == "rect":
        outline = rect(s * rng.choice([1, 1.5, 2.3]), s)
    elif kind == "l":
        outline = l_shape(s * 1.6, s * 1.4, s * rng.choice([0.3, 0.45]))
    elif kind == "t":
        outline = t_shape(s * 1.8, s * 1.3, s * 0.4)
    elif kind == "trap":
        outline = trapezoid(s * 1.5, s, s * rng.choice([0.2, 0.4]))
    elif kind == "star":
        outline = star(rng, s, rng.choice([7, 11, 18, 30]))
    elif kind == "wavy":
        outline = wavy(rng, s * 1.7, s, 47)
    else:
        outline = [[s / 2 * math.cos(2 * math.pi * k / 24) + s / 2, s / 2 * math.sin(2 * math.pi * k / 24) + s / 2] for k in range(24)]
    # sheets sized so a case holds tens of parts (the Python nester must finish each in seconds)
    sheet = rng.choice([(300, 400), (500, 700), (600, 1000), (1000, 1250)])
    return {
        "kind": kind,
        "outline_points_mm": outline,
        "holes_mm": [],
        "sheet_width_mm": float(sheet[0]),
        "sheet_length_mm": float(sheet[1]),
        "quantity": rng.choice([1, 7, 40, 250]),
        "kerf_mm": rng.choice([0.0, 0.0, 0.5, 1.5, 3.0]),
        "edge_margin_mm": rng.choice([0.0, 2.0, 2.0, 5.0]),
        "allowed_rotations_deg": rng.choice([None, [0.0], [0.0, 180.0], [0.0, 90.0, 180.0, 270.0], [0.0, 45.0, 90.0, 135.0]]),
    }


def run_rust(request):
    started = time.time()
    out = subprocess.run([str(NESTER)], input=json.dumps({k: v for k, v in request.items() if k != "kind"}), capture_output=True, text=True, check=True)
    return json.loads(out.stdout), time.time() - started


def run_python(request):
    started = time.time()
    result, reason = nesting.compute_true_nest(**{k: v for k, v in request.items() if k != "kind"})
    return result, reason, time.time() - started


def differences(py, reason, rust):
    if py is None:
        return [] if (not rust["ok"] and rust["reason"].split(" ")[0:3] == reason.split(" ")[0:3]) else [f"python refused ({reason[:60]!r}), rust: {rust.get('reason', 'a result')[:60]!r}"]
    if not rust["ok"]:
        return [f"rust refused ({rust['reason'][:70]!r}) but python answered {py['parts_per_sheet']} parts"]
    r = rust["result"]
    found = []
    for key in ("parts_per_sheet", "sheets_required", "capped"):
        if py[key] != r[key]:
            found.append(f"{key}: python {py[key]} rust {r[key]}")
    if abs(py["utilization_pct"] - r["utilization_pct"]) > 0.051:
        found.append(f"utilization: python {py['utilization_pct']} rust {r['utilization_pct']}")
    if py["parts_per_sheet"] == r["parts_per_sheet"]:
        bad = [i for i, (a, b) in enumerate(zip(py["placements"], r["placements"])) if abs(a["x_mm"] - b["x_mm"]) > 1e-3 or abs(a["y_mm"] - b["y_mm"]) > 1e-3 or a["rotation_deg"] != b["rotation_deg"]]
        if bad:
            found.append(f"{len(bad)} of {len(r['placements'])} placements differ (first #{bad[0]}: python {py['placements'][bad[0]]} rust {r['placements'][bad[0]]})")
    return found


def heavy():
    """The case that made the backend wait 13-30 s per sheet: a small part on a large sheet (about 1,800 placements)."""
    base = {"holes_mm": [], "sheet_width_mm": 2500.0, "sheet_length_mm": 5000.0, "quantity": 5000, "edge_margin_mm": 2.0, "allowed_rotations_deg": None}
    cases = [
        {"kind": "53x123 rect, kerf 0", "outline_points_mm": rect(53, 123), "kerf_mm": 0.0, **base},
        {"kind": "53x123 rect, kerf 2", "outline_points_mm": rect(53, 123), "kerf_mm": 2.0, **base},
        {"kind": "L 60x50, kerf 1.5", "outline_points_mm": l_shape(60, 50, 20), "kerf_mm": 1.5, **base},
    ]
    failed = 0
    for request in cases:
        py, reason, tp = run_python(request)
        rust, tr = run_rust(request)
        found = differences(py, reason, rust)
        parts = rust["result"]["parts_per_sheet"] if rust["ok"] else "-"
        print(f"{'ok  ' if not found else 'FAIL'} {request['kind']:<22} {parts} parts   python {tp:6.1f} s   rust {tr:6.3f} s   {tp / max(tr, 1e-9):6.0f}x")
        for f in found:
            print("     ", f)
        failed += bool(found)
    sys.exit(1 if failed else 0)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "heavy":
        heavy()
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 120
    rng = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 7)
    same = 0
    t_py = t_rust = 0.0
    mismatches = []
    for i in range(count):
        request = case(rng, i)
        py, reason, tp = run_python(request)
        rust, tr = run_rust(request)
        t_py, t_rust = t_py + tp, t_rust + tr
        found = differences(py, reason, rust)
        if not found:
            same += 1
        else:
            mismatches.append((i, request, found))
        if (i + 1) % 20 == 0:
            print(f"  {i + 1}/{count} cases, {same} identical so far (python {t_py:.1f}s, rust {t_rust:.2f}s)", flush=True)
    print(f"\n{same}/{count} cases identical (parts, every placement, utilization, sheets, capped)")
    print(f"total time: python {t_py:.1f} s, rust {t_rust:.2f} s ({t_py / max(t_rust, 1e-9):.0f}x)")
    for i, request, found in mismatches:
        short = {k: v for k, v in request.items() if k not in ("outline_points_mm", "holes_mm")}
        print(f"\n#{i} {short}")
        for f in found:
            print("   ", f)
    sys.exit(1 if mismatches else 0)


if __name__ == "__main__":
    main()
