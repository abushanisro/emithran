# Accuracy gate of the sand casting analysis (design step S3)

The design (`docs/design/sand-casting-module.md`, G8 and S3) does not allow an accuracy claim from synthetic samples: the analysis is compared with
**labelled real parts**, under tolerances agreed in advance. This folder is the repeatable way to do that; the corpus itself does not exist yet.

```
casting-worker/accuracy.sh <manifest.json>      a corpus
casting-worker/accuracy.sh --synthetic          the hand-worked samples: checks the tooling, never claims S3 (CI runs it)
```

The worker runs in its production sandbox (no network, read-only root, the corpus mounted read-only); results go to a temporary folder that is removed
at the end. **Real parts are customer data: keep them outside this repository and out of every image** (decision D13).

## The manifest

```json
{
  "corpus": "real",
  "requiredPassRate": 0.9,
  "minParts": 30,
  "tolerances": { "weightPct": 3, "minWallMm": 1 },
  "parts": [
    { "id": "bracket-017", "file": "bracket-017.step", "densityKgM3": 7100,
      "labels": { "weightKg": 4.2, "coreCount": 1, "minWallMm": 8, "drawAxis": "y" } }
  ]
}
```

`file` is relative to the manifest's folder. **Nothing is defaulted:** the pass rate, the smallest corpus and every tolerance are written in the manifest,
because they are an agreement between the people who judge the analysis, not a constant of the code. An invalid manifest is refused (exit 2) with every
problem named.

## What is compared

| Label | The analysis's value | Within tolerance when |
|---|---|---|
| `weightKg` | part volume x `densityKgM3` | within `tolerances.weightPct` percent |
| `coreCount` | the number of cores | equal |
| `minWallMm` | the thinnest wall (`casting.wall_mm.min`) | within `tolerances.minWallMm` mm |
| `drawAxis` | `casting.draw_axis` (the automatic choice) | equal |

Only the labels a part has are judged. A part the worker cannot analyse, or a measurement it does not make, is a **miss with the reason**, never a skip.
The gate says the measurements are within tolerance when every labelled metric reaches `requiredPassRate` on at least `minParts` parts.

**S3 is claimed only for a corpus declared `"real"`.** A `"synthetic"` corpus can have perfect measurements and the last line of the report still says
S3 is not claimed.

## Collecting the corpus (what to ask for)

Per part, from the foundry or the drawing office: the STEP file the cost model would be given; the net weight (drawing or weighed casting) and the
material, for the density; the number of sand cores the pattern shop makes; the thinnest wall; the axis the pattern maker would open the mould along. Cover
the parts the analysis will meet: with and without cores, thin and thick walls, simple and ribbed, small and large. Open items for the people who judge
the analysis: the tolerances and the pass rate above, and whether weight is to be judged against drawing or weighed values.

## The exit codes

0 the measurements are within tolerance, 1 they are not, 2 the manifest is invalid, 64 usage. The comparison itself is `backend/src/test-tools/casting-accuracy.ts`
(unit-tested, 17 cases including every refusal).
