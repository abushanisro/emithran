"""
Tests for bend_relationships.compute_bend_flange_relationships -- verifies
the real geometric signal (fold_relative_orientation, flange_width_mm) this
closeout-plan Phase 5 feasibility spike established, against a synthetic
fixture set covering the cases the original heuristic was rejected for:
ordinary U-channels, box corners, tight double bends, and hem/return-flange
candidates.

Fixtures are built by sweeping a rectangular sheet-thickness profile along a
Line-Arc-Line-Arc-Line wire (a real, standard OCC technique -- this is
literally how a press-brake-formed part is shaped: flat, radiused bend,
flat, radiused bend, flat). No STEP file needed; see
test_flat_pattern_outline.py for the established convention this follows.

Requires pythonocc-core -- run inside the cad-env conda environment, e.g.:
    conda run -n <env-with-pythonocc-core> pytest test_bend_relationships.py -v
"""
import math

import pytest

pytest.importorskip("OCC")

from OCC.Core.BRepAdaptor import BRepAdaptor_Surface  # type: ignore
from OCC.Core.BRepBuilderAPI import (  # type: ignore
    BRepBuilderAPI_MakeEdge,
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakeWire,
)
from OCC.Core.BRepOffsetAPI import BRepOffsetAPI_MakePipe  # type: ignore
from OCC.Core.GC import GC_MakeArcOfCircle  # type: ignore
from OCC.Core.GeomAbs import GeomAbs_Cylinder  # type: ignore
from OCC.Core.gp import gp_Ax2, gp_Circ, gp_Dir, gp_Pnt  # type: ignore
from OCC.Core.TopAbs import TopAbs_FACE  # type: ignore
from OCC.Core.TopExp import TopExp_Explorer  # type: ignore
from OCC.Core.TopoDS import topods  # type: ignore

from sheet_metal.bend_relationships import compute_bend_flange_relationships

THICKNESS_MM = 2.0
RADIUS_MM = 3.0
WIDTH_MM = 50.0


def make_bent_sheet(seg_lens, angles_deg, thickness_mm=THICKNESS_MM, radius_mm=RADIUS_MM, width_mm=WIDTH_MM):
    """
    seg_lens: lengths of the straight segments (len == len(angles_deg) + 1).
    angles_deg: signed bend angle at each joint (positive/negative = the two
    real, opposite rotation senses a press brake can fold in).
    """
    pt = gp_Pnt(0, 0, 0)
    dx, dz = 1.0, 0.0
    edges = []
    for i, seg_len in enumerate(seg_lens):
        end = gp_Pnt(pt.X() + dx * seg_len, 0, pt.Z() + dz * seg_len)
        edges.append(BRepBuilderAPI_MakeEdge(pt, end).Edge())
        pt = end
        if i < len(angles_deg):
            angle_rad = math.radians(angles_deg[i])
            turn_sign = 1.0 if angle_rad >= 0 else -1.0
            nx, nz = -dz * turn_sign, dx * turn_sign
            center = gp_Pnt(pt.X() + nx * radius_mm, 0, pt.Z() + nz * radius_mm)
            circ = gp_Circ(gp_Ax2(center, gp_Dir(0, 1, 0)), radius_mm)
            start_pt = pt
            rel_x, rel_z = start_pt.X() - center.X(), start_pt.Z() - center.Z()
            end_x = center.X() + rel_x * math.cos(angle_rad) - rel_z * math.sin(angle_rad) * turn_sign
            end_z = center.Z() + rel_x * math.sin(angle_rad) * turn_sign + rel_z * math.cos(angle_rad)
            end_pt = gp_Pnt(end_x, 0, end_z)
            edges.append(BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(circ, start_pt, end_pt, True).Value()).Edge())
            pt = end_pt
            rdx = dx * math.cos(angle_rad) + dz * math.sin(angle_rad)
            rdz = -dx * math.sin(angle_rad) + dz * math.cos(angle_rad)
            dx, dz = rdx, rdz

    wire_maker = BRepBuilderAPI_MakeWire()
    for e in edges:
        wire_maker.Add(e)

    p1 = gp_Pnt(0, -width_mm / 2, -thickness_mm / 2)
    p2 = gp_Pnt(0, width_mm / 2, -thickness_mm / 2)
    p3 = gp_Pnt(0, width_mm / 2, thickness_mm / 2)
    p4 = gp_Pnt(0, -width_mm / 2, thickness_mm / 2)
    profile_wire = BRepBuilderAPI_MakeWire(
        BRepBuilderAPI_MakeEdge(p1, p2).Edge(),
        BRepBuilderAPI_MakeEdge(p2, p3).Edge(),
        BRepBuilderAPI_MakeEdge(p3, p4).Edge(),
        BRepBuilderAPI_MakeEdge(p4, p1).Edge(),
    ).Wire()
    profile_face = BRepBuilderAPI_MakeFace(profile_wire).Face()

    pipe = BRepOffsetAPI_MakePipe(wire_maker.Wire(), profile_face)
    pipe.Build()
    assert pipe.IsDone(), "pipe sweep failed"
    return pipe.Shape()


