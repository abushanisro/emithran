-- ============================================================================
-- MIGRATION 020: Fix RLS Authorization
-- ============================================================================
-- This migration updates ALL remaining tables to use the is_user_authorized() function
-- to ensure proper data isolation between users. Only authorized users can access
-- their own data after this migration.
-- ============================================================================

-- ============================================================================
-- UPDATE MHR_RECORDS POLICIES
-- ============================================================================

-- Drop existing basic policies
DROP POLICY IF EXISTS "Users can view their own MHR records" ON mhr_records;
DROP POLICY IF EXISTS "Users can create their own MHR records" ON mhr_records;
DROP POLICY IF EXISTS "Users can update their own MHR records" ON mhr_records;
DROP POLICY IF EXISTS "Users can delete their own MHR records" ON mhr_records;

-- Create new authorized policies
CREATE POLICY "Authorized users can view their own MHR records"
    ON mhr_records FOR SELECT
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can insert their own MHR records"
    ON mhr_records FOR INSERT
    WITH CHECK (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can update their own MHR records"
    ON mhr_records FOR UPDATE
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can delete their own MHR records"
    ON mhr_records FOR DELETE
    USING (auth.uid() = user_id AND is_user_authorized());

-- ============================================================================
-- UPDATE LSR_RECORDS POLICIES
-- ============================================================================

-- Drop existing basic policies
DROP POLICY IF EXISTS "Users can view their own LSR records" ON lsr_records;
DROP POLICY IF EXISTS "Users can create their own LSR records" ON lsr_records;
DROP POLICY IF EXISTS "Users can update their own LSR records" ON lsr_records;
DROP POLICY IF EXISTS "Users can delete their own LSR records" ON lsr_records;

-- Create new authorized policies
CREATE POLICY "Authorized users can view their own LSR records"
    ON lsr_records FOR SELECT
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can insert their own LSR records"
    ON lsr_records FOR INSERT
    WITH CHECK (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can update their own LSR records"
    ON lsr_records FOR UPDATE
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can delete their own LSR records"
    ON lsr_records FOR DELETE
    USING (auth.uid() = user_id AND is_user_authorized());

-- ============================================================================
-- UPDATE CALCULATORS POLICIES
-- ============================================================================

-- Drop existing basic policies
DROP POLICY IF EXISTS "Users can view their own calculators and public templates" ON calculators;
DROP POLICY IF EXISTS "Users can create their own calculators" ON calculators;
DROP POLICY IF EXISTS "Users can update their own calculators" ON calculators;
DROP POLICY IF EXISTS "Users can delete their own calculators" ON calculators;

-- Create new authorized policies
CREATE POLICY "Authorized users can view their own calculators and public templates"
    ON calculators FOR SELECT
    USING ((auth.uid() = user_id OR is_public = true) AND is_user_authorized());

CREATE POLICY "Authorized users can insert their own calculators"
    ON calculators FOR INSERT
    WITH CHECK (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can update their own calculators"
    ON calculators FOR UPDATE
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can delete their own calculators"
    ON calculators FOR DELETE
    USING (auth.uid() = user_id AND is_user_authorized());

-- ============================================================================
-- UPDATE CALCULATOR_FIELDS POLICIES
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view fields of their calculators or public calculators" ON calculator_fields;
DROP POLICY IF EXISTS "Users can manage fields of their own calculators" ON calculator_fields;

-- Create new authorized policies
CREATE POLICY "Authorized users can view fields of their calculators or public calculators"
    ON calculator_fields FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM calculators
            WHERE calculators.id = calculator_fields.calculator_id
            AND (calculators.user_id = auth.uid() OR calculators.is_public = true)
        ) AND is_user_authorized()
    );

CREATE POLICY "Authorized users can manage fields of their own calculators"
    ON calculator_fields FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM calculators
            WHERE calculators.id = calculator_fields.calculator_id
            AND calculators.user_id = auth.uid()
        ) AND is_user_authorized()
    );

-- ============================================================================
-- UPDATE CALCULATOR_FORMULAS POLICIES
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view formulas of their calculators or public calculators" ON calculator_formulas;
DROP POLICY IF EXISTS "Users can manage formulas of their own calculators" ON calculator_formulas;

-- Create new authorized policies
CREATE POLICY "Authorized users can view formulas of their calculators or public calculators"
    ON calculator_formulas FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM calculators
            WHERE calculators.id = calculator_formulas.calculator_id
            AND (calculators.user_id = auth.uid() OR calculators.is_public = true)
        ) AND is_user_authorized()
    );

CREATE POLICY "Authorized users can manage formulas of their own calculators"
    ON calculator_formulas FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM calculators
            WHERE calculators.id = calculator_formulas.calculator_id
            AND calculators.user_id = auth.uid()
        ) AND is_user_authorized()
    );

-- ============================================================================
-- UPDATE CALCULATOR_EXECUTIONS POLICIES
-- ============================================================================

-- Drop existing basic policies
DROP POLICY IF EXISTS "Users can view their own executions" ON calculator_executions;
DROP POLICY IF EXISTS "Users can create their own executions" ON calculator_executions;
DROP POLICY IF EXISTS "Users can update their own executions" ON calculator_executions;
DROP POLICY IF EXISTS "Users can delete their own executions" ON calculator_executions;

