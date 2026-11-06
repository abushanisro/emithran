**eMithran**

**Product Requirements Document**

CAD-to-cost for Indian suppliers and OEMs, on Auth0 with client-owned data

| **Field**     | **Value**                                                                                |
|---------------|------------------------------------------------------------------------------------------|
| **Version**   | 2.0 (replaces the 30 Oct v1 doc)                                                         |
| **Date**      | 30 October 2026                                                                          |
| **Status**    | Draft for founder review                                                                 |
| **Owner**     | eMithran product                                                                         |
| **Companion** | eMithran Design Doc v2.0                                                                 |
| **Scope**     | Market, ICP, value proposition, pricing, KPIs, requirements, migration and release gates |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p><strong>In one sentence</strong></p>
<p>eMithran turns a CAD file into a defensible, operation-level should-cost in minutes, for the OEM that buys a part and the Indian supplier that quotes it, and enterprise clients keep their data in their own database and storage.</p></td>
</tr>
</tbody>
</table>

*Confidential. Prepared for eMithran internal planning. Market figures carry their source and date; items marked hypothesis are to be validated in pilots.*

**Contents**

1\. Executive summary

2\. Market and why now

3\. Market segments and ICP

4\. Personas and jobs to be done

5\. Value proposition

6\. Competition and alternatives

7\. Pricing and packaging

8\. KPIs and success metrics

9\. Product scope

10\. Data promise and editions

11\. Requirements

12\. Migration programme (product view)

13\. Release gates and acceptance

14\. Risks, open questions, decision log

15\. Sources

# 1. Executive summary

eMithran turns a 3D CAD file into a line-by-line should-cost in minutes. It serves the OEM that buys a part and the Indian supplier that quotes it, and enterprise clients can keep their data in their own database and storage.

## The pitch

Indian component makers sell into OEM programmes that now demand open-book cost breakdowns, at prices squeezed by a 25% US tariff on auto parts. On the other side of the table, OEM cost engineers have too few people to challenge every quote. Both sides still estimate in spreadsheets. The enterprise tools that automate this cost **USD 400K to 900K+ in year one** and take 3 to 6 months to produce a first estimate (Boothroyd Dewhurst pricing guide, Mar 2026). That puts them out of reach for most Indian suppliers and for many Indian OEM teams.

eMithran already has the hard part built: STEP feature extraction on OpenCascade, a routing and process-engine registry, and live costing engines for sheet metal, CNC machining and injection moulding. Around them sit BOM, supplier evaluation and nomination, RFQ, VAVE and production modules. This PRD turns that engine into a product for two beachhead segments, at a price between job-shop tools and enterprise suites, on an architecture enterprise IT can approve.

| **Question**         | **Answer**                                                                                                                                                                                         |
|----------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Who buys first**   | Tier-1/2 component suppliers in India that quote domestic and export RFQs (beachhead A), and OEM cost-engineering and sourcing teams (beachhead B).                                                |
| **What they get**    | CAD-to-cost estimates with process routing, machine and labour rates by region, and a cost breakdown they can defend in a negotiation.                                                             |
| **Why now**          | India auto components reached INR 7.60 lakh crore in FY26 (+12.7%). US tariffs squeeze exporters, the India-EU FTA concluded on 27 Jan 2026, and DPDP obligations take full effect on 13 May 2027. |
| **Why eMithran**     | Covers both sides of the RFQ, is priced for Indian budgets, has India rate data built in, and offers a client-owned data plane so CAD and costs never rest on eMithran servers.                    |
| **Commercial model** | Platform fee plus seats. Dedicated client-owned data plane as the enterprise tier.                                                                                                                 |
| **Stage**            | Pre-revenue. The next milestone is three paid pilots (two suppliers, one OEM) with measured accuracy and time saved.                                                                               |

## Decisions locked in this version

| **Decision**                     | **Choice**                                                                                                                               | **Owner**          |
|----------------------------------|------------------------------------------------------------------------------------------------------------------------------------------|--------------------|
| **Identity provider**            | Auth0, one Auth0 Organization per eMithran organization; enterprise SSO through federation                                               | Founders           |
| **Deployment model**             | eMithran runs all code. Pooled data plane for most clients; client-owned Postgres and bucket for enterprise                              | Founders           |
| **Multi-organization users**     | Allowed, including across data planes; the active organization is verified on every request                                              | Product            |
| **AI on client data**            | Per-tenant setting: off, eMithran provider under a no-training contract, or the client's own endpoint. Default off for dedicated tenants | Product + Security |
| **Who runs a client data plane** | Client IT by default with eMithran's runbook; eMithran-managed in the client's account as a paid option                                  | Founders           |
| **Pricing**                      | Platform fee plus seats; three tiers plus a credited pilot                                                                               | Founders           |
| **Migration recovery**           | Reversible until the point of no return; forward-fix only after it. No reverse sync is promised                                          | Engineering        |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p><strong>What changed from v1 (review response)</strong></p>
<p>The data promise now separates <strong>at rest</strong> (client only) from <strong>in use</strong> (passes through eMithran compute, never persisted) and lists every location data can appear (section 10).</p>
<p>Rollback is one policy in both documents: reversible before the point of no return, forward-fix after it (section 12).</p>
<p>Identity linking, multi-organization use and the 30-minute idle timeout are defined with a server-side session store (section 11.3).</p>
<p>Lifecycle, SLAs and release gates now state measurement conditions and how CI enforces them (sections 11.5 and 13).</p></td>
</tr>
</tbody>
</table>

# 2. Market and why now

The Indian auto component industry is large, growing and under margin pressure from tariffs and open-book OEM demands. Cost estimation is the bottleneck on both sides of every RFQ.

<img src="media/4e66cae2ca9adfe316c3a570c9aefeb188745b27.png" title="Indian auto component industry, FY2025-26 (ACMA). Exports grew more slowly than imports, which squeezes exporters." style="width:6.69792in;height:3.03125in" alt="Indian auto component industry, FY2025-26 (ACMA). Exports grew more slowly than imports, which squeezes exporters." />

*Figure 1. Indian auto component industry, FY2025-26 (ACMA). Exports grew more slowly than imports, which squeezes exporters.*

## Five forces that make this the moment

