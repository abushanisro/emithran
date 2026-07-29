# DrawingForming

```text
		Changed
		Addition
		To be removed
	Field Header	Field name	Field Value	Default/Any Logic?	Comment	Input/Feedback	Input/Feedback
	Part Information :	Internal Part Number :			Populated from template upload  /  User Input
		Part Description :			Populated from template upload  /  User Input
		Annual Volume (#) :	120000.0		Populated from template upload  /  User Input
		Commodity :	Sheet Metal		Populated from template upload  /  User Input
		Process Name :	Stamping - Progressive		System suggestion / User Input
		Current Supplier Name :			Populated from template upload or User selected from drop down
		Current Manufacturing Country :	USA		Populated from template upload or User selected from drop down
		Delivery Country :	USA		Populated from template upload or User selected from drop down
		BOM Qty (No's)	1.0		Populated from template upload  /  User Input
		Part Complexity :	Medium		System suggestion / User selected from drop down
		Lot size (#) :	=+D8/12		Populated from template upload or default to annual volume/12
		Supply Chain Model :	Buy		Default is buy
		Packaging Type :	No Packing		Select dropdown
		HS Code :	N/A		Populated from template upload  /  User Input
		Inco Terms :	EX-W		Default option1: Supplier master; Option 2: Client master
		Payment Terms :	60 Days		Default option1: Supplier master; Option 2: Client master
	Material Information :	Category :	Ferrous		To be captured from part drawing /  User Input
		Family :	HDG Steel		To be captured from part drawing /  User Input
		Description/Grade :	2mm*500mm SGCC		To be captured from part drawing /  User Input
		Density (g/cc) :	7.85		Lookup material table
		Material price ($/Kg) :	1.5		Lookup material table
		Scrap price ($/Kg) :	0.4		Lookup material table
		Unfolded Length (mm) :	250.0		To be captured from part drawing /  User Input
		Unfolded Width (mm) :	250.0		To be captured from part drawing /  User Input
		Thickness (mm) :	3.0		To be captured from part drawing /  User Input
		Net weight (g) :	1471.9		To be captured from part drawing /  User Input
		Area (mm^2) :	=+D28*D29		To be captured from part drawing /  User Input
		Volume (mm^3) :	=+D28*D29*D30		Calculated: Part area * Sheet thickness
		Part allowance	=0.01*D30*((352/10)^(1/2))		Calculated:	Constant * Sheet thickness * ((Shear strength / 10) ^ (1/2)) +  (10 mm to be added if more than 1 impression)
		No. of Impressions :	=+ROUNDDOWN((D36-D38)/(D28+D34),0)		Calculated:	(Coil width - Start & end scrap length) / ( Part length + part allowance)
		Coil/Sheet Width (mm)  :	300.0		System Suggestion / User can change
		Coil/Sheet Length (mm)	300.0		System Suggestion / User can change
		Start & End Scrap Length (mm)	5.0		Default value
		Parts per Coil	=((D36-D38)*(D37-D38))/((D28+D34)*(D29+D34))		Calculated:	(Coil width - Edge allowance)  x (Coil length - Edge allowance) / (Part length + Part allowance) x (Part width = Part allowance)
		Coil/Sheet WeiKght (g)	=+(D36*D37*D30*D25/1000000)*1000		Calculated:	(Coil length x Coil Width x Sheet Thickness x Density) / 1000
		Scrap weight per part(g) :	=+D43-D31		Calculated:	Gross part weight - Net part weight
		Net weight per part (g) :	=D31		To be captured from part drawing /  User Input
		Gross weight per part (g) :	=+D40/D39		Calculated:	Sheet weight / Parts per sheet
		Utilisation %	=D42/D43		Calculated:	Net part weight / gross part weight
		Scrap Recovery %	0.9		Default / User can change
		Gross Material cost ($) :	=+(D43/1000)*D26		Calculated:	(Gross weight / 1000) * Material Price
		Scrap Rec Cost ($) :	=((D41/1000)*D45)*D27		Calculated:	(Scrap weight / 1000)* Scrap recovery % * Material Price
		Net Material cost ($) :	=+D46-D47		Calculated:	Gross material cost - Scrap Rec Cost
	Manufacturing 1 :	Process Type :	Stamping		Select dropdown
		Form Length: (mm)	250.0		To be captured from part drawing /  User Input	L	Calculated based on part draw feature
		Form Perimeter: (mm)	=3.14*250		To be captured from part drawing /  User Input	Fp	Calculated based on part draw feature
		Form Height: (mm)	180.0		To be captured from part drawing /  User Input	h	Calculated based on part draw feature
		Punch Perimeter : (mm)	=D51*95%		To be captured from part drawing /  User Input	Dp	Calculated based on part draw feature, 95% of form perimeter
		(h/L) Factor	=D52/D50		Calculated:	(h/L)	DR = h/L
		Yield Strength Of Material : (Mpa)	370.0		Lookup from material database	Y	Can be captured from Material database
		Drawing Force : (Ton)	=((D53*$D$30*D55)*((D51/D53)-0.7))/9810		Calculated	Fd	Fd = Dp * T * Y * (Fp/Dp-0.7)
		Blank Holding Force : (Ton)	=D56*(1/3)		To be removed	Fb	Fb = 1/3 * Fb
		Theoretical Force : (Ton)	=(D56+D57)*D35		Stroke Time = 1/(Stroker Rate*Factor%)	F	F = (Fd + Fb)*No. Of Impressions
		Recommended Force : (Ton)	=D58*1.25		Calculated:	F Actual	F Actual = F * 1.25
		Selected Tonnage (T) :	50T		Lookup from machine database
		Machine Name :	Press 50T		Lookup from machine database
		M/c Automation :	Manual		Lookup from machine database
		Recommend (T) :			To be removed
		Cycle Time (sec) :	=(12)+(D67*60)		Calculated	(Value from lookup table 4) + (Sheet loading unloading time/60)
		Setup Time (min/piece) :	=(D66/$D$16)		Calculated	Setup time = (Tool loading time)/Batch qty
		Tool Loading Time (min)	45.0		Lookup table 3A
		Total Coil/Sheet loading time (min)	=(10/60)		Lookup from table 2
	Cost Drivers :	# of Direct Labors :	1.0		Lookup from machine database
		# of Skilled Labors :	1.0		Hidden field in the UI. Look up value from the machine database.; if no value in machine database default value is 1
		Direct Labor Rate /hr	30.0		Lookingup Value from the country table
		Skilled Labor Rate /hr	45.0		Lookingup Value from the country table
		QA Inspector Rate /hr:	50.0
		Sampling Rate (%)	0.01		Look up the sampling plan table based on lot size.
		Inspection time (min) :	0.5		default: Part complexicity from part information section: Low 5; medium 10; high: 20
		Yield (Net Good Parts) (%) :	0.98		Default: 98% user can change the value
		Machine hour Rate ($) :	15.0		Lookup from machine database
		Machine Cost ($) :	=(D76/3600)*(D64/$D$35)		Calculated:	(Machine hour rate / 60 ) x Cycle time/no of impressions
		Setup Cost ($) :	=(((D70/60)*(D65*D68))+((D71/60)*(D65*D69)))+((D76/60)*D65)		Calculated:	((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time)
		Labor Cost ($) :	=(((D70/3600)*(D64/D35)*D68))		Calculated:	(Direct labor rate / 60)* No. of direct labor * (cycle time/no of impressions))
		Inspection Cost ($) :	=(((D72/60)*(D74))*(D73*$D$16))/$D$16		Calculated:	(((QA inspector rate / 60) * Inspection Time)*(Sampling% * Lot size)) / Lot size
		Yield Cost (Rejected Parts Scrap Rate) ($)	=+((1-D75)*(($D$48-(($D$42/1000)*$D$27))+SUM(D77:D80)))		Calculated:	( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection)))
		Net Process cost ($) :	=SUM(D77:D81)		Calculated:	Sum ( machine + setup + labor + inspection + yiled)
	Manufacturing 2 :	Process Type :	Bending		Select dropdown
		Ultimate Tensile Strength Of Material : (Mpa)	440.0		Lookup material table
		Bending line length : (mm)	2200.0		To be captured from part drawing /  User Input
		Shoulder width : (mm)	15.0		To be captured from part drawing /  User Input
		Bending coeffecient :	1.33		Constant
		Theoretical Force : (Ton)	=((($D$30^2)*D85*D84*D87)/D86)/9810		Calculated	((Sheet thickness ^2 * bending length * UTS * coefficient)/ bend shoulder length ) / 9810
		No. Of Bends: Count	1.0		To be captured from part drawing /  User Input
		Total Tonnage Requird: (Ton)	=D88*D89		Calculated	Theoretical force * no. of bends
		Recommended Force : (Ton)	=D90*1.25		Calculated	Theoretical force * 1.25
		Selected Tonnage (T) :	80T		Lookup from machine database
		Machine Name :	80T T Press Brake		Lookup from machine database
		M/c Automation :	Manual		Lookup from machine database
		Recommend (T) :			To be removed
		Cycle Time (sec) :	=2+(D99*60)		If machine is manual, Stroke Time = Lookup from table 4 + (Sheet loading/unloading time)
		Setup Time (min/piece) :	=(D98/$D$16)		Calculated	Tool loading time / Lot size
		Total tool loading time (min)	10.0		Lookup from table 3B
		Sheet loading/Unloading time (min)	=(5/60)		Lookup from table 2
	Cost Drivers :	# Direct Labors :	1.0		Lookup from machine database
		# of Skilled Labors :	0.0		Hidden field in the UI. Look up value from the machine database.; if no value in machine database default value is 1
		Direct Labor Rate /hr	30.0		Lookingup Value from the country table
		Skilled Labor Rate /hr	45.0		Lookingup Value from the country table
		QA Inspector Rate /hr:	50.0
		Sampling Rate (%)	0.01		Look up the sampling plan table based on lot size.
		Inspection time (min) :	0.5		default: Part complexicity from part information section: Low 5; medium 10; high: 20
		Yield (Net Good Parts) (%) :	0.98		Default: 98% user can change the value
		Machine hour Rate ($) :	15.0		Lookup from machine database
		Machine Cost ($) :	=(D108/3600)*D96		Calculated:	(Machine hour rate / 60 ) x Cycle time
		Setup Cost ($) :	=(((D102/60)*(D97*D100))+((D103/60)*(D97*D101)))+((D108/60)*D97)		Calculated:	((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time)
		Labor Cost ($) :	=(((D102/3060)*(D96*D100)))		Calculated:	(Direct labor rate / 60)* No. of direct labor * cycle time)
		Inspection Cost ($) :	=(((D104/60)*(D106))*(D105*$D$16))/$D$16		Calculated:	(((QA inspector rate / 60) * Inspection Time)*(Sampling% * Lot size)) / Lot size
		Yield Cost (Rejected Parts Scrap Rate) ($)	=+((1-D107)*(($D$48-(($D$42/1000)*$D$27))+SUM(D109:D112)))		Calculated:	( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection)))
		Net Process cost ($) :	=SUM(D109:D113)		Calculated:	Sum ( machine + setup + labor + inspection + yiled)
```