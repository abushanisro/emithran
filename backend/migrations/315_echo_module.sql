-- ============================================================================
-- Echo Module — Manufacturing Copilot
-- Migration 315
--
-- Tables:
--   echo_conversations            persistent chat sessions
--   echo_messages                 user/assistant/tool turns
--   echo_context_snapshots        entity-context capture per turn (V2 graph seed)
--   echo_alerts                   proactive nudges (RFQ, cost spike, stale lot, ...)
--   echo_suggestion_dismissals    user-level cooldown for dynamic suggestions
--   echo_hints                    seed-only hint content keyed by (route, topic)
--
-- All tables are user-owned via owner_id. RLS isolates rows per user.
-- ============================================================================

-- Reuse the project-wide updated_at trigger function. Created in earlier
-- migrations (313_benchmark_sessions_schema.sql:43); guarded re-creation.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $func$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $func$ LANGUAGE plpgsql;
  END IF;
END$$;

-- ─── echo_conversations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS echo_conversations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title          VARCHAR(280),
  skill          VARCHAR(64),
  pinned         BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_echo_conv_owner_updated
  ON echo_conversations(owner_id, archived_at NULLS FIRST, updated_at DESC);

ALTER TABLE echo_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "echo_conv_select" ON echo_conversations
  FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "echo_conv_insert" ON echo_conversations
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "echo_conv_update" ON echo_conversations
  FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "echo_conv_delete" ON echo_conversations
  FOR DELETE USING (auth.uid() = owner_id);

