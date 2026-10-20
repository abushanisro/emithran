-- ============================================================================
-- Migration 913: facts supplied with an upload, and the extraction report
-- ============================================================================
-- ecad_uploads.params      the facts a person or document supplied with the upload (board thickness, the layer count
--                          a document states, boards per panel), each with who stated it. They are part of what a
--                          revision is, so they are stored with it and fed to the extraction.
-- ecad_uploads.extraction  what the extraction engine returned besides the graph: how each file was classified and
--                          used, and the attached documents (the Pick Place preamble, the BOM table) shown for review.
--
-- Both are written once per upload; users may read them with the upload (existing RLS) and nothing else changes.
-- Idempotent.
-- ============================================================================

ALTER TABLE public.ecad_uploads
  ADD COLUMN IF NOT EXISTS params jsonb,
  ADD COLUMN IF NOT EXISTS extraction jsonb;
