# Laser Cut & Bending Costing Parameters

## 1. Laser Cut Parameters (Sample Part)

| Parameter | Spec |
|---|---|
| Material | X5CrNi1810 |
| Batch Size | 250 |
| Perimeter (total cut length), mm | 108 |
| No. of Piercing, Nos | 1 |
| Laser Power, Kw | 2 |
| Cutting Speed, mm/min | 3000 |
| Handling time / Batch (Loading), Sec | 60 |
| Re-positioning time, s/movement | 2 |
| Piercing time / Piercing, Sec | 2 |
| No. of re-position | 1 |

**Cycle Time Calculation (min)**

| Step | Value (min) |
|---|---|
| Cutting time | 0.04 |
| Total Piercing Time | 0.03 |
| Re-positioning time | 0.03 |
| Handling time | 0.00 |
| Unloading | 0.50 |
| **Total Cycle Time** | **0.61 min** |
| **Total Cycle Time (Sec)** | **36.39 sec** |

## 2. Bending Parameters (Sample Part)

| Description | Value |
|---|---|
| Material Factor | 1.7 |
| Sheet Thickness, mm | 2 |
| Max Bending Length, mm | 32 |
| Die Opening, mm | 16 |
| Required Tonnage, Ton | 1 |
| No. of Bend | 1 |
| CT per Bend, min | 15 |
| **Total CT** | **15 min** |

### Tonnage Formula
```
Tonnage, Tons = (L x t^2 x TS) / (V x 1000)

L  = Length of Bend (mm)
t  = Sheet thickness (mm)
TS = Tensile strength (MPa)
V  = Die opening (typically 6-8x sheet thickness for thin metal,
     10-12x for thicker material)
```

## 3. Material Factor Table

| S.No | Material | Material Factor |
|---|---|---|
| 1 | Carbon Steel | 1.0 |
| 2 | Aluminium | 0.6 |
| 3 | Stainless Steel | 1.7 |

## 4. Bend Complexity Table

| Range | Bend Length | Part Weight Range | Cycle Time | No. of Labour Required | Batch Setup Time (hr) |
|---|---|---|---|---|---|
| Simple | 0–300 mm | 0–3 kg | 15 | 1 | 0.5 |
| Medium | 300–500 mm | 3–5 kg | 20 | 1 | 0.75 |
| Complex | >500 mm | >5 kg | 30 | 2 | 1.0 |

## 5. Laser Cutting Thickness & Speed Chart (mm/min)

Grade legend: **CS** = Carbon Steel (Q235A), **SS** = Stainless Steel (201), **Alu** = Aluminium, **Bra** = Brass

### Carbon Steel (Q235A)

