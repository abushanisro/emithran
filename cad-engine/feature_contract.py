"""
Normalized manufacturing feature contract — additive layer on top of the
existing feature_graph_v2 output.

Purpose: feature_graph_v2 today has no shared occurrence schema (a 'hole'
entry and a 'bend' entry carry different, ad hoc field sets) and no version
field at all (main.py's "version": "2.0.0" is the SERVICE version, unrelated
to the shape of this data). Downstream DFM/process-intelligence code needs a
stable, versioned, provenance-carrying envelope to build on.

This module does NOT replace or restructure feature_graph_v2 -- it defines a
small additive envelope that existing extractors can attach real, already-
computed facts to. See bend_relationships.py for the first real consumer
(bend-to-bend/bend-to-flange relationships).

No confidence field: nothing in this pipeline produces a real, defensible
confidence score today. Adding one here would be exactly the kind of
sophisticated-looking-but-fabricated field this contract exists to avoid.
"""

from typing import Any, Dict, List, Optional

# Bumped whenever this envelope's SHAPE changes (new/removed/renamed fields),
# independent of memory_optimizer.py's CACHE_VERSION (which tracks internal
# extraction-LOGIC revisions for disk-cache invalidation, a different
# concern). Downstream consumers should check this field, not CACHE_VERSION,
# to know what shape of normalized_features to expect.
FEATURE_CONTRACT_VERSION = "1.0"


def build_normalized_feature(
    feature_id: str,
    feature_type: str,
    source_face_ids: List[int],
    geometric_parameters: Dict[str, Any],
    recognition_method: str,
    source_solid_id: Optional[int] = None,
    source_edge_ids: Optional[List[int]] = None,
    recognition_status: str = "recognized",
) -> Dict[str, Any]:
    """
    Build one normalized feature record. Every field here must trace to a
    real, already-computed fact -- this function does no geometry of its
    own, it only shapes facts callers already have.

    recognition_status: 'recognized' (a real feature was found) or
    'ambiguous' (geometry was inspected but did not cleanly resolve --
    e.g. a bend-to-bend relationship where no shared flange face exists).
    Never silently return 'recognized' for an uncertain result.
    """
    return {
        "feature_id": feature_id,
        "feature_type": feature_type,
        "source_solid_id": source_solid_id,
        "source_face_ids": list(source_face_ids),
        "source_edge_ids": list(source_edge_ids) if source_edge_ids else [],
        "geometric_parameters": geometric_parameters,
        "recognition_method": recognition_method,
        "recognition_status": recognition_status,
    }
