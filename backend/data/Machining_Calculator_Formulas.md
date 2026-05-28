# Machining Calculator – All Formulas Reference

---

## Common Cost Formulas (Repeated Across Most Process Sheets)

These formulas appear in nearly every process calculator (Facing, Drilling, Turning, etc.):

| Output | Formula | Explanation |
|--------|---------|-------------|
| Tool cost/part | `Tool Cost ÷ Tool Life` | Cost per part based on tool wear |
| Time per use (s) | `ROUNDUP(Machining Time in seconds, 0)` | Rounded-up cycle time |
| Total time (s) | `No. of Uses × Time per use` | Total time including all passes/uses |
| Machine Cost (INR) | `MHR/hour ÷ (3600 ÷ Total time)` | Machine hourly rate × time fraction |
| Labour Cost (INR) | `LHR/hour ÷ (3600 × OLE ÷ Total time)` | Labour rate adjusted by OLE % |
| Process Cost (INR) | `Machine Cost + Labour Cost` | Combined direct cost |
| Setup Cost (INR) | `Setup % × Process Cost` | Overhead for setup time |
| Total Process Cost (INR) | `Setup Cost + Process Cost + Tool cost/part` | Full cost per part |

---

## 1. RM Composition Analysis

| Output | Formula | Explanation |
|--------|---------|-------------|
| Part MOQ (ton) | `Part Weight (kg) × Part Volume ÷ 1000` | Minimum order quantity in tons |
| Time/part (s) | `60 ÷ (Part MOQ × 1000 ÷ Part Weight)` | Time per part derived from batch time |
| Machine Cost | `MHR ÷ (3600 ÷ Time/part)` | |
| Labour Cost | `LHR ÷ (3600 × OLE ÷ Time/part)` | |
| Process Cost | `Machine Cost + Labour Cost + Tool cost/part` | |
| Setup Cost | `Process Cost × Setup %` | |
| Total Process Cost | `Setup Cost + Process Cost` | |

---

## 2. Material Calc – Rod

| Output | Formula | Explanation |
|--------|---------|-------------|
| Part Volume (mm³) | `π/4 × (OD² − ID²) × 17.25` | Hollow cylinder cross-section × length |
| Part Weight (kg) | `Density × Part Volume` | |
| Parts possible from stock | `(Rod Length − Min Leftover) ÷ (Part Length + Cutoff Allowance)` | How many parts fit in one rod |
| Yield (%) | `(Part Volume × No. of Parts) ÷ (π/4 × (OD²−ID²) × Rod Length)` | Material utilisation ratio |
| Gross Weight (kg) | `Part Weight ÷ Yield` | Raw weight consumed per part |
| Scrap Weight (kg) | `Gross Weight − Part Weight` | Material lost to machining |
| Part RM Cost (INR) | `Gross Weight × RM Cost/kg` | |
| Part Scrap Cost (INR) | `Scrap Cost/kg × Scrap Recovery % × Scrap Weight` | Credit recovered from scrap |
| Material Cost (INR) | `Part RM Cost − Part Scrap Cost` | Net raw material cost |

---

## 3. Material Calc – Tube

*Identical formulas to Material Calc – Rod (same cross-section model for hollow tubes).*

---

## 4. Material Calc – Sheets

| Output | Formula | Explanation |
|--------|---------|-------------|
| Raw Part Weight (kg) | `(Finished Part Volume × Density) ÷ 1,000,000,000` | Convert mm³ to kg |
| Sheet Volume (mm³) | `Sheet Length × Sheet Width × Sheet Thickness` | |
| RM Volume (mm³) | `(Proj. Length + Allowance) × (Allowance + Proj. Width) × Thickness` | Blank size with margin |
| Parts possible in blank | `Sheet Volume ÷ RM Volume` | Nesting efficiency |
| Yield (%) | `(Finished Part Volume ÷ RM Volume) × 100` | |
| Gross Weight (kg) | `(Raw Part Weight ÷ Yield) × 100` | |
| Scrap Weight (kg) | `Gross Weight − Raw Part Weight` | |
| Part RM Cost (INR) | `Gross Weight × RM Cost/kg` | |
| Part Scrap Cost (INR) | `Scrap Weight × Scrap Cost/kg × Scrap Recovery %` | |
| Material Cost (INR) | `Part RM Cost − Part Scrap Cost` | |

---

## 5. Material Calc – Blocks

*Identical formulas to Material Calc – Sheets (Block Volume replaces Sheet Volume).*

---

## 6. Facing

| Output | Formula | Explanation |
|--------|---------|-------------|
| Spindle RPM | `(1000 × Cutting Speed) ÷ (π × Workpiece Diameter)` | Standard RPM formula |
| No. of Passes | `Total Depth of Cut ÷ Depth per Cut` | |
| Machining Time (min) | `(π × Diameter × (Length of Cut + 10)) ÷ (1000 × Cutting Speed × Feed/rev) × No. of Passes` | |
| Machining Time (s) | `Machining Time (min) × 60` | |
| *(+ common cost formulas above)* | | |

