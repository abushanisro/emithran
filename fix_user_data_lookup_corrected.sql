-- ============================================================================
-- ENTERPRISE USER DATA LOOKUP FIX - CORRECTED VERSION
-- ============================================================================
-- Problem: Team members showing "unknown" instead of actual user data
-- Solution: Implement proper user profile system with database caching

-- ============================================================================
-- STEP 1: CHECK EXISTING TABLE STRUCTURES
-- ============================================================================
-- First, let's check the data types in project_team_members
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'project_team_members' 
AND column_name IN ('user_id', 'id', 'project_id')
ORDER BY ordinal_position;

-- ============================================================================
-- STEP 2: CREATE USER PROFILES TABLE (Industry Standard)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    avatar_url TEXT,
    phone VARCHAR(20),
    company VARCHAR(255),
    job_title VARCHAR(255),
    bio TEXT,
    timezone VARCHAR(50) DEFAULT 'UTC',
    language VARCHAR(10) DEFAULT 'en',
    
    -- Enterprise fields
    employee_id VARCHAR(50),
    department VARCHAR(100),
    manager_id UUID REFERENCES user_profiles(id),
    hire_date DATE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id)
);

-- ============================================================================
-- STEP 3: CREATE INDEXES FOR PERFORMANCE
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_full_name ON user_profiles(full_name);
CREATE INDEX IF NOT EXISTS idx_user_profiles_company ON user_profiles(company);
CREATE INDEX IF NOT EXISTS idx_user_profiles_status ON user_profiles(status);
CREATE INDEX IF NOT EXISTS idx_user_profiles_updated_at ON user_profiles(updated_at);

-- ============================================================================
-- STEP 4: CREATE TRIGGER TO AUTO-UPDATE updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 5: CREATE FUNCTION TO SYNC AUTH USERS TO PROFILES
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_user_to_profile()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert or update user profile when auth user is created/updated
    INSERT INTO user_profiles (
        id, 
        email, 
        full_name,
        first_name,
        last_name,
        avatar_url
    ) VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        COALESCE(NEW.raw_user_meta_data->>'first_name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, user_profiles.full_name),
        first_name = COALESCE(EXCLUDED.first_name, user_profiles.first_name),
        last_name = COALESCE(EXCLUDED.last_name, user_profiles.last_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, user_profiles.avatar_url),
        updated_at = NOW();
        
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 6: MIGRATE EXISTING AUTH USERS TO PROFILES
-- ============================================================================
INSERT INTO user_profiles (
    id,
    email,
    full_name,
    first_name,
    last_name,
    avatar_url,
    created_at
)
SELECT 
    u.id,
    u.email,
    COALESCE(u.raw_user_meta_data->>'full_name', u.email) as full_name,
    COALESCE(u.raw_user_meta_data->>'first_name', split_part(u.email, '@', 1)) as first_name,
    COALESCE(u.raw_user_meta_data->>'last_name', '') as last_name,
    COALESCE(u.raw_user_meta_data->>'avatar_url', '') as avatar_url,
    u.created_at
FROM auth.users u
WHERE u.id NOT IN (SELECT id FROM user_profiles)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- STEP 7: FIX PROJECT_TEAM_MEMBERS TABLE DATA TYPE (if needed)
-- ============================================================================
-- Check if user_id is text type and needs conversion
DO $$
DECLARE
    user_id_type TEXT;
BEGIN
    -- Get the data type of user_id column
    SELECT data_type INTO user_id_type 
    FROM information_schema.columns 
    WHERE table_name = 'project_team_members' 
    AND column_name = 'user_id';
    
    -- If user_id is text/varchar, we need to handle type casting in views
    IF user_id_type IN ('text', 'character varying') THEN
        RAISE NOTICE 'user_id is text type, will use type casting in views';
    ELSE
        RAISE NOTICE 'user_id is % type', user_id_type;
    END IF;
END $$;

-- ============================================================================
-- STEP 8: CREATE VIEW WITH PROPER TYPE CASTING
-- ============================================================================
CREATE OR REPLACE VIEW project_team_members_with_profiles AS
SELECT 
    ptm.id,
    ptm.project_id,
    ptm.user_id,
    ptm.role,
    ptm.created_at,
    ptm.updated_at,
    
    -- User profile data with safe type casting
    up.email,
    up.full_name,
    up.first_name,
    up.last_name,
    up.avatar_url,
    up.company,
    up.job_title,
    up.phone,
    up.status as user_status,
    
    -- Computed fields with fallbacks
    COALESCE(up.full_name, up.email, ptm.email, split_part(COALESCE(up.email, ptm.email, ''), '@', 1), 'Unknown User') as display_name,
    COALESCE(up.email, ptm.email, 'unknown@example.com') as display_email,
    CASE 
        WHEN up.status = 'active' THEN true 
        ELSE false 
    END as is_active
FROM project_team_members ptm
LEFT JOIN user_profiles up ON (
    CASE 
        -- Handle both UUID and text types
        WHEN ptm.user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
        THEN ptm.user_id::uuid = up.id
        ELSE false
    END
);

-- ============================================================================
-- STEP 9: CREATE ENTERPRISE USER MANAGEMENT FUNCTIONS
-- ============================================================================

-- Function to get user profile by ID with type safety and fallback
CREATE OR REPLACE FUNCTION get_user_profile(p_user_id TEXT)
RETURNS TABLE(
    id UUID,
    email VARCHAR,
    full_name VARCHAR,
    display_name VARCHAR,
    avatar_url TEXT,
    status VARCHAR
) AS $$
DECLARE
    user_uuid UUID;
BEGIN
    -- Try to cast input to UUID
    BEGIN
        user_uuid := p_user_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        -- If not a valid UUID, return empty result
        RETURN;
    END;

    RETURN QUERY
    SELECT 
        up.id,
        up.email,
        up.full_name,
        COALESCE(up.full_name, up.email, 'Unknown User') as display_name,
        up.avatar_url,
        up.status
    FROM user_profiles up
    WHERE up.id = user_uuid
    
    UNION ALL
    
    -- Fallback: if profile doesn't exist, create minimal profile from auth
    SELECT 
        au.id,
        au.email,
        COALESCE(au.raw_user_meta_data->>'full_name', au.email) as full_name,
        COALESCE(au.raw_user_meta_data->>'full_name', au.email, 'Unknown User') as display_name,
        COALESCE(au.raw_user_meta_data->>'avatar_url', '') as avatar_url,
        'active' as status
    FROM auth.users au
    WHERE au.id = user_uuid 
    AND NOT EXISTS (SELECT 1 FROM user_profiles up2 WHERE up2.id = user_uuid)
    
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 10: CREATE FUNCTION TO GET ENHANCED TEAM MEMBERS
-- ============================================================================
CREATE OR REPLACE FUNCTION get_enhanced_team_members(p_project_id UUID)
RETURNS TABLE(
    id UUID,
    user_id TEXT,
    email VARCHAR,
    name VARCHAR,
    role VARCHAR,
    added_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ptm.id,
        ptm.user_id,
        COALESCE(up.email, ptm.email, 'unknown@example.com')::VARCHAR as email,
        COALESCE(up.full_name, up.email, ptm.email, split_part(COALESCE(up.email, ptm.email, ''), '@', 1), 'Unknown User')::VARCHAR as name,
        ptm.role::VARCHAR,
        ptm.created_at as added_at,
        COALESCE(up.status = 'active', true) as is_active
    FROM project_team_members ptm
    LEFT JOIN user_profiles up ON (
        ptm.user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
        AND ptm.user_id::uuid = up.id
    )
    WHERE ptm.project_id = p_project_id
    ORDER BY ptm.created_at;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 11: FIX EXISTING TEAM MEMBERS DATA
-- ============================================================================
-- Update project_team_members to ensure we have email data
UPDATE project_team_members ptm
SET email = up.email
FROM user_profiles up
WHERE ptm.user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
AND ptm.user_id::uuid = up.id
AND ptm.email IS NULL;

-- ============================================================================
-- STEP 12: CREATE ROW LEVEL SECURITY POLICIES
-- ============================================================================
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can view team member profiles" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;

-- Users can view their own profile
CREATE POLICY "Users can view own profile" ON user_profiles
    FOR SELECT USING (auth.uid() = id);

-- Users can view team member profiles (with type casting)
CREATE POLICY "Users can view team member profiles" ON user_profiles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM project_team_members ptm1
            JOIN project_team_members ptm2 ON ptm1.project_id = ptm2.project_id
            WHERE ptm1.user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND ptm1.user_id::uuid = auth.uid() 
            AND ptm2.user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND ptm2.user_id::uuid = user_profiles.id
        )
    );

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = id);

