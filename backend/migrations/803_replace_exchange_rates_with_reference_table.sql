-- 803: Replace the hand-written budget exchange rates with the reference
-- exchange rate table (memory/exchange_rate_table.csv), anchored on USD.
--
-- ROOT CAUSE
--
-- Every exchange_rates row was typed into a migration by hand (migration 150
-- "FY2026-27 budget rate" seed, plus a later CNY/CZK/JPY/MXN/PLN/VND batch)
-- with no source behind the numbers, all pivoted through INR. The reference
-- table is the real source: 11 currencies quoted as "1 USD = rate CCY"
-- (version Default, base USD), each with its own last-modified date and
-- author. The rates are stored exactly as quoted -- USD is the anchor now,
-- so no value is re-derived through a pivot -- and ExchangeRateService reads
-- USD-anchored rows (it derives any cross-rate from the anchor either way).
--
-- Decided with the user:
--   - all 11 rows are usable budget rates (is_active = true); the source
--     "active" flag is kept verbatim in source_active for provenance.
--   - the rates are used as quoted, including the 10 dated 2017-12-11; the
--     real date and author are stored so their age is visible.
--   - rows not in the reference table (AED, CZK, PLN, SGD, VND, and every
--     INR-anchored row) are deleted.
--   - the Currency picker is driven by this table; currency_name holds the
--     reference description.
--   - rates are editable from the Process page through
--     set_budget_exchange_rate() (defined at the end), which keeps every
--     replaced rate as inactive history.
--
-- Re-running this migration resets the table to the reference rows (edits
-- and their history included).
--
-- Self-contained (no temp tables), idempotent (re-run converges on the same rows),
-- post-checked. source_modified_at has no time zone because the reference
-- table does not state one.

BEGIN;

-- Every object below is schema-qualified, so the script does not depend
-- on the search_path of the session that runs it.

ALTER TABLE public.exchange_rates ADD COLUMN IF NOT EXISTS currency_name      TEXT;
ALTER TABLE public.exchange_rates ADD COLUMN IF NOT EXISTS source_active      BOOLEAN;
ALTER TABLE public.exchange_rates ADD COLUMN IF NOT EXISTS source_modified_by TEXT;
ALTER TABLE public.exchange_rates ADD COLUMN IF NOT EXISTS source_modified_at TIMESTAMP;

COMMENT ON COLUMN public.exchange_rates.currency_name IS
  'Display name of to_currency from the reference exchange rate table; the Currency picker label.';
COMMENT ON COLUMN public.exchange_rates.source_active IS
  'The reference table active flag, verbatim. Provenance only: is_active decides usability.';
COMMENT ON COLUMN public.exchange_rates.source_modified_by IS 'lastModifiedBy from the reference table.';
COMMENT ON COLUMN public.exchange_rates.source_modified_at IS 'lastModifiedTime from the reference table (no time zone given).';

-- The reference rows, as a helper function (not a temp table: the SQL editor
-- may run statements in separate sessions). Dropped at the end.
CREATE OR REPLACE FUNCTION public._m803_ref_rates()
RETURNS TABLE (code text, name text, rate numeric, src_active boolean, modified_by text, modified_at timestamp)
LANGUAGE sql IMMUTABLE AS $fn$
VALUES
  ('BRL', $str$Brazilian Real$str$, 3.2893, false, $str$admin$str$, TIMESTAMP '2017-12-11 07:00'),
  ('CAD', $str$Canadian Dollar$str$, 1.2839, false, $str$admin$str$, TIMESTAMP '2017-12-11 07:00'),
  ('CNY', $str$Chinese Renminbi Yuan$str$, 6.6082, false, $str$admin$str$, TIMESTAMP '2017-12-11 07:00'),
  ('EUR', $str$Euro$str$, 0.8464, true, $str$fernando.sanchez$str$, TIMESTAMP '2026-01-06 14:28'),
  ('GBP', $str$British Pound Sterling$str$, 0.7477, false, $str$admin$str$, TIMESTAMP '2017-12-11 07:00'),
  ('HKD', $str$Hong Kong Dollar$str$, 7.8079, false, $str$admin$str$, TIMESTAMP '2017-12-11 07:00'),
  ('INR', $str$Indian Rupee$str$, 64.3455, false, $str$admin$str$, TIMESTAMP '2017-12-11 07:00'),
  ('JPY', $str$Japanese Yen$str$, 113.3819, false, $str$admin$str$, TIMESTAMP '2017-12-11 07:00'),
  ('KRW', $str$South Korean Won$str$, 1091.936, false, $str$admin$str$, TIMESTAMP '2017-12-11 07:00'),
  ('MXN', $str$Mexican Peso$str$, 18.9721, false, $str$admin$str$, TIMESTAMP '2017-12-11 07:00'),
  ('TWD', $str$Taiwan NT Dollar$str$, 30.0128, false, $str$admin$str$, TIMESTAMP '2017-12-11 07:00')
