"""
Rolled-form detection — continuous curvature imposed by a roll bender.

WHY THIS EXISTS

The backend could not tell a roll-bent part from a press-brake-bent one.
`rollBendingGeometryCapability` (engine-kernel.ts) is a purely NEGATIVE gate:
discrete bends are not rollable, therefore reject a roll bender for a part that
has them. It never positively recognises a rolled cylinder, and its own doc
comment says why — "no curvature or CURVED_BEND signal reaches the backend
today: the CAD extractor knows about curved bend faces internally but exports
only a bend count". That left two real holes:

  * a genuinely rolled part reports bend_count = 0 and is therefore treated
    exactly like a flat blank, and
  * a press-brake route can be selected for a rolled part with nothing to
    object.

WHAT THE EXISTING CODE THROWS AWAY

feature_extractor._collect_dedup_bends rejects `angle_rad > math.pi` and any
radius above `max(8*t, 20mm)`. A rolled shell is exactly that: a large-radius
face sweeping more than half a turn. _is_hole rejects it too (it requires the
axis to align with the sheet normal, and a roll axis lies IN the sheet plane).
So today a rolled face lands in no feature bucket at all — it is dropped, not
mislabeled.

This module therefore reads the raw cylinder tuples directly, before any of
those gates, and does not touch them. bend_count / bend_radii_mm /
bend_angles_deg / bend_lengths_mm keep exactly the values they have today: they
are live costing inputs (press-brake cost, tonnage, machine selection, DFM), and
this is additive recognition, not a change to them.

THE RULE, AND WHY IT IS SHAPED THIS WAY

Both numbers below are the EXISTING gates in feature_extractor.py, re-read as
evidence instead of as rejection criteria:

  * radius > max(8*t, 20mm). That file's `max_bend_radius` — the largest radius
    it is willing to call a bend at this thickness. A press-brake bend radius is
    on the order of the material thickness; a rolled form is not.
  * sweep > pi (180 deg). _collect_dedup_bends already treats this as "not a
    simple press-brake bend" and drops it.

A candidate must satisfy BOTH to be 'recognized', and the radius test is doing
the load-bearing work. That ordering was established empirically, not assumed —
see the next section.

WHY SWEEP ALONE IS NOT ENOUGH (measured, not theorised)

An early version of this module treated sweep > pi as sufficient. Run end to end
against real B-Rep it produced a FALSE POSITIVE: an ordinary two-bend bracket
with R2/R4 creases reported four rolled forms. The cause is not a parametrisation
artefact — surface-area measurement confirmed the faces genuinely span 270
degrees of their cylinder, because the bend was modelled on the major arc. A
cylindrical face wrapping past a half turn is therefore NOT by itself evidence of
rolling; a press-brake bend can produce one too.

What a press brake cannot produce is that wrap at a radius far beyond its own
bend-radius ceiling. Requiring both removes the bracket (R2/R4 are nowhere near
the 20mm ceiling) while keeping a genuine rolled shell (R100 on 2mm sheet).

Related, and also measured: u_range_rad is `abs(LastUParameter -
FirstUParameter)`. On a shelled partial cylinder it is the true sweep (300 deg
reads 300 deg). On some swept constructions the same shell reports the
complement. Either way the radius gate, not the sweep, is what keeps a confident
detection honest.

CONFIDENCE IS NOT UNIFORM, AND THIS MODULE SAYS SO

  * radius over the ceiling AND sweep > pi -> 'recognized'.
  * radius over the ceiling, sweep <= pi   -> 'ambiguous'. A gentle large-radius
                                              crease and a partial roll are the
                                              same geometry at this level of
                                              evidence. Reported so a consumer can
                                              disclose it; never counted as a
                                              detection.

This mirrors the house convention already set by forming_spike.py /
lancing_spike.py / gusset_spike.py: a candidate that cannot be told apart from
something else stays 'ambiguous' rather than being guessed either way.

A KNOWN LIMIT

Sheet thickness must be resolved for any of this to run, and thickness detection
needs planar faces. A pure rolled cylinder with no flat tangent sections
resolves no usable thickness, so nothing is reported for it — verified end to
end. That is a pre-existing thickness-extraction limit, disclosed here rather
than worked around with a guessed gauge.

WHAT THIS DELIBERATELY DOES NOT DO

It does not decide 2-roll vs 3-roll vs 4-roll. That is a machine-selection
question needing a rolled diameter and cone/cylinder discrimination; the roll
engine prices from flat-pattern feed length alone today. It also does not
attempt cones (BRepAdaptor conical faces are a different surface type and are
not read here at all).
"""

import math
from typing import Any, Dict, List, Optional, Tuple

# Both mirror feature_extractor.py's own bend gates — see module docstring.
# A press brake cannot wrap material past a half turn in one hit, and
# _collect_dedup_bends already refuses to call such a face a bend.
MAX_PRESS_BRAKE_SWEEP_RAD = math.pi

# Same expression as _collect_dedup_bends' `max_bend_radius` / _min_bend_line_mm's
# companion cap: the largest radius that file is willing to call a bend.
ABSOLUTE_MIN_BEND_RADIUS_CAP_MM = 20.0
BEND_RADIUS_THICKNESS_MULTIPLE = 8.0

