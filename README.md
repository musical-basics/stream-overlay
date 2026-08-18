# StreamSync Overlay

A real-time OBS overlay for livestreams **plus** a logging/timestamp system.
Authenticated helpers push a "Now playing" line and trigger applause (sound +
floating emojis) — everything updates on the overlay live. Every text update is
logged so you can export **YouTube chapter timestamps** after the stream.

- **`/overlay`** — transparent page you add as a **Browser source** in OBS (public).
- **`/admin`** — helper control panel: submit text, mark stream start, applause, history (login required).
- **`/admin/export`** — relative timestamps formatted for YouTube chapters.
- **`/login`** — Supabase email/password sign-in.
- **`/forgot`** → **`/reset-password`** — self-serve password reset by email.

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

Helpers who forget their password can reset it themselves from the
**Forgot password?** link on `/login` — see [Password resets](#password-resets)
for the two settings it depends on.

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

## Deploy (already live on Vercel)
Deployed to the **musical-basics** Vercel team with GitHub auto-deploy — every
push to `main` ships to production.

- Overlay: <https://stream-overlay-iota.vercel.app/overlay>
- Control: <https://stream-overlay-iota.vercel.app/admin>

The site builds and loads, but **won't be functional until you add your Supabase
keys** to Vercel and redeploy:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL production --scope musical-basics
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production --scope musical-basics
vercel env add SUPABASE_SERVICE_ROLE_KEY production --scope musical-basics
vercel --prod --scope musical-basics   # redeploy with the new vars
```
(Or add them in Vercel → Project → **Settings → Environment Variables**.)

---

## Password resets
`/login` has a **Forgot password?** link. The flow is:

```
/forgot ──resetPasswordForEmail──▶ Supabase emails a one-time link
        ──▶ /auth/callback  (swaps the code for a session cookie)
        ──▶ /reset-password (set + confirm, min 8 chars) ──▶ /admin
```

There's no admin role — any confirmed helper account can use this, and `/admin`
is gated only on "is logged in".

**Two things must be set in the Supabase dashboard for it to work:**

1. **Authentication → URL Configuration → Redirect URLs** must include the
   callback for every origin you use, or Supabase silently sends the helper to
   the Site URL instead:
   ```
   https://stream-overlay-iota.vercel.app/auth/callback
   http://localhost:3000/auth/callback
   ```
2. **Authentication → Emails → SMTP.** The built-in Supabase mailer is capped at
   a couple of messages per hour and is not meant for production — if resets
   need to be reliable, plug in real SMTP (Resend, Postmark, SES).

Two limits worth telling helpers about: the link expires after an hour, and it
must be opened **in the same browser that requested it** (the PKCE verifier is
stored in a cookie there). Opening it on a phone after requesting on a laptop
will fail with "This link isn't valid".

If someone is locked out entirely, you can still set a password by hand in
**Authentication → Users → … → Reset password**.

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
