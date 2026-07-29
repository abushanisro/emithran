# TPP

```text
 		Changed
		Addition
		To be removed
	Field Header	Field name	Field Value	Default/Any Logic?	Comment	Formual
	Part Information :	Internal Part Number :			Populated from template upload  /  User Input
		Part Description :			Populated from template upload  /  User Input
		Annual Volume (#) :	12000.0		Populated from template upload  /  User Input
		Commodity :	Sheet Metal		Populated from template upload  /  User Input
		Process Name :	Turret Punching		System suggestion / User Input
		Current Supplier Name :			Populated from template upload or User selected from drop down
		Current Manufacturing Country :	USA		Populated from template upload or User selected from drop down
		Delivery Country :	USA		Populated from template upload or User selected from drop down
		BOM Qty (No's)	1.0		Populated from template upload  /  User Input
		Part Complexity :	Medium		System suggestion / User selected from drop down
		Lot size (#) :	2500.0		Populated from template upload or default to annual volume/12
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
		Unfolded Length (mm) :	50.0		To be captured from part drawing /  User Input
		Unfolded Width (mm) :	30.0		To be captured from part drawing /  User Input
		Thickness (mm) :	2.0		To be captured from part drawing /  User Input
		Net weight (g) :	23.1		To be captured from part drawing /  User Input
		Area (mm^2) :	=+D28*D29		To be captured from part drawing /  User Input
		Volume (mm^3) :	=D32*D30		Calculated: Part area * Sheet thickness
		Part allowance (mm) :	=0.01*D30*((D51/10)^(1/2))		Calculated:	Constant * Sheet thickness * ((Shear strength / 10) ^ (1/2))
		No. of Impressions :			To be removed
		Sheet Width (mm)  :	1250.0		System Suggestion / User can change
		Sheet Length (mm)	2500.0		System Suggestion / User can change
		Edge Allowance (mm)	2.0		Default value
		Parts per Sheet	=((D36-D38)*(D37-D38))/((D28+D34)*(D29+D34))		Calculated:	(Sheet width - Edge allowance)  x (Sheet length - Edge allowance) / (Part length + Part allowance) x (Part width = Part allowance)
		Sheet Weight (g)	=+(D36*D37*D30*D25/1000)		Calculated:	(Sheet length x Sheet Width x Sheet Thickness x Density) / 1000
		Scrap weight per part(g) :	=+D43-D31		Calculated:	Gross part weight - Net part weight
		Net weight per part (g) :	=D31		To be captured from part drawing /  User Input
		Gross weight per part (g) :	=+D40/D39		Calculated:	Sheet weight / Parts per sheet
		Utilisation %	=D42/D43		Calculated:	Net part weight / gross part weight
		Scrap Revovery %	0.9		Default / User can change
		Gross Material cost ($) :	=(D43/1000)*D26		Calculated:	(Gross weight / 1000) * Material Price
		Scrap Rec Cost ($) :	=((D41/1000)*D45)*D27		Calculated:	(Scrap weight / 1000)* Scrap recovery % * Material Price
		Net Material cost ($) :	=+D46-D47		Calculated:	Gross material cost - Scrap Rec Cost
	Manufacturing 1 :	Process Type :	TPP		Select dropdown
		Length Of Cut : (Internal & External) (mm)	178.84		To be captured from part drawing /  User Input
		Shear Strength Of Material : (Mpa)	352.0		Lookup material table
		Theoretical Force : (Ton)	=(D50*$D$30*D51)/9810		Calculated:	(Length of cut * sheet thickness * shear strength) / 9810
		Recommended Force : (Ton)	=D52*1.25		Calculated:	Theoretical force * 1.25
		Selected Tonnage (T) :	20T		Lookup from machine database
		Machine Name :	Turret Press		Lookup from machine database
		M/c Automation :	Auto		Lookup from machine database
		Recommend (T) :			To be removed
		Cycle Time (sec) :	=(1/(100*70%))*60		If machine is automatic, Stroke Time = (1/(Stroker Rate*Factor%))*60	Stroke rate is lookup from machine database & factor% is lookup from table 1
		Setup Time (min/piece) :	=(D60/$D$16)		Calculated:	Total sheet loading - unloading time / Lot size
		Total Sheet loading/unloading time (min)	=ROUNDUP((D16/D39),0)*(10)		Calculated:	(Lot size / parts per sheet) * value from lookup table 2 i.e material handeling table. Value to be selected based on sheet weight
		# of Direct Labors :	0.5		Lookup from machine database
		# of Skilled Labors :	0.0		Hidden field in the UI. Look up value from the machine database.; if no value in machine database default value is 1
	Cost Drivers :	Direct Labor Rate /hr	30.0		Lookingup Value from the country table
		Skilled Labor Rate /hr	45.0		Lookingup Value from the country table
		QA Inspector Rate /hr:	50.0
		Sampling Rate (%)	0.01		Look up the sampling plan table based on lot size.
		Inspection time (min) :	0.5		default: Part complexicity from part information section: Low 5; medium 10; high: 20
		Yield (Net Good Parts) (%) :	0.98		Default: 98% user can change the value
		Machine hour Rate ($) :	15.0		Lookup from machine database
		Machine Cost ($) :	=(D69/3600)*D58		Calculated:	(Machine hour rate / 60 ) x Cycle time
		Setup Cost ($) :	=(((D63/60)*(D59*D61))+((D64/60)*(D59*D62)))+((D69/60)*D59)		Calculated:	((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time)
		Labor Cost ($) :	=(((D63/3600)*(D58*D61)))		Calculated:	(Direct labor rate / 60)* No. of direct labor * cycle time)
		Inspection Cost ($) :	=(((D65/60)*(D67))*(D66*$D$16))/$D$16		Calculated:	(((QA inspector rate / 60) * Inspection Time)*(Sampling% * Lot size)) / Lot size
		Yield Cost (Rejected Parts Scrap Rate) ($)	=+((1-D68)*(($D$48-(($D$42/1000)*$D$27))+SUM(D70:D73)))		Calculated:	( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection)))
		Net Process cost ($) :	=SUM(D70:D74)		Calculated:	Sum ( machine + setup + labor + inspection + yiled)
	Manufacturing 2 :	Process Type :	Bending		Select dropdown
		Ultimate Tensile Strength Of Material : (Mpa)	440.0		Lookup material table
		Bending line length : (mm)	2200.0		To be captured from part drawing /  User Input
		Shoulder width : (mm)	15.0		To be captured from part drawing /  User Input
		Bending coeffecient :	1.33		Constant
		Theoretical Force : (Ton)	=((($D$30^2)*D78*D77*D80)/D79)/9810		Calculated	((Sheet thickness ^2 * bending length * UTS * coefficient)/ bend shoulder length ) / 9810
		No. Of Bends: Count	1.0		To be captured from part drawing /  User Input
		Total Tonnage Requird: (Ton)	=D81*D82		Calculated	Theoretical force * no. of bends
		Recommended Force : (Ton)	=D83*1.25		Calculated	Theoretical force * 1.25
		Selected Tonnage (T) :	80T		Lookup from machine database
		Machine Name :	80T T Press Brake		Lookup from machine database
		M/c Automation :	Manual		Lookup from machine database
		Recommend (T) :			To be removed
		Cycle Time (sec) :	=2+(D92*60)		If machine is manual, Stroke Time = Lookup from table 4 + (Sheet loading/unloading time)
		Setup Time (min/piece) :	=(D91/$D$16)		Calculated	Tool loading time / Lot size
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
		Machine Cost ($) :	=(D101/3600)*D89		Calculated:	(Machine hour rate / 60 ) x Cycle time
		Setup Cost ($) :	=(((D95/60)*(D90*D93))+((D96/60)*(D90*D94)))+((D101/60)*D90)		Calculated:	((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time)
		Labor Cost ($) :	=(((D95/3060)*(D89*D93)))		Calculated:	(Direct labor rate / 60)* No. of direct labor * cycle time)
		Inspection Cost ($) :	=(((D97/60)*(D99))*(D98*$D$16))/$D$16		Calculated:	(((QA inspector rate / 60) * Inspection Time)*(Sampling% * Lot size)) / Lot size
		Yield Cost (Rejected Parts Scrap Rate) ($)	=+((1-D100)*(($D$48-(($D$42/1000)*$D$27))+SUM(D102:D105)))		Calculated:	( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection)))
		Net Process cost ($) :	=SUM(D102:D106)		Calculated:	Sum ( machine + setup + labor + inspection + yiled)
```