| **Force**                    | **Evidence (source, date)**                                                                                                                                                   | **What it means for eMithran**                                                                       |
|------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| **Scale and growth**         | Turnover INR 7.60 lakh crore (USD 85.9B), +12.7% in FY26; supplies to OEMs +16.3% (ACMA via Autocar Professional, 7 Jul 2026)                                                 | Thousands of suppliers quote more parts each year; estimation capacity does not scale with headcount |
| **Export margin squeeze**    | Auto parts to the US face a uniform 25% tariff; ACMA says absorbing it "is extremely difficult for an industry that operates on thin margins" (Autocar Professional, H1 FY26) | Suppliers must know their true cost per part to decide which RFQs to chase and where to cut          |
| **New export corridor**      | India-EU FTA negotiations concluded 27 Jan 2026; tariffs on car parts phase out over 5 to 10 years (Autocar Professional analysis)                                            | EU sourcing teams will send more RFQs to India and expect cost transparency                          |
| **Data protection law**      | DPDP Rules 2025 notified 13 Nov 2025; most fiduciary obligations apply from 13 May 2027; breach reports within 72 hours (S.S. Rana & Co.)                                     | Buyers ask where data lives; a client-owned data plane answers that directly                         |
| **OEM information security** | TISAX assessments (VDA ISA) are requested from tier-1 to tier-n suppliers handling OEM data, prototypes and IP (DQS India)                                                    | Suppliers handling German OEM CAD need controlled storage; eMithran must not become their weak link  |

## The problem in one picture

Every RFQ creates two estimates of the same part: the supplier's quote and the OEM's target or should-cost. Both are usually built by hand in spreadsheets from drawings, machine-hour rates and experience. The result is slow quotes, unexplained gaps between quote and target, and negotiations on opinion rather than cost drivers.

| **Pain**           | **Supplier side**                                                                           | **OEM side**                                                       |
|--------------------|---------------------------------------------------------------------------------------------|--------------------------------------------------------------------|
| **Speed**          | Estimators are the bottleneck; quotes take days and some RFQs are declined for lack of time | Too few cost engineers to check more than the largest parts        |
| **Consistency**    | Rates and scrap assumptions differ by estimator and live in personal spreadsheets           | Targets differ by buyer; no shared cost model across commodities   |
| **Defensibility**  | Open-book breakdowns are rebuilt by hand for each customer format                           | Quotes are black boxes; negotiation relies on history, not drivers |
| **Knowledge loss** | When a senior estimator leaves, the method leaves too                                       | VAVE ideas and cost learnings are not reused across programmes     |
| **Tool cost**      | Job-shop tools lack OEM-grade breakdowns; enterprise suites are unaffordable                | Enterprise suites need six-figure budgets and months of setup      |

*Note: the pain table is a product hypothesis drawn from the existing product design and public vendor material. It is validated through pilot discovery interviews (section 8.4).*

# 3. Market segments and ICP

Two beachheads, one product: Indian Tier-1/2 suppliers that quote export and domestic RFQs, and OEM cost and sourcing teams. Engineering-services firms come next; electronics and job shops wait.

<img src="media/4d3ce67488b7955fd37dffc0a9b829fc76841752.png" title="Segment map: two beachheads, one expansion segment, one later segment and an explicit &quot;not now&quot;." style="width:5.28125in;height:3.26042in" alt="Segment map: two beachheads, one expansion segment, one later segment and an explicit &quot;not now&quot;." />

*Figure 2. Segment map: two beachheads, one expansion segment, one later segment and an explicit "not now".*

## 3.1 Segment alternatives compared

Seven segments were scored from 1 (poor) to 5 (strong) on six criteria. Scores are a structured judgment from product capability today and the market evidence in section 2, not survey data. They should be re-scored after ten discovery interviews.

| **Segment**                                                         | **Pain** | **Ability to pay** | **Fit today** | **Data-plane value** | **Sales cycle** | **Reach** | **Total** |
|---------------------------------------------------------------------|----------|--------------------|---------------|----------------------|-----------------|-----------|-----------|
| **Tier-1/2 suppliers, sheet metal, machining, moulding, exporting** | 5        | 3                  | 5             | 4                    | 4               | 4         | 25        |
| **Indian OEM cost and sourcing teams**                              | 4        | 4                  | 4             | 5                    | 2               | 3         | 22        |
| **Global OEM sourcing offices / GCCs in India**                     | 4        | 5                  | 3             | 5                    | 2               | 3         | 22        |
| **Engineering-services and VAVE consultancies**                     | 3        | 3                  | 4             | 3                    | 4               | 3         | 20        |
| **EMS / electronics (PCBA, box build)**                             | 4        | 3                  | 2             | 3                    | 3               | 3         | 18        |
| **Job shops under INR 50 crore revenue**                            | 4        | 1                  | 4             | 1                    | 5               | 2         | 17        |
| **Aerospace and defence (air-gapped)**                              | 3        | 4                  | 2             | 2                    | 1               | 1         | 13        |

*Sales cycle: 5 = shortest. Data-plane value: how much the client-owned data plane matters to the buyer.*

## 3.2 Ideal customer profile

| **Attribute**             | **Beachhead A: supplier**                                                               | **Beachhead B: OEM**                                                                           |
|---------------------------|-----------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| **Who**                   | Tier-1/2 component maker in India                                                       | OEM (auto, off-highway, industrial equipment) or a global OEM sourcing office in India         |
| **Size**                  | INR 100 to 5,000 crore revenue; 3 to 20 people who estimate or price                    | 5 to 50 cost engineers, commodity buyers and VAVE engineers                                    |
| **Processes**             | Sheet metal, CNC machining, injection moulding (live engines); casting and forging next | Mixed commodities; sheet metal, machined and moulded parts are the bulk of the first use cases |
| **Customers / suppliers** | Sells to domestic OEMs and at least one export customer (US, EU, Japan)                 | Buys from a supplier base that includes Indian suppliers                                       |
| **Volume**                | 50 to 500 RFQs a month, many with 3D CAD                                                | 200+ parts a year that merit a should-cost                                                     |
| **Current method**        | Excel templates, machine-hour-rate sheets, a few senior estimators                      | Excel, supplier quotes, occasional consultant studies; maybe a legacy enterprise tool          |
| **Trigger events**        | Export RFQ wave, open-book demand from an OEM, tariff hit, estimator attrition          | Cost-down target, new programme sourcing, VAVE drive, localisation push                        |
| **Data stance**           | Must protect OEM CAD (TISAX-style requests); pooled data plane acceptable for most      | CAD and costs are confidential; dedicated data plane likely required                           |
| **Economic buyer**        | MD, CEO or CFO                                                                          | Head of Cost Engineering or VP Purchasing                                                      |

## 3.3 Who we do not target now

- **Job shops below INR 50 crore**: the pain is real but the budget is low. Quoting tools for job shops already exist; Paperless Parts reports 800+ customers worldwide.

- **Air-gapped aerospace and defence**: needs an on-premises install, which conflicts with the decision to keep code with eMithran.

- **Electronics-only buyers**: the ECAD module exists, but sheet metal, machining and moulding are further ahead. Revisit when PCBA costing reaches the same accuracy bar.

# 4. Personas and jobs to be done

