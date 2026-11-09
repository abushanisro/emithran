# Forging geometry extractor: output contract

`cad-engine/forging/` measures one closed-die forging solid and returns one JSON payload, described by
`cad-engine/contract/forging_geometry.schema.json` (JSON Schema 2020-12, version 1, additive: consumers ignore unknown fields).
**It measures. It applies no DFM threshold and computes no cost.** The backend DFM service reads the payload and applies the staged
thresholds in `memory/Forging/Lookup/forging_manufacturabilitySeverity.csv`. It is **not wired into the upload pipeline**.

```python
from forging import extract_forging_geometry, extract_forging_geometry_from_step
payload = extract_forging_geometry(shape, draft_thresholds_deg=[5, 7])   # a TopoDS_Shape
payload = extract_forging_geometry_from_step("part.step")
```

## Versioning and the cache key

| Field | Meaning |
|---|---|
| `schema_version` | Layout of the payload. Additive changes keep it; a breaking change bumps it. |
| `extractor.version` | Semantic version of the algorithms (`forging/constants.py: EXTRACTOR_VERSION`). Bump it on any change that can change a number. |

The analysis cache key is `geometry_hash` salted with `CACHE_VERSION` (`geo_v59`, `shared/memory_optimizer.py`). **Open conflict:** v1.1
section 8 says a forging extractor change bumps `CACHE_VERSION` and there is no separate `extractor_version`; the Phase 3 brief asks for an
extractor version in the key. The payload carries `extractor.version`; `CACHE_VERSION` is untouched here. The wiring phase must pick one: salt the
key with `extractor.version`, or bump `CACHE_VERSION` for every extractor change.

## The one threshold

`DRAFT_THRESHOLD_DEG = 0.01` (staged `InsufficientDraftAngle`, Critical, every material). It decides one question, *is this surface parallel to
the pull?*, and is used for both the zero-draft area and the die-lock test. v1.0's second angle (-0.5 degrees in code, a -0.05 dot product in the DFM
rule) is gone. `parameters.draft_threshold_deg` repeats it. Material thresholds (3, 5, 7 degrees) are **inputs** to the draft figures
(`draft_thresholds_deg`), never defaults.

## What is measured, and how

| Section | Value | Method (reused code in bold) |
|---|---|---|
| `selected`, `pull.axes[].silhouette` | `projected_area_mm2`, `parting_perimeter_mm`, `footprint_mm`, `pull_extent_mm` | **`casting_geometry.parting_plane_silhouette`**, unchanged. True silhouette: mesh triangles projected and merged; the perimeter is the outer boundary only (a through-opening is not counted). |
| `pull.axes[].faces[].draft_*_deg`, `draft.area_below_deg` | draft = `asin(abs(n . d))`: 0 parallel to the pull, 90 a floor or roof | Exact outward surface normal (projected onto the true B-Rep face, flipped by face orientation) at up to 16 samples per face, area-stratified. Curved faces report min / max / area-weighted mean, not one midpoint. Tessellation from **`casting_geometry._ensure_mesh` / `_face_triangles`**. |
| `pull.axes[].die_lock` | `has_die_lock`, `locked_area_mm2`, `locked_face_indices` | **Visibility, not normal**: from each sample, a ray along its own die's direction (+d if it faces +d, -d if it faces -d) against the exact B-Rep (`IntCurvesFace_ShapeIntersector`). A hit means no die can retract from that point. Surfaces within 0.01 degrees of parallel face neither die and are not tested. Complete for a two-piece die. |
| `pull.*` | `chosen_axis`, `scores`, `tied_axes`, `die_lock_free_axes` | The three canonical axes. Score, smaller is better, lexicographic: (die-locked area, zero-draft area). Ties keep x, y, z order and are listed. Silhouette area and die depth are reported, not scored: no sourced weight exists. |
| `blends` | radii of fillets and corner rounds | Cylinder, torus (minor radius) and sphere faces tangent (within 1 degree) to a neighbour of a different surface. `concave` = material outside the radius. |
| `holes` | diameter, depth, L/D, blind, angle to pull | **`shared.machining_geometry.collect_cylinders`**, measured along the chosen pull. |
| `revolution` | area fraction about a turning axis, per world axis | Faces that are surfaces of revolution about the line through the centre of mass along each world axis. For the staged `surfaceAreaThreshold2D` (0.95) / `2_5D` (0.75). |
| `part` | volume, surface area, box, `longitudinal_ratio`, centre of mass | **`shared.solid_measures.measure_solid`**. Ratio = largest over next-largest box dimension, for `partLongitudinalRatioThreshold` (2). |
| `wall_thickness` | min, nominal, max wall, plus `solid_shadow_area_mm2` | **`casting_geometry.wall_thickness_profile`**; shadow area = the projected area along the chosen pull (open item D8). |
| `sections` | `A(x)` at 41 stations along the longest (or a given) world axis; equivalent radius mean, std, CV; `volume_check_ratio` | Every mesh triangle is cut by each station plane; the section area is the shoelace sum of the oriented cut segments, so bores subtract by orientation. `volume_check_ratio` = integral of A(x) over the exact volume, an independent check. |

## Accuracy (stated tolerances, verified by `test/test_forging_geometry.py`)

The extractor tessellates at `linear_deflection_mm` (0.05). Planar figures are exact. Curved ones are mesh-limited.

| Figure | Tolerance | Hand-checked on |
|---|---|---|
| Silhouette area | 1 % (about 0.2 % at R = 40) | box, puck, rod, flanged disc, cross-holed block, frustum |
| Parting perimeter | 0.5 % | same |
| Draft angle | 0.05 degrees | 5 degree frustum |
| Die-locked area | 1 % | block with a 10 mm cross hole: 2 pi 5 x 60 = 1884.96 mm2 |
| A(x), its integral, radius CV | 1 % (CV 2 %) | flanged disc, stepped shaft |
| Zero-draft area | 0.1 % planar and full cylinders; curved faces are sampled, checked to 1 % | box, puck, rod |

Curved-face figures (draft area, locked area) are **sampled estimates**: each of up to 16 samples carries 1/16 of its face's exact area, so
a sample that lands exactly on a tangent line can move a figure by one sample's weight. Raise `max_samples_per_face` to tighten it.

## Not measured, and why

| Item | Status |
|---|---|
| Complexity score 1 to 12, the 2D / 2.5D / 3D class | The combining algorithm is unsourced (v1.1 6.2). Inputs are measured: `revolution`, `longitudinal_ratio`, `sections.equivalent_radius.coefficient_of_variation`. The "cross-sectional analysis angle standard deviation" (staged thresholds 11 and 30) is **not defined in the data**, so it is not computed. |
| Rib ratio | Not staged (v1.1 7). Walls are measured (`wall_thickness`); no rib figure is invented. |
| Which area band selects the `ThinSection` minimum | Open item D8. |
| Preform from A(x) | No sourced preform rule (v1.1 6.13). The curve is delivered; no preform is computed. |
| Feature types (`feature_type`) | **None emitted.** The canonical vocabulary has no forging domain and `memory/Forging/` has no `Processes/operations.csv` in the `Machine:Operation//Feature` grammar. See the proposal in the Phase 3 report; nothing is hand-named. |
| Mapping fillet = concave, corner = convex | The extractor's reading of the staged rule names; to be confirmed by the data owner. |