---

## 7. Turning

| Output | Formula | Explanation |
|--------|---------|-------------|
| Spindle RPM | `(1000 × Cutting Speed) ÷ (π × Workpiece Diameter)` | |
| No. of Passes | `(Initial Dia − Final Dia) ÷ (2 × Depth of Cut)` | Passes needed to reach final diameter |
| Machining Time (min) | `(π × Dia × (Length + 10)) ÷ (1000 × Cutting Speed × Feed/rev) × No. of Passes` | |

---

## 8. Step Drilling

| Output | Formula | Explanation |
|--------|---------|-------------|
| Spindle RPM | `(1000 × Cutting Speed) ÷ (π × Hole Diameter)` | |
| Machining Time (min) | `(π × Dia × (Depth + 10)) ÷ (1000 × Cutting Speed × Feed/rev)` | |
| Machining Time (s) | `Machining Time (min) × 60` | |
| *(+ common cost formulas above)* | | |

---

## 9. Drilling

*Identical formulas to Step Drilling.*

| Output | Formula |
|--------|---------|
| Spindle RPM | `(1000 × Cutting Speed) ÷ (π × Hole Diameter)` |
| Machining Time (min) | `(π × Dia × (Depth + 10)) ÷ (1000 × Cutting Speed × Feed/rev)` |
| Machining Time (s) | `Machining Time (min) × 60` |

---

## 10. Reaming

| Output | Formula | Explanation |
|--------|---------|-------------|
| Spindle RPM | `(1000 × Cutting Speed) ÷ (π × Diameter)` | |
| Drill Bit Constant (C) | `(Diameter ÷ 2) × 0.577` | Tip allowance for drill point geometry |
| Machining Time (min) | `(π × Dia × (Length + 4 + C)) ÷ (1000 × Cutting Speed × Feed/rev)` | Includes drill tip approach |

---

## 11. Knurling

| Output | Formula | Explanation |
|--------|---------|-------------|
| Feed/rev (mm/rev) | `25.4 ÷ TPI` | Convert TPI (threads per inch) to mm pitch |
| Spindle RPM | `(1000 × Cutting Speed) ÷ (π × Knurling Diameter)` | |
| Machining Time (min) | `(π × Dia × (Length + 4)) ÷ (1000 × Cutting Speed × Feed/rev) × No. of Passes` | |
| Machining Time (s) | `Machining Time (min) × 60` | |
| *(+ common cost formulas above)* | | |

---

## 12. Threading

| Output | Formula | Explanation |
|--------|---------|-------------|
| Feed/rev (mm/rev) | `= Pitch` | Thread pitch IS the feed per revolution |
| Spindle RPM | `(1000 × Cutting Speed) ÷ (π × Threading Diameter)` | |
| Machining Time (min) | `(π × Dia × (Length + 4)) ÷ (1000 × Cutting Speed × Pitch) × No. of Passes` | |
| Machining Time (s) | `Machining Time (min) × 60` | |
| *(+ common cost formulas above)* | | |

---

## 13. Cutoff

| Output | Formula | Explanation |
|--------|---------|-------------|
| Spindle RPM | `(1000 × Cutting Speed) ÷ (π × Workpiece Diameter)` | |
| Machining Time (min) | `(π × Dia × (Length of Travel + 10)) ÷ (1000 × Cutting Speed × Feed/tooth)` | |
| Machining Time (s) | `Machining Time (min) × 60` | |
| *(+ common cost formulas above)* | | |

---

## 14. Face Milling

| Output | Formula | Explanation |
|--------|---------|-------------|
| Spindle RPM | `(1000 × Cutting Speed) ÷ (π × Cutter Diameter)` | |
| No. of Passes | `(Width − Cutter Dia ÷ 2) ÷ (Cutter Dia − 2)` | Lateral passes to cover full width |
| Machining Time (min) | `((Length + 10 + Cutter Dia/2) ÷ (Feed/tooth × No. Teeth × RPM)) × No. of Passes × (Total Depth ÷ Depth/pass)` | |

---

## 15. End Milling and Sawing

| Output | Formula | Explanation |
|--------|---------|-------------|
| Spindle RPM | `(1000 × Cutting Speed) ÷ (π × Cutter Diameter)` | |
| No. of Passes | `(Width − Cutter Dia ÷ 2) ÷ (Cutter Dia − 2)` | |
| Machining Time (min) | `((Length + 10 + Cutter Dia/2) ÷ (Feed/rev × No. Teeth × RPM)) × No. of Passes × (Total Depth ÷ Depth/pass)` | Includes depth passes |

