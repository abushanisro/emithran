"""
Side actions: the parts of the mold that move sideways (slides, lifters, side cores) and what they form.

READINGS. The staged variables define these concepts only by their notes ("accessible direction", "bundling", "pitch between holes or voids"), not by an algorithm.
What is implemented is a reading of those notes, stated here and carried in each result's `reading` so no one takes it for the vendor's rule:

* Void: a region the two main mold halves cannot form and that is not a round hole. Its faces are the faces covered along the pull direction (undercut) joined
  through the concave walls that bridge two of them (the back and side walls of a pocket under an overhang). A void the halves CAN form (a pocket along the
  pull) needs no tooling beyond As Molded and stays in the face features. Its accessible direction is the direction from which most of its surface is visible
  (the way a core would be pulled), found by the same depth-buffer visibility as the pull direction.
* ComboVoid: voids and obscured holes that share an accessible direction (within drawDirectionOrthogonalEpsilon) and lie within maxGCDPitch of each other: one
  core makes the group, so the group replaces its members.
* Slide / Lifter bundle: side actions that share an axis (within drawDirectionOrthogonalEpsilon), lie within maxGCDPitch (gap between their extents) and overlap
  along that axis by at least minActionGcdsDepthOverlap, and whose axis is within drawDirectionOrthogonalEpsilonForSlides (lifters: ...ForLifters) of square to the
  pull. A bundle's width is its extent across the parting plane (limit maxActionLength), its stroke its extent along its axis (limit maxCorePullStrokeLength);
  its size class is its width against the staged thresholds. Slide or lifter when both fit is NOT decided here: it depends on the clearance beside the part.
"""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Sequence, Set, Tuple

from .mesh import FaceMesh
from .pull_direction import AXES, undercut_flags
from .vec import Vec, angle_between_axes_deg, canonical, cross, dot, norm, sub, unit

READING = "side_action_reading_v1"
MIN_VOID_AREA_MM2 = 1.0  # below this a cluster is tessellation noise, not a feature (reported as ignored)
UNDERCUT_FACE_FRACTION = 0.5  # a face is an undercut face when at least this share of its area is covered along the pull


def _key(v: Vec) -> Tuple[int, int, int]:
    return (round(v[0] * 1000), round(v[1] * 1000), round(v[2] * 1000))


class _DSU:
    def __init__(self) -> None:
        self.p: Dict[int, int] = {}

    def find(self, x: int) -> int:
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a: int, b: int) -> None:
        self.p[self.find(a)] = self.find(b)


def _face_edges(meshes: Sequence[FaceMesh]) -> Dict[Tuple, List[Tuple[int, Any]]]:
    """Mesh edge (rounded vertex pair) -> the (face index, triangle) that carry it."""
    edges: Dict[Tuple, List[Tuple[int, Any]]] = defaultdict(list)
    for f in meshes:
        for t in f.triangles:
            a, b, c = (_key(v) for v in t.vertices)
            for e in ((a, b), (b, c), (c, a)):
                edges[tuple(sorted(e))].append((f.index, t))
    return edges


def _face_adjacency(edges: Dict[Tuple, List[Tuple[int, Any]]]) -> Dict[Tuple[int, int], bool]:
    """(face a, face b) with a < b -> True when ANY shared edge is concave (the neighbour lies on the outer side of the face's plane)."""
    adj: Dict[Tuple[int, int], bool] = {}
    for tris in edges.values():
        for i in range(len(tris)):
            for j in range(i + 1, len(tris)):
                (fa, ta), (fb, tb) = tris[i], tris[j]
                if fa == fb:
                    continue
                concave = dot(sub(tb.centroid, ta.centroid), ta.normal) > 1e-6
                k = (min(fa, fb), max(fa, fb))
                adj[k] = adj.get(k, False) or concave
    return adj


def _extent(points: Iterable[Vec], axis: Vec) -> Tuple[float, float]:
    vals = [dot(p, axis) for p in points]
    return (min(vals), max(vals)) if vals else (0.0, 0.0)


def _faces_vertices(by_index: Dict[int, FaceMesh], face_ids: Iterable[int]) -> List[Vec]:
    return [v for fid in face_ids if fid in by_index for t in by_index[fid].triangles for v in t.vertices]


