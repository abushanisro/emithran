"""
DEPRECATED — renamed to machining_feature_recognizer.py (2026-09-19) per the
"Machining is the canonical domain, not CNC" architecture mandate.

This module is a thin, deprecated compatibility shim only — no duplicate
implementation. Every name below is the exact same real object as the
renamed module; nothing here is reimplemented. All internal production
code in this repository has already been migrated to import from
`machining.machining_feature_recognizer` directly (and, for the data
model, from `machining.feature_models`) — do not add new imports of this
module. It exists only so a caller that has not yet migrated does not
break.
"""
from __future__ import annotations

import warnings

warnings.warn(
    "machining.cnc_feature_recognizer is deprecated — import from "
    "machining.machining_feature_recognizer instead (CNCFeatureRecognizer "
    "was renamed to MachiningFeatureRecognizer as part of the "
    "'Machining is the canonical domain, not CNC' architecture mandate).",
    DeprecationWarning,
    stacklevel=2,
)

from .machining_feature_recognizer import (  # noqa: F401
    MachiningFeatureRecognizer,
    MachiningFeatureRecognizer as CNCFeatureRecognizer,
    build_machining_feature_graph_v2,
    build_machining_feature_graph_v2 as build_feature_graph_v2_from_cnc,
    _part_bounding_box,
    _classify_cone,
    _detect_counterbores,
    _detect_multistep_holes,
    _TAP_DRILL_RANGES,
    _HELICOIL_DRILL_RANGES,
    _classify_hole,
    _annotate_hole_depth,
    _axis_span,
    _axis_range,
    _point_to_axis_distance,
    _angle_around_axis,
)
from .feature_models import (  # noqa: F401
    MachiningFeatureType,
    MachiningFeatureType as FeatureType,
    MachiningFeature,
    MachiningFeature as CNCFeature,
    MachiningFeatureTree,
    MachiningFeatureTree as CNCFeatureTree,
)
