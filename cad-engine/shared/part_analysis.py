"""
The full single-part analysis behind POST /analyze/geometry, callable without HTTP (the assembly runner reuses it).

`analyze_part` returns the response dict; the endpoint only handles the upload, validation and error mapping.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Optional

from shared import telemetry
from shared.memory_optimizer import AdvancedCADMemoryOptimizer
from shared.part_family import MACHINING_FAMILIES

logger = logging.getLogger(__name__)

_CF_TTL_SECONDS = 7 * 24 * 3600
_CF_MAX_ENTRIES = 50


class ComponentFeatureCache:
    """
    Component features take 30-70 s on a complex part, so they are kept: LRU in memory, JSON files on disk (survive
    a restart). The key carries a digest of the analyzer's own source, so a code change invalidates old entries
    without anyone remembering to bump a version.
    """

    def __init__(self, directory: Path):
        self._dir = directory
        self._dir.mkdir(parents=True, exist_ok=True)
        self._memory: "OrderedDict[str, Any]" = OrderedDict()
        self._lock = threading.Lock()
        self._digest = hashlib.sha256(
            (Path(__file__).parent / "component_feature_analyzer.py").read_bytes()
        ).hexdigest()[:10]
        for path in self._dir.glob("*.json"):  # drop expired files left by earlier runs
            try:
                if time.time() - json.loads(path.read_text(encoding="utf-8")).get("ts", 0) > _CF_TTL_SECONDS:
                    path.unlink(missing_ok=True)
            except Exception:
                path.unlink(missing_ok=True)

    def key(self, geometry_hash: str) -> str:
        return f"{geometry_hash}-{self._digest}"

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            if key in self._memory:
                self._memory.move_to_end(key)
                return self._memory[key]
        path = self._dir / f"{key}.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None
        if time.time() - data.get("ts", 0) > _CF_TTL_SECONDS:
            path.unlink(missing_ok=True)
            return None
        self._remember(key, data["cf"])
        return data["cf"]

    def put(self, key: str, value: Dict[str, Any]) -> None:
        self._remember(key, value)
        try:
            (self._dir / f"{key}.json").write_text(json.dumps({"ts": time.time(), "cf": value}), encoding="utf-8")
        except Exception as exc:
            logger.warning(f"[component_features] disk cache write failed for {key[:12]}: {exc}")

    def _remember(self, key: str, value: Any) -> None:
        with self._lock:
            self._memory[key] = value
            self._memory.move_to_end(key)
            while len(self._memory) > _CF_MAX_ENTRIES:
                self._memory.popitem(last=False)


def analyze_part(
    *,
    shape: Any,
    step_path: str,
    filename: str,
    file_hash: str,
    memory_optimizer: AdvancedCADMemoryOptimizer,
    component_cache: ComponentFeatureCache,
    face_graph_max_faces: int,
    strategy: str = "balanced",
    force_reanalysis: bool = False,
    user_processes: Optional[List[Dict[str, Any]]] = None,
    family_hint: str = "",
) -> Dict[str, Any]:
    parsed_processes = user_processes or []
    with telemetry.stage("geometry_analysis"):
        optimization_result = memory_optimizer.analyze_and_optimize(
            shape=shape,
            file_path=step_path,
            strategy=strategy,
            force_reanalysis=force_reanalysis,
            user_processes=parsed_processes,
            file_hash=file_hash,
            family_hint=family_hint,
        )

    logger.info(f"Advanced analysis completed for {filename}")

    # Machining feature recognition — runs only for non-sheet-metal
    # families. STEP/3D CAD -> MachiningFeatureRecognizer ->
    # MachiningFeatureTree (renamed 2026-09-19 from
    # CNCFeatureRecognizer per the "Machining is the canonical
    # domain, not CNC" architecture mandate). The response key
    # "machining_features" and the shared/part_family.py machining family
    # family strings below are real, existing manufacturing/process
    # classifications already read throughout the backend's
    # DB-driven costing/taxonomy code -- deliberately left
    # unchanged by this rename, not part of it.
    machining_features_result = None
    try:
        mfg_intel = (
            optimization_result.geometry_features.manufacturing_features
            .get("manufacturing_intelligence", {})
        )
        detected_family = mfg_intel.get("detected_family", "")
        if detected_family in MACHINING_FAMILIES:
            from machining.machining_feature_recognizer import MachiningFeatureRecognizer  # type: ignore
            machining_features_result = MachiningFeatureRecognizer().recognize(shape, detected_family).to_dict()
            # Real sharp-edge length (deburring path) measured from the
            # B-Rep — replaces the backend estimating it from surface area.
            try:
                from shared.edge_length import sharp_edge_length  # type: ignore
                machining_features_result["edges"] = sharp_edge_length(shape)
            except Exception as _edge_exc:
                logger.warning(f"[machining_features] edge length failed: {_edge_exc}")
            # Embed face_map so the frontend can resolve face_ids → STL triangle ranges.
            # For sheet_metal this lives in feature_graph_v2.metadata.face_map; for Machining
            # we carry it here since the SheetMetalFeatureExtractor is never called.
            _holes = optimization_result.geometry_features.manufacturing_features.get('holes', {})
            _face_map = _holes.get('face_map', [])
            if _face_map:
                machining_features_result['face_map'] = _face_map
            logger.info(
                f"[machining_features] family={detected_family} "
                f"features={len(machining_features_result.get('features', []))} "
                f"face_map_entries={len(_face_map)}"
            )
            try:
                from machining.machining_feature_recognizer import build_machining_feature_graph_v2, _part_bounding_box  # type: ignore
                from shared.stable_face_id import build_stable_face_id_map  # type: ignore
                _bbox_raw = _part_bounding_box(shape)
                _bcx = (_bbox_raw["xmin"] + _bbox_raw["xmax"]) / 2
                _bcy = (_bbox_raw["ymin"] + _bbox_raw["ymax"]) / 2
                _bcz = (_bbox_raw["zmin"] + _bbox_raw["zmax"]) / 2
                _total_tris = sum(e.get("tri_count", 0) for e in _face_map)
                # Content-based face identity, stable across STEP
                # regeneration -- same module/pattern Sheet Metal
                # already proved (feature_extractor.py). Additive:
                # face_ids (raw OCC ordinals) stay the primary key
                # every existing consumer reads unchanged.
                try:
                    _stable_face_ids = build_stable_face_id_map(shape)
                except Exception as _sfid_exc:
                    logger.warning(f"[machining_fgv2] stable_face_id build failed: {_sfid_exc}")
                    _stable_face_ids = {}
                machining_features_result["feature_graph_v2"] = build_machining_feature_graph_v2(
                    machining_features_result, (_bcx, _bcy, _bcz), _face_map, _total_tris,
                    stable_face_ids=_stable_face_ids,
                )
                # Nominal size for ISO 286 grading of tolerances on non-hole features.
                from shared.feature_extent import annotate_occurrence_extents
                annotate_occurrence_extents(shape, machining_features_result["feature_graph_v2"]["features"])
                logger.info(
                    f"[machining_fgv2] synthesised "
                    f"{len(machining_features_result['feature_graph_v2']['features'])} features"
                )
            except Exception as _fgv2_exc:
                logger.warning(f"[machining_fgv2] synthesis failed: {_fgv2_exc}")
    except Exception as _cnc_exc:
        logger.warning(f"[machining_features] extraction failed: {_cnc_exc}")

    # Per-face attributes + edge convexity for every domain (the attributed
    # adjacency graph the driver tree and highlight shading read). Bounded:
    # beyond face_graph_max_faces it is skipped, not truncated.
    face_graph = None
    try:
        from shared.face_attributes import build_face_attributes  # type: ignore
        _faces_total = optimization_result.geometry_features.manufacturing_features.get(
            'holes', {}).get('total_face_count', 0)
        if _faces_total <= face_graph_max_faces:
            _fa, _eg = build_face_attributes(shape)
            face_graph = {"face_attributes": _fa, "edge_graph": _eg}
        else:
            logger.warning(
                f"[face_graph] skipped: {_faces_total} faces > {face_graph_max_faces}"
            )
    except Exception as _fg_exc:
        logger.warning(f"[face_graph] extraction failed: {_fg_exc}")

    response = {
        "success": True,
        "face_graph": face_graph,
        "analysis_id": optimization_result.geometry_hash[:16],
        "original_filename": filename,
        "optimization_strategy": optimization_result.optimization_strategy,
        "model_version": optimization_result.model_version,
        "timestamp": optimization_result.timestamp.isoformat(),

        "geometry_features": {
            "volume_mm3": optimization_result.geometry_features.volume,
            "surface_area_mm2": optimization_result.geometry_features.surface_area,
            "bounding_box": optimization_result.geometry_features.bounding_box,
            "complexity_score": optimization_result.geometry_features.complexity_score,
            "feature_count": optimization_result.geometry_features.feature_count,
            "manufacturing_features": optimization_result.geometry_features.manufacturing_features,
            "mass_properties": optimization_result.geometry_features.mass_properties
        },

        "memory_optimization": {
            "original_size_kb": optimization_result.memory_metrics.original_size_kb,
            "optimized_size_kb": optimization_result.memory_metrics.optimized_size_kb,
            "compression_ratio": optimization_result.memory_metrics.compression_ratio,
            "memory_reduction_percent": optimization_result.memory_metrics.memory_reduction_percent,
            "processing_time_ms": optimization_result.memory_metrics.processing_time_ms,
            "cache_efficiency": optimization_result.memory_metrics.cache_efficiency
        },

        "dfm_analysis": {
            "manufacturability_score": optimization_result.dfm_analysis.manufacturability_score,
            "difficulty_level": optimization_result.dfm_analysis.difficulty_level,
            "recommended_processes": optimization_result.dfm_analysis.recommended_processes,
            "warnings": optimization_result.dfm_analysis.warnings,
            "confidence": optimization_result.dfm_analysis.confidence,
        },

        "performance_metrics": {
            "lod_levels_generated": optimization_result.lod_levels_generated,
            "recommendations": optimization_result.recommendations
        }
    }

    if machining_features_result is not None:
        response["machining_features"] = machining_features_result

    # Semantic GD&T carried in the STEP model itself (AP242 PMI) — the
    # one 3D-model source of GD&T; all families. See shared/step_pmi.py.
    from shared.step_pmi import read_step_gdt  # type: ignore
    response["pmi"] = read_step_gdt(step_path)
    # The PMI graphics are in STEP model coordinates; the viewer's mesh is centred on its
    # bounding box, so it needs that centre (same one feature_graph_v2 is centred on).
    if response["pmi"].get("graphics"):
        try:
            from machining.machining_feature_recognizer import _part_bounding_box  # type: ignore
            _b = _part_bounding_box(shape)
            response["pmi"]["graphics_origin"] = [
                round((_b["xmin"] + _b["xmax"]) / 2, 4), round((_b["ymin"] + _b["ymax"]) / 2, 4), round((_b["zmin"] + _b["zmax"]) / 2, 4),
            ]
        except Exception as _gexc:
            logger.warning(f"[step_pmi] graphics origin failed: {_gexc}")
            response["pmi"]["graphics"] = []
    # Typed engineering records: native PMI where the file has it, decoded graphics (always flagged,
    # never automation-ready) where it does not, unresolved otherwise. See shared/pmi_records.py.
    # The STEP file the PMI was read from: an engineer's approval of a decoded value is bound to it.
    response["pmi"]["source"] = {"file_sha256": file_hash}
    if response["pmi"].get("items"):
        try:
            from shared.pmi_records import build_pmi_records, engine_features  # type: ignore
            _mf = (machining_features_result or {}).get("features") if machining_features_result else None
            _built = build_pmi_records(response["pmi"], engine_features(_mf))
            response["pmi"]["records"] = _built["records"]
            response["pmi"]["records_summary"] = _built["summary"]
        except Exception as _rexc:
            logger.warning(f"[step_pmi] records failed: {_rexc}")
            response["pmi"]["unresolved"] = list(response["pmi"].get("unresolved", [])) + [f"records: {_rexc}"]

    # Component feature analysis (eMithran-style decomposition). The GCD adjacency walk is the bottleneck, so the
    # result is cached; "force reanalysis" skips the read but still refreshes the entry.
    try:
        from shared.component_feature_analyzer import ComponentFeatureAnalyzer  # type: ignore
        key = component_cache.key(optimization_result.geometry_hash)
        cf = None if force_reanalysis else component_cache.get(key)
        if cf is not None:
            logger.info(f"[component_features] cache hit {key[:12]}")
        else:
            mfg = optimization_result.geometry_features.manufacturing_features
            bbox = optimization_result.geometry_features.bounding_box
            with telemetry.stage("component_features"):
                cf = ComponentFeatureAnalyzer().analyze(shape, mfg, bbox)
            component_cache.put(key, cf)
            logger.info(
                f"[component_features] computed blank={cf['blank']['face_id']} "
                f"setup_axes={len(cf['setup_axes_candidates'])} gcd_relations={len(cf['gcd_relations'])}"
            )
        response["geometry_features"]["manufacturing_features"]["component_features"] = cf
    except Exception as exc:
        logger.warning(f"[component_features] extraction failed: {exc}")

    return response