Six roles decide whether eMithran is bought and used. Four use it daily; two approve it.

| **Persona**                      | **Segment** | **Goal**                                     | **Top pain**                            | **Success measure**               | **Buying role**          |
|----------------------------------|-------------|----------------------------------------------|-----------------------------------------|-----------------------------------|--------------------------|
| **Estimation manager**           | Supplier    | Send accurate quotes faster than competitors | Estimators overloaded; quotes take days | Quotes sent per week; win rate    | Champion, daily user     |
| **Estimator / costing engineer** | Supplier    | Build a defensible cost from a drawing       | Re-keying features and rates            | Minutes per estimate; rework      | Daily user               |
| **MD / CFO**                     | Supplier    | Protect margin on export business            | Unknown true cost per part              | Gross margin by customer          | Economic buyer           |
| **Head of cost engineering**     | OEM         | Cover more spend with should-costs           | Team too small; tools too expensive     | Spend covered; savings identified | Economic buyer, champion |
| **Commodity buyer**              | OEM         | Negotiate on cost drivers                    | Supplier quotes are black boxes         | Savings realised; cycle time      | Daily user               |
| **IT / InfoSec lead**            | Both        | Approve without new data risk                | SaaS holding CAD and costs              | Passed security review            | Gatekeeper               |

## 4.1 Jobs to be done

1.  **When** an RFQ with a STEP file arrives, **I want** a cost breakdown by operation within the hour, **so that** I can decide to bid and at what price.

2.  **When** an OEM asks for open-book costing, **I want** to export the breakdown in their format, **so that** I do not rebuild it by hand.

3.  **When** a supplier quote looks high, **I want** an independent should-cost with the drivers, **so that** I negotiate on facts.

4.  **When** we start a VAVE drive, **I want** to see which features and processes drive cost, **so that** I pick ideas worth engineering time.

5.  **When** my security team reviews a vendor, **I want** proof that our CAD and costs stay in our account, **so that** approval takes weeks, not quarters.

6.  **When** a senior estimator leaves, **I want** our rates and methods in the system, **so that** quality does not leave with them.

# 5. Value proposition

One engine, two messages: suppliers quote faster with breakdowns OEMs accept; OEMs know what a part should cost before they negotiate. Enterprise IT gets data that never rests outside its own account.

## 5.1 Positioning statement

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p><strong>Positioning</strong></p>
<p>For Indian component suppliers and the OEM teams that buy from them, who estimate part costs by hand, eMithran is a CAD-to-cost platform that produces a defensible, operation-level should-cost in minutes. Unlike enterprise should-cost suites, it is priced for Indian budgets, ships with India and export-market rate data, serves both sides of the RFQ, and can keep every file and figure in the client's own database and storage.</p></td>
</tr>
</tbody>
</table>

## 5.2 Value by segment

|                                | **Supplier (beachhead A)**                                                                      | **OEM (beachhead B)**                                                       | **Enterprise IT (gatekeeper)**                                         |
|--------------------------------|-------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|------------------------------------------------------------------------|
| **Headline**                   | Quote export RFQs in hours, with breakdowns OEM buyers accept                                   | Know what a part should cost before you negotiate                           | Your CAD and cost data stay in your account                            |
| **Pain relievers**             | CAD feature extraction replaces manual take-off; shared rate tables; one-click open-book export | Independent should-cost per part; supplier comparison; cost drivers visible | Client-owned Postgres and bucket; SSO; per-tenant AI switch; audit log |
| **Gain creators**              | More RFQs answered; margin visibility per part; methods retained                                | More spend covered per engineer; faster nomination; VAVE pipeline           | Faster security approval; DPDP-ready data handling; revocable access   |
| **Proof to collect in pilots** | Minutes per estimate vs baseline; accuracy vs accepted quotes                                   | Savings identified as % of addressed spend; parts covered per month         | Security questionnaire passed; revocation drill                        |

## 5.3 Messaging pillars

1.  **Minutes, not days.** Upload STEP, get the route, cycle times and cost.

2.  **Defensible.** Every number traces to a feature, a machine, a rate and a formula, not a black box.

3.  **Both sides of the table.** The same cost language for the supplier and the buyer.

4.  **Your data, your account.** Enterprise data at rest stays in your Postgres and storage.

5.  **Priced for India.** A fraction of enterprise suites, with no six-month implementation.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p><strong>Claims we do not make yet</strong></p>
<p>No savings percentage, accuracy figure or time-saved number is used in sales material until at least two pilots have measured it with the method in section 8. Until then the messages above stay qualitative.</p></td>
</tr>
</tbody>
</table>

# 6. Competition and alternatives

Buyers choose between spreadsheets, job-shop quoting tools, parametric estimators and enterprise should-cost suites. eMithran sits between the last two on price and covers both sides of the RFQ.

<img src="media/80b1ebbd59075c12452aaec403eb71571c59c778.png" title="Qualitative positioning: who the primary user is, and how CAD-driven the costing is." style="width:5.96875in;height:3.8125in" alt="Qualitative positioning: who the primary user is, and how CAD-driven the costing is." />

*Figure 3. Qualitative positioning: who the primary user is, and how CAD-driven the costing is.*

## 6.1 Competitor table

| **Alternative**                    | **What it is**                                                                      | **Where it is strong**                                              | **Where eMithran wins**                                | **Year-1 cost**    |
|------------------------------------|-------------------------------------------------------------------------------------|---------------------------------------------------------------------|--------------------------------------------------------|--------------------|
| **Excel + in-house templates**     | Status quo at most suppliers and many OEMs                                          | Free, flexible, familiar                                            | Speed, consistency, CAD automation, retained knowledge | Staff time         |
| **Enterprise should-cost incumbents** | Enterprise digital-factory should-cost                                              | Deep process simulation, large enterprise base                      | Price, time to value, India rates, supplier-side use   | USD 400K-900K+ (a) |
| **Teamcenter PCM (Siemens)**       | Product cost management inside Teamcenter; delivered through partners such as CLEVR | Should-cost, target and quotation costing, tooling, SAP integration | No PLM dependency, lighter rollout, price              | Not published      |
| **Tset**                           | Cost and CO2 simulation, Vienna; raised about EUR 13M in 2023 (Brose Ventures, ZF)  | Cost plus carbon, European automotive                               | India rates and pricing, supplier quoting workflow     | Not published      |
| **SEER / parametric tools**        | Parametric estimating (Galorath and similar)                                        | Early-phase estimates with little data                              | Part-level, CAD-driven detail                          | USD 50K-200K (a)   |
| **DFMA (Boothroyd Dewhurst)**      | Design for manufacture and assembly with costing                                    | Design-stage DFM, long track record                                 | Supplier quoting, procurement workflow                 | USD 16.5K-228K (a) |
| **Costimator (MTI)**               | Job-shop cost estimating                                                            | Low price, quick start                                              | OEM-grade breakdowns, CAD automation, multi-process    | USD 5K-30K (a)     |
| **Paperless Parts**                | Quoting and collaboration for job shops and contract manufacturers; 800+ customers  | Quote workflow, US job shops                                        | OEM side, India rates, should-cost depth               | Not published      |
| **Consultants / teardown studies** | Project-based should-cost studies                                                   | Expert judgment                                                     | Continuous, in-house, cheaper per part                 | Per project        |