# feature_extractor._min_bend_line_mm: the shortest axial patch that file is
# willing to call a real bend line rather than edge-fillet noise. It is also what
# separates a rolled face from a HOLE without needing a sheet normal: a hole
# through the sheet has an axial extent of one sheet thickness, which is below
# max(2t, 3.0) for any real thickness. Deliberately used INSTEAD of the
# |axis . sheet_normal| test the bend/hole detectors use — a rolled part has no
# single sheet normal to test against (that is the whole point of it being
# rolled), and on a fully rolled shell `dominant_normal` is either absent or
# meaningless. Verified against real B-Rep: a shelled partial cylinder's axis is
# parallel to what the planar-face pass would call the normal, so an alignment
# test rejects exactly the faces this module exists to find.
MIN_BEND_LINE_ABSOLUTE_MM = 3.0
MIN_BEND_LINE_THICKNESS_MULTIPLE = 2.0


def max_bend_radius_mm(sheet_thickness_mm: float) -> float:
    """feature_extractor.py's own bend-radius ceiling, in one place."""
    return max(sheet_thickness_mm * BEND_RADIUS_THICKNESS_MULTIPLE, ABSOLUTE_MIN_BEND_RADIUS_CAP_MM)


def min_bend_line_mm(sheet_thickness_mm: float) -> float:
    """feature_extractor._min_bend_line_mm, in one place."""
    return max(sheet_thickness_mm * MIN_BEND_LINE_THICKNESS_MULTIPLE, MIN_BEND_LINE_ABSOLUTE_MM)


def detect_rolled_forms(
    raw_cylinders_full: List[Tuple],
    sheet_thickness_mm: float,
    dominant_normal: Optional[Tuple[float, float, float]] = None,
) -> List[Dict[str, Any]]:
    """
    Find cylindrical faces that represent continuous rolled curvature.

    Reads the raw 11-tuples straight from memory_optimizer
    (r, axis_z, cx, cy, cz, ax, ay, az, face_idx, v_range, u_range_rad), i.e.
    BEFORE _collect_dedup_bends' sweep/radius rejection — see module docstring.
    Tuples shorter than 11 entries (the legacy 9-tuple shape) carry no sweep and
    are skipped rather than guessed at.

    Returns one dict per candidate, each carrying its own recognition_status.
    Callers must count only 'recognized' entries as a confident detection.
    """
    if not raw_cylinders_full or sheet_thickness_mm <= 0:
        return []

    radius_cap = max_bend_radius_mm(sheet_thickness_mm)
    found: List[Dict[str, Any]] = []

    for cyl in raw_cylinders_full:
        if len(cyl) <= 10 or cyl[10] is None:
            continue  # legacy tuple: no angular extent on file, nothing to read
        try:
            radius_mm = float(cyl[0])
            sweep_rad = abs(float(cyl[10]))
            axial_length_mm = float(cyl[9]) if len(cyl) > 9 and cyl[9] is not None else 0.0
        except (TypeError, ValueError):
            continue

        if radius_mm <= 0 or sweep_rad <= 0.001:
            continue

        # A hole through the sheet is one thickness deep, so it can never reach
        # the minimum bend-line length. This is what keeps holes, bosses and
        # extruded collars out without needing a sheet normal — see
        # MIN_BEND_LINE_ABSOLUTE_MM for why an alignment test cannot be used here.
        if axial_length_mm < min_bend_line_mm(sheet_thickness_mm):
            continue

        wraps_past_half_turn = sweep_rad > MAX_PRESS_BRAKE_SWEEP_RAD
        exceeds_bend_radius = radius_mm > radius_cap
        # Radius is the load-bearing test: a bend can legitimately span more than
        # a half turn (measured on real B-Rep — see the module docstring), so
        # sweep alone would flag ordinary brackets.
        if not exceeds_bend_radius:
            continue  # an ordinary press-brake bend — already handled elsewhere

        if wraps_past_half_turn:
            status = "recognized"
            evidence = (
                f"radius {radius_mm:.1f}mm is beyond the {radius_cap:.1f}mm bend-radius ceiling for "
                f"{sheet_thickness_mm:.2f}mm sheet AND the face wraps {math.degrees(sweep_rad):.1f} deg — "
                f"a press brake forms neither that radius nor that wrap"
            )
        else:
            status = "ambiguous"
            evidence = (
                f"radius {radius_mm:.1f}mm exceeds the {radius_cap:.1f}mm bend-radius ceiling for "
                f"{sheet_thickness_mm:.2f}mm sheet, but the {math.degrees(sweep_rad):.1f} deg sweep is "
                f"within press-brake range — a gentle large-radius crease and a partial roll are the "
                f"same geometry at this level of evidence"
            )

        found.append({
            "radius_mm": round(radius_mm, 2),
            "sweep_deg": round(math.degrees(sweep_rad), 1),
            "axial_length_mm": round(axial_length_mm, 2),
            "centroid": [round(float(cyl[2]), 2), round(float(cyl[3]), 2), round(float(cyl[4]), 2)],
            "face_ids": [int(cyl[8])] if len(cyl) > 8 and cyl[8] is not None else [],
            "recognition_status": status,
            "recognition_evidence": evidence,
        })

    return found


def count_recognized(candidates: List[Dict[str, Any]]) -> int:
    """Confident detections only — 'ambiguous' candidates are never counted."""
    return sum(1 for c in candidates if c.get("recognition_status") == "recognized")
