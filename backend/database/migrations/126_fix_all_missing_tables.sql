-- Migration 126: Create all missing tables in one shot
-- Run this in the Supabase SQL editor to fix all 500 errors.
-- Every statement is idempotent (CREATE IF NOT EXISTS / DROP POLICY IF EXISTS).

-- ============================================================
-- HELPER: shared updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. USER PROFILES  (fixes profile 500)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
    id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id       UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name  VARCHAR(100),
    avatar_url    TEXT,
    bio           TEXT,
    job_title     VARCHAR(100),
    phone         VARCHAR(50),
    timezone      VARCHAR(50) DEFAULT 'UTC',
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);

DROP TRIGGER IF EXISTS trigger_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER trigger_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile"   ON user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;

CREATE POLICY "Users can view own profile"
    ON user_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile"
    ON user_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile"
    ON user_profiles FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================
-- 2. API KEYS  (fixes api-keys 500)
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
    id             UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name           VARCHAR(100) NOT NULL,
    key_hash       VARCHAR(64)  NOT NULL UNIQUE,
    key_prefix     VARCHAR(20)  NOT NULL,
    scopes         TEXT[]       NOT NULL DEFAULT ARRAY['read'],
    workspace_id   UUID,        -- populated after workspaces table exists
    organization_id UUID,       -- populated after organizations table exists
    last_used_at   TIMESTAMP WITH TIME ZONE,
    expires_at     TIMESTAMP WITH TIME ZONE,
    revoked_at     TIMESTAMP WITH TIME ZONE,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id   ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash  ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active    ON api_keys(user_id) WHERE revoked_at IS NULL;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own api_keys"   ON api_keys;
DROP POLICY IF EXISTS "Users can insert own api_keys" ON api_keys;
DROP POLICY IF EXISTS "Users can update own api_keys" ON api_keys;

CREATE POLICY "Users can view own api_keys"
    ON api_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own api_keys"
    ON api_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own api_keys"
    ON api_keys FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================
