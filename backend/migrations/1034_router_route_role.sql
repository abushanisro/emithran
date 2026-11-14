-- ============================================================================
-- Migration 1034: the routers are primary machines, with their own route role
-- ============================================================================
-- process_taxonomy.machining_route_role (migration 780) says which machining
-- processes the route comparison offers as a part's primary machine. The mills
-- have 'primary_milling' and the lathes 'primary_turning'; the 3 and 5 Axis
-- Routers (memory/Machining/processes.csv, 13 rated machines in the USA
-- factory) had none, so they were never offered.
--
-- A router is not priced as a mill, so it gets a role of its own,
-- 'primary_routing': the route comparison lists it with what the operation
-- catalog says it can and cannot make.
--
-- Idempotent: the constraint is replaced, and only a row with no role changes.
-- ============================================================================

ALTER TABLE process_taxonomy DROP CONSTRAINT IF EXISTS chk_machining_route_role;
ALTER TABLE process_taxonomy ADD CONSTRAINT chk_machining_route_role
  CHECK (machining_route_role IN ('primary_milling', 'primary_turning', 'primary_routing', 'secondary_operation', 'inspection'));

UPDATE process_taxonomy
SET machining_route_role = 'primary_routing'
WHERE process_group = 'Machining'
  AND process_name IN ('3 Axis Router', '5 Axis Router')
  AND machining_route_role IS NULL;
