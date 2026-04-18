-- ============================================================================
-- MIGRATION 021: Complete RLS Authorization Fix
-- ============================================================================
-- This migration fixes ALL remaining vendor and process tables that are still
-- causing data leakage. It adds is_user_authorized() function to all tables
-- that were missed in the previous migration.
-- ============================================================================

-- ============================================================================
-- FIX VENDOR_RATINGS TABLE (CRITICAL - NO RLS AT ALL!)
-- ============================================================================

-- Enable RLS on vendor_ratings table
ALTER TABLE vendor_ratings ENABLE ROW LEVEL SECURITY;

-- Create comprehensive RLS policies for vendor_ratings
CREATE POLICY "Authorized users can view their own vendor ratings"
    ON vendor_ratings FOR SELECT
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can insert their own vendor ratings"
    ON vendor_ratings FOR INSERT
    WITH CHECK (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can update their own vendor ratings"
    ON vendor_ratings FOR UPDATE
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can delete their own vendor ratings"
    ON vendor_ratings FOR DELETE
    USING (auth.uid() = user_id AND is_user_authorized());

-- ============================================================================
-- FIX PROCESS_COST_RECORDS TABLE (CRITICAL - NO RLS AT ALL!)
-- ============================================================================

-- Enable RLS on process_cost_records table
ALTER TABLE process_cost_records ENABLE ROW LEVEL SECURITY;

-- Create comprehensive RLS policies for process_cost_records
CREATE POLICY "Authorized users can view their own process cost records"
    ON process_cost_records FOR SELECT
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can insert their own process cost records"
    ON process_cost_records FOR INSERT
    WITH CHECK (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can update their own process cost records"
    ON process_cost_records FOR UPDATE
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can delete their own process cost records"
    ON process_cost_records FOR DELETE
    USING (auth.uid() = user_id AND is_user_authorized());

-- ============================================================================
-- FIX VENDOR_PROCESS_CAPABILITIES TABLE
-- ============================================================================

-- Drop existing basic policies
DROP POLICY IF EXISTS "Users can view their own vendor process capabilities" ON vendor_process_capabilities;
DROP POLICY IF EXISTS "Users can insert their own vendor process capabilities" ON vendor_process_capabilities;
DROP POLICY IF EXISTS "Users can update their own vendor process capabilities" ON vendor_process_capabilities;
DROP POLICY IF EXISTS "Users can delete their own vendor process capabilities" ON vendor_process_capabilities;

-- Create new authorized policies
CREATE POLICY "Authorized users can view their own vendor process capabilities"
    ON vendor_process_capabilities FOR SELECT
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can insert their own vendor process capabilities"
    ON vendor_process_capabilities FOR INSERT
    WITH CHECK (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can update their own vendor process capabilities"
    ON vendor_process_capabilities FOR UPDATE
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can delete their own vendor process capabilities"
    ON vendor_process_capabilities FOR DELETE
    USING (auth.uid() = user_id AND is_user_authorized());

-- ============================================================================
-- FIX RFQ_TRACKING TABLES
-- ============================================================================

-- RFQ_TRACKING table
DROP POLICY IF EXISTS "Users can view their own RFQ tracking" ON rfq_tracking;
DROP POLICY IF EXISTS "Users can insert their own RFQ tracking" ON rfq_tracking;
DROP POLICY IF EXISTS "Users can update their own RFQ tracking" ON rfq_tracking;
DROP POLICY IF EXISTS "Users can delete their own RFQ tracking" ON rfq_tracking;

CREATE POLICY "Authorized users can view their own RFQ tracking"
    ON rfq_tracking FOR SELECT
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can insert their own RFQ tracking"
    ON rfq_tracking FOR INSERT
    WITH CHECK (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can update their own RFQ tracking"
    ON rfq_tracking FOR UPDATE
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can delete their own RFQ tracking"
    ON rfq_tracking FOR DELETE
    USING (auth.uid() = user_id AND is_user_authorized());

-- RFQ_TRACKING_VENDORS table
DROP POLICY IF EXISTS "Users can manage RFQ tracking vendors for their RFQs" ON rfq_tracking_vendors;

CREATE POLICY "Authorized users can manage RFQ tracking vendors"
    ON rfq_tracking_vendors FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM rfq_tracking rt
            WHERE rt.id = rfq_tracking_vendors.rfq_tracking_id 
            AND rt.user_id = auth.uid()
        ) AND is_user_authorized()
    );

-- RFQ_TRACKING_PARTS table
DROP POLICY IF EXISTS "Users can manage RFQ tracking parts for their RFQs" ON rfq_tracking_parts;

CREATE POLICY "Authorized users can manage RFQ tracking parts"
    ON rfq_tracking_parts FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM rfq_tracking rt
            WHERE rt.id = rfq_tracking_parts.rfq_tracking_id 
            AND rt.user_id = auth.uid()
        ) AND is_user_authorized()
    );

