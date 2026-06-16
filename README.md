# Stream Overlay

A live OBS overlay for YouTube streams with a password-protected control panel.
You (or a helper) edit a "Now playing" line and trigger floating applause emojis
+ a sound effect — everything updates on the overlay in real time.

- **`/overlay`** — transparent page you add as a **Browser source** in OBS.
- **`/control`** — control panel for you/helpers (login required).
- **`/login`** — single shared password.

Stack: **Next.js (App Router) · Supabase (Realtime + Postgres) · Vercel**.

---

## How it works

```
Helper types in /control ──POST /api/text──▶ overlay_state table ──Realtime──▶ /overlay updates text
Helper hits "Applause"  ──POST /api/applause─▶ applause_events row ─Realtime──▶ /overlay: emojis + sound
```

- The browser uses the **public anon key** and can only *read* (enforced by RLS).
- All *writes* go through server API routes using the **service-role key**, gated
  by the login cookie. So a viewer who opens `/overlay` can't change anything.
- The applause **sound is played by the overlay itself** — OBS captures the
  Browser source's audio automatically (no separate audio wiring needed).

---

## Setup (one time, ~10 minutes)

### 1. Create a Supabase project
1. Go to <https://supabase.com> → **New project**. Pick a name + password, wait for it to provision.
2. In the dashboard open **SQL Editor** → **New query**, paste the contents of
   [`supabase/schema.sql`](supabase/schema.sql), and **Run**. This creates the
   tables, the read policies, and enables Realtime.
3. Open **Project Settings → API** and copy three values:
   - **Project URL**
   - **anon public** key
   - **service_role** key (keep this secret)

### 2. Configure environment variables
Copy the example file and fill it in:

```bash
cp .env.local.example .env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=...          # Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=...     # anon public key
SUPABASE_SERVICE_ROLE_KEY=...         # service_role key (secret)
CONTROL_PASSWORD=pick-a-strong-one    # what helpers type to log in
SESSION_SECRET=...                    # run: openssl rand -base64 32
```

### 3. Run locally
```bash
npm install
npm run dev
```
- Overlay:  <http://localhost:3000/overlay>
- Control:  <http://localhost:3000/control>

Open both in two windows, type in the control panel, watch the overlay update.

### 4. (Optional) Add a real applause sound
Drop an `applause.mp3` into the [`public/`](public/) folder. Without it, a
synthesized applause plays as a fallback.

---

## Deploy to Vercel
1. Push this repo to GitHub.
2. On <https://vercel.com> → **New Project** → import the repo.
3. Add the **same 5 environment variables** from `.env.local` in the Vercel
   project settings (Production + Preview).
4. Deploy. Your overlay is at `https://your-app.vercel.app/overlay`.

---

## Add to OBS
1. **Sources → + → Browser**.
2. URL: your `/overlay` URL (local or the deployed one).
3. Set **Width 1920 / Height 1080** (match your canvas).
4. Make sure the source's audio is audible to your stream:
   right-click the source → **Properties** → ensure
   **"Control audio via OBS"** is enabled (so applause is heard on stream).
5. Position it on top of your other sources. The background is transparent.

> Tip: if you edit text/applause and OBS doesn't react, right-click the Browser
> source → **Refresh**. Realtime reconnects automatically after that.

---

## Security notes
- One shared password for all helpers; rotate it by changing `CONTROL_PASSWORD`
  and redeploying. To force everyone to re-login, also change `SESSION_SECRET`.
- The service-role key lives only on the server (never `NEXT_PUBLIC_`).
- The overlay is intentionally public and read-only.
