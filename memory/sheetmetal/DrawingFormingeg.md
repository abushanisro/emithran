# Manufacturing Costing Template Specification
> Reformatted from the original worksheet while preserving all available content.
        Changed
        Addition
        To be removed

## Part Information :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| Internal Part Number : | Populated from template upload | / | User Input |

## Part Description :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| Populated from template upload | / | User Input |  |

## Annual Volume (#) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  1,20,000  | Populated from template upload | / | User Input |

## Commodity :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| Sheet Metal | Populated from template upload | / | User Input |

## Process Name :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| Stamping - Progressive | System suggestion / User Input |  |  |

## Current Supplier Name :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| Populated from template upload or User selected from drop down |  |  |  |

## Current Manufacturing Country :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| USA | Populated from template upload or User selected from drop down |  |  |

## Delivery Country :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| USA | Populated from template upload or User selected from drop down |  |  |
        BOM Qty (No's)	1		Populated from template upload  /  User Input

## Part Complexity :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| Medium | System suggestion / User selected from drop down |  |  |

## Lot size (#) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  10,000  | Populated from template upload or default to annual volume/12 |  |  |

## Supply Chain Model :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| Buy | Default is buy |  |  |

## Packaging Type :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| No Packing | Select dropdown |  |  |

## HS Code :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| N/A | Populated from template upload | / | User Input |

## Inco Terms :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| EX-W | Default option1: Supplier master; Option 2: Client master |  |  |

## Payment Terms :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 60 Days | Default option1: Supplier master; Option 2: Client master |  |  |

## Material Information :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| Category : | Ferrous | To be captured from part drawing / | User Input |

## Family :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| HDG Steel | To be captured from part drawing / | User Input |  |

## Description/Grade :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 2mm*500mm SGCC | To be captured from part drawing / | User Input |  |

## Density (g/cc) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 7.85 | Lookup material table |  |  |

## Material price ($/Kg) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 1.5 | Lookup material table |  |  |

## Scrap price ($/Kg) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 0.4 | Lookup material table |  |  |

## Unfolded Length (mm) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 250 | To be captured from part drawing / | User Input |  |

## Unfolded Width (mm) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 250 | To be captured from part drawing / | User Input |  |

## Thickness (mm) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 3 | To be captured from part drawing / | User Input |  |

## Net weight (g) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 1471.9 | To be captured from part drawing / | User Input |  |

## Area (mm^2) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  62,500  | To be captured from part drawing / | User Input |  |

## Volume (mm^3) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  1,87,500  | Calculated: Part area * Sheet thickness |  |  |
        Part allowance	 0.18 		Calculated:	Constant * Sheet thickness * ((Shear strength / 10) ^ (1/2)) +  (10 mm to be added if more than 1 impression)

## No. of Impressions :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  1  | Calculated: | (Coil width - Start & end scrap length) / ( Part length + part allowance) |  |
        Coil/Sheet Width (mm)  :	300		System Suggestion / User can change
        Coil/Sheet Length (mm)	300		System Suggestion / User can change
        Start & End Scrap Length (mm)	5		Default value
        Parts per Coil	 1 		Calculated:	(Coil width - Edge allowance)  x (Coil length - Edge allowance) / (Part length + Part allowance) x (Part width = Part allowance)
        Coil/Sheet WeiKght (g)	 2,119.5000 		Calculated:	(Coil length x Coil Width x Sheet Thickness x Density) / 1000

## Scrap weight per part(g) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  52.4601  | Calculated: | Gross part weight - Net part weight |  |

## Net weight per part (g) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  1,471.9000  | To be captured from part drawing / | User Input |  |

## Gross weight per part (g) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  1,524.3601  | Calculated: | Sheet weight / Parts per sheet |  |
        Utilisation %	96.56%		Calculated:	Net part weight / gross part weight
        Scrap Recovery %	90.00%		Default / User can change

## Gross Material cost ($) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  2.2865  | Calculated: | (Gross weight / 1000) * Material Price |  |

## Scrap Rec Cost ($) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  0.0189  | Calculated: | (Scrap weight / 1000)* Scrap recovery % * Material Price |  |

## Net Material cost ($) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  2.2677  | Calculated: | Gross material cost - Scrap Rec Cost |  |

## Manufacturing 1 :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| Process Type : | Stamping | Select dropdown |  |
        Form Length: (mm)	250		To be captured from part drawing /  User Input	L	Calculated based on part draw feature
        Form Perimeter: (mm)	785		To be captured from part drawing /  User Input	Fp	Calculated based on part draw feature
        Form Height: (mm)	180		To be captured from part drawing /  User Input	h	Calculated based on part draw feature
        Punch Perimeter : (mm)	745.75		To be captured from part drawing /  User Input	Dp	Calculated based on part draw feature, 95% of form perimeter
        (h/L) Factor	0.72		Calculated:	(h/L)	DR = h/L
        Yield Strength Of Material : (Mpa)	370		Lookup from material database	Y	Can be captured from Material database
        Drawing Force : (Ton)	29.76		Calculated	Fd	Fd = Dp * T * Y * (Fp/Dp-0.7)
        Blank Holding Force : (Ton)	9.92		To be removed	Fb	Fb = 1/3 * Fb
        Theoretical Force : (Ton)	39.67		Stroke Time = 1/(Stroker Rate*Factor%)	F	F = (Fd + Fb)*No. Of Impressions
        Recommended Force : (Ton)	49.59		Calculated:	F Actual	F Actual = F * 1.25

## Selected Tonnage (T) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 50T | Lookup from machine database |  |  |

## Machine Name :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| Press 50T | Lookup from machine database |  |  |

## M/c Automation :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| Manual | Lookup from machine database |  |  |

## Recommend (T) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| To be removed |  |  |  |

## Cycle Time (sec) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 22.0000 | Calculated | (Value from lookup table 4) + (Sheet loading unloading time/60) |  |

## Setup Time (min/piece) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 0.0045 | Calculated | Setup time = (Tool loading time)/Batch qty |  |
        Tool Loading Time (min)	45.0000		Lookup table 3A
        Total Coil/Sheet loading time (min)	0.1667		Lookup from table 2

## Cost Drivers :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| # of Direct Labors : | 1 | Lookup from machine database |  |

## # of Skilled Labors :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 1 | Hidden field in the UI. Look up value from the machine database.; if no value in machine database default value is 1 |  |  |
        Direct Labor Rate /hr	30		Lookingup Value from the country table
        Skilled Labor Rate /hr	45		Lookingup Value from the country table

## QA Inspector Rate /hr:
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 50 |  |  |  |
        Sampling Rate (%)	1%		Look up the sampling plan table based on lot size.

## Inspection time (min) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 0.5000 | default: Part complexicity from part information section: Low 5; medium 10; high: 20 |  |  |

## Yield (Net Good Parts) (%) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 98.0% | Default: 98% user can change the value |  |  |

## Machine hour Rate ($) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 15 | Lookup from machine database |  |  |

## Machine Cost ($) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  0.0917  | Calculated: | (Machine hour rate / 60 ) x Cycle time/no of impressions |  |

## Setup Cost ($) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  0.0068  | Calculated: | ((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time) |  |

## Labor Cost ($) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  0.1833  | Calculated: | (Direct labor rate / 60)* No. of direct labor * (cycle time/no of impressions)) |  |

## Inspection Cost ($) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  0.0042  | Calculated: | (((QA inspector rate / 60) * Inspection Time)*(Sampling% * Lot size)) / Lot size |  |
        Yield Cost (Rejected Parts Scrap Rate) ($)	 0.0393 		Calculated:	( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection)))

