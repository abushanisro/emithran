-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 472: fx_rate_snapshots — reference FX rate cache
--
-- Backs the new "Currency & Ask Price" architecture's Reference rate type
-- (backend/src/common/fx/*). This is a per-day CACHE/HISTORY of rates pulled
-- from a live provider (Frankfurter — ECB reference rates, see
-- FrankfurterFxProvider), distinct in purpose from the existing
-- `exchange_rates` table (admin-curated BUDGET rates, unrelated, untouched by
-- this migration — see common/exchange-rate/exchange-rate.service.ts).
--
-- Why a new table instead of reusing exchange_rates: exchange_rates enforces
-- exactly one ACTIVE row per (from_currency, to_currency) pair by design (a
-- budget rate for the current financial year). This table intentionally
-- keeps one row PER DAY per (provider, base, quote) — a real history, so a
-- scenario's stored fxSnapshot rate never needs "today's" cache row to still
-- exist for that scenario to remain reproducible (the scenario embeds the
-- resolved rate itself; this table is purely a request-time cache to avoid
-- calling the external provider on every Cost Summary request).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fx_rate_snapshots (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider           VARCHAR(50) NOT NULL,               -- 'frankfurter'
    provider_source    VARCHAR(150),                        -- 'ECB reference rates (via Frankfurter)'
    base_currency      VARCHAR(3)  NOT NULL,
    quote_currency     VARCHAR(3)  NOT NULL,
    rate               NUMERIC(18, 8) NOT NULL CHECK (rate > 0),
    rate_date          DATE        NOT NULL,               -- date the PROVIDER says the rate is FOR
    provider_timestamp TIMESTAMPTZ,
    retrieved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- when Mithran fetched it
    source_metadata    JSONB       DEFAULT '{}'::jsonb,     -- raw provider response fields, for audit
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, base_currency, quote_currency, rate_date)
);

CREATE INDEX IF NOT EXISTS idx_fx_rate_snapshots_lookup
    ON fx_rate_snapshots (base_currency, quote_currency, rate_date DESC);

COMMENT ON TABLE fx_rate_snapshots IS
    'Per-day cache of reference FX rates from an external provider (Frankfurter). NOT the admin budget-rate table (exchange_rates) — see common/fx/fx.service.ts for how the two are dispatched by rate type.';

-- ── RLS: readable by all authenticated users, writable by service role only ────
-- (mirrors exchange_rates' own policy — migration 150)
ALTER TABLE fx_rate_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fx_rate_snapshots_read_authenticated"
    ON fx_rate_snapshots FOR SELECT
    TO authenticated
    USING (true);

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT * FROM fx_rate_snapshots ORDER BY retrieved_at DESC LIMIT 5;
