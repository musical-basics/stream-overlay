# stream-overlay — project instructions

## Git: push after every change

**Commit and push after every completed change, without asking first.** `main`
is the deploy branch — every push to `main` triggers a production deploy on
Vercel, and that's intended. One commit per coherent change (not per file edit),
matching the repo's `feat:/fix:/docs:/chore:` style. Don't bypass hooks
(`--no-verify`); still pause before destructive git ops (force-push, hard reset,
amending pushed commits).

## Supabase

- App data lives in the `stream_overlay` schema (not `public`). All three
  clients pass `db: { schema: "stream_overlay" }`.
- Direct DB host is IPv6-only; connect via the transaction pooler:
  `postgres.rhtshpewletapfcfrnvt@aws-1-us-east-1.pooler.supabase.com:6543`.
- Helper accounts are created manually via the Auth admin API / dashboard
  (no public sign-up). Secrets live in `.env.local` (gitignored) and Vercel.
