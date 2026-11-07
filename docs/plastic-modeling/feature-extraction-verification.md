# Plastic feature extraction: what the CAD engine finds, checked against the reference and against known geometry

Status: **verification, no code or cost changed.** Evidence date 2026-11-07, engine at `main` (0eef627f), live `/analyze/geometry` with `family_hint=plastic_molded` and an explicit +Z pull.

## 1. What the reference expects

`memory/Plastic Modeling/process/digital_factory_operations.csv` (92 rows) names **12 feature types**: `PlanarFace`, `CurvedSurface`, `CurvedWall`, `SharpEdge`, `Rib`, `SimpleHole`, `MultiStepHole`, `Void`, `ComboVoid`, `PartingLine`, `SlideBundle`, `LifterBundle`. Injection, RIM and structural foam each list 11 of them; compression 9; "No Cost Feature" 5. A hole, multi-step hole, void or combo void also carries an operation per tooling kind (`NoCore`, `SideCore`, `Lifter`, `UnscrewMandrel`); the engine finds the feature, and `plastic-catalog-operation-resolver.ts` picks the operation.

## 2. Method

1. **Ground truth.** Parts built in OpenCascade whose contents are known exactly (`verification/ground_truth_parts.py`, 16 parts). Each was sent to the running service; the answer is compared with what is physically in the part. Dimensions and areas below were also checked by hand.
2. **Real CAD.** The 15 STEP parts in `cad-samples/liner.zip` (customer housings and brackets; not known to be plastic parts) were run through the same path to see every type appear on real geometry and nothing crash. There is no expected answer for these, so they prove reach, not correctness.
3. **Reading of the code** for the rules, against the staged variables that define them.

## 3. Result per feature type

| Type | Extracted? | Evidence (known geometry) | Verdict |
|---|---|---|---|
| **PlanarFace** | Yes | Plate with 4 holes: 6 faces, 8,813.81 mm2 = 2x4,000 - 4 hole areas + 1,040 sides. Plain 40x40x10 block: 6 faces, 4,800 mm2 (exact). Block with a pocket along the pull: 11 faces, 12,800 mm2 (exact). | **Correct** |
| **CurvedWall** | Yes | Tube, outer cylinder 3,769.91 mm2 = 2 pi 15 x 40. Domed cup, outer cylinder 3,141.59 mm2 = 2 pi 25 x 20. | **Correct** |
| **CurvedSurface** | Yes | Domed cup: 7,107.85 mm2 = outer + inner hemisphere (hand: 7,107.9). | **Correct** |
| **SimpleHole** | Yes | 4 through holes dia 6 depth 4 (all four, exact). Blind hole dia 8 depth 10 along the pull. 2 side holes dia 6 depth 15. | **Correct.** Limit: a cup's inner bore (dia 45, 20 deep) and a tube's bore are also reported as a hole, because the rule is a concave cylinder. |
| **MultiStepHole** | Yes | Counterbore along the pull. Side counterbore: steps dia 12 for 5 mm then dia 6 for 25 mm, depth 30 (exact). | **Correct** |
| **Void** | Yes, when the halves cannot form it | Side pocket 20 deep: found, undercut area 800 mm2 (exact). A pocket **along** the pull is **not** a Void by design (`side_actions.py`: it needs no tooling and stays in PlanarFace). A pocket in the inner wall: Void `no_accessible_direction`. | **Correct to its stated reading.** The reference lists `Void / As Molded`; whether an along-pull pocket should be a Void is not stated in `memory/` (ASSUMED). |
| **ComboVoid** | Yes | Side hole beside a side pocket: 1 ComboVoid. Two pockets 3 mm or 18 mm apart: **no** combo (a bundle of 2). | **Per the code's reading** (a combo needs a void and a hole); the module docstring says "voids and obscured holes", the code requires both. The reference does not say which. |
| **LifterBundle / SlideBundle** | Yes | Every side action square to the pull is emitted as `LifterBundle` with `slide_alternative: true`. `SlideBundle` appears only where the action is not square enough for a lifter (real parts: Cannula Holder Left, Cannula Holder bottom). | **Found; slide vs lifter is not decided** (stated in the code: it depends on clearance beside the part). The two have different cost in the reference. |
| **PartingLine** | Yes, when the walls have draft | Drafted tray (3 deg), length 208.39 mm = outer perimeter at the rim (62.1 x 42.1). Zero-draft parts: reported **not found, with the reason**. Found on 10 of 15 real parts. | **Correct**, and never silently "none". |
| **SharpEdge** | **No** | Always listed under `not_yet_recognized` with the reason: no staged rule defines a sharp edge (no angle or radius). Its only operation is As Molded (no cost). | **Not extracted, by design, stated.** |
| **Rib** | **Unreliable** | See section 4. A tray with 3 ribs: **0 found**. Real parts: 1 to 2 found on 7 of 15. | **Defective** |

