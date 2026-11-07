"""Ground-truth check of the plastic feature extraction (documentation/verification tool, not part of the service).

Builds parts of known geometry with OpenCascade (pull direction +Z), sends each to a running cad-engine (/analyze/geometry, family_hint=plastic_molded)
and prints the features the engine returned next to what is physically in the part. Results and their reading: docs/plastic-modeling/feature-extraction-verification.md

Run inside the cad-engine container's cad-env (pythonocc), against the dev service, with its own API key from the environment:
  docker cp docs/plastic-modeling/verification/ground_truth_parts.py <container>:/tmp/ && docker exec <container> /opt/conda/envs/cad-env/bin/python /tmp/ground_truth_parts.py /tmp/gt
The service allows 10 analyses a minute; this script paces itself. Nothing here changes any cost or any service code.
"""
import json, os, sys, time, urllib.request, uuid
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse, BRepAlgoAPI_Common
from OCC.Core.gp import gp_Pnt, gp_Ax2, gp_Dir
from OCC.Core.STEPControl import STEPControl_Writer, STEPControl_AsIs

def box(x, y, z, dx, dy, dz): return BRepPrimAPI_MakeBox(gp_Pnt(x, y, z), dx, dy, dz).Shape()
def cyl(x, y, z, d, r, h): return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, z), gp_Dir(*d)), r, h).Shape()
def cut(a, *bs):
    for b in bs: a = BRepAlgoAPI_Cut(a, b).Shape()
    return a
def fuse(a, *bs):
    for b in bs: a = BRepAlgoAPI_Fuse(a, b).Shape()
    return a
def tray(L, W, H, t=2.5):  # open at +Z, floor at z=0, centred on origin in XY
    return cut(box(-L/2, -W/2, 0, L, W, H), box(-L/2+t, -W/2+t, t, L-2*t, W-2*t, H))

PARTS = {}
# name: (shape, expected dict)
PARTS["P1_plate_4_through_holes"] = (cut(box(-40, -25, 0, 80, 50, 4), *[cyl(x, y, -1, (0,0,1), 3, 6) for x in (-25, 25) for y in (-12, 12)]),
    {"SimpleHole": 4, "PlanarFace": ">=1"})
PARTS["P2_counterbored_hole"] = (cut(box(-20, -20, 0, 40, 40, 10), cyl(0, 0, 6, (0,0,1), 5, 5), cyl(0, 0, -1, (0,0,1), 2.5, 12)),
    {"MultiStepHole": 1})
PARTS["P3_side_hole_in_tray"] = (cut(tray(60, 40, 20), cyl(-40, 0, 10, (1,0,0), 2.5, 20)),
    {"SimpleHole": 1, "side action": "a SlideBundle or a LifterBundle (the engine does not decide which: slide_alternative)", "note": "hole axis is perpendicular to the pull"})
PARTS["P4_tray_3_ribs"] = (fuse(tray(100, 60, 15), *[box(-48, y-0.75, 2.5, 96, 1.5, 10) for y in (-15, 0, 15)]),
    {"Rib": 3, "note": "three straight 1.5 mm ribs 10 mm high"})
PARTS["P5_tube_curved_wall"] = (cut(cyl(0, 0, 0, (0,0,1), 15, 40), cyl(0, 0, -1, (0,0,1), 12.5, 42)),
    {"CurvedWall": ">=1", "note": "a straight tube: the cylinder walls are parallel to the pull"})
def dome(r_out, r_in, z0, h):  # cylinder h tall plus an upper hemisphere, hollowed, open at z=z0 (no geometry below the base)
    up = box(-r_out-1, -r_out-1, z0+h, 2*r_out+2, 2*r_out+2, r_out+1)
    outer = fuse(cyl(0, 0, z0, (0,0,1), r_out, h), BRepAlgoAPI_Common(BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, z0+h), r_out).Shape(), up).Shape())
    inner = fuse(cyl(0, 0, z0-1, (0,0,1), r_in, h+1), BRepAlgoAPI_Common(BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, z0+h), r_in).Shape(), up).Shape())
    return cut(outer, inner)
PARTS["P6_domed_cup_curved_surface"] = (dome(25, 22.5, 0, 20),
    {"CurvedSurface": ">=1", "CurvedWall": ">=1", "note": "a domed cup, no undercut: nothing should need a side action"})
PARTS["P7_block_pocket_along_pull"] = (cut(box(-30, -30, 0, 60, 60, 20), box(-10, -10, 10, 20, 20, 11)),
    {"Void": "none by design: a pocket along the pull needs no tooling and stays in PlanarFace (side_actions.py docstring)", "PlanarFace": "faces 11, area 12800 mm2"})
PARTS["P8_block_side_pocket"] = (cut(box(-30, -30, 0, 60, 60, 20), box(-31, -10, 5, 21, 20, 10)),
    {"Void": 1, "side action": "a SlideBundle or a LifterBundle (undecided by design)", "note": "pocket opening sideways: an undercut"})