*(a) Ranges from the Boothroyd Dewhurst should-cost software pricing guide, March 2026. That is a vendor-authored comparison and should be treated as indicative. Paperless Parts figures are from its company page; Tset from its March 2023 press release; Teamcenter PCM capabilities from CLEVR.*

## 6.2 Go-to-market alternatives

| **Option**               | **How it works**                                                               | **Pros**                                         | **Cons**                            | **Verdict**            |
|--------------------------|--------------------------------------------------------------------------------|--------------------------------------------------|-------------------------------------|------------------------|
| **A. Supplier-first**    | Sell to Tier-1/2 exporters through ACMA clusters (Pune, Chennai, NCR, Gujarat) | Shorter cycles, many accounts, product fit today | Lower ACV, price-sensitive          | Lead with this         |
| **B. OEM-first**         | Sell to cost-engineering and sourcing heads                                    | Higher ACV, strong references                    | 6-12 month cycles, security reviews | One design partner now |
| **C. Two-sided network** | OEM invites its suppliers to submit cost breakdowns in eMithran                | Network effect, lock-in                          | Needs trust on both sides first     | After 3+ OEM accounts  |
| **D. Services-led**      | eMithran engineers deliver should-cost studies using the tool                  | Revenue now; learn the domain                    | Does not scale; margin              | Only inside pilots     |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p><strong>Recommendation</strong></p>
<p>Lead with suppliers (A), sign one OEM design partner (B) to shape should-cost and supplier-comparison features, and use services (D) only to make pilots succeed. Move to the two-sided model (C) once three OEM accounts exist.</p></td>
</tr>
</tbody>
</table>

# 7. Pricing and packaging

Platform fee plus seats, three tiers and a credited pilot. Prices are hypotheses to be tested in the first five deals.

| **Tier**                   | **For**                         | **Price (hypothesis)**                                                                | **Includes**                                                                          |
|----------------------------|---------------------------------|---------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------|
| **Pilot (90 days)**        | Any ICP account                 | INR 3 lakh fixed, credited to year-one subscription                                   | Up to 5 users, 100 parts, onboarding of rates, weekly review                          |
| **Supplier Pro**           | Beachhead A                     | INR 7 lakh/yr platform incl. 3 seats; extra seat INR 60,000/yr                        | Sheet metal, machining and moulding engines; RFQ; open-book export; pooled data plane |
| **OEM Team**               | Beachhead B                     | INR 25 lakh/yr incl. 10 seats; extra seat INR 1.2 lakh/yr; VAVE add-on INR 10 lakh/yr | Should-cost, supplier evaluation and nomination, benchmarks; SSO; pooled or dedicated |
| **Enterprise Dedicated**   | Large OEMs, sensitive suppliers | From INR 60 lakh/yr incl. 25 seats; managed data plane option INR 15-30 lakh/yr       | Client-owned Postgres and bucket, per-tenant AI policy, audit export, named support   |
| **Export (USD contracts)** | Global buyers                   | List USD 9K / 30K / 75K for the three tiers                                           | Same packaging, billed in USD                                                         |

<img src="media/c8de98269cea9b50cc74f023e958097acb1a8757.png" title="Year-one cost: eMithran tiers against published ranges for alternatives." style="width:5.69792in;height:2.88542in" alt="Year-one cost: eMithran tiers against published ranges for alternatives." />

*Figure 4. Year-one cost: eMithran tiers against published ranges for alternatives.*

## Pricing logic

- Anchor below enterprise suites (USD 400K+) and above job-shop tools (USD 5K-30K), where the OEM-grade breakdown is the difference.

- The platform fee covers the fixed cost of rate data, onboarding and the data plane; seats scale with value delivered.

- The dedicated data plane is priced as a tier, not a discount lever, because it carries real operating cost.

- Test willingness to pay in each pilot with a simple ask: "At INR X a year, would you renew?" Record the answer and the reason.

*Conversion uses INR 88.5 per USD, implied by ACMA's FY26 figures (INR 7.60 lakh crore = USD 85.9B).*

# 8. KPIs and success metrics

One North Star: decision-grade estimates per week. These are estimates a customer actually uses in a quote, a negotiation or a nomination. Every other KPI feeds it.

<img src="media/d21ccbf349f1beb9f2962d437ea99412617d0bcb.png" title="KPI tree: four input metrics feed the North Star." style="width:5.83333in;height:1.96875in" alt="KPI tree: four input metrics feed the North Star." />

*Figure 5. KPI tree: four input metrics feed the North Star.*

## 8.1 Product KPIs

| **KPI**                                          | **Definition**                                                                                                   | **Pilot target**         | **12-month target**                  | **Source of truth**        |
|--------------------------------------------------|------------------------------------------------------------------------------------------------------------------|--------------------------|--------------------------------------|----------------------------|
| **Decision-grade estimates / week (North Star)** | Estimates exported into a quote, RFQ response, negotiation pack or nomination                                    | Measured from week 2     | +20% month on month in paid accounts | Export and decision events |
| **Time to first trusted estimate**               | Days from kickoff to the first estimate the customer uses                                                        | Within 7 days            | Within 3 days                        | Onboarding log             |
| **Estimate cycle time**                          | Median minutes from CAD upload to reviewed estimate, by process                                                  | Baseline in week 1; -50% | -70% vs baseline                     | Event timestamps           |
| **Accuracy**                                     | Share of estimates within +/-10% (sheet metal) or +/-15% (machining, moulding) of the accepted quote or PO price | 70% of compared parts    | 80%                                  | Pilot comparison set       |
| **CAD auto-costing rate**                        | Valid STEP parts costed without manual feature entry                                                             | 80% sheet metal          | 85% across live engines              | cad_uploads states         |
| **Weekly active cost users**                     | Seats with at least one estimate in the week / licensed seats                                                    | 60%                      | 70%                                  | Product analytics          |
| **Outcome: OEM**                                 | Savings identified as % of addressed spend; savings realised                                                     | Measure                  | 5% identified (hypothesis)           | Customer-confirmed         |
| **Outcome: supplier**                            | RFQ turnaround days; win rate change                                                                             | Measure                  | -50% turnaround                      | Customer-confirmed         |