CREATE TRIGGER trg_echo_conv_updated
  BEFORE UPDATE ON echo_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── echo_messages ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS echo_messages (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id        UUID NOT NULL REFERENCES echo_conversations(id) ON DELETE CASCADE,
  owner_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role                   VARCHAR(16) NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content                TEXT NOT NULL,
  tool_calls             JSONB,
  skill                  VARCHAR(64),
  page_route             VARCHAR(280),
  entity_type            VARCHAR(64),
  entity_id              UUID,
  model                  VARCHAR(64),
  tokens_in              INTEGER NOT NULL DEFAULT 0,
  tokens_out             INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
  duration_ms            INTEGER,
  credits_charged        INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_echo_msg_conv_created
  ON echo_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_echo_msg_owner_created
  ON echo_messages(owner_id, created_at DESC);

ALTER TABLE echo_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "echo_msg_select" ON echo_messages
  FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "echo_msg_insert" ON echo_messages
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "echo_msg_update" ON echo_messages
  FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "echo_msg_delete" ON echo_messages
  FOR DELETE USING (auth.uid() = owner_id);

-- ─── echo_context_snapshots ───────────────────────────────────────────────
-- Every turn snapshots the live entity state Echo saw. Becomes the seed for the
-- V2 Manufacturing Intelligence Graph: cost deltas, vendor selections, decisions.
CREATE TABLE IF NOT EXISTS echo_context_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES echo_conversations(id) ON DELETE CASCADE,
  message_id      UUID REFERENCES echo_messages(id) ON DELETE CASCADE,
  route           VARCHAR(280) NOT NULL,
  entity_type     VARCHAR(64),
  entity_id       UUID,
  context_json    JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_echo_snap_owner_entity_created
  ON echo_context_snapshots(owner_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_echo_snap_conv
  ON echo_context_snapshots(conversation_id);

ALTER TABLE echo_context_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "echo_snap_select" ON echo_context_snapshots
  FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "echo_snap_insert" ON echo_context_snapshots
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "echo_snap_delete" ON echo_context_snapshots
  FOR DELETE USING (auth.uid() = owner_id);

-- ─── echo_alerts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS echo_alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind                VARCHAR(64) NOT NULL,
  severity            VARCHAR(16) NOT NULL CHECK (severity IN ('info','warn','urgent')),
  title               VARCHAR(280) NOT NULL,
  body                TEXT,
  link_route          VARCHAR(280),
  next_action         TEXT,
  source_entity_type  VARCHAR(64),
  source_entity_id    UUID,
  metadata            JSONB,
  dismissed_at        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Idempotency: avoid duplicate alerts for the same (owner, kind, entity)
  CONSTRAINT echo_alerts_owner_kind_entity_uniq
    UNIQUE (owner_id, kind, source_entity_type, source_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_echo_alerts_owner_active
  ON echo_alerts(owner_id, dismissed_at NULLS FIRST, created_at DESC);

ALTER TABLE echo_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "echo_alerts_select" ON echo_alerts
  FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "echo_alerts_insert" ON echo_alerts
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "echo_alerts_update" ON echo_alerts
  FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "echo_alerts_delete" ON echo_alerts
  FOR DELETE USING (auth.uid() = owner_id);

-- ─── echo_suggestion_dismissals ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS echo_suggestion_dismissals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  suggestion_key  VARCHAR(280) NOT NULL,
  dismissed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT echo_sugg_dismiss_uniq UNIQUE (owner_id, suggestion_key)
);

CREATE INDEX IF NOT EXISTS idx_echo_sugg_dismiss_owner
  ON echo_suggestion_dismissals(owner_id, dismissed_at DESC);

ALTER TABLE echo_suggestion_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "echo_sugg_select" ON echo_suggestion_dismissals
  FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "echo_sugg_insert" ON echo_suggestion_dismissals
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "echo_sugg_delete" ON echo_suggestion_dismissals
  FOR DELETE USING (auth.uid() = owner_id);

-- ─── echo_hints (seed-only knowledge base) ────────────────────────────────
-- Public read for all authenticated users; writes only via service role.
CREATE TABLE IF NOT EXISTS echo_hints (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_glob   VARCHAR(280) NOT NULL,
  topic_id     VARCHAR(128) NOT NULL,
  title        VARCHAR(280) NOT NULL,
  content_md   TEXT NOT NULL,
  tags         TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT echo_hints_route_topic_uniq UNIQUE (route_glob, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_echo_hints_route ON echo_hints(route_glob);
CREATE INDEX IF NOT EXISTS idx_echo_hints_topic ON echo_hints(topic_id);

ALTER TABLE echo_hints ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all hints; only service role can write.
CREATE POLICY "echo_hints_select_authenticated" ON echo_hints
  FOR SELECT USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

CREATE TRIGGER trg_echo_hints_updated
  BEFORE UPDATE ON echo_hints
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── Seed hints ───────────────────────────────────────────────────────────
INSERT INTO echo_hints (route_glob, topic_id, title, content_md, tags) VALUES
  ('/projects/*/bom',
   'bom.cost-rollup',
   'BOM cost rollup',
   E'Costs roll up bottom-up from child parts through sub-assemblies to the root BOM item.\n\n- **Own cost** = raw material + process + tooling + packaging + procured parts.\n- **Total cost** = own cost + sum of direct-children total cost.\n\nTo trigger a rollup, click **Recalculate** on the cost panel, or call the bulk endpoint. Costs are stored on `bom_item_costs` and are not recalculated automatically when child rates change — re-run after editing rates.',
   ARRAY['bom','cost']),
  ('/projects/*/process-planning',
   'process.candidate-selection',
   'How candidate selection works',
   E'Process planning runs a 3-stage AI pipeline:\n\n1. **Retrieval** — fetches candidate raw materials, machines, labour, processes, calculators scoped to the part family.\n2. **Reasoning** — Claude picks a subset, may expand candidates via tool calls.\n3. **Resolver** — converts the abstract plan to draft cost lines.\n\nIf the AI returns *out_of_scope*, the part family (e.g. casting) is not yet supported — fall back to manual planning.',
   ARRAY['process','ai']),
  ('/projects/*/rfq',
   'rfq.generate',
   'Generating an RFQ',
   E'1. Pick parts to include.\n2. Select target vendors from the master list (filter by process + capability).\n3. Confirm. Email goes via the platform mailbox; recipients see a magic-link to upload their quote.\n4. Track responses in the **RFQ Tracking** tab. Pending > 3 days raises an Echo alert.',
   ARRAY['rfq','procurement']),
  ('/projects/*/supplier-nomination',
   'supplier.nominate',
   'Supplier nomination scoring',
   E'Each candidate vendor is scored on cost, lead time, development cost, financial risk, and a custom assessment score. The combined ranking column is **overall_rank**. Echo can rank suppliers for any part on demand — ask "rank suppliers for part X".',
   ARRAY['supplier','scoring']),
  ('/vave',
   'vave.workflow',
   'VAVE workflow',
   E'VAVE projects track cost-reduction ideas against a baseline BOM. For each idea, capture: estimated savings (USD), affected parts, implementation risk. Apply realised ideas to the live BOM with a single click.',
   ARRAY['vave','cost']),
  ('/hr-rates',
   'mhr.setup',
   'Setting machine hour rates',
   E'Machine Hour Rates (MHR) combine machine depreciation, energy, consumables, labour overhead, and shop overhead. The calculator runs in O(1) once rates are set. To tune for a specific machine, edit the row and re-save — downstream process-cost calculations pick up the new rate immediately.',
   ARRAY['mhr','rates'])
ON CONFLICT (route_glob, topic_id) DO NOTHING;