-- 3. API REQUEST LOGS  (fixes logs 500)
-- ============================================================
CREATE TABLE IF NOT EXISTS api_request_logs (
    id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    method      VARCHAR(10)  NOT NULL,
    path        TEXT         NOT NULL,
    status_code INTEGER      NOT NULL,
    duration_ms INTEGER,
    error_code  VARCHAR(100),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_request_logs_user_id    ON api_request_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_created_at ON api_request_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_status     ON api_request_logs(status_code);

-- Purge logs older than 90 days automatically (optional — remove if you want to keep all logs)
-- CREATE OR REPLACE RULE purge_old_logs AS ON INSERT TO api_request_logs
--   DO ALSO DELETE FROM api_request_logs WHERE created_at < NOW() - INTERVAL '90 days';

ALTER TABLE api_request_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own logs"   ON api_request_logs;
DROP POLICY IF EXISTS "Backend can insert logs"   ON api_request_logs;

CREATE POLICY "Users can view own logs"
    ON api_request_logs FOR SELECT USING (auth.uid() = user_id);

-- Backend uses service role key to write logs — no RLS needed for INSERT
-- (service role bypasses RLS by default)

-- ============================================================
-- 4. ORGANIZATIONS  (fixes org tab)
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
    id                           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name                         VARCHAR(200) NOT NULL,
    entity_type                  VARCHAR(100),
    country                      VARCHAR(100),
    state_province               VARCHAR(100),
    city                         VARCHAR(100),
    address_line1                VARCHAR(200),
    address_line2                VARCHAR(200),
    postal_code                  VARCHAR(20),
    tax_id                       VARCHAR(100),
    customer_type                VARCHAR(50),
    api_use_case                 TEXT,
    use_tags                     TEXT[]  DEFAULT '{}',
    legal_medical_financial      BOOLEAN DEFAULT false,
    under_18                     BOOLEAN DEFAULT false,
    allow_default_workspace_keys BOOLEAN DEFAULT true,
    owner_id                     UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at                   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at                   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON organizations(owner_id);

DROP TRIGGER IF EXISTS trigger_organizations_updated_at ON organizations;
CREATE TRIGGER trigger_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org owner can manage" ON organizations;
DROP POLICY IF EXISTS "Org members can view" ON organizations;

-- Only owner policy here — member-view policy added after organization_members exists (see below)
CREATE POLICY "Org owner can manage" ON organizations
    USING (auth.uid() = owner_id);

-- ============================================================
-- 5. ORGANIZATION MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS organization_members (
    id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
    role            VARCHAR(50) NOT NULL DEFAULT 'member',
    invited_email   VARCHAR(255),
    invited_by      UUID        REFERENCES auth.users(id),
    status          VARCHAR(50) DEFAULT 'active',
    joined_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org_id  ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON organization_members(user_id);

ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members visible to org members" ON organization_members;
DROP POLICY IF EXISTS "Org owner manages members"      ON organization_members;
DROP POLICY IF EXISTS "Members select own row"         ON organization_members;
DROP POLICY IF EXISTS "Org owner manages all members"  ON organization_members;

-- Non-recursive: each user can only see their own membership rows
CREATE POLICY "Members select own row" ON organization_members FOR SELECT
    USING (user_id = auth.uid());

-- Owners can insert/update/delete any member row in their org
CREATE POLICY "Org owner manages all members" ON organization_members
    FOR ALL
    USING (
        organization_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid())
    );

-- Now safe to add org member-view policy — org_members policy is no longer self-referential
DROP POLICY IF EXISTS "Org members can view" ON organizations;
CREATE POLICY "Org members can view" ON organizations FOR SELECT
    USING (
        owner_id = auth.uid()
        OR id IN (
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid()
        )
    );

-- ============================================================
-- 6. WORKSPACES
-- ============================================================
CREATE TABLE IF NOT EXISTS workspaces (
    id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    is_default      BOOLEAN     DEFAULT false,
    created_by      UUID        NOT NULL REFERENCES auth.users(id),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_org_id ON workspaces(organization_id);

DROP TRIGGER IF EXISTS trigger_workspaces_updated_at ON workspaces;
CREATE TRIGGER trigger_workspaces_updated_at
    BEFORE UPDATE ON workspaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can view"   ON workspaces;
DROP POLICY IF EXISTS "Org owner manages workspaces" ON workspaces;

-- Members see workspaces of orgs they belong to (non-recursive — org_members policy is just user_id check)
CREATE POLICY "Workspace members can view" ON workspaces FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid()
        )
    );

-- Owners can manage all workspaces in their org
CREATE POLICY "Org owner manages workspaces" ON workspaces
    FOR ALL
    USING (
        organization_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid())
    );

-- ============================================================
-- 7. ADD COLUMNS + FOREIGN KEYS TO API KEYS (idempotent)
-- ============================================================
DO $$
BEGIN
    -- Add workspace_id column if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'api_keys' AND column_name = 'workspace_id'
    ) THEN
        ALTER TABLE api_keys ADD COLUMN workspace_id UUID;
    END IF;

    -- Add organization_id column if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'api_keys' AND column_name = 'organization_id'
    ) THEN
        ALTER TABLE api_keys ADD COLUMN organization_id UUID;
    END IF;

    -- Add workspace FK if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'api_keys_workspace_id_fkey'
    ) THEN
        ALTER TABLE api_keys
            ADD CONSTRAINT api_keys_workspace_id_fkey
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
    END IF;

    -- Add organization FK if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'api_keys_organization_id_fkey'
    ) THEN
        ALTER TABLE api_keys
            ADD CONSTRAINT api_keys_organization_id_fkey
            FOREIGN KEY (organization_id) REFERENCES organizations(id);
    END IF;
END $$;

-- ============================================================
-- 8. AVATAR STORAGE BUCKET
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar"     ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar"     ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar"     ON storage.objects;

CREATE POLICY "Avatar images are publicly accessible"
    ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "Users can upload their own avatar"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can update their own avatar"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete their own avatar"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
