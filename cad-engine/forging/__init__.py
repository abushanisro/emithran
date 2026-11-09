"""Forging geometry extraction (closed-die hot forging). Not wired into the upload pipeline. See CONTRACT.md."""
from .constants import DRAFT_THRESHOLD_DEG, EXTRACTOR_NAME, EXTRACTOR_VERSION, SCHEMA_VERSION
from .extractor import extract_forging_geometry, extract_forging_geometry_from_step

__all__ = [
    "extract_forging_geometry", "extract_forging_geometry_from_step",
    "EXTRACTOR_NAME", "EXTRACTOR_VERSION", "SCHEMA_VERSION", "DRAFT_THRESHOLD_DEG",
]
