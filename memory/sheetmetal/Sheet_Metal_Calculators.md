# Sheet Metal Calculators

_Converted from `Sheet_Metal_Calculators__2-9-23___1___1_.xlsx`_

## Table of Contents

- [TPP](#tpp)
- [Stamping & Bending](#stamping--bending)
- [DrawingForming](#drawingforming)
- [Cutting (Laser)](#cutting-laser)
- [Lookup 1 - Stroke Rate (Auto)](#lookup-1---stroke-rate-auto)
- [(Lookup-2) Handling](#lookup-2-handling)
- [Tool Setup (Lookup 3)](#tool-setup-lookup-3)
- [Stroke Rate Manual (Lookup 4)](#stroke-rate-manual-lookup-4)
- [Laser Cutting (Lookup 5)](#laser-cutting-lookup-5)
- [Sampling (Lookup 6)](#sampling-lookup-6)
- [Tier Classification](#tier-classification)

## TPP

| Col1 | Col2 | Col3 | Col4 | Col5 | Col6 | Col7 |
| --- | --- | --- | --- | --- | --- | --- |
|   |  | Changed |  |  |  |  |
|  |  | Addition |  |  |  |  |
|  |  | To be removed |  |  |  |  |
|  | Field Header | Field name | Field Value | Default/Any Logic? | Comment | Formual |
|  | Part Information : | Internal Part Number : |  |  | Populated from template upload  /  User Input |  |
|  |  | Part Description : |  |  | Populated from template upload  /  User Input |  |
|  |  | Annual Volume (#) : | 12000 |  | Populated from template upload  /  User Input |  |
|  |  | Commodity : | Sheet Metal |  | Populated from template upload  /  User Input |  |
|  |  | Process Name : | Turret Punching |  | System suggestion / User Input |  |
|  |  | Current Supplier Name : |  |  | Populated from template upload or User selected from drop down |  |
|  |  | Current Manufacturing Country : | USA |  | Populated from template upload or User selected from drop down |  |
|  |  | Delivery Country : | USA |  | Populated from template upload or User selected from drop down |  |
|  |  | BOM Qty (No's) | 1 |  | Populated from template upload  /  User Input |  |
|  |  | Part Complexity : | Medium |  | System suggestion / User selected from drop down |  |
|  |  | Lot size (#) : | 2500 |  | Populated from template upload or default to annual volume/12 |  |
|  |  | Supply Chain Model : | Buy |  | Default is buy |  |
|  |  | Packaging Type : | No Packing |  | Select dropdown |  |
|  |  | HS Code : | N/A |  | Populated from template upload  /  User Input |  |
|  |  | Inco Terms : | EX-W |  | Default option1: Supplier master; Option 2: Client master |  |
|  |  | Payment Terms : | 60 Days |  | Default option1: Supplier master; Option 2: Client master |  |
|  | Material Information : | Category : | Ferrous |  | To be captured from part drawing /  User Input |  |
|  |  | Family : | HDG Steel |  | To be captured from part drawing /  User Input |  |
|  |  | Description/Grade : | 2mm*500mm SGCC |  | To be captured from part drawing /  User Input |  |
|  |  | Density (g/cc) : | 7.85 |  | Lookup material table |  |
|  |  | Material price ($/Kg) : | 1.5 |  | Lookup material table |  |
|  |  | Scrap price ($/Kg) : | 0.4 |  | Lookup material table |  |
|  |  | Unfolded Length (mm) : | 50 |  | To be captured from part drawing /  User Input |  |
|  |  | Unfolded Width (mm) : | 30 |  | To be captured from part drawing /  User Input |  |
|  |  | Thickness (mm) : | 2 |  | To be captured from part drawing /  User Input |  |
|  |  | Net weight (g) : | 23.1 |  | To be captured from part drawing /  User Input |  |
|  |  | Area (mm^2) : | 1500 |  | To be captured from part drawing /  User Input |  |
|  |  | Volume (mm^3) : | 3000 |  | Calculated: Part area * Sheet thickness |  |
|  |  | Part allowance (mm) : | 0.1186591758 |  | Calculated: | Constant * Sheet thickness * ((Shear strength / 10) ^ (1/2)) |
|  |  | No. of Impressions : |  |  | To be removed |  |
|  |  | Sheet Width (mm)  : | 1250 |  | System Suggestion / User can change |  |
|  |  | Sheet Length (mm) | 2500 |  | System Suggestion / User can change |  |
|  |  | Edge Allowance (mm) | 2 |  | Default value |  |
|  |  | Parts per Sheet | 2065.246722 |  | Calculated: | (Sheet width - Edge allowance)  x (Sheet length - Edge allowance) / (Part length + Part allowance) x (Part width = Part allowance) |
|  |  | Sheet Weight (g) | 49062.5 |  | Calculated: | (Sheet length x Sheet Width x Sheet Thickness x Density) / 1000 |
|  |  | Scrap weight per part(g) : | 0.6562415525 |  | Calculated: | Gross part weight - Net part weight |
|  |  | Net weight per part (g) : | 23.1 |  | To be captured from part drawing /  User Input |  |
|  |  | Gross weight per part (g) : | 23.75624155 |  | Calculated: | Sheet weight / Parts per sheet |
|  |  | Utilisation % | 0.9723760364 |  | Calculated: | Net part weight / gross part weight |
|  |  | Scrap Revovery % | 0.9 |  | Default / User can change |  |
|  |  | Gross Material cost ($) : | 0.03563436233 |  | Calculated: | (Gross weight / 1000) * Material Price |
|  |  | Scrap Rec Cost ($) : | 0.0002362469589 |  | Calculated: | (Scrap weight / 1000)* Scrap recovery % * Material Price |
|  |  | Net Material cost ($) : | 0.03539811537 |  | Calculated: | Gross material cost - Scrap Rec Cost |
|  | Manufacturing 1 : | Process Type : | TPP |  | Select dropdown |  |
|  |  | Length Of Cut : (Internal & External) (mm) | 178.84 |  | To be captured from part drawing /  User Input |  |
|  |  | Shear Strength Of Material : (Mpa) | 352 |  | Lookup material table |  |
|  |  | Theoretical Force : (Ton) | 12.83418552 |  | Calculated: | (Length of cut * sheet thickness * shear strength) / 9810 |
|  |  | Recommended Force : (Ton) | 16.04273191 |  | Calculated: | Theoretical force * 1.25 |
|  |  | Selected Tonnage (T) : | 20T |  | Lookup from machine database |  |
|  |  | Machine Name : | Turret Press |  | Lookup from machine database |  |
|  |  | M/c Automation : | Auto |  | Lookup from machine database |  |
|  |  | Recommend (T) : |  |  | To be removed |  |
|  |  | Cycle Time (sec) : | 0.8571428571 |  | If machine is automatic, Stroke Time = (1/(Stroker Rate*Factor%))*60 | Stroke rate is lookup from machine database & factor% is lookup from table 1 |
|  |  | Setup Time (min/piece) : | 0.008 |  | Calculated: | Total sheet loading - unloading time / Lot size |
|  |  | Total Sheet loading/unloading time (min) | 20 |  | Calculated: | (Lot size / parts per sheet) * value from lookup table 2 i.e material handeling table. Value to be selected based on sheet weight |
|  |  | # of Direct Labors : | 0.5 |  | Lookup from machine database |  |
|  |  | # of Skilled Labors : | 0 |  | Hidden field in the UI. Look up value from the machine database.; if no value in machine database default value is 1 |  |
|  | Cost Drivers : | Direct Labor Rate /hr | 30 |  | Lookingup Value from the country table |  |
|  |  | Skilled Labor Rate /hr | 45 |  | Lookingup Value from the country table |  |
|  |  | QA Inspector Rate /hr: | 50 |  |  |  |
|  |  | Sampling Rate (%) | 0.01 |  | Look up the sampling plan table based on lot size. |  |
|  |  | Inspection time (min) : | 0.5 |  | default: Part complexicity from part information section: Low 5; medium 10; high: 20 |  |
|  |  | Yield (Net Good Parts) (%) : | 0.98 |  | Default: 98% user can change the value |  |
|  |  | Machine hour Rate ($) : | 15 |  | Lookup from machine database |  |
|  |  | Machine Cost ($) : | 0.003571428571 |  | Calculated: | (Machine hour rate / 60 ) x Cycle time |
|  |  | Setup Cost ($) : | 0.004 |  | Calculated: | ((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time) |
|  |  | Labor Cost ($) : | 0.003571428571 |  | Calculated: | (Direct labor rate / 60)* No. of direct labor * cycle time) |
|  |  | Inspection Cost ($) : | 0.004166666667 |  | Calculated: | (((QA inspector rate / 60) * Inspection Time)*(Sampling% * Lot size)) / Lot size |
|  |  | Yield Cost (Rejected Parts Scrap Rate) ($) | 0.0008293527836 |  | Calculated: | ( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection))) |
|  |  | Net Process cost ($) : | 0.01613887659 |  | Calculated: | Sum ( machine + setup + labor + inspection + yiled) |
|  | Manufacturing 2 : | Process Type : | Bending |  | Select dropdown |  |
|  |  | Ultimate Tensile Strength Of Material : (Mpa) | 440 |  | Lookup material table |  |
|  |  | Bending line length : (mm) | 2200 |  | To be captured from part drawing /  User Input |  |
|  |  | Shoulder width : (mm) | 15 |  | To be captured from part drawing /  User Input |  |
|  |  | Bending coeffecient : | 1.33 |  | Constant |  |
|  |  | Theoretical Force : (Ton) | 34.99667006 |  | Calculated | ((Sheet thickness ^2 * bending length * UTS * coefficient)/ bend shoulder length ) / 9810 |
|  |  | No. Of Bends: Count | 1 |  | To be captured from part drawing /  User Input |  |
|  |  | Total Tonnage Requird: (Ton) | 34.99667006 |  | Calculated | Theoretical force * no. of bends |
|  |  | Recommended Force : (Ton) | 43.74583758 |  | Calculated | Theoretical force * 1.25 |
|  |  | Selected Tonnage (T) : | 80T |  | Lookup from machine database |  |
|  |  | Machine Name : | 80T T Press Brake |  | Lookup from machine database |  |
|  |  | M/c Automation : | Manual |  | Lookup from machine database |  |
|  |  | Recommend (T) : |  |  | To be removed |  |
|  |  | Cycle Time (sec) : | 7 |  | If machine is manual, Stroke Time = Lookup from table 4 + (Sheet loading/unloading time) |  |
|  |  | Setup Time (min/piece) : | 0.004 |  | Calculated | Tool loading time / Lot size |
|  |  | Total tool loading time (min) | 10 |  | Lookup from table 3B |  |
|  |  | Sheet loading/Unloading time (min) | 0.08333333333 |  | Lookup from table 2 |  |
|  | Cost Drivers : | # Direct Labors : | 1 |  | Lookup from machine database |  |
|  |  | # of Skilled Labors : | 0 |  | Hidden field in the UI. Look up value from the machine database.; if no value in machine database default value is 1 |  |
|  |  | Direct Labor Rate /hr | 30 |  | Lookingup Value from the country table |  |
|  |  | Skilled Labor Rate /hr | 45 |  | Lookingup Value from the country table |  |
|  |  | QA Inspector Rate /hr: | 50 |  |  |  |
|  |  | Sampling Rate (%) | 0.01 |  | Look up the sampling plan table based on lot size. |  |
|  |  | Inspection time (min) : | 0.5 |  | default: Part complexicity from part information section: Low 5; medium 10; high: 20 |  |
|  |  | Yield (Net Good Parts) (%) : | 0.98 |  | Default: 98% user can change the value |  |
|  |  | Machine hour Rate ($) : | 15 |  | Lookup from machine database |  |
|  |  | Machine Cost ($) : | 0.02916666667 |  | Calculated: | (Machine hour rate / 60 ) x Cycle time |
|  |  | Setup Cost ($) : | 0.003 |  | Calculated: | ((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time) |
|  |  | Labor Cost ($) : | 0.06862745098 |  | Calculated: | (Direct labor rate / 60)* No. of direct labor * cycle time) |
|  |  | Inspection Cost ($) : | 0.004166666667 |  | Calculated: | (((QA inspector rate / 60) * Inspection Time)*(Sampling% * Lot size)) / Lot size |
|  |  | Yield Cost (Rejected Parts Scrap Rate) ($) | 0.002622377994 |  | Calculated: | ( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection))) |
|  |  | Net Process cost ($) : | 0.1075831623 |  | Calculated: | Sum ( machine + setup + labor + inspection + yiled) |

## Stamping & Bending

| Col1 | Col2 | Col3 | Col4 | Col5 |
| --- | --- | --- | --- | --- |
|  | Changed |  |  |  |
|  | Addition |  |  |  |
|  | To be removed |  |  |  |
| Field Header | Field name | Field Value | Comment | Input/Feedback |
| Part Information : | Internal Part Number : |  | Populated from template upload  /  User Input |  |
|  | Part Description : |  | Populated from template upload  /  User Input |  |
|  | Annual Volume (#) : | 120000 | Populated from template upload  /  User Input |  |
|  | Commodity : | Sheet Metal | Populated from template upload  /  User Input |  |
|  | Process Name : | Stamping - Progressive | System suggestion / User Input |  |
|  | Current Supplier Name : |  | Populated from template upload or User selected from drop down |  |
|  | Current Manufacturing Country : | USA | Populated from template upload or User selected from drop down |  |
|  | Delivery Country : | USA | Populated from template upload or User selected from drop down |  |
|  | BOM Qty (No's) | 1 | Populated from template upload  /  User Input |  |
|  | Part Complexity : | Medium | System suggestion / User selected from drop down |  |
|  | Lot size (#) : | 10000 | Populated from template upload or default to annual volume/12 |  |
|  | Supply Chain Model : | Buy | Default is buy |  |
|  | Packaging Type : | No Packing | Select dropdown |  |
|  | HS Code : | N/A | Populated from template upload  /  User Input |  |
|  | Inco Terms : | EX-W | Default option1: Supplier master; Option 2: Client master |  |
|  | Payment Terms : | 60 Days | Default option1: Supplier master; Option 2: Client master |  |
| Material Information : | Category : | Ferrous | To be captured from part drawing /  User Input |  |
|  | Family : | HDG Steel | To be captured from part drawing /  User Input |  |
|  | Description/Grade : | 2mm*500mm SGCC | To be captured from part drawing /  User Input |  |
|  | Density (g/cc) : | 7.85 | Lookup material table |  |
|  | Material price ($/Kg) : | 1.5 | Lookup material table |  |
|  | Scrap price ($/Kg) : | 0.4 | Lookup material table |  |
|  | Unfolded Length (mm) : | 50 | To be captured from part drawing /  User Input |  |
|  | Unfolded Width (mm) : | 30 | To be captured from part drawing /  User Input |  |
|  | Thickness (mm) : | 2 | To be captured from part drawing /  User Input |  |
|  | Net weight (g) : | 23.1 | To be captured from part drawing /  User Input |  |
|  | Area (mm^2) : | 1500 | To be captured from part drawing /  User Input |  |
|  | Volume (mm^3) : | 3000 | Calculated: Part area * Sheet thickness |  |
|  | Part allowance (mm) : | 10.11865918 | Calculated: | Constant * Sheet thickness * ((Shear strength / 10) ^ (1/2)) +  (10 mm to be added if more than 1 impression) |
|  | No. of Impressions : | 7 | Calculated: | (Coil width - Start & end scrap length) / ( Part length + part allowance) |
|  | Coil Width (mm)  : | 500 | System Suggestion / User can change |  |
|  | Coil Length (mm) | 12000 | System Suggestion / User can change |  |
|  | Start & End Scrap Length (mm) | 20 | Default value |  |
|  | Parts per Coil | 2384.198221 | Calculated: | (Coil width - Edge allowance)  x (Coil length - Edge allowance) / (Part length + Part allowance) x (Part width = Part allowance) |
|  | Coil WeiKght (g) | 94200 | Calculated: | (Coil length x Coil Width x Sheet Thickness x Density) / 1000 |
|  | Scrap weight per part(g) : | 16.41013769 | Calculated: | Gross part weight - Net part weight |
|  | Net weight per part (g) : | 23.1 | To be captured from part drawing /  User Input |  |
|  | Gross weight per part (g) : | 39.51013769 | Calculated: | Sheet weight / Parts per sheet |
|  | Utilisation % | 0.5846600734 | Calculated: | Net part weight / gross part weight |
|  | Scrap Revovery % | 0.9 | Default / User can change |  |
|  | Gross Material cost ($) : | 0.05926520653 | Calculated: | (Gross weight / 1000) * Material Price |
|  | Scrap Rec Cost ($) : | 0.005907649568 | Calculated: | (Scrap weight / 1000)* Scrap recovery % * Material Price |
|  | Net Material cost ($) : | 0.05335755697 | Calculated: | Gross material cost - Scrap Rec Cost |
| Manufacturing 1 : | Process Type : | Stamping | Select dropdown |  |
|  | Length Of Cut : (Internal & External) (mm) | 100 | To be captured from part drawing /  User Input |  |
|  | Shear Strength Of Material : (Mpa) | 352 | Lookup material table |  |
|  | Theoretical Force : (Ton) | 50.23445464 | Calculated: | (Length of cut * sheet thickness * shear strength*No. of impressions) / 9810  |
|  | Recommended Force : (Ton) | 62.7930683 | Calculated: | Theoretical force * 1.25 |
|  | Selected Tonnage (T) : | 120 | Lookup from machine database |  |
|  | Machine Name : | Stamping 120T | Lookup from machine database |  |
|  | M/c Automation : | Auto | Lookup from machine database |  |
|  | Recommend (T) : |  | To be removed |  |
|  | Cycle Time (sec) : | 0.8571428571 | If machine is auto, Stroke Time = (1/(Stroker Rate*Factor%))*60 | Stroke rate is lookup from machine database & factor% is lookup from table 1 |
|  | Setup Time (min/piece) : | 0.0145 | Calculated: | ((Tool loading time + Total coil loading unloading time )/ Lot size)*60 |
|  | Tool Loading Time (min) | 45 | Lookup table 3A |  |
|  | Total Coil/Sheet loading time (min) | 100 | Calculated: | (Lot size / parts per sheet) * value from lookup table 2 i.e material handeling table. Value to be selected based on sheet weight |
| Cost Drivers : | # Direct Labors : | 1 | Lookup from machine database |  |
|  | # of Skilled Labors : | 1 | Hidden field in the UI. Look up value from the machine database.; if no value in machine database default value is 1 |  |
|  | Direct Labor Rate /hr | 30 | Lookingup Value from the country table |  |
|  | Skilled Labor Rate /hr | 45 | Lookingup Value from the country table |  |
|  | QA Inspector Rate /hr: | 50 |  |  |
|  | Sampling Rate (%) | 0.01 | Look up the sampling plan table based on lot size. |  |
|  | Inspection time (min) : | 0.5 | default: Part complexicity from part information section: Low 5; medium 10; high: 20 |  |
|  | Yield (Net Good Parts) (%) : | 0.98 | Default: 98% user can change the value |  |
|  | Machine hour Rate ($) : | 15 | Lookup from machine database |  |
|  | Machine Cost ($) : | 0.0005102040816 | Calculated: | (Machine hour rate / 60 ) x Cycle time/No. of impressions |
|  | Setup Cost ($) : | 0.02175 | Calculated: | ((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time) |
|  | Labor Cost ($) : | 0.001020408163 | Calculated: | (Direct labor rate / 60)* No. of direct labor * (cycle time/no of impressions)) |
|  | Inspection Cost ($) : | 0.004166666667 | Calculated: | (((QA inspector rate / 60)  * Inspection Time)*(Sampling% * Lot size)) / Lot size |
|  | Yield Cost (Rejected Parts Scrap Rate) ($) | 0.001431296718 | Calculated: | ( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection))) |
|  | Net Process cost ($) : | 0.02887857563 | Calculated: | Sum ( machine + setup + labor + inspection + yiled) |
| Manufacturing 2 : | Process Type : | Bending | Select dropdown |  |
|  | Ultimate Tensile Strength Of Material : (Mpa) | 440 | Lookup material table |  |
|  | Bending line length : (mm) | 2200 | To be captured from part drawing /  User Input |  |
|  | Shoulder width : (mm) | 15 | To be captured from part drawing /  User Input |  |
|  | Bending coeffecient : | 1.33 | Constant |  |
|  | Theoretical Force : (Ton) | 34.99667006 | Calculated | ((Sheet thickness ^2 * bending length * UTS * coefficient)/ bend shoulder length ) / 9810 |
|  | No. Of Bends: Count | 1 | To be captured from part drawing /  User Input |  |
|  | Total Tonnage Requird: (Ton) | 34.99667006 | Calculated | Theoretical force * no. of bends |
|  | Recommended Force : (Ton) | 43.74583758 | Calculated | Theoretical force * 1.25 |
|  | Selected Tonnage (T) : | 80T | Lookup from machine database |  |
|  | Machine Name : | 80T T Press Brake | Lookup from machine database |  |
|  | M/c Automation : | Manual | Lookup from machine database |  |
|  | Recommend (T) : |  | To be removed |  |
|  | Cycle Time (sec) : | 7 | If machine is manual, Stroke Time = Lookup from table 4 + (Sheet loading/unloading time) |  |
|  | Setup Time (min/piece) : | 0.001 | Calculated | Tool loading time / Lot size |
|  | Total tool loading time (min) | 10 | Lookup from table 3B |  |
|  | Sheet loading/Unloading time (min) | 0.08333333333 | Lookup from table 2 |  |
| Cost Drivers : | # of Direct Labors : | 1 | Lookup from machine database |  |
|  | # of Skilled Labors : | 0 | Hidden field in the UI. Look up value from the machine database.; if no value in machine database default value is 1 |  |
|  | Direct Labor Rate /hr | 30 | Lookingup Value from the country table |  |
|  | Skilled Labor Rate /hr | 45 | Lookingup Value from the country table |  |
|  | QA Inspector Rate /hr: | 50 |  |  |
|  | Sampling Rate (%) | 0.01 | Look up the sampling plan table based on lot size. |  |
|  | Inspection time (min) : | 0.5 | default: Part complexicity from part information section: Low 5; medium 10; high: 20 |  |
|  | Yield (Net Good Parts) (%) : | 0.98 | Default: 98% user can change the value |  |
|  | Machine hour Rate ($) : | 15 | Lookup from machine database |  |
|  | Machine Cost ($) : | 0.02916666667 | Calculated: | (Machine hour rate / 60 ) x Cycle time |
|  | Setup Cost ($) : | 0.00075 | Calculated: | ((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time) |
|  | Labor Cost ($) : | 0.06862745098 | Calculated: | (Direct labor rate / 60)* No. of direct labor * cycle time) |
|  | Inspection Cost ($) : | 0.004166666667 | Calculated: | (((QA inspector rate / 60) * Inspection Time)*(Sampling% * Lot size)) / Lot size |
|  | Yield Cost (Rejected Parts Scrap Rate) ($) | 0.002936566826 | Calculated: | ( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection))) |
|  | Net Process cost ($) : | 0.1056473511 | Calculated: | Sum ( machine + setup + labor + inspection + yiled) |

## DrawingForming

| Col1 | Col2 | Col3 | Col4 | Col5 | Col6 | Col7 |
| --- | --- | --- | --- | --- | --- | --- |
|  | Changed |  |  |  |  |  |
|  | Addition |  |  |  |  |  |
|  | To be removed |  |  |  |  |  |
| Field Header | Field name | Field Value | Default/Any Logic? | Comment | Input/Feedback | Input/Feedback |
| Part Information : | Internal Part Number : |  |  | Populated from template upload  /  User Input |  |  |
|  | Part Description : |  |  | Populated from template upload  /  User Input |  |  |
|  | Annual Volume (#) : | 120000 |  | Populated from template upload  /  User Input |  |  |
|  | Commodity : | Sheet Metal |  | Populated from template upload  /  User Input |  |  |
|  | Process Name : | Stamping - Progressive |  | System suggestion / User Input |  |  |
|  | Current Supplier Name : |  |  | Populated from template upload or User selected from drop down |  |  |
|  | Current Manufacturing Country : | USA |  | Populated from template upload or User selected from drop down |  |  |
|  | Delivery Country : | USA |  | Populated from template upload or User selected from drop down |  |  |
|  | BOM Qty (No's) | 1 |  | Populated from template upload  /  User Input |  |  |
|  | Part Complexity : | Medium |  | System suggestion / User selected from drop down |  |  |
|  | Lot size (#) : | 10000 |  | Populated from template upload or default to annual volume/12 |  |  |
|  | Supply Chain Model : | Buy |  | Default is buy |  |  |
|  | Packaging Type : | No Packing |  | Select dropdown |  |  |
|  | HS Code : | N/A |  | Populated from template upload  /  User Input |  |  |
|  | Inco Terms : | EX-W |  | Default option1: Supplier master; Option 2: Client master |  |  |
|  | Payment Terms : | 60 Days |  | Default option1: Supplier master; Option 2: Client master |  |  |
| Material Information : | Category : | Ferrous |  | To be captured from part drawing /  User Input |  |  |
|  | Family : | HDG Steel |  | To be captured from part drawing /  User Input |  |  |
|  | Description/Grade : | 2mm*500mm SGCC |  | To be captured from part drawing /  User Input |  |  |
|  | Density (g/cc) : | 7.85 |  | Lookup material table |  |  |
|  | Material price ($/Kg) : | 1.5 |  | Lookup material table |  |  |
|  | Scrap price ($/Kg) : | 0.4 |  | Lookup material table |  |  |
|  | Unfolded Length (mm) : | 250 |  | To be captured from part drawing /  User Input |  |  |
|  | Unfolded Width (mm) : | 250 |  | To be captured from part drawing /  User Input |  |  |
|  | Thickness (mm) : | 3 |  | To be captured from part drawing /  User Input |  |  |
|  | Net weight (g) : | 1471.9 |  | To be captured from part drawing /  User Input |  |  |
|  | Area (mm^2) : | 62500 |  | To be captured from part drawing /  User Input |  |  |
|  | Volume (mm^3) : | 187500 |  | Calculated: Part area * Sheet thickness |  |  |
|  | Part allowance | 0.1779887637 |  | Calculated: | Constant * Sheet thickness * ((Shear strength / 10) ^ (1/2)) +  (10 mm to be added if more than 1 impression) |  |
|  | No. of Impressions : | 1 |  | Calculated: | (Coil width - Start & end scrap length) / ( Part length + part allowance) |  |
|  | Coil/Sheet Width (mm)  : | 300 |  | System Suggestion / User can change |  |  |
|  | Coil/Sheet Length (mm) | 300 |  | System Suggestion / User can change |  |  |
|  | Start & End Scrap Length (mm) | 5 |  | Default value |  |  |
|  | Parts per Coil | 1.390419463 |  | Calculated: | (Coil width - Edge allowance)  x (Coil length - Edge allowance) / (Part length + Part allowance) x (Part width = Part allowance) |  |
|  | Coil/Sheet WeiKght (g) | 2119.5 |  | Calculated: | (Coil length x Coil Width x Sheet Thickness x Density) / 1000 |  |
|  | Scrap weight per part(g) : | 52.46013488 |  | Calculated: | Gross part weight - Net part weight |  |
|  | Net weight per part (g) : | 1471.9 |  | To be captured from part drawing /  User Input |  |  |
|  | Gross weight per part (g) : | 1524.360135 |  | Calculated: | Sheet weight / Parts per sheet |  |
|  | Utilisation % | 0.9655854718 |  | Calculated: | Net part weight / gross part weight |  |
|  | Scrap Recovery % | 0.9 |  | Default / User can change |  |  |
|  | Gross Material cost ($) : | 2.286540202 |  | Calculated: | (Gross weight / 1000) * Material Price |  |
|  | Scrap Rec Cost ($) : | 0.01888564856 |  | Calculated: | (Scrap weight / 1000)* Scrap recovery % * Material Price |  |
|  | Net Material cost ($) : | 2.267654554 |  | Calculated: | Gross material cost - Scrap Rec Cost |  |
| Manufacturing 1 : | Process Type : | Stamping |  | Select dropdown |  |  |
|  | Form Length: (mm) | 250 |  | To be captured from part drawing /  User Input | L | Calculated based on part draw feature |
|  | Form Perimeter: (mm) | 785 |  | To be captured from part drawing /  User Input | Fp | Calculated based on part draw feature |
|  | Form Height: (mm) | 180 |  | To be captured from part drawing /  User Input | h | Calculated based on part draw feature |
|  | Punch Perimeter : (mm) | 745.75 |  | To be captured from part drawing /  User Input | Dp | Calculated based on part draw feature, 95% of form perimeter |
|  | (h/L) Factor | 0.72 |  | Calculated: | (h/L) | DR = h/L |
|  | Yield Strength Of Material : (Mpa) | 370 |  | Lookup from material database | Y | Can be captured from Material database |
|  | Drawing Force : (Ton) | 29.75558104 |  | Calculated | Fd | Fd = Dp * T * Y * (Fp/Dp-0.7)  |
|  | Blank Holding Force : (Ton) | 9.918527013 |  | To be removed | Fb | Fb = 1/3 * Fb |
|  | Theoretical Force : (Ton) | 39.67410805 |  | Stroke Time = 1/(Stroker Rate*Factor%) | F | F = (Fd + Fb)*No. Of Impressions |
|  | Recommended Force : (Ton) | 49.59263507 |  | Calculated: | F Actual | F Actual = F * 1.25  |
|  | Selected Tonnage (T) : | 50T |  | Lookup from machine database |  |  |
|  | Machine Name : | Press 50T |  | Lookup from machine database |  |  |
|  | M/c Automation : | Manual |  | Lookup from machine database |  |  |
|  | Recommend (T) : |  |  | To be removed |  |  |
|  | Cycle Time (sec) : | 22 |  | Calculated | (Value from lookup table 4) + (Sheet loading unloading time/60) |  |
|  | Setup Time (min/piece) : | 0.0045 |  | Calculated | Setup time = (Tool loading time)/Batch qty |  |
|  | Tool Loading Time (min) | 45 |  | Lookup table 3A |  |  |
|  | Total Coil/Sheet loading time (min) | 0.1666666667 |  | Lookup from table 2 |  |  |
| Cost Drivers : | # of Direct Labors : | 1 |  | Lookup from machine database |  |  |
|  | # of Skilled Labors : | 1 |  | Hidden field in the UI. Look up value from the machine database.; if no value in machine database default value is 1 |  |  |
|  | Direct Labor Rate /hr | 30 |  | Lookingup Value from the country table |  |  |
|  | Skilled Labor Rate /hr | 45 |  | Lookingup Value from the country table |  |  |
|  | QA Inspector Rate /hr: | 50 |  |  |  |  |
|  | Sampling Rate (%) | 0.01 |  | Look up the sampling plan table based on lot size. |  |  |
|  | Inspection time (min) : | 0.5 |  | default: Part complexicity from part information section: Low 5; medium 10; high: 20 |  |  |
|  | Yield (Net Good Parts) (%) : | 0.98 |  | Default: 98% user can change the value |  |  |
|  | Machine hour Rate ($) : | 15 |  | Lookup from machine database |  |  |
|  | Machine Cost ($) : | 0.09166666667 |  | Calculated: | (Machine hour rate / 60 ) x Cycle time/no of impressions |  |
|  | Setup Cost ($) : | 0.00675 |  | Calculated: | ((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time) |  |
|  | Labor Cost ($) : | 0.1833333333 |  | Calculated: | (Direct labor rate / 60)* No. of direct labor * (cycle time/no of impressions)) |  |
|  | Inspection Cost ($) : | 0.004166666667 |  | Calculated: | (((QA inspector rate / 60) * Inspection Time)*(Sampling% * Lot size)) / Lot size |  |
|  | Yield Cost (Rejected Parts Scrap Rate) ($) | 0.03929622441 |  | Calculated: | ( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection))) |  |
|  | Net Process cost ($) : | 0.3252128911 |  | Calculated: | Sum ( machine + setup + labor + inspection + yiled) |  |
| Manufacturing 2 : | Process Type : | Bending |  | Select dropdown |  |  |
|  | Ultimate Tensile Strength Of Material : (Mpa) | 440 |  | Lookup material table |  |  |
|  | Bending line length : (mm) | 2200 |  | To be captured from part drawing /  User Input |  |  |
|  | Shoulder width : (mm) | 15 |  | To be captured from part drawing /  User Input |  |  |
|  | Bending coeffecient : | 1.33 |  | Constant |  |  |
|  | Theoretical Force : (Ton) | 78.74250765 |  | Calculated | ((Sheet thickness ^2 * bending length * UTS * coefficient)/ bend shoulder length ) / 9810 |  |
|  | No. Of Bends: Count | 1 |  | To be captured from part drawing /  User Input |  |  |
|  | Total Tonnage Requird: (Ton) | 78.74250765 |  | Calculated | Theoretical force * no. of bends |  |
|  | Recommended Force : (Ton) | 98.42813456 |  | Calculated | Theoretical force * 1.25 |  |
|  | Selected Tonnage (T) : | 80T |  | Lookup from machine database |  |  |
|  | Machine Name : | 80T T Press Brake |  | Lookup from machine database |  |  |
|  | M/c Automation : | Manual |  | Lookup from machine database |  |  |
|  | Recommend (T) : |  |  | To be removed |  |  |
|  | Cycle Time (sec) : | 7 |  | If machine is manual, Stroke Time = Lookup from table 4 + (Sheet loading/unloading time) |  |  |
|  | Setup Time (min/piece) : | 0.001 |  | Calculated | Tool loading time / Lot size |  |
|  | Total tool loading time (min) | 10 |  | Lookup from table 3B |  |  |
|  | Sheet loading/Unloading time (min) | 0.08333333333 |  | Lookup from table 2 |  |  |
| Cost Drivers : | # Direct Labors : | 1 |  | Lookup from machine database |  |  |
|  | # of Skilled Labors : | 0 |  | Hidden field in the UI. Look up value from the machine database.; if no value in machine database default value is 1 |  |  |
|  | Direct Labor Rate /hr | 30 |  | Lookingup Value from the country table |  |  |
|  | Skilled Labor Rate /hr | 45 |  | Lookingup Value from the country table |  |  |
|  | QA Inspector Rate /hr: | 50 |  |  |  |  |
|  | Sampling Rate (%) | 0.01 |  | Look up the sampling plan table based on lot size. |  |  |
|  | Inspection time (min) : | 0.5 |  | default: Part complexicity from part information section: Low 5; medium 10; high: 20 |  |  |
|  | Yield (Net Good Parts) (%) : | 0.98 |  | Default: 98% user can change the value |  |  |
|  | Machine hour Rate ($) : | 15 |  | Lookup from machine database |  |  |
|  | Machine Cost ($) : | 0.02916666667 |  | Calculated: | (Machine hour rate / 60 ) x Cycle time |  |
|  | Setup Cost ($) : | 0.00075 |  | Calculated: | ((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time) |  |
|  | Labor Cost ($) : | 0.06862745098 |  | Calculated: | (Direct labor rate / 60)* No. of direct labor * cycle time) |  |
|  | Inspection Cost ($) : | 0.004166666667 |  | Calculated: | (((QA inspector rate / 60) * Inspection Time)*(Sampling% * Lot size)) / Lot size |  |
|  | Yield Cost (Rejected Parts Scrap Rate) ($) | 0.03563210676 |  | Calculated: | ( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection))) |  |
|  | Net Process cost ($) : | 0.1383428911 |  | Calculated: | Sum ( machine + setup + labor + inspection + yiled) |  |

## Cutting (Laser)

| Col1 | Col2 | Col3 | Col4 | Col5 | Col6 | Col7 | Col8 |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  | Changed |  |  |  |  |  |  |
|  | Addition |  |  |  |  |  |  |
|  | To be removed |  |  |  |  |  |  |
| Field Header | Field name | Field Value | Default/Any Logic? | Comment | Formual | Input/Feedback |  |
| Part Information : | Internal Part Number : |  |  | Populated from template upload  /  User Input |  |  |  |
|  | Part Description : |  |  | Populated from template upload  /  User Input |  |  |  |
|  | Annual Volume (#) : | 12000 |  | Populated from template upload  /  User Input |  |  |  |
|  | Commodity : | Sheet Metal |  | Populated from template upload  /  User Input |  |  |  |
|  | Process Name : | Stamping - Progressive |  | System suggestion / User Input |  |  |  |
|  | Current Supplier Name : |  |  | Populated from template upload or User selected from drop down |  |  |  |
|  | Current Manufacturing Country : | USA |  | Populated from template upload or User selected from drop down |  |  |  |
|  | Delivery Country : | USA |  | Populated from template upload or User selected from drop down |  |  |  |
|  | BOM Qty (No's) | 1 |  | Populated from template upload  /  User Input |  |  |  |
|  | Part Complexity : | Medium |  | System suggestion / User selected from drop down |  |  |  |
|  | Lot size (#) : | 1000 |  | Populated from template upload or default to annual volume/12 |  |  |  |
|  | Supply Chain Model : | Buy |  | Default is buy |  |  |  |
|  | Packaging Type : | No Packing |  | Select dropdown |  |  |  |
|  | HS Code : | N/A |  | Populated from template upload  /  User Input |  |  |  |
|  | Inco Terms : | EX-W |  | Default option1: Supplier master; Option 2: Client master |  |  |  |
|  | Payment Terms : | 60 Days |  | Default option1: Supplier master; Option 2: Client master |  |  |  |
| Material Information : | Category : | Ferrous |  | To be captured from part drawing /  User Input |  |  |  |
|  | Family : | HDG Steel |  | To be captured from part drawing /  User Input |  |  |  |
|  | Description/Grade : | 2mm*500mm SGCC |  | To be captured from part drawing /  User Input |  |  |  |
|  | Density (g/cc) : | 7.85 |  | Lookup material table |  |  |  |
|  | Material price ($/Kg) : | 1.5 |  | Lookup material table |  |  |  |
|  | Scrap price ($/Kg) : | 0.4 |  | Lookup material table |  |  |  |
|  | Unfolded Length (mm) : | 50 |  | To be captured from part drawing /  User Input |  |  |  |
|  | Unfolded Width (mm) : | 30 |  | To be captured from part drawing /  User Input |  |  |  |
|  | Thickness (mm) : | 2 |  | To be captured from part drawing /  User Input |  |  |  |
|  | Net weight (g) : | 23.1 |  | To be captured from part drawing /  User Input |  |  |  |
|  | Area (mm^2) : | 1500 |  | To be captured from part drawing /  User Input |  |  |  |
|  | Volume (mm^3) : | 3000 |  | Calculated: Part area * Sheet thickness |  |  |  |
|  | Part allowance : (Kerf) | 1 |  | Lookup table 5 |  |  |  |
|  | No. of Impressions : |  |  | To be removed |  |  |  |
|  | Sheet Width (mm)  : | 1250 |  | System Suggestion / User can change |  |  |  |
|  | Sheet Length (mm) | 2500 |  | System Suggestion / User can change |  |  |  |
|  | Edge Allowance (mm) | 2 |  | Default value |  |  |  |
|  | Parts per Sheet | 1971.855787 |  | Calculated: | (Sheet width - Edge allowance)  x (Sheet length - Edge allowance) / (Part length + Part allowance) x (Part width = Part allowance) |  |  |
|  | Sheet Weight (g) | 49062.5 |  | Calculated: | (Sheet length x Sheet Width x Sheet Thickness x Density) / 1000 |  |  |
|  | Scrap weight per part(g) : | 1.781383472 |  | Calculated: | Gross part weight - Net part weight |  |  |
|  | Net weight per part (g) : | 23.1 |  | To be captured from part drawing /  User Input |  |  |  |
|  | Gross weight per part (g) : | 24.88138347 |  | Calculated: | Sheet weight / Parts per sheet |  |  |
|  | Utilisation % | 0.9284049669 |  | Calculated: | Net part weight / gross part weight |  |  |
|  | Scrap Recovery % | 0.9 |  | Default / User can change |  |  |  |
|  | Gross Material cost ($) : | 0.03732207521 |  | Calculated: | (Gross weight / 1000) * Material Price |  |  |
|  | Scrap Rec Cost ($) : | 0.00064129805 |  | Calculated: | (Scrap weight / 1000)* Scrap recovery % * Material Price |  |  |
|  | Net Material cost ($) : | 0.03668077716 |  | Calculated: | Gross material cost - Scrap Rec Cost |  |  |
| Manufacturing 1 : | Process Type : | Laser Cutting |  | Select dropdown |  |  |  |
|  | Cutting Length : (mm) | 178.84 |  | To be captured from part drawing /  User Input | L | Cut perimeter, to be captured from 3d model |  |
|  | No of Starts (Piercings) : (Count) | 2 |  | To be captured from part drawing /  User Input | P | No of starts |  |
|  | Cutting Speed : m/min | 4.2 |  | Lookup Table 5 | N | Machine & material spec |  |
|  | Cutting Time : (min) | 0.04258095238 |  | Calculated: | CT | CT = L/N |  |
|  | Piercing Time : (min) | 0.04 |  | Calculated: | PT | PT = X * P (X is piercing time to be captured from lookup 5, varies with respect to process & thickness) |  |
|  | Total Time : (sec) | 4.954857143 |  | Calculated: | T | T = CT + PT |  |
|  | Laser cutting machine  | 6000 W |  | Lookup from machine database |  |  |  |
|  | Machine Name : | Trulaser |  | Lookup from machine database |  |  |  |
|  | M/c Automation : | Auto |  | Lookup from machine database |  |  |  |
|  | Setup Time (min/piece) : | 0.01 |  | Calculated | Total sheet loading - unloading time / Lot size |  |  |
|  | Sheet loading time (min) | 10 |  | Calculated: | (Lot size / parts per sheet) * value from lookup table 2 i.e material handeling table. Value to be selected based on sheet weight |  |  |
|  | Recommend (T) : |  |  | To be removed |  |  |  |
|  | Cycle Time (Sec) : |  |  | To be removed |  |  |  |
|  | # of Direct Labors : | 0.5 |  | Lookup from machine database |  |  |  |
|  | # of Skilled Labors : | 0 |  | Hidden field in the UI. Look up value from the machine database.; if no value in machine database default value is 1 |  |  |  |
| Cost Drivers : | Direct Labor Rate /hr | 30 |  | Lookingup Value from the country table |  |  |  |
|  | Skilled Labor Rate /hr | 45 |  | Lookingup Value from the country table |  |  |  |
|  | QA Inspector Rate /hr: | 50 |  |  |  |  |  |
|  | Sampling Rate (%) | 0.01 |  | Look up the sampling plan table based on lot size. |  |  |  |
|  | Inspection time (min) : | 0.5 |  | default: Part complexicity from part information section: Low 5; medium 10; high: 20 |  |  |  |
|  | Yield (%) : | 0.98 |  | Default: 98% user can change the value |  |  |  |
|  | Machine hour Rate ($) : | 30 |  | Lookup from machine database |  |  |  |
|  | Machine Cost ($) : | 0.04129047619 |  | Calculated: | (Machine hour rate / 60 ) x Cycle time |  | Formula changed  |
|  | Setup Cost ($) : | 0.0075 |  | Calculated: | ((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time) |  | Formula changed  |
|  | Labor Cost ($) : | 0.0206452381 |  | Calculated: | (Direct labor rate / 60)* No. of direct labor * cycle time) |  | Formula changed  |
|  | Inspection Cost ($) : | 0.004166666667 |  | Calculated: | (((QA inspector rate / 60) * Inspection Time)*(Sampling% * Lot size)) / Lot size |  | Formula changed  |
|  | Yield Cost ($) | 0.002020863162 |  | Calculated: | ( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection))) |  | Formula changed  |
|  | Net Process cost ($) : | 0.07562324411 |  | Calculated: | Sum ( machine + setup + labor + inspection + yiled) |  |  |
| Manufacturing 2 : | Process Type : | Bending |  | Select dropdown |  |  |  |
|  | Ultimate Tensile Strength Of Material : (Mpa) | 440 |  | Lookup material table |  | UTS | Can be captured from Material database |
|  | Bending line length : (mm) | 2200 |  | To be captured from part drawing /  User Input |  | B | Bending length |
|  | Shoulder width : (mm) | 15 |  | To be captured from part drawing /  User Input |  | L | bend shoulder length (bend start point to finish) |
|  | Bending coeffecient : | 1.33 |  | Constant |  | C | Coeffecient |
|  | Theoretical Force : (Ton) | 34.99667006 |  | Calculated | ((Sheet thickness ^2 * bending length * UTS * coefficient)/ bend shoulder length ) / 9810 | F  | F = ((T^2*B*UTS*C)/L)/9810 |
|  | No. Of Bends: Count | 1 |  | To be captured from part drawing /  User Input |  |  |  |
|  | Total Tonnage Requird: (Ton) | 34.99667006 |  | Calculated | Theoretical force * no. of bends |  |  |
|  | Recommended Force : (Ton) | 43.74583758 |  | Calculated | Theoretical force * 1.25 | F Actual | F Actual = F * 1.25  |
|  | Selected Tonnage (T) : | 80T |  | Lookup from machine database |  |  |  |
|  | Machine Name : | 80T T Press Brake |  | Lookup from machine database |  |  |  |
|  | M/c Automation : | Manual |  | Lookup from machine database |  |  |  |
|  | Recommend (T) : |  |  | To be removed |  |  | Shifted on top for better calculation flow |
|  | Cycle Time (sec) : | 7 |  | If machine is manual, Stroke Time = Lookup from table 4 + (Sheet loading/unloading time) |  |  | Input from machine spec |
|  | Setup Time (min/piece) : | 0.01 |  | Calculated | Tool loading time / Lot size |  | Formula changed  |
|  | Total tool loading time (min) | 10 |  | Lookup from table 3B |  |  |  |
|  | Sheet loading/Unloading time (min) | 0.08333333333 |  | Lookup from table 2 |  |  |  |
| Cost Drivers : | # Direct Labors : | 1 |  | Lookup from machine database |  |  |  |
|  | # of Skilled Labors : | 0 |  | Hidden field in the UI. Look up value from the machine database.; if no value in machine database default value is 1 |  |  |  |
|  | Direct Labor Rate /hr | 30 |  | Lookingup Value from the country table |  |  |  |
|  | Skilled Labor Rate /hr | 45 |  | Lookingup Value from the country table |  |  |  |
|  | QA Inspector Rate /hr: | 50 |  |  |  |  |  |
|  | Sampling Rate (%) | 0.01 |  | Look up the sampling plan table based on lot size. |  |  |  |
|  | Inspection time (min) : | 0.5 |  | default: Part complexicity from part information section: Low 5; medium 10; high: 20 |  |  |  |
|  | Yield (Net Good Parts) (%) : | 0.98 |  | Default: 98% user can change the value |  |  |  |
|  | Machine hour Rate ($) : | 15 |  | Lookup from machine database |  |  |  |
|  | Machine Cost ($) : | 0.02916666667 |  | Calculated: | (Machine hour rate / 60 ) x Cycle time |  | Formula changed  |
|  | Setup Cost ($) : | 0.0075 |  | Calculated: | ((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time) |  | Formula changed  |
|  | Labor Cost ($) : | 0.06862745098 |  | Calculated: | (Direct labor rate / 60)* No. of direct labor * cycle time) |  | Formula changed  |
|  | Inspection Cost ($) : | 0.004166666667 |  | Calculated: | (((QA inspector rate / 60) * Inspection Time)*(Sampling% * Lot size)) / Lot size |  | Formula changed  |
|  | Yield Cost (Rejected Parts Scrap Rate) ($) | 0.002738031229 |  | Calculated: | ( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection))) |  | Formula changed  |
|  | Net Process cost ($) : | 0.1121988155 |  | Calculated: | Sum ( machine + setup + labor + inspection + yiled) |  |  |

## Lookup 1 - Stroke Rate (Auto)

| Col1 | Col2 | Col3 | Col4 | Col5 |
| --- | --- | --- | --- | --- |
| Lookup Table - 1 Automatic Machines |  |  |  |  |
|  | Tier |  |  | Note: |
| Tonnage | Simple | Inter | Complex | 1: This is suggested for an automated setup |
| 10 | 0.8 | 0.64 | 0.56 | 2: The factors in the table will be multiplied with actual machine stroke rate |
| 20 | 0.79 | 0.632 | 0.553 |  |
| 30 | 0.78 | 0.624 | 0.546 |  |
| 50 | 0.77 | 0.616 | 0.539 |  |
| 80 | 0.76 | 0.608 | 0.532 |  |
| 100 | 0.75 | 0.6 | 0.525 |  |
| 150 | 0.74 | 0.592 | 0.518 |  |
| 200 | 0.73 | 0.584 | 0.511 |  |
| 250 | 0.72 | 0.576 | 0.504 |  |
| 300 | 0.71 | 0.568 | 0.497 |  |
| 350 | 0.7 | 0.56 | 0.49 |  |
| 400 | 0.69 | 0.552 | 0.483 |  |
| 500 | 0.68 | 0.544 | 0.476 |  |
| 800 | 0.67 | 0.536 | 0.469 |  |
| 1000 | 0.66 | 0.528 | 0.462 |  |
| 1500 | 0.65 | 0.52 | 0.455 |  |
| 2000 | 0.64 | 0.512 | 0.448 |  |

## (Lookup-2) Handling

| Col1 | Col2 | Col3 |
| --- | --- | --- |
| Lookup Tabel 2 - Handling Time Assumptions |  |  |
| # | Weight in Kg | Handling Time in min |
| 1 | 2.5 | 0.08333333333333333 |
| 2 | 10 | 0.16666666666666666 |
| 3 | 20 | 0.25 |
| 4 | 30 | 0.3333333333333333 |
| 5 | 40 | 0.5833333333333334 |
| 6 | 65 | 0.75 |
| 7 | 95 | 0.8333333333333334 |
| 8 | 130 | 0.9166666666666666 |
| 9 | 165 | 1 |
| 10 | 200 | 1.0833333333333333 |
| 11 | 250 | 1.25 |
| 12 | 300 | 1.3333333333333333 |
| 13 | 350 | 1.4166666666666667 |
| 14 | 400 | 1.5833333333333333 |
| 15 | 450 | 1.75 |
| 16 | 500 | 2.625 |
| 17 | 750 | 3.15 |
| 18 | 1000 | 20 |
| 19 | 2000 | 20 |
| 20 | 3000 | 20 |
| 21 | 4000 | 25 |
| 22 | 5000 | 25 |

## Tool Setup (Lookup 3)

| Col1 | Col2 | Col3 | Col4 |
| --- | --- | --- | --- |
| Look up 3A: Press Machine Tool Loading Time |  | Look up 3B: Press Brake Tool Loading Time |  |
| Tonnage | Tool Loading time (min) | Tool Length | Tool Loading time (min) |
| 10 | 30 | 100 | 10 |
| 20 | 30 | 200 | 10 |
| 30 | 30 | 300 | 15 |
| 50 | 30 | 400 | 15 |
| 80 | 30 | 500 | 15 |
| 100 | 45 |  |  |
| 150 | 45 |  |  |
| 200 | 45 |  |  |
| 250 | 45 |  |  |
| 300 | 45 |  |  |
| 350 | 45 |  |  |
| 400 | 45 |  |  |
| 500 | 45 |  |  |
| 800 | 45 |  |  |
| 1000 | 60 |  |  |
| 1500 | 60 |  |  |
| 2000 | 60 |  |  |
| 2500 | 60 |  |  |
| 3000 | 60 |  |  |
| 3500 | 60 |  |  |
| 4000 | 60 |  |  |

## Stroke Rate Manual (Lookup 4)

| Col1 | Col2 | Col3 | Col4 | Col5 | Col6 | Col7 | Col8 | Col9 | Col10 | Col11 | Col12 | Col13 | Col14 | Col15 | Col16 | Col17 | Col18 | Col19 | Col20 | Col21 | Col22 | Col23 | Col24 | Col25 | Col26 | Col27 | Col28 | Col29 | Col30 | Col31 | Col32 | Col33 | Col34 | Col35 | Col36 | Col37 | Col38 | Col39 | Col40 | Col41 | Col42 | Col43 | Col44 | Col45 | Col46 | Col47 | Col48 | Col49 | Col50 | Col51 | Col52 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  | Look Up Table 4: Time Per Stroke For Manual Process |  |  |  |  |  | Values are in sec |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  | Tonnage |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Sheet Thickness | Part Complexity - Simple |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | Part Complexity - Inter |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | Part Complexity - Complex |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
|  | 10 | 20 | 30 | 50 | 80 | 100 | 150 | 200 | 250 | 300 | 350 | 400 | 500 | 800 | 1000 | 1500 | 2000 | 10 | 20 | 30 | 50 | 80 | 100 | 150 | 200 | 250 | 300 | 350 | 400 | 500 | 800 | 1000 | 1500 | 2000 | 10 | 20 | 30 | 50 | 80 | 100 | 150 | 200 | 250 | 300 | 350 | 400 | 500 | 800 | 1000 | 1500 | 2000 |
| 1 | 1 | 1.0526315789473684 | 1.0909090909090908 | 1.1320754716981132 | 1.1764705882352942 | 1.2244897959183674 | 1.2765957446808511 | 1.3333333333333333 | 1.3953488372093024 | 1.4634146341463414 | 1.5384615384615385 | 1.5789473684210527 | 1.6216216216216217 | 1.6666666666666667 | 1.7142857142857142 | 1.7647058823529411 | 1.8181818181818181 | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | 1.785714285714286 | 2.0689655172413794 | 2.4 | 2.727272727272727 | 3.1578947368421053 | 3.5294117647058822 | 4 | 4.615384615384615 | 5 | 5.454545454545454 | 6 | 6.666666666666667 | 7.5 | 8.571428571428571 | 10 | 10 | 10 |
| 2 | 1.1111111111111112 | 1.1538461538461537 | 1.2 | 1.25 | 1.3043478260869565 | 1.3636363636363635 | 1.4285714285714286 | 1.5 | 1.5789473684210527 | 1.6216216216216217 | 1.6666666666666667 | 1.7142857142857142 | 1.7647058823529411 | 1.8181818181818181 | 1.875 | 1.935483870967742 | 2 | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | 2.2222222222222223 | 2.608695652173913 | 3 | 3.5294117647058822 | 4 | 4.615384615384615 | 5 | 5.454545454545454 | 6 | 6.666666666666667 | 7.5 | 8.571428571428571 | 10 | 10 | 10 | 10 | 10 |
| 3 | 1.2244897959183674 | 1.2765957446808511 | 1.3333333333333333 | 1.3953488372093024 | 1.4634146341463414 | 1.5384615384615385 | 1.5789473684210527 | 1.6216216216216217 | 1.6666666666666667 | 1.7142857142857142 | 1.7647058823529411 | 1.8181818181818181 | 1.875 | 1.935483870967742 | 2 | 2.0689655172413794 | 2.142857142857143 | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | 2.727272727272727 | 3.1578947368421053 | 3.5294117647058822 | 4 | 4.615384615384615 | 5 | 5.454545454545454 | 6 | 6.666666666666667 | 7.5 | 8.571428571428571 | 10 | 10 | 10 | 10 | 10 | 10 |
| 4 | 1.3333333333333333 | 1.3953488372093024 | 1.4634146341463414 | 1.5384615384615385 | 1.5789473684210527 | 1.6216216216216217 | 1.6666666666666667 | 1.7142857142857142 | 1.7647058823529411 | 1.8181818181818181 | 1.875 | 1.935483870967742 | 2 | 2.0689655172413794 | 2.142857142857143 | 2.2222222222222223 | 2.3076923076923075 | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | 3.3333333333333335 | 3.75 | 4.285714285714286 | 5 | 5.454545454545454 | 6 | 6.666666666666667 | 7.5 | 8.571428571428571 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| 5 | 1.4634146341463414 | 1.5384615384615385 | 1.5789473684210527 | 1.6216216216216217 | 1.6666666666666667 | 1.7142857142857142 | 1.7647058823529411 | 1.8181818181818181 | 1.875 | 1.935483870967742 | 2 | 2.0689655172413794 | 2.142857142857143 | 2.2222222222222223 | 2.3076923076923075 | 2.4 | 2.5 | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | 4 | 4.615384615384615 | 5 | 5.454545454545454 | 6 | 6.666666666666667 | 7.5 | 8.571428571428571 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| 6 | 1.6216216216216217 | 1.6666666666666667 | 1.7142857142857142 | 1.7647058823529411 | 1.8181818181818181 | 1.875 | 1.935483870967742 | 2 | 2.0689655172413794 | 2.142857142857143 | 2.2222222222222223 | 2.3076923076923075 | 2.4 | 2.5 | 2.608695652173913 | 2.727272727272727 | 2.857142857142857 | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | 5 | 5.454545454545454 | 6 | 6.666666666666667 | 7.5 | 8.571428571428571 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| 8 | 1.7647058823529411 | 1.8181818181818181 | 1.875 | 1.935483870967742 | 2 | 2.0689655172413794 | 2.142857142857143 | 2.2222222222222223 | 2.3076923076923075 | 2.4 | 2.5 | 2.608695652173913 | 2.727272727272727 | 2.857142857142857 | 3 | 3.1578947368421053 | 3.1578947368421053 | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | 6 | 6.666666666666667 | 7.5 | 8.571428571428571 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| 10 | 1.935483870967742 | 2 | 2.0689655172413794 | 2.142857142857143 | 2.2222222222222223 | 2.3076923076923075 | 2.4 | 2.5 | 2.608695652173913 | 2.727272727272727 | 2.857142857142857 | 3 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | 7.5 | 8.571428571428571 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| 12 | 2.142857142857143 | 2.2222222222222223 | 2.3076923076923075 | 2.4 | 2.5 | 2.608695652173913 | 2.727272727272727 | 2.857142857142857 | 3 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | 8.571428571428571 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| 14 | 2.3076923076923075 | 2.4 | 2.5 | 2.608695652173913 | 2.727272727272727 | 2.857142857142857 | 3 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| 16 | 2.5 | 2.608695652173913 | 2.727272727272727 | 2.857142857142857 | 3 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | 3.1578947368421053 | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | #ERROR! | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 |

## Laser Cutting (Lookup 5)

| Col1 | Col2 | Col3 | Col4 | Col5 | Col6 | Col7 | Col8 | Col9 | Col10 | Col11 | Col12 | Col13 | Col14 | Col15 | Col16 | Col17 | Col18 | Col19 | Col20 | Col21 | Col22 | Col23 | Col24 | Col25 | Col26 | Col27 | Col28 | Col29 | Col30 | Col31 | Col32 | Col33 | Col34 | Col35 | Col36 | Col37 | Col38 | Col39 | Col40 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Lookup Table 5 - Laser Cutting Data |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| Material | Thickness (mm) | Kerf (mm) | Cutting Speed(m/min) |  |  |  |  |  |  |  |  |  |  | Cutting Time(%) | Moving Time(%) | Piercing time (%) | Speed coefficient  | Cutting Speed Actual(m/min) |  |  |  |  |  |  |  |  |  |  | Piercing Time (min) |  |  |  |  |  |  |  |  |  |  |
|  |  |  | Laser Power(W) |  |  |  |  |  |  |  |  |  |  |  |  |  |  | Laser Power(W) |  |  |  |  |  |  |  |  |  |  | Laser Power(W) |  |  |  |  |  |  |  |  |  |  |
|  |  |  | 500 | 1000 | 1500 | 2000 | 3000 | 4000 | 6000 | 8000 | 10000 | 12000 | 15000 |  |  |  |  | 500 | 1000 | 1500 | 2000 | 3000 | 4000 | 6000 | 8000 | 10000 | 12000 | 15000 | 500 | 1000 | 1500 | 2000 | 3000 | 4000 | 6000 | 8000 | 10000 | 12000 | 15000 |
| Carbon Steel | 1 | 0.5 | 9 | 10 | 26 | 30 | 40 | 42 | 45 | 45 | 45 | 60 | 60 | 0.6 | 0.35 | 0.05 | 0.7 | 3.78 | 4.2 | 10.92 | 12.6 | 16.8 | 17.64 | 18.9 | 18.9 | 18.9 | 25.2 | 25.2 | 0.002222222222 | 0.002 | 0.0007692307692 | 0.0006666666667 | 0.0005 | 0.0004761904762 | 0.0004444444444 | 0.0004444444444 | 0.0004444444444 | 0.0003333333333 | 0.0003333333333 |
| Carbon Steel | 2 | 0.575 | 4.5 | 6.5 | 7 | 9 | 20 | 15 | 25 | 35 | 40 | 45 | 48 | 0.65 | 0.25 | 0.1 | 0.7 | 2.0475 | 2.9575 | 3.185 | 4.095 | 9.1 | 6.825 | 11.375 | 15.925 | 18.2 | 20.475 | 21.84 | 0.004444444444 | 0.003076923077 | 0.002857142857 | 0.002222222222 | 0.001 | 0.001333333333 | 0.0008 | 0.0005714285714 | 0.0005 | 0.0004444444444 | 0.0004166666667 |
| Carbon Steel | 3 | 0.66125 | 3 | 3 | 4 | 4.8 | 5 | 5.5 | 6.5 | 7 | 30 | 35 | 38 | 0.65 | 0.25 | 0.1 | 0.7 | 1.365 | 1.365 | 1.82 | 2.184 | 2.275 | 2.5025 | 2.9575 | 3.185 | 13.65 | 15.925 | 17.29 | 0.006666666667 | 0.006666666667 | 0.005 | 0.004166666667 | 0.004 | 0.003636363636 | 0.003076923077 | 0.002857142857 | 0.0006666666667 | 0.0005714285714 | 0.0005263157895 |
| Carbon Steel | 4 | 0.7604375 | 1.5 | 2.4 | 3 | 3.5 | 4.2 | 4.8 | 5 | 5.5 | 20 | 26 | 29 | 0.65 | 0.2 | 0.15 | 0.8 | 0.78 | 1.248 | 1.56 | 1.82 | 2.184 | 2.496 | 2.6 | 2.86 | 10.4 | 13.52 | 15.08 | 0.01333333333 | 0.008333333333 | 0.006666666667 | 0.005714285714 | 0.004761904762 | 0.004166666667 | 0.004 | 0.003636363636 | 0.001 | 0.0007692307692 | 0.0006896551724 |
| Carbon Steel | 5 | 0.874503125 | 1.1 | 2 | 2.5 | 3 | 3.5 | 3.6 | 4.2 | 4.5 | 15 | 18 | 23 | 0.65 | 0.2 | 0.15 | 0.8 | 0.572 | 1.04 | 1.3 | 1.56 | 1.82 | 1.872 | 2.184 | 2.34 | 7.8 | 9.36 | 11.96 | 0.01818181818 | 0.01 | 0.008 | 0.006666666667 | 0.005714285714 | 0.005555555556 | 0.004761904762 | 0.004444444444 | 0.001333333333 | 0.001111111111 | 0.0008695652174 |
| Carbon Steel | 6 | 1.005678594 | 0.9 | 1.6 | 2.2 | 2.6 | 3.2 | 3.4 | 4 | 4.2 | 12 | 13 | 19 | 0.65 | 0.2 | 0.15 | 0.8 | 0.468 | 0.832 | 1.144 | 1.352 | 1.664 | 1.768 | 2.08 | 2.184 | 6.24 | 6.76 | 9.88 | 0.02222222222 | 0.0125 | 0.009090909091 | 0.007692307692 | 0.00625 | 0.005882352941 | 0.005 | 0.004761904762 | 0.001666666667 | 0.001538461538 | 0.001052631579 |
| Carbon Steel | 8 | 1.156530383 |  | 1.2 | 1.4 | 1.8 | 2.6 | 3 | 3.2 | 3.5 | 8 | 10 | 12 | 0.7 | 0.15 | 0.15 | 0.8 | 0 | 0.672 | 0.784 | 1.008 | 1.456 | 1.68 | 1.792 | 1.96 | 4.48 | 5.6 | 6.72 | 0 | 0.01666666667 | 0.01428571429 | 0.01111111111 | 0.007692307692 | 0.006666666667 | 0.00625 | 0.005714285714 | 0.0025 | 0.002 | 0.001666666667 |
| Carbon Steel | 10 | 1.33000994 |  | 1 | 1.1 | 1.3 | 2 | 2 | 2.5 | 2.7 | 2.7 | 2.7 | 2.3 | 0.7 | 0.1 | 0.2 | 0.8 | 0 | 0.56 | 0.616 | 0.728 | 1.12 | 1.12 | 1.4 | 1.512 | 1.512 | 1.512 | 1.288 | 0 | 0.02 | 0.01818181818 | 0.01538461538 | 0.01 | 0.01 | 0.008 | 0.007407407407 | 0.007407407407 | 0.007407407407 | 0.008695652174 |
| Carbon Steel | 12 | 1.529511431 |  | 0.8 | 1 | 1.2 | 1.6 | 1.8 | 2 | 2.1 | 2.1 | 2.1 | 2 | 0.7 | 0.1 | 0.2 | 0.9 | 0 | 0.504 | 0.63 | 0.756 | 1.008 | 1.134 | 1.26 | 1.323 | 1.323 | 1.323 | 1.26 | 0 | 0.025 | 0.02 | 0.01666666667 | 0.0125 | 0.01111111111 | 0.01 | 0.009523809524 | 0.009523809524 | 0.009523809524 | 0.01 |
| Carbon Steel | 14 | 1.758938146 |  |  | 0.7 | 0.8 | 1.4 | 1.2 | 1.8 | 1.9 | 1.9 | 1.9 | 1.8 | 0.7 | 0.1 | 0.2 | 0.9 | 0 | 0 | 0.441 | 0.504 | 0.882 | 0.756 | 1.134 | 1.197 | 1.197 | 1.197 | 1.134 | 0 | 0 | 0.02857142857 | 0.025 | 0.01428571429 | 0.01666666667 | 0.01111111111 | 0.01052631579 | 0.01052631579 | 0.01052631579 | 0.01111111111 |
| Carbon Steel | 16 | 2.022778868 |  |  |  | 0.7 | 1 | 1 | 1.5 | 1.7 | 1.7 | 1.7 | 1.6 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0.441 | 0.63 | 0.63 | 0.945 | 1.071 | 1.071 | 1.071 | 1.008 | 0 | 0 | 0 | 0.02857142857 | 0.02 | 0.02 | 0.01333333333 | 0.01176470588 | 0.01176470588 | 0.01176470588 | 0.0125 |
| Carbon Steel | 18 | 2.326195698 |  |  |  | 0.6 | 0.8 | 0.9 | 0.9 | 0.9 | 0.9 | 1.5 | 1.5 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0.378 | 0.504 | 0.567 | 0.567 | 0.567 | 0.567 | 0.945 | 0.945 | 0 | 0 | 0 | 0.03333333333 | 0.025 | 0.02222222222 | 0.02222222222 | 0.02222222222 | 0.02222222222 | 0.01333333333 | 0.01333333333 |
| Carbon Steel | 20 | 2.675125053 |  |  |  |  | 0.8 | 0.9 | 0.9 | 0.9 | 0.9 | 1.4 | 1.4 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0.504 | 0.567 | 0.567 | 0.567 | 0.567 | 0.882 | 0.882 | 0 | 0 | 0 | 0 | 0.025 | 0.02222222222 | 0.02222222222 | 0.02222222222 | 0.02222222222 | 0.01428571429 | 0.01428571429 |
| Carbon Steel | 22 | 3.076393811 |  |  |  |  | 0.6 | 0.8 | 0.8 | 0.8 | 0.8 | 1.2 | 1.3 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0.378 | 0.504 | 0.504 | 0.504 | 0.504 | 0.756 | 0.819 | 0 | 0 | 0 | 0 | 0.03333333333 | 0.025 | 0.025 | 0.025 | 0.025 | 0.01666666667 | 0.01538461538 |
| Carbon Steel | 25 | 3.537852882 |  |  |  |  |  | 0.5 | 0.5 | 0.7 | 0.7 | 1 | 1.3 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0.315 | 0.315 | 0.441 | 0.441 | 0.63 | 0.819 | 0 | 0 | 0 | 0 | 0 | 0.04 | 0.04 | 0.02857142857 | 0.02857142857 | 0.02 | 0.01538461538 |
| Carbon Steel | 30 | 4.068530815 |  |  |  |  |  |  |  |  | 0.35 | 0.8 | 0.85 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2205 | 0.504 | 0.5355 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.05714285714 | 0.025 | 0.02352941176 |
| Carbon Steel | 40 | 4.678810437 |  |  |  |  |  |  |  |  | 0.2 | 0.3 | 0.35 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.126 | 0.189 | 0.2205 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.1 | 0.06666666667 | 0.05714285714 |
| Carbon Steel | 50 | 5.380632002 |  |  |  |  |  |  |  |  |  |  | 0.25 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.1575 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.08 |
| Carbon Steel | 60 | 6.187726803 |  |  |  |  |  |  |  |  |  |  | 0.2 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.126 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.1 |
| Stainless Steel | 1 | 0.5 | 13 | 25 | 27 | 30 | 35 | 40 | 55 | 66 | 75 | 85 | 60 | 0.6 | 0.35 | 0.05 | 0.7 | 5.46 | 10.5 | 11.34 | 12.6 | 14.7 | 16.8 | 23.1 | 27.72 | 31.5 | 35.7 | 25.2 | 0.001538461538 | 0.0008 | 0.0007407407407 | 0.0006666666667 | 0.0005714285714 | 0.0005 | 0.0003636363636 | 0.000303030303 | 0.0002666666667 | 0.0002352941176 | 0.0003333333333 |
| Stainless Steel | 2 | 0.575 | 5 | 12 | 13 | 14 | 24 | 28 | 35 | 42 | 55 | 66 | 50 | 0.65 | 0.25 | 0.1 | 0.7 | 2.275 | 5.46 | 5.915 | 6.37 | 10.92 | 12.74 | 15.925 | 19.11 | 25.025 | 30.03 | 22.75 | 0.004 | 0.001666666667 | 0.001538461538 | 0.001428571429 | 0.0008333333333 | 0.0007142857143 | 0.0005714285714 | 0.0004761904762 | 0.0003636363636 | 0.000303030303 | 0.0004 |
| Stainless Steel | 3 | 0.66125 | 0.8 | 2.5 | 5 | 6.5 | 10 | 15 | 24 | 30 | 38 | 45 | 38 | 0.65 | 0.25 | 0.1 | 0.7 | 0.364 | 1.1375 | 2.275 | 2.9575 | 4.55 | 6.825 | 10.92 | 13.65 | 17.29 | 20.475 | 17.29 | 0.025 | 0.008 | 0.004 | 0.003076923077 | 0.002 | 0.001333333333 | 0.0008333333333 | 0.0006666666667 | 0.0005263157895 | 0.0004444444444 | 0.0005263157895 |
| Stainless Steel | 4 | 0.7604375 |  | 1.3 | 2.4 | 4.5 | 6.5 | 8 | 16 | 21 | 25 | 32 | 29 | 0.65 | 0.2 | 0.15 | 0.8 | 0 | 0.676 | 1.248 | 2.34 | 3.38 | 4.16 | 8.32 | 10.92 | 13 | 16.64 | 15.08 | 0 | 0.01538461538 | 0.008333333333 | 0.004444444444 | 0.003076923077 | 0.0025 | 0.00125 | 0.0009523809524 | 0.0008 | 0.000625 | 0.0006896551724 |
| Stainless Steel | 5 | 0.874503125 |  | 0.7 | 1.3 | 2.5 | 5 | 5.5 | 12 | 17 | 22 | 25 | 18 | 0.65 | 0.2 | 0.15 | 0.8 | 0 | 0.364 | 0.676 | 1.3 | 2.6 | 2.86 | 6.24 | 8.84 | 11.44 | 13 | 9.36 | 0 | 0.02857142857 | 0.01538461538 | 0.008 | 0.004 | 0.003636363636 | 0.001666666667 | 0.001176470588 | 0.0009090909091 | 0.0008 | 0.001111111111 |
| Stainless Steel | 6 | 1.005678594 |  |  | 1 | 2 | 4 | 4.5 | 9 | 14 | 15 | 21 | 12 | 0.65 | 0.2 | 0.15 | 0.8 | 0 | 0 | 0.52 | 1.04 | 2.08 | 2.34 | 4.68 | 7.28 | 7.8 | 10.92 | 6.24 | 0 | 0 | 0.02 | 0.01 | 0.005 | 0.004444444444 | 0.002222222222 | 0.001428571429 | 0.001333333333 | 0.0009523809524 | 0.001666666667 |
| Stainless Steel | 8 | 1.156530383 |  |  |  | 1 | 2 | 3 | 5 | 8 | 12 | 16 | 9 | 0.7 | 0.15 | 0.15 | 0.8 | 0 | 0 | 0 | 0.56 | 1.12 | 1.68 | 2.8 | 4.48 | 6.72 | 8.96 | 5.04 | 0 | 0 | 0 | 0.02 | 0.01 | 0.006666666667 | 0.004 | 0.0025 | 0.001666666667 | 0.00125 | 0.002222222222 |
| Stainless Steel | 10 | 1.33000994 |  |  |  |  | 0.8 | 1.2 | 2.5 | 5 | 8 | 12 | 7 | 0.7 | 0.1 | 0.2 | 0.8 | 0 | 0 | 0 | 0 | 0.448 | 0.672 | 1.4 | 2.8 | 4.48 | 6.72 | 3.92 | 0 | 0 | 0 | 0 | 0.025 | 0.01666666667 | 0.008 | 0.004 | 0.0025 | 0.001666666667 | 0.002857142857 |
| Stainless Steel | 12 | 1.529511431 |  |  |  |  | 0.6 | 0.8 | 1.8 | 3 | 5 | 8 | 7 | 0.7 | 0.1 | 0.2 | 0.9 | 0 | 0 | 0 | 0 | 0.378 | 0.504 | 1.134 | 1.89 | 3.15 | 5.04 | 4.41 | 0 | 0 | 0 | 0 | 0.03333333333 | 0.025 | 0.01111111111 | 0.006666666667 | 0.004 | 0.0025 | 0.002857142857 |
| Stainless Steel | 14 | 1.758938146 |  |  |  |  |  | 0.6 | 0.8 | 1.8 | 3 | 5 | 5.05 | 0.7 | 0.1 | 0.2 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0.378 | 0.504 | 1.134 | 1.89 | 3.15 | 3.1815 | 0 | 0 | 0 | 0 | 0 | 0.03333333333 | 0.025 | 0.01111111111 | 0.006666666667 | 0.004 | 0.00396039604 |
| Stainless Steel | 16 | 2.022778868 |  |  |  |  |  |  | 0.6 | 1.5 | 2 | 2.3 | 3.1 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0.378 | 0.945 | 1.26 | 1.449 | 1.953 | 0 | 0 | 0 | 0 | 0 | 0 | 0.03333333333 | 0.01333333333 | 0.01 | 0.008695652174 | 0.006451612903 |
| Stainless Steel | 18 | 2.326195698 |  |  |  |  |  |  | 0.6 | 1.15 | 1.9 | 2.65 | 2.6 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0.378 | 0.7245 | 1.197 | 1.6695 | 1.638 | 0 | 0 | 0 | 0 | 0 | 0 | 0.03333333333 | 0.01739130435 | 0.01052631579 | 0.007547169811 | 0.007692307692 |
| Stainless Steel | 20 | 2.675125053 |  |  |  |  |  |  | 0.6 | 0.8 | 1.8 | 3 | 2.1 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0.378 | 0.504 | 1.134 | 1.89 | 1.323 | 0 | 0 | 0 | 0 | 0 | 0 | 0.03333333333 | 0.025 | 0.01111111111 | 0.006666666667 | 0.009523809524 |
| Stainless Steel | 22 | 3.076393811 |  |  |  |  |  |  |  | 0.6 | 0.9 | 1.2 | 1.7 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.378 | 0.567 | 0.756 | 1.071 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.03333333333 | 0.02222222222 | 0.01666666667 | 0.01176470588 |
| Stainless Steel | 25 | 3.537852882 |  |  |  |  |  |  |  | 0.6 | 0.7 | 0.95 | 1.4 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.378 | 0.441 | 0.5985 | 0.882 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.03333333333 | 0.02857142857 | 0.02105263158 | 0.01428571429 |
| Stainless Steel | 30 | 4.068530815 |  |  |  |  |  |  |  | 0.5 | 0.6 | 0.7 | 1 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.315 | 0.378 | 0.441 | 0.63 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.04 | 0.03333333333 | 0.02857142857 | 0.02 |
| Stainless Steel | 35 | 4.678810437 |  |  |  |  |  |  |  |  | 0.55 | 0.6499999999999999 | 0.8 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.3465 | 0.4095 | 0.504 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.03636363636 | 0.03076923077 | 0.025 |
| Stainless Steel | 40 | 5.380632002 |  |  |  |  |  |  |  |  | 0.5 | 0.6 | 0.5 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.315 | 0.378 | 0.315 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.04 | 0.03333333333 | 0.04 |
| Stainless Steel | 45 | 6.187726803 |  |  |  |  |  |  |  |  |  |  | 0.4 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.252 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.05 |
| Aluminium | 1 | 0.3 | 5.5 | 10 | 20 | 25 | 38 | 40 | 55 | 65 | 75 | 85 | 52 | 0.6 | 0.35 | 0.05 | 0.7 | 2.31 | 4.2 | 8.4 | 10.5 | 15.96 | 16.8 | 23.1 | 27.3 | 31.5 | 35.7 | 21.84 | 0.003636363636 | 0.002 | 0.001 | 0.0008 | 0.0005263157895 | 0.0005 | 0.0003636363636 | 0.0003076923077 | 0.0002666666667 | 0.0002352941176 | 0.0003846153846 |
| Aluminium | 2 | 0.345 | 1.5 | 5 | 7 | 10 | 18 | 25 | 30 | 38 | 45 | 50 | 38 | 0.65 | 0.25 | 0.1 | 0.7 | 0.6825 | 2.275 | 3.185 | 4.55 | 8.19 | 11.375 | 13.65 | 17.29 | 20.475 | 22.75 | 17.29 | 0.01333333333 | 0.004 | 0.002857142857 | 0.002 | 0.001111111111 | 0.0008 | 0.0006666666667 | 0.0005263157895 | 0.0004444444444 | 0.0004 | 0.0005263157895 |
| Aluminium | 3 | 0.39675 |  | 1.5 | 4 | 6 | 8 | 13 | 18 | 30 | 35 | 40 | 27 | 0.65 | 0.25 | 0.1 | 0.7 | 0 | 0.6825 | 1.82 | 2.73 | 3.64 | 5.915 | 8.19 | 13.65 | 15.925 | 18.2 | 12.285 | 0 | 0.01333333333 | 0.005 | 0.003333333333 | 0.0025 | 0.001538461538 | 0.001111111111 | 0.0006666666667 | 0.0005714285714 | 0.0005 | 0.0007407407407 |
| Aluminium | 4 | 0.4562625 |  |  | 1.5 | 3 | 5 | 7 | 12 | 18 | 30 | 38 | 22 | 0.65 | 0.2 | 0.15 | 0.8 | 0 | 0 | 0.78 | 1.56 | 2.6 | 3.64 | 6.24 | 9.36 | 15.6 | 19.76 | 11.44 | 0 | 0 | 0.01333333333 | 0.006666666667 | 0.004 | 0.002857142857 | 0.001666666667 | 0.001111111111 | 0.0006666666667 | 0.0005263157895 | 0.0009090909091 |
| Aluminium | 5 | 0.524701875 |  |  | 1 | 1.8 | 3.5 | 5 | 8 | 12 | 20 | 25 | 17 | 0.65 | 0.2 | 0.15 | 0.8 | 0 | 0 | 0.52 | 0.936 | 1.82 | 2.6 | 4.16 | 6.24 | 10.4 | 13 | 8.84 | 0 | 0 | 0.02 | 0.01111111111 | 0.005714285714 | 0.004 | 0.0025 | 0.001666666667 | 0.001 | 0.0008 | 0.001176470588 |
| Aluminium | 6 | 0.6034071563 |  |  |  | 1 | 2.5 | 3.5 | 6 | 8 | 12 | 18 | 14 | 0.65 | 0.2 | 0.15 | 0.8 | 0 | 0 | 0 | 0.52 | 1.3 | 1.82 | 3.12 | 4.16 | 6.24 | 9.36 | 7.28 | 0 | 0 | 0 | 0.02 | 0.008 | 0.005714285714 | 0.003333333333 | 0.0025 | 0.001666666667 | 0.001111111111 | 0.001428571429 |
| Aluminium | 8 | 0.6939182297 |  |  |  | 0.8 | 1 | 1.6 | 3 | 6 | 8 | 12 | 9 | 0.7 | 0.15 | 0.15 | 0.8 | 0 | 0 | 0 | 0.448 | 0.56 | 0.896 | 1.68 | 3.36 | 4.48 | 6.72 | 5.04 | 0 | 0 | 0 | 0.025 | 0.02 | 0.0125 | 0.006666666667 | 0.003333333333 | 0.0025 | 0.001666666667 | 0.002222222222 |
| Aluminium | 10 | 0.7980059641 |  |  |  |  | 0.7 | 1.5 | 2 | 3 | 6 | 8 | 7 | 0.7 | 0.1 | 0.2 | 0.8 | 0 | 0 | 0 | 0 | 0.392 | 0.84 | 1.12 | 1.68 | 3.36 | 4.48 | 3.92 | 0 | 0 | 0 | 0 | 0.02857142857 | 0.01333333333 | 0.01 | 0.006666666667 | 0.003333333333 | 0.0025 | 0.002857142857 |
| Aluminium | 12 | 0.9177068588 |  |  |  |  | 0.45 | 0.6 | 1.4 | 2 | 3 | 6 | 3.5 | 0.7 | 0.1 | 0.2 | 0.9 | 0 | 0 | 0 | 0 | 0.2835 | 0.378 | 0.882 | 1.26 | 1.89 | 3.78 | 2.205 | 0 | 0 | 0 | 0 | 0.04444444444 | 0.03333333333 | 0.01428571429 | 0.01 | 0.006666666667 | 0.003333333333 | 0.005714285714 |
| Aluminium | 14 | 1.055362888 |  |  |  |  |  | 0.4 | 1.1 | 1.2 | 2.5 | 2.5 | 3 | 0.7 | 0.1 | 0.2 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0.252 | 0.693 | 0.756 | 1.575 | 1.575 | 1.89 | 0 | 0 | 0 | 0 | 0 | 0.05 | 0.01818181818 | 0.01666666667 | 0.008 | 0.008 | 0.006666666667 |
| Aluminium | 16 | 1.213667321 |  |  |  |  |  |  | 0.8 | 1.6 | 2 | 3 | 2.5 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0.504 | 1.008 | 1.26 | 1.89 | 1.575 | 0 | 0 | 0 | 0 | 0 | 0 | 0.025 | 0.0125 | 0.01 | 0.006666666667 | 0.008 |
| Aluminium | 18 | 1.395717419 |  |  |  |  |  |  | 0.75 | 1.3 | 1.8 | 2.5 | 1.85 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0.4725 | 0.819 | 1.134 | 1.575 | 1.1655 | 0 | 0 | 0 | 0 | 0 | 0 | 0.02666666667 | 0.01538461538 | 0.01111111111 | 0.008 | 0.01081081081 |
| Aluminium | 20 | 1.605075032 |  |  |  |  |  |  | 0.7 | 1 | 1.6 | 2 | 1.2 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0.441 | 0.63 | 1.008 | 1.26 | 0.756 | 0 | 0 | 0 | 0 | 0 | 0 | 0.02857142857 | 0.02 | 0.0125 | 0.01 | 0.01666666667 |
| Aluminium | 22 | 1.845836286 |  |  |  |  |  |  |  | 0.85 | 1.3 | 1.8 | 0.95 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.5355 | 0.819 | 1.134 | 0.5985 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.02352941176 | 0.01538461538 | 0.01111111111 | 0.02105263158 |
| Aluminium | 25 | 2.122711729 |  |  |  |  |  |  |  | 0.7 | 1 | 1.6 | 0.7 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.441 | 0.63 | 1.008 | 0.441 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.02857142857 | 0.02 | 0.0125 | 0.02857142857 |
| Aluminium | 30 | 2.441118489 |  |  |  |  |  |  |  |  | 0.7 | 0.5 | 0.5 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.441 | 0.315 | 0.315 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.02857142857 | 0.04 | 0.04 |
| Aluminium | 35 | 2.807286262 |  |  |  |  |  |  |  |  |  | 1 | 0.4 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.63 | 0.252 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.02 | 0.05 |
| Aluminium | 40 | 3.228379201 |  |  |  |  |  |  |  |  |  | 0.3 | 0.3 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.189 | 0.189 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.06666666667 | 0.06666666667 |
| Aluminium | 45 | 3.712636082 |  |  |  |  |  |  |  |  |  |  | 0.275 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.17325 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.07272727273 |
| Aluminium | 50 | 4.269531494 |  |  |  |  |  |  |  |  |  |  | 0.25 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.1575 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.08 |
| Aluminium | 60 | 4.909961218 |  |  |  |  |  |  |  |  |  |  |  | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Brass | 1 | 0.5 | 5.5 | 10 | 15 | 18 | 35 | 30 | 55 | 65 | 75 | 85 | 40 | 0.6 | 0.35 | 0.05 | 0.7 | 2.31 | 4.2 | 6.3 | 7.56 | 14.7 | 12.6 | 23.1 | 27.3 | 31.5 | 35.7 | 16.8 | 0.003636363636 | 0.002 | 0.001333333333 | 0.001111111111 | 0.0005714285714 | 0.0006666666667 | 0.0003636363636 | 0.0003076923077 | 0.0002666666667 | 0.0002352941176 | 0.0005 |
| Brass | 2 | 0.575 | 1 | 3.6 | 5 | 8 | 15 | 15 | 30 | 40 | 45 | 50 | 37 | 0.65 | 0.25 | 0.1 | 0.7 | 0.455 | 1.638 | 2.275 | 3.64 | 6.825 | 6.825 | 13.65 | 18.2 | 20.475 | 22.75 | 16.835 | 0.02 | 0.005555555556 | 0.004 | 0.0025 | 0.001333333333 | 0.001333333333 | 0.0006666666667 | 0.0005 | 0.0004444444444 | 0.0004 | 0.0005405405405 |
| Brass | 3 | 0.66125 |  | 1 | 2.5 | 4 | 6 | 8 | 18 | 30 | 40 | 50 | 24 | 0.65 | 0.25 | 0.1 | 0.7 | 0 | 0.455 | 1.1375 | 1.82 | 2.73 | 3.64 | 8.19 | 13.65 | 18.2 | 22.75 | 10.92 | 0 | 0.02 | 0.008 | 0.005 | 0.003333333333 | 0.0025 | 0.001111111111 | 0.0006666666667 | 0.0005 | 0.0004 | 0.0008333333333 |
| Brass | 4 | 0.7604375 |  |  | 1.6 | 2 | 5 | 5.5 | 10 | 18 | 24 | 33 | 19 | 0.65 | 0.2 | 0.15 | 0.8 | 0 | 0 | 0.832 | 1.04 | 2.6 | 2.86 | 5.2 | 9.36 | 12.48 | 17.16 | 9.88 | 0 | 0 | 0.0125 | 0.01 | 0.004 | 0.003636363636 | 0.002 | 0.001111111111 | 0.0008333333333 | 0.0006060606061 | 0.001052631579 |
| Brass | 5 | 0.874503125 |  |  | 0.7 | 1.2 | 2.2 | 3 | 6 | 9 | 15 | 24 | 16 | 0.65 | 0.2 | 0.15 | 0.8 | 0 | 0 | 0.364 | 0.624 | 1.144 | 1.56 | 3.12 | 4.68 | 7.8 | 12.48 | 8.32 | 0 | 0 | 0.02857142857 | 0.01666666667 | 0.009090909091 | 0.006666666667 | 0.003333333333 | 0.002222222222 | 0.001333333333 | 0.0008333333333 | 0.00125 |
| Brass | 6 | 1.005678594 |  |  |  | 0.7 | 1.8 | 2.5 | 4.5 | 6.5 | 9 | 15 | 11 | 0.65 | 0.2 | 0.15 | 0.8 | 0 | 0 | 0 | 0.364 | 0.936 | 1.3 | 2.34 | 3.38 | 4.68 | 7.8 | 5.72 | 0 | 0 | 0 | 0.02857142857 | 0.01111111111 | 0.008 | 0.004444444444 | 0.003076923077 | 0.002222222222 | 0.001333333333 | 0.001818181818 |
| Brass | 8 | 1.156530383 |  |  |  |  | 0.7 | 1 | 2.2 | 4 | 6.5 | 9 | 8 | 0.7 | 0.15 | 0.15 | 0.8 | 0 | 0 | 0 | 0 | 0.392 | 0.56 | 1.232 | 2.24 | 3.64 | 5.04 | 4.48 | 0 | 0 | 0 | 0 | 0.02857142857 | 0.02 | 0.009090909091 | 0.005 | 0.003076923077 | 0.002222222222 | 0.0025 |
| Brass | 10 | 1.33000994 |  |  |  |  |  | 0.4 | 1.2 | 2.2 | 4 | 6.5 | 6 | 0.7 | 0.1 | 0.2 | 0.8 | 0 | 0 | 0 | 0 | 0 | 0.224 | 0.672 | 1.232 | 2.24 | 3.64 | 3.36 | 0 | 0 | 0 | 0 | 0 | 0.05 | 0.01666666667 | 0.009090909091 | 0.005 | 0.003076923077 | 0.003333333333 |
| Brass | 12 | 1.529511431 |  |  |  |  |  |  | 0.4 | 1.5 | 2.2 | 4 | 2.2 | 0.7 | 0.1 | 0.2 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0.252 | 0.945 | 1.386 | 2.52 | 1.386 | 0 | 0 | 0 | 0 | 0 | 0 | 0.05 | 0.01333333333 | 0.009090909091 | 0.005 | 0.009090909091 |
| Brass | 14 | 1.758938146 |  |  |  |  |  |  |  | 0.6 | 0.8 | 1.5 | 1.8 | 0.7 | 0.1 | 0.2 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.378 | 0.504 | 0.945 | 1.134 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.03333333333 | 0.025 | 0.01333333333 | 0.01111111111 |
| Brass | 15 | 2.022778868 |  |  |  |  |  |  |  | 0.8 | 0.9 | 1 | 1.4 | 0.7 | 0.1 | 0.2 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.504 | 0.567 | 0.63 | 0.882 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.025 | 0.02222222222 | 0.02 | 0.01428571429 |
| Brass | 16 | 2.326195698 |  |  |  |  |  |  |  |  |  |  | 1.2999999999999998 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.819 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.01538461538 |
| Brass | 18 | 2.675125053 |  |  |  |  |  |  |  |  |  |  | 1.2 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.756 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.01666666667 |
| Brass | 20 | 3.076393811 |  |  |  |  |  |  |  |  |  |  | 0.7 | 0.7 | 0.05 | 0.25 | 0.9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.441 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.02857142857 |

## Sampling (Lookup 6)

| Col1 | Col2 | Col3 | Col4 | Col5 | Col6 | Col7 | Col8 | Col9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Lookup Table 6 - Inspection Sampling |  |  |  |  |  |  |  |  |
|  | Batch Size |  | Complexity Level |  |  | Sampling % |  |  |
|  | From | To | I | II | III | I | II | III |
|  | 2 | 8 | 2 | 2 | 3 | 0.25 | 0.25 | 0.375 |
|  | 9 | 15 | 2 | 3 | 5 | 0.1333333333 | 0.2 | 0.3333333333 |
|  | 16 | 25 | 3 | 5 | 8 | 0.12 | 0.2 | 0.32 |
|  | 26 | 50 | 5 | 8 | 13 | 0.1 | 0.16 | 0.26 |
|  | 51 | 90 | 5 | 13 | 20 | 0.05555555556 | 0.1444444444 | 0.2222222222 |
|  | 91 | 150 | 8 | 20 | 32 | 0.05333333333 | 0.1333333333 | 0.2133333333 |
|  | 151 | 280 | 13 | 32 | 50 | 0.04642857143 | 0.1142857143 | 0.1785714286 |
|  | 281 | 500 | 20 | 50 | 80 | 0.04 | 0.1 | 0.16 |
|  | 501 | 1200 | 32 | 80 | 125 | 0.02666666667 | 0.06666666667 | 0.1041666667 |
|  | 1201 | 3200 | 50 | 125 | 200 | 0.015625 | 0.0390625 | 0.0625 |
|  | 3201 | 10000 | 80 | 200 | 315 | 0.008 | 0.02 | 0.0315 |
|  | 10001 | 35000 | 125 | 315 | 500 | 0.003571428571 | 0.009 | 0.01428571429 |
|  | 35001 | 150000 | 200 | 500 | 800 | 0.001333333333 | 0.003333333333 | 0.005333333333 |
|  | 150001 | 500000 | 315 | 800 | 1250 | 0.00063 | 0.0016 | 0.0025 |
|  | 500001 | 1000000 | 500 | 1250 | 2000 | 0.0005 | 0.00125 | 0.002 |

## Tier Classification

| Col1 | Col2 | Col3 | Col4 |
| --- | --- | --- | --- |
|  | Simple | Intermediate  | Complex |
| Profile | Minimal or no forms | Minor forms | Heavy/Deep forms |
|  | Minimal bends (only on edges) | Multiple bends & lancing | Overlapping bends, draws,etc. |
| To be captured from CAD | Cut perimeter | Cut perimeter | Cut perimeter |
|  | Bend length, angle & shoulder width | Bend length, angle & shoulder width | Bend length, angle & shoulder width |
|  |  | Draw/form perimeter | Draw/form perimeter |
| BOM level | Single part | Sub assemblies | Assemblies |
|  |  | Weld feature | Weld feature |
|  |  | Fastener feature | Fastener feature |
|  |  |  | GD&T |
| Geometry | Square, rectangular parts |  |  |
| Scrap/Rejection |  |  |  |
| No. of process steps | Minimal (1-2) | 3 to 5 | 5 & Above |
