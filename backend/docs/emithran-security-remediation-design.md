# eMithran Security Remediation: Design Doc

| | |
|---|---|
| **Status** | Draft for review |
| **Author** | Abushan (CTO) |
| **Date** | 2026-11-02 |
| **Source** | Security audit run 1 (source-only, partial), commit `45fe56e`, 13 `needs_validation` leads |
| **Scope** | NestJS backend, Next.js BFF, Postgres/PostgREST migrations, Auth0 identity, Rust `cad-core`, docker-compose prod |

---

## 1. TL;DR

The audit found no confirmed bug (no code was executed), but the 13 leads share **four root causes**. Fix the root causes, not 13 tickets.

| Root cause | Findings | Fix theme |
|---|---|---|
| **A. Authentication used as authorization** on global or cross-member data | #1, #2, #3 | Default-deny authorization, platform-admin guard, no privileged client in request paths |
| **B. Unbounded shared resources** in a single-process backend | #5, #6, #7, #10 | Bound input *before* parsing, isolate parsers, cap concurrency |
| **C. Rate limiting and spend control keyed on the wrong identity** | #8, #9 | Key on verified user/org, central AI budget in the backend |
| **D. Trusting claims or model output where a deterministic check is needed** | #4, #11, #12, #13 | Link by proof not by email, email from `auth.users`, confirm-before-write for LLM memory, isolate secret holder from parser |

Guiding rule for the whole effort: **every finding becomes a failing test first**. Because the audit could not execute anything, step 0 is turning each lead into a reproduction in a disposable environment. A fix without a test that failed before it is a guess.

---

## 2. Goals and non-goals

**Goals**
1. Close all 13 leads, or record an explicit risk acceptance with owner and date.
2. Make the *class* of bug hard to reintroduce (CI guards, not code review memory).
3. No downtime and no tenant-visible behavior change except where a bug is the behavior.
4. Every change is observable (logs and metrics) and reversible (flag or revert).

**Non-goals**
- Memory-safety audit of OCCT/C++ (excluded from run 1; tracked separately).
- Full SOC 2 program. We borrow its evidence habits (decision log, audit trail), nothing more.
- Rewriting the BFF or moving off Auth0.

---

## 3. Design principles

1. **Deny by default.** A route with no declared authorization policy fails CI and fails closed at runtime.
2. **Complete mediation in code, not in prompts.** OWASP's 2025 LLM guidance (excessive agency, LLM06) says the same thing for AI tools as classic access control says for APIs: downstream systems decide what is allowed, never the model.
3. **Bound before you parse.** Size, count, ratio and time limits are enforced on raw bytes before JSON, ZIP or XLSX parsing begins. Declared sizes in headers are hints, never limits (recent adm-zip advisories show attackers declaring size 0 or using async paths that skip the guard, so enforce on *actual* output).
4. **Least privilege for the privileged client.** `getPrivilegedClient` is an exception with a registered justification, not a convenience.
5. **Proof over assertion.** An email claim is an assertion. Auth0's own docs warn that `email_verified` is a point-in-time fact and that linking needs proof of access to both accounts.
6. **Blast radius containment.** One backend process serves every tenant, so any single request must be unable to take it down or read another tenant's data.
7. **Ship dark, then enforce.** New limits run in log-only mode first so we measure real traffic before we reject it.

---

## 4. Workstream 0: validate (week 1, before any fix merges)

Convert each lead's "Resolve locally" section into an automated test in a throwaway compose stack (no network egress, dummy tenants A and B, memory-capped containers).

| Item | Output |
|---|---|
| Repro harness | `docker compose -f compose.audit.yml` with 2 orgs, 3 users (viewer, member, admin), seeded rows |
| Test per finding | Jest/supertest e2e or SQL test, tagged `@security-regression`, expected to **fail on current main** |
| Owner read-only checks | Run the queries listed in `NEEDS-VALIDATION.md` against prod: `pg_policies`, `to_regprocedure('public.cascade_delete_bom_item(uuid)')`, `rate_calibration_history` row count, multi-identity users, Auth0 connection list |
| Telemetry baseline | One week of request body size histogram, 429 counts per route, copilot calls per user per minute |

