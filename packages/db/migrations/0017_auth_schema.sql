-- Feature 084 — control-plane GoTrue auth schema bootstrap.
--
-- GoTrue runs in the control-plane stack as the `supastack` superuser and owns
-- the `auth` schema (its own tables + migrations live there). Pre-create the
-- schema idempotently so GoTrue boots cleanly regardless of start order.
-- Idempotent + additive (Constitution I): re-running is a no-op.
CREATE SCHEMA IF NOT EXISTS auth;
