-- ================================================================
-- CONSOLIDATED PRODUCTION SCHEMA - MITHRAN MANUFACTURING ERP
-- ================================================================
-- Version: 1.0.0
-- Created: 2026-02-16
-- Description: Production-ready consolidated schema with security, 
-- performance optimizations, and proper indexing strategy

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ================================================================
-- SCHEMA MIGRATION TRACKING
-- ================================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    checksum TEXT,
    description TEXT
);

-- ================================================================
-- CORE AUTHENTICATION & AUTHORIZATION
-- ================================================================

-- User roles enumeration
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role_enum') THEN
        CREATE TYPE user_role_enum AS ENUM (
            'admin', 'manager', 'engineer', 'operator', 'viewer'
        );
    END IF;
END$$;

-- Authorized users with optimized structure
CREATE TABLE IF NOT EXISTS authorized_users (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    role user_role_enum DEFAULT 'viewer',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Optimized indexes for auth
CREATE INDEX IF NOT EXISTS idx_authorized_users_email_active 
ON authorized_users(email) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_authorized_users_role 
ON authorized_users(role) WHERE is_active = true;

-- ================================================================
-- CORE BUSINESS ENTITIES
-- ================================================================

-- Projects table with proper constraints (compatible with existing schema)
CREATE TABLE IF NOT EXISTS projects (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    project_name VARCHAR(255),
    description TEXT,
    client_name VARCHAR(255),
    location VARCHAR(255),
    country TEXT,
    state TEXT,
    city TEXT,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'on_hold', 'cancelled')),
    start_date DATE,
    end_date DATE,
    budget DECIMAL(15,2) CHECK (budget > 0),
    quoted_cost DECIMAL(10,2),
    user_id UUID NOT NULL,
    organization_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_project_dates CHECK (end_date IS NULL OR end_date >= start_date)
);

-- Vendors table with enhanced validation (compatible with existing schema)
CREATE TABLE IF NOT EXISTS vendors (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    supplier_code TEXT UNIQUE,
    name TEXT NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(20),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100) DEFAULT 'India',
    postal_code VARCHAR(20),
    gst_number VARCHAR(15),
    pan_number VARCHAR(10),
    is_active BOOLEAN DEFAULT true,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
    vendor_type TEXT DEFAULT 'supplier' CHECK (vendor_type IN ('supplier', 'oem', 'both')),
    overall_rating DECIMAL(3,2) CHECK (overall_rating >= 0 AND overall_rating <= 5),
    user_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- BOMs with proper hierarchy support (compatible with existing schema)
CREATE TABLE IF NOT EXISTS boms (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    bom_name VARCHAR(255),
    version VARCHAR(20) DEFAULT '1.0',
    description TEXT,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'released', 'obsolete')),
    is_active BOOLEAN DEFAULT true,
    total_items INTEGER DEFAULT 0 NOT NULL,
    total_cost DECIMAL(20,4),
    total_cost_inr DECIMAL(15,2) DEFAULT 0 CHECK (total_cost_inr >= 0),
    currency VARCHAR(3) DEFAULT 'INR' NOT NULL,
    approved_by UUID,
    approved_at TIMESTAMP WITH TIME ZONE,
    user_id UUID NOT NULL,
    organization_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- BOM Items with comprehensive costing (compatible with existing schema)