Exit criterion: every finding is marked **Confirmed**, **Not exploitable (with evidence)** or **Accepted risk**. Re-rank by evidence.

Priority of the owner checks (cheapest, highest information):
1. Auth0 connections and sign-up state (decides #4 and #11 severity).
2. `rate_calibration_history` and `exchange_rates WHERE set_by IS NOT NULL` (tells us if #1/#2 were already exercised).
3. Cloudflare rules and body limits on `/v1/*` (decides #5 urgency).
4. `CAD_CORE` value in stage and prod (decides #13 urgency).

---

## 5. Workstream A: authorization architecture (#1, #2, #3)

### 5.1 Systemic fix: default-deny policy layer

Add a global `AuthzGuard` that requires every handler to declare one of:

```ts
@Public()                       // explicit, reviewed
@OrgRole('member' | 'admin')    // requires OrganizationContextGuard semantics
@PlatformAdmin()                // operators only
@ApiKeyScopes(...)              // existing
```

Handlers with no metadata are rejected with 403 and logged.

**CI enforcement (this is the part that prevents recurrence):** a test boots the Nest app, walks the route table via `DiscoveryService`, and fails if any route lacks a policy. Run it on every PR. Findings #1 and #2 would have been caught the day they were written.

Role source of truth: `organization_members.role` (already exists, currently ignored by `current_user_org_ids()`). Platform admins live in a new table, **not** an Auth0 token claim, so revocation is a DB update and the decision is made server-side:

```sql
create table public.platform_admins (
  user_id uuid primary key references auth.users(id),
  granted_by uuid not null,
  granted_at timestamptz not null default now()
);
-- RLS: no policies; service role only. Read via SECURITY DEFINER fn with set search_path.
```

### 5.2 #1: global exchange rates

Decision needed from product (blocker in audit): *are rates meant to be per tenant?*

| Option | Change | Recommendation |
|---|---|---|
| **A (ship now)** | `@PlatformAdmin()` on `PUT /fx/exchange-rates/:currency`; add bounds check (reject changes over N% vs current without a `force` flag and second approval), audit row with actor, old, new, reason | Do this immediately |
| **B (follow-up)** | `org_exchange_rate_overrides(org_id, currency, rate, set_by)`; costing reads override then global | Do if customers need their own budget rates, which the UI already implies |

Also: hide the edit control in `ExchangeRatesCard` for non-admins, and add a cache-invalidation broadcast (today other instances wait up to 5 minutes).

### 5.3 #2: should-cost calibration

Three separate defects, three fixes:

1. **Exposure.** Remove `calibration/run` and `calibration/actuals` from the public HTTP surface. Run calibration as a scheduled job or CLI under a job identity. If an operator UI is wanted later, `@PlatformAdmin()` only.
2. **Non-idempotent compounding.** Replace "multiply current rate" with "rate = baseline x multiplier":

```sql
alter table mhr_records add column baseline_mhr numeric;
update mhr_records set baseline_mhr = total_machine_hour_rate where baseline_mhr is null and source_type = 'BENCHMARK';
-- calibration then does: total_machine_hour_rate = baseline_mhr * m
-- Running it N times yields the same result as running it once.
```
   Record each run in `rate_calibration_history` with a `run_id`, input pair count and multiplier, and require `>= 5` pairs *from at least 2 organizations* so a single tenant cannot steer global rates.
3. **`recordActual(dto: any)`.** Typed DTO with `whitelist` and `forbidNonWhitelisted`, org-scoped, `entered_by_user_id` taken from the token (never the body), prediction must belong to the caller's org (add `organization_id` to `should_cost_predictions` if missing).

Also verify migration 177 is part of the real migration lineage (see section 11).

### 5.4 #3: BOM-item delete using the service client

Remove the privileged fallback in `manualCascadeDelete`. New behavior:

1. Try deletion as the user (RLS applies).
2. If production lots reference the item, return **409 Conflict** with a machine-readable list of blockers (lot ids the caller can see, plus a count of lots they cannot), matching what `directDelete` already does for FK errors.
3. Add an explicit `force` path only for `@OrgRole('admin')`, implemented as a single reviewed `SECURITY DEFINER` function `delete_bom_item_cascade(uuid)` that checks role itself, sets `search_path`, writes an audit row, and is **checked into migrations** (today `cascade_delete_bom_item` exists outside source, which is a drift problem on its own).
4. `manualCascadeDelete` must throw on any non-PGRST116 error from the visibility check before touching any client.

### 5.5 Privileged client governance (cross-cutting)

- Wrap `getPrivilegedClient(reason)` so each call site registers in an allow-list file (`privileged-callsites.json`). A CI test diffs the actual call sites against the list; additions need a CODEOWNERS security review.
- Lint rule: no `getPrivilegedClient` in `*.controller.ts`.
- Every privileged write emits an audit event with `actor_user_id` (the request user, not the job).

---

## 6. Workstream B: resource exhaustion (#5, #6, #7, #10)

### 6.1 #5: 50 MB body parsed before auth

Root cause: `express.json({limit:'50mb'})` mounted globally runs before guards.

```ts
// main.ts: disable Nest's default parsers and mount our own
const app = await NestFactory.create(AppModule, { bodyParser: false });

// 1) Reject on Content-Length before reading anything
app.use((req, res, next) => {
  const max = routeLimit(req) ?? 256 * 1024;           // 256 KiB default
  const len = Number(req.headers['content-length'] ?? 0);
  if (len > max) return res.status(413).json({ error: 'payload_too_large' });
  next();
});

// 2) Parsers with the same per-route limit; big limits only on named routes
app.use(express.json({ limit: (req) => routeLimit(req) ?? '256kb' }));
```

Notes:
- Chunked requests have no Content-Length, so the parser limit is still required (belt and braces).
- Route limit table is explicit (`BODY_LIMITS = { '/bom-items/bulk': '5mb', ... }`). Build it from the shadow-mode histogram (section 4), not from guesses.
- File uploads go through multipart with `limits.fileSize` set, never through JSON.
- Edge: Cloudflare WAF rule on `/v1/*` blocking `http.request.body.size` above the default, plus a rate limit. This is the cheapest layer and runs before our process sees bytes.
- Set `server.requestTimeout`, `headersTimeout` and `maxHeadersCount` explicitly (slowloris class).

### 6.2 #6 and #7: ZIP/XLSX amplification

Build **one** shared `SafeArchive` module used by the electronics path, XLSX imports (an .xlsx is a ZIP) and CAD uploads. Three layers:

**Layer 1: structural pre-check on the central directory** (no inflation yet)
- Entry count ceiling (for example 2,000), reject ZIP64, encryption, absolute paths and `..`.
- Per-entry and total *declared* uncompressed size ceilings, ratio ceiling.
- **Overlap check:** sort entries by local-header offset; reject if any ranges overlap or share an offset; require the sum of compressed ranges to be at most the buffer length. This kills the "many central records, one local header" trick in #7.

**Layer 2: bounded inflation on actual output**
- Use streaming inflate with a running byte counter that aborts at the limit. Do not rely on `maxOutputLength` taken from the header: it is attacker-controlled, and published adm-zip advisories show both a declared-size-0 bypass and an async path that skipped the guard. Make the limit a constant from our config.
- Stream entries to disk or object storage where the consumer allows it instead of retaining Buffers.

**Layer 3: blast-radius containment**
- Run heavy parsers (xlsx, STEP, archive expand) in a **worker thread with `resourceLimits`** (`maxOldGenerationSizeMb`) or a child process, so an OOM kills the worker, not the API process shared by all tenants.
- Global semaphore for heavy endpoints (for example 2 concurrent parses per instance, plus 1 per org).
- Set `--max-old-space-size` to roughly 70% of the container memory limit so V8 fails with a catchable error before the cgroup OOM killer.

**XLSX specifics (#6):** ExcelJS inflates every entry including `xl/media/*`, which we do not need. Pre-scan with Layer 1, reject any entry over a cap (for example 20 MB) and any `xl/media/*` entry over a few MB; consider the streaming `WorkbookReader` for large sheets. Add `limits.fileSize` to the mhr/lhr multer routes.

**Electronics specifics (#7):** lower `maxTotalBytes` from 1 GiB to a measured budget (start at 200 to 256 MiB; confirm against real customer packs), and use `MAX_ARCHIVE_EXPANDED_BYTES` consistently.

Dependency hygiene: pin and audit archive libraries. 2026 has seen repeated decompression-bomb advisories in adm-zip and node-tar, so add `npm audit`/OSV scanning to CI and subscribe to advisories for `exceljs`, `jszip`, and any archive dependency.

### 6.3 #10: balloon-annotations in-memory store

No first-party UI calls it. Preferred fix: **delete the route**. If it is needed, persist to Postgres with an RLS-protected table (`user_id`, `file_id`, `payload jsonb` with a size CHECK) rather than a per-process Map. A Map also breaks on multi-instance and serverless deploys, so it is a correctness bug as well. Interim: cap entries per user (for example 50) and total (for example 5,000), TTL 24 h, payload cap 256 KB, `isAllowedOrigin` check, and `requireUser` rate limit.

Same pass: add `isAllowedOrigin` and body caps to the other Next route handlers that buffer bodies (`/api/cad`, `extract-inspection-table`, `vave*`), matching the deferred-coverage list in the audit.

---

## 7. Workstream C: rate limiting and AI spend (#8, #9)

### 7.1 #8: shared bucket behind the BFF

Problem: the BFF drops the client address, so the backend tracker sees the frontend container for everyone.

Fix in two parts:

1. **Authenticated traffic is limited per identity, not per IP.** `RequestAuthGuard` already runs before the throttler (registration order in `app.module.ts`), so `req.user` is available:

```ts
protected async getTracker(req: Request): Promise<string> {
  if (req.apiKey)  return `key:${req.apiKey.id}`;
  if (req.user?.id) return `user:${req.user.id}`;         // verified id, never a header
  return `ip:${clientIp(req)}`;                            // pre-auth only
}
```
   Keep a second, looser **per-org** limiter so one tenant's many users cannot starve the process either.
2. **Preserve the real client IP for pre-auth and audit.** The BFF forwards `X-Client-IP` (derived from the incoming CF header) and the backend honors it **only** when the TCP peer is the frontend (network ACL or shared HMAC header). Set Express `trust proxy` to the exact hop count or subnet, never `true`.

Also: tiered limits (burst per second, sustained per minute), `Retry-After` and `RateLimit-*` headers, and Redis storage once the backend runs more than one replica (in-memory limits multiply by replica count).

### 7.2 #9: per-user AI spend

Today the cap lives in one Next route, in memory, per instance, and the backend endpoints it protects are reachable through the generic BFF. Put the control where the money is spent.

**`AiBudgetService` in the backend** (single choke point for copilot, process-plan generator, and anything else calling Anthropic):

| Control | Default (tune with data) |
|---|---|
| Concurrent streams per user | 2 |
| Requests per minute per user | 20 (matches today's intent) |
| Tokens per user per day (input + output from the API `usage` field) | measured p95 x 3 |
| Tokens per org per day | per plan |
| Global daily ceiling with kill switch | env flag, alert at 80% |
| `max_tokens` and history length | server-side constants, not DTO-driven |

Backed by Redis or a Postgres counter table. Record actual usage from the response, not an estimate. Backstops outside the code: Anthropic workspace spend limit and a Cloudflare rate rule on `/v1/copilot/*` and `/v1/process-plan-generator/*`.

Also: `app/api/vave-analysis` forwards an arbitrary client prompt with a 16k `max_tokens` (a free LLM proxy). Build prompts server-side from structured BOM metrics and cap length.

---

## 8. Workstream D: identity and trust boundaries (#4, #11, #12, #13)

### 8.1 #4: auto-link by verified email

Current: any new `sub` presenting a verified email is attached to the oldest user with that email, even if that user already has identities.

Target behavior (matches the consensus in 2026 write-ups on OAuth auto-link account takeovers, and Auth0's own guidance):

1. A known `(provider, sub)` always resolves to its mapped user (unchanged).
2. **Auto-link only on first sign-in of a provisioned user who has zero identities.** The invite is the proof of intent.
3. Require `email_verified = true` **and** the connection is in a **trusted-connection allow-list** (for example the Google Workspace/SAML connection for the customer domain). Social or passwordless connections never auto-link.
4. Any additional identity for an existing user requires an **explicit linking flow** from an authenticated session plus proof from the second identity (Auth0 account-linking pattern), or an admin action.
5. Never overwrite stored email, roles or recovery data from claims during a link.
6. Notify the existing email whenever an identity is added, and write a `link_events` audit row (allowed and denied).

```sql
-- sketch of link_identity v2 decision order
-- 1. mapped sub?                      -> return user_id
-- 2. not verified OR connection not in auth.trusted_connections -> NULL (link_denied logged)
-- 3. candidate = user by lower(email) with NO existing identity  -> insert identity, return user_id
-- 4. candidate has identities         -> NULL ('link_required'), log, notify
```

Auth0 tenant checklist (owner, this week): database sign-ups disabled, only intended connections enabled for the application, post-login Action sets the connection name claim and does not copy `email_verified` from untrusted connections, MFA on for admins, brute-force and breached-password protections on.

### 8.2 #11: token email vs account email

Return `auth.users.email` from `IdentityService.resolve` (as the API-key path already does). Drop the un-namespaced `email`/`email_verified`/`sid` fallback in `auth0-token-verifier.ts`. Persist `reviewer_email` from the user row, not `auth.jwt()->>'email'`. Reduce the 60 s decision-cache TTL for deactivations or add explicit invalidation on `authorized_users` change.

### 8.3 #12: Copilot `update_preferences`

The defense today is a system-prompt rule. Prompt rules are not a security boundary. Direct prompt injection and indirect injection (instructions hidden in data the model reads) remain the top LLM risk in the 2025 OWASP list, and persistent memory is explicitly called out as a target.

Design (confirm-before-write, deterministic):

1. `update_preferences` becomes a **proposal tool**: it returns `{proposal_id, add[], remove[]}` and writes nothing.
2. The UI renders a confirmation chip ("Save to memory: ...  [Save] [Dismiss]"). A separate authenticated endpoint `POST /copilot/memory/proposals/:id/confirm` performs the write. The proposal is bound to user, conversation and turn, expires in minutes, and is single use.
3. Defense in depth: only expose the tool on turns whose latest user message matches an explicit remember/forget intent check; strip control characters and newlines from part names and warnings before they enter the context; wrap all tool results as untrusted.
4. Memory transparency: list and delete endpoints plus a settings UI (today the copilot is the only way to edit memory).
5. Eval suite in CI: a corpus of injection strings in part name, material and warnings, asserting no proposal is emitted for an ordinary cost question. Track the emit rate over model upgrades (`COPILOT_MODEL` changes should re-run it).

### 8.4 #13: cad-core worker isolation

Only matters if `CAD_CORE=rust` is active in stage/prod; the fix is cheap enough to do anyway. In priority order:

1. **Split the container.** `cad-worker` container: no secrets, `network_mode: none`, read-only root, tmpfs scratch, communicates with the runner through a shared volume or pipe. The runner keeps credentials and never parses customer files.
2. If a split is deferred: run the worker as a **different UID**, set `PR_SET_DUMPABLE=0` in the runner, remove `DB_JWT_SECRET` from the runner's environment after reading it (zeroize), launch the worker in a new network namespace, add seccomp or Landlock.
3. **Narrow DB credentials.** The runner should use a dedicated Postgres role with grants on only the tables and functions it needs, rather than minting `service_role` from the shared JWT secret.
4. Compose hygiene from the hardening notes: `PGRST_ADMIN_SERVER_HOST=127.0.0.1`, cloudflared metrics on `127.0.0.1`, `${VAR:?}` for required secrets, fix the stale comment about who can reach PostgREST.
5. Validate part ids against `^[0-9]+(:[0-9]+)*$` in `verify()` with the `../../x` regression test.

---

## 9. Rollout plan

Small PRs, each independently revertable. Flags default off until the dark-launch window closes.

| Phase | When | Contents | Gate to proceed |
|---|---|---|---|
| **0** | Week 1 | Workstream 0 repros, owner read-only checks, telemetry baseline, route-policy inventory | Every finding classified |
| **1: stop the bleeding** | Week 1-2 | `@PlatformAdmin()` on FX write; calibration routes removed from HTTP; calibration idempotent via baseline; `recordActual` typed; BOM delete returns 409; Cloudflare body-size and rate rules; `limits.fileSize` on multer routes | Repro tests green; no regression in e2e |
| **2: shared limits** | Week 2-4 | Body limits (log-only, then enforce); `SafeArchive` and worker-thread parsing; per-user throttler tracker; BFF client IP propagation; `AiBudgetService` | Shadow-mode 413/429 rates reviewed; no legit route rejected |
| **3: identity** | Week 3-5 | `link_identity` v2 and trusted connections; email from `auth.users`; Auth0 tenant hardening; memory confirm-before-write | Auth0 checklist signed off; link audit clean for one week |
| **4: structural** | Week 5-8 | Default-deny authz guard and CI route inventory; privileged call-site registry; cad-worker split; migration lineage cleanup; `SECURITY DEFINER` hygiene | CI guards required on `main` |
| **5: hardening backlog** | Ongoing | Items under "Hardening notes" in the audit (CSP nonces, `.or()` filter quoting, RFQ email escaping, DTO validation, CI secret scoping) | Burn down by area |

Hardening-note batches worth grouping into single PRs:
- **Filter injection:** one `quoteFilterValue(escapeLikePattern())` helper applied to all ~15 `.or()` sites, with the `',id.not.is.null'` regression test.
- **Output encoding:** RFQ email HTML escaping and `cc` as a structured object; `ScheduleView` `escapeHtml`.
- **CI and compose:** remove build-time secrets from PR builds, bind dev ports to `127.0.0.1`, disable Swagger in production.

---

## 10. Testing and verification

- **Security regression suite** (`@security-regression`), one test per finding, runs on every PR against the audit compose stack.
- **Authorization matrix test:** role (anon, viewer, member, admin, platform-admin, API key) x route, generated from the route table; expected status stored in a snapshot that reviewers must approve.
- **RLS tests in SQL** (pgTAP or plain `psql` scripts) for production-lot tables, authorized_users, and org tables, run on a database built from migrations only.
- **Resource tests** in a cgroup-capped container: a 600 MB-expanding XLSX entry and an overlapping-offset ZIP must be rejected before inflation with bounded RSS; 50 MB dense JSON must return 413 without parsing.
- **Load sanity:** after the throttler change, user A at 101 req/min does not affect user B.
- **LLM eval:** injection corpus for memory writes (section 8.3).
- **Mutation check:** temporarily revert each fix and confirm its test fails.

Exit criterion for the project: all regression tests green, route-policy and privileged-call-site CI guards required, owner checks documented, and a re-run of the audit (run 2) with execution enabled in a real sandbox.

---

## 11. Observability and operations

- Metrics: 413/429 counts per route and tenant, parser worker OOM/abort count, peak RSS per heavy request, AI tokens per user/org/day, link allowed/denied, privileged-client calls per call site.
- Alerts: container OOMKilled, AI spend over 80% of ceiling, any `link_required` spike, any platform-admin write.
- Audit log (append-only): FX changes, calibration runs, identity links, privileged deletes, memory confirmations. Store actor, target, before/after.
- **Migration lineage:** audit found schema defined only in the legacy `database/migrations` tree (for example migration 177) and policies that diverged from migration files (902/903). Pick one lineage, baseline it, and add a nightly read-only schema diff between prod and `main` so drift pages someone. Objects created outside migrations (for example `cascade_delete_bom_item`) get backfilled into source.
- Incident readiness: runbook for "rotate `DB_JWT_SECRET`", "disable AI globally", "freeze FX writes".

---

## 12. Standards mapping (OWASP ASVS 5.0 chapters)

| Area | ASVS 5.0 chapter | Findings |
|---|---|---|
| Authorization | V8 Authorization | #1, #2, #3, #11 |
| File handling | V5 File Handling | #6, #7 |
| Authentication and linking | V6 Authentication | #4 |
| Tokens | V9 Self-contained Tokens | #11 (claim trust) |
| Session | V7 Session Management | cache TTL on deactivation |
| Logging | V16 | audit events above |
| LLM risks | OWASP LLM Top 10 2025: LLM01 prompt injection, LLM06 excessive agency, LLM10 unbounded consumption | #9, #12 |

ASVS 5.0 also adds a meta-requirement to document security decisions. This document and the decision log below satisfy it.

---

## 13. Decisions needed (blocking)

| # | Question | Owner | Needed by |
|---|---|---|---|
| D1 | Are budget FX rates global (operator-owned) or per tenant? | Product | Phase 1 |
| D2 | Who are platform admins and how are they granted? | CTO | Phase 1 |
| D3 | Which Auth0 connections are trusted for auto-link? | CTO | Phase 3 |
| D4 | Is `CAD_CORE=rust` enabled in stage or prod? | Infra | Phase 0 |
| D5 | Should viewers be read-only (enforce `organization_members.role`)? | Product | Phase 4 |
| D6 | Per-user and per-org AI daily budgets | Product + Finance | Phase 2 |
| D7 | Is `balloon-annotations` used anywhere? If not, delete. | Eng | Phase 1 |

## 14. Risks of the fixes

- **Over-tight limits reject real traffic.** Mitigation: shadow mode, per-route table built from data, flag rollback.
- **Per-user throttling lets one tenant with many users use more total capacity.** Mitigation: second per-org limiter.
- **Link v2 locks out a legitimate user with a second login method.** Mitigation: admin-assisted link path and clear `link_required` error in the UI before enforcement.
- **Confirm-before-write adds a click to the copilot.** Acceptable: memory writes are rare and durable.
- **Baseline-based calibration needs a correct baseline snapshot.** Take it from the current prod rates after checking `rate_calibration_history`; if calibration already ran repeatedly, restore benchmark rates from the reference source first.

## 15. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-11-02 | Fix by root cause (4 themes), not per finding | Prevents recurrence |
| 2026-11-02 | Authorization is default-deny with a CI route inventory | Class-level control |
| 2026-11-02 | LLM memory writes require user confirmation | Prompts are not a security boundary |
| 2026-11-02 | Limits ship in log-only mode first | Avoid breaking legitimate imports |

---

## References (checked 2026-11-02)

- OWASP ASVS 5.0 (17 chapters, effective May 2025): https://owasp.org/www-project-application-security-verification-standard/
- OWASP Top 10 for LLM Applications 2025, LLM01 and LLM06: https://genai.owasp.org/llm-top-10/
- Auth0, verified email usage and account linking: https://auth0.com/docs/manage-users/user-accounts/user-profiles/verified-email-usage
- WorkOS, three OAuth account takeovers from auto-linking by email (Oct 2026): https://workos.com/blog/oauth-auto-link-email-account-takeover
- WorkOS, safe identity linking: https://workos.com/blog/lessons-in-safe-identity-linking
- adm-zip decompression-bomb bypass advisories (declared size 0, async path): https://osv.dev/vulnerability/GHSA-rcw4-f5rp-g42v and https://osv.dev/vulnerability/GHSA-c6fg-446q-cg94
- node-tar gzip bomb, CVE-2026-59873: https://www.penligent.ai/hackinglabs/?p=6977
- NestJS throttler custom tracker behind proxy and Redis storage: https://github.com/sucat0/user-throttler
