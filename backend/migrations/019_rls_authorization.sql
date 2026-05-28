-- RLS Authorization Enforcement
-- This migration moves ALL authorization logic to Supabase RLS policies
-- No backend checks needed - the database enforces everything

-- ============================================================================
-- HELPER FUNCTION: Check if user is authorized
-- ============================================================================

-- This function checks if the current user's email exists in authorized_users
-- and is active. Used by all RLS policies.
CREATE OR REPLACE FUNCTION is_user_authorized()
RETURNS BOOLEAN AS $$
DECLARE
  user_email TEXT;
  is_active_user BOOLEAN;
BEGIN
  SELECT email INTO user_email
  FROM auth.users
  WHERE id = auth.uid();

  IF user_email IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT is_active INTO is_active_user
  FROM authorized_users
  WHERE email = user_email;

  RETURN COALESCE(is_active_user, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- UPDATE ALL TABLE POLICIES TO REQUIRE AUTHORIZATION
-- ============================================================================

-- Projects policies
DROP POLICY IF EXISTS "Authorized users can view their own projects" ON projects;
DROP POLICY IF EXISTS "Authorized users can insert their own projects" ON projects;
DROP POLICY IF EXISTS "Authorized users can update their own projects" ON projects;
DROP POLICY IF EXISTS "Authorized users can delete their own projects" ON projects;

CREATE POLICY "Authorized users can view their own projects"
    ON projects FOR SELECT
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can insert their own projects"
    ON projects FOR INSERT
    WITH CHECK (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can update their own projects"
    ON projects FOR UPDATE
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can delete their own projects"
    ON projects FOR DELETE
    USING (auth.uid() = user_id AND is_user_authorized());

-- Vendors policies
DROP POLICY IF EXISTS "Authorized users can view their own vendors" ON vendors;
DROP POLICY IF EXISTS "Authorized users can insert their own vendors" ON vendors;
DROP POLICY IF EXISTS "Authorized users can update their own vendors" ON vendors;
DROP POLICY IF EXISTS "Authorized users can delete their own vendors" ON vendors;

CREATE POLICY "Authorized users can view their own vendors"
    ON vendors FOR SELECT
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can insert their own vendors"
    ON vendors FOR INSERT
    WITH CHECK (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can update their own vendors"
    ON vendors FOR UPDATE
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can delete their own vendors"
    ON vendors FOR DELETE
    USING (auth.uid() = user_id AND is_user_authorized());

-- Materials policies
DROP POLICY IF EXISTS "Authorized users can view their own materials" ON materials;
DROP POLICY IF EXISTS "Authorized users can insert their own materials" ON materials;
DROP POLICY IF EXISTS "Authorized users can update their own materials" ON materials;
DROP POLICY IF EXISTS "Authorized users can delete their own materials" ON materials;

CREATE POLICY "Authorized users can view their own materials"
    ON materials FOR SELECT
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can insert their own materials"
    ON materials FOR INSERT
    WITH CHECK (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can update their own materials"
    ON materials FOR UPDATE
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can delete their own materials"
    ON materials FOR DELETE
    USING (auth.uid() = user_id AND is_user_authorized());

-- BOMs policies
DROP POLICY IF EXISTS "Authorized users can view their own boms" ON boms;
DROP POLICY IF EXISTS "Authorized users can insert their own boms" ON boms;
DROP POLICY IF EXISTS "Authorized users can update their own boms" ON boms;
DROP POLICY IF EXISTS "Authorized users can delete their own boms" ON boms;

CREATE POLICY "Authorized users can view their own boms"
    ON boms FOR SELECT
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can insert their own boms"
    ON boms FOR INSERT
    WITH CHECK (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can update their own boms"
    ON boms FOR UPDATE
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can delete their own boms"
    ON boms FOR DELETE
    USING (auth.uid() = user_id AND is_user_authorized());

-- BOM Items policies
DROP POLICY IF EXISTS "Authorized users can view bom_items for their boms" ON bom_items;
DROP POLICY IF EXISTS "Authorized users can insert bom_items for their boms" ON bom_items;
DROP POLICY IF EXISTS "Authorized users can update bom_items for their boms" ON bom_items;
DROP POLICY IF EXISTS "Authorized users can delete bom_items for their boms" ON bom_items;

CREATE POLICY "Authorized users can view bom_items for their boms"
    ON bom_items FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM boms
        WHERE boms.id = bom_items.bom_id
        AND boms.user_id = auth.uid()
    ) AND is_user_authorized());

CREATE POLICY "Authorized users can insert bom_items for their boms"
    ON bom_items FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM boms
        WHERE boms.id = bom_items.bom_id
        AND boms.user_id = auth.uid()
    ) AND is_user_authorized());

CREATE POLICY "Authorized users can update bom_items for their boms"
    ON bom_items FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM boms
        WHERE boms.id = bom_items.bom_id
        AND boms.user_id = auth.uid()
    ) AND is_user_authorized());

CREATE POLICY "Authorized users can delete bom_items for their boms"
    ON bom_items FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM boms
        WHERE boms.id = bom_items.bom_id
        AND boms.user_id = auth.uid()
    ) AND is_user_authorized());

-- Vendor Equipment policies (child table of vendors)
DROP POLICY IF EXISTS "Authorized users can view vendor_equipment for their vendors" ON vendor_equipment;
DROP POLICY IF EXISTS "Authorized users can insert vendor_equipment for their vendors" ON vendor_equipment;
DROP POLICY IF EXISTS "Authorized users can update vendor_equipment for their vendors" ON vendor_equipment;
DROP POLICY IF EXISTS "Authorized users can delete vendor_equipment for their vendors" ON vendor_equipment;

