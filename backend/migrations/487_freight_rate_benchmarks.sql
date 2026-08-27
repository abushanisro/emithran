-- ============================================================================
-- Migration: Freight Rate Benchmarks — real region-pair reference rates
-- Purpose: Promotes the "freightRates" reference data (staged in migration
--          486, sm_reference_data key prefix 'freightRates:') into a real,
--          purpose-built table the Packaging & Logistics "Add Logistics
--          Item" dialog can query directly — a genuine click-to-fill
--          reference suggestion, never auto-applied to a cost record. See
--          migration 389: this app previously had a FABRICATED flat
--          $3.00/kg freight default silently applied to every part with no
--          real source, removed as an anti-pattern violation. These 16 rows
--          are the real, complete region-pair rate matrix as sourced — kept
--          verbatim (not collapsed into a guessed "same-region"/
--          "cross-region" label), because the real pattern isn't a simple
--          same-continent/different-continent split (e.g. NA_SA and
--          SA_NASeaAir price at the lower 1.10 rate alongside same-region
--          pairs, while any lane touching APAC or EU prices at 6.60) — the
--          user picks the real lane that matches their actual shipment.
-- Author: Principal Engineering Team
-- Date: 2026-08-19
-- Version: 1.0.0
-- ============================================================================

CREATE TABLE IF NOT EXISTS freight_rate_benchmarks (
    id              SERIAL PRIMARY KEY,
    rate_type       VARCHAR(30) NOT NULL,   -- real lane code, e.g. 'APA_APA', 'NA_EU'
    rate_usd_per_kg NUMERIC NOT NULL,
    source_region   VARCHAR(10) NOT NULL DEFAULT 'USA',
    source_version  VARCHAR(20) NOT NULL DEFAULT '2026-03',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS freight_rate_benchmarks_rate_type ON freight_rate_benchmarks(rate_type);

ALTER TABLE freight_rate_benchmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read" ON freight_rate_benchmarks;
CREATE POLICY "Public read" ON freight_rate_benchmarks FOR SELECT USING (true);

COMMENT ON TABLE freight_rate_benchmarks IS 'Real region-pair freight reference rates (USD/kg) — click-to-fill suggestion source for the Packaging & Logistics dialog, never auto-applied to a cost record.';

INSERT INTO freight_rate_benchmarks (rate_type, rate_usd_per_kg) VALUES
  ('APA_APA',      1.10),
  ('EU_EU',        1.10),
  ('NA_NALand',    1.10),
  ('NA_SA',        1.10),
  ('SA_NASeaAir',  1.10),
  ('SA_SA',        1.10),
  ('APA_EU',       6.60),
  ('APA_NASeaAir', 6.60),
  ('APA_SA',       6.60),
  ('EU_APA',       6.60),
  ('EU_NASeaAir',  6.60),
  ('EU_SA',        6.60),
  ('NA_APA',       6.60),
  ('NA_EU',        6.60),
  ('SA_APA',       6.60),
  ('SA_EU',        6.60)
ON CONFLICT (rate_type) DO NOTHING;
