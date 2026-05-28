-- Mithran Developer Portal: API Keys + Request Logs
-- Migration 200

-- ============================================================
-- API KEYS
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name          VARCHAR(100) NOT NULL,
    -- SHA-256 hash of raw key — plaintext is never stored
    key_hash      VARCHAR(64) NOT NULL UNIQUE,
    -- First 12 chars of raw key shown in portal for identification
    key_prefix    VARCHAR(12) NOT NULL,
    scopes        TEXT[] NOT NULL DEFAULT '{"read"}',
    last_used_at  TIMESTAMPTZ,
    expires_at    TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id  ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active   ON api_keys(revoked_at) WHERE revoked_at IS NULL;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_keys_user_select ON api_keys
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY api_keys_user_insert ON api_keys
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY api_keys_user_update ON api_keys
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY api_keys_user_delete ON api_keys
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- REQUEST LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS api_request_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    api_key_id      UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    method          VARCHAR(10) NOT NULL,
    path            TEXT NOT NULL,
    status_code     SMALLINT NOT NULL,
    duration_ms     INTEGER,
    ip_address      INET,
    user_agent      TEXT,
    error_code      VARCHAR(64),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_logs_user_id    ON api_request_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON api_request_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_status     ON api_request_logs(status_code);
CREATE INDEX IF NOT EXISTS idx_request_logs_api_key    ON api_request_logs(api_key_id)
    WHERE api_key_id IS NOT NULL;

ALTER TABLE api_request_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY request_logs_user_select ON api_request_logs
    FOR SELECT USING (auth.uid() = user_id);
-- INSERTs done via service_role key (backend), no user INSERT policy needed

-- ============================================================
-- AUTO-UPDATE updated_at on api_keys
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_api_keys_updated_at'
  ) THEN
    CREATE TRIGGER set_api_keys_updated_at
        BEFORE UPDATE ON api_keys
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;
