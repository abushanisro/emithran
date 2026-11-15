-- Every id sequence in public is at least its table's highest id. Not a numbered migration: scripts/migrate.ts runs it before it applies
-- any pending migration, on every database (local, stage, prd), and backend/test/sql/resync_id_sequences.test.sql tests it.
--
-- Why: staging and production were loaded from a baseline (scripts/baseline-load.sh) whose reference tables held rows inserted with explicit
-- ids while their sequences were still at 1 (the source database was already so: the dump's setval says 1). Nothing inserted without an id
-- until migration 1036, whose INSERT then took id 1 and collided with an existing row ("duplicate key value violates unique constraint
-- machining_reference_data_pkey"); 24 tables were in that state.
--
-- A sequence is only ever moved forward, to the highest id, so the next default id is past every row. One already past its rows (rows
-- deleted since) is never lowered: that would hand out ids again. An empty table's sequence is left as it is. Idempotent.
DO $$
DECLARE
  r record;
  highest bigint;
  current_value bigint;
  called boolean;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, s.relname AS sequence_name, t.relname AS table_name, a.attname AS column_name
    FROM pg_class s
    JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
    JOIN pg_class t ON t.oid = d.refobjid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
    JOIN pg_namespace n ON n.oid = s.relnamespace
    WHERE s.relkind = 'S' AND n.nspname = 'public' AND t.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('SELECT max(%I)::bigint FROM %I.%I', r.column_name, r.schema_name, r.table_name) INTO highest;
    EXECUTE format('SELECT last_value, is_called FROM %I.%I', r.schema_name, r.sequence_name) INTO current_value, called;
    -- The next value the sequence hands out: last_value itself when it was never called, the one after otherwise.
    IF highest IS NOT NULL AND (CASE WHEN called THEN current_value + 1 ELSE current_value END) <= highest THEN
      PERFORM setval(format('%I.%I', r.schema_name, r.sequence_name), highest, true);
      RAISE NOTICE 'resync-id-sequences: %.% moved to % (it was at %, behind %.%.%)',
        r.schema_name, r.sequence_name, highest, current_value, r.schema_name, r.table_name, r.column_name;
    END IF;
  END LOOP;
END $$;
