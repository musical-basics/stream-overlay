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
  content     text,                      -- the on-screen text; null for stream_start
  helper_id   uuid references auth.users (id) on delete set null,
  helper_name text                       -- display name shown on the overlay
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
do $$ begin
  alter publication supabase_realtime add table stream_overlay.stream_events;
exception when duplicate_object then null; end $$;

-- ============================================================
--  Request queue (max 5, maintained by helpers; shown on the
--  overlay ticker). Ordered by `sort`.
-- ============================================================
create table if not exists stream_overlay.requests (
  id          uuid primary key default uuid_generate_v4(),
  song        text not null,
  requester   text not null default '',
  sort        double precision not null default 0,
  created_at  timestamptz not null default now(),
  helper_id   uuid references auth.users (id) on delete set null
);

grant all on stream_overlay.requests to anon, authenticated, service_role;

alter table stream_overlay.requests enable row level security;

-- Overlay (anon) reads the whole queue for the ticker.
drop policy if exists "anon read requests" on stream_overlay.requests;
create policy "anon read requests" on stream_overlay.requests
  for select to anon using (true);

-- Helpers fully manage the queue.
drop policy if exists "auth select requests" on stream_overlay.requests;
create policy "auth select requests" on stream_overlay.requests
  for select to authenticated using (true);
drop policy if exists "auth insert requests" on stream_overlay.requests;
create policy "auth insert requests" on stream_overlay.requests
  for insert to authenticated with check (true);
drop policy if exists "auth update requests" on stream_overlay.requests;
create policy "auth update requests" on stream_overlay.requests
  for update to authenticated using (true) with check (true);
drop policy if exists "auth delete requests" on stream_overlay.requests;
create policy "auth delete requests" on stream_overlay.requests
  for delete to authenticated using (true);

do $$ begin
  alter publication supabase_realtime add table stream_overlay.requests;
exception when duplicate_object then null; end $$;

-- ============================================================
--  "Now playing" — a single persistent value shown top-left on
--  the overlay. Unlike the announcement (an append-only event
--  that fades), this is one mutable row that admins overwrite and
--  that stays on screen until changed. Singleton: id is pinned to 1.
-- ============================================================
create table if not exists stream_overlay.now_playing (
  id          smallint primary key default 1 check (id = 1),
  song        text not null default '',
  helper_id   uuid references auth.users (id) on delete set null,
  helper_name text,
  updated_at  timestamptz not null default now()
);

-- Seed the single row so the overlay always has something to read.
insert into stream_overlay.now_playing (id, song) values (1, '')
  on conflict (id) do nothing;

grant all on stream_overlay.now_playing to anon, authenticated, service_role;

alter table stream_overlay.now_playing enable row level security;

-- Overlay (anon) reads the current value for display.
drop policy if exists "anon read now_playing" on stream_overlay.now_playing;
create policy "anon read now_playing" on stream_overlay.now_playing
  for select to anon using (true);

-- Helpers read + overwrite the single value.
drop policy if exists "auth select now_playing" on stream_overlay.now_playing;
create policy "auth select now_playing" on stream_overlay.now_playing
  for select to authenticated using (true);
drop policy if exists "auth insert now_playing" on stream_overlay.now_playing;
create policy "auth insert now_playing" on stream_overlay.now_playing
  for insert to authenticated with check (true);
drop policy if exists "auth update now_playing" on stream_overlay.now_playing;
create policy "auth update now_playing" on stream_overlay.now_playing
  for update to authenticated using (true) with check (true);

do $$ begin
  alter publication supabase_realtime add table stream_overlay.now_playing;
exception when duplicate_object then null; end $$;

-- ============================================================
--  Chat embed — the YouTube live-chat video id for the current
--  stream, shown top-right on the overlay. Like now_playing this
--  is a single mutable row admins set each stream. Singleton: id = 1.
-- ============================================================
create table if not exists stream_overlay.chat_settings (
  id          smallint primary key default 1 check (id = 1),
  video_id    text not null default '',  -- YouTube video id of the live stream
  helper_id   uuid references auth.users (id) on delete set null,
  helper_name text,
  updated_at  timestamptz not null default now()
);

insert into stream_overlay.chat_settings (id, video_id) values (1, '')
  on conflict (id) do nothing;

grant all on stream_overlay.chat_settings to anon, authenticated, service_role;

alter table stream_overlay.chat_settings enable row level security;

-- Overlay (anon) reads the current video id for the chat embed.
drop policy if exists "anon read chat_settings" on stream_overlay.chat_settings;
create policy "anon read chat_settings" on stream_overlay.chat_settings
  for select to anon using (true);

-- Helpers read + overwrite the single value.
drop policy if exists "auth select chat_settings" on stream_overlay.chat_settings;
create policy "auth select chat_settings" on stream_overlay.chat_settings
  for select to authenticated using (true);
drop policy if exists "auth insert chat_settings" on stream_overlay.chat_settings;
create policy "auth insert chat_settings" on stream_overlay.chat_settings
  for insert to authenticated with check (true);
drop policy if exists "auth update chat_settings" on stream_overlay.chat_settings;
create policy "auth update chat_settings" on stream_overlay.chat_settings
  for update to authenticated using (true) with check (true);

do $$ begin
  alter publication supabase_realtime add table stream_overlay.chat_settings;
exception when duplicate_object then null; end $$;

-- ============================================================
--  Helper accounts
--  There is no public sign-up. Create each helper manually:
--  Dashboard > Authentication > Users > "Add user" (email + password),
--  and tick "Auto Confirm User" so they can log in immediately.
-- ============================================================
