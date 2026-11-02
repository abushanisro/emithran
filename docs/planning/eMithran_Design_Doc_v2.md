**eMithran**

**Architecture and Design Document**

Control plane run by eMithran, data plane owned by the client, Auth0 for identity

| **Field**     | **Value**                                                                                                                                       |
|---------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| **Version**   | 2.0 (replaces the 30 Oct v1 doc)                                                                                                                |
| **Date**      | 30 October 2026                                                                                                                                 |
| **Status**    | Draft for engineering review                                                                                                                    |
| **Owner**     | eMithran engineering                                                                                                                            |
| **Companion** | eMithran PRD v2.0                                                                                                                               |
| **Scope**     | Current and target architecture, identity, tenancy, isolation, pipeline, jobs, budgets, AI, security, operations, migration, standards, cleanup |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p><strong>In one sentence</strong></p>
<p>One small NestJS monolith, one control plane and one data plane per enterprise client: tenancy enforced twice, customer data never resting on eMithran disks, and nothing added without a measured need.</p></td>
</tr>
</tbody>
</table>

*Confidential. Prepared for eMithran internal planning. Market figures carry their source and date; items marked hypothesis are to be validated in pilots.*

**Contents**

1\. Summary and scope

2\. Current architecture (legacy)

3\. Target architecture

4\. Architecture decisions

5\. Components and open-source choices

6\. Identity, sessions and organizations

7\. Tenancy, routing and revocation

8\. Database isolation: proving RLS holds

9\. Data access layer and the PostgREST exit

10\. Files and the CAD-to-cost pipeline

11\. Jobs and workers

12\. Resource budgets

13\. AI gateway

14\. Observability, logging and SLOs

15\. Security and threat model

16\. Deployment, operations and recovery

17\. Migration and rollout

18\. Code structure and engineering standards

19\. Cleanup plan

20\. Appendix

# 1. Summary and scope

eMithran runs all code in its own control plane. Each enterprise client keeps business data and files in its own Postgres and S3-compatible bucket. Auth0 signs people in. One small NestJS monolith enforces tenancy twice: in the application and in Postgres row-level security.

This document describes how the requirements in the PRD v2.0 are built. It covers the current architecture, the target architecture, identity, tenancy, database isolation, the CAD-to-cost pipeline, jobs, resource budgets, AI, observability, threats, operations, migration, code standards and cleanup. It resolves every P0 and P1 item from the October review.

| **Principle**                                   | **What it means in practice**                                                                                  |
|-------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| **Do not add services without a measured need** | No microservices, Redis, message broker or new ORM. Postgres is the queue; the monolith stays.                 |
| **Two walls for tenant data**                   | The application scopes every query to the active organization; Postgres RLS enforces the same rule underneath. |
| **Customer data never rests on eMithran disks** | Dedicated tenants: memory and per-job tmpfs only; logs carry ids, never payloads.                              |
| **Vendors behind ports**                        | Auth0, S3 and model providers sit behind small platform interfaces; feature code never imports a vendor SDK.   |
| **Boring, observable, reversible**              | Plain SQL migrations, OpenTelemetry everywhere, feature flags for cutover, explicit point of no return.        |

## Review items and where they are closed

| **Review item**                                                               | **Priority** | **Section**                    |
|-------------------------------------------------------------------------------|--------------|--------------------------------|
| **Precise data promise and data-flow inventory**                              | P0           | 10, 14 and PRD 10              |
| **One rollback policy**                                                       | P0           | 17.3                           |
| **Identity linking, multi-org, server-side idle timeout**                     | P0           | 6                              |
| **RLS cannot be bypassed: ownership, BYPASSRLS, FORCE RLS, SECURITY DEFINER** | P0           | 8                              |
| **Multi-org routing across data planes**                                      | P0           | 7                              |
| **Job identity, revocation versus cache**                                     | P0           | 7.4 and 11                     |
| **Worker and storage data handling**                                          | P0           | 10                             |
| **Fleet migration and PostgREST-to-Kysely parity**                            | P1           | 9 and 17                       |
| **Connection and concurrency budgets; recovery ownership**                    | P1           | 12 and 16                      |
| **Three diagrams plus threat table**                                          | P2           | Figures 3, 5, 7 and section 15 |

# 2. Current architecture (legacy)

Today every runtime depends on one Supabase project for login, data, files and realtime. The browser talks to the database directly in 26 places, and the API bypasses row-level security in 177.

## 2.1 Current architecture diagram

<img src="media/fadac55885720194befe6e3302424f00af046d31.png" title="Current architecture. Red paths are the ones the migration removes: browser-to-database calls and RLS-bypassing service calls." style="width:10.11458in;height:4.77083in" alt="Current architecture. Red paths are the ones the migration removes: browser-to-database calls and RLS-bypassing service calls." />

*Figure 1. Current architecture. Red paths are the ones the migration removes: browser-to-database calls and RLS-bypassing service calls.*

## 2.2 Inventory (commit 6e6f044f, 29 Oct 2026)

| **Area**                     | **Today**                                                                                                                                                        | **Evidence**                                          |
|------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| **Frontend**                 | Next.js 16, React 19; 17 files import Supabase; 26 direct queries (organizations, workspaces, members, delivery, exchange rates, avatars, auth callback)         | lib/api/organization.ts, lib/api/delivery-tracking.ts |
| **API**                      | NestJS 11 modular monolith, 40 feature modules; 261 files reference Supabase; 205 tables via .from(), 55 RPCs                                                    | backend/src                                           |
| **RLS bypass**               | 177 privileged call sites; worst in delivery and quality control (EA-002)                                                                                        | getPrivilegedClient(...)                              |
| **Schema**                   | 792 SQL files in backend/migrations plus 96 in a second tree; about 213 tables; 648 RLS policies                                                                 | backend/migrations                                    |
| **CAD**                      | FastAPI + OpenCascade; ~16 MB RAM per MB of STEP; 100 MB limit; 900 s watchdog; contract schema v1                                                               | cad-engine/ARCHITECTURE.md                            |
| **Jobs**                     | Postgres queues (job_queue, cad_uploads) claimed with FOR UPDATE SKIP LOCKED; Rust cad-runner                                                                    | migrations 917, 920                                   |
| **Migration bridge (built)** | Flags DB_BACKEND, AUTH_BACKEND, STORAGE_BACKEND; Auth0 verifier; backend-minted DB token for PostgREST; S3 ObjectStore; baseline dump/load with row-count checks | docs/CUTOVER_AUTH0_POSTGRES.md                        |
| **Ops**                      | Docker Compose with Cloudflare Tunnel; OpenTelemetry to Prometheus and Grafana                                                                                   | docker-compose.prod.yml                               |

## 2.3 What is wrong with it

| **Problem**                                                     | **Consequence**                                                                                   | **Fixed in**        |
|-----------------------------------------------------------------|---------------------------------------------------------------------------------------------------|---------------------|
| **One vendor holds login, data and files**                      | Cannot offer client-owned data; lock-in                                                           | Sections 3, 7       |
| **Browser queries the database**                                | Two enforcement points; tokens in the browser                                                     | Sections 6, 9       |
| **177 RLS-bypassing calls**                                     | Cross-tenant exposure possible (EA-002)                                                           | Section 8           |
| **PostgREST as the data path**                                  | No multi-statement transactions; string-typed queries; cannot route one request to many databases | Section 9           |
| **Three migration trees**                                       | Live schema cannot be rebuilt reliably                                                            | Section 17.1        |
| **Historical secrets in git (39) and old Supabase service key** | Valid credentials may exist outside the team                                                      | Section 15, gate G1 |

# 3. Target architecture

A control plane run by eMithran and one data plane per enterprise client. Only the BFF is public. The API reaches each data plane over a private path with credentials the client can revoke.

