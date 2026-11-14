-- ============================================================================
-- Migration 1033: Simultaneous Turning is a primary turning machine
-- ============================================================================
-- process_taxonomy.machining_route_role (migration 780) says which machining
-- processes the route comparison offers as a part's primary machine. The four
-- lathes and MillTurn have 'primary_turning'; Simultaneous Turning (the
-- multi-spindle lathes of memory/Machining/processes.csv, 15 rated machines in
-- the USA factory, a registered turning engine) had none, so it was never
-- offered as a route.
--
-- Idempotent: only a row with no role is changed.
-- ============================================================================

UPDATE process_taxonomy
SET machining_route_role = 'primary_turning'
WHERE process_group = 'Machining'
  AND process_name = 'Simultaneous Turning'
  AND machining_route_role IS NULL;