## 8.2 Business KPIs

| **KPI**                                      | **Target**                                 | **Note**                             |
|----------------------------------------------|--------------------------------------------|--------------------------------------|
| **Paid pilots started**                      | 3 (2 suppliers, 1 OEM) by 31 Mar 2027      | End of FY27                          |
| **Pilot-to-subscription conversion**         | 2 of 3                                     | Decision within 30 days of pilot end |
| **Average contract value, year one**         | INR 10 lakh supplier; INR 30 lakh OEM      | Hypothesis                           |
| **Sales cycle (first meeting to signature)** | Supplier under 60 days; OEM under 180 days | Track by segment                     |
| **Gross logo retention**                     | 90% or more                                | From year two                        |
| **Net revenue retention**                    | 110% or more                               | Seat expansion and VAVE add-on       |

## 8.3 Platform KPIs (with measurement conditions)

| **KPI**                  | **Target**                                                                                        | **Measured how**                                                                                                                                                                                      |
|--------------------------|---------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Monthly availability** | Contract: 99.0% (about 7.3 h a month) until six months of measured data exist. Internal SLO: 99.5% (about 3.65 h). For dedicated tenants, eMithran components only; the client's own database and bucket are excluded. Region loss is a disaster under the DR terms (11.5), not an SLA event | External probe on the BFF every 60 s, from India region; failover and disaster recovery are separated (design doc 16.4) |
| **API latency**          | p50 80 ms, p95 200 ms (pooled) / 250 ms (dedicated, same region), p99 600 ms. A dedicated data plane in another region has its own p95, 800 ms unless the contract states otherwise | Server time at the BFF, in region. Load test: 50 concurrent users, 20,000 BOM items per tenant, 30-minute steady state, CRUD endpoints only; dedicated data plane in the same cloud region with RTT of 5 ms or less. User-perceived latency is reported per user region and is not a target |
| **CAD analysis**         | 95% of valid STEP files up to 100 MB analysed; p95 time reported per size band                    | cad_uploads outcomes; files over the limit rejected up front                                                                                                                                          |
| **Tenant isolation**     | 100% of two-tenant negative tests pass on every release                                           | CI against real Postgres with production roles (design doc section 7)                                                                                                                                 |
| **Revocation**           | eMithran suspension: no new operation within 60 s. Client revocation with the supplied script, a privilege revoke, the KMS key or the bucket policy: immediate. Password change alone: within 30 min. Issued download links expire within 5 min | Quarterly drill per dedicated tenant |
| **Recovery (pooled)**    | Instance or zone failure: automatic failover in under 5 min. Corruption or bad migration: RPO 5 min, RTO under 2 h for a database under 100 GB. Region loss: RPO 15 min, RTO 4 h | Monthly point-in-time restore drill; failover test each quarter |

## 8.4 Pilot success criteria

1.  Customer supplies 50 or more real parts with known accepted quote or PO prices; eMithran costs them blind.

2.  Accuracy target met on the comparison set (section 8.1), with misses explained by named data gaps.

3.  Median time per estimate at least 50% lower than the week-1 baseline the customer measured.

4.  Three or more weekly active users for the last four weeks.

5.  An executive sponsor signs a one-page result and states a renewal decision.

# 9. Product scope

The pilot product is the existing costing engine with a shorter path from STEP file to exported breakdown. Most of the work is finishing, packaging and trust, not new modules.

## 9.1 What exists today (from the repository)

| **Capability**                                        | **State**                                                                                                        | **Evidence**                                                                |
|-------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| **STEP analysis (assembly, part features, DFM, PMI)** | Live                                                                                                             | cad-engine FastAPI + OpenCascade; contract v1; 100 MB limit; 900 s watchdog |
| **Costing engines**                                   | Sheet metal (priority), CNC machining, injection moulding live; die casting extractor                            | backend/src/modules/bom-items, cost-cnc-engine, injection-molding/          |
| **Platform layering**                                 | CAD -\> features -\> capability -\> routing -\> process registry -\> machine match -\> cost -\> versioned result | docs/ENGINEERING.md                                                         |
| **Rate data**                                         | MHR/LHR databases, raw materials, about 30 process reference folders                                             | memory/, backend/data                                                       |
| **BOM, projects, reports**                            | Live                                                                                                             | boms, projects, project-reports modules                                     |
| **Suppliers**                                         | Vendors, evaluation, groups, nominations, quotes, RFQ email                                                      | supplier-\* and rfq modules                                                 |
| **VAVE**                                              | In progress; paid add-on; target cycle 20-30 weeks to 14-20 weeks                                                | docs/VAVE_AI_Module_Build_Guide.md                                          |
| **Production, quality, delivery**                     | Live, with known tenancy gaps in delivery/QC (EA-002)                                                            | issue register                                                              |
| **Electronics costing**                               | Present, less mature                                                                                             | electronics-costing module                                                  |

## 9.2 Pilot scope (must have)

- Upload STEP or assembly; automatic route and cost for sheet metal, machining and moulding parts.

- Editable assumptions with an audit trail: rates, material price, volume, scrap, overheads.

- Open-book export to Excel and PDF in a customer template.

- Supplier view: quote builder with margin. OEM view: should-cost against supplier quote with driver differences.

- Organization, roles and SSO through Auth0; pooled data plane; dedicated data plane for the OEM pilot if required.

- Pilot analytics: cycle time, accuracy comparison set, weekly active users.

## 9.3 Roadmap

| **Horizon**               | **Product**                                                                | **Platform**                                                              |
|---------------------------|----------------------------------------------------------------------------|---------------------------------------------------------------------------|
| **Now (pilots)**          | Pilot scope above; India and export rate packs; open-book templates        | Phase 0-2: hygiene, cutover to Auth0 + Postgres, tenancy foundation       |
| **Next (first renewals)** | VAVE phase 1; supplier comparison dashboards; casting and forging engines  | Phase 3: first dedicated client data plane; AI gateway                    |
| **Later**                 | Two-sided OEM-supplier exchange; ERP/PLM connectors; electronics at parity | Phase 4: PostgREST and Supabase removed; Kubernetes only if load requires |

# 10. Data promise and editions

Precise wording matters to security reviewers. Enterprise data at rest lives only in the client's environment. Data in use passes through eMithran compute in memory and is never persisted, logged or cached there. eMithran stores a small, declared set of identity and operational metadata.

<img src="media/a174f1020b2abc484a71275720eccdd9069c55f2.png" title="What stays with the client, what passes through eMithran, and what eMithran stores." style="width:5.96875in;height:2.96875in" alt="What stays with the client, what passes through eMithran, and what eMithran stores." />

*Figure 6. What stays with the client, what passes through eMithran, and what eMithran stores.*

