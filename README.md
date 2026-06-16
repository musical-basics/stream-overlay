# StreamSync Overlay

A real-time OBS overlay for livestreams **plus** a logging/timestamp system.
Authenticated helpers push a "Now playing" line and trigger applause (sound +
floating emojis) — everything updates on the overlay live. Every text update is
logged so you can export **YouTube chapter timestamps** after the stream.

- **`/overlay`** — transparent page you add as a **Browser source** in OBS (public).
- **`/admin`** — helper control panel: submit text, mark stream start, applause, history (login required).
- **`/admin/export`** — relative timestamps formatted for YouTube chapters.
- **`/login`** — Supabase email/password sign-in.

Stack: **Next.js (App Router) · Supabase (Auth + Postgres + Realtime) · Vercel**.

---

## How it works

```
Helper submits text  ──insert──▶ stream_events (text_update) ──Realtime INSERT──▶ /overlay updates text
Helper hits Applause ──Broadcast 'applause' on channel "overlay"──────────────▶ /overlay: emojis + sound
Helper marks start   ──insert──▶ stream_events (stream_start)
/admin/export        ──service role reads all events──▶ relative timestamps → chapters
```

- **Persistent text** uses **Postgres + Realtime** (append-only log → survives overlay reloads).
- **Applause** uses **Broadcast** — ephemeral, never written to the DB (lowest latency).
- The browser uses the **anon key**. RLS lets the overlay read text updates and lets
  each helper read only *their own* history. All export reads happen server-side with
  the **service-role key**, so chapters include every helper's updates.

---

## Setup (one time, ~10 minutes)

### 1. Create a Supabase project
1. <https://supabase.com> → **New project**. Pick a name + DB password; wait for it to provision.
2. **SQL Editor → New query**, paste [`supabase/schema.sql`](supabase/schema.sql), and **Run**.
   This creates the `stream_events` table, RLS policies, and enables Realtime.
3. **Project Settings → API**, copy: **Project URL**, **anon public** key, **service_role** key.

### 2. Create helper accounts
There is no public sign-up. For each helper:
**Authentication → Users → Add user** → enter email + password, and tick
**"Auto Confirm User"** so they can log in right away.

### 3. Configure environment variables
```bash
cp .env.local.example .env.local
```
```
NEXT_PUBLIC_SUPABASE_URL=...          # Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=...     # anon public key
SUPABASE_SERVICE_ROLE_KEY=...         # service_role key (secret, server only)
```

### 4. Run locally
```bash
pnpm install
pnpm dev
```
- Overlay:  <http://localhost:3000/overlay>
- Control:  <http://localhost:3000/admin>  (log in with a helper account)

Open both in two windows, submit text in the panel, watch the overlay update.

### 5. (Optional) Add a real applause sound
Drop an `applause.mp3` into [`public/`](public/). Without it, a synthesized
applause plays as a fallback.

---

## Deploy to Vercel
1. Push to GitHub (already wired to `musical-basics/stream-overlay`).
2. <https://vercel.com> → **New Project** → import the repo.
3. Add the **3 environment variables** from `.env.local` (Production + Preview).
4. Deploy. Overlay is at `https://your-app.vercel.app/overlay`.

---

## Add to OBS
1. **Sources → + → Browser**.
2. URL: your `/overlay` URL.
3. **Width 1920 / Height 1080** (match your canvas).
4. Right-click the source → **Properties** → ensure **"Control audio via OBS"**
   is enabled so applause is heard on the stream.
5. Position it on top; the background is transparent.

> If OBS stops reacting, right-click the Browser source → **Refresh**.

---

## Generating YouTube chapters
1. When your recording starts, hit **"Mark stream start"** in `/admin`.
2. Submit "Now playing" texts throughout the stream as usual.
3. After the stream, open **`/admin/export`** and copy the block, e.g.:
   ```
   00:00 Stream Start
   05:12 Now playing: Für Elise
   12:48 Now playing: Clair de Lune
   ```
4. Paste it into your YouTube video description.

> Export is relative to the **most recent** stream-start marker, so mark it once
> per stream right when recording begins.

---

## Security notes
- Helper accounts are real Supabase users; rotate/revoke them in the dashboard.
- RLS: the overlay (anon) can read text updates; helpers can read only their own
  submissions. The service-role key stays server-side (never `NEXT_PUBLIC_`).
- The overlay is intentionally public and read-only.
