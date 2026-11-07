# Plastic molding DFM: audit of the data, the code and the published guidance

Written 2026-11-07. Three sources were compared: the staged rule data (`memory/Plastic Modeling/lookup`), the code that produces DFM findings today, and published design guidance (web research, secondary sources unless stated).

## 1. Finding

Every plastic DFM rule in the product uses a number typed into the code. The staged rule data (`manufacturabilitySeverity`, `adviceRules`, `tblDTCLimits`) is in the database (migrations 651, 665, 672, 823) and nothing reads it for plastic. Warnings carry no face ids, so a finding cannot be highlighted on the model, and nothing writes a finding as text on the model.

## 2. What the rule data defines (`memory/Plastic Modeling/lookup`)

`manufacturabilitySeverity` (96 rows) gives, per rule, process and material, a threshold for each severity (Critical, Major, Minor):

| Rule | Measured on the part | Thresholds in the data |
|---|---|---|
| InsufficientDraftAngle | draft angle of a face to the pull | injection 0.01 / 0.5 / 1 deg (critical / major / minor); per material (acrylic 1 / 2, acetal 1.5, polycarbonate 1 / 2, nylon 0.01 / 1); compression 1.5; RIM and structural foam 0.5 / 1 |
| ThinSection | wall thickness | minimum per material (ABS 1.143, nylon 0.762, polycarbonate 1.016, PPS 0.508 mm ...), compression 1.5, RIM 1.524, structural foam 2.032 mm |
| ThickSection | wall thickness | maximum per material (ABS 3.556, nylon 2.921, polycarbonate 3.81, PPS 4.572 mm ...), compression 25, RIM 50.8, structural foam 15 mm |
| SharpInternalEdge / SharpExternalEdge | edge radius | injection 0.127 / 0.381 mm; compression 2 / 1.5; RIM 1.5875 / 0.762; structural foam 1.524 / 1.524 |
| HighHoleLengthToDiameterRatio | hole length / diameter | large 8 (major) 6 (minor); small 6 / 4 |
| HighBlindHoleLengthToDiameterRatio | blind hole L/D | large 4 / 3; small 3 / 2 |
| ThinWallAroundHole | distance from a hole to the nearest wall | 1 x (max of hole diameter or average thickness) major, 2 x minor |
| HighFlowRatio | flow length / wall against the material's flow length ratio | boolean, critical (the ratio is a material column: `processingParameters.flowLengthRatio`) |
| ExternalUndercut / InternalUndercut / FlexibleUndercut | a void that locks the die or cannot be reached | boolean (critical, critical, major) |
| NonRegrindableMaterial / InsufficientRegrindAvailable | regrind against the material | boolean |

`adviceRules.csv` enables 24 rules; 14 of them have no threshold row (CavityFinishCheck, MoldRatingCheck, SimpleHoleCouldBeFormed, VoidRequiresMachining, ...): they are advice, with no numbers to evaluate. `tblDTCLimits`: compression cutout utilization 0.8 and cure time 3.0 x max thickness. Not defined anywhere in the data: what a "large" or a "small" hole is.

## 3. What the code does today

| Rule in the product | Threshold in the code | The data's value |
|---|---|---|
| draft | 0.3 deg undrafted; text "0.5 deg, 1.5 deg textured" | material-specific, 0.01 / 0.5 / 1 deg |
| thin wall | a histogram bin under 0.60 x nominal, and 0.3 mm | per material, absolute mm |
| wall range | nominal under 1.0 or over 6.0 mm | per material (nylon 0.762 .. 2.921) |
| wall variation | std dev / nominal over 0.40 | no rule in the data |
| parting complexity | score 0.5 / 0.75; the score is a face-count ratio, not a parting-line measure | no rule in the data |
| undercut | any undercut face is critical | boolean, by kind of void |
| rib without fillet | any | no rule in the data |

Not implemented anywhere for plastic: hole L/D, blind hole L/D, thick section as a rule, sharp edges, thin wall around a hole, flow ratio, material-specific draft, regrind.