| Thick (mm) | 500W | 1000W | 1500W | 2000W | 3000W | 4000W | 6000W | 8000W | 10000W | 12000W |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 7.0–9.0 | 8.0–10 | 15–26 | 24–30 | 30–40 | 33–42 | 35–42 | 35–42 | 35–42 | 35–42 |
| 2 | 3.0–4.5 | 4.0–6.5 | 4.5–7.0 | 4.7–6.0 | 4.8–7.5 | 5.2–8.0 | 6.0–8.0 | 6.2–10 | 7.0–12 | 4.5–8.0 |
| 3 | 1.8–3.0 | 2.4–3.0 | 2.6–4.0 | 3.0–4.8 | 3.3–5.0 | 3.1–4.8 | 3.8–6.5 | 4.0–7.0 | 4.2–7.5 | 3.5–5.5 |
| 4 | 1.3–1.5 | 2.0–2.4 | 2.5–3.0 | 2.8–3.5 | 3.0–4.2 | 3.1–4.8 | 3.5–5.0 | 3.5–5.5 | 3.5–5.5 | 3.5–5.5 |
| 5 | 0.9–1.1 | 1.5–2.0 | 2.0–2.5 | 2.2–3.0 | 2.6–3.5 | 2.7–3.6 | 3.3–4.2 | 3.3–4.5 | 3.3–4.5 | 3.4–4.8 |
| 6 | 0.6–0.9 | 1.4–1.6 | 1.6–2.2 | 1.8–2.6 | 2.3–3.2 | 2.5–3.4 | 2.8–4.0 | 3.0–4.2 | 3.0–4.2 | 3.0–4.2 |
| 8 | | 0.8–1.2 | 1.0–1.4 | 1.2–1.8 | 1.8–2.6 | 2.0–3.0 | 2.2–3.2 | 2.2–3.5 | 2.5–3.5 | 2.5–3.5 |
| 10 | | 0.6–1.0 | 0.8–1.1 | 1.1–1.3 | 1.2–2.0 | 1.5–2.0 | 1.8–2.5 | 2.2–2.7 | 2.2–2.7 | 2.5–3.5 |
| 12 | | 0.5–0.7 | 0.7–1.0 | 0.9–1.2 | 1.0–1.6 | 1.0–1.6 | 1.2–1.8 | 1.2–2.0 | 1.2–2.1 | 1.2–2.1 |
| 14 | | | 0.5–0.7 | 0.7–0.8 | 0.7–1.0 | 0.9–1.2 | 0.9–1.2 | 1.7–1.9 | 1.7–1.9 | 1.7–1.9 |
| 16 | | | | 0.6–0.7 | 0.7–1.0 | 0.8–1.0 | 0.8–1.5 | 0.9–1.7 | 0.9–1.7 | 0.9–1.7 |
| 18 | | | | 0.4–0.6 | 0.6–0.8 | 0.6–0.8 | 0.65–0.9 | 0.65–0.9 | 0.65–0.9 | 0.65–0.9 |
| 20 | | | | | | 0.5–0.8 | 0.6–0.9 | 0.6–0.9 | 0.6–0.9 | 0.6–0.9 |
| 22 | | | | | | 0.4–0.6 | 0.5–0.8 | 0.5–0.8 | 0.5–0.8 | 0.5–0.8 |
| 25 | | | | | | | 0.3–0.5 | 0.3–0.5 | 0.3–0.7 | 0.3–0.7 |

### Stainless Steel (201)

| Thick (mm) | 500W | 1000W | 1500W | 2000W | 3000W | 4000W | 6000W | 8000W | 10000W | 12000W |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 8.0–13 | 18–25 | 20–27 | 24–30 | 30–35 | 32–40 | 45–55 | 50–66 | 60–75 | 70–85 |
| 2 | 2.4–5.0 | 7.0–12 | 8.0–13 | 9.0–14 | 13–21 | 16–28 | 20–35 | 30–42 | 40–55 | 50–66 |
| 3 | 0.6–0.8 | 1.8–2.5 | 3.0–5.0 | 4.0–6.5 | 6.0–10 | 7.0–15 | 15–24 | 20–30 | 27–38 | 33–45 |
| 4 | | 0.6–0.7 | 1.2–1.3 | 1.5–2.4 | 3.0–4.5 | 4.6–6.0 | 5.0–8.0 | 10–16 | 14–21 | 18–25 |
| 5 | | | 0.7–1.3 | 1.8–2.5 | 3.0–5.0 | 4.0–5.5 | 8.0–12 | 12–17 | 15–22 | 18–25 |
| 6 | | | 1.2–2.0 | 2.0–4.0 | 2.5–4.5 | 6.0–9.0 | 8.0–14.0 | 12–15 | 12–15 | 18–25 |
| 8 | | | | 0.7–1.0 | 1.5–2.0 | 1.6–3.0 | 4.0–5.0 | 6.0–8.0 | 8.0–12.0 | 10–16 |
| 10 | | | | | 0.6–0.8 | 0.8–1.2 | 1.2–1.8 | 1.8–2.5 | 3.5–5.0 | 8.0–12 |
| 12 | | | | | 0.5–0.8 | 0.5–0.8 | 1.2–1.8 | 1.2–2.0 | 1.8–3.0 | 3.0–5.0 |
| 14 | | | | | | 0.4–0.6 | 0.6–0.7 | 1.2–1.8 | 1.2–1.8 | 1.8–3.0 |
| 20 | | | | | | | 0.4–0.6 | 0.5–0.6 | 0.5–0.8 | 0.6–0.7 |
| 25 | | | | | | | | 0.5–0.6 | 0.5–0.6 | 0.6–0.7 |
| 30 | | | | | | | | 0.4–0.5 | 0.5–0.6 | 0.6–0.7 |
| 40 | | | | | | | | | 0.4–0.5 | 0.5–0.6 |