-- ============================================================================
-- FIX VENDOR_QUOTES TABLES
-- ============================================================================

-- VENDOR_QUOTES table
DROP POLICY IF EXISTS "Users can view their own vendor quotes" ON vendor_quotes;
DROP POLICY IF EXISTS "Users can insert their own vendor quotes" ON vendor_quotes;
DROP POLICY IF EXISTS "Users can update their own vendor quotes" ON vendor_quotes;
DROP POLICY IF EXISTS "Users can delete their own vendor quotes" ON vendor_quotes;

CREATE POLICY "Authorized users can view their own vendor quotes"
    ON vendor_quotes FOR SELECT
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can insert their own vendor quotes"
    ON vendor_quotes FOR INSERT
    WITH CHECK (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can update their own vendor quotes"
    ON vendor_quotes FOR UPDATE
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can delete their own vendor quotes"
    ON vendor_quotes FOR DELETE
    USING (auth.uid() = user_id AND is_user_authorized());

-- VENDOR_QUOTE_LINE_ITEMS table
DROP POLICY IF EXISTS "Users can manage quote line items for their quotes" ON vendor_quote_line_items;

CREATE POLICY "Authorized users can manage quote line items"
    ON vendor_quote_line_items FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM vendor_quotes vq
            WHERE vq.id = vendor_quote_line_items.vendor_quote_id 
            AND vq.user_id = auth.uid()
        ) AND is_user_authorized()
    );

-- ============================================================================
-- FIX SUPPLIER_EVALUATION_RECORDS TABLE
-- ============================================================================

-- Drop existing basic policy
DROP POLICY IF EXISTS "Users can view their own supplier evaluation records" ON supplier_evaluation_records;
DROP POLICY IF EXISTS "Users can insert their own supplier evaluation records" ON supplier_evaluation_records;
DROP POLICY IF EXISTS "Users can update their own supplier evaluation records" ON supplier_evaluation_records;
DROP POLICY IF EXISTS "Users can delete their own supplier evaluation records" ON supplier_evaluation_records;

-- Create new authorized policies
CREATE POLICY "Authorized users can view their own supplier evaluation records"
    ON supplier_evaluation_records FOR SELECT
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can insert their own supplier evaluation records"
    ON supplier_evaluation_records FOR INSERT
    WITH CHECK (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can update their own supplier evaluation records"
    ON supplier_evaluation_records FOR UPDATE
    USING (auth.uid() = user_id AND is_user_authorized());

CREATE POLICY "Authorized users can delete their own supplier evaluation records"
    ON supplier_evaluation_records FOR DELETE
    USING (auth.uid() = user_id AND is_user_authorized());

-- ============================================================================
-- FIX VENDOR_NOMINATION_EVALUATIONS AND VENDOR_EVALUATION_SCORES (if they exist)
-- ============================================================================

-- Check if these tables exist and apply RLS if they do
DO $$
BEGIN
    -- vendor_nomination_evaluations
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'vendor_nomination_evaluations') THEN
        EXECUTE 'ALTER TABLE vendor_nomination_evaluations ENABLE ROW LEVEL SECURITY';
        
        EXECUTE 'DROP POLICY IF EXISTS "Users can manage their vendor nomination evaluations" ON vendor_nomination_evaluations';
        
        EXECUTE 'CREATE POLICY "Authorized users can manage their vendor nomination evaluations"
                ON vendor_nomination_evaluations FOR ALL
                USING (auth.uid() = user_id AND is_user_authorized())';
        
        RAISE NOTICE '✅ Fixed RLS for vendor_nomination_evaluations';
    END IF;
    
    -- vendor_evaluation_scores  
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'vendor_evaluation_scores') THEN
        EXECUTE 'ALTER TABLE vendor_evaluation_scores ENABLE ROW LEVEL SECURITY';
        
        EXECUTE 'DROP POLICY IF EXISTS "Users can manage their vendor evaluation scores" ON vendor_evaluation_scores';
        
        EXECUTE 'CREATE POLICY "Authorized users can manage their vendor evaluation scores"
                ON vendor_evaluation_scores FOR ALL
                USING (auth.uid() = user_id AND is_user_authorized())';
        
        RAISE NOTICE '✅ Fixed RLS for vendor_evaluation_scores';
    END IF;
