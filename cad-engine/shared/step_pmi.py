"""
Semantic GD&T (PMI) read from the STEP model itself.

A STEP file can carry geometric tolerances as semantic entities
(FLATNESS_TOLERANCE, POSITION_TOLERANCE, the AP242 complex instances
(GEOMETRIC_TOLERANCE ... POSITION_TOLERANCE()), each with its zone magnitude
as a LENGTH_MEASURE_WITH_UNIT). This is the only 3D-model source of GD&T the
platform has. A STEP without these entities (most AP203/AP214 exports) carries
no GD&T at all, and that is reported as such — never inferred from geometry.

Read from the STEP entity model (STEPControl_Reader.StepModel(), StepDimTol_*)
rather than through XDE: pythonocc 7.7.2 does not wrap XCAFDoc_GeomTolerance,
so the XDE route cannot reach the tolerance objects.

Callout shape matches the drawing analyzer's `gdt_callouts` entries so the
backend reads both sources the same way: {"type": "flatness", "tolerance": 0.05}
with the tolerance in mm, converted from the magnitude's own STEP unit — plus
`face_ids`, this source's own addition: the real, stable face id(s) (see
shared/stable_face_id.py — content-based, so it correlates with the main
extractor's own face ids even though this reads the STEP file independently)
of the face this tolerance actually applies to. `[]` when AP242 genuinely
carries no such link for this tolerance, or when it does but the linked item
isn't a face (an edge/vertex-toleranced callout) — never guessed from
proximity or from which face happens to be named similarly.

AP242's real chain from a tolerance to its face (verified against this
project's own pythonocc build, not assumed from general OCCT docs):
  StepDimTol_GeometricTolerance.TolerancedShapeAspect() -> (select) .ShapeAspect()
    -> the real StepRepr_ShapeAspect, identified by name
  scan the model for StepAP242_GeometricItemSpecificUsage entities whose own
    .Definition() -> (select) .ShapeAspect() has that SAME name (pythonocc
    wraps no other equality check on shape aspects; two callouts would have
    to share one shape aspect's exact name to collide here — treated as
    genuine ambiguity, not resolved, when it happens)
  StepAP242_GeometricItemSpecificUsage.IdentifiedItemValue(k) -> the STEP
    entity actually representing the toleranced geometry (an ADVANCED_FACE
    for a face-toleranced callout)
  XSControl_TransferReader (STEPControl_Reader.WS().TransferReader()):
    .TransferOne(item) then .ShapeResult(item) -> the real TopoDS_Face
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Every semantic tolerance in a Part 21 file is instantiated through an entity
# whose name ends in _TOLERANCE. Absent that, there is nothing to read, so the
# entity-model pass is skipped.
_TOLERANCE_ENTITY = re.compile(rb"[A-Z_]*_TOLERANCE\s*\(")

# Tolerance core names (from the StepDimTol_<Core>Tolerance class, or from the
# StepDimTol_GTT<Core>Tolerance enum a complex instance reports) -> the
# snake_case symbols the backend normalises (gdt-severity.ts normalizeGdtSymbol).
_SYMBOLS = {
    "Angularity": "angularity",
    "CircularRunout": "circular_runout",
    "Coaxiality": "coaxiality",
    "Concentricity": "concentricity",
    "Cylindricity": "cylindricity",
    "Flatness": "flatness",
    "LineProfile": "profile_of_line",
    "Parallelism": "parallelism",
    "Perpendicularity": "perpendicularity",
    "Position": "position",
    "Roundness": "circularity",
    "Straightness": "straightness",
    "SurfaceProfile": "profile_of_surface",
    "Symmetry": "symmetry",
    "TotalRunout": "total_runout",
}

# SI prefix -> metres per unit, then to mm.
_SI_PREFIX_TO_M = {
    "Exa": 1e18, "Peta": 1e15, "Tera": 1e12, "Giga": 1e9, "Mega": 1e6, "Kilo": 1e3,
    "Hecto": 1e2, "Deca": 1e1, "Deci": 1e-1, "Centi": 1e-2, "Milli": 1e-3,
    "Micro": 1e-6, "Nano": 1e-9, "Pico": 1e-12, "Femto": 1e-15, "Atto": 1e-18,
}


def _enum_name(module: Any, prefix: str, value: int) -> Optional[str]:
    for attr in dir(module):
        if attr.startswith(prefix) and getattr(module, attr) == value:
            return attr[len(prefix):]
    return None


def _as(cls, entity):
    """entity downcast to cls, or None — pythonocc DownCast raises on a mismatch."""
    if entity is None or not entity.IsKind(cls.__name__):
        return None
    return cls.DownCast(entity)


def _named_unit_to_mm(named_unit) -> Optional[float]:
    """mm per one of this STEP length unit, or None when it is not a length unit we can resolve."""
    from OCC.Core import StepBasic

    si = _as(StepBasic.StepBasic_SiUnit, named_unit)
    if si is not None:
        if _enum_name(StepBasic, "StepBasic_sun", si.Name()) != "Metre":
            return None
        factor_m = 1.0
        if si.HasPrefix():
            prefix = _enum_name(StepBasic, "StepBasic_sp", si.Prefix())
            if prefix not in _SI_PREFIX_TO_M:
                return None
            factor_m = _SI_PREFIX_TO_M[prefix]
        return factor_m * 1000.0

    conv = _as(StepBasic.StepBasic_ConversionBasedUnit, named_unit)
    if conv is not None:
        # e.g. INCH = 25.4 × (SI millimetre): value × the inner unit's own factor.
        return _measure_to_mm(conv.ConversionFactor())
    return None


def _measure_to_mm(measure) -> Optional[float]:
    if measure is None:
        return None
    named = measure.UnitComponent().NamedUnit()
    per_unit_mm = _named_unit_to_mm(named) if named is not None else None
    if per_unit_mm is None:
        return None
    return float(measure.ValueComponent()) * per_unit_mm


def _tolerance_core(entity) -> Optional[str]:
    """'Flatness', 'Position', ... for a StepDimTol geometric tolerance entity."""
    from OCC.Core import StepDimTol

    class_name = entity.DynamicType().Name()
    m = re.fullmatch(r"StepDimTol_(\w+)Tolerance", class_name)
    if m and m.group(1) in _SYMBOLS:
        return m.group(1)
    # AP242 complex instances (StepDimTol_GeoTolAnd...) report their type
    # through GetToleranceType() on their own concrete class.
    concrete = getattr(StepDimTol, class_name, None)
    get_type = getattr(concrete, "GetToleranceType", None) if concrete is not None else None
    if get_type is None:
        return None
    value = concrete.DownCast(entity).GetToleranceType()
    name = getattr(value, "name", None) or _enum_name(StepDimTol, "StepDimTol_GTT", value)
    name = (name or "").removeprefix("StepDimTol_GTT")
    return name[: -len("Tolerance")] if name.endswith("Tolerance") else None


def _shape_aspect_name(select_obj: Any) -> Optional[str]:
    """The real StepRepr_ShapeAspect's own Name(), from either select type
    this file reads one off (GeometricToleranceTarget or
    ItemIdentifiedRepresentationUsageDefinition) — both wrap a ShapeAspect()
    accessor; neither has any other reliable equality this binding exposes."""
    if select_obj is None or not hasattr(select_obj, "ShapeAspect"):
        return None
    aspect = select_obj.ShapeAspect()
    if aspect is None:
        return None
    try:
        return aspect.Name().ToCString()
    except Exception:
        return None


def _toleranced_face_ids(model: Any, reader: Any, tolerance_entity: Any) -> List[str]:
    """The real, stable face id(s) this one tolerance applies to — [] when
    AP242 carries no such link, or the linked item(s) aren't faces."""
    from OCC.Core import StepAP242
    from OCC.Core.TopAbs import TopAbs_FACE
    from shared.stable_face_id import compute_stable_face_id

    target_name = _shape_aspect_name(tolerance_entity.TolerancedShapeAspect())
    if not target_name:
        return []

    matches = 0
    resolved_giu = None
    for i in range(1, model.NbEntities() + 1):
        giu = _as(StepAP242.StepAP242_GeometricItemSpecificUsage, model.Value(i))
        if giu is None:
            continue
        if _shape_aspect_name(giu.Definition()) == target_name:
            matches += 1
            resolved_giu = giu
    # More than one GeometricItemSpecificUsage names the same shape aspect:
    # which one is THIS tolerance's is genuinely ambiguous with the equality
    # this binding gives us — disclosed as unresolved, never guessed.
    if matches != 1 or resolved_giu is None:
        return []

    tr = reader.WS().TransferReader()
    face_ids: List[str] = []
    for k in range(1, resolved_giu.NbIdentifiedItem() + 1):
        item = resolved_giu.IdentifiedItemValue(k)
        if item is None:
            continue
        tr.TransferOne(item)
        shape = tr.ShapeResult(item)
        if shape is None or shape.IsNull() or shape.ShapeType() != TopAbs_FACE:
            continue  # a real link, but to an edge/vertex — not a face to highlight
        face_ids.append(compute_stable_face_id(shape))
    return face_ids