### Aluminium

| Thick (mm) | 500W | 1000W | 1500W | 2000W | 3000W | 4000W | 6000W | 8000W | 10000W | 12000W |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 4.0–5.5 | 6.0–10 | 10–20 | 15–25 | 25–38 | 35–40 | 45–55 | 50–65 | 60–75 | 70–85 |
| 2 | 0.7–1.5 | 2.8–3.6 | 5.0–7.0 | 10–18 | 13–25 | 15–25 | 20–30 | 25–38 | 33–45 | 38–50 |
| 3 | | 0.7–1.5 | 2.0–4.0 | 4.0–6.0 | 6.5–8.0 | 7.0–13 | 10–12 | 18–20 | 21–30 | 25–38 |
| 4 | | | 1.0–1.5 | 2.0–3.0 | 3.5–5.0 | 4.0–5.5 | 5.0–9.0 | 9.0–12 | 12–13 | 15–18 |
| 5 | | | 0.7–1.0 | 1.2–1.8 | 1.5–2.5 | 2.0–3.5 | 4.5–8.0 | 8.0–14.0 | 12–15 | 15–21 |
| 6 | | | | 0.6–0.8 | 0.9–1.6 | 0.9–1.6 | 2.0–4.0 | 4.0–6.0 | 4.5–9.0 | 9.0–12 |
| 8 | | | | | 0.7–1.0 | 0.9–1.6 | 1.2–2.0 | 2.3–3.0 | 4.0–6.0 | 4.5–8.0 |
| 10 | | | | | 0.4–0.7 | 0.6–1.5 | 0.8–1.4 | 1.5–2.0 | 2.3–3.0 | 4.0–6.0 |
| 12 | | | | | | 0.4–0.6 | 0.6–0.8 | 1.1–1.4 | 1.5–2.0 | 2.2–4.0 |
| 20 | | | | | | | 0.5–0.7 | 0.7–1.0 | 1.0–1.6 | 1.5–2.0 |
| 25 | | | | | | | | 0.5–0.7 | 0.7–1.0 | 1.0–1.6 |
| 35 | | | | | | | | | 0.5–0.7 | 0.7–1.0 |

### Brass

| Thick (mm) | 3000W | 4000W | 6000W | 8000W | 10000W | 12000W |
|---|---|---|---|---|---|---|
| 5 | 4.5–6.0 | 7.0–9.0 | 9.0–15 | 15–24 | | |
| 6 | 3.0–4.5 | 4.5–6.5 | 7.0–9.0 | 9.0–15 | | |
| 8 | 0.5–0.7 | 1.0–1.8 | 1.4–2.0 | 3.0–4.5 | 4.5–6.5 | 7.0–9.0 |
| 10 | | 0.5–0.7 | 0.7–1.0 | 1.6–2.2 | 2.4–4.0 | 4.5–6.5 |
| 12 | | | 0.2–0.4 | 0.8–1.2 | 1.5–2.2 | 2.4–4.0 |
| 14 | | | | 0.2–0.4 | 0.8–1.5 | 1.5–2.2 |

## 6. Sheet Nesting / Yield Calcs

### 6a. Generic Nesting Standard (applies to any sheet + any part)

Inputs needed: Sheet Width (mm), Sheet Length (mm), Sheet Thickness (mm), Part Width (mm), Part Length (mm), Material Density (kg/m³), Edge Margin (mm, default 0), Kerf/Gap between parts (mm, default 0).

