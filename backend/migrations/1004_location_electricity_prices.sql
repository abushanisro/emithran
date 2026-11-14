-- ============================================================================
-- Migration 1004: the electricity price of each Digital Factory location (reference data)
-- ============================================================================
-- A melting furnace's main running cost is its electricity; the sand route charges it (melting, hot-box cores, drying ovens) only with a
-- price per kWh. No price existed for any location: mhr_records.electricity_cost_per_kwh is 0 on every machine, and the sand reference data
-- has none. This table holds one sourced price per location, in its own currency (converted with the app's exchange rates when used). The
-- Cost Guide's energy price still overrides it for a part. A location without a source has no row: its energy stays "not charged" and says so.
--   USA     0.0851 USD/kWh  U.S. EIA, Electric Power Monthly, Table 5.3, industrial sector, 2025 annual average (8.51 cents/kWh)
--   France  0.175  EUR/kWh  the plant's HR Rates export (memory/database/hr-rates-2026-07-22.json, electricityCostPerKwh, currency EUR)
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.location_electricity_prices (
  location      text PRIMARY KEY,
  price_per_kwh numeric NOT NULL CHECK (price_per_kwh > 0),
  currency      text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  basis         text NOT NULL CHECK (char_length(btrim(basis)) >= 3),
  source_url    text,
  retrieved_on  date NOT NULL
);

INSERT INTO public.location_electricity_prices (location, price_per_kwh, currency, basis, source_url, retrieved_on) VALUES
  ('USA', 0.0851, 'USD', 'U.S. EIA Electric Power Monthly, Table 5.3: industrial sector, 2025 annual average (8.51 cents/kWh)',
   'https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_3', '2026-11-13'),
  ('France', 0.175, 'EUR', 'HR Rates export of 2026-07-22 (electricityCostPerKwh, EUR)', NULL, '2026-07-22')
ON CONFLICT (location) DO NOTHING;

ALTER TABLE public.location_electricity_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_location_electricity_prices ON public.location_electricity_prices;
CREATE POLICY read_location_electricity_prices ON public.location_electricity_prices FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.location_electricity_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.location_electricity_prices TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.location_electricity_prices TO service_role;

NOTIFY pgrst, 'reload schema';
