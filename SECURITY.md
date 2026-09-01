
# Security Architecture & Database Constraints

## Table of Contents
1. [Tenant Isolation Strategy](#tenant-isolation-strategy)
2. [Required Database Constraints](#required-database-constraints)
3. [Row Level Security (RLS) Policies](#row-level-security-rls-policies)
4. [Backend Security Measures](#backend-security-measures)
5. [Rate Limiting Configuration](#rate-limiting-configuration)
6. [Security Testing Checklist](#security-testing-checklist)

---

## Tenant Isolation Strategy

### Multi-Tenancy Model (current, as of the 2026-08-22 org-scoped tenancy migration)
- **Type**: Row-level multi-tenancy, now **organization-scoped** for every core business table, not per-individual-user. Two cost engineers at the same customer company need to see each other's work — a pure `user_id` isolation key can't express that.
- **Isolation key**: `organization_id`, resolved via `current_user_org_ids()` (a `SECURITY DEFINER` SQL function returning the caller's active `organization_members` rows) — not `auth.uid() = user_id` directly.
- **Converted tables** (migrations 539–561): `mhr_records`, `boms`, `bom_items`, the 6-table cost-records cluster (`bom_item_costs`, `packaging_logistics_cost_records`, `procured_parts_cost_records`, `tooling_cost_records`, `raw_material_cost_records`, `process_cost_records`), `rfq_records` + `rfq_tracking`/`rfq_tracking_vendors`/`rfq_tracking_parts`, `projects` + `project_team_members`, `process_plan_generations` + `process_plan_line_edits`, and the `supplier_evaluation_groups` 7-table cluster.
- **Application-level enforcement**: `OrganizationContextGuard` + `@CurrentOrganization()` decorator (`src/common/guards/organization-context.guard.ts`) — resolves 0/1/many active org memberships (0 → 403, many → requires an `X-Organization-Id` header). Applied at the **method** level only, on handlers that actually write `organization_id` — never controller-wide (a controller-wide guard would 403 a legitimate read-only/RLS-only path that needs no `organizationId` in application code at all).
- **Legacy per-user model, still real for some tables**: the worked example below (`calculators`/`calculator_fields`/`calculator_formulas`) predates the org migration. `calculators` itself is documented elsewhere as "own rows + global" rather than strictly per-user — the exact current RLS policy text wasn't re-verified against the live DB while writing this note, so treat the worked example as illustrating the per-user pattern's *shape*, not a guaranteed byte-for-byte match to what's live today. Don't assume every table in this codebase is org-scoped; check the table (and the actual live policy) before writing a new query.
- **Explicitly global-by-product-decision, not per-tenant at all**: `vendors` (`USING (true)`), `raw_materials` (`auth.role() = 'authenticated'`), `calculators` (own rows + global). This was pulled out of the engineering backlog on purpose — it's a product decision (should these be global-by-default with an org override, like `mhr_records`' transitional clause, or fully private per org?), not something to silently "fix" by tightening RLS.
- **Enforcement layers** (both models):
  1. Database constraints (DB level)
  2. Row Level Security policies (DB level)
  3. Query filtering (Application level) — must match whichever isolation key the table actually uses; a manual `.eq('user_id', ...)` filter left in place after a table converts to org-scoped RLS silently under-counts an org-mate's rows (found and fixed repeatedly during the migration — see below)
  4. Authorization guards (Application level)

### Security Principle
**Defense in Depth**: Every layer enforces tenant isolation independently. If one layer fails, others prevent data leakage.

### A real failure class found during the org migration, worth knowing before writing new privileged SQL functions
Several Postgres functions marked `SECURITY DEFINER` (`send_rfq`, `close_rfq`, the `get_supplier_evaluation_group*` family) ran their own internal `user_id = p_user_id` ownership check inside the function body. `SECURITY DEFINER` runs with the function owner's privileges and **completely bypasses RLS** regardless of which client calls it — rewriting a table's RLS policy alone does nothing for a function like this; each one had to be found and rewritten individually to check `organization_members` instead. If you add a new `SECURITY DEFINER` function, it needs its own explicit org-membership check — it will not inherit whatever the table's RLS policy says.

Also found: a `SECURITY DEFINER` trigger (`log_evaluation_activity()`) that inserted rows without ever setting `organization_id` — the insert kept succeeding silently (SECURITY DEFINER bypasses RLS on writes too), but every row it created was invisible forever under the org-scoped SELECT policy (`NULL` never matches `IN (...)`), with no error anywhere. A silent-write/silent-invisible pair like this won't surface in normal testing — check that every INSERT path for an org-scoped table actually sets `organization_id`, not just that the RLS policy exists.

---

## Required Database Constraints

> The worked example in this section and the two that follow (RLS Policies,
> Backend Security Measures) uses `calculators`/`calculator_fields`/
> `calculator_formulas` — real tables, and `calculators` genuinely is still
> isolated this way (own rows + global, not org-scoped — see the product-
> decision note above). Treat this as a correct illustration of the
> per-user pattern specifically, not as "how every table in this app works" —
> most core business tables moved to the organization-scoped pattern
> described above.

### 1. Calculators Table

```sql
-- Primary constraints
ALTER TABLE calculators
  ADD CONSTRAINT calculators_pkey PRIMARY KEY (id),
  ADD CONSTRAINT calculators_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE;

-- Tenant isolation: Ensure user_id is never null
ALTER TABLE calculators
  ALTER COLUMN user_id SET NOT NULL;

-- Business logic constraints
ALTER TABLE calculators
  ADD CONSTRAINT calculators_name_user_unique
    UNIQUE (user_id, name);

-- Index for performance
CREATE INDEX idx_calculators_user_id ON calculators(user_id);
CREATE INDEX idx_calculators_created_at ON calculators(created_at DESC);
```

### 2. Calculator Fields Table

```sql
-- Primary constraints
ALTER TABLE calculator_fields
  ADD CONSTRAINT calculator_fields_pkey PRIMARY KEY (id),
  ADD CONSTRAINT calculator_fields_calculator_fkey
    FOREIGN KEY (calculator_id)
    REFERENCES calculators(id) ON DELETE CASCADE;

-- Unique field names per calculator
ALTER TABLE calculator_fields
  ADD CONSTRAINT calculator_fields_unique_name
    UNIQUE (calculator_id, field_name);

-- Index for performance
CREATE INDEX idx_calculator_fields_calculator_id
  ON calculator_fields(calculator_id);
```

### 3. Calculator Formulas Table

```sql
-- Primary constraints
ALTER TABLE calculator_formulas
  ADD CONSTRAINT calculator_formulas_pkey PRIMARY KEY (id),
  ADD CONSTRAINT calculator_formulas_calculator_fkey
    FOREIGN KEY (calculator_id)
    REFERENCES calculators(id) ON DELETE CASCADE;

-- Unique formula names per calculator
ALTER TABLE calculator_formulas
  ADD CONSTRAINT calculator_formulas_unique_name
    UNIQUE (calculator_id, formula_name);

-- Index for performance
CREATE INDEX idx_calculator_formulas_calculator_id
  ON calculator_formulas(calculator_id);
```

---

## Row Level Security (RLS) Policies

### Enable RLS on All Tables

```sql
ALTER TABLE calculators ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculator_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculator_formulas ENABLE ROW LEVEL SECURITY;
```

### Calculator Policies

```sql
-- SELECT: Users can only read their own calculators
CREATE POLICY calculators_select_policy ON calculators
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: Users can only create calculators for themselves
CREATE POLICY calculators_insert_policy ON calculators
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users can only update their own calculators
CREATE POLICY calculators_update_policy ON calculators
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: Users can only delete their own calculators
CREATE POLICY calculators_delete_policy ON calculators
  FOR DELETE
  USING (auth.uid() = user_id);
```

### Calculator Fields Policies

```sql
-- SELECT: Users can only read fields from their calculators
CREATE POLICY calculator_fields_select_policy ON calculator_fields
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM calculators
      WHERE calculators.id = calculator_fields.calculator_id
      AND calculators.user_id = auth.uid()
    )
  );

-- INSERT: Users can only add fields to their calculators
CREATE POLICY calculator_fields_insert_policy ON calculator_fields
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM calculators
      WHERE calculators.id = calculator_fields.calculator_id
      AND calculators.user_id = auth.uid()
    )
  );

-- UPDATE: Users can only update fields in their calculators
CREATE POLICY calculator_fields_update_policy ON calculator_fields
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM calculators
      WHERE calculators.id = calculator_fields.calculator_id
      AND calculators.user_id = auth.uid()
    )
  );

-- DELETE: Users can only delete fields from their calculators
CREATE POLICY calculator_fields_delete_policy ON calculator_fields
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM calculators
      WHERE calculators.id = calculator_fields.calculator_id
      AND calculators.user_id = auth.uid()
    )
  );
```

### Calculator Formulas Policies

```sql
-- SELECT: Users can only read formulas from their calculators
CREATE POLICY calculator_formulas_select_policy ON calculator_formulas
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM calculators
      WHERE calculators.id = calculator_formulas.calculator_id
      AND calculators.user_id = auth.uid()
    )
  );

-- INSERT: Users can only add formulas to their calculators
CREATE POLICY calculator_formulas_insert_policy ON calculator_formulas
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM calculators
      WHERE calculators.id = calculator_formulas.calculator_id
      AND calculators.user_id = auth.uid()
    )
  );

-- UPDATE: Users can only update formulas in their calculators
CREATE POLICY calculator_formulas_update_policy ON calculator_formulas
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM calculators
      WHERE calculators.id = calculator_formulas.calculator_id
      AND calculators.user_id = auth.uid()
    )
  );

-- DELETE: Users can only delete formulas from their calculators
CREATE POLICY calculator_formulas_delete_policy ON calculator_formulas
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM calculators
      WHERE calculators.id = calculator_formulas.calculator_id
      AND calculators.user_id = auth.uid()
    )
  );
```

---

## Backend Security Measures

### 1. Query-Level Tenant Isolation

**Location**: `calculators.service.ts:59`

All queries MUST include user_id filtering:
```typescript
// ✅ CORRECT
.eq('user_id', userId)

// ❌ WRONG - Missing user_id filter
.eq('id', id)
```

### 2. Ownership Verification Flow

Every write operation follows this pattern:
1. Extract `userId` from JWT token via `@CurrentUser()` decorator
2. Fetch resource with `.eq('user_id', userId)` filter
3. If not found, throw `NotFoundException` (prevents information leakage)
4. Perform operation

**Example**: `calculators.service.ts:264-265`
```typescript
// Verify calculator exists and user owns it
const existing = await this.findOne(id, userId, accessToken);
```

### 3. Input Validation

**Location**: `dto/calculator.dto.ts`

All DTOs use `class-validator` decorators:
- `@IsString()`, `@IsNumber()`, `@IsBoolean()`, `@IsEnum()`
- `@IsOptional()` for optional fields
- `@Min()`, `@Max()` for numeric bounds
- `@IsArray()`, `@ValidateNested()` for nested objects

### 4. Authentication Guards

**Location**: `calculators.controller.ts:5-6, 20`

```typescript
@UseGuards(ThrottlerGuard)  // Rate limiting
@CurrentUser()               // JWT validation + user extraction
@AccessToken()               // Token extraction for Supabase
```

### 5. Error Handling Strategy

**Principle**: Never leak information about whether a resource exists

```typescript
// ✅ CORRECT - Generic message
throw new NotFoundException(`Calculator not found or access denied: ${id}`);

// ❌ WRONG - Reveals existence
if (!exists) throw new NotFoundException('Calculator not found');
if (!owned) throw new ForbiddenException('Access denied');
```

---

## Rate Limiting Configuration

### Current Configuration

**Location**: `calculators.controller.ts:20`

```typescript
@UseGuards(ThrottlerGuard)
```

### Recommended Settings

**File**: `app.module.ts` or `calculators.module.ts`

```typescript
ThrottlerModule.forRoot([
  {
    name: 'short',
    ttl: 1000,        // 1 second
    limit: 10,        // 10 requests per second
  },
  {
    name: 'medium',
    ttl: 60000,       // 1 minute
    limit: 100,       // 100 requests per minute
  },
  {
    name: 'long',
    ttl: 900000,      // 15 minutes
    limit: 1000,      // 1000 requests per 15 minutes
  },
]),
```

### Per-Endpoint Overrides

```typescript
// Stricter limits for write operations
@Throttle({ short: { limit: 5, ttl: 1000 } })
@Post()
async create() { }

// More lenient for read operations
@Throttle({ short: { limit: 20, ttl: 1000 } })
@Get()
async findAll() { }
```

---

## Security Testing Checklist

### Tenant Isolation Tests

- [ ] **Test 1**: User A cannot read User B's calculators via GET /calculators
- [ ] **Test 2**: User A cannot read User B's calculator via GET /calculators/:id
- [ ] **Test 3**: User A cannot update User B's calculator via PUT /calculators/:id
- [ ] **Test 4**: User A cannot delete User B's calculator via DELETE /calculators/:id
- [ ] **Test 5**: User A cannot add fields to User B's calculator via POST /calculators/:id/fields
- [ ] **Test 6**: User A cannot update User B's fields via PUT /calculators/:id/fields/:fieldId
- [ ] **Test 7**: User A cannot delete User B's fields via DELETE /calculators/:id/fields/:fieldId
- [ ] **Test 8**: User A cannot add formulas to User B's calculator
- [ ] **Test 9**: User A cannot modify User B's formulas
- [ ] **Test 10**: User A cannot execute User B's calculator

### Rate Limiting Tests

- [ ] **Test 11**: Verify 429 response after exceeding rate limit
- [ ] **Test 12**: Verify rate limit resets after TTL expires
- [ ] **Test 13**: Verify different limits for read vs write operations

### Input Validation Tests

- [ ] **Test 14**: Reject invalid enum values for calculatorType
- [ ] **Test 15**: Reject invalid field types
- [ ] **Test 16**: Reject negative display_order values
- [ ] **Test 17**: Reject decimal_places > 10
- [ ] **Test 18**: Reject missing required fields

### Database Constraint Tests

- [ ] **Test 19**: Duplicate calculator names for same user should fail
- [ ] **Test 20**: Duplicate field names within same calculator should fail
- [ ] **Test 21**: Duplicate formula names within same calculator should fail
- [ ] **Test 22**: Calculator creation without user_id should fail
- [ ] **Test 23**: Cascade delete removes all fields and formulas

### RLS Policy Tests

- [ ] **Test 24**: Direct database query as User A cannot access User B's data
- [ ] **Test 25**: Service account can access all data (for admin operations)
- [ ] **Test 26**: Anonymous users cannot access any data

---

## Common Security Pitfalls to Avoid

### ❌ NEVER Do This

1. **Missing user_id filter in queries**
   ```typescript
   // ❌ WRONG
   await client.from('calculators').select('*').eq('id', id);
   ```

2. **Trusting client-provided user_id**
   ```typescript
   // ❌ WRONG
   async create(dto: CreateCalculatorDto, userId: string) {
     // What if client sends different userId in DTO?
     const { userId: clientUserId, ...data } = dto;
   }
   ```

3. **Separate existence check and permission check**
   ```typescript
   // ❌ WRONG - Information leakage
   const calc = await this.findById(id);
   if (!calc) throw new NotFoundException('Not found');
   if (calc.user_id !== userId) throw new ForbiddenException('Access denied');
   ```

4. **Optional user_id filtering**
   ```typescript
   // ❌ WRONG
   let query = client.from('calculators').select('*');
   if (userId) {
     query = query.eq('user_id', userId);
   }
   ```

### ✅ ALWAYS Do This

1. **Filter by user_id in all queries**
   ```typescript
   // ✅ CORRECT
   await client
     .from('calculators')
     .select('*')
     .eq('id', id)
     .eq('user_id', userId)  // Always filter by user_id
     .single();
   ```

2. **Extract user_id from authenticated token only**
   ```typescript
   // ✅ CORRECT
   async create(
     @Body() dto: CreateCalculatorDto,
     @CurrentUser() user: any,  // From JWT token, not client
   ) {
     return this.service.create(dto, user.id, token);
   }
   ```

3. **Single query with combined checks**
   ```typescript
   // ✅ CORRECT - No information leakage
   const calc = await this.findOne(id, userId);  // Returns 404 for both cases
   ```

4. **Mandatory user_id filtering**
   ```typescript
   // ✅ CORRECT
   const query = client
     .from('calculators')
     .select('*')
     .eq('user_id', userId);  // Always present, never conditional
   ```

---

## Audit Log Recommendations

Consider adding audit logging for:
- All write operations (CREATE, UPDATE, DELETE)
- Failed authorization attempts
- Rate limit violations
- Suspicious activity patterns

**Example Table Schema**:
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id UUID,
  status VARCHAR(20) NOT NULL, -- 'success' | 'failure'
  error_message TEXT,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
```

---

## Review Schedule

- [ ] **Weekly**: Review access patterns in logs
- [ ] **Monthly**: Run security test suite
- [ ] **Quarterly**: Penetration testing
- [ ] **Annually**: Third-party security audit

---

**Last Updated**: 2026-09-01 (Tenant Isolation Strategy section updated to reflect the
organization-scoped tenancy migration, migrations 539–561; the rest of this document —
the `calculators` worked example, rate limiting, testing checklist — is unchanged from
its original 2026-01-06 version and still accurate for the tables it describes).
