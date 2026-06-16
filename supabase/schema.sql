-- ============================================================
--  StreamSync Overlay — database schema
--  Run this in the Supabase SQL Editor (Dashboard > SQL Editor).
-- ============================================================

create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
--  Append-only event log. Every text update and stream-start
--  marker is a new row. Applause is NOT stored here — it goes
--  over Realtime Broadcast (ephemeral, see the app code).
-- ------------------------------------------------------------
create table if not exists public.stream_events (
  id         uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  event_type text not null check (event_type in ('text_update', 'stream_start')),
  content    text,                       -- the on-screen text; null for stream_start
  helper_id  uuid references auth.users (id) on delete set null
);

create index if not exists stream_events_type_created_idx
  on public.stream_events (event_type, created_at desc);

-- ============================================================
--  Row Level Security
--   - The overlay uses the ANON key and only needs to read the
--     latest text_update (and receive new ones via Realtime).
--   - Logged-in helpers can insert events as themselves and read
--     back ONLY their own submissions (personal history).
--   - The timestamp export reads everything via the service-role
--     key on the server, which bypasses RLS.
-- ============================================================
alter table public.stream_events enable row level security;

-- Overlay (anon): read text_update rows so it can show + subscribe to them.
drop policy if exists "anon read text_update" on public.stream_events;
create policy "anon read text_update"
  on public.stream_events for select
  to anon
  using (event_type = 'text_update');

-- Helpers: read their OWN events (personal history).
drop policy if exists "helpers read own" on public.stream_events;
create policy "helpers read own"
  on public.stream_events for select
  to authenticated
  using (helper_id = auth.uid());

-- Helpers: insert events, but only attributed to themselves.
drop policy if exists "helpers insert own" on public.stream_events;
create policy "helpers insert own"
  on public.stream_events for insert
  to authenticated
  with check (helper_id = auth.uid());

-- ============================================================
--  Realtime: deliver new text_update INSERTs to the overlay.
-- ============================================================
alter publication supabase_realtime add table public.stream_events;

-- ============================================================
--  Helper accounts
--  There is no public sign-up. Create each helper manually:
--  Dashboard > Authentication > Users > "Add user" (email + password),
--  and tick "Auto Confirm User" so they can log in immediately.
-- ============================================================
