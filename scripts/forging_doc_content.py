# -*- coding: utf-8 -*-
"""
eMithran Forging Module: High-Level (HLD) & Low-Level Design (LLD)
Complete Specification Content for CAD Extraction, Processes, Lookup Tables,
Machines (MHR), Raw Materials, Wage Grades (LHR), and Operations.
"""

DOCUMENT_TITLE = "eMithran Forging Costing & CAD Intelligence Architecture"
DOCUMENT_SUBTITLE = "High-Level (HLD) & Low-Level Design (LLD) Specification"
VERSION = "1.0.0"
DATE = "November 2026"
STATUS = "Engineering Architecture Standard"
AUTHOR = "eMithran Core Manufacturing Architecture Team"

# Document Sections structured as dictionaries with headings, paragraphs, tables, and code blocks.
SECTIONS = [
    {
        "id": "1",
        "title": "1. Executive Summary & Architectural Scope",
        "content": [
            {
                "type": "paragraph",
                "text": "This document defines the comprehensive High-Level Design (HLD) and Low-Level Design (LLD) for the eMithran Forging Costing and Manufacturing Intelligence Module. Following the architectural paradigms established in eMithran for Sheet Metal, CNC Machining, High Pressure Die Casting (HPDC), Gravity Die Casting (GDC), and Injection Molding, the Forging Module is architected as a Domain-Driven Design (DDD) micromodule embedded within the NestJS monolith backend, coupled with physics-based geometric feature extraction in the Python OpenCASCADE CAD Engine (cad-engine), and backed by PostgreSQL with Row-Level Security (RLS)."
            },
            {
                "type": "callout",
                "title": "Core Architectural Mandate",
                "text": "1. Pure Calculation Engines: Cost and physics engines perform deterministic calculations without in-flight database I/O.\n2. Transparent Breakdown: Every line item is decomposed into Material, Machine (MHR), Labor (LHR/Wage Grade), Tooling Amortisation, Secondary Operations, and Scrap Recovery.\n3. OpenCASCADE CAD Extraction: True B-Rep topological feature extraction directly from STEP AP203/AP214/AP242 solid models.\n4. Dual Tenancy & Zero Data Leakage: All client CAD models and rate tables reside securely with Postgres RLS."
            },
            {
                "type": "table",
                "headers": ["Module Domain", "Component Location", "Primary Technology", "Responsibility Boundary"],
                "rows": [
                    ["CAD Feature Engine", "cad-engine/forging/", "Python 3.10 + OpenCASCADE (PythonOCC)", "Parting plane, draft angles, ribs/webs, radii, undercuts, billet sizing"],
                    ["Backend Costing", "backend/src/modules/bom-items/costing/forging/", "NestJS + TypeScript", "Routing, machine matching, cycle time synthesis, tooling amortisation"],
                    ["Reference & Lookup", "machining_reference_data & forging_lookup_tables", "PostgreSQL 15 + PostgREST RLS", "Flow stress curves, friction factors, flash ratios, complexity tables"],
                    ["Machine & Labor DB", "mhr_records, lhr_records", "PostgreSQL RLS", "Press/hammer MHR rates, crew sizes, regional wage grade buckets (USA/IN/MX/EU)"],
                    ["Frontend Intelligence", "components/bom/forging-intel/", "Next.js 14 + React + Three.js", "3D Parting line visualizer, DFM draft angle heatmaps, cost drivers breakdown"]
                ]
            }
        ]
    },
    {
        "id": "2",
        "title": "2. High-Level Design (HLD): System Architecture & Data Flow",
        "content": [
            {
                "type": "paragraph",
                "text": "The Forging Module sits seamlessly within eMithran's CAD-to-Cost pipeline. The architecture guarantees zero side effects, asynchronous processing for large assemblies via Redis/Postgres job queues, and sub-second calculation latency once geometric parameters are extracted."
            },
            {
                "type": "code",
                "language": "mermaid",
                "text": """flowchart TD
    User([Enterprise User / Estimator]) -->|Upload STEP / CAD| FE[Next.js Frontend]
    FE -->|POST /api/v1/cad-uploads| Gateway[NestJS Monolith API Gateway]
    Gateway -->|Queue Job| PG_Job[(PostgreSQL Queue / RLS)]
    PG_Job -->|Process STEP| CE[Python CAD Engine FastAPI]
    
    subgraph CAD_Engine ["CAD Engine (OpenCASCADE / cad-engine/forging)"]
        CE --> StepParser[B-Rep TopoDS_Shape Parser]
        StepParser --> PartingDetect[Parting Line & Split Plane Detector]
        PartingDetect --> Silhouette[Parting Plane Projected Area & Perimeter]
        Silhouette --> DraftClassify[Draft Angle & Undercut Classifier]
        DraftClassify --> RibWebRadius[Rib, Web & Fillet Radius Analyzer]
        RibWebRadius --> BilletCurve[Cross-Sectional Area Distribution A(x)]
        BilletCurve --> FeatGraph[Build ForgingFeatureGraphV2]
    end

    FeatGraph -->|JSON Feature Payload| Gateway
    Gateway --> ForgingService[ForgingCostService / BOMItemsService]

    subgraph Forging_Engine ["Backend Forging Cost Engine (backend/.../costing/forging)"]
        ForgingService --> FeatOps[forging-feature-operations.ts: Select Operations]
        ForgingService --> RouteSelect[forging-process-choice.ts: Route Optimization]
        ForgingService --> MatResolve[forging-materials.ts: Billet Sizing & Gross Wt]
        ForgingService --> MachSelect[forging-machine.ts: Press Tonnage & Energy]
        ForgingService --> ToolCost[forging-tooling.ts: Die Block, CNC, EDM & Life]
        ForgingService --> CycleTime[forging-calculators: Physics Cycle Times]
        
        FeatOps --> CostSynth[forging-cost-summary.ts: Pure Cost Synthesis]
        RouteSelect --> CostSynth
        MatResolve --> CostSynth
        MachSelect --> CostSynth
        ToolCost --> CostSynth
        CycleTime --> CostSynth
    end

    CostSynth --> DB[(PostgreSQL Database)]
    DB -.->|MHR Rates| MachSelect
    DB -.->|LHR Wage Grades| MachSelect
    DB -.->|Flow Stress / Tables| CycleTime
    CostSynth -->|CostSummaryDto & DFM Report| Gateway
    Gateway -->|Interactive 3D & Cost Drivers| FE"""
            },
            {
                "type": "paragraph",
                "text": "The execution model enforces that: (1) CAD geometry analysis occurs once and is cached immutably by geometry hash; (2) Scenario analysis (e.g. changing factory location from USA to India or changing batch quantity from 500 to 20,000) re-runs only the pure calculation engine without re-invoking the CAD kernel."
            }
        ]
    },
    {
        "id": "3",
        "title": "3. CAD Feature Extraction Engine (cad-engine/forging/)",
        "content": [
            {
                "type": "paragraph",
                "text": "The Python OpenCASCADE feature extraction engine extracts B-Rep solid model characteristics essential for closed-die, open-die, and upset forging. It mirrors the design pattern of `DieCastingFeatureExtractor` and `SheetMetalFeatureExtractor`."
            },
            {
                "type": "heading3",
                "text": "3.1 Parting Line and Parting Plane Detection"
            },
            {
                "type": "paragraph",
                "text": "Forging dies consist of an Upper Die (Hammer/Ram) and Lower Die (Anvil/Bed). The parting surface is determined by analyzing surface normals relative to candidate pressing vectors (typically the 3 principal inertia axes X, Y, Z):\n- Surface Normal Classification: For each face F, calculate the dot product of face normal n with pull vector v. Faces with n · v > 0 belong to the upper die; faces with n · v < 0 belong to the lower die.\n- Silhouette Perimeter: The locus of points where n · v = 0 forms candidate parting line segments.\n- Optimal Split Selection: Evaluates draft angle balance, minimizes projected area overhangs, and avoids trapped undercut volumes."
            },
            {
                "type": "heading3",
                "text": "3.2 Projected Area, Perimeter & Flash Gutter Footprint"
            },
            {
                "type": "paragraph",
                "text": "The required press tonnage is directly proportional to the total projected area on the parting plane:\n- Part Projected Area (Ap): The 2D polygonal shadow of the 3D solid projected onto the parting plane normal.\n- Flash Land Area (Af): For closed-die forging, excess material escapes into a flash gutter. The flash land width (wf) typically ranges from 3% to 6% of the part width. Af = Lp × wf, where Lp is the parting line perimeter.\n- Total Projected Area: Atot = Ap + Af."
            },
            {
                "type": "heading3",
                "text": "3.3 Draft Angle & Undercut Analysis"
            },
            {
                "type": "paragraph",
                "text": "Draft angles are mandatory to extract the forged component from die cavities without galling or die sticking:\n- External Draft Angles: Standard steel forgings require 3° to 7° (aluminum 1° to 3°).\n- Internal Draft Angles (Cavity / Ribs): Sinking recesses shrink onto die projections during cooling; internal draft requires 5° to 10°.\n- Undercut Detection: Faces where surface normal points away from the pull direction (re-entrant angles) are classified as Undercuts. Undercuts cannot be forged in standard two-piece dies and require either side-action wedges, split dies, or secondary machining."
            },
            {
                "type": "heading3",
                "text": "3.4 Ribs, Webs, and Fillet Radii Detection"
            },
            {
                "type": "paragraph",
                "text": "Fillet and corner radii dictate metal flow into cavities and prevent premature die cracking from thermal-mechanical fatigue:\n- Corner Radius (rc): Radius on male die projections. Minimum rc = 1.5 mm to 3.0 mm + 0.05 × cavity depth.\n- Fillet Radius (rf): Radius at inside cavity corners. Sharp fillets cause cold shuts, flow folding, and stress concentrations.\n- Web Thickness (tw) and Rib Aspect Ratio: The engine computes the ratio of rib height (hr) to rib width (wr). Ratios hr / wr > 4:1 trigger DFM warnings for high forging pressure and die wear."
            },
            {
                "type": "heading3",
                "text": "3.5 Cross-Sectional Area Distribution Curve A(x)"
            },
            {
                "type": "paragraph",
                "text": "To determine preforming requirements (fullering, edging, roll forging), the CAD engine slices the solid along the principal forging axis into N equidistant planes (typically 50-100 slices), calculating cross-sectional area A(x). Regions where dA/dx exceeds critical thresholds indicate the necessity of preforming operations to avoid flash wastage and folding defects."
            }
        ]
    },
    {
        "id": "4",
        "title": "4. Forging Processes Taxonomy & Process Routing",
        "content": [
            {
                "type": "paragraph",
                "text": "eMithran classifies forging into 6 distinct manufacturing processes, each characterized by specific tooling architectures, machine kinematics, and economic batch thresholds:"
            },
            {
                "type": "table",
                "headers": ["Process Name", "Key Characteristics", "Typical Batch Size", "Tolerance Class", "Common Applications"],
                "rows": [
                    ["Closed-Die (Impression) Hot Forging", "Two-piece dies with flash gutter; heated billet (1100°C-1250°C for steel); high strength-to-weight", "500 - 100,000+", "DIN 7526 Grade F / E", "Automotive crankshafts, connecting rods, steering knuckles, aerospace brackets"],
                    ["Warm Forging", "Forged between 650°C - 850°C; reduced scale oxidation; closer net-shape tolerances", "5,000 - 200,000+", "DIN 7526 Grade E", "Transmission bevel gears, CV joint spiders, constant velocity components"],
                    ["Cold Forging / Heading", "Room temperature; high dimensional accuracy; work hardening; requires phosphate/soap lube", "10,000 - 1,000,000+", "IT8 - IT10", "High-strength fasteners, spark plug shells, drive pinions, stepped shafts"],
                    ["Open-Die (Smith / Hammer) Forging", "Flat or simple contour dies; free lateral metal flow; operator/manipulator intensive; low tooling cost", "1 - 100", "Rough Envelope (±5-15mm)", "Heavy turbine shafts, large marine crane hooks, generator rotors, prototype blanks"],
                    ["Horizontal Upset Forging", "Multi-stage heading & gripping dies; bar stock heated at end; accumulates volume locally", "1,000 - 100,000+", "DIN 7526 Grade F", "Engine valves, axle shafts, flanged tubes, track pins"],
                    ["Seamless Ring Rolling", "Radial-axial rolling mills; hollow doughnut preform rolled into high-integrity ring", "50 - 10,000+", "ISO 3134 Class 2", "Bearing raceways, jet engine casing rings, wind turbine slewing rings, pipe flanges"]
                ]
            },
            {
                "type": "heading3",
                "text": "4.1 Route Selection Decision Algorithm"
            },
            {
                "type": "paragraph",
                "text": "The automated route selector (`forging-process-choice.ts`) compares feasible routes based on total cost per part (piece cost + die tooling per part amortization). Feasibility is evaluated against: (1) Part envelope and bounding weight; (2) Annual production volume; (3) Geometric complexity score; (4) Alloy forgeability rating."
            }
        ]
    },
    {
        "id": "5",
        "title": "5. Lookup Tables & Empirical Engineering Reference Data",
        "content": [
            {
                "type": "paragraph",
                "text": "The Forging Module integrates reference tables seeded into `machining_reference_data` and queried through `forging-lookup-tables.ts`. These tables capture empirical manufacturing constants proven across industry standards (DIN 7526, EN 10254, ASM Handbook Vol 14A)."
            },
            {
                "type": "heading3",
                "text": "5.1 Material Flow Stress Constants (σf)"
            },
            {
                "type": "paragraph",
                "text": "Flow stress σf (MPa) represents resistance to plastic deformation as a function of temperature T (°C), strain ε, and strain rate ε_dot (s⁻¹):\nσf = K · (ε_dot)^m · exp(Q / RT)\nWhere K is strength coefficient, m is strain-rate sensitivity, and Q is activation energy."
            },
            {
                "type": "table",
                "headers": ["Material Grade", "Forging Temp Window (°C)", "Flow Stress σf (MPa)", "Oxidation Scale Factor (% wt)", "Forgeability Index (0-10)"],
                "rows": [
                    ["AISI 1020 / C20", "1150 - 1250", "80 - 120", "2.0%", "9.5 (Excellent)"],
                    ["AISI 1045 / C45", "1100 - 1220", "110 - 150", "2.2%", "9.0 (Very Good)"],
                    ["AISI 4140 / 42CrMo4", "1050 - 1200", "140 - 190", "2.5%", "8.0 (Good)"],
                    ["AISI 4340 / 34CrNiMo6", "1050 - 1180", "160 - 220", "2.5%", "7.5 (Moderate)"],
                    ["SS 304 / 1.4301", "1050 - 1200", "190 - 260", "1.0% (Protective scale)", "6.5 (Work hardens)"],
                    ["SS 316L / 1.4404", "1050 - 1180", "210 - 280", "1.0%", "6.0 (High hot strength)"],
                    ["Al 6061-T6", "430 - 480", "60 - 90", "0.0% (Zero scale loss)", "8.5 (Narrow temp band)"],
                    ["Al 7075-T6", "380 - 440", "90 - 130", "0.0%", "6.0 (Crack sensitive)"],
                    ["Ti-6Al-4V (Grade 5)", "900 - 980 (Alpha-Beta)", "240 - 350", "0.5% (Alpha case defect)", "4.0 (Narrow beta transus)"],
                    ["Inconel 718", "980 - 1120", "320 - 480", "0.2%", "2.5 (Severe tool wear)"]
                ]
            },
            {
                "type": "heading3",
                "text": "5.2 Shape Complexity Factor (Cs / S1, S2)"
            },
            {
                "type": "paragraph",
                "text": "According to DIN 7526, part complexity is classified by the ratio of part volume (Vp) to bounding circumscribed cylinder volume (Vc):\n- Class S1 (Simple): Vp / Vc > 0.6. Flat, circular, or block shapes with minimal ribs (Cs = 1.1 - 1.3).\n- Class S2 (Moderate): 0.3 < Vp / Vc ≤ 0.6. Simple flanges, shafts, discs with moderate bosses (Cs = 1.3 - 1.6).\n- Class S3 (Complex): 0.15 < Vp / Vc ≤ 0.3. Deep ribs, thin webs, asymmetrical arms (Cs = 1.6 - 2.0).\n- Class S4 (Severe / Very Complex): Vp / Vc ≤ 0.15. Multiple thin ribs, deep pockets, tall bosses (Cs = 2.0 - 2.5)."
            },
            {
                "type": "heading3",
                "text": "5.3 Flash Land Sizing and Ratios"
            },
            {
                "type": "paragraph",
                "text": "The flash land width-to-thickness ratio (wf / tf) controls cavity backpressure ensuring complete filling before flash freezes:\n- Flash thickness tf = 0.016 × sqrt(Ap) + 0.5 mm.\n- Flash land width wf = 3.0 × tf to 5.0 × tf.\n- Flash weight typically constitutes 10% to 25% of gross billet weight."
            },
            {
                "type": "heading3",
                "text": "5.4 Die Wear & Tool Life Expectancy"
            },
            {
                "type": "paragraph",
                "text": "Die life (blow count before redressing or replacement) depends on die steel grade (DIN 1.2714 / AISI H13 / H11), forging temperature, and surface treatment:\n- Uncoated H13 on Carbon Steel: 8,000 - 15,000 parts.\n- Gas Nitrided / Plasma Nitrided H13: 20,000 - 35,000 parts.\n- Hardfaced Stellite / Maraging Inlay: 40,000 - 70,000 parts.\n- Stainless Steel Forging: 0.6× steel die life; Titanium Forging: 0.4× steel die life."
            }
        ]
    },
    {
        "id": "6",
        "title": "6. Machine Database & Selection Engine (MHR & Press Kinematics)",
        "content": [
            {
                "type": "paragraph",
                "text": "Forging machinery is stored in `mhr_records` and queried through `forging-machine.ts`. Presses and hammers differ fundamentally in their energy and force delivery characteristics:"
            },
            {
                "type": "heading3",
                "text": "6.1 Machine Classes & Kinematics"
            },
            {
                "type": "table",
                "headers": ["Machine Class", "Force / Energy Delivery", "Kinematics & Contact Time", "Primary Application"],
                "rows": [
                    ["Hydraulic Forging Press", "Constant rated force throughout stroke; 500T - 30,000T", "Slow ram speed (10-50 mm/s); long die contact; high heat transfer", "Large forgings, isothermal forging, heavy open-die, titanium & nickel"],
                    ["Mechanical Crank Press", "Displacement-dependent force (peaks near Bottom Dead Center); 300T - 8,000T", "Rapid sinusoidal motion (30-90 SPM); short contact time; high productivity", "High-volume closed die automotive, connecting rods, gears"],
                    ["Screw Press (Direct Drive / Friction)", "Fixed kinetic energy per blow; 400T - 6,300T; self-limiting load", "Intermediate speed (100-300 mm/s); bounce-back stroke; high accuracy", "Turbine blades, precision bevel gears, hand tools"],
                    ["Drop Hammer (Air / Steam / Counterblow)", "High kinetic energy E = 0.5·m·v²; strain rates up to 100 s⁻¹; 10 kJ - 500 kJ", "Impact duration < 10 ms; minimal die chilling; multi-blow progressive shaping", "Medium to heavy steel forgings, complex shapes with multi-impression dies"],
                    ["Horizontal Upsetter", "Horizontal heading slide + vertical gripping slide; 2\" to 10\" bar capacity", "Multi-cavity sequence; automatic bar feed", "Long shafts with upsets, valves, flanged axles"],
                    ["Radial-Axial Ring Rolling Mill", "Continuous radial and axial rolling forces; OD 200 mm - 5000 mm", "Continuous rotary deformation; fast cycle time (20-90 s)", "Seamless rings, bearing races, aerospace flanges"]
                ]
            },
            {
                "type": "heading3",
                "text": "6.2 Physics-Based Tonnage & Energy Formulation"
            },
            {
                "type": "paragraph",
                "text": "The required press forging load F_req (kN) is determined via the slab method formulation:\nF_req = σf · Cs · Atot · [1 + (2 · μ · r_avg) / (3 · h_avg)] / 1000\nWhere:\n- σf = Flow stress of alloy at forging finish temperature (MPa)\n- Cs = Shape complexity factor (1.1 to 2.5)\n- Atot = Total projected area including flash land (mm²)\n- μ = Friction coefficient at die-billet interface (0.25 cold, 0.40 hot with graphite)\n- r_avg = Characteristic radius of forging = sqrt(Ap / π) (mm)\n- h_avg = Mean thickness of forging = Volume / Ap (mm)\n\nFor hammers and screw presses, required blow energy E_req (kJ) is calculated as:\nE_req = 1.35 · Vp · σf · ln(h0 / h1) / 1000\nWhere h0 is initial billet height and h1 is final forged height."
            },
            {
                "type": "heading3",
                "text": "6.3 Machine Hour Rate (MHR) Breakdown Model"
            },
            {
                "type": "paragraph",
                "text": "MHR represents the hourly cost of operating the machine (excluding direct operating labor crew, which is costed separately via LHR). The formula enforces financial rigor:\nMHR ($/hr) = CapEx_Depreciation + Electricity_Cost + Gas_Furnace_Cost + Die_Bolster_Floor_Space + Maintenance_Spares + Lubrication_Pumping\nWhere:\n- CapEx Depreciation = (Machine Purchase Price - Residual Value) / (Useful Life Years × Annual Operating Hours × OEE)\n- Electricity Cost = Connected Power (kW) × Utilization Factor × Industrial Power Rate ($/kWh)\n- Maintenance & Wear = 8% to 12% of annual capital expenditure."
            }
        ]
    },
    {
        "id": "7",
        "title": "7. Raw Materials, Billet Sizing & Yield Economics",
        "content": [
            {
                "type": "paragraph",
                "text": "Material cost represents 35% to 60% of total forging piece cost. The raw material engine computes exact billet dimensions, gross input weight, and net weight from 3D CAD density."
            },
            {
                "type": "heading3",
                "text": "7.1 Gross Weight Synthesis Formula"
            },
            {
                "type": "paragraph",
                "text": "Gross Billet Weight (W_gross) is synthesized from net part weight and all manufacturing yield losses:\nW_gross = W_net + W_flash + W_scale + W_tong + W_kerf\n1. Net Part Weight (W_net): Volume (Vp from CAD) × Density (ρ from `raw_materials`).\n2. Flash Loss (W_flash): Total flash land volume × Density. Typically 12% - 25% of W_net.\n3. Scale Oxidation Loss (W_scale): Hot steel forms iron oxide scale in gas furnaces (2.0% - 3.0% of heated weight). In induction furnaces with inert atmosphere, scale loss drops to 0.5% - 1.0%.\n4. Tong Hold Loss (W_tong): Gripping margin on billet bar (required in open-die and hammer forgings; zero in automated transfer presses).\n5. Saw Kerf Loss (W_kerf): Material converted to chips during billet cutoff = (π/4 · D² · saw_blade_thickness) × ρ."
            },
            {
                "type": "heading3",
                "text": "7.2 Scrap Recovery & Buyback Valuation"
            },
            {
                "type": "paragraph",
                "text": "Scrap generated from trimming flash and saw kerf is credited back at commodity scrap buyback rates:\nNet Material Cost = (W_gross × Raw_Material_Cost_Per_Kg) - (W_scrap × Scrap_Credit_Rate_Per_Kg)\nWhere W_scrap = W_flash + W_kerf + W_tong (scale loss cannot be credited as solid scrap)."
            }
        ]
    },
    {
        "id": "8",
        "title": "8. Wage Grade & Labor Rate Architecture (LHR)",
        "content": [
            {
                "type": "paragraph",
                "text": "Forging is a crew-based manufacturing operation. Unlike solitary CNC machining, a heavy forging press line operates with a synchronized crew consisting of distinct skill tiers."
            },
            {
                "type": "heading3",
                "text": "8.1 Forging Crew Hierarchy & Wage Grade Categories"
            },
            {
                "type": "table",
                "headers": ["Wage Grade / Role", "Skill Category", "Key Operational Responsibilities", "Typical Line Allocation"],
                "rows": [
                    ["Master Forger / Head Press Lead", "Grade A+ (Specialist)", "Press setup, die alignment, stroke tuning, first-piece inspection, closed-die balance", "1 per forging line (leads crew)"],
                    ["Press Operator", "Grade A (Skilled)", "Operating press controls, lubricating dies with spray wand/auto-sprayer", "1 per press"],
                    ["Manipulator / Crane Driver", "Grade A (Skilled)", "Guiding heavy billets with hydraulic manipulator into hammer/press dies", "1 for open-die & heavy presses (>2500T)"],
                    ["Billet Heater / Furnace Loader", "Grade B (Semi-Skilled)", "Monitoring induction heater / gas furnace temperature, pyrometer verification, descaling transfer", "1 per line"],
                    ["Trimming & Piercing Operator", "Grade B (Semi-Skilled)", "Transferring hot forging to trim press, punching out flash and web plugs", "1 per trim press"],
                    ["Heat Treatment Technician", "Grade A (Skilled)", "Furnace cycle management, quench tank agitation, hardness testing (Brinell/Rockwell)", "Shared across heat treat department (0.25 FTE/part)"],
                    ["Fettling / Grinding / Blasting Labor", "Grade C (General)", "Operating shot blast tumbler, manual grinding of trim remnants / parting fins", "1 per finishing station"],
                    ["NDT & Quality Inspector", "Grade A+ (Certified Level II)", "Magnetic Particle Inspection (MPI), Ultrasonic flaw testing, CMM dimensional verification", "1 per quality batch cell"]
                ]
            },
            {
                "type": "heading3",
                "text": "8.2 Digital Factory Regional Wage Benchmarks"
            },
            {
                "type": "paragraph",
                "text": "eMithran benchmarks Labor Hour Rates (LHR) across its 6 global manufacturing regions (stored in `lhr_records` and updated quarterly). Forging operations scale labor costs based on regional crewed rates:\n- United States (Midwest): Grade A+ = $65/hr | Grade A = $48/hr | Grade B = $34/hr | Grade C = $26/hr\n- Mexico (Monterrey / Bajio): Grade A+ = $16/hr | Grade A = $11/hr | Grade B = $7.50/hr | Grade C = $5.20/hr\n- India (Pune / Chennai): Grade A+ = $9.50/hr | Grade A = $6.20/hr | Grade B = $4.10/hr | Grade C = $2.80/hr\n- Poland / CEE: Grade A+ = $28/hr | Grade A = $20/hr | Grade B = $14/hr | Grade C = $10.50/hr\n- Germany (Baden-Württemberg): Grade A+ = $82/hr | Grade A = $62/hr | Grade B = $45/hr | Grade C = $34/hr\n- Vietnam (Hai Phong): Grade A+ = $8.00/hr | Grade A = $5.20/hr | Grade B = $3.50/hr | Grade C = $2.40/hr"
            }
        ]
    },
    {
        "id": "9",
        "title": "9. Operations Taxonomy & Standard Routing Workflow",
        "content": [
            {
                "type": "paragraph",
                "text": "Forging operations are registered in `process_taxonomy_operations`. A complete standard manufacturing route consists of 13 sequential operations (OP 10 to OP 130):"
            },
            {
                "type": "table",
                "headers": ["Op Nbr", "Operation Name", "Machine Class", "Cycle Time Formulation", "Labor Crew Allocation"],
                "rows": [
                    ["OP 10", "Billet Cutoff", "Automatic Bandsaw / Cold Billet Shear", "T_cut = Area_bar / Cut_rate (mm²/min) + 5s index", "1 Operator per 3 saws (0.33 FTE)"],
                    ["OP 20", "Billet Preheating", "Medium-Frequency Induction Furnace / Gas Furnace", "T_heat = Continuous feed; cycle matched to press stroke (e.g. 15-45s)", "1 Furnace Loader (Grade B)"],
                    ["OP 30", "Billet Descaling", "High-Pressure Waterjet (200-300 bar) / Scraping Rolls", "T_desc = 2.0 to 4.0 seconds per slug", "Automated / In-line conveyor"],
                    ["OP 40", "Preforming / Busting", "Fullering / Edging Die Cavity or Cross-Wedge Rolls", "T_preform = 1 to 2 blows / strokes (4-8s)", "Included in main forge press crew"],
                    ["OP 50", "Blocker Impression Forging", "Forging Press / Hammer (Blocker Cavity)", "T_block = 1 stroke (press) or 2-3 blows (hammer) (6-12s)", "Main Forge Press Crew (Lead + Operator)"],
                    ["OP 60", "Finisher Impression Forging", "Forging Press / Hammer (Finisher Cavity)", "T_finish = 1 stroke or 2 blows + die blow/lube (8-16s)", "Main Forge Press Crew"],
                    ["OP 70", "Hot Trimming & Piercing", "Mechanical Crank Trim Press (100T - 600T)", "T_trim = 1 single stroke + unload flash (4-8s)", "1 Trimming Operator (Grade B)"],
                    ["OP 80", "Coining / Sizing (Restriking)", "Heavy Knuckle-Joint Coining Press", "T_coin = 1 stroke (optional, for tight tolerances) (5-8s)", "1 Coining Press Operator (Grade B)"],
                    ["OP 90", "Heat Treatment", "Continuous Roller Hearth / Batch Car-Bottom Furnace", "T_ht = Batch cycle (Normalizing, Q&T, Isothermal Anneal)", "Shared Furnace Specialist (0.2 FTE)"],
                    ["OP 100", "Surface Descaling & Shot Blast", "Rotary Barrel / Monorail Hanger Shot Blaster", "T_blast = Batch cycle (8-15 min per basket / 50 parts)", "1 Finishing Technician (Grade C)"],
                    ["OP 110", "Secondary Machining", "CNC Horizontal / Vertical Machining Center", "Calculated via Machining Module (milling, drilling, tapping)", "1 CNC Machinist per 2 machines (0.5 FTE)"],
                    ["OP 120", "Inspection & NDT", "Magnetic Particle (MPI) / Ultrasonic (UT) / CMM", "T_insp = Statistical sampling (AQL) or 100% safety critical (30-120s)", "1 Certified Inspector Level II (Grade A+)"],
                    ["OP 130", "Tooling & Die Amortisation", "Die Maintenance Shop / CNC Sinker EDM", "Amortised = Total_Die_Set_Cost / Total_Production_Volume", "Die Shop Amortised Capital"]
                ]
            },
            {
                "type": "heading3",
                "text": "9.1 Die Tooling Cost Model"
            },
            {
                "type": "paragraph",
                "text": "Forging die tooling represents a substantial non-recurring engineering (NRE) investment. Total die cost comprises:\nDie_Cost = Die_Steel_Material + CNC_Rough_Machining + CNC_Finish_Machining + EDM_Die_Sinking + Heat_Treatment_Die + Die_Polishing + Bolster_Mounting\nWhere:\n- Die Block Material = Volume of Upper + Lower Die Blocks × Density × Steel Cost/kg (DIN 1.2714 / AISI H13).\n- Die cavity volume is sized to ensure 3× to 5× part depth thickness to resist bursting pressures.\n- Per-piece tooling cost = Die_Cost / N_pieces_total (or amortised per batch if replaced)."
            }
        ]
    },
    {
        "id": "10",
        "title": "10. Low-Level Design (LLD): Code Modules, Interfaces & SQL Schemas",
        "content": [
            {
                "type": "paragraph",
                "text": "This section specifies the exact TypeScript interfaces, Python classes, and PostgreSQL schema definitions required to implement the Forging Module across the repository."
            },
            {
                "type": "heading3",
                "text": "10.1 Backend TypeScript Architecture (backend/src/modules/bom-items/costing/forging/)"
            },
            {
                "type": "code",
                "language": "typescript",
                "text": """// backend/src/modules/bom-items/costing/forging/forging-types.ts

export type ForgingProcessType =
  | 'CLOSED_DIE_HOT'
  | 'WARM_FORGING'
  | 'COLD_HEADING'
  | 'OPEN_DIE_HAMMER'
  | 'UPSET_FORGING'
  | 'SEAMLESS_RING_ROLLING';

export interface ForgingGeometryInput {
  netVolumeMm3: number;
  projectedAreaMm2: number;
  partingPerimeterMm: number;
  partingPlaneNormal: [number, number, number];
  boundingBoxDimsMm: [number, number, number];
  maxRibHeightMm: number;
  minWebThicknessMm: number;
  minFilletRadiusMm: number;
  minCornerRadiusMm: number;
  undercutVolumeMm3: number;
  hasTrappedUndercuts: boolean;
  crossSectionAreaCurve: Array<{ positionMm: number; areaMm2: number }>;
}

export interface ForgingMaterialSpecs {
  grade: string;
  family: string;
  densityKgM3: number;
  forgingTempStartC: number;
  forgingTempFinishC: number;
  flowStressMpa: number;
  scaleLossPct: number;
  costPerKg: number;
  scrapCreditPerKg: number;
}

export interface ForgingMachineSpec {
  machineId: string;
  name: string;
  machineClass: 'HYDRAULIC_PRESS' | 'MECHANICAL_PRESS' | 'SCREW_PRESS' | 'DROP_HAMMER' | 'UPSETTER' | 'RING_MILL';
  ratedTonnageKn: number;
  energyCapacityKj?: number;
  bedWidthMm: number;
  bedDepthMm: number;
  maxStrokeMm: number;
  strokesPerMinute: number;
  machineRatePerHr: number;
  requiredCrewSize: number;
  crewWageGradeDistribution: Record<string, number>; // e.g. { 'GRADE_A_PLUS': 1, 'GRADE_A': 1, 'GRADE_B': 2 }
}

export interface ForgingCostSummaryDto {
  partId: string;
  process: ForgingProcessType;
  batchSize: number;
  annualVolume: number;
  
  // Weights (kg)
  netWeightKg: number;
  flashWeightKg: number;
  scaleLossKg: number;
  grossBilletWeightKg: number;
  materialYieldPct: number;

  // Cost Breakdown ($)
  rawMaterialCost: number;
  scrapCredit: number;
  netMaterialCost: number;
  
  forgingMachineCost: number;
  forgingLaborCost: number;
  heatingCost: number;
  trimmingCost: number;
  heatTreatmentCost: number;
  shotBlastingCost: number;
  secondaryMachiningCost: number;
  inspectionNdtCost: number;
  
  totalProcessCost: number;
  dieToolingSetCost: number;
  dieToolingAmortisedPerPart: number;
  
  piecePartCost: number;
  totalPieceCostWithTooling: number;
  
  // DFM Warnings
  dfmWarnings: Array<{ code: string; severity: 'INFO' | 'WARNING' | 'BLOCKER'; message: string }>;
}"""
            },
            {
                "type": "heading3",
                "text": "10.2 Pure Calculation Engine (forging-cost-engine.ts)"
            },
            {
                "type": "code",
                "language": "typescript",
                "text": """// backend/src/modules/bom-items/costing/forging/forging-cost-engine.ts

import { ForgingGeometryInput, ForgingMaterialSpecs, ForgingMachineSpec, ForgingCostSummaryDto, ForgingProcessType } from './forging-types';

export function calculateRequiredForgingTonnageKn(
  geom: ForgingGeometryInput,
  mat: ForgingMaterialSpecs,
  complexityFactor: number = 1.4,
  frictionCoeff: number = 0.35,
): number {
  // Flash land sizing
  const flashThicknessMm = 0.016 * Math.sqrt(geom.projectedAreaMm2) + 0.5;
  const flashLandWidthMm = 3.5 * flashThicknessMm;
  const flashAreaMm2 = geom.partingPerimeterMm * flashLandWidthMm;
  const totalProjectedAreaMm2 = geom.projectedAreaMm2 + flashAreaMm2;

  const charRadiusMm = Math.sqrt(geom.projectedAreaMm2 / Math.PI);
  const avgThicknessMm = Math.max(2.0, geom.netVolumeMm3 / geom.projectedAreaMm2);

  // Slab method with shape complexity and die friction
  const pressureMultiplier = 1.0 + (2.0 * frictionCoeff * charRadiusMm) / (3.0 * avgThicknessMm);
  const requiredLoadN = mat.flowStressMpa * complexityFactor * totalProjectedAreaMm2 * pressureMultiplier;

  return Math.round(requiredLoadN / 1000.0);
}

export function synthesizeGrossBilletWeightKg(
  geom: ForgingGeometryInput,
  mat: ForgingMaterialSpecs,
): { netWeightKg: number; flashWeightKg: number; scaleLossKg: number; grossWeightKg: number } {
  const netWeightKg = (geom.netVolumeMm3 * 1e-9) * mat.densityKgM3;
  
  const flashThicknessMm = 0.016 * Math.sqrt(geom.projectedAreaMm2) + 0.5;
  const flashLandWidthMm = 3.5 * flashThicknessMm;
  const flashVolumeMm3 = geom.partingPerimeterMm * flashLandWidthMm * flashThicknessMm;
  const flashWeightKg = (flashVolumeMm3 * 1e-9) * mat.densityKgM3;

  const subTotalKg = netWeightKg + flashWeightKg;
  const scaleLossKg = subTotalKg * (mat.scaleLossPct / 100.0);
  const sawKerfLossKg = 0.05 * netWeightKg; // Standard 5% saw / crop end allowance

  const grossWeightKg = subTotalKg + scaleLossKg + sawKerfLossKg;
  return { netWeightKg, flashWeightKg, scaleLossKg, grossWeightKg };
}"""
            },
            {
                "type": "heading3",
                "text": "10.3 Python OpenCASCADE Feature Extractor (cad-engine/forging/)"
            },
            {
                "type": "code",
                "language": "python",
                "text": """# cad-engine/forging/feature_extractor.py
from __future__ import annotations
import math
import logging
from typing import Any, Dict, List, Optional
from OCC.Core.BRepGProp import brepgprop
from OCC.Core.GProp import GProp_GProps
from OCC.Core.TopAbs import TopAbs_FACE
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
from OCC.Core.GeomAbs import GeomAbs_Plane, GeomAbs_Cylinder

logger = logging.getLogger(__name__)

class ForgingFeatureExtractor:
    \"\"\"Extracts B-Rep geometric features required for forging costing and DFM.\"\"\"

    def extract(self, shape: Any, bbox_dims: List[float], pull_axis: Optional[List[float]] = None) -> Dict[str, Any]:
        axis = pull_axis if pull_axis else [0.0, 0.0, 1.0]
        
        props = GProp_GProps()
        brepgprop.VolumeProperties(shape, props)
        net_volume = props.Mass()
        
        brepgprop.SurfaceProperties(shape, props)
        surface_area = props.Mass()
        
        # Analyze draft angles on all faces
        exp = TopExp_Explorer(shape, TopAbs_FACE)
        draft_angles: List[float] = []
        undercuts: List[Dict[str, Any]] = []
        parting_line_faces: List[int] = []
        face_idx = 0

        while exp.More():
            face = exp.Current()
            surf = BRepAdaptor_Surface(face)
            # Evaluate midpoint normal
            u_mid = (surf.FirstUParameter() + surf.LastUParameter()) / 2.0
            v_mid = (surf.FirstVParameter() + surf.LastVParameter()) / 2.0
            pnt, d1u, d1v = surf.D1(u_mid, v_mid)
            normal = d1u.Crossed(d1v)
            if normal.Magnitude() > 1e-6:
                normal.Normalize()
                cos_theta = normal.X() * axis[0] + normal.Y() * axis[1] + normal.Z() * axis[2]
                angle_deg = 90.0 - math.degrees(math.acos(max(-1.0, min(1.0, cos_theta))))
                draft_angles.append(angle_deg)
                if abs(angle_deg) < 1.0:
                    parting_line_faces.append(face_idx)
                elif angle_deg < -0.5:
                    undercuts.append({"face_id": face_idx, "angle_deg": round(angle_deg, 2)})
            face_idx += 1
            exp.Next()

        # Compute silhouette projected area on parting plane
        projected_area = bbox_dims[0] * bbox_dims[1] * 0.785 # Bounding ellipse approximation baseline
        parting_perimeter = 2.0 * (bbox_dims[0] + bbox_dims[1]) * 1.15

        return {
            "domain": "forging",
            "net_volume_mm3": round(net_volume, 2),
            "surface_area_mm2": round(surface_area, 2),
            "projected_area_mm2": round(projected_area, 2),
            "parting_perimeter_mm": round(parting_perimeter, 2),
            "primary_pull_axis": axis,
            "min_draft_angle_deg": round(min(draft_angles), 2) if draft_angles else 0.0,
            "has_undercuts": len(undercuts) > 0,
            "undercut_count": len(undercuts),
            "undercuts": undercuts,
            "parting_line_face_count": len(parting_line_faces)
        }"""
            },
            {
                "type": "heading3",
                "text": "10.4 Database Schemas & Migration Script (PostgreSQL)"
            },
            {
                "type": "code",
                "language": "sql",
                "text": """-- backend/src/database/migrations/950_create_forging_module_tables.sql
-- Enables Forging Machine, Materials, and Empirical Lookup Tables with Tenancy RLS

CREATE TABLE IF NOT EXISTS public.forging_machines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    machine_name VARCHAR(100) NOT NULL,
    machine_class VARCHAR(50) NOT NULL, -- 'HYDRAULIC_PRESS', 'MECHANICAL_PRESS', 'SCREW_PRESS', 'DROP_HAMMER', etc.
    rated_tonnage_kn NUMERIC(12,2) NOT NULL,
    energy_capacity_kj NUMERIC(10,2),
    bed_width_mm NUMERIC(10,2) NOT NULL,
    bed_depth_mm NUMERIC(10,2) NOT NULL,
    max_stroke_mm NUMERIC(10,2) NOT NULL,
    strokes_per_minute NUMERIC(6,2) NOT NULL,
    machine_rate_per_hr NUMERIC(10,2) NOT NULL,
    required_crew_size INT NOT NULL DEFAULT 2,
    crew_wage_distribution JSONB NOT NULL DEFAULT '{"GRADE_A": 1, "GRADE_B": 1}',
    location VARCHAR(50) NOT NULL DEFAULT 'USA',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.forging_lookup_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(100) NOT NULL, -- 'FLOW_STRESS', 'FRICTION_FACTOR', 'COMPLEXITY_FACTOR', 'DIE_LIFE'
    alloy_grade VARCHAR(50),
    key VARCHAR(100) NOT NULL,
    numeric_value NUMERIC(14,4),
    json_data JSONB,
    source_standard VARCHAR(100) DEFAULT 'DIN_7526 / ASM_VOL_14A',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.forging_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forging_lookup_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY forging_machines_read_policy ON public.forging_machines
    FOR SELECT USING (organization_id IS NULL OR organization_id = auth.current_organization_id());

CREATE POLICY forging_lookup_tables_read_policy ON public.forging_lookup_tables
    FOR SELECT USING (true); -- Master lookup reference data is readable by all authenticated tenants"""
            }
        ]
    },
    {
        "id": "11",
        "title": "11. DFM Rules, Quality Assurance & Engineering Standards",
        "content": [
            {
                "type": "paragraph",
                "text": "The Forging Module includes automated Design for Manufacturability (DFM) verification rules that inspect geometry against industry thresholds before costing is finalized:"
            },
            {
                "type": "table",
                "headers": ["Rule Code", "DFM Inspection Check", "Threshold Condition", "Severity", "Engineering Recommendation"],
                "rows": [
                    ["DFM-FRG-001", "Zero / Insufficient External Draft", "Draft Angle < 3.0° on non-parting faces", "WARNING", "Increase external draft to minimum 5° (steel) or 3° (aluminum) to avoid die sticking."],
                    ["DFM-FRG-002", "Trapped Undercut Geometry", "Surface normal dot product < -0.05", "BLOCKER", "Cannot forge in standard 2-piece dies. Requires split die, side-action core, or secondary CNC milling."],
                    ["DFM-FRG-003", "Sharp Fillet Radius", "Fillet Radius rf < 2.0 mm", "WARNING", "Risk of die cracking and cold shut flow defect. Increase fillet radius to minimum 3.5 mm."],
                    ["DFM-FRG-004", "Excessive Rib Aspect Ratio", "Rib Height / Rib Width > 4.5:1", "WARNING", "High cavity pressure and rapid die wear. Taper rib walls or increase web thickness."],
                    ["DFM-FRG-005", "Thin Web Section", "Web Thickness < 3.0 mm (Steel) / 2.0 mm (Al)", "BLOCKER", "Thin webs cool prematurely causing unfill defects and die damage. Thicken web."],
                    ["DFM-FRG-006", "High Tonnage Requirement", "Required Press Tonnage > Maximum Plant Machine", "BLOCKER", "Part exceeds plant press capacity. Reroute to hydraulic multi-action press or open-die preform."]
                ]
            }
        ]
    },
    {
        "id": "12",
        "title": "12. Implementation Plan & Delivery Milestones",
        "content": [
            {
                "type": "paragraph",
                "text": "The module implementation is partitioned into four phased engineering sprints across the 3 core layers:"
            },
            {
                "type": "table",
                "headers": ["Sprint Phase", "Scope & Deliverables", "Target Components", "Acceptance Criteria"],
                "rows": [
                    ["Phase 1: CAD Engine", "OpenCASCADE feature extractor, parting line & draft angle detection", "cad-engine/forging/", "Pass 25 unit tests on automotive crankshaft and connecting rod STEP models."],
                    ["Phase 2: Database & Seed", "Postgres migrations 950-953, seed 45 press machines & DIN lookup tables", "backend/src/database/migrations/", "All tables queryable with RLS tenant isolation verified in pgTAP tests."],
                    ["Phase 3: Cost Engine", "Pure calculation engine, physics tonnage, gross weight, multi-wage LHR", "backend/.../costing/forging/", "Cost calculation latency < 15ms; accurate within ±3% of benchmark quote data."],
                    ["Phase 4: Frontend & DFM", "Three.js 3D parting line viewer, DFM rule violation list, cost drivers", "components/bom/forging-intel/", "Visual display of parting line, draft angle heatmap, and one-click PDF quote export."]
                ]
            }
        ]
    }
]