**Simple yield (no margin/kerf — matches the sample sheet's method):**
```
Parts across Width  = FLOOR(Sheet Width  / Part Width)
Parts across Length = FLOOR(Sheet Length / Part Length)
Parts per Sheet (Orientation A) = Parts across Width x Parts across Length

# Orientation B = part rotated 90°
Parts across Width  (B) = FLOOR(Sheet Width  / Part Length)
Parts across Length (B) = FLOOR(Sheet Length / Part Width)
Parts per Sheet (Orientation B) = Parts across Width(B) x Parts across Length(B)

Best Yield per Sheet = MAX(Orientation A, Orientation B)
```

**Kerf/margin-adjusted yield (recommended for real cut plans):**
```
Usable Width  = Sheet Width  - 2 x Edge Margin
Usable Length = Sheet Length - 2 x Edge Margin

Parts across Width  = FLOOR((Usable Width  + Kerf) / (Part Width  + Kerf))
Parts across Length = FLOOR((Usable Length + Kerf) / (Part Length + Kerf))
Parts per Sheet = Parts across Width x Parts across Length
(repeat with Part W/L swapped for the rotated orientation, take the max)
```

**Weight & cost formulas:**
```
Sheet Area (m²)      = (Sheet Width/1000) x (Sheet Length/1000)
Sheet Weight (kg)    = Sheet Area (m²) x Thickness (mm) x Density (kg/m³) / 1000
Input Wt / Part (kg) = Sheet Weight / Parts per Sheet
Best Input Weight    = MIN(Input Wt/Part) across all candidate sheet sizes
                        -> pick the sheet size that gives the lowest input wt/part
Finished Weight (kg) = net part weight (from CAD volume x density), i.e. weight
                        after cutting/forming, before any coating
Scrap %              = (Input Wt/Part - Finished Weight) / Input Wt/Part x 100
Material Utilization %= (Parts per Sheet x Part Area) / Sheet Area x 100
```

Common densities for reference (kg/m³): Carbon Steel ≈ 7850, Stainless Steel ≈ 7900–8000, Aluminium ≈ 2700, Brass ≈ 8500, Titanium ≈ 4500.

### 6b. Sample Part (worked example)

**Sample part:** 25.6 x 25.6 mm, Grade 1.0242 pre-coated white, Thickness 0.5 mm

| Sheet Size | Parts/Sheet (Orientation A) | Parts/Sheet (Orientation B) | Sheet Wt (kg) | Input Wt/Part (kg) |
|---|---|---|---|---|
| 1219 x 2438 mm (4x8 ft) | 4465 (47x95) | 4465 (95x47) | 3.27 | 3.27/4465 = 0.000732 |
| 1524 x 3048 mm (5x10 ft) | 7021 (59x119) | 7021 (119x59) | 5.11 | 5.11/7021 = 0.000728 |
| 1219 x 3048 mm (4x10 ft) | 5593 (47x119) | 5593 (119x47) | 4.09 | 4.09/5593 = 0.000731 |

- Best Input Weight = MIN of the Input Wt/Part column above → **5 x 10 ft sheet wins** (0.000728 kg/part), i.e. lowest scrap per part of the three stock sizes.
- Finished Weight: not provided in the source sheet (needs the part's net CAD weight to compute scrap %).
- Sheet Area (1219x2438): 1219mm x 2438mm = 2,971,922 mm² = 2.971922 m² (the "1,166,599 mm²" figure in the source is the part-nest working area on a different tab, not the full sheet area).
- Note: the source workbook's "Yield" formula is the **simple (no-margin/no-kerf)** version above — floor division of sheet dimension by part dimension. If actual laser cutting requires edge clearance or kerf spacing, use the kerf-adjusted formula in 6a instead, which will always yield ≤ the simple count.

## 7. Chemical Conversion Coating Cost (per m²)

| Country | Cost/m² | Area (m²) | Cost per Unit |
|---|---|---|---|
| USA | $25.04 | 0.11 | $2.76 |
| Germany | $21.70 | 0.11 | $2.39 |
| China | $16.70 | 0.11 | $1.84 |

## 8. Units of Measure Reference

| Category | UOM |
|---|---|
| Grade | (text) |
| Count | Nos |
| Dimension | mm |
| Power | Kw |
| Speed | mm/min |
| Time (short) | Sec |
| Time (per movement) | s / movement |
| Time (long) | min |
| Weight/Tonnage | Ton |