<img src="media/4f78a8e205550a734d856d88b01f4bca66f3eab8.png" title="System context (C4 level 1): who uses eMithran and which systems it depends on." style="width:6.69792in;height:2.25in" alt="System context (C4 level 1): who uses eMithran and which systems it depends on." />

*Figure 2. System context (C4 level 1): who uses eMithran and which systems it depends on.*

## 3.1 Container view

<img src="media/f32ac4c0784ac7ff606c5473be768110abc9626a.png" title="Container view (C4 level 2): control plane, pooled and client data planes, identity and optional AI." style="width:10.11458in;height:4.80208in" alt="Container view (C4 level 2): control plane, pooled and client data planes, identity and optional AI." />

*Figure 3. Container view (C4 level 2): control plane, pooled and client data planes, identity and optional AI.*

## 3.2 Planes and responsibilities

| **Plane**                | **Contains**                                                                                                                                                                                                                        | **Owned and run by**                                     |
|--------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------|
| **Control plane**        | BFF, API, workers, CAD/ECAD engines, AI gateway; control-plane database (users, identities, organizations, memberships, tenants, sessions, jobs, audit); reference data (rates, materials, process models); secret store; telemetry | eMithran                                                 |
| **Pooled data plane**    | One tenant database (separate database in the eMithran cluster) and one bucket, shared by many organizations, isolated by organization_id and RLS                                                                                   | eMithran                                                 |
| **Dedicated data plane** | Client Postgres 16+ and S3-compatible bucket in the client account, encrypted with client keys                                                                                                                                      | Client IT, or eMithran under a managed-service agreement |

Reference data such as machine-hour rates, materials and process models is eMithran intellectual property. It stays in the control plane and is read by the costing engine through a cached read-only service. Client-specific rates and overrides live in the tenant database. This keeps eMithran's IP out of client environments, in line with the decision not to ship code or models to clients.

**Code in tenant databases.** Migrations are themselves an IP carrier: whatever they create ships into every database they run on, including a client's. Today the applied tree (backend/migrations) creates about 141 SQL functions, among them cost aggregation, supplier-nomination scoring and vendor rating, and five migrations seed calculator rows. The 58 calculator definitions under backend/migrations/calculators/ are not applied by the runner, but their content must not reach a client database either. The rule:

- Costing, scoring and rating logic, formulas and templates move to TypeScript in the API or to control-plane reference data. Tenant migrations contain schema and data mechanics only: tables, indexes, constraints, RLS policies, the tenancy helpers, triggers that emit NOTIFY or maintain timestamps, and transactional write functions with no business formulas.
- A CI rule rejects any tenant migration that creates a function whose name is not on the reviewed mechanics list (ci/tenant-functions.json). Adding a name needs review.
- A code-in-tenant inventory (generated from the catalog of a freshly migrated database) lists every function, view and seeded row a client database receives. It is part of the security questionnaire pack.

# 4. Architecture decisions

Ten decisions carry the design. Each one is recorded as an ADR in docs/adr before its phase starts.

| **ADR** | **Decision**                                                                                             | **Rejected alternative**             | **Reason**                                                                           |
|---------|----------------------------------------------------------------------------------------------------------|--------------------------------------|--------------------------------------------------------------------------------------|
| **001** | Control plane run by eMithran; data plane owned by the client                                            | On-premises install                  | Clients keep data; eMithran keeps IP and one release train                           |
| **002** | Auth0 as OIDC broker; code reads one vendor-neutral claim contract                                       | Vendor SDK calls in features         | An IdP change becomes configuration                                                  |
| **003** | Backend-for-frontend with server-side session store                                                      | Tokens in browser JS                 | RFC 10017 (BCP 212) recommends BFF for business apps                                 |
| **004** | NestJS modular monolith                                                                                  | Microservices                        | 10-100 users per client; one deployable is cheaper to run and to reason about        |
| **005** | Kysely + node-postgres with generated types                                                              | PostgREST, Prisma, TypeORM, Drizzle  | Real transactions, per-tenant routing, SQL stays SQL, schema stays in SQL migrations |
| **006** | Every request in a tenant transaction; RLS as the second wall                                            | App-only or RLS-only scoping         | Defence in depth; closes the EA-002 class                                            |
| **007** | Memberships and routing in the control plane; tenant DB trusts transaction settings set only by app_user | Membership tables in every tenant DB | Needed for multi-org users across data planes                                        |
| **008** | Postgres is the job queue; S3 API for files                                                              | Redis, RabbitMQ, vendor SDKs         | Fewer systems; already proven in the codebase                                        |
| **009** | Forward-only SQL migrations, expand and contract, rolled across tenants in waves                         | ORM-generated migrations             | Many databases on different versions need reviewable SQL                             |
| **010** | SSE over LISTEN/NOTIFY for live updates                                                                  | Supabase Realtime, WebSockets server | One-way updates only; no extra service                                               |

## 4.1 What we deliberately do not build

- No service mesh, event bus or Kubernetes until replica counts or regions make Docker Compose painful (section 16.1 gives the threshold).

- No in-house password, MFA or SSO code; Auth0 and the client IdP own credentials.

- No generic repository base classes or DTO mappers; queries return the shape an endpoint needs.

- No cross-tenant analytics on client data without written consent.

- No on-premises or air-gapped edition.

# 5. Components and open-source choices

Every component is either open source with a permissive or well-understood licence, or a managed service with an open-source exit.

| **Concern**            | **Choice**                                                                     | **Licence**                           | **Alternatives considered**                                                                                 | **Why**                                                                                                   |
|------------------------|--------------------------------------------------------------------------------|---------------------------------------|-------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| **Database**           | PostgreSQL 17 now; 18 after its first minor releases on the chosen provider    | PostgreSQL                            | MySQL, managed Supabase                                                                                     | RLS, SQL functions, existing 213-table schema. PG18 (25 Sep 2025) adds async I/O, uuidv7() and OAuth auth |
| **Pooling**            | PgBouncer (pooled plane, transaction mode)                                     | ISC                                   | Pgpool-II, Supavisor                                                                                        | Small, proven; transaction-local settings keep RLS safe                                                   |
| **Data access**        | Kysely + node-postgres; kysely-codegen                                         | MIT                                   | Prisma, Drizzle, TypeORM, PostgREST                                                                         | Typed SQL without an ORM model; no schema rewrite                                                         |
| **API and web**        | NestJS 11, Next.js 16, zod                                                     | MIT                                   | Express, Fastify, tRPC                                                                                      | Already in use                                                                                            |
| **Identity**           | Auth0 (B2B plan, Organizations)                                                | Proprietary                           | Keycloak (Apache 2.0, CNCF), Zitadel (AGPL-3.0)                                                             | Decided; exit path is configuration because code depends on OIDC only                                     |
| **Object storage**     | Cloud S3 (Mumbai) pooled; client chooses for dedicated; SeaweedFS for self-run | Apache 2.0 (SeaweedFS)                | MinIO (community edition in maintenance mode since Dec 2025), Garage (AGPL-3.0), RustFS (Apache 2.0, young) | S3 API only, so any compliant store works                                                                 |
| **Secrets**            | OpenBao or the cloud secret manager                                            | MPL-2.0 (OpenBao)                     | HashiCorp Vault (Business Source Licence)                                                                   | Open-source fork with the same API                                                                        |
| **Queue**              | Postgres FOR UPDATE SKIP LOCKED (existing)                                     | n/a                                   | pg-boss, BullMQ + Redis                                                                                     | No new system; already in production code                                                                 |
| **Telemetry**          | OpenTelemetry Collector, Prometheus, Grafana, Loki                             | Apache 2.0; Grafana and Loki AGPL-3.0 | Datadog, OpenObserve                                                                                        | Already wired; run unmodified as separate services                                                        |
| **Backups**            | pgBackRest (pooled, self-run) or provider PITR                                 | MIT                                   | WAL-G (Apache 2.0)                                                                                          | PITR, verified restore                                                                                    |
| **Kubernetes (later)** | CloudNativePG operator                                                         | Apache 2.0                            | Zalando operator                                                                                            | Only when Kubernetes is adopted                                                                           |
| **Private network**    | Cloud private link / VPN; cloudflared or WireGuard tunnel                      | Apache 2.0 / GPL-2.0                  | Public IP allow-list only                                                                                   | Client chooses; nothing of eMithran runs on their side                                                    |
| **Supply chain**       | Trivy, gitleaks, Renovate                                                      | Apache 2.0 / MIT / AGPL-3.0           | Snyk                                                                                                        | Already partly configured                                                                                 |
| **CAD kernel**         | OpenCascade via pythonocc                                                      | LGPL-2.1 with exception / LGPL-3.0    | Commercial kernels                                                                                          | Existing engine                                                                                           |