CREATE TABLE IF NOT EXISTS bom_items (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    bom_id UUID NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
    parent_item_id UUID REFERENCES bom_items(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    item_name VARCHAR(255),
    part_number VARCHAR(100),
    item_code VARCHAR(100),
    description TEXT,
    item_type VARCHAR(50) NOT NULL CHECK (item_type IN ('assembly', 'sub_assembly', 'child_part', 'bop', 'manufactured', 'purchased', 'raw_material')),
    material VARCHAR(100),
    material_grade VARCHAR(100),
    quantity DECIMAL(15,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    annual_volume INTEGER NOT NULL DEFAULT 1000,
    unit VARCHAR(50) DEFAULT 'pcs' CHECK (unit IN ('pcs', 'kg', 'lbs', 'm', 'ft', 'liters')),
    make_buy VARCHAR(10) DEFAULT 'make' CHECK (make_buy IN ('make', 'buy')),
    unit_cost DECIMAL(20,4) DEFAULT 0 CHECK (unit_cost >= 0),
    unit_cost_inr DECIMAL(12,2) DEFAULT 0 CHECK (unit_cost_inr >= 0),
    material_cost_inr DECIMAL(20,4) DEFAULT 0,
    labor_cost_inr DECIMAL(20,4) DEFAULT 0,
    overhead_cost_inr DECIMAL(20,4) DEFAULT 0,
    total_cost_inr DECIMAL(20,4) DEFAULT 0,
    level_in_bom INTEGER DEFAULT 0 CHECK (level_in_bom >= 0),
    sort_order INTEGER DEFAULT 0,
    file_3d_path TEXT,
    file_2d_path TEXT,
    user_id UUID NOT NULL,
    organization_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Manufacturing processes
CREATE TABLE IF NOT EXISTS processes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    process_name VARCHAR(255) NOT NULL,
    process_category VARCHAR(100),
    description TEXT,
    standard_time_minutes DECIMAL(8,2) CHECK (standard_time_minutes >= 0),
    setup_time_minutes DECIMAL(8,2) CHECK (setup_time_minutes >= 0),
    cycle_time_minutes DECIMAL(8,2) CHECK (cycle_time_minutes >= 0),
    machine_required BOOLEAN DEFAULT false,
    machine_type VARCHAR(100),
    labor_required BOOLEAN DEFAULT true,
    skill_level_required VARCHAR(50),
    user_id UUID,
    is_global BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Production lots for scheduling
CREATE TABLE IF NOT EXISTS production_lots (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    bom_id UUID NOT NULL REFERENCES boms(id) ON DELETE RESTRICT,
    lot_number VARCHAR(100) UNIQUE NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    planned_start_date DATE NOT NULL,
    planned_end_date DATE NOT NULL,
    actual_start_date DATE,
    actual_end_date DATE,
    status VARCHAR(50) DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    user_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_planned_dates CHECK (planned_end_date >= planned_start_date),
    CONSTRAINT valid_actual_dates CHECK (actual_end_date IS NULL OR actual_start_date IS NULL OR actual_end_date >= actual_start_date)
);

-- Vendor ratings with performance optimization
CREATE TABLE IF NOT EXISTS vendor_ratings (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    quality_rating DECIMAL(3,2) CHECK (quality_rating >= 0 AND quality_rating <= 5),
    delivery_rating DECIMAL(3,2) CHECK (delivery_rating >= 0 AND delivery_rating <= 5),
    cost_rating DECIMAL(3,2) CHECK (cost_rating >= 0 AND cost_rating <= 5),
    communication_rating DECIMAL(3,2) CHECK (communication_rating >= 0 AND communication_rating <= 5),
    overall_rating DECIMAL(3,2) GENERATED ALWAYS AS (
        CASE WHEN (quality_rating IS NOT NULL OR delivery_rating IS NOT NULL OR 
                  cost_rating IS NOT NULL OR communication_rating IS NOT NULL) 
        THEN (COALESCE(quality_rating, 0) + COALESCE(delivery_rating, 0) + 
              COALESCE(cost_rating, 0) + COALESCE(communication_rating, 0)) / 
              NULLIF((CASE WHEN quality_rating IS NOT NULL THEN 1 ELSE 0 END +
                      CASE WHEN delivery_rating IS NOT NULL THEN 1 ELSE 0 END +
                      CASE WHEN cost_rating IS NOT NULL THEN 1 ELSE 0 END +
                      CASE WHEN communication_rating IS NOT NULL THEN 1 ELSE 0 END), 0)
        ELSE NULL END
    ) STORED,
    delivery_date DATE,
    actual_delivery_date DATE,
    order_value DECIMAL(15,2),
    comments TEXT,
    user_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_delivery_dates CHECK (actual_delivery_date IS NULL OR delivery_date IS NULL OR actual_delivery_date >= delivery_date - INTERVAL '30 days')
);

-- ================================================================
-- PERFORMANCE-OPTIMIZED INDEXES
-- ================================================================

-- Projects indexes
CREATE INDEX IF NOT EXISTS idx_projects_user_status 
ON projects(user_id, status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_projects_name_active 
ON projects(name) WHERE status = 'active';

-- BOMs indexes
CREATE INDEX IF NOT EXISTS idx_boms_project_active
ON boms(project_id);

CREATE INDEX IF NOT EXISTS idx_boms_project_version 
ON boms(project_id, version);

-- BOM Items indexes
CREATE INDEX IF NOT EXISTS idx_bom_items_bom_level 
ON bom_items(bom_id, level_in_bom);

CREATE INDEX IF NOT EXISTS idx_bom_items_parent 
ON bom_items(parent_item_id) WHERE parent_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bom_items_type 
ON bom_items(item_type, bom_id);

-- Vendors indexes
CREATE INDEX IF NOT EXISTS idx_vendors_active_rating 
ON vendors(is_active, overall_rating DESC) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_vendors_location 
ON vendors(city, state) WHERE is_active = true;

-- Production lots indexes
CREATE INDEX IF NOT EXISTS idx_production_lots_status_dates 
ON production_lots(status, planned_start_date) WHERE status IN ('planned', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_production_lots_bom 
ON production_lots(bom_id, status);

-- Vendor ratings indexes
CREATE INDEX IF NOT EXISTS idx_vendor_ratings_vendor_date 
ON vendor_ratings(vendor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vendor_ratings_project 
ON vendor_ratings(project_id, vendor_id);

-- ================================================================
-- SECURITY POLICIES (Simplified for Performance)
-- ================================================================

-- Enable RLS on sensitive tables
ALTER TABLE authorized_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_lots ENABLE ROW LEVEL SECURITY;

-- Simple user-based policies
CREATE POLICY "users_own_projects" ON projects
    FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY "users_own_boms" ON boms
    FOR ALL USING (project_id IN (
        SELECT id FROM projects WHERE user_id::text = current_setting('app.current_user_id', true)
    ));

-- Admin access policy
CREATE POLICY "admin_full_access" ON authorized_users
    FOR ALL USING (current_setting('app.user_role', true) = 'admin');

-- ================================================================
-- MATERIALIZED VIEWS FOR PERFORMANCE
-- ================================================================

-- Vendor performance summary
CREATE MATERIALIZED VIEW IF NOT EXISTS vendor_performance_summary AS
SELECT 
    v.id,
    v.company_name,
    COUNT(vr.id) as total_ratings,
    AVG(vr.overall_rating) as avg_rating,
    COUNT(CASE WHEN vr.created_at >= NOW() - INTERVAL '6 months' THEN 1 END) as recent_ratings,
    MAX(vr.created_at) as last_rated,
    v.updated_at
FROM vendors v
LEFT JOIN vendor_ratings vr ON v.id = vr.vendor_id
WHERE v.is_active = true
GROUP BY v.id, v.company_name, v.updated_at;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_performance_summary_id 
ON vendor_performance_summary(id);

-- Project cost summary
CREATE MATERIALIZED VIEW IF NOT EXISTS project_cost_summary AS
SELECT 
    p.id as project_id,
    p.project_name,
    COUNT(b.id) as total_boms,
    SUM(b.total_cost_inr) as total_project_cost,
    AVG(b.total_cost_inr) as avg_bom_cost,
    MAX(b.updated_at) as last_updated
FROM projects p
LEFT JOIN boms b ON p.id = b.project_id AND b.is_active = true
WHERE p.status = 'active'
GROUP BY p.id, p.project_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_cost_summary_id 
ON project_cost_summary(project_id);

-- ================================================================
-- MAINTENANCE FUNCTIONS
-- ================================================================

-- Function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_performance_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY vendor_performance_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY project_cost_summary;
END;
$$;

-- Function to update vendor overall ratings
CREATE OR REPLACE FUNCTION update_vendor_ratings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE vendors 
    SET overall_rating = subquery.avg_rating,
        updated_at = NOW()
    FROM (
        SELECT 
            vendor_id,
            AVG(overall_rating) as avg_rating
        FROM vendor_ratings 
        WHERE created_at >= NOW() - INTERVAL '12 months'
          AND overall_rating IS NOT NULL
        GROUP BY vendor_id
    ) subquery
    WHERE vendors.id = subquery.vendor_id;
END;
$$;

-- ================================================================
-- TRIGGERS FOR DATA CONSISTENCY
-- ================================================================

-- Update timestamps trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply timestamp triggers to main tables
DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at 
    BEFORE UPDATE ON projects 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_vendors_updated_at ON vendors;
CREATE TRIGGER update_vendors_updated_at 
    BEFORE UPDATE ON vendors 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_boms_updated_at ON boms;
CREATE TRIGGER update_boms_updated_at 
    BEFORE UPDATE ON boms 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================================
-- DATABASE CONFIGURATION FOR PRODUCTION
-- ================================================================

-- Set production-optimized parameters
-- Note: These should be set at the database level, not in migration
/*
ALTER SYSTEM SET work_mem = '256MB';
ALTER SYSTEM SET maintenance_work_mem = '1GB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '64MB';
ALTER SYSTEM SET max_connections = 100;
ALTER SYSTEM SET shared_buffers = '2GB';
*/

-- ================================================================
-- SEED ESSENTIAL DATA
-- ================================================================

-- Insert default admin user (replace with actual admin email)
INSERT INTO authorized_users (email, role, is_active) 
VALUES ('admin@mithran.com', 'admin', true)
ON CONFLICT (email) DO NOTHING;

-- Insert global manufacturing processes
INSERT INTO processes (process_name, process_category, description, is_global) VALUES
('CNC Machining', 'Machining', 'Computer Numerical Control machining process', true),
('Manual Assembly', 'Assembly', 'Manual assembly of components', true),
('Quality Inspection', 'Quality', 'Visual and dimensional quality check', true),
('Packaging', 'Logistics', 'Final product packaging', true),
('Material Handling', 'Logistics', 'Moving materials between stations', true)
ON CONFLICT DO NOTHING;

-- Record this migration
INSERT INTO schema_migrations (version, description, checksum) 
VALUES ('000_consolidated_production_schema', 'Consolidated production-ready schema with security and performance optimizations', 'sha256:consolidated_v1.0.0')
ON CONFLICT (version) DO NOTHING;

-- ================================================================
-- FINAL NOTES
-- ================================================================
-- This consolidated schema:
-- 1. Eliminates migration conflicts and duplicates
-- 2. Implements proper security without performance degradation
-- 3. Includes essential indexes for production workloads
-- 4. Uses materialized views for complex reporting queries
-- 5. Maintains data integrity with proper constraints
-- 6. Supports horizontal scaling patterns
-- 
-- Remember to:
-- - Set up connection pooling (PgBouncer recommended)
-- - Configure backup strategy
-- - Monitor query performance with pg_stat_statements
-- - Schedule materialized view refreshes
-- ================================================================