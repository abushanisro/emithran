-- ============================================================================
-- Migration 1062: the default budget exchange rates, at the ECB reference rates of 2026-11-16
-- ============================================================================
-- The global default budget rates (exchange_rates, migration 803) were memory/exchange_rate_table.csv, dated 2017-12-11
-- except EUR (2026-01-06). Every non-USA factory is costed at its budget rate (HR Rates hold USD), so an India quote was
-- priced at 1 USD = 64.3455 INR while the Currency panel showed today's 93.93: about 30% under.
--
-- Source: ECB euro foreign exchange reference rates of 2026-11-16, quoted per USD by Frankfurter
-- (https://api.frankfurter.dev/v1/latest?base=USD), the provider the app's reference rates use:
--   BRL 5.7053  CAD 1.4285  CNY 6.6665  EUR 0.90794  GBP 0.75767  HKD 7.847  INR 93.93  JPY 159.6  KRW 1334.87  MXN 18.5609
-- TWD is not an ECB reference currency: its 2017 row is left as it is.
--
-- Each change keeps the old row (is_active false) and adds the new one, as set_budget_exchange_rate does, so the rate a past
-- quote used stays on record. An organization's own budget rate (organization_exchange_rates) still overrides these.
-- Idempotent: a currency whose active rate is already the new one is left alone. A database with no exchange_rates (the
-- fresh-database test's stub) has no rate to refresh.
-- Verify: SELECT to_currency, rate, effective_date FROM exchange_rates WHERE is_active ORDER BY 1;
-- ============================================================================

DO $fx$
DECLARE
  r record; cur record;
BEGIN
  IF to_regclass('public.exchange_rates') IS NULL THEN RETURN; END IF;
  FOR r IN SELECT * FROM (VALUES
    ('BRL', 5.7053), ('CAD', 1.4285), ('CNY', 6.6665), ('EUR', 0.90794), ('GBP', 0.75767),
    ('HKD', 7.847), ('INR', 93.93), ('JPY', 159.6), ('KRW', 1334.87), ('MXN', 18.5609)
  ) AS v(code, rate)
  LOOP
    SELECT * INTO cur FROM public.exchange_rates
    WHERE from_currency = 'USD' AND to_currency = r.code AND is_active
    FOR UPDATE;
    IF NOT FOUND OR cur.rate = r.rate THEN CONTINUE; END IF;

    UPDATE public.exchange_rates SET is_active = false, updated_at = now() WHERE id = cur.id;
    INSERT INTO public.exchange_rates
      (from_currency, to_currency, rate, rate_type, effective_date, is_active, set_by, notes,
       currency_name, source_active, source_modified_by, source_modified_at)
    VALUES
      ('USD', r.code, r.rate, 'budget', DATE '2026-11-16', true, NULL,
       'ECB euro foreign exchange reference rates of 2026-11-16 (via Frankfurter), migration 1062',
       cur.currency_name, true, 'ECB reference rates (via Frankfurter)', TIMESTAMP '2026-11-16 00:00');
  END LOOP;
END
$fx$;