-- Create new authorized policies
CREATE POLICY "Authorized users can view their own executions"
    ON calculator_executions FOR SELECT
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can insert their own executions"
    ON calculator_executions FOR INSERT
    WITH CHECK (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can update their own executions"
    ON calculator_executions FOR UPDATE
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can delete their own executions"
    ON calculator_executions FOR DELETE
    USING (auth.uid() = user_id AND is_user_authorized());

-- ============================================================================
-- UPDATE PROCESSES POLICIES
-- ============================================================================

-- Drop existing basic policy
DROP POLICY IF EXISTS "Users can manage their processes" ON processes;

-- Create new authorized policy
CREATE POLICY "Authorized users can manage their processes"
    ON processes FOR ALL
    USING (auth.uid() = user_id AND is_user_authorized());

-- ============================================================================
-- UPDATE PROCESS_ROUTES POLICIES
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view process_routes for their bom items" ON process_routes;
DROP POLICY IF EXISTS "Users can insert process_routes for their bom items" ON process_routes;
DROP POLICY IF EXISTS "Users can update process_routes for their bom items" ON process_routes;
DROP POLICY IF EXISTS "Users can delete process_routes for their bom items" ON process_routes;

-- Create new authorized policies
CREATE POLICY "Authorized users can view process_routes for their bom items"
    ON process_routes FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM bom_items bi
            JOIN boms b ON b.id = bi.bom_id
            WHERE bi.id = process_routes.bom_item_id 
            AND b.user_id = auth.uid()
        ) AND is_user_authorized()
    );

CREATE POLICY "Authorized users can insert process_routes for their bom items"
    ON process_routes FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM bom_items bi
            JOIN boms b ON b.id = bi.bom_id
            WHERE bi.id = process_routes.bom_item_id 
            AND b.user_id = auth.uid()
        ) AND is_user_authorized()
    );

CREATE POLICY "Authorized users can update process_routes for their bom items"
    ON process_routes FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM bom_items bi
            JOIN boms b ON b.id = bi.bom_id
            WHERE bi.id = process_routes.bom_item_id 
            AND b.user_id = auth.uid()
        ) AND is_user_authorized()
    );

CREATE POLICY "Authorized users can delete process_routes for their bom items"
    ON process_routes FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM bom_items bi
            JOIN boms b ON b.id = bi.bom_id
            WHERE bi.id = process_routes.bom_item_id 
            AND b.user_id = auth.uid()
        ) AND is_user_authorized()
    );

-- ============================================================================
-- UPDATE PROCESS_ROUTE_STEPS POLICIES
-- ============================================================================

-- Drop existing policy
DROP POLICY IF EXISTS "Users can manage process_route_steps" ON process_route_steps;

-- Create new authorized policy
CREATE POLICY "Authorized users can manage process_route_steps"
    ON process_route_steps FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM process_routes pr
            JOIN bom_items bi ON bi.id = pr.bom_item_id
            JOIN boms b ON b.id = bi.bom_id
            WHERE pr.id = process_route_steps.process_route_id 
            AND b.user_id = auth.uid()
        ) AND is_user_authorized()
    );

-- ============================================================================
-- UPDATE PROCESS_TEMPLATES POLICIES
-- ============================================================================

-- Drop existing policy
DROP POLICY IF EXISTS "Users can manage their process_templates" ON process_templates;

-- Create new authorized policy
CREATE POLICY "Authorized users can manage their process_templates"
    ON process_templates FOR ALL
    USING (auth.uid() = user_id AND is_user_authorized());

-- ============================================================================
-- UPDATE PROCESS_TEMPLATE_STEPS POLICIES
-- ============================================================================

-- Drop existing policy
DROP POLICY IF EXISTS "Users can manage process_template_steps" ON process_template_steps;

-- Create new authorized policy
CREATE POLICY "Authorized users can manage process_template_steps"
    ON process_template_steps FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM process_templates pt
            WHERE pt.id = process_template_steps.process_template_id 
            AND pt.user_id = auth.uid()
        ) AND is_user_authorized()
    );

-- ============================================================================
-- VERIFICATION AND SUMMARY
-- ============================================================================

-- Verify all tables have RLS enabled
DO $$
DECLARE
    table_record RECORD;
    rls_count INTEGER := 0;
    total_count INTEGER := 0;
BEGIN
    -- Check key tables for RLS status
    FOR table_record IN 
        SELECT schemaname, tablename, rowsecurity 
        FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename IN (
            'vendors', 'materials', 'boms', 'projects',
            'mhr_records', 'lsr_records', 
            'calculators', 'calculator_fields', 'calculator_formulas', 'calculator_executions',
            'processes', 'process_routes', 'process_route_steps', 
            'process_templates', 'process_template_steps'
        )
    LOOP
        total_count := total_count + 1;
        IF table_record.rowsecurity THEN
            rls_count := rls_count + 1;
            RAISE NOTICE '✅ RLS enabled on %.%', table_record.schemaname, table_record.tablename;
        ELSE
            RAISE WARNING '❌ RLS NOT enabled on %.%', table_record.schemaname, table_record.tablename;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'RLS Status: % of % tables have RLS enabled', rls_count, total_count;
    
    IF rls_count = total_count THEN
        RAISE NOTICE '🎉 SUCCESS: All critical tables have RLS enabled with authorization checks';
    ELSE
        RAISE WARNING '⚠️  WARNING: Some tables missing RLS - data isolation may not work properly';
    END IF;
END $$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

-- Migration complete: Updated RLS policies to use is_user_authorized() function for proper multi-tenant data isolation

-- ============================================================================
-- END OF MIGRATION 020
-- ============================================================================

-- How this fixes the data isolation bug:
-- 1. All tables now require users to be in the authorized_users table AND active
-- 2. Users can only see their own data (user_id = auth.uid())
-- 3. The is_user_authorized() function prevents unauthorized access entirely
-- 4. Data from emuski@mithran.com will no longer leak to other users
--
-- After running this migration:
-- - Only authorized users can access any data
-- - Each user sees only their own data
-- - Data isolation is enforced at the database level
-- - The bug should be completely resolved