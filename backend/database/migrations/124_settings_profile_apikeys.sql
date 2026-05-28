-- Migration 124: User profiles table, API keys table, and storage bucket for avatars
-- Run this in the Supabase SQL editor

-- ============================================================
-- 1. USER PROFILES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
    id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id         UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name    VARCHAR(100),
    avatar_url      TEXT,
    bio             TEXT,
    job_title       VARCHAR(100),
    phone           VARCHAR(50),
    timezone        VARCHAR(50) DEFAULT 'UTC',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER trigger_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. API KEYS TABLE (create if not exists, idempotent)
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
    id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    key_hash        VARCHAR(64)  NOT NULL UNIQUE,
    key_prefix      VARCHAR(20)  NOT NULL,
    scopes          TEXT[]       NOT NULL DEFAULT ARRAY['read'],
    last_used_at    TIMESTAMP WITH TIME ZONE,
    expires_at      TIMESTAMP WITH TIME ZONE,
    revoked_at      TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id   ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash  ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active    ON api_keys(user_id) WHERE revoked_at IS NULL;

-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================

-- user_profiles RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile"   ON user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;

CREATE POLICY "Users can view own profile"
    ON user_profiles FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
    ON user_profiles FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
    ON user_profiles FOR UPDATE
    USING (auth.uid() = user_id);

-- api_keys RLS
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own api_keys"   ON api_keys;
DROP POLICY IF EXISTS "Users can insert own api_keys" ON api_keys;
DROP POLICY IF EXISTS "Users can update own api_keys" ON api_keys;

CREATE POLICY "Users can view own api_keys"
    ON api_keys FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own api_keys"
    ON api_keys FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own api_keys"
    ON api_keys FOR UPDATE
    USING (auth.uid() = user_id);

-- ============================================================
-- 4. STORAGE BUCKET FOR AVATARS
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Drop existing storage policies (idempotent)
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar"     ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar"     ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar"     ON storage.objects;

CREATE POLICY "Avatar images are publicly accessible"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'avatars'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can update their own avatar"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'avatars'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can delete their own avatar"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'avatars'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );
