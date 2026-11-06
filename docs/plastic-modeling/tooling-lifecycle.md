# Plastic Modeling: the tooling lifecycle cost model (D-9)

Status: **documentation for review. No costing behaviour is changed or recommended for implementation until the questions in section 7 are answered.**
Companion to `README.md` (audit) and `investigations.md` (I-2: the SPI class and tool life). Figures in sections 2 and 4 are produced by the engine on the repo's ABS test part (10,000 mm2 projected area, one cavity, USA toolroom rates) and reproducible from `plastic-molding-accuracy.spec.ts`.

## 1. What a tooling lifecycle cost has to answer

A mold is a purchase made once and used until it wears out. A quote that includes it has to decide six things. The column "Model today" says what the engine does.

| # | Question | Model today |
|---|---|---|
| 1 | What does the first mold cost to build? | Purchased components + design, machining and assembly hours at USA toolroom rates (F-16). Excludes steel, EDM, texture, cooling, slides and lifters beyond the staged hardware (G-01..G-08). |
| 2 | How many molds does the program wear out? | `ceil(lifetime shots per cavity / shots per tool)`, shots per tool from `tblToolLife` by resin (F-17). |
| 3 | What does each replacement cost? | The same as the first, in full. |
| 4 | Is anything repaired rather than replaced (refurbishment, maintenance, inserts)? | Not modelled. |
| 5 | Over what is the investment spread? | Annual volume x production life (F-18); persisted as a tooling record since #231. |
| 6 | Is it a capital investment or part of the piece cost? | Both: the Excel view shows the investment (Capital Costs) and the amortised cost per part (Tooling column); the quote total includes the amortisation. |

## 2. The model today, exactly

```
lifetime shots per cavity   = annual volume / cavities x production life            [shots]
shots per tool              = tblToolLife[resin type]   (default 260,000 if no row)  [shots]
molds required              = max(1, ceil(lifetime shots per cavity / shots per tool))
cost of one mold            = purchased components + design h x R_design + machining h x R_machining + assembly h x R_assembly   [USD]
tooling investment          = cost of one mold x molds required                      [USD]
tooling per part            = tooling investment / (annual volume x production life) [USD]
SPI class                   = from lifetime shots, parting complexity and undercuts   (informational: not in any line above)
```

Consequences, from the engine (cost of one mold $4,538.67 in every row; ABS, 144,000 shots per tool):

| Annual x years | Lifetime shots | SPI class (rating) | Molds bought | Tooling investment | Tooling per part |
|---|---|---|---|---|---|
| 1,000 x 5 | 5,000 | 105 (5,000) | 1 | $4,539 | $0.9077 |
| 10,000 x 5 | 50,000 | 104 (100,000) | 1 | $4,539 | $0.0908 |
| 50,000 x 5 | 250,000 | 103 (500,000) | 2 | $9,077 | $0.0363 |
| 100,000 x 5 | 500,000 | 103 (500,000) | 4 | $18,155 | $0.0363 |
| 500,000 x 5 | 2,500,000 | 101 (unbounded) | 18 | $81,696 | $0.0327 |
| 1,000,000 x 5 | 5,000,000 | 101 | 35 | $158,853 | $0.0318 |
| 2,000,000 x 5 | 10,000,000 | 101 | 70 | $317,707 | $0.0318 |

**The shape of the result:** beyond about 144,000 shots the tooling per part stops falling and settles near $0.032, because tooling grows in step with volume. There is no economy of scale in tooling above that point, and a Class 101 mold (rated for an unbounded number of cycles) is bought 70 times. Real programs do the opposite: the tooling is one larger, harder mold whose cost per part keeps falling.

## 3. What the staged data says about mold life

| Source | Content | Read today |
|---|---|---|
| `tblToolLife` | Shots per tool by resin: ABS, PBT, PC, PU, PPS 144,000; Acetal, Nylon 278,000; Acrylic 257,000; PP 321,000; PET, PS and the TPEs 428,000 | Yes (F-17) |
| `defaultToolLife` (variable) | 260,000, "the median value of the available data relating to tool life by part material type" | Yes, for a resin with no row |
| `tblSpiType` | SPI class 101-105: `Num Annual Mold Cycles` 9,999,999,999 / 1,000,000 / 500,000 / 100,000 / 5,000; and `Use Insert` true for 101 and 102 | Rating yes (informational); `Use Insert` no |
| `process/digital_factory_tool_materials_usa.csv` | Per **tool material** (the steel or aluminium the mold is made of): `toolLifeFactor`, `moldBaseCostFactor`, `ejectorBoxCostFactor`, price and density. AISI P20 1.0 / 1.0; H13 1.6 / 1.2; S42000 1.6 / 1.3; 4140 1.0 / 1.0; 1020 0.7 / 0.85; aluminium 7075 0.1 / 0.5; epoxy 0.003 / 0.35 | **No** |
| `digital_factory_settings_usa.csv` `defaultToolMaterialName` | AISI P20 | No |

The tool-material table is the part of the lifecycle model the engine does not use. Its factors read as a statement about the reference model: **shots per tool depend on the tool material as well as the resin, and so does the cost of the mold**. `tblToolLife` is most naturally the life of a mold made of the default tool material (P20, factor 1.0); a harder steel lasts 1.6 times as long and costs 1.2 to 1.3 times as much to build; aluminium lasts a tenth as long at half the cost. This is an inference from the shape of the data. No document in `memory/` states it.

