-- ============================================================
--  Stream Overlay — database schema
--  Run this in the Supabase SQL Editor (Dashboard > SQL Editor).
-- ============================================================

-- 1. The single, persistent overlay state (one row, id = 1).
create table if not exists public.overlay_state (
  id          int primary key default 1,
  now_playing text not null default '',
  updated_at  timestamptz not null default now(),
  constraint overlay_state_singleton check (id = 1)
);

-- Seed the single row.
insert into public.overlay_state (id, now_playing)
values (1, '')
on conflict (id) do nothing;

-- 2. Ephemeral "applause" events. Inserting a row = fire applause.
create table if not exists public.applause_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);

-- ============================================================
--  Row Level Security
--  The browser (overlay + control panel) uses the ANON key and
--  only needs to READ. All writes go through the server using
--  the SERVICE ROLE key, which bypasses RLS.
-- ============================================================
alter table public.overlay_state    enable row level security;
alter table public.applause_events  enable row level security;

-- Public read access (required so Realtime can deliver row data to the overlay).
drop policy if exists "public read overlay_state" on public.overlay_state;
create policy "public read overlay_state"
  on public.overlay_state for select
  using (true);

drop policy if exists "public read applause_events" on public.applause_events;
create policy "public read applause_events"
  on public.applause_events for select
  using (true);

-- (No insert/update/delete policies → anon clients cannot write. Good.)

-- ============================================================
--  Enable Realtime on both tables (adds them to the publication).
-- ============================================================
alter publication supabase_realtime add table public.overlay_state;
alter publication supabase_realtime add table public.applause_events;

-- Optional housekeeping: keep applause_events small.
-- You can run this occasionally, or set up a cron job.
-- delete from public.applause_events where created_at < now() - interval '1 day';
