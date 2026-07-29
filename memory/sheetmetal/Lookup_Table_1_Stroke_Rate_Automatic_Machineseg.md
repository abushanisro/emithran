# Lookup Table 1 – Stroke Rate Factor (Automatic Machines)

## Purpose
This lookup table provides the **stroke rate utilization factor** for **automatic stamping machines** based on the machine tonnage and part complexity.

### Notes
1. Applicable only for **automated setups**.
2. The factor from this table is multiplied by the **actual machine stroke rate**.

## Stroke Rate Factor

| Tonnage (T) | Simple | Intermediate | Complex |
|------------:|-------:|-------------:|--------:|
| 10 | 80% | 64% | 56% |
| 20 | 79% | 63% | 55% |
| 30 | 78% | 62% | 55% |
| 50 | 77% | 62% | 54% |
| 80 | 76% | 61% | 53% |
| 100 | 75% | 60% | 53% |
| 150 | 74% | 59% | 52% |
| 200 | 73% | 58% | 51% |
| 250 | 72% | 58% | 50% |
| 300 | 71% | 57% | 50% |
| 350 | 70% | 56% | 49% |
| 400 | 69% | 55% | 48% |
| 500 | 68% | 54% | 48% |
| 800 | 67% | 54% | 47% |
| 1000 | 66% | 53% | 46% |
| 1500 | 65% | 52% | 46% |
| 2000 | 64% | 51% | 45% |

## Usage

```text
Effective Stroke Rate =
Actual Machine Stroke Rate × Lookup Factor
```

Where the lookup factor is selected based on:
- Machine tonnage
- Part complexity (Simple / Intermediate / Complex)