*Licences as stated by each project; confirm AGPL obligations with counsel before redistributing any AGPL component. Running them unmodified as separate services is the intended use.*

# 6. Identity, sessions and organizations

Auth0 proves who someone is. eMithran decides what they may do, which organization is active and which data plane serves the request. The browser holds a cookie, never a token.

<img src="media/26aecaf836611c8d056504637103f91690c5ae05.png" title="Sign-in, tenant resolution and data access." style="width:6.69792in;height:4.96875in" alt="Sign-in, tenant resolution and data access." />

*Figure 4. Sign-in, tenant resolution and data access.*

## 6.1 Identity model

- user_identities(iss, sub) is unique and maps to one users.id. The same person can have several identities (password and Google, for example), each linked by an explicit action.

- Email is stored for display and invitations only. It is never used as a key after linking.

- Users carried from Supabase keep their internal id. Their first verified Auth0 login links by exact normalised email to a pre-provisioned row; anything ambiguous is refused and listed for an admin.

## 6.2 Invitations and linking

1.  An admin invites name@client.com to organization X with a role. The control plane stores a single-use token hash with a 7-day expiry and sends the link.

2.  The invitee signs in through Auth0 (in organization X). The callback compares the verified email, normalised (lower case, NFKC, trimmed), with the invitation.

3.  On match, the identity is linked (if new) and a membership row is created. On mismatch, nothing is linked and the user sees "this invitation was sent to a different email".

4.  Changed or reassigned emails never relink. A new person needs a new invitation.

## 6.3 Sessions and the 30-minute idle timeout

A sid identifies a session; it does not measure inactivity. The BFF therefore keeps a server-side session in the control-plane database, shared by all BFF replicas:

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p>sessions(id uuid pk, user_id, auth0_sid, active_org_id,</p>
<p>created_at, last_activity_at, absolute_expires_at, revoked_at,</p>
<p>refresh_token_enc bytea) -- AES-GCM with a key from the secret store</p></td>
</tr>
</tbody>
</table>

- On each authenticated user request the BFF loads the session by cookie id. If now - last_activity_at \> 30 min, or now \> absolute_expires_at (12 h), or revoked_at is set, the session ends and the user is sent to sign in.

- It updates last_activity_at at most once a minute, so idle expiry is accurate to about 60 seconds. Background polling and SSE heartbeats do not update it.

- Access tokens last 10 minutes and are refreshed server-side with rotating refresh tokens. Reuse of an old refresh token revokes the session.

- Sign out everywhere sets revoked_at on all of the user's sessions and calls Auth0 to end the IdP session. Auth0 back-channel logout does the same when the client IdP ends a session.

## 6.4 Organizations and switching

- Every eMithran organization is one Auth0 Organization. Tokens are organization-scoped (org_id claim).

- Switching organization re-authenticates silently into the target Auth0 Organization, then updates sessions.active_org_id.

- On every request the API checks: token org_id equals the session's active organization, a membership row exists and is active, and the tenant is active. A tampered X-Org-Id header is ignored; the organization comes from the verified token and session.

## 6.5 Auth0 configuration and cost

| **Setting**           | **Value**                                                                                                                   |
|-----------------------|-----------------------------------------------------------------------------------------------------------------------------|
| **Plan**              | B2B Essentials while 3 or fewer enterprise SSO connections; Professional when more connections or enterprise MFA are needed |
| **Applications**      | One Regular Web Application (BFF); one API (audience) with RS256                                                            |
| **Connections**       | Database (sign-up off), Google, one enterprise connection per client that uses SSO                                          |
| **Post-login Action** | Adds verified email and sid claims; blocks unverified emails from linking                                                   |
| **Logout**            | Back-channel logout to the BFF endpoint                                                                                     |

<img src="media/9b64e7a4d107422288ab37e42832c0a79906b26f.png" title="Auth0 B2B list price by monthly active users." style="width:5.55208in;height:2.46875in" alt="Auth0 B2B list price by monthly active users." />

*Figure 5. Auth0 B2B list price by monthly active users.*

# 7. Tenancy, routing and revocation

Routing is keyed by organization, not by identity. One user can belong to organizations on different data planes; every request resolves exactly one organization and therefore exactly one tenant.

## 7.1 Data model across planes

<img src="media/812e563d130237a0331d2ffadb90f4288891e324.png" title="Control-plane tables route and authorise; tenant databases hold business data scoped by organization_id." style="width:10.11458in;height:4.94792in" alt="Control-plane tables route and authorise; tenant databases hold business data scoped by organization_id." />

*Figure 6. Control-plane tables route and authorise; tenant databases hold business data scoped by organization_id.*

## 7.2 Resolution algorithm

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p>resolve(request):</p>
<p>identity = verifyJwt(token) // iss, sub, org_id, sid</p>
<p>user = identities.find(identity.iss, identity.sub) or 403</p>
<p>session = sessions.get(cookie) must match user and sid or 401</p>
<p>org = identity.org_id == session.active_org_id or 403</p>
<p>member = memberships.active(user, org) or 403</p>
<p>tenant = registry.get(org.tenant_id) status == 'active' or 503</p>
<p>return { userId: user.id, orgId: org.id, role: member.role, tenant }</p></td>
</tr>
</tbody>
</table>

Cardinality is explicit: user 1..n identities, user 1..n memberships, organization 1 tenant, tenant 1..n organizations. A pooled tenant hosts many organizations; a dedicated tenant normally hosts one.