END $$;

-- ============================================================================
-- FIX ANY OTHER PROCESS-RELATED TABLES (if they exist)
-- ============================================================================

-- Check for process_reference_tables and apply RLS
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'process_reference_tables') THEN
        EXECUTE 'ALTER TABLE process_reference_tables ENABLE ROW LEVEL SECURITY';
        
        EXECUTE 'CREATE POLICY "Authorized users can manage their process reference tables"
                ON process_reference_tables FOR ALL
                USING (auth.uid() = user_id AND is_user_authorized())';
        
        RAISE NOTICE '✅ Fixed RLS for process_reference_tables';
    END IF;
    
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'process_table_rows') THEN
        EXECUTE 'ALTER TABLE process_table_rows ENABLE ROW LEVEL SECURITY';
        
        EXECUTE 'CREATE POLICY "Authorized users can manage their process table rows"
                ON process_table_rows FOR ALL
                USING (auth.uid() = user_id AND is_user_authorized())';
        
        RAISE NOTICE '✅ Fixed RLS for process_table_rows';
    END IF;
END $$;

-- ============================================================================
-- VERIFICATION: CHECK ALL VENDOR AND PROCESS TABLES HAVE PROPER RLS
-- ============================================================================

DO $$
DECLARE
    table_record RECORD;
    rls_count INTEGER := 0;
    total_count INTEGER := 0;
    policy_count INTEGER;
BEGIN
    RAISE NOTICE '🔍 Checking RLS status for all vendor and process tables...';
    RAISE NOTICE '================================================================';
    
    -- Check all vendor and process related tables
    FOR table_record IN 
        SELECT schemaname, tablename, rowsecurity 
        FROM pg_tables 
        WHERE schemaname = 'public' 
        AND (
            tablename LIKE 'vendor%' OR 
            tablename LIKE 'process%' OR 
            tablename LIKE 'rfq%' OR
            tablename LIKE 'supplier%'
        )
        ORDER BY tablename
    LOOP
        total_count := total_count + 1;
        
        -- Count policies for this table
        SELECT COUNT(*) INTO policy_count
        FROM pg_policies 
        WHERE schemaname = table_record.schemaname 
        AND tablename = table_record.tablename;
        
        IF table_record.rowsecurity THEN
            rls_count := rls_count + 1;
            RAISE NOTICE '✅ % - RLS enabled with % policies', table_record.tablename, policy_count;
        ELSE
            RAISE WARNING '❌ % - RLS NOT enabled', table_record.tablename;
        END IF;
    END LOOP;
    
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'Summary: % of % vendor/process tables have RLS enabled', rls_count, total_count;
    
    IF rls_count = total_count THEN
        RAISE NOTICE '🎉 SUCCESS: All vendor and process tables now have RLS enabled!';
        RAISE NOTICE '🔒 Data isolation should now work properly across all tables.';
    ELSE
        RAISE WARNING '⚠️  WARNING: % tables still missing RLS', (total_count - rls_count);
    END IF;
END $$;

-- ============================================================================
-- END OF MIGRATION 021
-- ============================================================================

-- This migration should completely resolve the data isolation bug by:
-- 1. Adding RLS to tables that had none (vendor_ratings, process_cost_records)
-- 2. Updating all vendor/process tables to use is_user_authorized() function
-- 3. Ensuring proper data isolation for all vendor and process related data
--
-- After this migration:
-- ✅ No vendor data should leak between users
-- ✅ No process data should leak between users  
-- ✅ Only authorized users can see any data
-- ✅ Each user sees only their own data