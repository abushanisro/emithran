# Lookup Table 3 – Tool Setup Time

## Purpose

This lookup defines the standard **tool loading/setup time** for:
- **Lookup Table 3A:** Press Machines
- **Lookup Table 3B:** Press Brake Machines

These values are used during setup cost calculations.

---

# Lookup Table 3A – Press Machine Tool Loading Time

| Tonnage (T) | Tool Loading Time (min) |
|------------:|------------------------:|
| 10 | 30 |
| 20 | 30 |
| 30 | 30 |
| 50 | 30 |
| 80 | 30 |
| 100 | 45 |
| 150 | 45 |
| 200 | 45 |
| 250 | 45 |
| 300 | 45 |
| 350 | 45 |
| 400 | 45 |
| 500 | 45 |
| 800 | 45 |
| 1000 | 60 |
| 1500 | 60 |
| 2000 | 60 |
| 2500 | 60 |
| 3000 | 60 |
| 3500 | 60 |
| 4000 | 60 |

### Usage

```text
Tool Loading Time = Lookup(Tonnage)
```

---

# Lookup Table 3B – Press Brake Tool Loading Time

| Tool Length (mm) | Tool Loading Time (min) |
|-----------------:|------------------------:|
| 100 | 10 |
| 200 | 10 |
| 300 | 15 |
| 400 | 15 |
| 500 | 15 |

### Usage

```text
Tool Loading Time = Lookup(Tool Length)
```

---

## Applications

- Setup Time Calculation
- Setup Cost Estimation
- Press Machine Costing
- Press Brake Costing
- Manufacturing Process Planning