A guest supplier (section 7.5) resolves differently: there is no membership, so the resolver checks an active guest grant instead and returns { userId, orgId: the OEM's organization, role: 'guest_supplier', rfqId, tenant }. Every query a guest can reach is additionally scoped to that one RFQ.

## 7.3 Registry caching

- Registry and membership lookups are cached in each API and worker process for at most 15 seconds.

- Any change to tenants or memberships fires a Postgres NOTIFY (tenant_changed, membership_changed); every process evicts the entry immediately.

- If the notification listener disconnects, the cache is cleared and the 15-second limit applies until it reconnects. This keeps the worst case well inside the 60-second revocation target.

## 7.4 Revocation paths

<img src="media/4754ba0cd7947fe935b9e3764e9f3f237444a22e.png" title="Revocation: eMithran-initiated suspension and client-initiated credential revocation." style="width:6.69792in;height:3.83333in" alt="Revocation: eMithran-initiated suspension and client-initiated credential revocation." />

*Figure 7. Revocation: eMithran-initiated suspension and client-initiated credential revocation.*

| **Path**                                               | **Database**                                                                                                          | **Storage**                                         | **Worst case**                                                        |
|--------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------|-----------------------------------------------------------------------|
| **eMithran suspends tenant**                           | NOTIFY evicts cache; pools ended; new checkouts refused                                                               | No new signed URLs issued; STS sessions not renewed | No new operation after 60 s; issued links expire within 5 min         |
| **Client revokes role or rotates password**            | Revoking table or schema privileges applies to the next statement on every open connection. A password change or NOLOGIN stops new connections at once; open ones end within 30 min (max lifetime). The supplied revocation script does both and ends eMithran's sessions with pg_terminate_backend | n/a | Immediate with the script or a privilege revoke; up to 30 min for a password change alone |
| **Client disables KMS key or adds bucket deny policy** | n/a                                                                                                                   | All reads and writes fail at once                   | Immediate                                                             |
| **Client removes cross-account role trust**            | n/a                                                                                                                   | Existing STS credentials valid until expiry         | Up to 15 min (STS duration); use KMS or bucket policy for instant cut |

## 7.5 Supplier collaboration

An OEM sends RFQs to suppliers who are not members of its organization. Two models, in this order:

| **Model** | **How it works** | **When** |
|---|---|---|
| **Guest supplier access** | The OEM invites a supplier contact to one RFQ. The invitation is single-use and expires; the supplier signs in with an email one-time code (Auth0 passwordless) and gets a guest grant scoped to that RFQ. The supplier sees the RFQ, its drawings and CAD through 5-minute signed URLs, and submits a quote. Everything, including the quote, stays in the OEM's data plane. | Pilots |
| **Organization-to-organization exchange** | A supplier with its own eMithran organization receives a copy of the RFQ in its own data plane. Each side keeps its own copy; the OEM consents per RFQ before anything is copied, and the copy carries only the documents the OEM selected. | When two paying organizations need it |

Rules for guests:
- A guest grant names one RFQ, one OEM organization and one identity; it expires when the RFQ closes or after 30 days, whichever comes first, and the OEM can revoke it at any time.
- Guests never see organization data outside the RFQ, never join the organization, and cannot invite others.
- Grants, views, downloads and quote submissions are audit events.
- CAD and drawings are never sent as email attachments. Invitation emails carry a link only.

# 8. Database isolation: proving RLS holds

RLS only protects data when the requesting role does not own the tables, cannot bypass RLS and cannot call a function that leaks across tenants. Each of these is checked by a catalog query in CI, and each query must return zero rows.

## 8.1 Roles (every tenant database)

| **Role**                                         | **Login** | **Rights**                                                           | **Used by**                                                 |
|--------------------------------------------------|-----------|----------------------------------------------------------------------|-------------------------------------------------------------|
| **emithran_owner**                               | No        | Owns all schema objects                                              | Nobody connects as it; migrations SET ROLE to it for DDL    |
| **migrator**                                     | Yes       | Member of emithran_owner; BYPASSRLS for data backfills               | Fleet migration job only                                    |
| **app_user**                                     | Yes       | DML on tenant tables; NOBYPASSRLS; owns nothing; CONNECTION LIMIT 20 | API and workers for user requests                           |
| **app_system**                                   | Yes       | BYPASSRLS; limited grants                                            | Allow-listed system jobs: exports, deletion, reconciliation |
| **authenticator / authenticated / service_role** | As today  | PostgREST bridge                                                     | Removed in phase 4                                          |

## 8.2 Rules

- Every tenant table has ENABLE and FORCE ROW LEVEL SECURITY. FORCE applies policies even to the owner, so a mistaken owner connection still cannot read across organizations.

- Policies read app.org_id and app.user_id from transaction-local settings. The existing helper functions are redefined to read them, so the 648 existing policies keep working unchanged.

- Only app_user and app_system can connect from eMithran, and only the API sets the settings, after resolution (section 7.2).

- Every SECURITY DEFINER function pins search_path (pg_catalog, public), revokes EXECUTE from PUBLIC, is granted to named roles only, and checks app.org_id inside. New ones need security review and an allow-list entry.

- Views use security_invoker = true (Postgres 15+) so the caller's RLS applies.

- Global read-only tables (unit lists, enumerations) are on an explicit allow-list with SELECT-only policies.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p>-- helper used by existing policies: now reads the transaction setting</p>
<p>CREATE OR REPLACE FUNCTION public.current_user_org_ids() RETURNS SETOF uuid</p>
<p>LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$</p>
<p>SELECT nullif(current_setting('app.org_id', true), '')::uuid</p>
<p>$$;</p></td>
</tr>
</tbody>
</table>

## 8.3 Catalog checks run in CI (each must return zero rows)

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p>-- 1. tenant tables without RLS enabled and forced</p>
<p>SELECT c.relname FROM pg_class c</p>
<p>WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'</p>
<p>AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)</p>
<p>AND c.relname NOT IN (SELECT name FROM ci.global_tables);</p>
<p>-- 2. request roles that bypass RLS or own objects</p>
<p>SELECT rolname FROM pg_roles WHERE rolname = 'app_user' AND (rolbypassrls OR rolsuper);</p>
<p>SELECT c.relname FROM pg_class c WHERE c.relowner = 'app_user'::regrole;</p>
<p>-- 3. SECURITY DEFINER functions without a pinned search_path, or not reviewed</p>
<p>SELECT p.oid::regprocedure FROM pg_proc p</p>
<p>WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef</p>
<p>AND (p.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) s WHERE s LIKE 'search_path=%')</p>
<p>OR p.oid::regprocedure::text NOT IN (SELECT signature FROM ci.reviewed_definers));</p>
<p>-- 4. functions any role can execute</p>
<p>SELECT p.oid::regprocedure FROM pg_proc p</p>
<p>WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('public', p.oid, 'EXECUTE');</p>
<p>-- 5. views that do not run with the caller's rights</p>
<p>SELECT c.relname FROM pg_class c</p>
<p>WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'</p>
<p>AND NOT coalesce('security_invoker=true' = ANY (c.reloptions), false);</p></td>
</tr>
</tbody>
</table>

## 8.4 Isolation test matrix

| **Test**                                                         | **Runs as**              | **Expect**                     |
|------------------------------------------------------------------|--------------------------|--------------------------------|
| **Org B user reads, updates, deletes org A rows in each module** | app_user with B settings | 0 rows, 0 affected             |
| **Org B calls every RPC with org A ids**                         | app_user with B settings | Error or empty                 |
| **Read every view as org B**                                     | app_user                 | Only B rows                    |
| **Missing settings (no app.org_id)**                             | app_user                 | 0 rows everywhere              |
| **Same identity, org A on pooled and org B on dedicated**        | Through the API          | Never sees A while B is active |
| **Tampered X-Org-Id and stale membership**                       | Through the API          | 403                            |
| **Job for org A replayed with tenant B id**                      | Worker                   | Rejected (section 11.2)        |
| **Signed URL for org A requested by org B**                      | Through the API          | 403                            |
| **Guest for RFQ 1 reads RFQ 2 of the same OEM**                  | Through the API          | 403                            |
| **Guest reads any non-RFQ module (BOMs, costing, vendors)**      | Through the API          | 403                            |
| **Guest after the grant is revoked or expired**                  | Through the API          | 401 or 403 on the next request |

Tests run against a real Postgres built from the migrations, with the exact production roles, on every merge (Testcontainers).

# 9. Data access layer and the PostgREST exit