Face ids: draft (`im_undrafted`) and undercut (`im_undercut`) have faces in `feature_graph_v2`; the modal wall pairs have faces (`measurements.wall_thickness`); holes have faces in `recognition_core`. Thin and thick zones, wall variation, ribs and parting have none. The Design / DFM tab shows cards that are not clickable. A text overlay on the model exists for dimensions (`dimension-overlay.tsx`), not for DFM.

## 4. What the published guidance says (cross-check)

The staged wall limits are the published ones: the ThinSection and ThickSection values match the Protolabs wall-thickness table for every resin both list (ABS 1.14-3.56, acetal 0.76-3.05, nylon 0.76-2.92, polycarbonate 1.02-3.81, PPS 0.51-4.57 mm). The staged draft default (0.5 deg major) matches the Protolabs 0.5 deg minimum.

Guidance the data does not define, from secondary sources only (not enabled as rules until a stated source and threshold are staged): rib thickness 40-60 % of wall and height up to 2.5-3 x wall; boss wall 40-60 %; internal corner radius at least 0.5 x wall and external radius internal + wall; hole to edge 2-3 x diameter; wall transition no less than 40-60 % of the neighbouring wall; shut-off faces 3 deg; light texture 3 deg and about 1.5 deg more per 0.025 mm of texture depth. The sources disagree on several of these (rib fillet 0.25-0.5 x vs 0.25-0.4 x wall; blind hole depth 2 x vs 3-4 x diameter; hole-to-edge 3 x diameter vs max(2 x diameter, 2 x wall)), which is why none is enabled without an owner choosing one.

## 5. Plan

1. A data-driven plastic DFM engine (pure, the pattern of `sand-dfm.ts`): rule rows from the staged tables, the severity from the data, a finding with measured value, threshold, the data's note and the faces; rules it cannot measure are listed as not evaluated with the reason, never as passed.
2. CAD measurements it needs and does not have: wall thickness for every face pair (not only the modal one), edge radii, hole length and diameter classes, distance from holes to walls.
3. The Design / DFM tab: each finding clickable, highlighting its faces; the finding's text placed on the model at its position.
4. Remove the hard-coded thresholds once the engine covers the rule, showing before and after for each part.

## 6. Status

- Stage 1 (#269): the data-driven engine, draft angle and hole length to diameter, the findings' faces highlighted from the Design / DFM tab.
- Stage 2: wall thickness at every face (the diameter of the largest ball inside the material touching the face, from the recognition mesh), so ThinSection and ThickSection are judged by material and located. Measured on parts of 1,000 to 4,500 triangles in 0.2 to 2 seconds. Its limits: a thickness is good to about the mesh deflection (reported as `resolution_mm`); a face is read by its largest ball, so a thin zone inside a face that is thicker elsewhere is not located below the face; 2 to 8 percent of sample rays leave through no surface on an open mesh and give no number for that sample.
- Not yet: ThinWallAroundHole, SharpInternalEdge and SharpExternalEdge (edge radii), HighFlowRatio (no gate), the undercut kinds, regrind, and the text written on the model.

- Stage 2, accuracy check on the real Back cover (nylon, 959 faces, 19,283 triangles), against an independent implementation (the ball grown outward and stopped at its first contact, brute-force distance to every triangle, no code shared with the engine): at the same points the two agree to 0.01 mm. The first version sampled ONE point per face (the ray budget was divided by the number of faces): face 270 read 0.36 mm from its largest triangle and 1.9 mm elsewhere, and about 30 percent of the part's thin faces (190 of them, 133 once sampled properly) were that noise. Now 3 to 6 points per face: on 104 faces the engine and the independent measurement agree within 15 percent on 93 percent and give the same thin-section verdict on 103. The draft angle of 465 faces, recomputed from the triangle normals against the pull axis the engine used (+Y), was graded differently on none. Cost: about 15 s for the wall step on a 19k-triangle part.