Operation reach: `UnscrewMandrel` (9 of the 92 reference rows) can never be chosen, because threads are not detected (stated in the resolver). `SharpEdge` and `Rib` (8 rows) are As Molded only.

## 4. Finding F-1: the rib detector depends on how the CAD file was written

`InjectionMoldedFeatureExtractor._detect_ribs` looks for two **antiparallel** planar faces (normals facing each other) at a separation of 0.30 to 0.85 x nominal wall. The planes come from `shared/draft_angle_geometry.analyze_draft_angles`, which takes each plane's normal from `plane.Axis().Direction()`: the axis of the underlying surface. That is **not** the face's outward normal when the face is reversed in its solid. Die casting (`die_casting/features/surfaces.py`, `combo_void.py`) and sheet metal already apply `face.Orientation()`; this function does not.

Reproduced: for the 3-rib tray, the two faces of a rib reach the detector with the same normal (0, 1, 0), at offsets 14.25 and 15.75; the antiparallel test (`dot < -0.97`) can never pass, so `rib_count` is 0 and the cost signal falls back to the pocket-floor proxy (**21** for a part with 3 ribs). On real STEP files the result depends on whether the exporter happened to write plane axes outward, which is why some real parts do show ribs.

**Measured effect of the obvious fix** (applying `Orientation()` to the normal, tried on an in-memory copy; nothing was changed in the repo), across the 10 constructed parts and the 15 real parts:

* Draft counts (undercut, drafted, overdrafted, undrafted faces) are **identical on all 25 parts**: routing's "side action required" and the undercut cycle-time term do not move.
* Rib counts change in both directions: 3-rib tray 0 -> **3** (correct); but also 0 -> 1 on a part with no rib (most likely the 1 mm skin left behind the pocket, which the same thin-wall rule matches; not isolated further), Linear Motor Mount 2 -> 0, Main Chassis 16 -> 8, Cannula Holder Left 4 -> 6, Right 4 -> 7. Without a ground truth for the real parts, which of these is right is unknown.

**Conclusion:** the sign defect is real, but fixing only the sign would swap one unreliable answer for another, because the rule itself ("two faces closer than 0.85 x wall") also matches thin walls. The rib count is therefore **ASSUMED / not validated**, and should not be shown as a count of ribs until a rib rule is specified. Ribs carry no cost in the catalog (As Molded), but `memory/` stages rib-insert variables (design, CNC and spotting hours per rib insert; the rib height above which an insert is needed), so a real rib recognition is needed before tooling can use them. **Decision requested:** specification (or reference parts) for what a rib is; then replace the legacy rule, with the orientation fixed, in one PR with ground-truth parts.

## 5. Smaller observations (no action taken)

* A domed cup with no undercut reports `undercut_area_mm2` 537.55 in the pull-direction analysis and no Void: the number is not explained (no feature is emitted from it). To look at when the pull analysis is next touched.
* The cup's inner cylinder is emitted as a blind `SimpleHole` (dia 45): harmless today (a hole along the pull is As Molded), but a rule that prices holes by diameter would read it as a hole.
* The 15 real parts exercised every type except `SharpEdge` without a failure: 7 `Rib`, 10 `PartingLine`, ComboVoid on 6, SlideBundle on 2, MultiStepHole on 1.

## 6. Reproduce

```
docker cp docs/plastic-modeling/verification/ground_truth_parts.py <cad-engine-container>:/tmp/
docker exec <cad-engine-container> /opt/conda/envs/cad-env/bin/python /tmp/ground_truth_parts.py /tmp/gt
```

Each part prints what is in it and what the engine returned. The tray with 3 ribs is the one that disagrees (F-1). The drafted-tray parting-line check is not in the script (its lofted faces are splines, not planes); the 208.39 mm figure was measured on a lofted tray with 3 deg of draft, and the parting line was found on 10 of the 15 real parts.