## 10.1 Customer-facing statement (dedicated data plane)

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p><strong>Our data commitment</strong></p>
<p>1. Your business data and files are stored only in your Postgres database and your object storage, encrypted with your keys.</p>
<p>2. To compute costs, eMithran software processes your data in memory and in a temporary per-job workspace on eMithran servers. That workspace is deleted when the job ends or fails, and nothing from it is written to disk, logs, backups or caches.</p>
<p>3. eMithran stores only what it needs to sign you in and run the service: user names, emails, roles, organization memberships, job identifiers, audit events and metrics.</p>
<p>4. AI features are off for your tenant unless your administrator turns them on and chooses the provider: eMithran's provider under a no-training, no-retention contract, or your own model endpoint.</p>
<p>5. You can revoke eMithran's access at any time. Disabling your encryption key or denying eMithran in your bucket policy stops file access at once. Running the revocation script we supply, or revoking the privileges of eMithran's database role, stops database access at once; changing the role's password alone stops it within 30 minutes. Download links already issued expire within 5 minutes.</p>
<p>6. eMithran support staff cannot read your data unless you grant time-boxed access, which is logged.</p></td>
</tr>
</tbody>
</table>

## 10.2 Data location inventory

| **Where**                  | **What can appear**                                                     | **Retention**                                                | **Control**                                           |
|----------------------------|-------------------------------------------------------------------------|--------------------------------------------------------------|-------------------------------------------------------|
| **Client Postgres**        | All business data                                                       | Client policy                                                | Client backups and keys                               |
| **Client bucket**          | CAD, drawings, attachments, exports                                     | Client policy                                                | SSE-KMS with client key                               |
| **eMithran API memory**    | Request and response bodies                                             | Duration of request                                          | Payload logging disabled by allow-list logger         |
| **Worker tmpfs (per job)** | CAD file being analysed                                                 | Until job end; sweeper deletes leftovers older than 30 min   | tmpfs, swap off, core dumps off, size and time limits |
| **Control-plane queue**    | tenant id, org id, upload id, idempotency key                           | 7 days after completion                                      | No file names or contents                             |
| **Logs and traces**        | Ids, timings, status codes; filenames hashed; URL query strings removed | 30 days                                                      | Redaction tested with canary values                   |
| **Session store**          | Session id, user id, active org, timestamps, encrypted refresh token    | Until expiry plus 7 days                                     | Encrypted column, control plane                       |
| **Identity records**       | Name, email, roles, memberships                                         | Life of account plus 1 year (DPDP Rule 8(3) processing logs) | Auth0 + control plane                                 |
| **Model provider**         | Prompts and extracted drawing content                                   | Per provider contract (zero retention required)              | Only when tenant AI mode allows                       |
| **Support access**         | Screens the client shares or grants                                     | Session only                                                 | Break-glass grant by client admin, audited            |

## 10.3 Editions

| **Edition**                      | **Data plane**                                                                         | **Who runs it**                            | **Fits**                              |
|----------------------------------|----------------------------------------------------------------------------------------|--------------------------------------------|---------------------------------------|
| **Pooled**                       | eMithran-managed Postgres and bucket in India region; isolated by organization and RLS | eMithran                                   | Supplier Pro, OEM Team                |
| **Dedicated (client-run)**       | Client Postgres 16+ and S3-compatible bucket in the client's account                   | Client IT, with eMithran runbook           | Enterprise Dedicated                  |
| **Dedicated (eMithran-managed)** | Same, inside the client's cloud account                                                | eMithran under a managed-service agreement | Enterprise Dedicated + managed option |

# 11. Requirements

Requirements are written so a test can pass or fail them. Implementation choices live in the design doc.

## 11.1 Functional

| **ID**  | **Requirement**                                                                                                                              | **Acceptance test**                                                         |
|---------|----------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| **F1**  | Sign in with email and password, Google, or the client's enterprise SSO through Auth0                                                        | Each method signs in a test user in stage                                   |
| **F2**  | Invite-only access; an authenticated but uninvited identity sees a "not invited" screen (HTTP 403)                                           | Uninvited test identity gets 403, no data                                   |
| **F3**  | One user can belong to several organizations, including organizations on different data planes; the user switches organization from the menu | Same identity reads org A then org B; never sees A's data while B is active |
| **F4**  | Roles per organization: owner, admin, engineer, viewer                                                                                       | Role matrix test per endpoint                                               |
| **F5**  | Upload STEP and assemblies up to 100 MB; reject larger files before upload                                                                   | Boundary tests at 99, 100, 101 MB                                           |
| **F6**  | Automatic route and cost for supported processes, with editable assumptions and audit trail                                                  | Golden-part regression set passes                                           |
| **F7**  | Open-book export to Excel and PDF                                                                                                            | Export matches on-screen totals to the rupee                                |
| **F8**  | Live status updates for uploads, costing and delivery tracking without page reload                                                           | Status visible within 2 s of change                                         |
| **F9**  | Organization admin can export all organization data and request deletion                                                                     | See 11.5                                                                    |
| **F10** | Tenant administrator sets the AI mode: off, eMithran provider, or own endpoint                                                               | AI calls blocked when off; routed to the client endpoint when set           |
| **F11** | An OEM invites a supplier contact to quote on one RFQ. The supplier signs in with an email code, sees only that RFQ and its files, and submits a quote; all data stays in the OEM's data plane. Files are shared by link, never as email attachments | Guest reads its RFQ and submits a quote; gets 403 on another RFQ and on every other module; access ends when the grant is revoked or expires |

## 11.2 Non-functional

| **ID** | **Requirement**                                                                                                                                               |
|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **N1** | Dedicated tenants: no client business data or files persisted on eMithran infrastructure (section 10.2 defines every allowed location)                        |
| **N2** | Client data plane: any Postgres 16+ and any S3-compatible store; required extensions pgcrypto (pg_cron optional)                                              |
| **N3** | Latency and availability targets as in section 8.3, under the stated load conditions                                                                          |
| **N4** | Pooled: failover, restore and region-loss targets as in section 8.3. Dedicated: client owns database and bucket backups; eMithran owns control-plane backups and job recovery |
| **N5** | Deploys without downtime; schema changes use expand and contract; the application supports schema N and N-1                                                   |
| **N6** | All services emit OpenTelemetry traces, metrics and logs tagged with tenant id and request id, never payloads, signed URLs or file names                      |
| **N7** | Private connectivity to each dedicated data plane: private link, VPC peering, site-to-site VPN, or an outbound tunnel; TLS with full certificate verification |

## 11.3 Identity and sessions