## Net Process cost ($) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  0.3252  | Calculated: | Sum ( machine + setup + labor + inspection + yiled) |  |

## Manufacturing 2 :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| Process Type : | Bending | Select dropdown |  |
        Ultimate Tensile Strength Of Material : (Mpa)	440		Lookup material table
        Bending line length : (mm)	2200		To be captured from part drawing /  User Input
        Shoulder width : (mm)	15		To be captured from part drawing /  User Input

## Bending coeffecient :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 1.33 | Constant |  |  |
        Theoretical Force : (Ton)	78.74		Calculated	((Sheet thickness ^2 * bending length * UTS * coefficient)/ bend shoulder length ) / 9810
        No. Of Bends: Count	1.00		To be captured from part drawing /  User Input
        Total Tonnage Requird: (Ton)	78.74		Calculated	Theoretical force * no. of bends
        Recommended Force : (Ton)	98.43		Calculated	Theoretical force * 1.25

## Selected Tonnage (T) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  80T  | Lookup from machine database |  |  |

## Machine Name :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 80T T Press Brake | Lookup from machine database |  |  |

## M/c Automation :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| Manual | Lookup from machine database |  |  |

## Recommend (T) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| To be removed |  |  |  |

## Cycle Time (sec) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 7.0000 | If machine is manual, Stroke Time = Lookup from table 4 + (Sheet loading/unloading time) |  |  |

## Setup Time (min/piece) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 0.0010 | Calculated | Tool loading time / Lot size |  |
        Total tool loading time (min)	10.0000		Lookup from table 3B
        Sheet loading/Unloading time (min)	0.0833		Lookup from table 2

## Cost Drivers :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| # Direct Labors : | 1 | Lookup from machine database |  |

## # of Skilled Labors :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 0 | Hidden field in the UI. Look up value from the machine database.; if no value in machine database default value is 1 |  |  |
        Direct Labor Rate /hr	30		Lookingup Value from the country table
        Skilled Labor Rate /hr	45		Lookingup Value from the country table

## QA Inspector Rate /hr:
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 50 |  |  |  |
        Sampling Rate (%)	1%		Look up the sampling plan table based on lot size.

## Inspection time (min) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 0.5000 | default: Part complexicity from part information section: Low 5; medium 10; high: 20 |  |  |

## Yield (Net Good Parts) (%) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 98.0% | Default: 98% user can change the value |  |  |

## Machine hour Rate ($) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
| 15 | Lookup from machine database |  |  |

## Machine Cost ($) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  0.0292  | Calculated: | (Machine hour rate / 60 ) x Cycle time |  |

## Setup Cost ($) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  0.0008  | Calculated: | ((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time) |  |

## Labor Cost ($) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  0.0686  | Calculated: | (Direct labor rate / 60)* No. of direct labor * cycle time) |  |

## Inspection Cost ($) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  0.0042  | Calculated: | (((QA inspector rate / 60) * Inspection Time)*(Sampling% * Lot size)) / Lot size |  |
        Yield Cost (Rejected Parts Scrap Rate) ($)	 0.0356 		Calculated:	( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection)))

## Net Process cost ($) :
| Field | Value | Logic / Source | Notes |
|---|---|---|---|
|  0.1383  | Calculated: | Sum ( machine + setup + labor + inspection + yiled) |  |
