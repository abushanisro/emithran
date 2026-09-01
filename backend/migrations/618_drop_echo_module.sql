-- ============================================================================
-- Drop Echo Module — Manufacturing Copilot (full removal)
-- Migration 618
--
-- Reverses migration 315 (315_echo_module.sql). The Echo feature (backend
-- module, frontend widget/provider, all page wiring) has been removed from
-- the codebase in full — this migration removes its data layer to match.
--
-- IRREVERSIBLE: DROPs 6 tables and everything in them (any real conversation
-- history, alerts, hints, context snapshots). Take a backup/export first if
-- there is any chance this data is still wanted. There is no code path left
-- anywhere in the app that reads or writes these tables after this runs.
--
-- Drop order respects FK dependencies (echo_messages/echo_context_snapshots
-- reference echo_conversations; nothing references echo_hints/echo_alerts/
-- echo_suggestion_dismissals, so CASCADE isn't required for the ones without
-- inbound FKs, but every drop uses IF EXISTS ... CASCADE for safety/idempotency).
-- ============================================================================

DROP TABLE IF EXISTS echo_context_snapshots CASCADE;
DROP TABLE IF EXISTS echo_messages CASCADE;
DROP TABLE IF EXISTS echo_conversations CASCADE;
DROP TABLE IF EXISTS echo_alerts CASCADE;
DROP TABLE IF EXISTS echo_suggestion_dismissals CASCADE;
DROP TABLE IF EXISTS echo_hints CASCADE;

-- update_updated_at_column() is a shared trigger function (first created in
-- 313_benchmark_sessions_schema.sql, reused by many other tables) — NOT
-- dropped here, it does not belong to the Echo module.