def _perp_basis(d: Vec) -> Tuple[Vec, Vec]:
    a = (1.0, 0.0, 0.0) if abs(d[0]) < 0.9 else (0.0, 1.0, 0.0)
    e1 = unit(cross(d, a))
    return e1, cross(d, e1)


def _bbox_gap(a: Tuple[Vec, Vec], b: Tuple[Vec, Vec]) -> float:
    """Distance between two axis-aligned boxes (0 when they touch or overlap)."""
    d = [max(0.0, a[0][i] - b[1][i], b[0][i] - a[1][i]) for i in range(3)]
    return math.sqrt(sum(x * x for x in d))


def _bbox(points: Sequence[Vec]) -> Tuple[Vec, Vec]:
    return ((min(p[0] for p in points), min(p[1] for p in points), min(p[2] for p in points)),
            (max(p[0] for p in points), max(p[1] for p in points), max(p[2] for p in points)))


def find_voids(meshes: Sequence[FaceMesh], pull: Vec, hole_face_ids: Set[int], undrafted_deg: float) -> Dict[str, Any]:
    by_index = {f.index: f for f in meshes}
    flags = undercut_flags(meshes, pull, undrafted_deg)
    undercut: Set[int] = set()
    for f in meshes:
        if f.index in hole_face_ids or not f.triangles:
            continue
        covered = sum(t.area for t, c in zip(f.triangles, flags[f.index]) if c)
        if f.area > 0 and covered / f.area >= UNDERCUT_FACE_FRACTION:
            undercut.add(f.index)
    if not undercut:
        return {"voids": [], "ignored_clusters": 0}

    adj = _face_adjacency(_face_edges(meshes))
    dsu = _DSU()
    for fid in undercut:
        dsu.find(fid)
    # undercut faces that touch each other belong together
    for (a, b) in adj:
        if a in undercut and b in undercut:
            dsu.union(a, b)
    # a wall that is concave to two undercut faces (the back or side of a pocket under an overhang) bridges them
    bridges: Dict[int, Set[int]] = defaultdict(set)
    for (a, b), concave in adj.items():
        if not concave:
            continue
        for wall, other in ((a, b), (b, a)):
            if wall not in undercut and wall not in hole_face_ids and other in undercut:
                bridges[wall].add(other)
    for wall, touched in bridges.items():
        if len(touched) >= 2:
            ordered = sorted(touched)
            for o in ordered[1:]:
                dsu.union(ordered[0], o)
            dsu.union(wall, ordered[0])

    clusters: Dict[int, Set[int]] = defaultdict(set)
    for fid in list(dsu.p):
        clusters[dsu.find(fid)].add(fid)

    voids: List[Dict[str, Any]] = []
    ignored = 0
    for faces in clusters.values():
        verts = _faces_vertices(by_index, faces)
        area = sum(by_index[f].area for f in faces)
        if area < MIN_VOID_AREA_MM2 or not verts:
            ignored += 1
            continue
        voids.append({"face_ids": sorted(faces), "area_mm2": area, "vertices": verts})
    if not voids:
        return {"voids": [], "ignored_clusters": ignored}

    # accessible direction: the signed axis from which most of the cluster's surface is visible
    flag_cache: Dict[Tuple[int, int, int], Dict[int, List[bool]]] = {}

    def covered_along(d: Vec) -> Dict[int, List[bool]]:
        k = tuple(round(c * 1000) for c in canonical(d))
        if k not in flag_cache:
            flag_cache[k] = undercut_flags(meshes, canonical(d), undrafted_deg)
        return flag_cache[k]

    eps = math.sin(math.radians(undrafted_deg))
    out: List[Dict[str, Any]] = []
    for v in sorted(voids, key=lambda x: -x["area_mm2"]):
        faces = v["face_ids"]
        tris = [(fid, t, i) for fid in faces for i, t in enumerate(by_index[fid].triangles)]
        mean = (sum(t.normal[0] * t.area for _, t, _ in tris), sum(t.normal[1] * t.area for _, t, _ in tris), sum(t.normal[2] * t.area for _, t, _ in tris))
        candidates: List[Vec] = list(AXES)
        if norm(mean) > 1e-9:
            m = canonical(mean)
            if all(angle_between_axes_deg(m, c) > 2.0 for c in candidates):
                candidates.append(m)
        best: Tuple[float, Vec] = (-1.0, (0.0, 0.0, 1.0))
        for d in candidates:
            cov = covered_along(d)
            for sign in (1.0, -1.0):
                s = (d[0] * sign, d[1] * sign, d[2] * sign)
                seen = sum(t.area for fid, t, i in tris if dot(t.normal, s) > eps and not cov[fid][i])
                if seen > best[0]:
                    best = (seen, s)
        seen_area, s = best
        lo, hi = _extent(v["vertices"], s)
        facing = sum(max(0.0, dot(t.normal, s)) * t.area for _, t, _ in tris if dot(t.normal, s) > eps)
        curved = sum(by_index[f].area for f in faces if by_index[f].surface != "plane")
        out.append({
            "face_ids": faces, "area_mm2": round(v["area_mm2"], 2), "accessible_direction": [round(c, 5) for c in s],
            "visible_area_mm2": round(seen_area, 2), "opening_area_mm2": round(facing, 2),
            "depth_mm": round(hi - lo, 3), "equivalent_diameter_mm": round(2.0 * math.sqrt(facing / math.pi), 3) if facing > 0 else 0.0,
            "curved_area_ratio": round(curved / v["area_mm2"], 3),
            "angle_to_pull_deg": round(angle_between_axes_deg(s, pull), 2),
            "_vertices": v["vertices"], "_direction": s,
        })
    for i, v in enumerate(out, 1):
        v["id"] = f"void-{i}"
    return {"voids": out, "ignored_clusters": ignored}


