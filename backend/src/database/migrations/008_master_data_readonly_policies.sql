-- ================================================================
-- MASTER DATA READ-ONLY POLICIES
-- emuski@mithran.com creates master data that is read-only for others
-- Other users can create their own data but cannot modify master data
-- ================================================================

-- Get the master user ID for emuski@mithran.com
-- This will be used in all policies to identify master data

-- ================================================================
-- CALCULATORS: Master data read-only
-- ================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can update their own calculators or master data calculators" ON calculators;
DROP POLICY IF EXISTS "Users can delete their own calculators or master data calculators" ON calculators;

-- Create new read-only master data policies
CREATE POLICY "Users can update only their own calculators (master data is read-only)"
ON calculators FOR UPDATE
TO authenticated
USING (
    user_id = auth.uid() AND 
    user_id != (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1)
)
WITH CHECK (
    user_id = auth.uid() AND 
    user_id != (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1)
);

CREATE POLICY "Master user can update all calculators"
ON calculators FOR UPDATE
TO authenticated
USING (auth.uid() = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1))
WITH CHECK (auth.uid() = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1));

CREATE POLICY "Users can delete only their own calculators (master data is protected)"
ON calculators FOR DELETE
TO authenticated
USING (
    user_id = auth.uid() AND 
    user_id != (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1)
);

CREATE POLICY "Master user can delete all calculators"
ON calculators FOR DELETE
TO authenticated
USING (auth.uid() = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1));

-- ================================================================
-- PROCESSES: Master data read-only
-- ================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can update their own processes or master data processes" ON processes;
DROP POLICY IF EXISTS "Users can delete their own processes or master data processes" ON processes;

-- Create new read-only master data policies
CREATE POLICY "Users can update only their own processes (master data is read-only)"
ON processes FOR UPDATE
TO authenticated
USING (
    user_id = auth.uid() AND 
    user_id != (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1)
)
WITH CHECK (
    user_id = auth.uid() AND 
    user_id != (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1)
);

CREATE POLICY "Master user can update all processes"
ON processes FOR UPDATE
TO authenticated
USING (auth.uid() = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1))
WITH CHECK (auth.uid() = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1));

CREATE POLICY "Users can delete only their own processes (master data is protected)"
ON processes FOR DELETE
TO authenticated
USING (
    user_id = auth.uid() AND 
    user_id != (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1)
);

CREATE POLICY "Master user can delete all processes"
ON processes FOR DELETE
TO authenticated
USING (auth.uid() = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1));

-- ================================================================
-- VENDORS: Master data read-only (if not already set)
-- ================================================================

-- Check and update vendor policies if needed
DO $$
BEGIN
    -- Drop existing update/delete policies for vendors if they exist
    DROP POLICY IF EXISTS "Users can update all vendors" ON vendors;
    DROP POLICY IF EXISTS "Users can delete all vendors" ON vendors;
    
    -- Create read-only master data policies for vendors
    CREATE POLICY "Users can update only their own vendors (master data is read-only)"
    ON vendors FOR UPDATE
    TO authenticated
    USING (
        user_id = auth.uid() AND 
        user_id != (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1)
    )
    WITH CHECK (
        user_id = auth.uid() AND 
        user_id != (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1)
    );

    CREATE POLICY "Master user can update all vendors"
    ON vendors FOR UPDATE
    TO authenticated
    USING (auth.uid() = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1))
    WITH CHECK (auth.uid() = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1));

    CREATE POLICY "Users can delete only their own vendors (master data is protected)"
    ON vendors FOR DELETE
    TO authenticated
    USING (
        user_id = auth.uid() AND 
        user_id != (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1)
    );

    CREATE POLICY "Master user can delete all vendors"
    ON vendors FOR DELETE
    TO authenticated
    USING (auth.uid() = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1));
END $$;

-- ================================================================
-- RAW MATERIALS: Master data read-only
-- ================================================================

-- Apply same pattern to materials table if it exists
DO $$
BEGIN
    -- Check if materials table exists and apply policies
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'materials') THEN
        -- Drop existing policies
        DROP POLICY IF EXISTS "Users can update materials" ON materials;
        DROP POLICY IF EXISTS "Users can delete materials" ON materials;
        
        -- Create read-only master data policies
        CREATE POLICY "Users can update only their own materials (master data is read-only)"
        ON materials FOR UPDATE
        TO authenticated
        USING (
            user_id = auth.uid() AND 
            user_id != (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1)
        )
        WITH CHECK (
            user_id = auth.uid() AND 
            user_id != (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1)
        );

        CREATE POLICY "Master user can update all materials"
        ON materials FOR UPDATE
        TO authenticated
        USING (auth.uid() = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1))
        WITH CHECK (auth.uid() = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1));

        CREATE POLICY "Users can delete only their own materials (master data is protected)"
        ON materials FOR DELETE
        TO authenticated
        USING (
            user_id = auth.uid() AND 
            user_id != (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1)
        );

        CREATE POLICY "Master user can delete all materials"
        ON materials FOR DELETE
        TO authenticated
        USING (auth.uid() = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1));
    END IF;
END $$;

-- ================================================================
-- Add helpful comments and indexes
-- ================================================================

-- Add comments explaining the master data pattern
COMMENT ON POLICY "Users can update only their own calculators (master data is read-only)" ON calculators IS 
'Users can only edit their own calculators. Master data from emuski@mithran.com is read-only for other users.';

COMMENT ON POLICY "Users can update only their own processes (master data is read-only)" ON processes IS 
'Users can only edit their own processes. Master data from emuski@mithran.com is read-only for other users.';

-- Create view to easily identify master data
CREATE OR REPLACE VIEW master_data_summary AS
SELECT 
    'calculators' as table_name,
    COUNT(*) as total_records,
    COUNT(CASE WHEN user_id = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1) THEN 1 END) as master_records,
    COUNT(CASE WHEN user_id != (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1) THEN 1 END) as user_records
FROM calculators
UNION ALL
SELECT 
    'processes' as table_name,
    COUNT(*) as total_records,
    COUNT(CASE WHEN user_id = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1) THEN 1 END) as master_records,
    COUNT(CASE WHEN user_id != (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1) THEN 1 END) as user_records
FROM processes
UNION ALL
SELECT 
    'vendors' as table_name,
    COUNT(*) as total_records,
    COUNT(CASE WHEN user_id = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1) THEN 1 END) as master_records,
    COUNT(CASE WHEN user_id != (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com' LIMIT 1) THEN 1 END) as user_records
FROM vendors;