Feature code touches data only through withTenant. PostgREST stays as a bridge while modules are ported one by one behind contract tests.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p>// platform/db/with-tenant.ts - the only way feature code reaches tenant data</p>
<p>export async function withTenant&lt;T&gt;(ctx: TenantContext, work: (db: Kysely&lt;DB&gt;) =&gt; Promise&lt;T&gt;): Promise&lt;T&gt; {</p>
<p>const db = dataPlanes.forTenant(ctx.tenant); // pooled or dedicated Kysely instance</p>
<p>return db.connection().execute(async (conn) =&gt; {</p>
<p>// ids were validated as UUIDs at the edge, so BEGIN and both settings go in one round trip</p>
<p>await sql.raw(beginWithSettings(ctx.userId, ctx.orgId)).execute(conn);</p>
<p>try { const result = await work(conn); await sql`commit`.execute(conn); return result; }</p>
<p>catch (error) { await sql`rollback`.execute(conn); throw error; }</p>
<p>});</p>
<p>}</p>
<p>// modules/boms/boms.repository.ts - a repository is just queries</p>
<p>export const listBoms = (tx: Transaction&lt;DB&gt;, projectId: string) =&gt;</p>
<p>tx.selectFrom('boms').select(['id', 'name', 'updated_at'])</p>
<p>.where('project_id', '=', projectId).orderBy('updated_at', 'desc').execute();</p></td>
</tr>
</tbody>
</table>

- set_config(..., true) is transaction-local, so it is safe behind PgBouncer in transaction mode and cannot leak to the next request on the same connection.

- Repositories still filter by organization where the table has organization_id: the application wall does not rely on RLS.

- SQL functions are allowed in tenant databases only for data mechanics (section 3.2): for example a transactional multi-row write with no formulas. Costing, scoring and rating logic lives in TypeScript.

**Round-trip budget per request.** Distance, not the number of round trips, decides whether the latency target can be met: in one cloud region a round trip costs about 1 ms, between India and the EU about 110-130 ms.

| **Step** | **Round trips** | **Rule** |
|---|---|---|
| **BFF session lookup (control DB)** | 1 | last_activity is written at most once a minute |
| **BEGIN and tenant settings** | 1 | One statement (above); values validated as UUIDs first |
| **Queries** | 1 or more | Batch endpoints; no N+1 queries; contract tests assert query counts on hot paths |
| **COMMIT** | 1 | |
| **New connection (TCP, TLS, SCRAM)** | about 4-5 | Avoided on the hot path by keeping one warm connection per active tenant (section 12) |

A dedicated data plane is therefore supported only in a cloud region where eMithran runs API and worker compute (section 16.1).

## 9.1 Porting a module from PostgREST to Kysely

1.  Record contract tests from current API responses with two-organization fixtures: nulls, empty results, errors and status codes, pagination order, filters, RPC side effects, RLS outcomes.

2.  Rewrite the module's repository on Kysely inside withTenant. Keep response shapes identical.

3.  Run contract and isolation tests. For read-heavy modules, run a shadow comparison in stage for a day.

4.  Ship behind a per-module flag; remove the PostgREST path in the next release once error rates match.

| **Behaviour that often differs**          | **Check**                                                                    |
|-------------------------------------------|------------------------------------------------------------------------------|
| **NULL versus missing keys in JSON**      | Snapshot compare with exact keys                                             |
| **Default ordering**                      | Every list query has an explicit ORDER BY                                    |
| **Error shape and status**                | Map Postgres error codes in one place; contract tests assert status and code |
| **Count and range headers**               | Pagination contract test                                                     |
| **Transaction scope of RPC side effects** | Integration test asserts all-or-nothing                                      |

# 10. Files and the CAD-to-cost pipeline

Files go between the browser and the client bucket directly when the network allows it, and through a streaming BFF path when it does not. Workers process each file in a per-job memory workspace that is always deleted.

<img src="media/dc9da56d3d575b6e3adaffae1ae16ba28587e254.png" title="Upload to CAD analysis to cost." style="width:6.69792in;height:3.88542in" alt="Upload to CAD analysis to cost." />

*Figure 8. Upload to CAD analysis to cost.*

## 10.1 Two file modes

| **Mode**                 | **When**                                    | **How**                                                                                                                         | **Data on eMithran**            |
|--------------------------|---------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|---------------------------------|
| **A. Direct signed URL** | Bucket reachable from the user's network    | Pre-signed PUT and GET, 5-minute expiry, content-length and checksum bound                                                      | None                            |
| **B. Streamed**          | Private bucket reachable only from eMithran | BFF streams the request body to the API, which streams to the bucket; no buffering to disk; 100 MB cap enforced while streaming | Bytes in memory during transfer |

## 10.2 Worker data handling

| **Risk**                          | **Control**                                                                                                               | **Test**                                                   |
|-----------------------------------|---------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------|
| **File left on disk**             | Per-job directory on tmpfs; deleted in finally; sweeper at start-up and every 5 min removes directories older than 30 min | Kill the worker mid-job; directory gone after restart      |
| **Swap writes memory to disk**    | Swap disabled on worker hosts; tmpfs mounted noswap where the kernel supports it                                          | Host check in deployment pipeline                          |
| **Core dumps hold file contents** | ulimit -c 0 and container core-dump disabled; crash reporters off                                                         | Force a segfault in stage; no core file                    |
| **Logs or traces hold content**   | Allow-list logger; file names hashed; URL query strings stripped; payload bodies never logged                             | Canary file name and canary text never appear in telemetry |
| **Oversized or hostile files**    | 100 MB limit, extension and magic-number checks, zip-bomb ratio limit, 900 s hard limit per analysis                      | Fuzz and boundary tests                                    |
| **Checksum mismatch**             | API verifies size and SHA-256 after upload before enqueueing                                                              | Corrupted upload rejected                                  |
| **Signed URL leakage**            | 5-minute expiry; scoped to one object and method; never logged                                                            | Expired URL returns 403                                    |

## 10.3 Live updates

Tenant tables fire NOTIFY on status changes (upload, costing, delivery). The API holds one listener connection per active tenant and relays events to browsers over Server-Sent Events on an organization channel. This replaces Supabase Realtime and the DeliveryTracking postgres_changes subscription.

# 11. Jobs and workers

The control-plane jobs table carries ids only. Tenant context comes from the authenticated request that created the job and is re-verified before any credential is used.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p>jobs(id uuid pk, tenant_id, org_id, upload_id, kind,</p>
<p>idempotency_key text unique, -- tenant_id:upload_id:kind</p>
<p>created_by uuid, state, attempts, max_attempts, run_at, locked_at, error, created_at, finished_at)</p></td>
</tr>
</tbody>
</table>

## 11.1 Claiming fairly

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p>UPDATE jobs SET state = 'running', locked_at = now(), attempts = attempts + 1</p>
<p>WHERE id = (</p>
<p>SELECT j.id FROM jobs j</p>
<p>WHERE j.state = 'queued' AND j.run_at &lt;= now()</p>
<p>AND (SELECT count(*) FROM jobs r -- soft per-tenant cap</p>
<p>WHERE r.tenant_id = j.tenant_id AND r.state = 'running') &lt; 2</p>
<p>ORDER BY j.run_at</p>
<p>FOR UPDATE SKIP LOCKED</p>
<p>LIMIT 1)</p>
<p>RETURNING *;</p></td>
</tr>
</tbody>
</table>

## 11.2 Binding and replay protection

1.  Only the API (role api_jobs in the control plane) can insert jobs, and only after resolving the request (section 7.2). The browser never supplies tenant or organization ids.

2.  The idempotency key tenant_id:upload_id:kind is unique, so duplicate submissions collapse into one job.

3.  Before using credentials, the worker re-reads the tenant (must be active), loads the upload by (upload_id) from that tenant's database and checks that its organization_id equals the job's org_id. Any mismatch fails the job with a security event.

4.  Workers write results through withTenant with the job's org id, so RLS applies to worker writes too.

5.  Retries back off exponentially up to max_attempts; a job stuck in running longer than the hard limit is reclaimed; suspended tenants' jobs move to paused.

