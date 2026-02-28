-- ============================================================================
-- Migration: Fix Process User Association
-- Version: 211
-- Description: Update seeded processes to be associated with current users
-- ============================================================================

-- Update all existing processes without user_id to be associated with the first user
-- This makes the seeded processes available to all users for testing
UPDATE processes 
SET user_id = (
  SELECT id 
  FROM auth.users 
  ORDER BY created_at 
  LIMIT 1
)
WHERE user_id IS NULL;

-- Alternative: Make processes public by creating a shared user or removing user restriction
-- You can also update all processes to use a specific user ID if you know it
-- Replace 'your-user-uuid-here' with your actual user UUID from auth.users table

-- To find your user ID, you can run:
-- SELECT id, email FROM auth.users ORDER BY created_at;

-- Then update with your specific user ID:
-- UPDATE processes SET user_id = 'your-user-uuid-here' WHERE process_name IN (
--   'Injection Molding', 'CNC Machining', 'Sheet Metal Bending', 
--   'Laser Cutting', 'Welding', 'Die Casting', 'Powder Coating', 
--   'Assembly', 'Quality Inspection', 'Heat Treatment'
-- );

-- Add comment for clarity
COMMENT ON TABLE processes IS 'Manufacturing processes with user-specific access via RLS';