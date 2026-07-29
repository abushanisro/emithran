# Lookup Table 2 – Material Handling Time Assumptions

## Purpose
This lookup table defines the standard **material handling time** based on the weight of the material, sheet, coil, or workpiece. These values are used to estimate loading and unloading time during manufacturing operations.

## Lookup Table

| # | Weight (kg) | Handling Time (min) |
|--:|------------:|--------------------:|
| 1 | 2.5 | 0.08 |
| 2 | 10 | 0.17 |
| 3 | 20 | 0.25 |
| 4 | 30 | 0.33 |
| 5 | 40 | 0.58 |
| 6 | 65 | 0.75 |
| 7 | 95 | 0.83 |
| 8 | 130 | 0.92 |
| 9 | 165 | 1.00 |
| 10 | 200 | 1.08 |
| 11 | 250 | 1.25 |
| 12 | 300 | 1.33 |
| 13 | 350 | 1.42 |
| 14 | 400 | 1.58 |
| 15 | 450 | 1.75 |
| 16 | 500 | 2.63 |
| 17 | 750 | 3.15 |
| 18 | 1000 | 20.00 |
| 19 | 2000 | 20.00 |
| 20 | 3000 | 20.00 |
| 21 | 4000 | 25.00 |
| 22 | 5000 | 25.00 |

## Usage

Select the handling time based on the material weight.

```text
Handling Time = Lookup(Weight)
```

### Applications
- Sheet loading
- Coil loading
- Material unloading
- Press brake loading
- Laser cutting sheet handling
- General material handling estimation