# 12. Resource budgets

Budgets are set per tenant and fleet-wide so one tenant cannot exhaust a client database or starve others.

| **Resource**                      | **Budget**                                                                                           | **Why**                                                 |
|-----------------------------------|------------------------------------------------------------------------------------------------------|---------------------------------------------------------|
| **Dedicated tenant, API pool**    | Max 4 connections per API replica; min 1 while the tenant is active; idle close 5 min; max lifetime 30 min with random jitter of up to 10% | Avoids reconnect cost (4-5 round trips) on the hot path; jitter stops all connections recycling at once; revocation is immediate through the client's revocation script (section 7.4) |
| **Dedicated tenant, worker pool** | Max 2 per worker handling that tenant; created lazily                                                | Per-tenant job cap is 2                                 |
| **Client DB requirement**         | app_user CONNECTION LIMIT 20; client max_connections leaves headroom                                 | 3 API replicas x 4 + 2 jobs x 2 = 16 at peak            |
| **Pools per API replica**         | At most 50 dedicated tenant pools; least recently used closed                                        | Bounded memory                                          |
| **Pooled plane**                  | PgBouncer transaction mode, pool 20 per database user; Postgres max_connections 200; managed Postgres with a multi-AZ standby | Standard sizing for a small cluster; failover in under 5 min (section 16.4) |
| **CAD engine**                    | 1 analysis per engine container; container memory 4 GB (1.6 GB peak for 100 MB STEP plus 1 GB tmpfs) | ~16 MB RAM per MB of STEP measured                      |
| **Jobs per tenant**               | 2 running at once (soft cap); others queued                                                          | Fairness                                                |
| **API rate limit**                | 600 requests per minute per user; uploads 30 per hour per user                                       | Abuse and runaway clients                               |

# 13. AI gateway

All model calls go through one module that enforces the tenant's AI mode. Default is off for dedicated tenants.

| **Mode**              | **Behaviour**                                                                                           | **Data sent**                                                              |
|-----------------------|---------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------|
| **off**               | AI features hidden; gateway refuses calls                                                               | None                                                                       |
| **emithran_provider** | eMithran's contracted provider; zero data retention and no training required by contract; region pinned | Only the extracted text or image needed for the task; no file names or ids |
| **customer_endpoint** | Client's own endpoint (for example their Azure OpenAI); credentials in the secret store                 | Same, sent to the client endpoint                                          |

- The mode lives in tenants.ai_mode; only a tenant owner can change it; every change is audited.

- Prompts and responses are never logged; metrics record tokens, latency and outcome only.

- Copilot memory is scoped per organization (the cross-tenant memory bug EA-014 is already fixed and covered by tests).

# 14. Observability, logging and SLOs

Telemetry is built for operations, not for content: ids, timings and outcomes, tagged by tenant.

| **Signal**       | **Content**                                                                                                  | **Retention**                        |
|------------------|--------------------------------------------------------------------------------------------------------------|--------------------------------------|
| **Traces**       | Span names, durations, status, tenant_id, org_id, request_id; no attributes with bodies or URLs with queries | 7 days                               |
| **Logs**         | Allow-listed fields only; file names hashed; errors with codes, not payloads                                 | 30 days                              |
| **Metrics**      | Latency, error rate, queue age, pool usage, data-plane reachability per tenant                               | 13 months                            |
| **Audit events** | Sign-in, role change, org switch, export, deletion, AI mode change, support access, registry change          | 1 year (DPDP Rule 8(3)), then erased |

## 14.1 SLOs and alerts

| **SLO / alert**                                   | **Target or trigger**                                     |
|---------------------------------------------------|-----------------------------------------------------------|
| **Availability (BFF probe, India region)**        | 99.5% monthly internal SLO; 99.0% contractual until six months of measured data exist (PRD 8.3) |
| **API latency (load-test conditions in PRD 8.3)** | Server time measured at the BFF, in region: p95 200 ms pooled, 250 ms dedicated in-region, 800 ms dedicated cross-region (only where a contract states it) |
| **User-perceived latency**                        | Reported per user region, not an SLO; the user's own network path is outside eMithran's control |
| **Error budget**                                  | When the month's availability budget is spent, risky deploys (schema changes, infrastructure, new flags on) are frozen until the next month or a written exception |
| **Secret store errors or rotation failure**       | Alert on the first error (section 16.5)                   |
| **Tenant data plane unreachable**                 | Alert after 2 minutes; status page entry for that tenant  |
| **Queue age**                                     | Alert when the oldest queued job is older than 10 minutes |
| **Migration wave failure**                        | Page on first failure; wave halts                         |
| **Auth failures**                                 | Alert on a 5x spike over the 7-day baseline               |
| **Log canary**                                    | Page if a canary value ever appears in logs or traces     |

# 15. Security and threat model

Every threat maps to a control and a test. The table is reviewed at each phase gate.

| **Threat**                                         | **Control**                                                                  | **Test**                                     |
|----------------------------------------------------|------------------------------------------------------------------------------|----------------------------------------------|
| **Tenant spoofing (tampered org header or token)** | Org from verified token + session; membership check each request             | Tampered header and stale membership tests   |
| **Cross-tenant query bug**                         | withTenant + organization filter + FORCE RLS                                 | Isolation matrix (8.4)                       |
| **SECURITY DEFINER leak**                          | Pinned search_path, reviewed allow-list, org check inside                    | Catalog check 3 and 4                        |
| **Job replay or tampering**                        | Jobs only from API; idempotency key; worker re-verifies upload org           | Replay test with changed tenant id           |
| **Tenant credential leakage**                      | Secret store; short-lived where possible; rotation 30-90 days; never in logs | Secret scan; log canary                      |
| **Signed URL abuse**                               | 5-minute expiry, single object and method, never logged                      | Expired and cross-org URL tests              |
| **Residual customer data on workers**              | tmpfs, swap off, no core dumps, sweeper                                      | Crash injection test                         |
| **Token theft via XSS**                            | BFF; HttpOnly cookies; CSP                                                   | No token reachable from JS (automated check) |
| **CSRF**                                           | SameSite=Lax plus CSRF token on state-changing BFF routes                    | CSRF test suite                              |
| **SSRF through file proxy**                        | HTTPS only, host allow-list, redirects rejected (EA-004 fixed)               | Existing 15 route tests                      |
| **Hostile CAD file**                               | Size, type, ratio and time limits; engine runs unprivileged in a container   | Fuzz corpus in CI                            |
| **Noisy neighbour**                                | Per-tenant job cap, pool caps, rate limits                                   | Load test with one hot tenant                |
| **Insider or support misuse**                      | Support access only by client-granted, time-boxed, audited grant             | Quarterly access review                      |
| **Supply chain**                                   | Pinned images by digest, Trivy, gitleaks, SBOM per release                   | CI gates                                     |
| **AI data leakage**                                | Per-tenant AI mode; zero-retention contract; no prompt logging               | Mode-off test blocks calls                   |

# 16. Deployment, operations and recovery

Start on Docker Compose in one India region. Move to Kubernetes only when the numbers say so.

## 16.1 Environments and topology