def _physical_bends(shape, thickness_mm=THICKNESS_MM):
    """
    Dedup inner/outer cylinder face pairs into one physical bend per real
    fold -- the same rule feature_extractors.py's own bend clustering uses
    (same axis direction, same axis line, radii ~one thickness apart).
    Standalone here (not imported from feature_extractors) so this test
    exercises compute_bend_flange_relationships in isolation, matching the
    granularity feature_extractors.py will pass it in production.
    """
    faces = []
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        faces.append(topods.Face(exp.Current()))
        exp.Next()

    cyl_info = {}
    for i, f in enumerate(faces):
        ad = BRepAdaptor_Surface(f)
        if ad.GetType() != GeomAbs_Cylinder:
            continue
        cyl = ad.Cylinder()
        ax = cyl.Axis().Direction()
        fx, fy, fz = ax.X(), ax.Y(), ax.Z()
        if (fx, fy, fz) < (0.0, 0.0, 0.0):
            fx, fy, fz = -fx, -fy, -fz
        loc = cyl.Axis().Location()
        lx, ly, lz = loc.X(), loc.Y(), loc.Z()
        along = lx * fx + ly * fy + lz * fz
        cyl_info[i] = {
            "axis": (fx, fy, fz),
            "axis_point": (lx - along * fx, ly - along * fy, lz - along * fz),
            "radius": cyl.Radius(),
        }

    used = set()
    bends = []
    indices = list(cyl_info.keys())
    for a in indices:
        if a in used:
            continue
        group = [a]
        for b in indices:
            if b == a or b in used:
                continue
            ia, ib = cyl_info[a], cyl_info[b]
            if abs(sum(x * y for x, y in zip(ia["axis"], ib["axis"]))) < 0.99:
                continue
            if math.dist(ia["axis_point"], ib["axis_point"]) > max(0.5, thickness_mm * 0.5):
                continue
            radius_diff = abs(ia["radius"] - ib["radius"])
            # Either a genuine inner/outer pair (radii ~one thickness apart)
            # OR the SAME cylindrical surface reported as two faces because
            # OCC split it along a seam (common for a periodic swept
            # surface) -- both share axis + axis_point already checked
            # above, so an ~equal radius here means "same surface," not "a
            # different, unrelated cylinder that happens to sit on this
            # axis."
            is_inner_outer_pair = abs(radius_diff - thickness_mm) <= max(0.5, thickness_mm * 0.5)
            is_seam_split_duplicate = radius_diff <= max(0.5, thickness_mm * 0.25)
            if not (is_inner_outer_pair or is_seam_split_duplicate):
                continue
            group.append(b)
            used.add(b)
        used.add(a)
        bends.append({"face_ids": group})
    return bends


def test_two_bends_same_sense_produce_a_recognized_relationship():
    # Both bends turn the same rotational way -- net 180deg fold.
    shape = make_bent_sheet(seg_lens=[30, 20, 30], angles_deg=[90, 90])
    bends = _physical_bends(shape)
    assert len(bends) == 2
    rels = compute_bend_flange_relationships(shape, bends, sheet_width_mm=WIDTH_MM)
    assert len(rels) == 1
    assert rels[0]["recognition_status"] == "recognized"
    # cos(90+90) = cos(180) = -1: the two base walls end up anti-parallel.
    assert rels[0]["fold_relative_orientation"] == pytest.approx(-1.0, abs=0.02)


