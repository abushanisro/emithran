"""
Constants of the forging geometry extractor. Every number here is either sourced (and says where) or a
numerical tolerance (and says so). Nothing in this package is a cost or a DFM verdict: it measures, and
the backend DFM service applies the staged thresholds (memory/Forging/Lookup/forging_manufacturabilitySeverity.csv).
"""
from __future__ import annotations

EXTRACTOR_NAME = "forging_geometry"
# Semantic version of the extractor's algorithms. It is part of the payload so a consumer (and the geometry-hash
# cache key, once this is wired in) can tell two results apart. Bump it on any change that can change a number.
EXTRACTOR_VERSION = "1.0.0"
# Version of the payload layout (contract/forging_geometry.schema.json). Additive changes keep it; a breaking one bumps it.
SCHEMA_VERSION = 1

# THE draft / die-lock threshold. Sourced: forging_manufacturabilitySeverity.csv, InsufficientDraftAngle, Critical = 0.01 degrees
# for every material. It is used twice and only twice, both for the same question "is this surface parallel to the pull?":
#   * a surface whose normal is within this angle of perpendicular to the pull has zero draft, and is not visibility-tested;
#   * every other surface faces one die and is visibility-tested along that die's pull direction.
# There is no second angle (v1.0 had -0.5 degrees in code and a -0.05 dot product in the DFM rule; that is the inconsistency
# review finding B4 asked to remove).
DRAFT_THRESHOLD_DEG = 0.01

# The three canonical pull candidates (v1.1 section 8: "Pull axis comes from canonical axes only").
CANONICAL_AXES = {"x": (1.0, 0.0, 0.0), "y": (0.0, 1.0, 0.0), "z": (0.0, 0.0, 1.0)}

# ---- numerical tolerances (not engineering thresholds) ----
# Distance (mm) a visibility ray starts outside the surface so it does not re-hit its own face.
RAY_START_OFFSET_MM = 1e-3
# Hits closer than this along the ray (mm) are ignored (the start offset's own numerical noise).
RAY_MIN_HIT_MM = 1e-6
# Default tessellation deflection (mm). It sets the accuracy of the mesh-based figures (silhouette area and perimeter, A(x)):
# a circle of radius R tessellated to n chords is short in area by about (2*pi^2/3)/n^2 of its area. CONTRACT.md states the
# tolerances the tests verify.
DEFAULT_LINEAR_DEFLECTION_MM = 0.05
# Samples per face for the draft and visibility tests (area-stratified, deterministic). A plane needs one; a curved
# face is sampled across its whole area, not at its midpoint.
DEFAULT_MAX_SAMPLES_PER_FACE = 16
# Upper bound on visibility rays per axis; the per-face sample cap is lowered on a very large part to stay inside it.
DEFAULT_MAX_RAYS_PER_AXIS = 20000
# Two surface normals closer than this are tangent-continuous (G1): a blend face meets its neighbours at this angle or less.
TANGENT_ANGLE_DEG = 1.0
# Two cylinders are the same cylinder (one hole wall split in two faces) when radius and axis agree to this (mm).
SAME_SURFACE_TOLERANCE_MM = 0.01
# A surface of revolution is about a candidate axis when its own axis is parallel within this angle (degrees) and passes
# within this distance (mm) of the candidate axis line.
REVOLUTION_AXIS_ANGLE_DEG = 0.1
REVOLUTION_AXIS_DISTANCE_MM = 0.01
# Number of stations of the cross-section curve A(x), and the default axis ("auto" = the longest world-axis extent).
DEFAULT_SECTION_STATIONS = 41