| **Item**             | **Now**                                                                                     | **Move when**                                                           |
|----------------------|---------------------------------------------------------------------------------------------|-------------------------------------------------------------------------|
| **Environments**     | dev (local data stack), stage, prod                                                         | n/a                                                                     |
| **Region**           | India (Mumbai, ap-south-1) for control plane, pooled data plane and all compute. A dedicated data plane is supported only in a region where eMithran runs API and worker compute | Add a Frankfurt compute cell when the first EU client signs; a cross-region data plane needs its own contractual latency SLO |
| **Runtime**          | Docker Compose with profiles on 2-3 VMs behind Cloudflare Tunnel                            | Kubernetes when more than 6 replicas of any service, or a second region |
| **Control-plane DB** | Managed Postgres with a multi-AZ standby, automatic failover and PITR; backups copied to a second region | n/a |
| **Pooled data plane DB** | Same as the control-plane DB | n/a |
| **Secret store**     | AWS Secrets Manager with KMS in the control-plane region, replicated to the DR region (section 16.5) | n/a |
| **Deploys**          | Image per commit, pinned by digest; blue-green per service; migrations before code (expand) | n/a                                                                     |

## 16.2 Onboarding a dedicated tenant

1.  Client provisions Postgres 16+ and a bucket from eMithran's published Terraform module (it creates resources only; it contains no eMithran application code).

2.  Client creates the roles (section 8.1) and the KMS key, and grants eMithran a cross-account role for the bucket.

3.  Network: private link, VPC peering, VPN, or outbound tunnel; eMithran's fixed egress IPs allow-listed.

4.  Credentials are submitted through the secret-store intake, never by email.

5.  eMithran registers the tenant, applies the current schema, runs connectivity, catalog and isolation checks, then creates the Auth0 Organization and the enterprise connection.

Schema changes reach a client database in one of two ways, chosen at onboarding:
- **eMithran's fleet migrator** runs them with the migrator role (section 17.2).
- **A reviewed SQL bundle** goes to the client's DBA, who applies it in their window and reports the resulting schema_version. eMithran verifies it with the catalog checks before routing traffic. This suits DBAs who will not grant DDL rights or BYPASSRLS.

Both are acceptable because tenant migrations carry schema and data mechanics only (section 3.2).

## 16.3 Who does what (dedicated tenants)

| **Activity**                                   | **eMithran**                                 | **Client**                      |
|------------------------------------------------|----------------------------------------------|---------------------------------|
| **Application, control plane, queue, workers** | Responsible                                  | Informed                        |
| **Client Postgres and bucket**                 | Consulted (responsible under managed option) | Responsible                     |
| **Backups and restore of client data**         | Consulted; joins quarterly drill             | Responsible                     |
| **Schema migrations on client DB**             | Responsible (fleet migrator)                 | Approves maintenance window     |
| **Network path**                               | eMithran side                                | Client side                     |
| **Incident response**                          | Leads for eMithran scope                     | Leads for client infrastructure |

## 16.4 Recovery and reconciliation

| **Event**                              | **Procedure**                                                                                                                                                               |
|----------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Database instance or availability-zone failure (pooled or control plane)** | Automatic failover to the multi-AZ standby, under 5 min; counts against the 99.5% |
| **Application or host failure**        | 2 or more replicas per service behind the tunnel; seconds                                                                                                                  |
| **Data corruption or bad migration (pooled)** | Point-in-time restore: RPO 5 min, RTO under 2 h for a database under 100 GB, proven by the monthly drill; a declared incident that counts against the 99.5%; replay queued jobs; reconcile files |
| **Client restores their DB to time T** | Pause tenant; mark jobs for uploads missing after T as orphaned; flag uploads whose files are missing; list objects without rows for the client (never auto-delete); resume |
| **Client bucket restore**              | Same reconciliation, from the file side                                                                                                                                     |
| **Control-plane DB loss**              | PITR; sessions invalidated (users sign in again); jobs in running re-queued idempotently                                                                                    |
| **Region loss**                        | Restore control plane and pooled plane in the second region from cross-region backups: RTO 4 h, RPO 15 min. A disaster, excluded from the availability SLA and covered by DR terms in the contract (PRD 11.5); client data planes unaffected |

## 16.5 Secret store failure mode

The secret store is needed only when a pool is created or a credential rotates, so an outage must not affect running traffic.

| **Measure** | **Effect** |
|---|---|
| **Managed AWS Secrets Manager with KMS, not a self-run Vault cluster** | No cluster to operate |
| **Credentials cached in process memory; on a store error the cached value is used for up to 24 h** | Existing and new pools keep working during an outage |
| **Health checks never call the secret store** | A store outage cannot take down healthy replicas |
| **Rotation with two database users (A/B), switching only after the new one is verified** | A failed rotation never locks eMithran out |
| **Secrets replicated to the DR region; deleted secrets recoverable within the 7-30 day recovery window** | Covers region loss and accidental deletion |
| **Alert on any store error or rotation failure** | Problems surface well before the 24-hour cache runs out |
| **Re-issue runbook: clients issue new credentials through the same intake, about 1 hour per tenant** | Last resort that needs no escrow of client passwords |

A new replica cannot start while the store is down: the runbook says not to deploy during a store outage, and the running replicas carry traffic.

# 17. Migration and rollout

Five phases, each closed by a gate. The cutover in phase 1 is reversible until the point of no return and forward-fix only after it.

<img src="media/fc7dab32f906b092f7fa399f0155be735b38214e.png" title="Phases and gates. PNR = point of no return." style="width:1.76042in;height:6in" alt="Phases and gates. PNR = point of no return." />

*Figure 9. Phases and gates. PNR = point of no return.*

| **Phase**                | **Work**                                                                                                                                                                  | **Exit gate**                                           |
|--------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------|
| **0 Hygiene**            | Rotate 39 historical secrets and the Supabase service key; BFF route handler; CI rules (no browser DB, no new privileged calls); squash migrations to a verified baseline | G1 Security                                             |
| **1 Cutover**            | Load Postgres from baseline, copy files with hash check, link identities, flip flags in stage then prod                                                                   | PNR (section 17.3)                                      |
| **2 Tenancy foundation** | Control-plane tables, registry, sessions, withTenant, Kysely platform layer; browser queries moved behind NestJS; delivery and QC tenancy fix; SSE                        | G2 Isolation                                            |
| **3 Dedicated pilot**    | First client data plane; reference data served from control plane; AI gateway                                                                                             | G3 + G4 for that tenant                                 |
| **4 Finish the port**    | Remaining modules to Kysely; delete PostgREST, Supabase code and the three backend flags                                                                                  | @supabase imports = 0; privileged calls in features = 0 |

## 17.1 Canonical migration source

- After phase 0 the only migration source is backend/migrations, starting at 0000_baseline.sql generated from the production schema. Older trees are kept in git history under the tag pre-squash.

- The baseline is verified: build an empty database from it, dump the schema, normalise and diff against production. The diff must be empty before old files are deleted.

## 17.2 Fleet migrations

| **Rule**             | **Detail**                                                                                              |
|----------------------|---------------------------------------------------------------------------------------------------------|
| **State per tenant** | pending, running, succeeded, failed, paused - stored in the registry with schema_version                |
| **Order**            | Stage copy, then pooled, then dedicated tenants in waves of 3; a failure halts the wave                 |
| **Safety**           | lock_timeout 5 s; statement_timeout declared per migration; long backfills run in batches as app_system |
| **Retry**            | Only migrations marked idempotent are retried automatically; others need an engineer                    |
| **Compatibility**    | Application supports schema N and N-1; contract step only after all tenants reach N                     |
| **Drill**            | A deliberate canary failure is part of the stage drill before each phase gate                           |

## 17.3 Recovery policy (same as PRD 12.1)

| **Window**                        | **Authoritative**   | **Recovery**                                                                                                                          |
|-----------------------------------|---------------------|---------------------------------------------------------------------------------------------------------------------------------------|
| **Cutover window (write freeze)** | Supabase, read-only | Abort: flip flags back; nothing written to the new stack                                                                              |
| **After cutover, before PNR**     | New Postgres        | Rollback only if no customer writes occurred, or if they can be replayed from the audit log by a tested script; otherwise forward-fix |
| **After PNR**                     | New Postgres        | Forward-fix only; Supabase read-only 30 days for forensics, then deleted                                                              |

