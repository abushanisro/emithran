-- ================================================================
-- SHARED MANUFACTURING PROCESS POLICIES  
-- Make manufacturing processes shared across all users like vendors
-- ================================================================

-- Drop existing user-isolated policies for processes
DROP POLICY IF EXISTS "Users can view their own processes or global processes" ON processes;
DROP POLICY IF EXISTS "Users can insert processes" ON processes;
DROP POLICY IF EXISTS "Users can update their own processes" ON processes;
DROP POLICY IF EXISTS "Users can delete their own processes" ON processes;

-- Create new shared policies for processes (like vendors)
CREATE POLICY "Authenticated users can view all processes"
ON processes FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert processes"
ON processes FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own processes or master data processes"
ON processes FOR UPDATE
TO authenticated
USING (user_id = auth.uid() OR user_id = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com'))
WITH CHECK (user_id = auth.uid() OR user_id = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com'));

CREATE POLICY "Users can delete their own processes or master data processes"
ON processes FOR DELETE
TO authenticated
USING (user_id = auth.uid() OR user_id = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com'));

-- Enable RLS on processes table
ALTER TABLE processes ENABLE ROW LEVEL SECURITY;

-- Create index for performance (if not exists)
CREATE INDEX IF NOT EXISTS idx_processes_shared_access 
ON processes(user_id, process_category);

COMMENT ON POLICY "Authenticated users can view all processes" ON processes IS 
'All authenticated users can view all processes (shared like vendors)';

COMMENT ON POLICY "Users can update their own processes or master data processes" ON processes IS 
'Users can edit their own processes, emuski@mithran.com can edit master data processes';