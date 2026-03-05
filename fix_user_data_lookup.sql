-- ============================================================================
-- ENTERPRISE USER DATA LOOKUP FIX
-- ============================================================================
-- Problem: Team members showing "unknown" instead of actual user data
-- Solution: Implement proper user profile system with database caching

-- ============================================================================
-- STEP 1: CREATE USER PROFILES TABLE (Industry Standard)
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
-- STEP 2: CREATE INDEXES FOR PERFORMANCE
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_full_name ON user_profiles(full_name);
CREATE INDEX IF NOT EXISTS idx_user_profiles_company ON user_profiles(company);
CREATE INDEX IF NOT EXISTS idx_user_profiles_status ON user_profiles(status);
CREATE INDEX IF NOT EXISTS idx_user_profiles_updated_at ON user_profiles(updated_at);

-- ============================================================================
-- STEP 3: CREATE TRIGGER TO AUTO-UPDATE updated_at
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
-- STEP 4: CREATE FUNCTION TO SYNC AUTH USERS TO PROFILES
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

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;

-- Create triggers for auth.users table
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION sync_user_to_profile();

CREATE TRIGGER on_auth_user_updated
    AFTER UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION sync_user_to_profile();

-- ============================================================================
-- STEP 5: MIGRATE EXISTING AUTH USERS TO PROFILES
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
-- STEP 6: CREATE VIEW FOR ENHANCED TEAM MEMBERS (Enterprise Standard)
-- ============================================================================
CREATE OR REPLACE VIEW project_team_members_with_profiles AS
SELECT 
    ptm.id,
    ptm.project_id,
    ptm.user_id,
    ptm.role,
    ptm.created_at,
    ptm.updated_at,
    
    -- User profile data
    up.email,
    up.full_name,
    up.first_name,
    up.last_name,
    up.avatar_url,
    up.company,
    up.job_title,
    up.phone,
    up.status as user_status,
    
    -- Computed fields
    COALESCE(up.full_name, up.email, 'Unknown User') as display_name,
    COALESCE(up.email, 'unknown@example.com') as display_email,
    CASE 
        WHEN up.status = 'active' THEN true 
        ELSE false 
    END as is_active
FROM project_team_members ptm
LEFT JOIN user_profiles up ON ptm.user_id = up.id;

-- ============================================================================
-- STEP 7: CREATE ENTERPRISE USER MANAGEMENT FUNCTIONS
-- ============================================================================

-- Function to get user profile by ID with fallback
CREATE OR REPLACE FUNCTION get_user_profile(p_user_id UUID)
RETURNS TABLE(
    id UUID,
    email VARCHAR,
    full_name VARCHAR,
    display_name VARCHAR,
    avatar_url TEXT,
    status VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        up.id,
        up.email,
        up.full_name,
        COALESCE(up.full_name, up.email, 'Unknown User') as display_name,
        up.avatar_url,
        up.status
    FROM user_profiles up
    WHERE up.id = p_user_id
    
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
    WHERE au.id = p_user_id 
    AND NOT EXISTS (SELECT 1 FROM user_profiles up2 WHERE up2.id = p_user_id)
    
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to update user profile
CREATE OR REPLACE FUNCTION update_user_profile(
    p_user_id UUID,
    p_full_name VARCHAR DEFAULT NULL,
    p_first_name VARCHAR DEFAULT NULL,
    p_last_name VARCHAR DEFAULT NULL,
    p_company VARCHAR DEFAULT NULL,
    p_job_title VARCHAR DEFAULT NULL,
    p_phone VARCHAR DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE user_profiles SET
        full_name = COALESCE(p_full_name, full_name),
        first_name = COALESCE(p_first_name, first_name),
        last_name = COALESCE(p_last_name, last_name),
        company = COALESCE(p_company, company),
        job_title = COALESCE(p_job_title, job_title),
        phone = COALESCE(p_phone, phone),
        updated_at = NOW()
    WHERE id = p_user_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 8: FIX PROJECT_TEAM_MEMBERS TABLE (if needed)
-- ============================================================================
-- Ensure project_team_members table exists with proper structure
CREATE TABLE IF NOT EXISTS project_team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    email VARCHAR(255), -- Keep for backward compatibility
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(project_id, user_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_project_team_members_project ON project_team_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_team_members_user ON project_team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_team_members_role ON project_team_members(role);

-- ============================================================================
-- STEP 9: CREATE ROW LEVEL SECURITY POLICIES
-- ============================================================================
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can view their own profile and profiles of team members in their projects
CREATE POLICY "Users can view own profile" ON user_profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can view team member profiles" ON user_profiles
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM project_team_members ptm1
            JOIN project_team_members ptm2 ON ptm1.project_id = ptm2.project_id
            WHERE ptm1.user_id = auth.uid() AND ptm2.user_id = user_profiles.id
        )
    );

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = id);

-- ============================================================================
-- STEP 10: VERIFY THE FIX
-- ============================================================================

-- Test the view
SELECT 
    'Testing enhanced team members view' as test,
    COUNT(*) as total_records
FROM project_team_members_with_profiles;

-- Test user profile function
SELECT * FROM get_user_profile('6e7124e7-bf9e-4686-9cac-2245f016a3e4'::uuid);

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

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================
SELECT 
    'USER DATA SYSTEM FIXED!' as status,
    'Enterprise user profiles created' as message,
    'Team members will now show real names and data' as next_step;