def test_opposite_sense_bends_produce_the_opposite_signed_signal():
    # Second bend folds the OPPOSITE way -- net 0deg fold (an offset/joggle,
    # or a genuine U-channel whose two walls end up parallel).
    shape = make_bent_sheet(seg_lens=[30, 8, 30], angles_deg=[90, -90])
    bends = _physical_bends(shape)
    assert len(bends) == 2
    rels = compute_bend_flange_relationships(shape, bends, sheet_width_mm=WIDTH_MM)
    assert len(rels) == 1
    # cos(90-90) = cos(0) = +1: the two base walls end up parallel.
    assert rels[0]["fold_relative_orientation"] == pytest.approx(1.0, abs=0.02)


def test_flange_width_is_real_not_fabricated():
    narrow = make_bent_sheet(seg_lens=[30, 8, 30], angles_deg=[90, 90])
    wide = make_bent_sheet(seg_lens=[30, 20, 30], angles_deg=[90, 90])
    narrow_rel = compute_bend_flange_relationships(narrow, _physical_bends(narrow), sheet_width_mm=WIDTH_MM)[0]
    wide_rel = compute_bend_flange_relationships(wide, _physical_bends(wide), sheet_width_mm=WIDTH_MM)[0]
    assert narrow_rel["flange_width_mm"] == pytest.approx(8.0, abs=0.5)
    assert wide_rel["flange_width_mm"] == pytest.approx(20.0, abs=0.5)


def test_perpendicular_double_bend_gives_a_near_zero_signal():
    # An L/Z-shaped double bend (45+45 = 90deg net) -- no hem/channel
    # significance either way; the signal must reflect that honestly.
    shape = make_bent_sheet(seg_lens=[30, 15, 30], angles_deg=[45, 45])
    rels = compute_bend_flange_relationships(shape, _physical_bends(shape), sheet_width_mm=WIDTH_MM)
    assert len(rels) == 1
    assert rels[0]["fold_relative_orientation"] == pytest.approx(0.0, abs=0.05)


def test_asymmetric_angles_match_the_cosine_of_their_signed_sum():
    # Real, continuous relationship (not a lookup table): verifies
    # fold_relative_orientation == cos(sum of signed bend angles) for an
    # arbitrary, non-90-degree pair -- proves this is derived geometry, not
    # a fit to the two round-number cases above.
    shape = make_bent_sheet(seg_lens=[30, 6, 30], angles_deg=[100, -80])
    rels = compute_bend_flange_relationships(shape, _physical_bends(shape), sheet_width_mm=WIDTH_MM)
    assert len(rels) == 1
    expected = math.cos(math.radians(100 - 80))
    assert rels[0]["fold_relative_orientation"] == pytest.approx(expected, abs=0.02)


def test_single_bend_produces_no_relationship_box_corner_reference():
    # A single 90deg bend (the "box corner" case) -- correctly produces zero
    # bend-to-bend relationships, since there is only one bend.
    shape = make_bent_sheet(seg_lens=[30, 30], angles_deg=[90])
    bends = _physical_bends(shape)
    assert len(bends) == 1
    rels = compute_bend_flange_relationships(shape, bends, sheet_width_mm=WIDTH_MM)
    assert rels == []


def test_unrelated_bends_with_no_shared_flange_produce_no_relationship():
    # Three bends in sequence: only ADJACENT bends share a flange wall: bend
    # 0 & bend 1 do, bend 1 & bend 2 do, but bend 0 & bend 2 (separated by
    # bend 1's own two walls) do not share a single flange face directly.
    shape = make_bent_sheet(seg_lens=[30, 15, 15, 30], angles_deg=[90, 90, 90])
    bends = _physical_bends(shape)
    assert len(bends) == 3
    rels = compute_bend_flange_relationships(shape, bends, sheet_width_mm=WIDTH_MM)
    pairs = {frozenset((tuple(r["bend_a_face_ids"]), tuple(r["bend_b_face_ids"]))) for r in rels}
    # Exactly 2 relationships (adjacent pairs), never 3 (no 0-2 shortcut).
    assert len(rels) == 2