def read_step_gdt(step_path: str) -> Dict[str, Any]:
    """
    {"status": "read" | "no_tolerance_entities" | "error",
     "gdt_callouts": [{"type", "tolerance", "face_ids"}...],
     "unresolved": [str, ...]}   # tolerances found but not convertible, named
    """
    with open(step_path, "rb") as fh:
        if not _TOLERANCE_ENTITY.search(fh.read()):
            return {"status": "no_tolerance_entities", "gdt_callouts": [], "unresolved": []}

    try:
        from OCC.Core.IFSelect import IFSelect_RetDone
        from OCC.Core.STEPControl import STEPControl_Reader
        from OCC.Core import StepDimTol

        reader = STEPControl_Reader()
        if reader.ReadFile(step_path) != IFSelect_RetDone:
            return {"status": "error", "gdt_callouts": [], "unresolved": ["STEP entity model read failed"]}
        reader.TransferRoots()  # needed for TransferReader().ShapeResult() below, not just for geometry
        model = reader.StepModel()

        callouts: List[Dict[str, Any]] = []
        unresolved: List[str] = []
        for i in range(1, model.NbEntities() + 1):
            tol = _as(StepDimTol.StepDimTol_GeometricTolerance, model.Value(i))
            if tol is None:
                continue
            core = _tolerance_core(model.Value(i))
            symbol = _SYMBOLS.get(core or "")
            if symbol is None:
                unresolved.append(f"#{i} {tol.DynamicType().Name()}: tolerance type not identified")
                continue
            magnitude_mm = _measure_to_mm(tol.Magnitude())
            if magnitude_mm is None or magnitude_mm <= 0:
                unresolved.append(f"#{i} {symbol}: magnitude unit not a resolvable length unit")
                continue
            try:
                face_ids = _toleranced_face_ids(model, reader, tol)
            except Exception as exc:
                logger.warning(f"[step_pmi] #{i} {symbol}: face resolution failed: {exc}")
                face_ids = []
            callouts.append({"type": symbol, "tolerance": round(magnitude_mm, 6), "face_ids": face_ids})
        return {"status": "read", "gdt_callouts": callouts, "unresolved": unresolved}
    except Exception as exc:  # disclosed, never guessed
        logger.warning(f"[step_pmi] GD&T read failed: {exc}")
        return {"status": "error", "gdt_callouts": [], "unresolved": [str(exc)]}