def _action_items(voids: List[Dict[str, Any]], holes: List[Dict[str, Any]], by_index: Dict[int, FaceMesh], pull: Vec, along_pull_deg: float) -> List[Dict[str, Any]]:
    """Everything that needs a side action: voids, and holes whose axis is not along the pull."""
    items: List[Dict[str, Any]] = []
    for v in voids:
        pts = v["_vertices"]
        items.append({"id": v["id"], "kind": "void", "direction": v["_direction"], "signed": True, "bbox": _bbox(pts), "points": pts, "face_ids": v["face_ids"]})
    for h in holes:
        if h["angle_to_pull_deg"] <= along_pull_deg:
            continue
        pts = _faces_vertices(by_index, h["face_ids"])
        if pts:
            items.append({"id": h["id"], "kind": "hole", "direction": tuple(h["axis"]), "signed": False, "bbox": _bbox(pts), "points": pts, "face_ids": h["face_ids"]})
    return items


def _compatible(a: Dict[str, Any], b: Dict[str, Any], eps_deg: float, pitch: float, min_overlap: float) -> bool:
    """Same axis (within the bundling epsilon), within the pitch of each other, overlapping along the axis by the minimum."""
    da, db = a["direction"], b["direction"]
    if a["signed"] and b["signed"]:
        if math.degrees(math.acos(max(-1.0, min(1.0, dot(unit(da), unit(db)))))) > eps_deg:
            return False
    elif angle_between_axes_deg(da, db) > eps_deg:
        return False
    if _bbox_gap(a["bbox"], b["bbox"]) > pitch:
        return False
    axis = unit(da)
    (alo, ahi), (blo, bhi) = _extent(a["points"], axis), _extent(b["points"], axis)
    return min(ahi, bhi) - max(alo, blo) >= min_overlap


def _groups(items: List[Dict[str, Any]], rules: Dict[str, float]) -> List[List[Dict[str, Any]]]:
    dsu = _DSU()
    for i in range(len(items)):
        dsu.find(i)
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if _compatible(items[i], items[j], rules["drawDirectionOrthogonalEpsilon"], rules["maxGCDPitch"], rules["minActionGcdsDepthOverlap"]):
                dsu.union(i, j)
    groups: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    for i, it in enumerate(items):
        groups[dsu.find(i)].append(it)
    return list(groups.values())


def _mean_direction(group: List[Dict[str, Any]]) -> Vec:
    ref = group[0]["direction"]
    sx = sy = sz = 0.0
    for it in group:
        d = unit(it["direction"])
        if dot(d, ref) < 0:
            d = (-d[0], -d[1], -d[2])
        sx, sy, sz = sx + d[0], sy + d[1], sz + d[2]
    return unit((sx, sy, sz))