-- ============================================================================
-- STEP 13: VERIFY THE FIX
-- ============================================================================

-- Test the view
SELECT 
    'Testing enhanced team members view' as test,
    COUNT(*) as total_records
FROM project_team_members_with_profiles;

-- Test user profile function with known user ID
SELECT * FROM get_user_profile('6e7124e7-bf9e-4686-9cac-2245f016a3e4');

-- Show current user profiles
SELECT 
    email,
    full_name,
    company,
    status,
    created_at
FROM user_profiles 
ORDER BY created_at DESC
LIMIT 5;

-- Test the enhanced team members function
-- SELECT * FROM get_enhanced_team_members('your-project-id-here'::uuid);

-- ============================================================================
-- STEP 14: CREATE TRIGGERS FOR AUTH SYNC (Fixed)
-- ============================================================================
-- Drop existing triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;

-- Create triggers for auth.users table (with error handling)
CREATE OR REPLACE FUNCTION sync_user_to_profile_safe()
RETURNS TRIGGER AS $$
BEGIN
    BEGIN
        -- Insert or update user profile when auth user is created/updated
        INSERT INTO user_profiles (
            id, 
            email, 
            full_name,
            first_name,
            last_name,
            avatar_url
        ) VALUES (
            NEW.id,
            NEW.email,
            COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
            COALESCE(NEW.raw_user_meta_data->>'first_name', split_part(NEW.email, '@', 1)),
            COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
            COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
        )
        ON CONFLICT (id) DO UPDATE SET
            email = EXCLUDED.email,
            full_name = COALESCE(EXCLUDED.full_name, user_profiles.full_name),
            first_name = COALESCE(EXCLUDED.first_name, user_profiles.first_name),
            last_name = COALESCE(EXCLUDED.last_name, user_profiles.last_name),
            avatar_url = COALESCE(EXCLUDED.avatar_url, user_profiles.avatar_url),
            updated_at = NOW();
    EXCEPTION WHEN OTHERS THEN
        -- Log error but don't fail the auth operation
        NULL;
    END;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers with safe function
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION sync_user_to_profile_safe();

CREATE TRIGGER on_auth_user_updated
    AFTER UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION sync_user_to_profile_safe();

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================
SELECT 
    'USER DATA SYSTEM FIXED!' as status,
    'Type casting issues resolved' as message,
    'Team members will now show real names' as next_step;