| **Rule**                | **Requirement**                                                                                                                                                                                                                                           |
|-------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Stable identity**     | The external identity is (issuer, subject). Email is an attribute, never the key.                                                                                                                                                                         |
| **Invite binding**      | An invitation is a single-use token sent to an email address. It is accepted only by a signed-in identity whose verified email matches it after normalisation (lower case, Unicode NFKC, trimmed). Accepting it links (issuer, subject) to the user once. |
| **Legacy linking**      | Users carried from Supabase are linked once, on first verified login, by exact normalised email match to a pre-provisioned row. Ambiguous or duplicate matches are refused and listed for an admin.                                                       |
| **Changed email**       | A changed email at Auth0 does not relink or create an account. Admin can update the stored email; linking stays on (issuer, subject).                                                                                                                     |
| **Reassigned email**    | A new person who receives a former employee's email address gets a new (issuer, subject) and needs a new invitation.                                                                                                                                      |
| **Duplicates**          | A second identity for the same person is linked only through a new invitation accepted while signed in; never automatically.                                                                                                                              |
| **Account recovery**    | Handled by Auth0 (password reset, MFA recovery) or the client's IdP. eMithran never resets credentials.                                                                                                                                                   |
| **Idle timeout**        | 30 minutes of inactivity ends the session. Last activity is stored server-side in a shared session store, so the rule holds across BFF replicas. Activity = an authenticated user request; background polling does not count.                             |
| **Absolute lifetime**   | 12 hours, then a fresh sign-in is required.                                                                                                                                                                                                               |
| **Refresh tokens**      | Rotating, kept server-side only, encrypted at rest; reuse of an old refresh token revokes the session.                                                                                                                                                    |
| **Sign out**            | "This device" ends one session. "Everywhere" revokes all sessions for the user and the Auth0 session. Auth0 back-channel logout ends eMithran sessions when the IdP ends a session.                                                                       |
| **Organization switch** | Switching re-authenticates silently into the target Auth0 Organization and updates the session's active organization; membership is checked on every request.                                                                                             |

## 11.4 Security

- Browser JavaScript never receives access or refresh tokens; cookies are HttpOnly, Secure and SameSite=Lax, with CSRF protection on state-changing requests. This follows RFC 10017 (BCP 212, Aug 2026), which recommends the backend-for-frontend pattern for business applications.

- Access tokens are RS256, verified against Auth0 JWKS with issuer, audience and expiry checks; lifetime 10 minutes.

- Rotate all 39 historical secrets and the old Supabase service key before go-live, and prove the old credentials are rejected.

- Audit events for sign-in, role change, organization switch, export, deletion, privileged job, tenant registry change and support access.

- Controls mapped to OWASP ASVS Level 2; a security questionnaire pack (SOC 2 / ISO 27001 style) available for enterprise reviews.

## 11.5 Data lifecycle

| **Event**                                  | **Pooled tenant**                                                                                                               | **Dedicated tenant**                                                                         |
|--------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| **Export**                                 | Admin requests export; delivered within 24 h as SQL plus CSV for the organization only, and files under the organization prefix | Client already holds all data; eMithran provides a schema guide                              |
| **Deletion at contract end**               | Data deleted 30 days after the export window; backups age out within 35 days; deletion certificate issued                       | eMithran revokes its own credentials and deletes control-plane metadata except audit records |
| **Retention of audit and processing logs** | 1 year, then erased (DPDP Rules 2025, Rule 8(3)); legal review required                                                         | Same for eMithran-held logs                                                                  |
| **Backups**                                | eMithran: daily full, WAL archiving, point-in-time restore 14 days, monthly drill                                               | Client: owns backups; eMithran joins a quarterly restore drill                               |
| **Restore**                                | eMithran restores; queued jobs reconciled (design doc 16.4)                                                                     | Client restores; eMithran reconciles jobs and file references after restore                  |
| **Disaster recovery (region loss)**        | Control plane and pooled data restored in a second region from cross-region backups: RTO 4 h, RPO 15 min. Excluded from the availability SLA; covered by these DR terms | Control plane restored as for pooled; the client's data plane is unaffected unless it is in the lost region, where the client's own DR applies |
| **Breach**                                 | eMithran notifies affected clients within 24 h of confirmation, so clients can meet the 72-hour DPDP obligation                 | Same for anything in eMithran's scope                                                        |

| **Activity**                                   | **eMithran**                              | **Client (dedicated)**          |
|------------------------------------------------|-------------------------------------------|---------------------------------|
| **Control plane, application, queue, workers** | Responsible                               | Informed                        |
| **Client Postgres and bucket operation**       | Consulted (Responsible if managed option) | Responsible                     |
| **Backups and restore of client data**         | Consulted                                 | Responsible                     |
| **Network path (private link / tunnel)**       | Responsible for eMithran side             | Responsible for client side     |
| **Incident response**                          | Leads for eMithran scope                  | Leads for client infrastructure |

# 12. Migration programme (product view)

The move from Supabase to Auth0 and Postgres is reversible until a named point of no return, and forward-fix only after it. No reverse sync is offered.

<img src="media/fc7dab32f906b092f7fa399f0155be735b38214e.png" title="Rollout phases and gates; PNR is the point of no return." style="width:1.90625in;height:6.5in" alt="Rollout phases and gates; PNR is the point of no return." />

*Figure 7. Rollout phases and gates; PNR is the point of no return.*

## 12.1 Recovery policy (one policy, both documents)

| **Window**                                              | **Authoritative system** | **Recovery**                                                                                                                                 |
|---------------------------------------------------------|--------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| **Before cutover**                                      | Supabase                 | Nothing to roll back                                                                                                                         |
| **Cutover window (write freeze)**                       | Supabase (read-only)     | Abort: flip flags back, lift freeze; no data written to the new stack                                                                        |
| **After cutover, before PNR (soak, typically 2 weeks)** | New Postgres             | Rollback only if no customer writes have happened, or if writes can be replayed from the audit log by a tested script. Otherwise forward-fix |
| **After PNR**                                           | New Postgres             | Forward-fix only. Supabase kept read-only for 30 days for forensics, then deleted                                                            |

The point of no return is declared in writing by the engineering lead when: row counts and file hashes match, every active user has signed in once, the 2-week soak has no Sev-1 or Sev-2 incident, and the restore drill on the new database has passed.

## 12.2 Migration success metrics with evidence

| **Metric**              | **Target**                                                          | **Evidence**                               |
|-------------------------|---------------------------------------------------------------------|--------------------------------------------|
| **Schema parity**       | Empty diff between restored baseline and source schema              | Schema diff report attached to the release |
| **Row parity**          | 100% of tables match row counts                                     | baseline-load.sh report                    |
| **File parity**         | 0 to copy, 0 failed, hashes match                                   | storage:copy report                        |
| **Identity linking**    | 100% of active users linked; ambiguous list empty                   | link report                                |
| **API contract parity** | All recorded contract tests pass                                    | CI run id                                  |
| **Supabase removal**    | 0 imports of @supabase in both packages                             | CI grep rule                               |
| **Privileged access**   | 0 privileged calls in feature modules; system jobs on an allow-list | check-rls-bypass in CI                     |