def combine_and_bundle(
    voids: List[Dict[str, Any]], holes: List[Dict[str, Any]], meshes: Sequence[FaceMesh], pull: Vec, rules: Dict[str, float], along_pull_deg: float,
) -> Dict[str, Any]:
    by_index = {f.index: f for f in meshes}
    items = _action_items(voids, holes, by_index, pull, along_pull_deg)

    # ComboVoid: a group that holds a void AND a hole is made by one core, so it replaces its members.
    combos: List[Dict[str, Any]] = []
    consumed: Set[str] = set()
    for g in _groups(items, rules):
        kinds = {it["kind"] for it in g}
        if kinds == {"void", "hole"}:
            pts = [p for it in g for p in it["points"]]
            d = _mean_direction(g)
            combos.append({
                "id": f"combo-{len(combos) + 1}", "member_ids": sorted(it["id"] for it in g), "direction": d, "signed": True, "kind": "combo", "bbox": _bbox(pts), "points": pts,
                "face_ids": sorted({f for it in g for f in it["face_ids"]}),
            })
            consumed.update(it["id"] for it in g)
    remaining = [it for it in items if it["id"] not in consumed] + combos

    # Bundles: only actions square enough to the pull for a slide (or a lifter) to serve them.
    bundles: List[Dict[str, Any]] = []
    unbundled: List[Dict[str, Any]] = []
    eligible: List[Dict[str, Any]] = []
    for it in remaining:
        from_square = 90.0 - angle_between_axes_deg(it["direction"], pull)
        it["from_square_deg"] = from_square
        (eligible if from_square <= rules["drawDirectionOrthogonalEpsilonForSlides"] else unbundled).append(it)
    for g in _groups(eligible, rules):
        d = _mean_direction(g)
        pts = [p for it in g for p in it["points"]]
        e_width = unit(cross(pull, d)) if norm(cross(pull, d)) > 1e-6 else _perp_basis(d)[0]
        wlo, whi = _extent(pts, e_width)
        slo, shi = _extent(pts, d)
        width, stroke = whi - wlo, shi - slo
        worst = max(it["from_square_deg"] for it in g)
        lifter_ok = worst <= rules["drawDirectionOrthogonalEpsilonForLifters"]
        thresholds = (rules["smallLifterBundleWidthThreshold"], rules["mediumLifterBundleWidthThreshold"]) if lifter_ok else (rules["smallSlideBundleWidthThreshold"], rules["mediumSlideBundleWidthThreshold"])
        size = "small" if width < thresholds[0] else "medium" if width < thresholds[1] else "large"
        bundles.append({
            "feature_type": "LifterBundle" if lifter_ok else "SlideBundle",
            "slide_alternative": lifter_ok,  # a bundle a lifter can serve a slide can serve too: which is not decided here (clearance beside the part)
            "member_ids": sorted(it["id"] for it in g), "count": len(g), "direction": [round(c, 5) for c in d],
            "width_mm": round(width, 3), "stroke_mm": round(stroke, 3), "size_class": size, "worst_from_square_deg": round(worst, 2),
            "exceeds_max_action_length": width > rules["maxActionLength"], "exceeds_max_stroke": stroke > rules["maxCorePullStrokeLength"],
            "face_ids": sorted({f for it in g for f in it["face_ids"]}),
        })
    bundles.sort(key=lambda b: (b["feature_type"], -b["count"], b["member_ids"]))
    for i, b in enumerate(bundles, 1):
        b["id"] = f"bundle-{i}"
    out_combos = [{
        "id": c["id"], "member_ids": c["member_ids"], "direction": [round(x, 5) for x in c["direction"]], "face_ids": c["face_ids"],
        "angle_to_pull_deg": round(angle_between_axes_deg(c["direction"], pull), 2),
        "extent_mm": [round(c["bbox"][1][i] - c["bbox"][0][i], 3) for i in range(3)],
    } for c in combos]
    return {
        "combo_voids": out_combos, "consumed_ids": sorted(consumed), "bundles": bundles,
        "unbundled_oblique": [{"id": it["id"], "kind": it["kind"], "from_square_deg": round(it["from_square_deg"], 2)} for it in unbundled],
    }
