# Stamping & Bending

```text
		Changed
		Addition
		To be removed
	Field Header	Field name	Field Value		Comment	Input/Feedback
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
		Unfolded Length (mm) :	50.0		To be captured from part drawing /  User Input
		Unfolded Width (mm) :	30.0		To be captured from part drawing /  User Input
		Thickness (mm) :	2.0		To be captured from part drawing /  User Input
		Net weight (g) :	23.1		To be captured from part drawing /  User Input
		Area (mm^2) :	=+D28*D29		To be captured from part drawing /  User Input
		Volume (mm^3) :	=+D28*D29*D30		Calculated: Part area * Sheet thickness
		Part allowance (mm) :	=0.01*D30*((D51/10)^(1/2))+10		Calculated:	Constant * Sheet thickness * ((Shear strength / 10) ^ (1/2)) +  (10 mm to be added if more than 1 impression)
		No. of Impressions :	=+ROUNDDOWN((D36-D38)/(D28+D34),0)		Calculated:	(Coil width - Start & end scrap length) / ( Part length + part allowance)
		Coil Width (mm)  :	500.0		System Suggestion / User can change
		Coil Length (mm)	12000.0		System Suggestion / User can change
		Start & End Scrap Length (mm)	20.0		Default value
		Parts per Coil	=((D36-D38)*(D37-D38))/((D28+D34)*(D29+D34))		Calculated:	(Coil width - Edge allowance)  x (Coil length - Edge allowance) / (Part length + Part allowance) x (Part width = Part allowance)
		Coil WeiKght (g)	=+(D36*D37*D30*D25/1000000)*1000		Calculated:	(Coil length x Coil Width x Sheet Thickness x Density) / 1000
		Scrap weight per part(g) :	=+D43-D31		Calculated:	Gross part weight - Net part weight
		Net weight per part (g) :	=D31		To be captured from part drawing /  User Input
		Gross weight per part (g) :	=+D40/D39		Calculated:	Sheet weight / Parts per sheet
		Utilisation %	=D42/D43		Calculated:	Net part weight / gross part weight
		Scrap Revovery %	0.9		Default / User can change
		Gross Material cost ($) :	=(D43/1000)*D26		Calculated:	(Gross weight / 1000) * Material Price
		Scrap Rec Cost ($) :	=((D41/1000)*D45)*D27		Calculated:	(Scrap weight / 1000)* Scrap recovery % * Material Price
		Net Material cost ($) :	=+D46-D47		Calculated:	Gross material cost - Scrap Rec Cost
	Manufacturing 1 :	Process Type :	Stamping		Select dropdown
		Length Of Cut : (Internal & External) (mm)	100.0		To be captured from part drawing /  User Input
		Shear Strength Of Material : (Mpa)	352.0		Lookup material table
		Theoretical Force : (Ton)	=(D50*$D$30*D51*D35)/9810		Calculated:	(Length of cut * sheet thickness * shear strength*No. of impressions) / 9810
		Recommended Force : (Ton)	=D52*1.25		Calculated:	Theoretical force * 1.25
		Selected Tonnage (T) :	120.0		Lookup from machine database
		Machine Name :	Stamping 120T		Lookup from machine database
		M/c Automation :	Auto		Lookup from machine database
		Recommend (T) :			To be removed
		Cycle Time (sec) :	=(1/(100*70%))*60		If machine is auto, Stroke Time = (1/(Stroker Rate*Factor%))*60	Stroke rate is lookup from machine database & factor% is lookup from table 1
		Setup Time (min/piece) :	=((D61+D60)/$D$16)		Calculated:	((Tool loading time + Total coil loading unloading time )/ Lot size)*60
		Tool Loading Time (min)	45.0		Lookup table 3A
		Total Coil/Sheet loading time (min)	=ROUNDUP(($D$16/$D$39),0)*(20)		Calculated:	(Lot size / parts per sheet) * value from lookup table 2 i.e material handeling table. Value to be selected based on sheet weight
	Cost Drivers :	# Direct Labors :	1.0		Lookup from machine database
		# of Skilled Labors :	1.0		Hidden field in the UI. Look up value from the machine database.; if no value in machine database default value is 1
		Direct Labor Rate /hr	30.0		Lookingup Value from the country table
		Skilled Labor Rate /hr	45.0		Lookingup Value from the country table
		QA Inspector Rate /hr:	50.0
		Sampling Rate (%)	0.01		Look up the sampling plan table based on lot size.
		Inspection time (min) :	0.5		default: Part complexicity from part information section: Low 5; medium 10; high: 20
		Yield (Net Good Parts) (%) :	0.98		Default: 98% user can change the value
		Machine hour Rate ($) :	15.0		Lookup from machine database
		Machine Cost ($) :	=(D70/3600)*($D$58/$D$35)		Calculated:	(Machine hour rate / 60 ) x Cycle time/No. of impressions
		Setup Cost ($) :	=(((D64/60)*(D59*D62))+((D65/60)*(D59*D63)))+((D70/60)*D59)		Calculated:	((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time)
		Labor Cost ($) :	=(((D64/3600)*(D58/D35)*D62))		Calculated:	(Direct labor rate / 60)* No. of direct labor * (cycle time/no of impressions))
		Inspection Cost ($) :	=(((D66/60)*(D68))*(D67*$D$16))/$D$16		Calculated:	(((QA inspector rate / 60)  * Inspection Time)*(Sampling% * Lot size)) / Lot size
		Yield Cost (Rejected Parts Scrap Rate) ($)	=+((1-D69)*(($D$48-(($D$42/1000)*$D$27))+SUM(D71:D74)))		Calculated:	( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection)))
		Net Process cost ($) :	=SUM(D71:D75)		Calculated:	Sum ( machine + setup + labor + inspection + yiled)
	Manufacturing 2 :	Process Type :	Bending		Select dropdown
		Ultimate Tensile Strength Of Material : (Mpa)	440.0		Lookup material table
		Bending line length : (mm)	2200.0		To be captured from part drawing /  User Input
		Shoulder width : (mm)	15.0		To be captured from part drawing /  User Input
		Bending coeffecient :	1.33		Constant
		Theoretical Force : (Ton)	=((($D$30^2)*D79*D78*D81)/D80)/9810		Calculated	((Sheet thickness ^2 * bending length * UTS * coefficient)/ bend shoulder length ) / 9810
		No. Of Bends: Count	1.0		To be captured from part drawing /  User Input
		Total Tonnage Requird: (Ton)	=D82*D83		Calculated	Theoretical force * no. of bends
		Recommended Force : (Ton)	=D84*1.25		Calculated	Theoretical force * 1.25
		Selected Tonnage (T) :	80T		Lookup from machine database
		Machine Name :	80T T Press Brake		Lookup from machine database
		M/c Automation :	Manual		Lookup from machine database
		Recommend (T) :			To be removed
		Cycle Time (sec) :	=2+(D93*60)		If machine is manual, Stroke Time = Lookup from table 4 + (Sheet loading/unloading time)
		Setup Time (min/piece) :	=(D92/$D$16)		Calculated	Tool loading time / Lot size
		Total tool loading time (min)	10.0		Lookup from table 3B
		Sheet loading/Unloading time (min)	=(5/60)		Lookup from table 2
	Cost Drivers :	# of Direct Labors :	1.0		Lookup from machine database
		# of Skilled Labors :	0.0		Hidden field in the UI. Look up value from the machine database.; if no value in machine database default value is 1
		Direct Labor Rate /hr	30.0		Lookingup Value from the country table
		Skilled Labor Rate /hr	45.0		Lookingup Value from the country table
		QA Inspector Rate /hr:	50.0
		Sampling Rate (%)	0.01		Look up the sampling plan table based on lot size.
		Inspection time (min) :	0.5		default: Part complexicity from part information section: Low 5; medium 10; high: 20
		Yield (Net Good Parts) (%) :	0.98		Default: 98% user can change the value
		Machine hour Rate ($) :	15.0		Lookup from machine database
		Machine Cost ($) :	=(D102/3600)*D90		Calculated:	(Machine hour rate / 60 ) x Cycle time
		Setup Cost ($) :	=(((D96/60)*(D91*D94))+((D97/60)*(D91*D95)))+((D102/60)*D91)		Calculated:	((Direct labor rate / 60)* No. of direct labor * setup time) + ((Skilled labor rate / 60)* No. of Skilled labor * setup time) + ((Machine hour rate / 60)* setup time)
		Labor Cost ($) :	=(((D96/3060)*(D90*D94)))		Calculated:	(Direct labor rate / 60)* No. of direct labor * cycle time)
		Inspection Cost ($) :	=(((D98/60)*(D100))*(D99*$D$16))/$D$16		Calculated:	(((QA inspector rate / 60) * Inspection Time)*(Sampling% * Lot size)) / Lot size
		Yield Cost (Rejected Parts Scrap Rate) ($)	=+((1-D101)*(($D$48-(($D$42/1000)*$D$27))+SUM(D103:D106)))		Calculated:	( 1 - yield %) * (net material cost - ((net weight/1000 * scrap cost)+ sum(machine + labor + setup + inspection)))
		Net Process cost ($) :	=SUM(D103:D107)		Calculated:	Sum ( machine + setup + labor + inspection + yiled)
```