PARTS["P9_tray_internal_undercut"] = (cut(tray(60, 40, 25), box(-29, -5, 8, 2, 10, 6)),
    {"Void": "no_accessible_direction (a pocket in the inner wall is not visible from any side)", "note": "pocket cut into the inside of the wall"})
PARTS["P10_plain_block_sharp_edges"] = (box(-20, -20, 0, 40, 40, 10),
    {"SharpEdge": "not assessed by design"})


# Added after the first pass: variants and combinations.
PARTS["B1_blind_hole_along_pull"] = (cut(box(-20, -20, 0, 40, 40, 15), cyl(0, 0, 5, (0,0,1), 4, 11)), {"SimpleHole": "blind, diameter 8, depth 10"})
PARTS["S1_two_side_holes_same_axis"] = (cut(box(-30, -30, 0, 60, 60, 20), cyl(-40, -12, 10, (1,0,0), 3, 25), cyl(-40, 12, 10, (1,0,0), 3, 25)),
    {"SimpleHole": "2 blind, diameter 6, depth 15", "bundle": "one bundle of 2"})
PARTS["M1_side_counterbore"] = (cut(box(-30, -30, 0, 60, 60, 20), cyl(-40, 0, 10, (1,0,0), 6, 15), cyl(-40, 0, 10, (1,0,0), 3, 40)),
    {"MultiStepHole": "steps: diameter 12 for 5 mm, diameter 6 for 25 mm"})
PARTS["C1_two_side_pockets_18mm_apart"] = (cut(box(-30, -30, 0, 60, 60, 20), box(-31, -20, 5, 21, 10, 10), box(-31, 8, 5, 21, 10, 10)),
    {"Void": 2, "bundle": "one bundle of 2", "ComboVoid": "none: a combo needs a void AND a hole"})
PARTS["C2_two_side_pockets_3mm_apart"] = (cut(box(-30, -30, 0, 60, 60, 20), box(-31, -14, 5, 21, 10, 10), box(-31, -1, 5, 21, 10, 10)),
    {"Void": 2, "bundle": "one bundle of 2", "ComboVoid": "none: a combo needs a void AND a hole"})
PARTS["C3_side_hole_next_to_pocket"] = (cut(box(-30, -30, 0, 60, 60, 20), box(-31, -14, 5, 21, 10, 10), cyl(-40, 3, 10, (1,0,0), 3, 25)),
    {"ComboVoid": 1})

def write_step(name, shape, d):
    w = STEPControl_Writer(); w.Transfer(shape, STEPControl_AsIs); p = f"{d}/{name}.step"; assert w.Write(p) == 1; return p

def post(path, key, family="plastic_molded", pull="z"):
    b = uuid.uuid4().hex; data = open(path, "rb").read()
    body = b""
    for k, v in (("strategy", "balanced"), ("family_hint", family), ("pull_direction", pull), ("force_reanalysis", "true")):
        body += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    body += f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{os.path.basename(path)}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + data + f"\r\n--{b}--\r\n".encode()
    req = urllib.request.Request("http://localhost:5055/analyze/geometry", data=body, headers={"Content-Type": f"multipart/form-data; boundary={b}", "X-API-Key": key})
    try:
        return json.load(urllib.request.urlopen(req, timeout=300))
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code, "_body": e.read()[:300].decode("utf8", "replace")}

def find(o, key):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == key: return v
            r = find(v, key)
            if r is not None: return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, key)
            if r is not None: return r

def summary(r):
    if "_http_error" in r: return f"HTTP {r['_http_error']}"
    mi = r["geometry_features"]["manufacturing_features"]["manufacturing_intelligence"]
    rc = mi["features"]["recognition_core"]; g = rc["feature_graph"]; sa = rc["side_actions"]
    types = {}
    for it in g["items"]:
        types[it["feature_type"]] = types.get(it["feature_type"], 0) + 1
    return {"family": mi.get("detected_family"), "items": types, "bundles": [(b["feature_type"], b["count"]) for b in sa["bundles"]],
            "undercut_mm2": rc["pull_direction"]["undercut_area_mm2"], "legacy_rib_count": mi["features"]["rib_count"], "not_yet_recognized": g["not_yet_recognized"]}

if __name__ == "__main__":
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    key = os.environ["CAD_ENGINE_API_KEY"]
    only = sys.argv[2:]  # optional part-name prefixes
    for name, (shape, exp) in PARTS.items():
        if only and not any(name.startswith(o) for o in only): continue
        r = post(write_step(name, shape, out), key)
        json.dump(r, open(f"{out}/{name}.response.json", "w"))
        print(f"## {name}\n   expected: {exp}\n   engine  : {summary(r)}", flush=True)
        time.sleep(7)  # the service allows 10 analyses a minute
