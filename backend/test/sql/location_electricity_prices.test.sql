-- 1004: the electricity price of each Digital Factory location, as sourced reference data: a price, its currency and where it comes from.
-- Signed-in users read it; nobody but the service role writes it. A price is positive and states its source.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.location_electricity_prices WHERE location = 'USA' AND currency = 'USD' AND price_per_kwh = 0.0851 AND basis ILIKE '%EIA%';
  ASSERT n = 1, 'USA: the EIA 2025 annual industrial average, USD';
  SELECT count(*) INTO n FROM public.location_electricity_prices WHERE location = 'France' AND currency = 'EUR' AND price_per_kwh = 0.175;
  ASSERT n = 1, 'France: the HR Rates export price, EUR';
  SELECT count(*) INTO n FROM public.location_electricity_prices WHERE location IN ('India', 'China', 'Mexico');
  ASSERT n = 0, 'a location with no source has no price (none is invented)';
  BEGIN
    INSERT INTO public.location_electricity_prices (location, price_per_kwh, currency, basis, source_url, retrieved_on) VALUES ('X', 0, 'USD', 'test', 'https://x', now());
    ASSERT false, 'a price must be positive';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.location_electricity_prices (location, price_per_kwh, currency, basis, retrieved_on) VALUES ('X', 0.1, 'usd', 'test', now());
    ASSERT false, 'a currency is an ISO code';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  ASSERT has_table_privilege('authenticated', 'public.location_electricity_prices', 'SELECT'), 'signed-in users read the prices';
  ASSERT NOT has_table_privilege('authenticated', 'public.location_electricity_prices', 'INSERT'), 'users do not write reference data';
  ASSERT NOT has_table_privilege('anon', 'public.location_electricity_prices', 'SELECT'), 'anonymous callers read nothing';
END $$;
