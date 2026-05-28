-- ================================================================
-- MIGRATION 123: Fix Vendor Schema
-- ================================================================
-- Description:
--   1. Add linkedin_url column (maps to Excel col 37)
--   2. Change average_capacity_utilization from numeric(5,2) to text
--      to support range strings like "75–85%" from the Excel file
--   3. Rebuild vendor_summary view with all current columns
--
-- Run AFTER wiping bad imports:
--   DELETE FROM vendor_contacts;
--   DELETE FROM vendor_equipment;
--   DELETE FROM vendor_services;
--   DELETE FROM vendors;
-- ================================================================

-- ----------------------------------------------------------------
-- 1. Drop view first (required before altering column types)
-- ----------------------------------------------------------------
DROP VIEW IF EXISTS public.vendor_summary;

-- ----------------------------------------------------------------
-- 2. Add linkedin_url column
-- ----------------------------------------------------------------
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS linkedin_url text NULL;

-- ----------------------------------------------------------------
-- 3. Fix average_capacity_utilization — Excel stores "75–85%"
--    which can't fit numeric(5,2). Cast to text.
-- ----------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'vendors'
      AND column_name  = 'average_capacity_utilization'
      AND data_type   != 'text'
  ) THEN
    ALTER TABLE public.vendors
      ALTER COLUMN average_capacity_utilization TYPE text
      USING average_capacity_utilization::text;
  END IF;
END$$;

-- ----------------------------------------------------------------
-- 4. Rebuild vendor_summary view
-- ----------------------------------------------------------------

CREATE VIEW public.vendor_summary AS
SELECT
  v.id,
  v.supplier_code,
  v.name,
  v.addresses,
  v.website,
  v.company_phone,
  v.company_email,
  v.major_customers,
  v.countries_served,
  v.company_turnover,
  v.industries,
  v.process,
  v.materials,
  v.certifications,
  v.inspection_options,
  v.qms_metrics,
  v.qms_procedures,
  v.manufacturing_workshop,
  v.warehouse,
  v.packing,
  v.logistics_transportation,
  v.maximum_production_capacity,
  v.average_capacity_utilization,
  v.num_hours_in_shift,
  v.num_shifts_in_day,
  v.num_working_days_per_week,
  v.in_house_material_testing,
  v.num_operators,
  v.num_engineers,
  v.num_production_managers,
  v.city,
  v.state,
  v.country,
  v.company_profile_url,
  v.machine_list_url,
  v.linkedin_url,
  v.status,
  v.vendor_type,
  v.is_active,
  v.overall_rating,
  v.user_id,
  v.created_at,
  v.updated_at,
  COUNT(DISTINCT ve.id)::int AS equipment_count,
  COUNT(DISTINCT vs.id)::int AS service_count,
  COALESCE(
    json_agg(
      json_build_object(
        'id',          vc.id,
        'name',        vc.name,
        'designation', vc.designation,
        'email',       vc.email,
        'phone',       vc.phone,
        'isPrimary',   vc.is_primary
      )
    ) FILTER (WHERE vc.id IS NOT NULL AND vc.is_primary = true),
    '[]'::json
  ) AS primary_contacts
FROM public.vendors v
LEFT JOIN public.vendor_equipment ve ON ve.vendor_id = v.id
LEFT JOIN public.vendor_services  vs ON vs.vendor_id = v.id
LEFT JOIN public.vendor_contacts  vc ON vc.vendor_id = v.id
GROUP BY v.id;

-- ----------------------------------------------------------------
-- 4. Track migration
-- ----------------------------------------------------------------
INSERT INTO schema_migrations (version, description)
VALUES ('123', 'Fix vendor schema: add linkedin_url, fix avg_capacity_utilization type, rebuild vendor_summary view')
ON CONFLICT (version) DO NOTHING;