PNR is declared in writing when row counts and file hashes match, every active user has linked, the 2-week soak had no Sev-1 or Sev-2 incident, and a restore drill on the new database passed.

# 18. Code structure and engineering standards

A thin platform layer owns every outside system, feature modules own their tables, and the costing domain is pure. Conventions are enforced by lint, not by base classes.

<img src="media/e7d0ee8bb3f523b2b3fea0a5e3c87a3bc4709169.png" title="Dependency direction: controllers to services to domain and repositories; only platform ports touch vendors." style="width:3.61458in;height:3.13542in" alt="Dependency direction: controllers to services to domain and repositories; only platform ports touch vendors." />

*Figure 10. Dependency direction: controllers to services to domain and repositories; only platform ports touch vendors.*

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<tbody>
<tr class="odd">
<td><p>backend/src/</p>
<p>platform/ identity/ tenancy/ db/ storage/ jobs/ events/ ai/ telemetry/</p>
<p>modules/&lt;feature&gt;/ &lt;feature&gt;.controller.ts &lt;feature&gt;.service.ts</p>
<p>&lt;feature&gt;.repository.ts &lt;feature&gt;.schema.ts (zod)</p>
<p>domain/ costing kernel, DFM, routing, process engines (pure functions)</p></td>
</tr>
</tbody>
</table>

## 18.1 Rules

| **Rule**                                                                                          | **Enforced by**                              |
|---------------------------------------------------------------------------------------------------|----------------------------------------------|
| **Feature code never imports @auth0/\*, @aws-sdk/\*, pg or @supabase/\***                         | ESLint no-restricted-imports + boundary rule |
| **A module reads and writes only its own tables; other modules are called through their service** | Boundary lint + review                       |
| **withSystem only from files listed in platform/db/system-callers.ts**                            | check-rls-bypass extended                    |
| **Domain functions are pure: inputs in, result out, no clock or I/O**                             | Domain tests run without Nest                |
| **Validate once at the edge with zod; trust types inside**                                        | Contract tests                               |
| **No any, no as unknown as, no non-null assertions on external data**                             | typescript-eslint strict                     |
| **One API contract: OpenAPI from NestJS generates the typed client for Next.js**                  | CI fails on drift                            |
| **Log through the allow-list logger only**                                                        | Lint rule + log canary                       |

## 18.2 Avoiding boilerplate

- Generate instead of writing: database types (kysely-codegen), API client (openapi-typescript), CAD vocabulary (already generated).

- No generic BaseRepository, entity classes or DTO-to-entity mappers.

- Interfaces only at the platform boundary where a second adapter is real (storage, identity, queue, AI).

- Small functions, names that say what happens, comments explain why.

## 18.3 Test strategy

| **Layer**      | **What**                                                                          | **Where**               |
|----------------|-----------------------------------------------------------------------------------|-------------------------|
| **Domain**     | Formulas and engines; the 1,783 existing backend tests stay the safety net        | Every commit            |
| **Data**       | Real Postgres from migrations; catalog checks; isolation matrix                   | Every merge             |
| **API**        | Contract tests per endpoint; parity tests during porting                          | Every merge             |
| **End to end** | Playwright with an Auth0 test tenant: sign-in, org switch, upload to cost, export | Nightly and pre-release |
| **Operations** | Load, revocation, restore, migration canary-failure and crash-injection drills    | Each phase gate         |

# 19. Cleanup plan

Removal candidates found in the repository on 30 October 2026. Nothing is deleted yet; each goes in its own small PR after the phase that makes it safe. memory/ (1,210 files) and generated vocabulary are real inputs and stay.

| **Path or pattern**                                                              | **Problem**                                     | **Action**                                             | **When**                  |
|----------------------------------------------------------------------------------|-------------------------------------------------|--------------------------------------------------------|---------------------------|
| **backend/database/migrations (96), backend/src/database/migrations**            | Extra migration trees                           | Fold into the baseline, then delete                    | Phase 0                   |
| **backend/data/... - Copy.xlsx, ...(1).xlsx, ...\_Abushan.xlsx**                 | Duplicate and personal copies of reference data | Pick the canonical file; delete copies; fix references | Phase 0                   |
| **backend/eng.traineddata**                                                      | OCR model binary at backend root                | Fetch at image build as an artifact                    | Phase 0                   |
| **docker-compose.observability.yml vs docker-compose.monitoring.yml**            | Two observability stacks                        | Keep Prometheus + Grafana                              | Phase 0                   |
| **docker-compose.yml vs docker-compose.prod.yml**                                | Dev file points at a missing Dockerfile         | One compose file with profiles                         | Phase 0                   |
| **cad-engine/railway.json, backend/.railwayignore, Render/Vercel leftovers**     | Several deployment targets                      | Keep one target                                        | After deployment decision |
| **env templates (3)**                                                            | Drift                                           | One template plus overrides                            | Phase 0                   |
| **@nestjs/typeorm**                                                              | Unused dependency                               | Remove                                                 | Phase 0                   |
| **lib/supabase, supabase-auth-provider, supabaseSource branch, usesAuth0 flags** | Supabase frontend code                          | Delete                                                 | After PNR                 |
| **common/supabase (8 files), supabase-object-store, runner Supabase backend**    | Supabase backend code                           | Delete                                                 | After PNR                 |
| **common/db/postgrest-client.ts (Proxy cast as unknown as SupabaseClient)**      | Typed lie; bridge only                          | Delete with PostgREST                                  | Phase 4                   |
| **177 getPrivilegedClient calls**                                                | RLS bypass in features                          | withTenant; withSystem allow-list                      | Phases 2-4                |
| **Root ESLint scanning dist/**                                                   | 41,763 errors mostly from build output          | Ignore build output; no-new-errors ratchet             | Phase 0                   |

# 20. Appendix

## 20.1 Glossary

| **Term**          | **Meaning**                                                                            |
|-------------------|----------------------------------------------------------------------------------------|
| **Control plane** | eMithran-run services and metadata: identity, routing, jobs, telemetry, reference data |
| **Data plane**    | Where business data and files rest: pooled (eMithran) or dedicated (client)            |
| **Tenant**        | One data plane registered in the control plane; hosts one or more organizations        |
| **Organization**  | A customer account; maps 1:1 to an Auth0 Organization                                  |
| **PNR**           | Point of no return in the cutover; after it, forward-fix only                          |
| **BFF**           | Backend-for-frontend: the Next.js server that holds tokens for the browser             |
| **RLS**           | Postgres row-level security                                                            |

## 20.2 Sources

| **Topic**                         | **Source**                                                                                                                                     |
|-----------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| **Browser OAuth best practice**   | RFC 10017, OAuth 2.0 for Browser-Based Applications (BCP 212), Aug 2026 - rfc-editor.org                                                       |
| **Auth0 B2B pricing**             | auth0.com pricing page, retrieved 30 Oct 2026                                                                                                  |
| **PostgreSQL 18**                 | postgresql.org, "PostgreSQL 18 Released", 25 Sep 2025                                                                                          |
| **MinIO status and alternatives** | InfoQ, "MinIO S3 API alternatives", 28 Dec 2025                                                                                                |
| **DPDP Rules 2025**               | S.S. Rana & Co., MeitY notification of 13 Nov 2025                                                                                             |
| **Repository facts**              | eMithran at commit 6e6f044f: docs/CUTOVER_AUTH0_POSTGRES.md, docs/architecture/\*, cad-engine/ARCHITECTURE.md, backend/src, backend/migrations |
| **Review input**                  | eMithran PRD + Design Doc review and prompts (uploaded .docx, Oct 2026)                                                                        |
