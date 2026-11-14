# Sand-casting tolerance and machining-allowance guidance

`casting-tolerance-guidance.csv` lists, for each material family and moulding method, the casting tolerance grade (CT / DCTG) and machining-allowance grade (RMAG) ranges that **open** sources publish. Each row gives its publisher, URL, the quoted words, the ISO edition it refers to, a confidence, and the retrieval date. All rows were retrieved on 2026-11-13.

## What it is for

It is **guidance for an engineer choosing a grade**. It is never a value the costing uses.

- Machining allowance comes, in order, from:
  1. the drawing or PMI;
  2. a **licensed** ISO 8062-3 dataset (`machining_allowance_datasets`);
  3. an **approved** foundry or customer profile (`machining_allowance_profiles`);
  4. an engineer's estimate.

  Otherwise it is `requires_review` (migration 1002).
- The ISO tables that turn a grade and size band into millimetres are copyrighted and are **not** copied here.
- The single-range `typical_allowance_mm` values are the source's own words (low confidence).
- Machining allowance (stock on machined faces) is not pattern shrinkage; nothing here is shrinkage.

## Reading it

- A `family` such as `Aluminum|Magnesium` means one source column (ISO "light metal alloys") was mapped to several families. The mapping is ours, as stated in `notes`.
- `confidence: none` means no open source was found. The row has no value, and no other family's grades are borrowed.
- The ISO editions disagree. ISO 8062:1984 gives ferrous hand-moulded CT 11-13; ISO 8062-3 (as reproduced by Modulus Metal) gives DCTG 11-14. Both are kept with their edition.
- SFSA Supplement 3 gives RMAG grades for **steel** only: hand G-K, machine and shell F-H. It also requires a minimum of 6 mm on cope surfaces.
- The Hadleigh Castings row is a foundry **tolerance** guide, not an allowance. It is an example of a published foundry profile and counts only once entered and approved as a profile.

## Not mapped

`memory/Sand casting/Raw Material/raw_materials.csv` has 117 materials. Three have no `Material Type`, so they are not assigned to a family:

- `ASTM Grade 50 Gray Iron`
- `Brass, CW617N`
- `Brass, Free-Cutting 360`

Fix their type in the source data rather than mapping them here.
