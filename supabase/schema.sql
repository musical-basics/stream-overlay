-- ============================================================
--  StreamSync Overlay — database schema
--  Run this in the Supabase SQL Editor (Dashboard > SQL Editor).
--
--  Everything lives in the `stream_overlay` schema (not `public`).
--  After running this, expose the schema to the API:
--    Dashboard > Project Settings > API > "Exposed schemas"
--    -> add `stream_overlay`  (the ALTER ROLE below also does this)
-- ============================================================

create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
--  Dedicated schema for this app.
-- ------------------------------------------------------------
create schema if not exists stream_overlay;

-- Let the API roles see and use the schema.
grant usage on schema stream_overlay to anon, authenticated, service_role;
grant all on all tables in schema stream_overlay to anon, authenticated, service_role;
alter default privileges in schema stream_overlay
  grant all on tables to anon, authenticated, service_role;

-- Expose the schema through PostgREST / supabase-js (db.schema).
-- (Mirror this in Dashboard > Project Settings > API > Exposed schemas.)
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, stream_overlay';
notify pgrst, 'reload config';

-- ------------------------------------------------------------
--  Append-only event log. Every text update and stream-start
--  marker is a new row. Applause is NOT stored here — it goes
--  over Realtime Broadcast (ephemeral, see the app code).
-- ------------------------------------------------------------
create table if not exists stream_overlay.stream_events (
  id         uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  event_type text not null check (event_type in ('text_update', 'stream_start')),
  content    text,                       -- the on-screen text; null for stream_start
  helper_id  uuid references auth.users (id) on delete set null
);

create index if not exists stream_events_type_created_idx
  on stream_overlay.stream_events (event_type, created_at desc);

-- ============================================================
--  Row Level Security
--   - The overlay uses the ANON key and only needs to read the
--     latest text_update (and receive new ones via Realtime).
--   - Logged-in helpers can insert events as themselves and read
--     back ONLY their own submissions (personal history).
--   - The timestamp export reads everything via the service-role
--     key on the server, which bypasses RLS.
-- ============================================================
alter table stream_overlay.stream_events enable row level security;

-- Overlay (anon): read text_update rows so it can show + subscribe to them.
drop policy if exists "anon read text_update" on stream_overlay.stream_events;
create policy "anon read text_update"
  on stream_overlay.stream_events for select
  to anon
  using (event_type = 'text_update');

-- Helpers: read their OWN events (personal history).
drop policy if exists "helpers read own" on stream_overlay.stream_events;
create policy "helpers read own"
  on stream_overlay.stream_events for select
  to authenticated
  using (helper_id = auth.uid());

-- Helpers: insert events, but only attributed to themselves.
drop policy if exists "helpers insert own" on stream_overlay.stream_events;
create policy "helpers insert own"
  on stream_overlay.stream_events for insert
  to authenticated
  with check (helper_id = auth.uid());

-- ============================================================
--  Realtime: deliver new text_update INSERTs to the overlay.
-- ============================================================
alter publication supabase_realtime add table stream_overlay.stream_events;

-- ============================================================
--  Helper accounts
--  There is no public sign-up. Create each helper manually:
--  Dashboard > Authentication > Users > "Add user" (email + password),
--  and tick "Auto Confirm User" so they can log in immediately.
-- ============================================================
