-- 863: raw material source name, as memory gives it (run after 865, which renamed the columns).
-- After 865: grade = memory Source Name, name = memory Name (the reference key stock prices and
-- costing match on), description = memory Description (the grade).
-- Step 1: a row with no name takes its grade as its name, so the key (name, falling back to
--         grade) is the same for every row afterwards.
-- Step 2: the grade (source name) drops the " (group)" suffix the import appended.
--         The key does not change, because step 1 made every name non-empty.
-- Both steps run in one block, so any failure rolls everything back.

DO $$
DECLARE
  v_no_name int;
  v_still_no_name int;
BEGIN
  SELECT count(*) INTO v_no_name
  FROM raw_materials
  WHERE name IS NULL OR name = '';

  UPDATE raw_materials
  SET name = grade
  WHERE name IS NULL OR name = '';

  UPDATE raw_materials
  SET grade = left(grade, length(grade) - length(' (' || material_group || ')'))
  WHERE material_group IS NOT NULL
    AND right(grade, length(' (' || material_group || ')')) = ' (' || material_group || ')';

  SELECT count(*) INTO v_still_no_name
  FROM raw_materials
  WHERE name IS NULL OR name = '';
  IF v_still_no_name <> 0 THEN
    RAISE EXCEPTION 'key guard: % rows still have no name', v_still_no_name;
  END IF;

  RAISE NOTICE 'names filled from the grade: %', v_no_name;
END $$;
