-- 971: mhr_records.operators holds fractions of an operator (0.5 = one operator for two presses); the values already stored do not change.
-- The stub has the column as smallint, as it was before 971 (the migration under test has already run on it: smallint -> numeric(5,2)).
DO $$
DECLARE
  v_type text;
  v numeric;
BEGIN
  SELECT format_type(atttypid, atttypmod) INTO v_type FROM pg_attribute WHERE attrelid = 'public.mhr_records'::regclass AND attname = 'operators';
  ASSERT v_type = 'numeric(5,2)', 'operators is numeric(5,2) after 971, got ' || coalesce(v_type, 'null');

  INSERT INTO public.mhr_records (location, operators) VALUES ('USA', 0.5);
  SELECT operators INTO v FROM public.mhr_records WHERE location = 'USA';
  ASSERT v = 0.5, 'half an operator is stored as 0.5, not rounded to 1: ' || v;

  INSERT INTO public.mhr_records (location, operators) VALUES ('X', 2);
  SELECT operators INTO v FROM public.mhr_records WHERE location = 'X';
  ASSERT v = 2, 'a whole number stays what it was';

  INSERT INTO public.mhr_records (location) VALUES ('D');
  SELECT operators INTO v FROM public.mhr_records WHERE location = 'D';
  ASSERT v = 1, 'the default is still one operator';
END $$;
