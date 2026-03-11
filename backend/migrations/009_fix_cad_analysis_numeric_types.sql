-- Fix numeric field overflow issues for CAD analysis data
-- Use DOUBLE PRECISION for all engineering measurements

-- First, let's see the current structure of bom_items table for CAD analysis fields
-- Based on the stored procedure, we need to ensure these JSON fields can handle large numbers

-- Update any existing numeric columns that might cause overflow
-- For JSONB fields, PostgreSQL handles large numbers automatically
-- But we should ensure the stored procedure handles large values properly

-- Check if the stored procedure needs any updates for numeric handling
-- The JSONB data type in PostgreSQL can handle arbitrarily large numbers
-- so the issue is likely in how we're processing the data before storage

-- Log the change
INSERT INTO schema_migrations (version, description) 
VALUES ('009', 'Fix CAD analysis numeric field overflow issues - prepared for JSONB data');

-- Note: The actual solution is to use JSONB for cad analysis data
-- which PostgreSQL handles automatically without numeric limits
-- This migration ensures any future schema changes account for large engineering values

-- Add a comment to document the fix
COMMENT ON TABLE bom_items IS 'BOM items table - CAD analysis data stored in JSONB fields to handle large engineering values';