CREATE POLICY "Authorized users can view vendor_equipment for their vendors"
    ON vendor_equipment FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM vendors
        WHERE vendors.id = vendor_equipment.vendor_id
        AND vendors.user_id = auth.uid()
    ) AND is_user_authorized());

CREATE POLICY "Authorized users can insert vendor_equipment for their vendors"
    ON vendor_equipment FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM vendors
        WHERE vendors.id = vendor_equipment.vendor_id
        AND vendors.user_id = auth.uid()
    ) AND is_user_authorized());

CREATE POLICY "Authorized users can update vendor_equipment for their vendors"
    ON vendor_equipment FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM vendors
        WHERE vendors.id = vendor_equipment.vendor_id
        AND vendors.user_id = auth.uid()
    ) AND is_user_authorized());

CREATE POLICY "Authorized users can delete vendor_equipment for their vendors"
    ON vendor_equipment FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM vendors
        WHERE vendors.id = vendor_equipment.vendor_id
        AND vendors.user_id = auth.uid()
    ) AND is_user_authorized());

-- Vendor Services policies (child table of vendors)
DROP POLICY IF EXISTS "Authorized users can view vendor_services for their vendors" ON vendor_services;
DROP POLICY IF EXISTS "Authorized users can insert vendor_services for their vendors" ON vendor_services;
DROP POLICY IF EXISTS "Authorized users can update vendor_services for their vendors" ON vendor_services;
DROP POLICY IF EXISTS "Authorized users can delete vendor_services for their vendors" ON vendor_services;

CREATE POLICY "Authorized users can view vendor_services for their vendors"
    ON vendor_services FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM vendors
        WHERE vendors.id = vendor_services.vendor_id
        AND vendors.user_id = auth.uid()
    ) AND is_user_authorized());

CREATE POLICY "Authorized users can insert vendor_services for their vendors"
    ON vendor_services FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM vendors
        WHERE vendors.id = vendor_services.vendor_id
        AND vendors.user_id = auth.uid()
    ) AND is_user_authorized());

CREATE POLICY "Authorized users can update vendor_services for their vendors"
    ON vendor_services FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM vendors
        WHERE vendors.id = vendor_services.vendor_id
        AND vendors.user_id = auth.uid()
    ) AND is_user_authorized());

CREATE POLICY "Authorized users can delete vendor_services for their vendors"
    ON vendor_services FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM vendors
        WHERE vendors.id = vendor_services.vendor_id
        AND vendors.user_id = auth.uid()
    ) AND is_user_authorized());

-- Vendor Contacts policies (child table of vendors)
DROP POLICY IF EXISTS "Authorized users can view vendor_contacts for their vendors" ON vendor_contacts;
DROP POLICY IF EXISTS "Authorized users can insert vendor_contacts for their vendors" ON vendor_contacts;
DROP POLICY IF EXISTS "Authorized users can update vendor_contacts for their vendors" ON vendor_contacts;
DROP POLICY IF EXISTS "Authorized users can delete vendor_contacts for their vendors" ON vendor_contacts;

CREATE POLICY "Authorized users can view vendor_contacts for their vendors"
    ON vendor_contacts FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM vendors
        WHERE vendors.id = vendor_contacts.vendor_id
        AND vendors.user_id = auth.uid()
    ) AND is_user_authorized());

CREATE POLICY "Authorized users can insert vendor_contacts for their vendors"
    ON vendor_contacts FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM vendors
        WHERE vendors.id = vendor_contacts.vendor_id
        AND vendors.user_id = auth.uid()
    ) AND is_user_authorized());

CREATE POLICY "Authorized users can update vendor_contacts for their vendors"
    ON vendor_contacts FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM vendors
        WHERE vendors.id = vendor_contacts.vendor_id
        AND vendors.user_id = auth.uid()
    ) AND is_user_authorized());

CREATE POLICY "Authorized users can delete vendor_contacts for their vendors"
    ON vendor_contacts FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM vendors
        WHERE vendors.id = vendor_contacts.vendor_id
        AND vendors.user_id = auth.uid()
    ) AND is_user_authorized());

-- Enable RLS on vendor child tables (if not already enabled)
ALTER TABLE vendor_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_contacts ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- UPDATE AUTHORIZED_USERS TABLE POLICIES
-- ============================================================================

-- Drop old policies to avoid conflicts
DROP POLICY IF EXISTS "Authenticated users can view authorized users" ON authorized_users;
DROP POLICY IF EXISTS "Authorized users can view authorized users" ON authorized_users;

-- Allow public read-only access to the authorized_users table.
-- This is required for the frontend to check if a user is allowed to sign up or sign in.
-- The table should not contain sensitive data.
CREATE POLICY "Public can view authorized users"
    ON authorized_users FOR SELECT
    TO public
    USING (true);

-- ============================================================================
-- NOTES
-- ============================================================================

-- How this works:
-- 1. User authenticates with Supabase (frontend)
-- 2. User tries to query any table (e.g., projects, vendors)
-- 3. RLS policy runs is_user_authorized() function
-- 4. Function checks if user's email is in authorized_users table and is_active = true
-- 5. If not authorized, query returns 0 rows / fails
-- 6. If authorized, normal RLS rules apply (user can only see their own data)

-- Benefits:
-- ✅ All authorization at database level
-- ✅ No backend code needed for authorization
-- ✅ Impossible to bypass (enforced by Postgres)
-- ✅ Works with frontend-only architecture

-- To authorize a user:
-- INSERT INTO authorized_users (email, full_name, role, is_active)
-- VALUES ('user@example.com', 'User Name', 'user', true);

-- To revoke access:
-- UPDATE authorized_users SET is_active = false WHERE email = 'user@example.com';