# 13. Release gates and acceptance

Four production gates. A gate passes only with evidence; P0 review items must be closed before cutover.

| **Gate**          | **Passes when**                                                                                                                                                                                              | **Enforced by**       |
|-------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------|
| **G1 Security**   | Historical secrets and Supabase service key rotated and proven rejected; gitleaks clean on new commits; dependency scan has no critical issue reachable at runtime                                           | CI + signed checklist |
| **G2 Isolation**  | Two-tenant negative tests pass on real Postgres with production roles, including RPCs, views, jobs and file access; catalog checks pass (no table without RLS, no app role that owns tables or bypasses RLS) | CI on every merge     |
| **G3 Migration**  | Section 12.2 metrics met; cutover and rollback drill done on stage; recovery policy approved                                                                                                                 | Release review        |
| **G4 Operations** | Connection and concurrency limits load-tested; tenant outage drill shows other tenants unaffected; log canaries absent from telemetry; restore drill passed; runbooks reviewed                               | Drill reports         |

## CI rules that make requirements enforceable

- Fail the build if @supabase/\* or any database client is imported in app/, lib/ or components/ (no browser-to-database calls).

- Fail if feature modules call the system database role outside the allow-list file.

- Fail if a new table in a tenant schema has no RLS policy, or a new SECURITY DEFINER function is not on the reviewed list.

- Fail if a logger call includes a field outside the log allow-list.

- Fail if generated database types differ from the committed ones after migrations run.

# 14. Risks, open questions, decision log

## 14.1 Risks

| **Risk**                                         | **Likelihood** | **Impact** | **Mitigation**                                                             |
|--------------------------------------------------|----------------|------------|----------------------------------------------------------------------------|
| **Accuracy below target on customer parts**      | Medium         | High       | Comparison set in every pilot; rate onboarding; misses traced to data gaps |
| **Suppliers will not pay platform plus seats**   | Medium         | High       | Credited pilot; test price points in first five deals                      |
| **OEM security review stalls deals**             | High           | Medium     | Dedicated data plane, questionnaire pack, revocation drill                 |
| **Cross-tenant data exposure**                   | Low after G2   | Critical   | Two walls (application scope and RLS), CI catalog checks                   |
| **Client data plane outages blamed on eMithran** | Medium         | Medium     | Clear RACI, per-tenant health page, circuit breaker                        |
| **Small team spread across too many modules**    | High           | High       | Pilot scope limited to three processes and two personas                    |
| **Auth0 cost grows with MAU**                    | Low            | Medium     | Under USD 2.5K/month to 10K MAU; OIDC contract keeps an exit to Keycloak   |

## 14.2 Open questions

1.  Which two suppliers and which OEM are the first design partners, and who is the executive sponsor at each?

2.  Do any pilot customers require TISAX evidence from eMithran itself, and at which assessment level?

3.  Which model provider and region will be offered for the eMithran AI mode, and does its contract guarantee zero retention?

4.  What is the legal view on DPDP roles: is eMithran a data processor for client users, and a fiduciary for its own accounts?

5.  Is a casting or forging engine needed in the first supplier pilot?

## 14.3 Decision log

| **Date**        | **Decision**                                                                                                 | **By**  |
|-----------------|--------------------------------------------------------------------------------------------------------------|---------|
| **30 Oct 2026** | Auth0 as identity broker                                                                                     | Founder |
| **30 Oct 2026** | Code stays with eMithran; enterprise data in client-owned Postgres and storage                               | Founder |
| **30 Oct 2026** | Beachheads: Tier-1/2 suppliers and OEM cost/sourcing; India plus export buyers                               | Founder |
| **30 Oct 2026** | Pricing model: platform fee plus seats                                                                       | Founder |
| **30 Oct 2026** | Multi-organization users across data planes; per-tenant AI policy; client-run data plane with managed option | Founder |
| **30 Oct 2026** | Guest supplier access per RFQ for pilots; organization-to-organization exchange later, with OEM consent per RFQ | Founder |
| **30 Oct 2026** | Availability 99.0% contractual, 99.5% internal; failover separated from disaster recovery | Founder |
| **30 Oct 2026** | Dedicated data planes only in regions where eMithran runs compute (Mumbai first, Frankfurt for the first EU client) | Founder |

# 15. Sources

All pages were opened on 30 October 2026. Vendor-authored sources are labelled.

| **Topic**                       | **Source**                                                                                                                                                                              |
|---------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **ACMA FY26 industry figures**  | Autocar Professional, "ACMA: Indian Auto Component Industry Grows 12.7% to INR 7.6 Lakh Crore in FY26", 7 Jul 2026 - autocarpro.in                                                      |
| **US tariff on auto parts**     | Autocar Professional, "Despite Tariffs, India's Auto Component Exports Grow by 9.3% during First Half FY26" - autocarpro.in                                                             |
| **India-EU FTA**                | Autocar Professional, "India-EU FTA: What We Know so Far" - autocarpro.in                                                                                                               |
| **DPDP Rules 2025**             | S.S. Rana & Co., "MeitY Notifies Final Digital Personal Data Protection Rules 2025" - ssrana.in                                                                                         |
| **TISAX scope**                 | DQS India, "TISAX Assessment" - dqsglobal.com                                                                                                                                           |
| **Should-cost tool pricing**    | Boothroyd Dewhurst, "Should-cost software pricing guide", Mar 2026 (vendor-authored) - dfma.com                                                                                         |
| **Teamcenter PCM capabilities** | CLEVR, "Siemens Teamcenter Product Cost Management" - clevr.com                                                                                                                         |
| **Tset**                        | Tset press release, "Tset raises 13 million", 31 Mar 2023 - tset.com                                                                                                                    |
| **Paperless Parts**             | Paperless Parts company page - paperlessparts.com                                                                                                                                       |
| **Auth0 pricing**               | Auth0 pricing page (B2B plans) - auth0.com                                                                                                                                              |
| **Browser OAuth best practice** | RFC 10017, OAuth 2.0 for Browser-Based Applications (BCP 212), Aug 2026 - rfc-editor.org                                                                                                |
| **Product facts**               | eMithran repository at commit 6e6f044f: docs/ENGINEERING.md, docs/COSTING_AND_BOM_ARCHITECTURE.md, cad-engine/ARCHITECTURE.md, docs/VAVE_AI_Module_Build_Guide.md, docs/architecture/\* |
