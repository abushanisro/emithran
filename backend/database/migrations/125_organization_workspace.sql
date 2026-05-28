-- Migration 125: Organizations, Members, and Workspaces
-- Run in Supabase SQL editor

-- ============================================================
-- 1. ORGANIZATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
    id                          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name                        VARCHAR(200) NOT NULL,
    entity_type                 VARCHAR(100),          -- Individual, Startup, Enterprise, etc.
    country                     VARCHAR(100),
    state_province              VARCHAR(100),
    city                        VARCHAR(100),
    address_line1               VARCHAR(200),
    address_line2               VARCHAR(200),
    postal_code                 VARCHAR(20),
    tax_id                      VARCHAR(100),          -- GST / VAT / EIN etc.
    customer_type               VARCHAR(50),           -- internal | external | both
    api_use_case                TEXT,
    use_tags                    TEXT[]  DEFAULT '{}',
    legal_medical_financial     BOOLEAN DEFAULT false,
    under_18                    BOOLEAN DEFAULT false,
    allow_default_workspace_keys BOOLEAN DEFAULT true,
    owner_id                    UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at                  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at                  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON organizations(owner_id);

DROP TRIGGER IF EXISTS trigger_organizations_updated_at ON organizations;
CREATE TRIGGER trigger_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. ORGANIZATION MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS organization_members (
    id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
    role            VARCHAR(50) NOT NULL DEFAULT 'member', -- owner | admin | member | viewer
    invited_email   VARCHAR(255),
    invited_by      UUID        REFERENCES auth.users(id),
    status          VARCHAR(50) DEFAULT 'active',          -- active | invited | suspended
    joined_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org_id  ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON organization_members(user_id);

-- ============================================================
-- 3. WORKSPACES
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

-- ============================================================
-- 4. ADD WORKSPACE & ORG TO API KEYS
-- ============================================================
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS workspace_id     UUID REFERENCES workspaces(id);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS organization_id  UUID REFERENCES organizations(id);

-- ============================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================

-- organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org owner can manage" ON organizations;
DROP POLICY IF EXISTS "Org members can view" ON organizations;

CREATE POLICY "Org owner can manage" ON organizations
    USING (auth.uid() = owner_id);

CREATE POLICY "Org members can view" ON organizations FOR SELECT
    USING (
        id IN (
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

-- organization_members
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members visible to org members" ON organization_members;
DROP POLICY IF EXISTS "Org owner manages members"      ON organization_members;

CREATE POLICY "Members visible to org members" ON organization_members FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "Org owner manages members" ON organization_members
    USING (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_id = auth.uid()
        )
    );

-- workspaces
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can view"  ON workspaces;
DROP POLICY IF EXISTS "Org owner manages workspaces" ON workspaces;

CREATE POLICY "Workspace members can view" ON workspaces FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "Org owner manages workspaces" ON workspaces
    USING (
        organization_id IN (
            SELECT id FROM organizations WHERE owner_id = auth.uid()
        )
    );