## 4. Candidate readings, and what each does to the same programs

All three use only staged numbers. None is validated.

- **A. Today.** `tblToolLife` is the life of a mold; every mold costs the same; the class is not used.
- **C. Class rating governs life.** Molds bought = `ceil(lifetime shots / class rating)`: one mold for nearly every program (the rating of Class 101 is unbounded). Cost of one mold unchanged.
- **D. Tool material lifecycle (illustrative).** Life = `tblToolLife` x `toolLifeFactor` of the tool material; cost of a mold = P20 mold cost x `moldBaseCostFactor`; the tool material with the lowest total is used. The assumption that the cost factor applies to the **whole** mold build (not only the mold base steel) is mine and is unverified.

| Lifetime shots | A: molds / total | C: molds / total | D: molds / total / material |
|---|---|---|---|
| 5,000 | 1 / $4,539 | 1 / $4,539 | 1 / $2,269 / aluminium 7075 |
| 50,000 | 1 / $4,539 | 1 / $4,539 | 1 / $3,858 / AISI 1020 |
| 250,000 | 2 / $9,077 | 1 / $4,539 | 2 / $9,077 / AISI 4140 |
| 500,000 | 4 / $18,155 | 1 / $4,539 | 3 / $16,339 / AISI H13 |
| 2,500,000 | 18 / $81,696 | 1 / $4,539 | 11 / $59,910 / AISI H13 |
| 5,000,000 | 35 / $158,853 | 1 / $4,539 | 22 / $119,821 / AISI H13 |
| 10,000,000 | 70 / $317,707 | 1 / $4,539 | 44 / $239,642 / AISI H13 |

What the table shows:
- **A and C bracket the answer, and both are almost certainly wrong at high volume.** A buys a $4,500 mold 70 times; C buys one $4,500 mold for ten million shots. The truth is a much more expensive, much harder mold.
- **Both share a deeper defect:** the cost of one mold does not depend on the class or the tool material, so no reading can be right at both low and high volume.
- **D uses the staged lifecycle data and still gives $240,000 at ten million shots**, because each mold is still a $4,500 build; it only moves the answer by about a quarter.
- At low volume (up to about 50,000 shots) A, C and D agree within a factor of two: **the current model is adequate for prototype and low-volume quotes.** The exposure is above roughly 250,000 lifetime shots.

## 5. Other lifecycle elements with data and no formula

| Element | Staged data | Gap |
|---|---|---|
| Mold maintenance and refurbishment | None found | No data, no formula |
| Hardened inserts in the forming region (Class 101/102) | `tblSpiType.Use Insert`; `cmDesignHrsRibInsert*`, `Insert Pocket Machining` rates and setups | When inserts replace a whole mold, and their cost |
| Tool material choice | The tool material table | How the choice is made (by class? by volume? by the user?) |
| Mold cost by class | None | How a build differs by class |
| Residual value / reuse after the program | None | Out of scope of the reference data |

## 6. Where tooling shows in a quote

- The cost summary `tooling` block: investment, per part, molds required, tool life shots, class.
- A tooling record (since #231): `unit_cost` = the investment, `amortization_parts` = annual volume x production life.
- The Excel view: Capital Costs (investment) and Variable Costs, Tooling (amortised per part).
- Warnings: "Tooling-dominated" when the per-part tooling exceeds twice the material cost per part; the mold-base and component caveats. **There is no warning that more than one mold is assumed.**

## 7. Questions that decide the model

1. **What does `tblToolLife` count:** one whole mold, or a cavity/core insert set, or the tool steel of a P20 mold (section 3 suggests the last)?
2. **Does the tool material table apply to injection molds**, with `defaultToolMaterialName` P20 as the reference, and do `toolLifeFactor` and `moldBaseCostFactor` scale life and cost as section 3 reads them? Does the cost factor apply to the whole mold or only to the mold base steel?
3. **How is the tool material chosen** for a program (by SPI class, by lifetime shots, by the user)? How does `Use Insert` enter?
4. **Does the SPI class change what a mold costs** (it must, for Class 101 to be a different tool from Class 105)? By how much?
5. **Is a replacement mold bought at full price**, or is part of the first mold's cost reused (cavity inserts, mold base)?
6. **Which volumes must the quote be right for?** If the product only quotes up to about 250,000 lifetime shots, the current model is adequate and the correction can wait.
7. **A reference quote for a high-volume program** (one real number: tooling investment for 1 to 10 million shots of a stated part) to test any candidate against.

## 8. Recommendation

1. **Do not change any number yet.** No reading is validated, and the data supports at least three that disagree by two orders of magnitude at high volume. Implementing one without answers to questions 1 to 4 would replace a known simplification with an unknown one.
2. **A no-price-change warning is safe to add now, if you approve it:** when more than one mold is assumed, say so ("tooling assumes N molds, each a full replacement; the mold cost does not depend on the SPI class or the tool material"), and carry it in the quote validation as an ASSUMED step (F-17 already says it). This changes no figure.
3. When 1 to 4 are answered, implement the chosen reading as formula F-17 version 2 behind the registry (version bump, golden tests, before and after prices), not as a silent change.
4. If question 6 shows the product never quotes above about 250,000 lifetime shots, close D-9 as "within scope".