$fn$;

-- Remove every row that is not a reference-table row (all INR-anchored rows,
-- AED/CZK/PLN/SGD/VND, and any inactive history of a reference pair).
DELETE FROM public.exchange_rates e
WHERE NOT (e.from_currency = 'USD'
           AND e.is_active
           AND e.to_currency IN (SELECT code FROM public._m803_ref_rates()));

-- Update the reference pairs already present (re-run), insert the rest.
UPDATE public.exchange_rates e
SET rate = r.rate,
    rate_type = 'budget',
    effective_date = r.modified_at::date,
    currency_name = r.name,
    source_active = r.src_active,
    source_modified_by = r.modified_by,
    source_modified_at = r.modified_at,
    notes = 'Reference exchange rate table (version Default, base USD)',
    updated_at = now()
FROM public._m803_ref_rates() r
WHERE e.from_currency = 'USD' AND e.to_currency = r.code AND e.is_active;

INSERT INTO public.exchange_rates
  (from_currency, to_currency, rate, rate_type, effective_date, is_active,
   currency_name, source_active, source_modified_by, source_modified_at, notes)
SELECT 'USD', r.code, r.rate, 'budget', r.modified_at::date, true,
       r.name, r.src_active, r.modified_by, r.modified_at,
       'Reference exchange rate table (version Default, base USD)'
FROM public._m803_ref_rates() r
WHERE NOT EXISTS (
  SELECT 1 FROM public.exchange_rates e
  WHERE e.from_currency = 'USD' AND e.to_currency = r.code AND e.is_active
);

-- Post-check: the table is exactly the reference table.
DO $do$
DECLARE total int; matched int;
BEGIN
  SELECT count(*) INTO total FROM public.exchange_rates;
  SELECT count(*) INTO matched
  FROM public.exchange_rates e JOIN public._m803_ref_rates() r
    ON e.from_currency = 'USD' AND e.to_currency = r.code
   AND e.rate = r.rate AND e.is_active AND e.currency_name = r.name;
  IF total <> 11 OR matched <> 11 THEN
    RAISE EXCEPTION 'migration 803: expected exactly the 11 reference rows, found % rows (% matching)', total, matched;
  END IF;
END
$do$;

DROP FUNCTION public._m803_ref_rates();

-- Editing a budget rate (Process page, Exchange Rates). One atomic step: the
-- current row is kept as inactive history and a new active row carries the
-- new rate, who set it, when, and why. The reference provenance columns are
-- copied forward so the original source stays visible next to the edit.
-- Callable by the backend service role only (it records the signed-in user
-- as p_set_by); table writes stay service-role-only per migration 150.
CREATE OR REPLACE FUNCTION public.set_budget_exchange_rate(
  p_currency text, p_rate numeric, p_set_by uuid, p_reason text
) RETURNS public.exchange_rates
LANGUAGE plpgsql AS $fn$
DECLARE
  cur public.exchange_rates;
  next_row public.exchange_rates;
BEGIN
  IF p_rate IS NULL OR p_rate <= 0 THEN
    RAISE EXCEPTION 'exchange rate must be a positive number';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required to change an exchange rate';
  END IF;

  SELECT * INTO cur FROM public.exchange_rates
  WHERE from_currency = 'USD' AND to_currency = upper(p_currency) AND is_active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active USD exchange rate for %', upper(p_currency);
  END IF;

  UPDATE public.exchange_rates SET is_active = false, updated_at = now() WHERE id = cur.id;

  INSERT INTO public.exchange_rates
    (from_currency, to_currency, rate, rate_type, effective_date, is_active, set_by, notes,
     currency_name, source_active, source_modified_by, source_modified_at)
  VALUES
    ('USD', cur.to_currency, p_rate, 'budget', current_date, true, p_set_by, btrim(p_reason),
     cur.currency_name, cur.source_active, cur.source_modified_by, cur.source_modified_at)
  RETURNING * INTO next_row;

  RETURN next_row;
END
$fn$;

REVOKE ALL ON FUNCTION public.set_budget_exchange_rate(text, numeric, uuid, text) FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.set_budget_exchange_rate(text, numeric, uuid, text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.set_budget_exchange_rate(text, numeric, uuid, text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.set_budget_exchange_rate(text, numeric, uuid, text) TO service_role;
  END IF;
END
$do$;

COMMIT;