---

## 16. Plunge Milling

| Output | Formula | Explanation |
|--------|---------|-------------|
| Length of Cut (mm) | `3.7 × π × 10` | Fixed geometry constant (≈ 116.25 mm) |
| Spindle RPM | `(1000 × Cutting Speed) ÷ (π × Cutter Diameter)` | |
| No. of Depth Passes | `ROUNDUP(Total Depth ÷ Depth/pass, 0)` | |
| Machining Time (min) | `((Length + 10 + Cutter Dia) ÷ (Feed/tooth × No. Teeth × RPM)) × No. of Depth Passes × ROUNDUP(Width ÷ Cutter Dia, 0)` | Also accounts for lateral coverage |
| Machining Time (s) | `Machining Time (min) × 60` | |
| *(+ common cost formulas above)* | | |

---

## 17. Slot Milling

*Identical formula structure to Plunge Milling.*

| Output | Formula |
|--------|---------|
| Spindle RPM | `(1000 × Cutting Speed) ÷ (π × Cutter Diameter)` |
| No. of Passes | `ROUNDUP(Total Depth ÷ Depth/pass, 0)` |
| Machining Time (min) | `((Length + 10 + Cutter Dia) ÷ (Feed/tooth × No. Teeth × RPM)) × No. of Passes × ROUNDUP(Width ÷ Cutter Dia, 0)` |
| Machining Time (s) | `× 60` |

---

## 18. Tapping

| Output | Formula | Explanation |
|--------|---------|-------------|
| Spindle RPM | `(1000 × Cutting Speed) ÷ (π × Tap Diameter)` | |
| Machining Time (min) | `(π × Dia × (Length + 4)) ÷ (1000 × Cutting Speed × Feed/rev)` | +4 mm approach allowance |

---

## 19. Boring

*Same formulas as Tapping.*

| Output | Formula |
|--------|---------|
| Spindle RPM | `(1000 × Cutting Speed) ÷ (π × Diameter)` |
| Machining Time (min) | `(π × Dia × (Length + 4)) ÷ (1000 × Cutting Speed × Feed/rev)` |

---

## 20. Internal Boring

| Output | Formula | Explanation |
|--------|---------|-------------|
| Spindle RPM | `(1000 × Cutting Speed) ÷ (π × Initial Diameter)` | Based on starting bore size |
| No. of Passes | `ROUNDUP((Final Dia − Initial Dia) ÷ (2 × Depth of Cut), 0)` | Passes to open bore to final size |
| Machining Time (min) | `(π × Initial Dia × (Length + 4)) ÷ (1000 × Cutting Speed × Feed/rev) × No. of Passes` | |
| Machining Time (s) | `Machining Time (min) × 60` | |
| *(+ common cost formulas above)* | | |

---

## 21. Inspection

| Output | Formula | Explanation |
|--------|---------|-------------|
| Time/part (s) | `Batch Time ÷ Batch Size` | Average inspection time per part |
| Machine Cost | `MHR ÷ (3600 ÷ Time/part)` | (Note: MHR cell is blank — no machine cost) |
| Labour Cost | `LHR ÷ (3600 × OLE ÷ Time/part)` | Inspector's time cost |
| Process Cost | `Machine Cost + Labour Cost + Tool cost/part` | |
| Setup Cost | `Process Cost × Setup %` | |
| Total Process Cost | `Setup Cost + Process Cost` | |

---

## 22. Laser Cutting

| Output | Formula | Explanation |
|--------|---------|-------------|
| Machining Time (min) | `Length of Cut ÷ Feed Rate` | Simple time = distance ÷ speed |

---

## 23. Plasma Cutting

| Output | Formula | Explanation |
|--------|---------|-------------|
| Machining Time (min) | `Length of Cut ÷ Feed Rate` | Same as Laser Cutting |

---

## Summary of Core Machining Physics Formulas Used

| Formula | Expression |
|--------|-----------|
| **Spindle RPM** | `n = (1000 × Vc) ÷ (π × D)` |
| **Machining Time (Turning/Drilling)** | `Tc = (π × D × (L + approach)) ÷ (1000 × Vc × f) × passes` |
| **Machining Time (Milling)** | `Tc = ((L + approach + D/2) ÷ (fz × z × n)) × passes` |
| **No. of Turning Passes** | `np = (D1 − D2) ÷ (2 × t)` |
| **Drill Tip Constant** | `C = (D ÷ 2) × 0.577` |
| **Feed from TPI (Knurling)** | `f = 25.4 ÷ TPI` |
| **Machine Cost** | `MHR ÷ (3600 ÷ cycle time)` |
| **Labour Cost** | `LHR ÷ (3600 × OLE ÷ cycle time)` |
| **Total Cost** | `(Machine + Labour + Tool/part) × (1 + Setup %)` |
