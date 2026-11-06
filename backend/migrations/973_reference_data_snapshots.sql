-- Migration 973: reference_data_snapshots, the reference rows a saved calculation read, stored once per fingerprint
-- Date: 2026-11-07
--
-- A saved plastic line records the fingerprint of the staged reference rows it was calculated with (migration 972, calculation_breakdown). A
-- fingerprint identifies data; it cannot bring it back. This table keeps the rows themselves, content-addressed: the key is the fingerprint, the value
-- the canonical rows, so the same data is stored once however many lines used it, and a stored row can be checked against its key at any time.
-- calculation-replay.ts recomputes a saved line from its recorded inputs and these rows.
--
-- Rows are written by the backend (service role) when a calculation is applied and are never changed or deleted by anyone: reference data is public-read
-- (like machining_reference_data), so any signed-in user may read them. Schema only: no rows are written here. Idempotent.

CREATE TABLE IF NOT EXISTS public.reference_data_snapshots (
  fingerprint    text PRIMARY KEY CHECK (fingerprint ~ '^[0-9a-f]{16}$'),
  source_version text NOT NULL CHECK (char_length(btrim(source_version)) > 0),
  rows           jsonb NOT NULL CHECK (jsonb_typeof(rows) = 'object'),
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.reference_data_snapshots IS 'The staged reference rows a saved calculation read, by the fingerprint it records (content-addressed, immutable). Written by the backend on apply; read to replay a calculation.';

-- Content-addressed: a row is never edited or removed (a different content is a different key).
CREATE OR REPLACE FUNCTION public.reference_data_snapshots_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a reference data snapshot is immutable (content-addressed by its fingerprint)' USING ERRCODE = 'check_violation';
END
$$;

DROP TRIGGER IF EXISTS reference_data_snapshots_frozen ON public.reference_data_snapshots;
CREATE TRIGGER reference_data_snapshots_frozen BEFORE UPDATE OR DELETE ON public.reference_data_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.reference_data_snapshots_frozen();

ALTER TABLE public.reference_data_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reference_data_snapshots_read ON public.reference_data_snapshots;
CREATE POLICY reference_data_snapshots_read ON public.reference_data_snapshots FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.reference_data_snapshots FROM anon, authenticated;
GRANT SELECT ON public.reference_data_snapshots TO authenticated;
GRANT SELECT, INSERT ON public.reference_data_snapshots TO service_role;

NOTIFY pgrst, 'reload schema';
