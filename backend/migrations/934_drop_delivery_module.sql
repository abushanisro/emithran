-- Migration 934: drop the delivery module's database objects.
--
-- The delivery module was removed from the application end to end (frontend, Next.js routes and the NestJS module). The owner
-- approved dropping its data; the last copy is the pre-migration baseline taken from the old Supabase project.
-- Nothing outside the module depends on these objects: no foreign keys, views or functions elsewhere refer to them.
-- quality_approved_items stays: quality control and production planning still use it.

DROP MATERIALIZED VIEW IF EXISTS public.delivery_performance_metrics;
DROP MATERIALIZED VIEW IF EXISTS public.delivery_quality_metrics;
DROP VIEW IF EXISTS public.delivery_ready_items;

-- One statement, so foreign keys among these tables never block the order. Their triggers go with them.
DROP TABLE IF EXISTS
  public.delivery_invoice_items,
  public.delivery_invoices,
  public.delivery_documents,
  public.delivery_tracking,
  public.delivery_items,
  public.delivery_orders,
  public.delivery_addresses,
  public.carriers;

-- Every overload of the module's functions (several were SECURITY DEFINER without a pinned search_path).
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'calculate_delivery_metrics',
        'create_delivery_order_transaction',
        'generate_delivery_order_number',
        'generate_delivery_report',
        'generate_invoice_number',
        'refresh_delivery_metrics',
        'update_delivery_order_costs',
        'update_delivery_order_status_bulk'
      )
  LOOP
    EXECUTE format('DROP FUNCTION %s', fn);
  END LOOP;
END $$;
